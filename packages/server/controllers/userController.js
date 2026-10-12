import catchAsync from '../utils/catchAsync.js';
import userService from '../services/user.service.js';
import { getEnvConfig } from '../config/env.js';
import getRequestIp from '../utils/requestIp.js';
import { expiredSessionCookie, sessionCookie } from '../utils/authCookie.js';

const env = getEnvConfig();

// Unified login handler with full audit logging
export const login = catchAsync(async (req, res) => {
    const { email, password } = req.body;
    const { user, token } = await userService.login({ email, password, ip: getRequestIp(req) });
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: env.isNonDevelopment }));
    res.json({ user });
});

// Alias: index.js references loginDirect — point it to the unified login
export const loginDirect = login;

export const getSession = catchAsync(async (req, res) => {
    const user = await userService.getActiveUserById(req.user.id);
    res.json({ user });
});

export const logout = catchAsync(async (req, res) => {
    res.setHeader('Set-Cookie', expiredSessionCookie({ secure: env.isNonDevelopment }));
    res.status(204).end();
});

export const getUsers = catchAsync(async (req, res) => {
    const users = await userService.listUsers();
    res.json(users);
});

export const createUser = catchAsync(async (req, res) => {
    const { name, email, password, role } = req.body;
    const created = await userService.createUser({
        name, email, password, role,
        actorId: req.user?.id,
        ip: getRequestIp(req)
    });
    res.json(created);
});

export const updateUser = catchAsync(async (req, res) => {
    const updated = await userService.updateUser({
        id: req.params.id,
        body: req.body,
        actorId: req.user?.id,
        ip: getRequestIp(req)
    });
    res.json(updated);
});

export const deleteUser = catchAsync(async (req, res) => {
    await userService.deleteUser({
        id: req.params.id,
        actorId: req.user?.id,
        ip: getRequestIp(req)
    });
    res.json({ success: true, message: 'Usuario desactivado' });
});
