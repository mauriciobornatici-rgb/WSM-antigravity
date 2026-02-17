import jwt from 'jsonwebtoken';

if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set. Server cannot start securely.');
    process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;

export const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            error: 'unauthorized',
            message: 'Se requiere token de autenticacion'
        });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            const isExpired = err.name === 'TokenExpiredError';
            return res.status(401).json({
                error: isExpired ? 'token_expired' : 'invalid_token',
                message: isExpired
                    ? 'La sesion expiro. Inicie sesion nuevamente.'
                    : 'Token invalido'
            });
        }

        req.user = user;
        next();
    });
};

export const authorizeRoles = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'forbidden',
                message: 'No tiene permisos para realizar esta accion'
            });
        }
        next();
    };
};
