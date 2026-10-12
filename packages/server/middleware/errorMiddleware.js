import { getEnvConfig } from '../config/env.js';

const env = getEnvConfig();

// Express recognises an error handler by its four parameters: _next must stay.
const globalErrorHandler = (err, req, res, _next) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        request_id: req.requestId || null,
        method: req.method,
        path: req.path,
        message: err.message,
        stack: err.stack
    }));

    // Library errors (e.g. body-parser) carry a numeric `status`; ours carry `statusCode`
    // and a 'fail'/'error' `status`. The response contract always uses the string form.
    const statusCode = err.statusCode || (Number.isInteger(err.status) ? err.status : 500);
    const status = typeof err.status === 'string' ? err.status : (statusCode < 500 ? 'fail' : 'error');
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
