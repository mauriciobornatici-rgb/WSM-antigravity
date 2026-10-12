import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import accountingService from './accounting.service.js';
import { recordDrawerInflow, recordDrawerOutflow } from './cashShift.service.js';
import { ACCOUNTS } from '../utils/paymentAccounts.js';
import { businessError } from '../utils/businessError.js';
import { claimIdempotentRequest, saveIdempotentResponse } from '../utils/idempotency.js';
import { bankChargeLines } from '../utils/bankCharges.js';
import vatRatesService from './vatRates.service.js';

const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

// Funds that can send or receive money (ADR-015). "initial" only sends: it opens Caja 2
// with cash the business already had (counterpart: capital).
const FUNDS = Object.freeze({
    drawer: { account: ACCOUNTS.CASH, label: 'Caja (turno abierto)' },
    treasury: { account: ACCOUNTS.TREASURY_CASH, label: 'Caja 2' },
    bank: { account: ACCOUNTS.BANK, label: 'Banco' },
    initial: { account: '3.1.01.01', label: 'Saldo inicial' },
});

/**
 * Locks "Caja 2" (its ledger account row) and checks it holds the amount. Every movement
 * out of Caja 2 takes this lock first, so two payments cannot both spend the same cash.
 */
export async function lockTreasury(connection) {
    await connection.query('SELECT code FROM chart_of_accounts WHERE code = ? FOR UPDATE', [ACCOUNTS.TREASURY_CASH]);
}

export async function ensureTreasuryFunds(connection, amount) {
    await lockTreasury(connection);
    // A locking read sees the latest committed balance: a plain read could reuse the
    // transaction's older snapshot and let two payments spend the same cash.
    const [[row]] = await connection.query(
        'SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS balance FROM journal_entry_lines WHERE account_code = ? FOR SHARE',
        [ACCOUNTS.TREASURY_CASH]
    );
    const balance = roundMoney(row?.balance || 0);
    if (roundMoney(amount) > balance + 0.001) {
        throw businessError(409, {
            error: 'insufficient_treasury_cash',
            message: `No hay efectivo suficiente en Caja 2 (disponible ${balance.toFixed(2)}).`,
            balance
        });
    }
    return balance;
}

// Balance and latest movements of a ledger account (the money it holds).
async function accountSummary(accountCode) {
    const [[row]] = await pool.query(
        'SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS balance FROM journal_entry_lines WHERE account_code = ?',
        [accountCode]
    );
    const [movements] = await pool.query(
        `SELECT je.id, je.date, je.description, je.reference_type, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
         FROM journal_entry_lines jl
         JOIN journal_entries je ON je.id = jl.journal_entry_id
         WHERE jl.account_code = ?
         GROUP BY je.id, je.date, je.description, je.reference_type, je.entry_number
         ORDER BY je.date DESC, je.entry_number DESC
         LIMIT 50`,
        [accountCode]
    );
    return {
        balance: roundMoney(row?.balance || 0),
        movements: movements.map((m) => ({
            id: m.id,
            date: m.date,
            description: m.description,
            reference_type: m.reference_type,
            amount: roundMoney(Number(m.debit || 0) - Number(m.credit || 0)),
        })),
    };
}

const resolveRateWith = (connection) => (rate) => vatRatesService.resolveRate(connection, rate);

class TreasuryService {
    async getSummary() {
        return accountSummary(ACCOUNTS.TREASURY_CASH);
    }

    // The bank account (ADR-016): balance and movements, including its debits.
    async getBankSummary() {
        return accountSummary(ACCOUNTS.BANK);
    }

