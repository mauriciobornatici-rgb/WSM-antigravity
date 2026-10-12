// A business rule violation with an exact HTTP response body (kept for API compatibility).
export function businessError(statusCode, responseBody, errorCode = responseBody?.error) {
    const err = new Error(responseBody?.message || errorCode || 'Business rule violation');
    err.statusCode = statusCode;
    err.errorCode = errorCode;
    err.responseBody = responseBody;
    return err;
}

// Answers a business error with its exact body; returns false for any other error so the caller can rethrow it.
export function sendBusinessError(res, err) {
    if (!err?.responseBody) return false;
    res.status(err.statusCode).json(err.responseBody);
    return true;
}
