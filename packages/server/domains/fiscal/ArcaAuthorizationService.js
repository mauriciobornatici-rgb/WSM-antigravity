import pool from '../../config/db.js';
import defaultAfipService, { arcaToday, isArcaRejection, voucherMatchesRequest } from '../../services/afip.service.js';
import { businessError } from '../../utils/businessError.js';

// After ARCA did not answer, the number is not given up before this long: the request may
// still be in process (ARCA or the SDK cloud), and asking for another number would issue twice.
export const ARCA_COOLDOWN_SECONDS = 120;
// The recovery worker runs every 2 minutes: 10 minutes in verification is several failed runs.
export const ARCA_ALERT_STALE_MINUTES = 10;
// ADR-022 (user): an electronic invoice still without a CAE a day later needs someone.
export const ARCA_ALERT_UNAUTHORIZED_HOURS = 24;

/**
 * ADR-020 / AUD-008 — ARCA authorization that never issues twice and never loses a CAE.
 *
 * Rules:
 * - Only the holder of the named lock for the point of sale and voucher type touches the
 *   ARCA state of a document, and all its database work goes through that same connection
 *   (no second pool connection is taken while holding it).
 * - A document is 'authorizing' only once its requested number is saved, together with the
 *   date, point of sale and voucher type used. Before that nothing has been asked of ARCA.
 * - The saved number is resolved by asking ARCA about exactly that voucher: adopted only if
 *   it is this document's (type, total, customer, date, associated invoice) and no other local
 *   document holds it. "Could not ask" is never read as "it does not exist".
 * - ARCA did not answer → the document stays 'authorizing'. It is only released when ARCA
 *   confirms the number does not exist AND the cool-down passed. Even a rejection is checked.
 * - The network call never runs inside a database transaction.
 */
export class ArcaAuthorizationService {
    constructor({ db = pool, afipService = defaultAfipService } = {}) {
        this.db = db;
        this.afipService = afipService;
    }

