import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from './audit.service.js';

class AccountingService {
    _round(val) {
        const num = Number(val || 0);
        return Math.round((num + Number.EPSILON) * 100) / 100;
    }

    async getChartOfAccounts(connection = pool) {
        const [rows] = await connection.query(`
            SELECT 
                coa.code,
                coa.name,
                coa.type,
                coa.active,
                COALESCE(SUM(jel.debit), 0) AS total_debit,
                COALESCE(SUM(jel.credit), 0) AS total_credit,
                CASE 
                    WHEN coa.type IN ('asset', 'expense') THEN COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)
                    ELSE COALESCE(SUM(jel.credit), 0) - COALESCE(SUM(jel.debit), 0)
                END AS balance
            FROM chart_of_accounts coa
            LEFT JOIN journal_entry_lines jel ON coa.code = jel.account_code
            GROUP BY coa.code, coa.name, coa.type, coa.active
            ORDER BY coa.code ASC
        `);
        return rows.map(r => ({
            code: r.code,
            name: r.name,
            type: r.type,
            active: Boolean(r.active),
            total_debit: this._round(r.total_debit),
            total_credit: this._round(r.total_credit),
            balance: this._round(r.balance)
        }));
    }

    async createJournalEntry(connection, entryData) {
        const { date, description, reference_type, reference_id, lines } = entryData;

        if (!description || String(description).trim().length === 0) {
            throw new Error('La descripción del asiento contable es obligatoria.');
        }

        if (!Array.isArray(lines) || lines.length < 2) {
            throw new Error('Un asiento contable debe tener al menos dos partidas (debe y haber).');
        }

        let totalDebit = 0;
        let totalCredit = 0;

        for (const line of lines) {
            const deb = this._round(line.debit || 0);
            const cred = this._round(line.credit || 0);
            
            if (deb < 0 || cred < 0) {
                throw new Error('Los montos del Debe y el Haber no pueden ser negativos.');
            }
            if (deb > 0 && cred > 0) {
                throw new Error('Una sola línea contable no puede tener débito y crédito simultáneos.');
            }
            if (deb === 0 && cred === 0) {
                throw new Error('Cada partida debe tener un importe mayor a cero.');
            }

            totalDebit = this._round(totalDebit + deb);
            totalCredit = this._round(totalCredit + cred);
        }

        const difference = Math.abs(totalDebit - totalCredit);
        if (difference > 0.0101) {
            throw new Error(`Error de partida doble. Las sumas no coinciden. Suma Debe: $${totalDebit}, Suma Haber: $${totalCredit} (Diferencia: $${this._round(difference)})`);
        }

        const entryId = crypto.randomUUID();
        const entryDate = date ? new Date(date) : new Date();

        await connection.query(`
            INSERT INTO journal_entries (id, date, description, reference_type, reference_id)
            VALUES (?, ?, ?, ?, ?)
        `, [
            entryId,
            entryDate,
            description.trim(),
            reference_type || null,
            reference_id || null
        ]);

        for (const line of lines) {
            const deb = this._round(line.debit || 0);
            const cred = this._round(line.credit || 0);

            await connection.query(`
                INSERT INTO journal_entry_lines (id, journal_entry_id, account_code, debit, credit, notes)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                crypto.randomUUID(),
                entryId,
                line.account_code,
                deb,
                cred,
                line.notes || null
            ]);
        }

        return entryId;
    }

    async getJournalEntries(filters = {}, connection = pool) {
        let query = `
            SELECT je.*
            FROM journal_entries je
            WHERE 1=1
        `;
        const params = [];

        if (filters.start_date) {
            query += ' AND DATE(je.date) >= DATE(?)';
            params.push(filters.start_date);
        }
        if (filters.end_date) {
            query += ' AND DATE(je.date) <= DATE(?)';
            params.push(filters.end_date);
        }
        if (filters.reference_type) {
            query += ' AND je.reference_type = ?';
            params.push(filters.reference_type);
        }
        if (filters.reference_id) {
            query += ' AND je.reference_id = ?';
            params.push(filters.reference_id);
        }

        query += ' ORDER BY je.date DESC, je.entry_number DESC';

        const [entries] = await connection.query(query, params);
        if (entries.length === 0) return [];

        const entryIds = entries.map(e => e.id);
        const [lines] = await connection.query(`
            SELECT jel.*, coa.name AS account_name, coa.type AS account_type
            FROM journal_entry_lines jel
            JOIN chart_of_accounts coa ON jel.account_code = coa.code
            WHERE jel.journal_entry_id IN (?)
            ORDER BY jel.created_at ASC
        `, [entryIds]);

        const linesMap = {};
        for (const line of lines) {
            if (!linesMap[line.journal_entry_id]) {
                linesMap[line.journal_entry_id] = [];
            }
            linesMap[line.journal_entry_id].push({
                id: line.id,
                account_code: line.account_code,
                account_name: line.account_name,
                account_type: line.account_type,
                debit: this._round(line.debit),
                credit: this._round(line.credit),
                notes: line.notes
            });
        }

        return entries.map(e => ({
            id: e.id,
            entry_number: e.entry_number,
            date: e.date,
            description: e.description,
            reference_type: e.reference_type,
            reference_id: e.reference_id,
            created_at: e.created_at,
            lines: linesMap[e.id] || []
        }));
    }

    async getTrialBalance(filters = {}, connection = pool) {
        const { start_date, end_date } = filters;
        
        // 1. Get initial balances before start_date
        let initialBalMap = {};
        if (start_date) {
            const [initialRows] = await connection.query(`
                SELECT 
                    account_code,
                    SUM(debit) AS initial_debit,
                    SUM(credit) AS initial_credit
                FROM journal_entry_lines jel
                JOIN journal_entries je ON jel.journal_entry_id = je.id
                WHERE DATE(je.date) < DATE(?)
                GROUP BY account_code
            `, [start_date]);

            for (const r of initialRows) {
                initialBalMap[r.account_code] = {
                    debit: this._round(r.initial_debit),
                    credit: this._round(r.initial_credit)
                };
            }
        }

        // 2. Get period movements
        let periodQuery = `
            SELECT 
                jel.account_code,
                SUM(jel.debit) AS period_debit,
                SUM(jel.credit) AS period_credit
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE 1=1
        `;
        const periodParams = [];

        if (start_date) {
            periodQuery += ' AND DATE(je.date) >= DATE(?)';
            periodParams.push(start_date);
        }
        if (end_date) {
            periodQuery += ' AND DATE(je.date) <= DATE(?)';
            periodParams.push(end_date);
        }

        periodQuery += ' GROUP BY jel.account_code';
        const [periodRows] = await connection.query(periodQuery, periodParams);
        const periodMap = {};
        for (const r of periodRows) {
            periodMap[r.account_code] = {
                debit: this._round(r.period_debit),
                credit: this._round(r.period_credit)
            };
        }

        // 3. Fetch all accounts from chart of accounts
        const [accounts] = await connection.query(`
            SELECT code, name, type FROM chart_of_accounts ORDER BY code ASC
        `);

        return accounts.map(acc => {
            const initial = initialBalMap[acc.code] || { debit: 0, credit: 0 };
            const period = periodMap[acc.code] || { debit: 0, credit: 0 };

            const totalDebit = this._round(initial.debit + period.debit);
            const totalCredit = this._round(initial.credit + period.credit);

            let initialBalance = 0;
            let finalBalance = 0;

            if (acc.type === 'asset' || acc.type === 'expense') {
                initialBalance = this._round(initial.debit - initial.credit);
                finalBalance = this._round(totalDebit - totalCredit);
            } else {
                initialBalance = this._round(initial.credit - initial.debit);
                finalBalance = this._round(totalCredit - totalDebit);
            }

            return {
                code: acc.code,
                name: acc.name,
                type: acc.type,
                initial_balance: initialBalance,
                debit: period.debit,
                credit: period.credit,
                final_balance: finalBalance
            };
        });
    }

    async getIncomeStatement(filters = {}, connection = pool) {
        const { start_date, end_date } = filters;

        let query = `
            SELECT 
                jel.account_code,
                coa.name AS account_name,
                coa.type AS account_type,
                SUM(jel.debit) AS total_debit,
                SUM(jel.credit) AS total_credit
            FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            JOIN chart_of_accounts coa ON jel.account_code = coa.code
            WHERE coa.type IN ('revenue', 'expense')
        `;
        const params = [];

        if (start_date) {
            query += ' AND DATE(je.date) >= DATE(?)';
            params.push(start_date);
        }
        if (end_date) {
            query += ' AND DATE(je.date) <= DATE(?)';
            params.push(end_date);
        }

        query += ' GROUP BY jel.account_code, coa.name, coa.type';
        const [rows] = await connection.query(query, params);

        const revenueItems = [];
        const expenseItems = [];
        let totalRevenue = 0;
        let totalExpense = 0;

        for (const r of rows) {
            const deb = this._round(r.total_debit);
            const cred = this._round(r.total_credit);
            
            if (r.account_type === 'revenue') {
                const balance = this._round(cred - deb);
                totalRevenue = this._round(totalRevenue + balance);
                revenueItems.push({
                    code: r.account_code,
                    name: r.account_name,
                    balance
                });
            } else {
                const balance = this._round(deb - cred);
                totalExpense = this._round(totalExpense + balance);
                expenseItems.push({
                    code: r.account_code,
                    name: r.account_name,
                    balance
                });
            }
        }

        const netResult = this._round(totalRevenue - totalExpense);

        return {
            revenues: revenueItems,
            expenses: expenseItems,
            total_revenues: totalRevenue,
            total_expenses: totalExpense,
            net_result: netResult
        };
    }

    async createManualEntry(payload, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const entryId = await this.createJournalEntry(connection, {
                date: payload.date,
                description: payload.description,
                reference_type: 'manual',
                reference_id: null,
                lines: payload.lines
            });

            await auditService.log({
                user_id: userId,
                action: 'CREATE_MANUAL_JOURNAL_ENTRY',
                entity_type: 'journal_entry',
                entity_id: entryId,
                new_values: payload
            });

            await connection.commit();
            return { success: true, id: entryId };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async createAccount(payload, userId) {
        const { code, name, type, active = true } = payload;
        const [existing] = await pool.query('SELECT code FROM chart_of_accounts WHERE code = ?', [code]);
        if (existing.length > 0) throw new Error('Ya existe una cuenta con este código');

        await pool.query('INSERT INTO chart_of_accounts (code, name, type, active) VALUES (?, ?, ?, ?)', [code, name, type, active]);
        
        await auditService.log({
            user_id: userId,
            action: 'CREATE_ACCOUNT',
            entity_type: 'account',
            entity_id: code,
            new_values: { code, name, type, active }
        });
        return { success: true, code };
    }

    async updateAccount(code, payload, userId) {
        const { name, active } = payload;
        await pool.query('UPDATE chart_of_accounts SET name = ?, active = ? WHERE code = ?', [name, active, code]);
        
        await auditService.log({
            user_id: userId,
            action: 'UPDATE_ACCOUNT',
            entity_type: 'account',
            entity_id: code,
            new_values: { name, active }
        });
        return { success: true };
    }

    async deleteAccount(code, userId) {
        const [lines] = await pool.query('SELECT id FROM journal_entry_lines WHERE account_code = ? LIMIT 1', [code]);
        if (lines.length > 0) throw new Error('No se puede eliminar la cuenta porque ya tiene movimientos contables');

        await pool.query('DELETE FROM chart_of_accounts WHERE code = ?', [code]);
        
        await auditService.log({
            user_id: userId,
            action: 'DELETE_ACCOUNT',
            entity_type: 'account',
            entity_id: code,
            new_values: null
        });
        return { success: true };
    }

    async deleteJournalEntry(id, userId) {
        // Absolute power
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('DELETE FROM journal_entries WHERE id = ?', [id]);
            
            await auditService.log({
                user_id: userId,
                action: 'DELETE_JOURNAL_ENTRY',
                entity_type: 'journal_entry',
                entity_id: id,
                new_values: null
            });
            await connection.commit();
            return { success: true };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async reverseJournalEntry(id, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const [entries] = await connection.query('SELECT * FROM journal_entries WHERE id = ?', [id]);
            if (entries.length === 0) throw new Error('Asiento no encontrado');
            const originalEntry = entries[0];

            const [lines] = await connection.query('SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?', [id]);
            
            // Create reversed lines
            const reversedLines = lines.map(l => ({
                account_code: l.account_code,
                debit: Number(l.credit || 0),
                credit: Number(l.debit || 0),
                notes: `Reversión de asiento ${originalEntry.entry_number}`
            }));

            const reverseId = await this.createJournalEntry(connection, {
                date: new Date(),
                description: `Anulación de Asiento #${originalEntry.entry_number}: ${originalEntry.description}`,
                reference_type: 'reversal',
                reference_id: id,
                lines: reversedLines
            });

            await auditService.log({
                user_id: userId,
                action: 'REVERSE_JOURNAL_ENTRY',
                entity_type: 'journal_entry',
                entity_id: reverseId,
                new_values: { original_id: id }
            });

            await connection.commit();
            return { success: true, id: reverseId };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async updateJournalEntry(id, payload, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const { date, description, lines } = payload;
            
            let totalDebit = 0, totalCredit = 0;
            for (const line of lines) {
                const deb = this._round(line.debit || 0);
                const cred = this._round(line.credit || 0);
                if (deb < 0 || cred < 0) throw new Error('Los montos no pueden ser negativos.');
                if (deb > 0 && cred > 0) throw new Error('Una línea no puede tener débito y crédito simultáneos.');
                if (deb === 0 && cred === 0) throw new Error('Cada partida debe tener un importe mayor a cero.');
                totalDebit = this._round(totalDebit + deb);
                totalCredit = this._round(totalCredit + cred);
            }
            if (Math.abs(totalDebit - totalCredit) > 0.0101) {
                throw new Error(`Error de partida doble.`);
            }

            await connection.query('UPDATE journal_entries SET date = ?, description = ? WHERE id = ?', [date, description, id]);
            await connection.query('DELETE FROM journal_entry_lines WHERE journal_entry_id = ?', [id]);

            for (const line of lines) {
                const deb = this._round(line.debit || 0);
                const cred = this._round(line.credit || 0);
                await connection.query(`
                    INSERT INTO journal_entry_lines (id, journal_entry_id, account_code, debit, credit, notes)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [
                    crypto.randomUUID(),
                    id,
                    line.account_code,
                    deb,
                    cred,
                    line.notes || null
                ]);
            }

            await auditService.log({
                user_id: userId,
                action: 'UPDATE_JOURNAL_ENTRY',
                entity_type: 'journal_entry',
                entity_id: id,
                new_values: payload
            });

            await connection.commit();
            return { success: true };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }
}

export default new AccountingService();
