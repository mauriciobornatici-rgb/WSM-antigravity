import { getEnvConfig } from '../config/env.js';

const env = getEnvConfig();

const globalErrorHandler = (err, req, res, next) => {
    console.error(`[ERROR] ${err.stack}`);

    const statusCode = err.statusCode || 500;
    const status = err.status || 'error';
    const safeMessage = (!env.isDevelopment && statusCode >= 500)
        ? 'Internal Server Error'
        : (err.message || 'Error interno del servidor');

    res.status(statusCode).json({
        status,
        message: safeMessage,
        ...(env.isDevelopment && { stack: err.stack })
    });
};

export default globalErrorHandler;
