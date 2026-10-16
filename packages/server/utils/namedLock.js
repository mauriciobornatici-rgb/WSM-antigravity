import { businessError } from './businessError.js';

// Short: the holder only checks and writes one row. A longer wait would just keep pool
// connections busy behind it (security review).
const LOCK_WAIT_SECONDS = 3;

/**
 * Runs fn(connection) in a transaction while holding a MySQL named lock, so two requests for
 * the same key (a CUIT) cannot both pass a check-then-insert where a unique index is not
 * possible (deleted rows keep their CUIT). Without a lock name it is a plain transaction.
 * `busy` is the 409 body when another request keeps the lock for longer than the wait.
 */
export async function withNamedLockTransaction(db, lockName, busy, fn) {
    const connection = await db.getConnection();
    const name = lockName ? String(lockName).slice(0, 64) : null;
    let releaseFailed = false;
    try {
        if (name) {
            const [[lock]] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [name, LOCK_WAIT_SECONDS]);
            if (Number(lock?.acquired) !== 1) throw businessError(409, busy);
        }
        await connection.beginTransaction();
        try {
            const result = await fn(connection);
            await connection.commit();
            return result;
        } catch (error) {
            await connection.rollback();
            throw error;
        }
    } finally {
        if (name) await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => { releaseFailed = true; });
        // A connection that may still hold the lock never goes back to the pool: closing it
        // frees the lock (otherwise that CUIT would answer "busy" until the pool dropped it).
        if (releaseFailed && typeof connection.destroy === 'function') connection.destroy();
        else connection.release();
    }
}
