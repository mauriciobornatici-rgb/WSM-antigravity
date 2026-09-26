// Diagnosis and reversal of defect H-purchase-duplicates (ADR-010): until
// 2026-09-25 a purchase was posted to the ledger twice — once when the goods
// reception was approved (journal_entries.reference_type='reception',
// reference_id=receptions.id) and again when the supplier invoice was
// registered (reference_type='supplier_invoice', reference_id=supplier_invoices.id).
// Both postings use the same accounts (Dr 1.1.04.01 inventario, Dr 1.1.05.02
// IVA crédito, Cr 2.1.01.01 proveedores). Since the fix, only the supplier
// invoice posts; the reception no longer creates a journal entry. This module
// only reads/reverses historical rows — it never posts new 'reception' entries.
//
// Ledger rows are immutable (DB triggers forbid UPDATE/DELETE): every
// correction is a contra-asiento created by accounting.service.js
// reverseJournalEntry(id, userId), which also refuses to reverse an entry
// twice. This module classifies which unreversed 'reception' entries are
// duplicates of a posted supplier-invoice entry, and applies the reversal by
// delegating to that same function — it never writes journal_entries itself.

export const DUPLICATE_CLASSES = Object.freeze({
    EXACT: 'exact',
    PROBABLE: 'probable',
    PENDING_INVOICE: 'pending_invoice',
});

/**
 * Reception journal entries not yet reversed, with their lines and total debit.
 * Read-only: safe inside a READ ONLY transaction.
 */
export async function findReceptionEntries(connection) {
    const [entries] = await connection.query(`
        SELECT je.id, je.entry_number, je.date, je.description,
               r.id AS reception_id, r.reception_number, r.supplier_id, r.purchase_order_id
        FROM journal_entries je
        JOIN receptions r ON r.id = je.reference_id
        WHERE je.reference_type = 'reception'
          AND NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reversal_of_entry_id = je.id)
        ORDER BY je.entry_number
    `);
    if (entries.length === 0) return [];

    const entryIds = entries.map((entry) => entry.id);
    const [lines] = await connection.query(
        `SELECT id, journal_entry_id, account_code, debit, credit, notes
         FROM journal_entry_lines WHERE journal_entry_id IN (?)
         ORDER BY journal_entry_id, id`,
        [entryIds]
    );

    return entries.map((entry) => {
        const entryLines = lines
            .filter((line) => line.journal_entry_id === entry.id)
            .map((line) => ({ ...line, debit: Number(line.debit), credit: Number(line.credit) }));
        const totalDebit = entryLines.reduce((sum, line) => sum + line.debit, 0);
        return { ...entry, lines: entryLines, total_debit: Math.round((totalDebit + Number.EPSILON) * 100) / 100 };
    });
}

/**
 * Posted (not reversed) supplier_invoice journal entries whose invoice links to
 * one of the given reception ids or purchase order ids — the candidates that
 * could make a 'reception' entry a duplicate.
 */
export async function findCandidateInvoiceEntries(connection, receptionIds, purchaseOrderIds) {
    const cleanReceptionIds = [...new Set(receptionIds.filter(Boolean))];
    const cleanPoIds = [...new Set(purchaseOrderIds.filter(Boolean))];
    if (cleanReceptionIds.length === 0 && cleanPoIds.length === 0) return [];

    const conditions = [];
    const params = [];
    if (cleanReceptionIds.length > 0) {
        conditions.push('si.reception_id IN (?)');
        params.push(cleanReceptionIds);
    }
    if (cleanPoIds.length > 0) {
        conditions.push('si.purchase_order_id IN (?)');
        params.push(cleanPoIds);
    }

    const [rows] = await connection.query(
        `SELECT si.id AS invoice_id, si.invoice_number, si.invoice_type, si.total_amount,
                si.reception_id, si.purchase_order_id,
                je.id AS invoice_entry_id, je.entry_number AS invoice_entry_number, je.date AS invoice_entry_date
         FROM supplier_invoices si
         JOIN journal_entries je ON je.reference_type = 'supplier_invoice' AND je.reference_id = si.id
         WHERE NOT EXISTS (SELECT 1 FROM journal_entries rev WHERE rev.reversal_of_entry_id = je.id)
           AND (${conditions.join(' OR ')})`,
        params
    );
    return rows.map((row) => ({ ...row, total_amount: Number(row.total_amount) }));
}

/** Swaps debit/credit on each line — the shape of the contra-asiento that reverseJournalEntry would create. */
export function proposeReversalLines(lines) {
    return lines.map((line) => ({
        account_code: line.account_code,
        debit: Number(line.credit || 0),
        credit: Number(line.debit || 0),
        notes: `Reversión propuesta de línea ${line.id}`,
    }));
}

