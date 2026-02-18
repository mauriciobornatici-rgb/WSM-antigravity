import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from monorepo root (two levels up from packages/server/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import pool from './config/db.js';
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
import globalErrorHandler from './middleware/errorMiddleware.js';
import { authenticateToken, authorizeRoles } from './middleware/authMiddleware.js';
import { validate, schemas } from './middleware/validationMiddleware.js';
import * as userController from './controllers/userController.js';

const app = express();
const env = getEnvConfig();
const port = env.port;

if (env.trustProxy !== undefined) {
    app.set('trust proxy', env.trustProxy);
}

// Global Middleware
app.use(helmet());

// CORS â€” restrict to allowed origins (default: Vite dev server)
const corsOrigins = env.corsOrigins;
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '10kb' })); // Body limit is security best practice
app.use(hpp()); // Prevent HTTP Parameter Pollution

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
    const host = req.headers.host || 'localhost';
    const url = new URL(req.originalUrl, `http://${host}`);
    const sensitiveKeys = ['token', 'password', 'secret', 'key'];
    for (const k of url.searchParams.keys()) {
        if (sensitiveKeys.some(s => k.toLowerCase().includes(s))) {
            url.searchParams.set(k, '***');
        }
    }
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}${url.search}`);
    next();
});

// Health Check & Documentation Endpoints
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected' });
    } catch (err) {
        res.status(500).json({
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

app.post('/api/login', loginLimiter, validate(schemas.login), userController.loginDirect);

// Mount Modular Routes - authentication at mount, RBAC inside each router
app.use('/api/users', authenticateToken, authorizeRoles('admin'), userRouter);
app.use('/api/settings', authenticateToken, settingsRouter);
app.use('/api', authenticateToken, inventoryRouter);
app.use('/api', authenticateToken, crmRouter);
app.use('/api', authenticateToken, salesRouter);
app.use('/api', authenticateToken, financeRouter);
app.use('/api', authenticateToken, procurementRouter);
app.use('/api', authenticateToken, warrantiesRouter);

// Global Error Handler (Must be last)
app.use(globalErrorHandler);

const startServer = async () => {
    try {
        await initDatabase();
        app.listen(port, () => {
            console.log(`
=========================================
WSM SportsERP Backend Started
Server listening on port ${port}
Health Check: http://localhost:${port}/api/health
=========================================
            `);
        });
    } catch (err) {
        console.error("Critical Database Initialization Failure:", err);
        process.exit(1);
    }
};

void startServer();
