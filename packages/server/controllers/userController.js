import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import { getEnvConfig } from '../config/env.js';
import { isStrongPassword, getPasswordPolicyMessage } from '../utils/passwordPolicy.js';
import getRequestIp from '../utils/requestIp.js';
import { expiredSessionCookie, sessionCookie } from '../utils/authCookie.js';

const SALT_ROUNDS = 10;
const env = getEnvConfig();
const JWT_SECRET = env.jwtSecret;
const JWT_EXPIRES_IN = env.jwtExpiresIn;

let dummyPasswordHashPromise = null;
const getDummyPasswordHash = () => {
    dummyPasswordHashPromise ??= bcrypt.hash(crypto.randomUUID(), SALT_ROUNDS);
    return dummyPasswordHashPromise;
};

// Unified login handler with full audit logging
export const login = catchAsync(async (req, res) => {
    const { email, password } = req.body;

    const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND status = "active" AND deleted_at IS NULL', [email]);

    if (users.length === 0) {
        // Same bcrypt cost as a real user, so response time does not reveal which emails exist.
        await bcrypt.compare(password, await getDummyPasswordHash());
        return res.status(401).json({ error: 'invalid_credentials', message: 'Credenciales inválidas' });
    }

    const user = users[0];

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
        await auditService.log({
            action: 'LOGIN_FAILURE',
            entity_type: 'user',
            entity_id: user.id,
            new_values: { email },
            ip_address: getRequestIp(req)
        });
        return res.status(401).json({ error: 'invalid_credentials', message: 'Credenciales inválidas' });
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
            ip_address: getRequestIp(req)
        }, connection);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }

    const { password_hash, ...userBuffer } = user;
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: env.isNonDevelopment }));
    res.json({ user: userBuffer });
});

// Alias: index.js references loginDirect — point it to the unified login
export const loginDirect = login;

export const getSession = catchAsync(async (req, res) => {
    const [users] = await pool.query(
        'SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ? AND status = "active" AND deleted_at IS NULL LIMIT 1',
        [req.user.id]
    );
    if (users.length === 0) {
        return res.status(401).json({ error: 'invalid_session', message: 'La sesion no es valida' });
    }
    res.json({ user: users[0] });
});

export const logout = catchAsync(async (req, res) => {
    res.setHeader('Set-Cookie', expiredSessionCookie({ secure: env.isNonDevelopment }));
    res.status(204).end();
});

export const getUsers = catchAsync(async (req, res) => {
    const [users] = await pool.query('SELECT id, name, email, role, status, created_at, last_login FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC');
    res.json(users);
});

export const createUser = catchAsync(async (req, res) => {
    const { name, email, password, role } = req.body;

    if (!password || !isStrongPassword(password)) {
        return res.status(400).json({
            error: 'invalid_password',
            message: getPasswordPolicyMessage()
        });
    }

    const id = crypto.randomUUID();
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const connection = await pool.getConnection();
    try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT id FROM users WHERE email = ? FOR UPDATE', [email]);
    if (existing.length > 0) {
        await connection.rollback();
        return res.status(409).json({ error: 'duplicate_email', message: 'El correo electrónico ya está registrado' });
    }

    await connection.query(`
        INSERT INTO users (id, name, email, password_hash, role, status)
        VALUES (?, ?, ?, ?, ?, 'active')
    `, [id, name, email, hashedPassword, role]);

    const [newUser] = await connection.query('SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ?', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_USER',
        entity_type: 'user',
        entity_id: id,
        new_values: newUser[0] || { id, name, email, role, status: 'active' },
        ip_address: getRequestIp(req)
    }, connection);
    await connection.commit();
    res.json(newUser[0]);
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

export const updateUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { name, email, role, status, password } = req.body;
    const connection = await pool.getConnection();
    try {
    await connection.beginTransaction();

    // A deleted user is gone: it cannot be edited (or "revived" through status: 'active').
    const [existing] = await connection.query(
        'SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [id]
    );
    if (existing.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'not_found', message: 'Usuario no encontrado' });
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
            await connection.rollback();
            return res.status(409).json({ error: 'last_admin', message: 'No se puede quitar el rol o desactivar al último administrador activo' });
        }
    }

    const [dupEmail] = await connection.query('SELECT id FROM users WHERE email = ? AND id != ? FOR UPDATE', [email, id]);
    if (dupEmail.length > 0) {
        await connection.rollback();
        return res.status(409).json({ error: 'duplicate_email', message: 'El correo electrónico ya está registrado por otro usuario' });
    }

    if (password && !isStrongPassword(password)) {
        await connection.rollback();
        return res.status(400).json({
            error: 'invalid_password',
            message: getPasswordPolicyMessage()
        });
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
        user_id: req.user?.id || null,
        action: 'UPDATE_USER',
        entity_type: 'user',
        entity_id: id,
        old_values: existing[0],
        new_values: updatedUser[0] || req.body,
        ip_address: getRequestIp(req)
    }, connection);
    await connection.commit();
    res.json(updatedUser[0]);
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});

export const deleteUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const connection = await pool.getConnection();
    try {
    await connection.beginTransaction();

    const [user] = await connection.query(
        'SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
        [id]
    );
    if (user.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'not_found', message: 'Usuario no encontrado' });
    }

    if (user[0].role === 'admin') {
        const [admins] = await connection.query("SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL FOR UPDATE");
        if (admins.length <= 1) {
            await connection.rollback();
            return res.status(409).json({ error: 'last_admin', message: 'No se puede eliminar el último administrador del sistema' });
        }
    }

    await connection.query(
        'UPDATE users SET deleted_at = CURRENT_TIMESTAMP, status = ?, token_version = token_version + 1 WHERE id = ?',
        ['inactive', id]
    );
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'DELETE_USER',
        entity_type: 'user',
        entity_id: id,
        old_values: user[0],
        new_values: { id, status: 'inactive', deleted_at: true },
        ip_address: getRequestIp(req)
    }, connection);
    await connection.commit();
    res.json({ success: true, message: 'Usuario desactivado' });
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
});
