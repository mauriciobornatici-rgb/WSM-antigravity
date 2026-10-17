import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import pool, { closePool } from './config/db.js';
import { initDatabase } from './config/initDb.js';
import { getEnvConfig } from './config/env.js';

// Import Routers
import userRouter from './routes/userRoutes.js';
import settingsRouter from './routes/settingsRoutes.js';
import inventoryRouter from './routes/inventoryRoutes.js';
import crmRouter from './routes/crmRoutes.js';
import salesRouter from './routes/salesRoutes.js';
import financeRouter from './routes/financeRoutes.js';
import procurementRouter from './routes/procurementRoutes.js';
import warrantiesRouter from './routes/warrantiesRoutes.js';
import dashboardRouter from './routes/dashboardRoutes.js';
import accountingRouter from './routes/accountingRoutes.js';
import integrationRouter from './routes/integrationRoutes.js';
import traceabilityRouter from './routes/traceabilityRoutes.js';
import importRouter from './routes/importRoutes.js';
import globalErrorHandler from './middleware/errorMiddleware.js';
import { authenticateToken, authorizePermission } from './middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';
import { validateZod, zodSchemas } from './middleware/validationMiddleware.js';
import * as userController from './controllers/userController.js';
import tiendaNubeService from './services/tiendanube.service.js';
import salesService from './services/sales.service.js';
import arcaAuthorization from './domains/fiscal/ArcaAuthorizationService.js';
import { invoiceArcaAdapter, creditNoteArcaAdapter } from './domains/fiscal/arcaAdapters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REQUEST_ID_PATTERN = /^[\w.-]{1,64}$/;
const HEALTH_DB_TIMEOUT_MS = 2000;

const app = express();
const env = getEnvConfig();
const port = env.port;
let httpServer = null;
let syncInterval = null;
let webhookInterval = null;
let stockReconcileInterval = null;
let stockFullReconcileInterval = null;
let stockDailyPushInterval = null;
let arcaRecoveryInterval = null;

if (env.trustProxy !== undefined) {
    app.set('trust proxy', env.trustProxy);
}

// Global Middleware
app.use(helmet());

// Request Logging & Correlation ID Middleware — redact sensitive query params.
// Registered before body parsers and the rate limiter so malformed JSON, oversized
// payloads and 429 responses also carry an X-Request-Id and reach the access log.
app.use((req, res, next) => {
    const incomingRequestId = req.headers['x-request-id'];
    const requestId = typeof incomingRequestId === 'string' && REQUEST_ID_PATTERN.test(incomingRequestId)
        ? incomingRequestId
        : crypto.randomUUID();
    const startedAt = process.hrtime.bigint();
    req.id = requestId;
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Request-ID', requestId);
    const host = req.headers.host || 'localhost';
    const url = new URL(req.originalUrl, `http://${host}`);
    const sensitiveKeys = ['token', 'password', 'secret', 'key'];
    for (const k of url.searchParams.keys()) {
        if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
            url.searchParams.set(k, '***');
        }
    }
    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            request_id: requestId,
            method: req.method,
            path: `${url.pathname}${url.search}`,
            status: res.statusCode,
            duration_ms: Math.round(durationMs * 100) / 100
        }));
    });
    next();
});

// CORS — restrict to allowed origins (default: Vite dev server)
const corsOrigins = env.corsOrigins;
app.use(cors({
    origin: corsOrigins,
    credentials: true,
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Limit', 'X-Total-Pages', 'X-Request-ID']
}));

const captureRawBody = (req, res, buffer) => {
    if (req.originalUrl?.startsWith('/api/integrations/tiendanube/webhooks')) {
        req.rawBody = Buffer.from(buffer);
    }
};

const defaultJsonParser = express.json({ limit: '10kb', verify: captureRawBody });
const uploadsJsonParser = express.json({ limit: '2mb', verify: captureRawBody });
// A spreadsheet import carries a bigger body: its router reads it after the session and the
// permission are checked (routes/importRoutes.js), never for an anonymous request.
const isImportPath = (path) => path.startsWith('/api/imports/');

