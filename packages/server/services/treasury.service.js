import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import accountingService from './accounting.service.js';
import { recordDrawerInflow, recordDrawerOutflow } from './cashShift.service.js';
import { ACCOUNTS } from '../utils/paymentAccounts.js';
import { businessError } from '../utils/businessError.js';
import { claimIdempotentRequest, saveIdempotentResponse } from '../utils/idempotency.js';

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

class TreasuryService {
    async getSummary() {
        const [[row]] = await pool.query(
            'SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS balance FROM journal_entry_lines WHERE account_code = ?',
            [ACCOUNTS.TREASURY_CASH]
        );
        const [movements] = await pool.query(
            `SELECT je.id, je.date, je.description, je.reference_type, jl.debit, jl.credit
             FROM journal_entry_lines jl
             JOIN journal_entries je ON je.id = jl.journal_entry_id
             WHERE jl.account_code = ?
             ORDER BY je.date DESC, je.entry_number DESC
             LIMIT 50`,
            [ACCOUNTS.TREASURY_CASH]
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

    // Moves cash between Caja (open shift), Caja 2 and the bank, or opens Caja 2 (ADR-015).
    async transfer(payload, userId = null, ipAddress = null) {
        const from = FUNDS[payload.from];
        const to = FUNDS[payload.to];
        const amount = roundMoney(payload.amount);
        if (!from || !to || payload.from === payload.to || payload.to === 'initial') {
            throw businessError(400, { error: 'invalid_transfer', message: 'Origen y destino deben ser distintos (Caja, Caja 2 o Banco).' });
        }
        if (payload.from === 'initial' && payload.to !== 'treasury') {
            throw businessError(400, { error: 'invalid_transfer', message: 'El saldo inicial solo se carga en Caja 2.' });
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
            await accountingService.createJournalEntry(connection, {
                date: new Date(),
                description,
                reference_type: 'treasury_transfer',
                reference_id: id,
                lines: [
                    { account_code: to.account, debit: amount, credit: 0, notes: description },
                    { account_code: from.account, debit: 0, credit: amount, notes: description },
                ],
            });
            await auditService.log({
                user_id: userId,
                action: 'TREASURY_TRANSFER',
                entity_type: 'treasury',
                entity_id: id,
                new_values: { from: payload.from, to: payload.to, amount, notes: notes || null },
                ip_address: ipAddress,
            }, connection);
            const response = { id, from: payload.from, to: payload.to, amount };
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
