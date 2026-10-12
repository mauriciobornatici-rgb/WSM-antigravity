// A business rule violation answered with an exact 4xx JSON body (kept for API
// compatibility). Only instances of this class are answered this way: a library error
// that happens to carry a `responseBody` property is never echoed to the client.
export class BusinessError extends Error {
    constructor(statusCode, responseBody, errorCode = responseBody?.error) {
        super(responseBody?.message || errorCode || 'Business rule violation');
        this.name = 'BusinessError';
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.responseBody = responseBody;
    }
}

export function businessError(statusCode, responseBody, errorCode) {
    return new BusinessError(statusCode, responseBody, errorCode);
}

export function isBusinessError(err) {
    return err instanceof BusinessError
        && Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 500;
}

// Answers a business error with its exact body; returns false for anything else (or when
// the response already started) so the caller hands it to the error middleware.
export function sendBusinessError(res, err) {
    if (!isBusinessError(err) || res.headersSent) return false;
    res.status(err.statusCode).json(err.responseBody);
    return true;
}