/**
 * Classifies each unreversed reception entry against the candidate invoice
 * entries. Returns one record per reception entry with its class and the
 * matched invoices (possibly several for 'probable').
 */
export function classifyDuplicates(receptionEntries, invoiceEntries) {
    return receptionEntries.map((entry) => {
        const exactMatches = invoiceEntries.filter((inv) => inv.reception_id === entry.reception_id);
        const probableMatches = exactMatches.length === 0
            ? invoiceEntries.filter((inv) => entry.purchase_order_id != null && inv.purchase_order_id === entry.purchase_order_id)
            : [];

        let duplicateClass = DUPLICATE_CLASSES.PENDING_INVOICE;
        let matches = [];
        if (exactMatches.length > 0) {
            duplicateClass = DUPLICATE_CLASSES.EXACT;
            matches = exactMatches;
        } else if (probableMatches.length > 0) {
            duplicateClass = DUPLICATE_CLASSES.PROBABLE;
            matches = probableMatches;
        }

        return {
            entry_id: entry.id,
            entry_number: entry.entry_number,
            date: entry.date,
            description: entry.description,
            reception_id: entry.reception_id,
            reception_number: entry.reception_number,
            supplier_id: entry.supplier_id,
            purchase_order_id: entry.purchase_order_id,
            total_debit: entry.total_debit,
            lines: entry.lines,
            class: duplicateClass,
            matched_invoices: matches.map((match) => ({
                invoice_id: match.invoice_id,
                invoice_number: match.invoice_number,
                invoice_type: match.invoice_type,
                total_amount: match.total_amount,
                invoice_entry_id: match.invoice_entry_id,
                invoice_entry_number: match.invoice_entry_number,
                linked_by: match.reception_id === entry.reception_id ? 'reception_id' : 'purchase_order_id',
            })),
            proposed_reversal_lines: proposeReversalLines(entry.lines),
        };
    });
}

/** Full read-only diagnosis: fetch, match and classify. Safe inside a READ ONLY transaction. */
export async function diagnoseDuplicates(connection) {
    const receptionEntries = await findReceptionEntries(connection);
    if (receptionEntries.length === 0) return [];
    const receptionIds = receptionEntries.map((entry) => entry.reception_id);
    const purchaseOrderIds = receptionEntries.map((entry) => entry.purchase_order_id);
    const invoiceEntries = await findCandidateInvoiceEntries(connection, receptionIds, purchaseOrderIds);
    return classifyDuplicates(receptionEntries, invoiceEntries);
}

export function summarize(duplicates) {
    const byClass = Object.fromEntries(
        Object.values(DUPLICATE_CLASSES).map((key) => [key, { entries: 0, total_debit: 0 }])
    );
    for (const dup of duplicates) {
        byClass[dup.class].entries += 1;
        byClass[dup.class].total_debit = Math.round((byClass[dup.class].total_debit + dup.total_debit + Number.EPSILON) * 100) / 100;
    }
    return { duplicate_entries: duplicates.length, by_class: byClass };
}

/**
 * Applies reversals for the given duplicates via accounting.service.js
 * reverseJournalEntry — never writes journal_entries directly. Idempotent:
 * an entry already reversed (race with another run) is reported as skipped,
 * not an error. Per-entry failures are collected and the rest continue.
 *
 * @param {object} accountingService - imported service (reverseJournalEntry(id, userId))
 * @param {Array} duplicates - output of classifyDuplicates/diagnoseDuplicates
 * @param {object} options
 * @param {string[]} [options.classes] - which classes to include (default: ['exact'])
 * @param {string[]} [options.entryIds] - restrict to these journal_entries.id values
 * @param {string|null} [options.userId]
 */
export async function reverseDuplicates(accountingService, duplicates, { classes = [DUPLICATE_CLASSES.EXACT], entryIds = null, userId = null } = {}) {
    const classSet = new Set(classes);
    const entryIdSet = entryIds ? new Set(entryIds) : null;
    const targets = duplicates.filter((dup) => classSet.has(dup.class) && (!entryIdSet || entryIdSet.has(dup.entry_id)));

    const result = { targets: targets.length, reversed: [], skipped: [], errors: [] };
    for (const dup of targets) {
        try {
            const { id: reversalEntryId } = await accountingService.reverseJournalEntry(dup.entry_id, userId);
            result.reversed.push({ entry_id: dup.entry_id, entry_number: dup.entry_number, class: dup.class, reversal_entry_id: reversalEntryId });
        } catch (error) {
            if (error.statusCode === 409) {
                result.skipped.push({ entry_id: dup.entry_id, entry_number: dup.entry_number, class: dup.class, reason: error.message });
            } else {
                result.errors.push({ entry_id: dup.entry_id, entry_number: dup.entry_number, class: dup.class, error: error.message });
            }
        }
    }
    return result;
}
