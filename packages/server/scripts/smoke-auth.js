import jwt from 'jsonwebtoken';
import pool, { closePool } from '../config/db.js';

const smokeUsers = {
    admin: '00000000-0000-0000-0000-00000000000a',
    manager: '00000000-0000-0000-0000-00000000000b',
    cashier: '00000000-0000-0000-0000-00000000000c',
    warehouse: '00000000-0000-0000-0000-00000000000d'
};

export async function tokensForRoles(roles, jwtSecret) {
    const ids = roles.map((role) => smokeUsers[role]);
    if (ids.some((id) => !id)) {
        throw new Error(`Unknown smoke role in: ${roles.join(', ')}`);
    }

    const placeholders = ids.map(() => '?').join(', ');
    const [rows] = await pool.query(
        `SELECT id, email, role, status, deleted_at, token_version
         FROM users
         WHERE id IN (${placeholders})`,
        ids
    );
    const usersById = new Map(rows.map((row) => [row.id, row]));

    return Object.fromEntries(roles.map((role) => {
        const expectedId = smokeUsers[role];
        const user = usersById.get(expectedId);
        if (!user || user.status !== 'active' || user.deleted_at || user.role !== role) {
            throw new Error(`Smoke user for role '${role}' is missing, inactive or misconfigured`);
        }

        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role,
                token_version: Number(user.token_version || 0)
            },
            jwtSecret,
            { expiresIn: '1h' }
        );
        return [role, token];
    }));
}

export { closePool as closeSmokeAuth };