    /**
     * Bank debits recorded on their own (ADR-016): commissions, maintenance, the tax on debits
     * and credits, withholdings. Debe each concept (and its VAT credit) / Haber Banco.
     * Idempotent like every money movement typed by a person.
     */
    async createBankCharges(payload, userId = null, ipAddress = null) {
        if (!Array.isArray(payload.charges) || payload.charges.length === 0) {
            throw businessError(400, { error: 'invalid_charge', message: 'Cargá al menos un débito bancario.' });
        }
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { replay } = await claimIdempotentRequest(connection, 'bank_charges', payload.idempotency_key, payload);
            if (replay) {
                await connection.commit();
                return replay;
            }
            const { lines, total } = await bankChargeLines(payload.charges, resolveRateWith(connection));
            const id = crypto.randomUUID();
            const reference = payload.reference ? String(payload.reference).trim().slice(0, 120) : '';
            const description = `Débitos bancarios${reference ? `: ${reference}` : ''}`;
            await accountingService.createJournalEntry(connection, {
                // A date-only value is a calendar day: build it in local time.
                date: payload.date ? new Date(`${String(payload.date).slice(0, 10)}T12:00:00`) : new Date(),
                description,
                reference_type: 'bank_charge',
                reference_id: id,
                lines: [...lines, { account_code: ACCOUNTS.BANK, debit: 0, credit: total, notes: description }],
            });
            await auditService.log({
                user_id: userId,
                action: 'CREATE_BANK_CHARGES',
                entity_type: 'bank',
                entity_id: id,
                new_values: { total, reference: reference || null, charges: payload.charges },
                ip_address: ipAddress,
            }, connection);
            const response = { id, total };
            await saveIdempotentResponse(connection, 'bank_charges', payload.idempotency_key, response);
            await connection.commit();
            return response;
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    // Moves cash between Caja (open shift), Caja 2 and the bank, or opens Caja 2 (ADR-015).
    // A movement that touches the bank can carry its bank debits (ADR-016).
    async transfer(payload, userId = null, ipAddress = null, actor = null) {
        const from = FUNDS[payload.from];
        const to = FUNDS[payload.to];
        const amount = roundMoney(payload.amount);
        const charges = Array.isArray(payload.charges) ? payload.charges : [];
        if (!from || !to || payload.from === payload.to || payload.to === 'initial') {
            throw businessError(400, { error: 'invalid_transfer', message: 'Origen y destino deben ser distintos (Caja, Caja 2 o Banco).' });
        }
        if (payload.from === 'initial' && payload.to !== 'treasury') {
            throw businessError(400, { error: 'invalid_transfer', message: 'El saldo inicial solo se carga en Caja 2.' });
        }
        // ADR-016: only the administrator loads the opening balance.
        if (payload.from === 'initial' && actor?.role !== 'admin') {
            throw businessError(403, { error: 'forbidden', message: 'Solo el administrador puede cargar el saldo inicial de Caja 2.' });
        }
        if (charges.length > 0 && payload.from !== 'bank' && payload.to !== 'bank') {
            throw businessError(400, { error: 'invalid_charge', message: 'Los débitos bancarios solo acompañan un movimiento del banco.' });
        }
        if (!(amount > 0)) {
            throw businessError(400, { error: 'invalid_amount', message: 'El monto debe ser mayor a cero.' });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const { replay } = await claimIdempotentRequest(connection, 'treasury_transfer', payload.idempotency_key, payload);
            if (replay) {
                await connection.commit();
                return replay;
            }

            const id = crypto.randomUUID();
            // Lock order (always Caja 2 before the drawer's shift) so crossed movements cannot deadlock.
            if (payload.from === 'treasury' || payload.to === 'treasury') await lockTreasury(connection);
            if (payload.from === 'treasury') await ensureTreasuryFunds(connection, amount);
            if (payload.from === 'drawer') {
                await recordDrawerOutflow(connection, { registerId: payload.cash_register_id || null, amount, referenceId: id, type: 'transfer_out' });
            }
            if (payload.to === 'drawer') {
                await recordDrawerInflow(connection, { registerId: payload.cash_register_id || null, amount, referenceId: id });
            }
            const notes = payload.notes ? String(payload.notes).trim().slice(0, 200) : '';
            const description = `${from.label} → ${to.label}${notes ? `: ${notes}` : ''}`;
            // The bank's own debits on this movement leave the bank too (tax on debits and
            // credits, commission): Debe each concept / Haber Banco, in the same entry.
            const charged = charges.length > 0
                ? await bankChargeLines(charges, resolveRateWith(connection))
                : { lines: [], total: 0 };
            await accountingService.createJournalEntry(connection, {
                date: new Date(),
                description,
                reference_type: 'treasury_transfer',
                reference_id: id,
                lines: [
                    { account_code: to.account, debit: amount, credit: 0, notes: description },
                    { account_code: from.account, debit: 0, credit: amount, notes: description },
                    ...charged.lines,
                    ...(charged.total > 0
                        ? [{ account_code: ACCOUNTS.BANK, debit: 0, credit: charged.total, notes: 'Débitos bancarios del movimiento' }]
                        : []),
                ],
            });
            await auditService.log({
                user_id: userId,
                action: 'TREASURY_TRANSFER',
                entity_type: 'treasury',
                entity_id: id,
                new_values: { from: payload.from, to: payload.to, amount, notes: notes || null, charges: charges.length > 0 ? charges : undefined, charges_total: charged.total || undefined },
                ip_address: ipAddress,
            }, connection);
            const response = { id, from: payload.from, to: payload.to, amount, charges_total: charged.total };
            await saveIdempotentResponse(connection, 'treasury_transfer', payload.idempotency_key, response);
            await connection.commit();
            return response;
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new TreasuryService();
