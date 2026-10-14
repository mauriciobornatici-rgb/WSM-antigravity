// VAT ledger accounts by rate (ADR-016): the VAT books are kept per rate, as ARCA reports them.
export const ARCA_VAT_RATES = Object.freeze([0, 2.5, 5, 10.5, 21, 27]);

const CREDIT_BY_RATE = new Map([[2.5, '1.1.05.06'], [5, '1.1.05.05'], [10.5, '1.1.05.01'], [21, '1.1.05.02'], [27, '1.1.05.03']]);
const DEBIT_BY_RATE = new Map([[2.5, '2.1.02.05'], [5, '2.1.02.04'], [10.5, '2.1.02.01'], [21, '2.1.02.02'], [27, '2.1.02.03']]);

const normalizeRate = (rate) => (rate == null || rate === '' ? 21 : Number(rate));

export function isArcaVatRate(rate) {
    return ARCA_VAT_RATES.includes(Number(rate));
}

// Input VAT (fiscal credit) account for a rate. Unknown rates fall back to 21 %.
export function vatCreditAccount(rate) {
    return CREDIT_BY_RATE.get(normalizeRate(rate)) || CREDIT_BY_RATE.get(21);
}

// Output VAT (fiscal debit) account for a rate. Unknown rates fall back to 21 %.
export function vatDebitAccount(rate) {
    return DEBIT_BY_RATE.get(normalizeRate(rate)) || DEBIT_BY_RATE.get(21);
}

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

/**
 * Splits a VAT amount over rates in proportion to the gross of each rate. byRate is a list of
 * { vat_rate, gross, vat }. In cents, so the parts add up to the total exactly. The remainder
 * goes to the largest line, so no part turns negative.
 */
export function splitByRate(byRate, amount) {
    const rows = byRate.filter((row) => Number(row.gross) > 0).sort((a, b) => Number(a.gross) - Number(b.gross));
    const totalGross = rows.reduce((sum, row) => sum + Number(row.gross), 0);
    const cents = Math.round(Number(amount || 0) * 100);
    if (rows.length === 0 || totalGross <= 0) return [{ vat_rate: 21, gross: cents / 100, vat: round2(cents / 100 - cents / 100 / 1.21) }];
    let assigned = 0;
    return rows.map((row, index) => {
        const lineCents = index === rows.length - 1 ? cents - assigned : Math.round(cents * Number(row.gross) / totalGross);
        assigned += lineCents;
        const vatShare = Number(row.vat || 0) / Number(row.gross);
        return { vat_rate: Number(row.vat_rate), gross: lineCents / 100, vat: Math.round(lineCents * vatShare) / 100 };
    });
}

/**
 * Ledger lines for the output VAT of a sale (credit) or its reversal (debit), one per rate.
 * A type C voucher (monotributo) has no output VAT: nothing is posted.
 */
export function outputVatLines(byRate, { side, voucherType, notes }) {
    if (String(voucherType || '').toUpperCase() === 'C') return [];
    const totals = new Map();
    for (const row of byRate) {
        const vat = round2(row.vat);
        if (vat === 0) continue;
        const account = vatDebitAccount(row.vat_rate);
        totals.set(account, round2((totals.get(account) || 0) + vat));
    }
    return [...totals.entries()]
        .filter(([, amount]) => amount > 0)
        .map(([account_code, amount]) => ({
            account_code,
            debit: side === 'debit' ? amount : 0,
            credit: side === 'credit' ? amount : 0,
            notes,
        }));
}
