import pool from '../config/db.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import { getEnvConfig } from '../config/env.js';
import { isStrongPassword, getPasswordPolicyMessage } from '../utils/passwordPolicy.js';

const SALT_ROUNDS = 10;
const env = getEnvConfig();
const JWT_SECRET = env.jwtSecret;
const JWT_EXPIRES_IN = env.jwtExpiresIn;

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip;
}

// Unified login handler with full audit logging
export const login = catchAsync(async (req, res) => {
    const { email, password } = req.body;

    const [users] = await pool.query('SELECT * FROM users WHERE email = ? AND status = "active" AND deleted_at IS NULL', [email]);

    if (users.length === 0) {
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
        { expiresIn: JWT_EXPIRES_IN }
    );

    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

    await auditService.log({
        user_id: user.id,
        action: 'LOGIN_SUCCESS',
        entity_type: 'user',
        entity_id: user.id,
        ip_address: getRequestIp(req)
    });

    const { password_hash, ...userBuffer } = user;
    res.json({ user: userBuffer, token });
});

// Alias: index.js references loginDirect — point it to the unified login
export const loginDirect = login;

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

    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
        return res.status(409).json({ error: 'duplicate_email', message: 'El correo electrónico ya está registrado' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    await pool.query(`
        INSERT INTO users (id, name, email, password_hash, role, status)
        VALUES (?, ?, ?, ?, ?, 'active')
    `, [id, name, email, hashedPassword, role]);

    const [newUser] = await pool.query('SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ?', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'CREATE_USER',
        entity_type: 'user',
        entity_id: id,
        new_values: newUser[0] || { id, name, email, role, status: 'active' },
        ip_address: getRequestIp(req)
    });
    res.json(newUser[0]);
});

export const updateUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { name, email, role, status, password } = req.body;

    const [existing] = await pool.query(
        'SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ?',
        [id]
    );
    if (existing.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Usuario no encontrado' });
    }

    const [dupEmail] = await pool.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
    if (dupEmail.length > 0) {
        return res.status(409).json({ error: 'duplicate_email', message: 'El correo electrónico ya está registrado por otro usuario' });
    }

    if (password && !isStrongPassword(password)) {
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

    await pool.query(updateQuery, params);

    const [updatedUser] = await pool.query('SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ?', [id]);
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_USER',
        entity_type: 'user',
        entity_id: id,
        old_values: existing[0],
        new_values: updatedUser[0] || req.body,
        ip_address: getRequestIp(req)
    });
    res.json(updatedUser[0]);
});

export const deleteUser = catchAsync(async (req, res) => {
    const { id } = req.params;

    const [user] = await pool.query(
        'SELECT id, name, email, role, status, created_at, last_login FROM users WHERE id = ? AND deleted_at IS NULL',
        [id]
    );
    if (user.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Usuario no encontrado' });
    }

    if (user[0].role === 'admin') {
        const [admins] = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND deleted_at IS NULL");
        if (admins[0].count <= 1) {
            return res.status(409).json({ error: 'last_admin', message: 'No se puede eliminar el último administrador del sistema' });
        }
    }

    await pool.query(
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
    });
    res.json({ success: true, message: 'Usuario desactivado' });
});
