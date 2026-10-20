import crypto from 'crypto';
import pool from '../config/db.js';
import auditService from './audit.service.js';
import { outputVatLines } from '../utils/vatAccounts.js';
import { ACCOUNTS } from '../utils/paymentAccounts.js';

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

    // Posts an entry dropping zero lines; does nothing when every line is zero.
    async createJournalEntryIfAny(connection, entryData) {
        const lines = (entryData.lines || [])
            .map((line) => ({ ...line, debit: this._round(line.debit || 0), credit: this._round(line.credit || 0) }))
            .filter((line) => line.debit > 0 || line.credit > 0);
        if (lines.length < 2) return null;
        return this.createJournalEntry(connection, { ...entryData, lines });
    }

    /**
     * Opening stock of a new product (ADR-017): goods the business already had enter inventory
     * at cost against an adjustment account (ADR-018), so the ledger matches the stock (ADR-013).
     */
    async postInitialStock(connection, { productId, quantity, unitCost, description }) {
        const amount = this._round(Number(quantity || 0) * Number(unitCost || 0));
        if (!(amount > 0)) return null;
        return this.createJournalEntry(connection, {
            date: new Date(),
            description: description || 'Stock inicial',
            reference_type: 'initial_stock',
            reference_id: productId,
            lines: [
                { account_code: '1.1.04.01', debit: amount, credit: 0, notes: 'Mercadería existente al alta' },
                { account_code: '3.1.03.01', debit: 0, credit: amount, notes: 'Ajuste por inventario inicial' }
            ]
        });
    }

    async createJournalEntry(connection, entryData) {
        const { date, description, reference_type, reference_id, reversal_of_entry_id, lines } = entryData;

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

        // Double entry to the cent (integers, no float tolerance): a one-cent tolerance let
        // unbalanced entries in.
        const difference = Math.abs(totalDebit - totalCredit);
        if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
            throw new Error(`Error de partida doble. Las sumas no coinciden. Suma Debe: $${totalDebit}, Suma Haber: $${totalCredit} (Diferencia: $${this._round(difference)})`);
        }

        const entryId = crypto.randomUUID();
        const entryDate = date ? new Date(date) : new Date();

        await connection.query(`
            INSERT INTO journal_entries (id, date, description, reference_type, reference_id, reversal_of_entry_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            entryId,
            entryDate,
            description.trim(),
            reference_type || null,
            reference_id || null,
            reversal_of_entry_id || null
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

    // includeCost: false when the caller posts the cost itself (ADR-022 reissue copies it).
    async postInvoiceAccountingEntries(connection, invoiceId, { includeCost = true } = {}) {
        const [invoiceRows] = await connection.query('SELECT * FROM invoices WHERE id = ? FOR UPDATE', [invoiceId]);
        if (invoiceRows.length === 0) throw new Error('Invoice not found');
        const invoice = invoiceRows[0];
        const invoiceLabel = `${invoice.invoice_type}-${String(invoice.point_of_sale).padStart(4, '0')}-${String(invoice.invoice_number).padStart(8, '0')}`;

        const [saleRows] = await connection.query(`
            SELECT je.id
            FROM journal_entries je
            JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
            WHERE je.reference_type = 'invoice' AND je.reference_id = ? AND jel.account_code = '4.1.01.01'
            LIMIT 1
        `, [invoiceId]);
        if (saleRows.length === 0 && Number(invoice.total_amount || 0) > 0) {
            // Output VAT per rate, from the invoice lines (ADR-016). A type C invoice has no
            // output VAT (monotributo): the whole amount is revenue.
            const [byRate] = await connection.query(
                'SELECT vat_rate, SUM(total_line) AS gross, SUM(vat_amount) AS vat FROM invoice_items WHERE invoice_id = ? GROUP BY vat_rate',
                [invoiceId]
            );
            const vatRows = byRate.length > 0
                ? byRate
                : [{ vat_rate: 21, gross: invoice.total_amount, vat: invoice.vat_amount }];
            const vatLines = outputVatLines(vatRows, { side: 'credit', voucherType: invoice.invoice_type, notes: 'IVA Débito Fiscal' });
            const postedVat = vatLines.reduce((sum, line) => sum + line.credit, 0);
            const saleAmount = this._round(Number(invoice.total_amount || 0) - postedVat);
            const saleLines = [
                { account_code: '1.1.03.01', debit: Number(invoice.total_amount), credit: 0, notes: `Crédito por venta ${invoiceLabel}` },
                { account_code: '4.1.01.01', debit: 0, credit: saleAmount, notes: 'Ingreso por ventas' },
                ...vatLines
            ];
            const difference = this._round(
                saleLines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
                - saleLines.reduce((sum, line) => sum + Number(line.credit || 0), 0)
            );
            if (Math.abs(difference) > 0 && Math.abs(difference) < 0.05) {
                saleLines[1].credit = this._round(Number(saleLines[1].credit) + difference);
            }
            await this.createJournalEntry(connection, {
                date: invoice.issue_date,
                description: `Asiento de Venta - Factura ${invoiceLabel}`,
                reference_type: 'invoice',
                reference_id: invoiceId,
                lines: saleLines
            });
        }

        const [cmvRows] = await connection.query(`
            SELECT je.id
            FROM journal_entries je
            JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
            WHERE je.reference_type = 'invoice' AND je.reference_id = ? AND jel.account_code = '5.1.01.01'
            LIMIT 1
        `, [invoiceId]);
        if (includeCost && invoice.order_id && cmvRows.length === 0) {
            // ADR-027 (D8): the cost of goods sold is posted when the goods leave, with the entry
            // linked to their movements. The invoice only covers what its order took out of stock
            // without one (recorded before that rule), at the cost the movement carries: the same
            // cost a return reverses. A manual invoice without an order moved no goods (D9).
            const [movements] = await connection.query(
                `SELECT id, quantity, unit_cost
                 FROM inventory_movements
                 WHERE reference_id = ? AND type = 'sale' AND reference_type = 'order' AND journal_entry_id IS NULL
                 FOR UPDATE`,
                [invoice.order_id]
            );
            const costed = movements.filter((movement) => Number(movement.unit_cost || 0) > 0);
            const totalCents = costed.reduce(
                (sum, movement) => sum + Math.round(Number(movement.quantity || 0) * Math.round(Number(movement.unit_cost) * 100)),
                0
            );
            if (totalCents > 0) {
                const totalCmv = totalCents / 100;
                const entryId = await this.createJournalEntry(connection, {
                    date: invoice.issue_date,
                    description: `Costo de Mercadería Vendida - Factura ${invoiceLabel}`,
                    reference_type: 'invoice',
                    reference_id: invoiceId,
                    lines: [
                        { account_code: '5.1.01.01', debit: totalCmv, credit: 0, notes: 'Costo de ventas (CMV)' },
                        { account_code: '1.1.04.01', debit: 0, credit: totalCmv, notes: 'Salida de inventario' }
                    ]
                });
                await connection.query(
                    'UPDATE inventory_movements SET journal_entry_id = ? WHERE id IN (?)',
                    [entryId, costed.map((movement) => movement.id)]
                );
            }
        }
    }

    async getJournalEntries(filters = {}, connection = pool) {
        let query = `
            SELECT je.*,
                   EXISTS(
                       SELECT 1 FROM journal_entries reversal
                       WHERE reversal.reversal_of_entry_id = je.id
                   ) AS is_reversed
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

        const referenceIds = [...new Set(entries.map((entry) => entry.reference_id).filter(Boolean))];
        const relatedMap = {};
        const addRelated = (referenceId, movement) => {
            if (!referenceId) return;
            if (!relatedMap[referenceId]) relatedMap[referenceId] = [];
            relatedMap[referenceId].push(movement);
        };
        if (referenceIds.length > 0) {
            const [transactions] = await connection.query(`
                SELECT id, type, amount, description, payment_method, check_id, reference_id, date
                FROM transactions WHERE reference_id IN (?)
                ORDER BY date ASC
            `, [referenceIds]);
            for (const transaction of transactions) {
                addRelated(transaction.reference_id, {
                    id: transaction.id,
                    kind: 'transaction',
                    type: transaction.type,
                    date: transaction.date,
                    amount: this._round(transaction.amount),
                    description: transaction.description,
                    payment_method: transaction.payment_method,
                    check_id: transaction.check_id
                });
            }

            const [inventoryMovements] = await connection.query(`
                SELECT id, type, product_id, quantity, from_location, to_location, reason, reference_id, created_at
                FROM inventory_movements WHERE reference_id IN (?)
                ORDER BY created_at ASC
            `, [referenceIds]);
            for (const movement of inventoryMovements) {
                addRelated(movement.reference_id, {
                    id: movement.id,
                    kind: 'inventory',
                    type: movement.type,
                    date: movement.created_at,
                    quantity: Number(movement.quantity || 0),
                    product_id: movement.product_id,
                    from_location: movement.from_location,
                    to_location: movement.to_location,
                    description: movement.reason
                });
            }

            const [creditNotes] = await connection.query(`
                SELECT id, number, amount, status, notes, reference_id, created_at AS date
                FROM credit_notes WHERE reference_id IN (?)
                ORDER BY created_at ASC
            `, [referenceIds]);
            for (const creditNote of creditNotes) {
                addRelated(creditNote.reference_id, {
                    id: creditNote.id,
                    kind: 'credit_note',
                    type: creditNote.status,
                    date: creditNote.date,
                    amount: this._round(creditNote.amount),
                    description: `${creditNote.number} · ${creditNote.notes || 'Nota de crédito'}`
                });
            }
        }

        return entries.map(e => ({
            id: e.id,
            entry_number: e.entry_number,
            date: e.date,
            description: e.description,
            reference_type: e.reference_type,
            reference_id: e.reference_id,
            created_at: e.created_at,
            lines: linesMap[e.id] || [],
            related_movements: relatedMap[e.reference_id] || []
        }));
    }

    async getTrialBalance(filters = {}, connection = pool) {
        const { start_date, end_date } = filters;
        
        // 1. Get initial balances before start_date
        const initialBalMap = {};
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

        // Invoices from before the ledger: their revenue is shown. Their cost is not estimated at
        // today's cost any more: since ADR-027 the cost of goods sold is posted when goods leave
        // (and the valuation script posts the sales that left without it).
        let unpostedInvoiceQuery = `
            SELECT
                COALESCE(SUM(i.total_amount - COALESCE(i.vat_amount, 0)), 0) AS revenue
            FROM invoices i
            WHERE i.deleted_at IS NULL AND i.status <> 'cancelled'
              AND NOT EXISTS (
                  SELECT 1 FROM journal_entries posted
                  JOIN journal_entry_lines posted_line ON posted_line.journal_entry_id = posted.id
                  WHERE posted.reference_type = 'invoice' AND posted.reference_id = i.id
                    AND posted_line.account_code = '4.1.01.01'
              )
        `;
        const unpostedParams = [];
        if (start_date) {
            unpostedInvoiceQuery += ' AND DATE(i.issue_date) >= DATE(?)';
            unpostedParams.push(start_date);
        }
        if (end_date) {
            unpostedInvoiceQuery += ' AND DATE(i.issue_date) <= DATE(?)';
            unpostedParams.push(end_date);
        }
        const [unpostedRows] = await connection.query(unpostedInvoiceQuery, unpostedParams);
        const unpostedRevenue = this._round(unpostedRows[0]?.revenue || 0);

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

        if (unpostedRevenue !== 0) {
            const existingRevenue = revenueItems.find((item) => item.code === '4.1.01.01');
            if (existingRevenue) existingRevenue.balance = this._round(existingRevenue.balance + unpostedRevenue);
            else revenueItems.push({ code: '4.1.01.01', name: 'Ventas de Mercaderías (operaciones históricas)', balance: unpostedRevenue });
            totalRevenue = this._round(totalRevenue + unpostedRevenue);
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
            }, connection);

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

    /**
     * Counter-entries (never deletes) for the entries of a document that touch any of the given
     * accounts and were not reversed yet. Used to annul an invoice ARCA never authorized
     * (ADR-022): its sale and cost entries are reversed, its collections are kept.
     */
    async reverseDocumentEntries(connection, { referenceType, referenceId, accountCodes, description }) {
        // Locking reads (AUD-013): the entries are locked as a manual reversal locks them, and
        // "not reversed yet" is read from the current data (not the transaction's snapshot), so
        // a manual reversal at the same moment is either seen or kept waiting, never doubled.
        const [entries] = await connection.query(
            `SELECT je.id, je.entry_number, je.description
             FROM journal_entries je
             WHERE je.reference_type = ? AND je.reference_id = ?
               AND EXISTS (SELECT 1 FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id AND jel.account_code IN (?))
               AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_entry_id = je.id FOR SHARE)
             ORDER BY je.id
             FOR UPDATE`,
            [referenceType, referenceId, accountCodes]
        );
        const reversed = [];
        for (const entry of entries) {
            const [lines] = await connection.query('SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?', [entry.id]);
            reversed.push(await this.createJournalEntry(connection, {
                date: new Date(),
                description: `${description}: ${entry.description}`,
                reference_type: 'reversal',
                reference_id: entry.id,
                reversal_of_entry_id: entry.id,
                // A zero line of an old entry carries nothing to reverse.
                lines: lines.filter((line) => Number(line.debit || 0) !== 0 || Number(line.credit || 0) !== 0).map((line) => ({
                    account_code: line.account_code,
                    debit: Number(line.credit || 0),
                    credit: Number(line.debit || 0),
                    notes: `Reversión de asiento ${entry.entry_number ?? ''}`.trim(),
                })),
            }));
        }
        return reversed;
    }

    async reverseJournalEntry(id, userId) {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            
            const [entries] = await connection.query('SELECT * FROM journal_entries WHERE id = ? FOR UPDATE', [id]);
            if (entries.length === 0) {
                const error = new Error('Asiento no encontrado');
                error.statusCode = 404;
                throw error;
            }
            const originalEntry = entries[0];

            if (originalEntry.reversal_of_entry_id || originalEntry.reference_type === 'reversal') {
                const error = new Error('Un contra-asiento no puede revertirse nuevamente');
                error.statusCode = 409;
                throw error;
            }

            const [existingReversals] = await connection.query(
                'SELECT id FROM journal_entries WHERE reversal_of_entry_id = ? LIMIT 1',
                [id]
            );
            if (existingReversals.length > 0) {
                const error = new Error('El asiento ya fue revertido');
                error.statusCode = 409;
                throw error;
            }

            const [lines] = await connection.query('SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?', [id]);

            // ADR-027: Inventario and Mercadería recibida a facturar follow the stock and the delivery
            // notes. Reversing one of their entries by hand moves the ledger without moving a unit:
            // it is corrected with the operation itself (cancel, return, count). The old purchase
            // entries posted twice ('reception') are the exception: their runbook reverses them.
            const stockAccounts = [ACCOUNTS.INVENTORY, ACCOUNTS.GOODS_TO_INVOICE];
            if (originalEntry.reference_type !== 'reception') {
                const [linkedMovements] = await connection.query(
                    'SELECT id FROM inventory_movements WHERE journal_entry_id = ? LIMIT 1',
                    [id]
                );
                if (linkedMovements.length > 0 || lines.some((line) => stockAccounts.includes(line.account_code))) {
                    const error = new Error('Este asiento acompaña movimientos de stock: se corrige con la operación (anulación, devolución o conteo), no revirtiéndolo a mano.');
                    error.statusCode = 409;
                    error.errorCode = 'stock_entry_not_reversible';
                    throw error;
                }
            }

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
                reversal_of_entry_id: id,
                lines: reversedLines
            });

            await auditService.log({
                user_id: userId,
                action: 'REVERSE_JOURNAL_ENTRY',
                entity_type: 'journal_entry',
                entity_id: reverseId,
                new_values: { original_id: id }
            }, connection);

            await connection.commit();
            return { success: true, id: reverseId };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

    async getBalanceSheet(filters = {}, connection = pool) {
        // 1. Fetch Trial Balance for the period (which gives final balances)
        const trialBalance = await this.getTrialBalance(filters, connection);
        
        // 2. Fetch Income Statement for the period (to get the Net Result of the exercise)
        const incomeStatement = await this.getIncomeStatement(filters, connection);
        const netResult = this._round(incomeStatement.net_result);

        // 3. Group accounts according to RT 9 (Argentine Accounting Standards)
        const assets = { corriente: [], no_corriente: [], total: 0 };
        const liabilities = { corriente: [], no_corriente: [], total: 0 };
        const equity = { items: [], total: 0 };

        for (const acc of trialBalance) {
            const balance = this._round(acc.final_balance);
            if (balance === 0 && Number(acc.debit) === 0 && Number(acc.credit) === 0) continue; // Skip empty accounts for clean presentation

            if (acc.type === 'asset') {
                // RT 9: Corriente vs No Corriente
                // Accounts starting with '1.1' are Current Assets (Caja, Banco, Créditos por ventas, Inventarios)
                // Accounts starting with '1.2' are Non-Current Assets (Bienes de Uso)
                if (acc.code.startsWith('1.1')) {
                    assets.corriente.push({ code: acc.code, name: acc.name, balance });
                } else {
                    assets.no_corriente.push({ code: acc.code, name: acc.name, balance });
                }
                assets.total = this._round(assets.total + balance);
            } else if (acc.type === 'liability') {
                // Accounts starting with '2.1' are Current Liabilities (Proveedores, Deudas Fiscales)
                // Accounts starting with '2.2' are Non-Current Liabilities
                if (acc.code.startsWith('2.1')) {
                    liabilities.corriente.push({ code: acc.code, name: acc.name, balance });
                } else {
                    liabilities.no_corriente.push({ code: acc.code, name: acc.name, balance });
                }
                liabilities.total = this._round(liabilities.total + balance);
            } else if (acc.type === 'equity') {
                equity.items.push({ code: acc.code, name: acc.name, balance });
                equity.total = this._round(equity.total + balance);
            }
        }

        // 4. Impute the Net Profit/Loss of the exercise into Equity (RT 9 requirement)
        equity.items.push({
            code: '3.1.02.99', // Virtual code for Current Exercise profit
            name: 'Resultado del Ejercicio (Utilidad/Pérdida)',
            balance: netResult
        });
        equity.total = this._round(equity.total + netResult);

        const totalAssets = assets.total;
        const totalLiabilities = liabilities.total;
        const totalEquity = equity.total;
        const totalLiabilitiesAndEquity = this._round(totalLiabilities + totalEquity);

        // Verification equation: Activo = Pasivo + Patrimonio Neto
        const discrepancy = this._round(Math.abs(totalAssets - totalLiabilitiesAndEquity));

        return {
            assets,
            liabilities,
            equity,
            totals: {
                total_assets: totalAssets,
                total_liabilities: totalLiabilities,
                total_equity: totalEquity,
                total_liabilities_and_equity: totalLiabilitiesAndEquity,
                discrepancy
            }
        };
    }
}

export default new AccountingService();
