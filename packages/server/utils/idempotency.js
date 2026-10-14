import crypto from 'crypto';
import { businessError } from './businessError.js';

// Same JSON for the same content regardless of key order.
function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

export function hashRequest(payload) {
    const { idempotency_key: _ignored, ...rest } = payload || {};
    return crypto.createHash('sha256').update(stableStringify(rest)).digest('hex');
}

/**
 * Claims an idempotency key inside the caller's transaction (ADR-015). The first attempt
 * inserts the row; a concurrent retry waits on the primary key and, once the first commits,
 * gets its stored response back. Returns { replay } (the stored response) or { replay: null }.
 * The same key with a different payload is a 409, never a silent replay.
 */
export async function claimIdempotentRequest(connection, scope, key, payload) {
    if (!key) return { replay: null };
    // Routes without schema validation (bulk supplier payments) can send anything as key.
    if (typeof key !== 'string' || key.length > 64) {
        throw businessError(400, { error: 'invalid_idempotency_key', message: 'Clave de idempotencia inválida.' });
    }
    const requestHash = hashRequest(payload);
    try {
        await connection.query(
            'INSERT INTO idempotency_requests (scope, idem_key, request_hash) VALUES (?, ?, ?)',
            [scope, key, requestHash]
        );
        return { replay: null };
    } catch (err) {
        if (err?.code !== 'ER_DUP_ENTRY') throw err;
    }
    const [rows] = await connection.query(
        // Shared lock: sees the committed first attempt, and several concurrent retries can all
        // read it at once (exclusive locks would make them wait on each other).
        'SELECT request_hash, response_json FROM idempotency_requests WHERE scope = ? AND idem_key = ? FOR SHARE',
        [scope, key]
    );
    const stored = rows[0];
    if (!stored || stored.request_hash !== requestHash) {
        throw businessError(409, {
            error: 'idempotency_key_reused',
            message: 'Esta clave ya registró otra operación: revisá el listado antes de cargarla de nuevo.'
        });
    }
    const response = typeof stored.response_json === 'string' ? JSON.parse(stored.response_json) : stored.response_json;
    return { replay: { ...(response || {}), idempotent_replay: true } };
}

// Stores the response of the first attempt, in the same transaction as its effects.
export async function saveIdempotentResponse(connection, scope, key, response) {
    if (!key) return;
    await connection.query(
        'UPDATE idempotency_requests SET response_json = ? WHERE scope = ? AND idem_key = ?',
        [JSON.stringify(response ?? {}), scope, key]
    );
}
