import jwt from 'jsonwebtoken';
import pool from '../config/db.js';
import { getEnvConfig } from '../config/env.js';
import { hasPermission } from '@wsm/common';
import { getCookieValue, isTrustedCookieRequest } from '../utils/authCookie.js';

const env = getEnvConfig();
const JWT_SECRET = env.jwtSecret;

export const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const cookieToken = getCookieValue(req.headers.cookie);
    const token = bearerToken || cookieToken;

    if (!token) {
        return res.status(401).json({
            error: 'unauthorized',
            message: 'Se requiere token de autenticacion'
        });
    }

    if (!bearerToken && cookieToken && !isTrustedCookieRequest(req.method, req.headers.origin, env.corsOrigins)) {
        return res.status(403).json({
            error: 'invalid_origin',
            message: 'Origen de solicitud no permitido'
        });
    }

    let user;
    try {
        user = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (err) {
        const isExpired = err.name === 'TokenExpiredError';
        return res.status(401).json({
            error: isExpired ? 'token_expired' : 'invalid_token',
            message: isExpired
                ? 'La sesion expiro. Inicie sesion nuevamente.'
                : 'Token invalido'
        });
    }

    try {
        const [users] = await pool.query(
            'SELECT id, role, status, deleted_at, token_version FROM users WHERE id = ? LIMIT 1',
            [user.id]
        );

        if (users.length === 0 || users[0].deleted_at || users[0].status !== 'active') {
            return res.status(401).json({
                error: 'invalid_session',
                message: 'La sesion no es valida. Inicie sesion nuevamente.'
            });
        }

        const dbTokenVersion = Number(users[0].token_version || 0);
        const tokenVersion = Number(user.token_version || 0);
        if (dbTokenVersion !== tokenVersion) {
            return res.status(401).json({
                error: 'token_revoked',
                message: 'La sesion fue revocada. Inicie sesion nuevamente.'
            });
        }

        req.user = {
            ...user,
            role: users[0].role,
            token_version: dbTokenVersion
        };
        next();
    } catch (error) {
        next(error);
    }
};

export const authorizePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user || !hasPermission(req.user.role, permission)) {
            return res.status(403).json({
                error: 'forbidden',
                message: 'No tiene permisos para realizar esta accion'
            });
        }
        next();
    };
};