// Product image uploads require larger payload than default API json limit.
app.use('/api/products/image-upload', uploadsJsonParser);
app.use((req, res, next) => {
    if (req.path === '/api/products/image-upload') return next();
    if (isImportPath(req.path)) return next();
    return defaultJsonParser(req, res, next);
});

app.use(hpp()); // Prevent HTTP Parameter Pollution
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads'), {
    setHeaders: (res) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
}));


// Rate Limiting
const limiter = rateLimit({
    windowMs: env.apiRateLimitWindowMs,
    limit: env.apiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/live',
    message: { error: 'too_many_requests', message: 'Demasiadas peticiones desde esta IP, por favor intente nuevamente en 15 minutos' }
});

// Apply rate limiting to all requests
app.use('/api', limiter);

// Health Check & Documentation Endpoints
app.get('/api/live', (req, res) => {
    res.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) });
});

app.get('/api/health', async (req, res) => {
    const startDb = process.hrtime.bigint();
    let timeoutId;
    try {
        // A health probe must answer promptly even when the database hangs.
        await Promise.race([
            pool.query('SELECT 1'),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error('database ping timed out')), HEALTH_DB_TIMEOUT_MS);
            })
        ]);
        const dbLatencyMs = Number(process.hrtime.bigint() - startDb) / 1_000_000;
        const memoryUsage = process.memoryUsage();
        res.json({
            status: 'ok',
            database: 'connected',
            db_latency_ms: Math.round(dbLatencyMs * 100) / 100,
            uptime_seconds: Math.floor(process.uptime()),
            memory_rss_mb: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100,
            memory_heap_mb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 100) / 100
        });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            database: 'disconnected',
            ...(env.isDevelopment ? { error: err.message } : {})
        });
    } finally {
        clearTimeout(timeoutId);
    }
});

// Route enumeration — development only
if (env.isDevelopment) {
    app.get('/api/routes', (req, res) => {
        const routes = [];
        const stack = app._router ? app._router.stack : (app.router ? app.router.stack : []);
        stack.forEach(r => {
            if (r.route && r.route.path) {
                routes.push(`${Object.keys(r.route.methods).join(',').toUpperCase()} ${r.route.path}`);
            }
        });
        res.json(routes);
    });
}

