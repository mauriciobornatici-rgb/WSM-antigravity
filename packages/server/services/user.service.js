import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import auditService from './audit.service.js';
import { getEnvConfig } from '../config/env.js';
import { isStrongPassword, getPasswordPolicyMessage } from '../utils/passwordPolicy.js';
import { businessError } from '../utils/businessError.js';

const SALT_ROUNDS = 10;
const env = getEnvConfig();
const JWT_SECRET = env.jwtSecret;
const JWT_EXPIRES_IN = env.jwtExpiresIn;

let dummyPasswordHashPromise = null;
const getDummyPasswordHash = () => {
    dummyPasswordHashPromise ??= bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);
    return dummyPasswordHashPromise;
};

const invalidCredentials = () => businessError(401, { error: 'invalid_credentials', message: 'Credenciales inválidas' });
const invalidPassword = () => businessError(400, { error: 'invalid_password', message: getPasswordPolicyMessage() });

class UserService {
    // Returns { user, token }; throws a 401 business error on bad credentials.
    async login({ email, password, ip }) {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND status = "active" AND deleted_at IS NULL', [email]);

        if (users.length === 0) {
            // Same bcrypt cost as a real user, so response time does not reveal which emails exist.
            await bcrypt.compare(password, await getDummyPasswordHash());
            throw invalidCredentials();
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            await auditService.log({
                action: 'LOGIN_FAILURE',
                entity_type: 'user',
                entity_id: user.id,
                new_values: { email },
                ip_address: ip
            });
            throw invalidCredentials();
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, token_version: Number(user.token_version || 0) },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' }
        );

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
            await auditService.log({
                user_id: user.id,
                action: 'LOGIN_SUCCESS',
                entity_type: 'user',
                entity_id: user.id,
                ip_address: ip
            }, connection);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        const { password_hash, ...userBuffer } = user;
        return { user: userBuffer, token };
    }

    async getActiveUserById(id) {
        const [users] = await pool.query(
            'SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ? AND status = "active" AND deleted_at IS NULL LIMIT 1',
            [id]
        );
        if (users.length === 0) {
            throw businessError(401, { error: 'invalid_session', message: 'La sesion no es valida' });
        }
        return users[0];
    }

    async listUsers() {
        const [users] = await pool.query('SELECT id, name, email, role, status, created_at, last_login FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC');
        return users;
    }

    async createUser({ name, email, password, role, actorId, ip }) {
        if (!password || !isStrongPassword(password)) {
            throw invalidPassword();
        }

        const id = crypto.randomUUID();
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [existing] = await connection.query('SELECT id FROM users WHERE email = ? FOR UPDATE', [email]);
            if (existing.length > 0) {
                throw businessError(409, { error: 'duplicate_email', message: 'El correo electrónico ya está registrado' });
            }

            await connection.query(`
        INSERT INTO users (id, name, email, password_hash, role, status)
        VALUES (?, ?, ?, ?, ?, 'active')
    `, [id, name, email, hashedPassword, role]);

            const [newUser] = await connection.query('SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ?', [id]);
            await auditService.log({
                user_id: actorId || null,
                action: 'CREATE_USER',
                entity_type: 'user',
                entity_id: id,
                new_values: newUser[0] || { id, name, email, role, status: 'active' },
                ip_address: ip
            }, connection);
            await connection.commit();
            return newUser[0];
        } catch (error) {
            // Business errors already rolled back before being thrown.
            await connection.rollback(); // single rollback for business and unexpected errors alike
            throw error;
        } finally {
            connection.release();
        }
    }

    // `body` is the raw request body (used as the audit fallback for new_values).
    async updateUser({ id, body, actorId, ip }) {
        const { name, email, role, status, password } = body;
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            // A deleted user is gone: it cannot be edited (or "revived" through status: 'active').
            const [existing] = await connection.query(
                'SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [id]
            );
            if (existing.length === 0) {
                throw businessError(404, { error: 'not_found', message: 'Usuario no encontrado' });
            }

            // Same protection as deleteUser: demoting or deactivating the last active admin
            // would lock everyone out of user and settings management.
            const losesAdminAccess = existing[0].role === 'admin' && existing[0].status === 'active'
                && (role !== 'admin' || status !== 'active');
            if (losesAdminAccess) {
                const [admins] = await connection.query(
                    "SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND deleted_at IS NULL FOR UPDATE"
                );
                if (admins.length <= 1) {
                    throw businessError(409, { error: 'last_admin', message: 'No se puede quitar el rol o desactivar al último administrador activo' });
                }
            }

            const [dupEmail] = await connection.query('SELECT id FROM users WHERE email = ? AND id != ? FOR UPDATE', [email, id]);
            if (dupEmail.length > 0) {
                throw businessError(409, { error: 'duplicate_email', message: 'El correo electrónico ya está registrado por otro usuario' });
            }

            if (password && !isStrongPassword(password)) {
                throw invalidPassword();
            }

            let updateQuery = 'UPDATE users SET name = ?, email = ?, role = ?, status = ?';
            const params = [name, email, role, status];

            if (password) {
                updateQuery += ', password_hash = ?, token_version = token_version + 1';
                const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
                params.push(hashedPassword);
            }

            updateQuery += ' WHERE id = ?';
            params.push(id);

            await connection.query(updateQuery, params);

            const [updatedUser] = await connection.query('SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ?', [id]);
            await auditService.log({
                user_id: actorId || null,
                action: 'UPDATE_USER',
                entity_type: 'user',
                entity_id: id,
                old_values: existing[0],
                new_values: updatedUser[0] || body,
                ip_address: ip
            }, connection);
            await connection.commit();
            return updatedUser[0];
        } catch (error) {
            // Business errors already rolled back before being thrown.
            await connection.rollback(); // single rollback for business and unexpected errors alike
            throw error;
        } finally {
            connection.release();
        }
    }

    async deleteUser({ id, actorId, ip }) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [user] = await connection.query(
                'SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
                [id]
            );
            if (user.length === 0) {
                throw businessError(404, { error: 'not_found', message: 'Usuario no encontrado' });
            }

            if (user[0].role === 'admin') {
                const [admins] = await connection.query("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL FOR UPDATE");
                if (admins.length <= 1) {
                    throw businessError(409, { error: 'last_admin', message: 'No se puede eliminar el último administrador del sistema' });
                }
            }

            await connection.query(
                'UPDATE users SET deleted_at = CURRENT_TIMESTAMP, status = ?, token_version = token_version + 1 WHERE id = ?',
                ['inactive', id]
            );
            await auditService.log({
                user_id: actorId || null,
                action: 'DELETE_USER',
                entity_type: 'user',
                entity_id: id,
                old_values: user[0],
                new_values: { id, status: 'inactive', deleted_at: true },
                ip_address: ip
            }, connection);
            await connection.commit();
        } catch (error) {
            // Business errors already rolled back before being thrown.
            await connection.rollback(); // single rollback for business and unexpected errors alike
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new UserService();
