import { sendBusinessError } from './businessError.js';

// Wraps an async route handler. Expected business errors (thrown with businessError)
// answer with their exact body here, so handlers need no try/catch of their own;
// anything else reaches the global error middleware.
const catchAsync = (fn) => {
    return (req, res, next) => {
        fn(req, res, next).catch((err) => {
            if (sendBusinessError(res, err)) return;
            next(err);
        });
    };
};

export default catchAsync;