// Public Auth Routes
const loginLimiter = rateLimit({
    windowMs: env.loginRateLimitWindowMs,
    limit: env.loginRateLimitMax,
    message: { error: 'too_many_requests', message: 'Demasiados intentos de inicio de sesion, por favor intente nuevamente en 15 minutos' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/api/login', loginLimiter, validateZod(zodSchemas.login), userController.loginDirect);
app.get('/api/session', authenticateToken, userController.getSession);
app.post('/api/logout', userController.logout);

// Integration routes must be mounted before the '/api'-wide routers below: those run
// authenticateToken for every /api/* path, which would reject Tiendanube's webhooks and
// OAuth callback. Every non-public route in integrationRouter authenticates itself.
app.use('/api/integrations', integrationRouter);

// Mount Modular Routes - authentication at mount, RBAC inside each router
app.use('/api/users', authenticateToken, authorizePermission(PERMISSIONS.USERS_MANAGE), userRouter);
app.use('/api/settings', authenticateToken, settingsRouter);
app.use('/api', authenticateToken, inventoryRouter);
app.use('/api', authenticateToken, crmRouter);
app.use('/api', authenticateToken, salesRouter);
app.use('/api', authenticateToken, financeRouter);
app.use('/api', authenticateToken, procurementRouter);
app.use('/api', authenticateToken, warrantiesRouter);
app.use('/api', authenticateToken, dashboardRouter);
app.use('/api', authenticateToken, traceabilityRouter);
app.use('/api', authenticateToken, importRouter);
app.use('/api/accounting', authenticateToken, accountingRouter);

// Serve static client bundle if built (staging/production container)
const clientDistPath = path.resolve(__dirname, '../client/dist');
if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
    app.use((req, res, next) => {
        if (req.method !== 'GET') return next();
        if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
            return next();
        }
        res.sendFile(path.join(clientDistPath, 'index.html'));
    });
}

// Global Error Handler (Must be last)
app.use(globalErrorHandler);

const startServer = async () => {
    try {
        await initDatabase();
        httpServer = app.listen(port, () => {
            console.log(`
=========================================
WSM SportsERP Backend Started
Server listening on port ${port}
Health Check: http://localhost:${port}/api/health
=========================================
            `);

            // Start Tienda Nube background failed syncs retry queue (runs every 5 minutes)
            syncInterval = setInterval(() => {
                tiendaNubeService.processFailedSyncs().catch(err => {
                    console.error('[TiendaNube Background Sync] Error:', err);
                });
            }, 5 * 60 * 1000);

            // unref() to allow Node.js to exit cleanly if needed (e.g. during test sweeps or shutdown)
            syncInterval.unref();

            // ADR-019 — one stock: publish the available stock of every product whose stock or
            // reservations changed (every 20 s, a cheap query; Tiendanube is called only for
            // values that changed) and compare everything once an hour to heal any drift.
            stockReconcileInterval = setInterval(() => {
                tiendaNubeService.reconcileStock().catch(err => {
                    console.error('[TiendaNube Stock] Error:', err);
                });
            }, 20 * 1000);
            stockReconcileInterval.unref();
            stockFullReconcileInterval = setInterval(() => {
                tiendaNubeService.reconcileStock({ full: true }).catch(err => {
                    console.error('[TiendaNube Stock] Error en la conciliación completa:', err);
                });
            }, 60 * 60 * 1000);
            stockFullReconcileInterval.unref();
            // Once a day every product is published again, even if unchanged here: it corrects
            // stock edited by hand in the Tiendanube panel (one call per product per day).
            stockDailyPushInterval = setInterval(() => {
                tiendaNubeService.reconcileStock({ full: true, force: true }).catch(err => {
                    console.error('[TiendaNube Stock] Error en la publicación diaria:', err);
                });
            }, 24 * 60 * 60 * 1000);
            stockDailyPushInterval.unref();

            // ADR-020: invoices and credit notes left waiting for ARCA (a crash, a lost answer)
            // are settled every 2 minutes by asking ARCA about the number they requested.
            arcaRecoveryInterval = setInterval(() => {
                arcaAuthorization.recoverPending([invoiceArcaAdapter, creditNoteArcaAdapter]).catch(err => {
                    console.error('[ARCA] Error en la recuperación:', err);
                });
            }, 2 * 60 * 1000);
            arcaRecoveryInterval.unref();

            // Recover durable webhook events left pending by crashes or transient failures.
            webhookInterval = setInterval(() => {
                tiendaNubeService.processPendingWebhookEvents(salesService).catch(err => {
                    console.error('[TiendaNube Webhook Worker] Error:', err);
                });
            }, 60 * 1000);
            webhookInterval.unref();
        });
        return httpServer;
    } catch (err) {
        console.error("Critical Database Initialization Failure:", err);
        process.exit(1);
    }
};

const shutdown = async (signal) => {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'shutdown_started', signal }));
    if (syncInterval) clearInterval(syncInterval);
    if (webhookInterval) clearInterval(webhookInterval);
    if (stockReconcileInterval) clearInterval(stockReconcileInterval);
    if (stockFullReconcileInterval) clearInterval(stockFullReconcileInterval);
    if (stockDailyPushInterval) clearInterval(stockDailyPushInterval);
    if (arcaRecoveryInterval) clearInterval(arcaRecoveryInterval);
    if (httpServer) {
        await new Promise((resolve) => httpServer.close(resolve));
    }
    await closePool();
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'shutdown_completed' }));
};

for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
        shutdown(signal)
            .then(() => process.exit(0))
            .catch((error) => {
                console.error('Graceful shutdown failed:', error);
                process.exit(1);
            });
    });
}

const isDirectRun = Boolean(process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]));
if (isDirectRun) {
    void startServer();
}

export { app, startServer, shutdown };