    async authorize(adapter, id, userId = null, { create = true, lockTimeout = 15 } = {}) {
        const [docRows] = await this.db.query(`SELECT * FROM ${adapter.table} WHERE id = ? AND deleted_at IS NULL`, [id]);
        const snapshot = docRows[0];
        if (!snapshot) throw businessError(404, { error: 'not_found', message: `${adapter.label} no encontrada` });
        if (snapshot.status === 'authorized') return adapter.load(id);
        if (String(snapshot.status || '').toLowerCase() === 'cancelled') {
            throw businessError(409, { error: 'cancelled', message: `${adapter.label} está anulada.` });
        }
        if (snapshot.status === 'arca_conflict') {
            throw businessError(409, {
                error: 'arca_conflict',
                message: 'Este comprobante tiene un conflicto de numeración con ARCA: hace falta revisarlo a mano.'
            });
        }

        // Prepared without any lock (it reads the invoice, its lines, the corrected invoice).
        const settings = await this._companySettings();
        const prepared = await adapter.prepare(snapshot, settings);
        if (prepared.local) return this._finishLocal(adapter, id, userId);
        const request = this.afipService.buildRequest(prepared.voucher, prepared.items, settings);
        // A pending number is always checked where it was asked for.
        if (snapshot.arca_expected_number && snapshot.arca_pos && snapshot.arca_voucher_type) {
            request.pos = Number(snapshot.arca_pos);
            request.voucherType = Number(snapshot.arca_voucher_type);
        }

        const lockName = `arca:${request.pos}:${request.voucherType}`;
        const connection = await this.db.getConnection();
        let outcome;
        try {
            const [[lock]] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, lockTimeout]);
            if (Number(lock?.acquired) !== 1) {
                // Busy: nothing about this document is touched.
                throw businessError(409, { error: 'arca_busy', message: 'Se está autorizando otro comprobante del mismo tipo: reintentá en unos segundos.' });
            }
            try {
                outcome = await this._authorizeLocked(connection, adapter, id, userId, request, settings, { create });
            } finally {
                await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
            }
        } finally {
            connection.release();
        }
        if (outcome?.error) throw outcome.error;
        return outcome?.document === false ? outcome.result : adapter.load(id);
    }

    async _authorizeLocked(connection, adapter, id, userId, request, settings, { create }) {
        const [rows] = await connection.query(`SELECT * FROM ${adapter.table} WHERE id = ?`, [id]);
        const doc = rows[0];
        if (!doc || doc.status === 'authorized') return {};
        if (doc.deleted_at || String(doc.status).toLowerCase() === 'cancelled') {
            return { error: businessError(409, { error: 'cancelled', message: `${adapter.label} está anulada.` }) };
        }

        // 1. A number already requested: what does ARCA have there?
        if (doc.arca_expected_number) {
            const verdict = await this._verify(connection, adapter, doc, request, settings);
            if (verdict.adopt) return this._finish(connection, adapter, doc, verdict.adopt, request, userId);
            if (verdict.conflict) return this._conflict(connection, adapter, doc, verdict.conflict);
            if (verdict.unknown) {
                return { error: businessError(503, { error: 'arca_unavailable', message: 'ARCA no responde: el comprobante queda en verificación y se resuelve solo cuando vuelva.' }) };
            }
            // Not issued there (or not ours). Given up only after the cool-down.
            const waited = await this._secondsSinceRequest(connection, adapter, id);
            if (waited < ARCA_COOLDOWN_SECONDS) {
                return {
                    error: businessError(409, {
                        error: 'arca_verifying',
                        message: 'ARCA todavía puede estar procesando el pedido anterior: se verifica sola en unos minutos.'
                    })
                };
            }
            await this._clearRequest(connection, adapter, id, 'La solicitud anterior no figura en ARCA');
            if (!create) return { document: false, result: { recovered: false } };
        } else if (!create) {
            // Recovery of a document without a requested number (left from older versions).
            await this._clearRequest(connection, adapter, id, null);
            return { document: false, result: { recovered: false } };
        }

        // 2. A new request: the number comes from ARCA and is saved before asking for the CAE.
        // If ARCA cannot be reached here nothing has been asked yet: the document stays pending.
        let number;
        try {
            number = (await this.afipService.lastVoucherNumber(request, settings)) + 1;
        } catch (error) {
            return { error: businessError(503, { error: 'arca_unreachable', message: `No se pudo consultar a ARCA (${error.message}). Reintentá.` }) };
        }
        const requestDate = arcaToday();
        // The claim is conditional: a document annulled meanwhile (ADR-022 reissue, which locks
        // the row and only takes 'issued') is never sent to ARCA.
        const [claim] = await connection.query(
            `UPDATE ${adapter.table} SET status = 'authorizing', arca_expected_number = ?, arca_request_date = ?, arca_pos = ?,
                arca_voucher_type = ?, arca_requested_at = NOW(), arca_attempts = arca_attempts + 1, arca_last_error = NULL
             WHERE id = ? AND deleted_at IS NULL AND status IN (?, 'authorizing')`,
            [number, requestDate, request.pos, request.voucherType, id, adapter.pendingStatus]
        );
        if (claim && claim.affectedRows === 0) {
            return { error: businessError(409, { error: 'cancelled', message: `${adapter.label} fue anulada o cambió mientras se autorizaba.` }) };
        }
        const requested = { ...doc, arca_expected_number: number, arca_request_date: requestDate };

        let result;
        try {
            result = await this.afipService.requestCae(request, number, requestDate, settings);
            if (!result?.cae) throw Object.assign(new Error('ARCA respondió sin CAE'), { code: 'NO_CAE' });
        } catch (error) {
            // Whatever happened, first ask ARCA what it has at that number.
            const verdict = await this._verify(connection, adapter, requested, request, settings);
            if (verdict.adopt) return this._finish(connection, adapter, requested, verdict.adopt, request, userId);
            if (verdict.conflict) return this._conflict(connection, adapter, requested, verdict.conflict);
            if (isArcaRejection(error) && !verdict.unknown) {
                // A real refusal and the number is confirmed unused: back to pending, with the reason.
                await this._clearRequest(connection, adapter, id, `ARCA rechazó el comprobante: ${error.message}`, adapter.pendingStatus);
                return { error: businessError(422, { error: 'arca_rejected', message: `ARCA rechazó el comprobante: ${error.message}` }) };
            }
            // No answer (or a refusal that could not be checked): it stays in verification.
            await connection.query(`UPDATE ${adapter.table} SET arca_last_error = ? WHERE id = ?`, [String(error.message).slice(0, 2000), id]);
            return { error: businessError(503, { error: 'arca_unavailable', message: 'ARCA no respondió: el comprobante queda en verificación y se resuelve solo.' }) };
        }
        return this._finish(connection, adapter, requested, { ...result, number }, request, userId);
    }

    async _companySettings() {
        const [rows] = await this.db.query('SELECT * FROM company_settings LIMIT 1');
        return rows[0] || {};
    }

    async _secondsSinceRequest(connection, adapter, id) {
        const [[row]] = await connection.query(
            `SELECT TIMESTAMPDIFF(SECOND, arca_requested_at, NOW()) AS seconds FROM ${adapter.table} WHERE id = ?`,
            [id]
        );
        return row?.seconds == null ? Number.MAX_SAFE_INTEGER : Number(row.seconds);
    }

    async _clearRequest(connection, adapter, id, reason, status = null) {
        await connection.query(
            `UPDATE ${adapter.table} SET status = ?, arca_expected_number = NULL, arca_request_date = NULL,
                arca_pos = NULL, arca_voucher_type = NULL, arca_last_error = ?
             WHERE id = ? AND status <> 'authorized'`,
            [status || adapter.pendingStatus, reason ? String(reason).slice(0, 2000) : null, id]
        );
    }

    // { adopt } this document's voucher, { conflict } issued for this document but its number is
    // held locally by another one, { unknown } ARCA could not be asked, {} not issued / not ours.
    async _verify(connection, adapter, doc, request, settings) {
        let info;
        try {
            info = await this.afipService.voucherAt(request, doc.arca_expected_number, settings);
        } catch {
            return { unknown: true };
        }
        if (!info || !voucherMatchesRequest(info, request, doc.arca_request_date)) return {};
        const adopt = {
            cae: info.CodAutorizacion,
            cae_expiration_date: this.afipService.formatExpirationDate(info.FchVto),
            number: Number(doc.arca_expected_number),
            recovered: true,
        };
        const holder = await adapter.numberHolder(connection, doc, request, doc.arca_expected_number);
        if (!holder) return { adopt };
        // Another local document holds that number: with the same CAE it is that one's voucher
        // (identical tickets); with another CAE it is a real conflict that needs a person.
        if (holder.cae && String(holder.cae) === String(info.CodAutorizacion)) return {};
        return { conflict: adopt };
    }

    async _finish(connection, adapter, doc, result, request, userId) {
        await connection.beginTransaction();
        try {
            const [rows] = await connection.query(`SELECT * FROM ${adapter.table} WHERE id = ? FOR UPDATE`, [doc.id]);
            if (rows[0]?.status === 'authorized') {
                await connection.commit();
                return {};
            }
            await adapter.store(connection, rows[0], result, request, userId);
            await connection.commit();
            return {};
        } catch (error) {
            // A failed rollback must not hide why storing failed.
            await connection.rollback().catch(() => {});
            if (error?.responseBody?.error === 'arca_number_conflict') {
                // The CAE exists in ARCA: it is kept, never asked again.
                return this._conflict(connection, adapter, doc, result, error.message);
            }
            throw error;
        }
    }

    async _conflict(connection, adapter, doc, result, reason = null) {
        await connection.query(
            `UPDATE ${adapter.table} SET status = 'arca_conflict', cae = ?, cae_expiration_date = ?, arca_last_error = ? WHERE id = ?`,
            [result.cae, result.cae_expiration_date,
                (reason || `ARCA emitió el número ${result.number} para este comprobante pero ese número lo tiene otro documento local: revisar a mano.`).slice(0, 2000),
                doc.id]
        );
        return { error: businessError(409, { error: 'arca_conflict', message: 'ARCA emitió el comprobante con un número que localmente tiene otro documento: quedó en conflicto para revisar a mano.' }) };
    }

    // Tickets are not ARCA vouchers: authorized locally, once.
    async _finishLocal(adapter, id, userId) {
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query(`SELECT * FROM ${adapter.table} WHERE id = ? FOR UPDATE`, [id]);
            if (rows[0] && rows[0].status !== 'authorized') {
                await adapter.store(connection, rows[0], { cae: null, cae_expiration_date: null, number: null, local: true }, null, userId);
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return adapter.load(id);
    }

    /**
     * Recovery worker: documents in verification for longer than the cool-down are settled by
     * asking ARCA about their number. It never creates a voucher, never waits for a lock (a busy
     * point of sale is retried next run) and never overlaps with itself.
     */
    async recoverPending(adapters) {
        if (this.recovering) return [];
        this.recovering = true;
        const results = [];
        try {
            for (const adapter of adapters) {
                const [rows] = await this.db.query(
                    `SELECT id FROM ${adapter.table}
                     WHERE status = 'authorizing' AND deleted_at IS NULL
                       AND (arca_requested_at IS NULL OR arca_requested_at < NOW() - INTERVAL ? SECOND)
                     LIMIT 50`,
                    [ARCA_COOLDOWN_SECONDS]
                );
                for (const row of rows) {
                    try {
                        results.push({ table: adapter.table, id: row.id, result: await this.authorize(adapter, row.id, null, { create: false, lockTimeout: 0 }) });
                    } catch (error) {
                        results.push({ table: adapter.table, id: row.id, error: error.message });
                    }
                }
            }
        } finally {
            this.recovering = false;
        }
        return results;
    }

    /**
     * ADR-021 / AUD-009 / ADR-022: what someone has to look at, each row with its `alert`:
     * - conflict: ARCA holds a voucher with that number that is not this document's (never
     *   resolves on its own);
     * - stuck: still in verification after `staleMinutes` (the worker cannot reach ARCA);
     * - rejected: back to pending with ARCA's reason and no CAE (it will not authorize by
     *   retrying as it is: correct it, or annul it and issue it again);
     * - unauthorized: an electronic invoice (A, B or C) or a fiscal credit note without a CAE
     *   and without any attempt after `unauthorizedHours`. Only once ARCA is configured:
     *   before that every invoice would be one.
     * Counts are exact; the list shows conflicts first and is capped.
     */
    async listAlerts({ staleMinutes = ARCA_ALERT_STALE_MINUTES, unauthorizedHours = ARCA_ALERT_UNAUTHORIZED_HOURS } = {}) {
        const settings = await this._companySettings();
        // Counted only from the moment ARCA was configured (user decision): earlier invoices were
        // never meant to go to ARCA. Without that moment recorded, nothing is counted.
        const configuredAt = settings.arca_configured_at || null;
        const arcaConfigured = Boolean(settings.billing_afip_crt && settings.billing_afip_key && configuredAt);
        const filters = (fiscalOnly) => `deleted_at IS NULL AND (
                status = 'arca_conflict'
                OR (status = 'authorizing' AND (arca_requested_at IS NULL OR arca_requested_at < NOW() - INTERVAL ? MINUTE))
                OR (status = 'issued' AND cae IS NULL AND arca_last_error IS NOT NULL)
                ${arcaConfigured ? `OR (status = 'issued' AND cae IS NULL AND arca_last_error IS NULL AND arca_attempts = 0 AND ${fiscalOnly}
                    AND created_at < NOW() - INTERVAL ? HOUR AND created_at >= ?)` : ''}
            )`;
        const alertColumn = `CASE WHEN status = 'arca_conflict' THEN 'conflict'
                WHEN status = 'authorizing' THEN 'stuck'
                WHEN arca_last_error IS NOT NULL THEN 'rejected'
                ELSE 'unauthorized' END AS alert`;
        const params = arcaConfigured ? [staleMinutes, unauthorizedHours, configuredAt] : [staleMinutes];
        const invoiceFilter = filters(`invoice_type IN ('A', 'B', 'C')`);
        // A credit note goes to ARCA only when it corrects an electronic invoice (not a ticket).
        const noteFilter = filters(`invoice_id IN (SELECT fi.id FROM invoices fi WHERE fi.invoice_type IN ('A', 'B', 'C'))`);
        const order = `ORDER BY (status = 'arca_conflict') DESC, COALESCE(arca_requested_at, created_at) ASC LIMIT 100`;
        const counts = `SUM(status = 'arca_conflict') AS conflict, SUM(status = 'authorizing') AS stuck,
                SUM(status = 'issued' AND arca_last_error IS NOT NULL) AS rejected,
                SUM(status = 'issued' AND arca_last_error IS NULL) AS unauthorized`;
        // The number at stake is the one asked of ARCA, when there is one.
        const [invoices] = await this.db.query(
            `SELECT 'invoice' AS document_kind, id, invoice_type AS letter,
                    COALESCE(arca_pos, point_of_sale) AS point_of_sale,
                    COALESCE(arca_expected_number, invoice_number) AS number,
                    client_name AS customer, total_amount AS amount, ${alertColumn},
                    status, arca_last_error, arca_requested_at, arca_attempts, created_at
             FROM invoices WHERE ${invoiceFilter} ${order}`,
            params
        );
        const [creditNotes] = await this.db.query(
            `SELECT 'credit_note' AS document_kind, id, credit_note_type AS letter,
                    COALESCE(arca_pos, point_of_sale) AS point_of_sale,
                    COALESCE(arca_voucher_number, arca_expected_number, number) AS number,
                    customer_name AS customer, amount, ${alertColumn},
                    status, arca_last_error, arca_requested_at, arca_attempts, created_at
             FROM credit_notes WHERE ${noteFilter} ${order}`,
            params
        );
        const [[invoiceCounts = {}]] = await this.db.query(`SELECT ${counts} FROM invoices WHERE ${invoiceFilter}`, params);
        const [[noteCounts = {}]] = await this.db.query(`SELECT ${counts} FROM credit_notes WHERE ${noteFilter}`, params);
        const total = (key) => Number(invoiceCounts[key] || 0) + Number(noteCounts[key] || 0);
        const items = [...invoices, ...creditNotes]
            .map((row) => ({ ...row, amount: Number(row.amount || 0) }))
            .sort((a, b) => Number(b.alert === 'conflict') - Number(a.alert === 'conflict'));
        return {
            conflicts: total('conflict'),
            stuck: total('stuck'),
            rejected: total('rejected'),
            unauthorized: total('unauthorized'),
            stale_minutes: staleMinutes,
            unauthorized_hours: unauthorizedHours,
            items,
        };
    }
}

export default new ArcaAuthorizationService();
