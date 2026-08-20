import express from 'express';
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
import globalErrorHandler from './middleware/errorMiddleware.js';
import { authenticateToken, authorizePermission } from './middleware/authMiddleware.js';
import { PERMISSIONS } from '@wsm/common';
import { validate, schemas, validateZod, zodSchemas } from './middleware/validationMiddleware.js';
import * as userController from './controllers/userController.js';
import tiendaNubeService from './services/tiendanube.service.js';
import salesService from './services/sales.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const env = getEnvConfig();
const port = env.port;
let httpServer = null;
let syncInterval = null;
let webhookInterval = null;

if (env.trustProxy !== undefined) {
    app.set('trust proxy', env.trustProxy);
}

// Global Middleware
app.use(helmet());

// CORS â€” restrict to allowed origins (default: Vite dev server)
const corsOrigins = env.corsOrigins;
app.use(cors({ origin: corsOrigins, credentials: true }));

const captureRawBody = (req, res, buffer) => {
    if (req.originalUrl?.startsWith('/api/integrations/tiendanube/webhooks')) {
        req.rawBody = Buffer.from(buffer);
    }
};

const defaultJsonParser = express.json({ limit: '10kb', verify: captureRawBody });
const uploadsJsonParser = express.json({ limit: '2mb', verify: captureRawBody });

// Product image uploads require larger payload than default API json limit.
app.use('/api/products/image-upload', uploadsJsonParser);
app.use((req, res, next) => {
    if (req.path === '/api/products/image-upload') return next();
    return defaultJsonParser(req, res, next);
});

app.use(hpp()); // Prevent HTTP Parameter Pollution
app.use('/uploads', express.static(path.resolve(__dirname, 'uploads')));

// Rate Limiting
const limiter = rateLimit({
    windowMs: env.apiRateLimitWindowMs,
    limit: env.apiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    message: { error: 'too_many_requests', message: 'Demasiadas peticiones desde esta IP, por favor intente nuevamente en 15 minutos' }
});

// Apply rate limiting to all requests
app.use('/api', limiter);

// Request Logging Middleware â€” redact sensitive query params
app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || crypto.randomUUID();
    const startedAt = process.hrtime.bigint();
    req.requestId = requestId;
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

// Health Check & Documentation Endpoints
app.get('/api/live', (req, res) => {
    res.json({ status: 'ok', uptime_seconds: Math.floor(process.uptime()) });
});

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            database: 'disconnected',
            ...(env.isDevelopment ? { error: err.message } : {})
        });
    }
});

// Route enumeration â€” development only
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
app.use('/api/accounting', authenticateToken, accountingRouter);

// Integration routes (auth callbacks and webhooks are PUBLIC so TiendaNube can reach them without our JWT)
// The authorize endpoint requires our JWT
app.use('/api/integrations', integrationRouter);

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

            // Recover durable webhook events left pending by crashes or transient failures.
            webhookInterval = setInterval(() => {
                tiendaNubeService.processPendingWebhookEvents(salesService).catch(err => {
                    console.error('[TiendaNube Webhook Worker] Error:', err);
                });
            }, 60 * 1000);
            webhookInterval.unref();
        });
    } catch (err) {
        console.error("Critical Database Initialization Failure:", err);
        process.exit(1);
    }
};

const shutdown = async (signal) => {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), event: 'shutdown_started', signal }));
    if (syncInterval) clearInterval(syncInterval);
    if (webhookInterval) clearInterval(webhookInterval);
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

void startServer();
