import { getEnvConfig } from '../config/env.js';

const env = getEnvConfig();

const globalErrorHandler = (err, req, res, next) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        request_id: req.requestId || null,
        method: req.method,
        path: req.path,
        message: err.message,
        stack: err.stack
    }));

    const statusCode = err.statusCode || 500;
    const status = err.status || 'error';
    const safeMessage = (!env.isDevelopment && statusCode >= 500)
        ? 'Internal Server Error'
        : (err.message || 'Error interno del servidor');

    res.status(statusCode).json({
        status,
        message: safeMessage,
        request_id: req.requestId || null,
        ...(env.isDevelopment && { stack: err.stack })
    });
};

export default globalErrorHandler;
