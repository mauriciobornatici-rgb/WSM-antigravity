import pool from '../config/db.js';
import auditService from './audit.service.js';
import { businessError } from '../utils/businessError.js';
import { isArcaVatRate } from '../utils/vatAccounts.js';

const toRate = (row) => ({
    id: row.id,
    name: row.name,
    rate: Number(row.rate),
    is_default: Boolean(row.is_default),
    active: Boolean(row.active),
});

/**
 * VAT rates the user can pick for bank and processor fees (ADR-016). Only rates ARCA accepts
 * (each has its fiscal credit account). One of them is the default (21 % out of the box).
 */
class VatRatesService {
    async list({ includeInactive = false } = {}) {
        const [rows] = await pool.query(
            `SELECT id, name, rate, is_default, active FROM vat_rates
             ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY is_default DESC, rate DESC, name`
        );
        return rows.map(toRate);
    }

    // The default rate, or 21 when none is set.
    async defaultRate(connection = pool) {
        const [rows] = await connection.query('SELECT rate FROM vat_rates WHERE is_default = 1 AND active = 1 LIMIT 1');
        return rows[0] ? Number(rows[0].rate) : 21;
    }

    // A rate picked by the user must be one of the active ones (or the default when omitted).
    async resolveRate(connection, rate) {
        if (rate == null || rate === '') return this.defaultRate(connection);
        const value = Number(rate);
        const [rows] = await connection.query('SELECT rate FROM vat_rates WHERE rate = ? AND active = 1 LIMIT 1', [value]);
        if (rows.length === 0) {
            throw businessError(400, { error: 'invalid_vat_rate', message: `La alícuota ${value}% no está habilitada.` });
        }
        return value;
    }

    async save(payload, id = null, userId = null, ipAddress = null) {
        const rate = Number(payload.rate);
        if (!isArcaVatRate(rate)) {
            throw businessError(400, { error: 'invalid_vat_rate', message: 'La alícuota debe ser una de las que acepta ARCA: 0, 2,5, 5, 10,5, 21 o 27 %.' });
        }
        const name = String(payload.name || '').trim();
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            let rateId = id;
            if (id) {
                const [current] = await connection.query('SELECT * FROM vat_rates WHERE id = ? FOR UPDATE', [id]);
                if (current.length === 0) throw businessError(404, { error: 'not_found', message: 'Alícuota no encontrada.' });
                if (current[0].is_default && payload.active === false) {
                    throw businessError(409, { error: 'default_rate_inactive', message: 'La alícuota por defecto no se puede desactivar: elegí otra por defecto primero.' });
                }
                try {
                    await connection.query(
                        'UPDATE vat_rates SET name = ?, rate = ?, active = ? WHERE id = ?',
                        [name, rate, payload.active === false ? 0 : 1, id]
                    );
                } catch (err) {
                    if (err?.code === 'ER_DUP_ENTRY') {
                        throw businessError(409, { error: 'duplicate_vat_rate', message: 'Ya existe una alícuota con ese nombre.' });
                    }
                    throw err;
                }
            } else {
                try {
                    const [result] = await connection.query(
                        'INSERT INTO vat_rates (name, rate, active) VALUES (?, ?, ?)',
                        [name, rate, payload.active === false ? 0 : 1]
                    );
                    rateId = result.insertId;
                } catch (err) {
                    if (err?.code === 'ER_DUP_ENTRY') {
                        throw businessError(409, { error: 'duplicate_vat_rate', message: 'Ya existe una alícuota con ese nombre.' });
                    }
                    throw err;
                }
            }
            if (payload.is_default) {
                if (payload.active === false) {
                    throw businessError(409, { error: 'default_rate_inactive', message: 'La alícuota por defecto tiene que estar activa.' });
                }
                await connection.query('UPDATE vat_rates SET is_default = (id = ?)', [rateId]);
            }
            await auditService.log({
                user_id: userId,
                action: id ? 'UPDATE_VAT_RATE' : 'CREATE_VAT_RATE',
                entity_type: 'vat_rate',
                entity_id: String(rateId),
                new_values: { name, rate, is_default: Boolean(payload.is_default), active: payload.active !== false },
                ip_address: ipAddress,
            }, connection);
            await connection.commit();
            const [rows] = await pool.query('SELECT id, name, rate, is_default, active FROM vat_rates WHERE id = ?', [rateId]);
            return toRate(rows[0]);
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new VatRatesService();
