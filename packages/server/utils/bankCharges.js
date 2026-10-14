import { ACCOUNTS } from './paymentAccounts.js';
import { vatCreditAccount } from './vatAccounts.js';
import { businessError } from './businessError.js';

// Bank debits that can ride on a bank movement or be recorded alone (ADR-016). "vatable"
// debits are invoiced by the bank or processor with VAT: their VAT is fiscal credit at the
// rate picked (0 = not computable, it stays in the expense).
export const BANK_CHARGE_CONCEPTS = Object.freeze({
    commission: { label: 'Comisión', account: ACCOUNTS.BANK_FEES, vatable: true },
    maintenance: { label: 'Mantenimiento de cuenta', account: ACCOUNTS.BANK_FEES, vatable: true },
    debits_credits_tax: { label: 'Impuesto a los débitos y créditos', account: ACCOUNTS.BANK_TAX, vatable: false },
    withholding: { label: 'Retenciones y percepciones', account: ACCOUNTS.WITHHOLDINGS, vatable: false },
    other: { label: 'Otros gastos bancarios', account: ACCOUNTS.BANK_FEES, vatable: true },
});

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

/**
 * Ledger debit lines for a list of charges [{ concept, amount, vat_rate?, notes? }] (amount is
 * what the bank debited, VAT included). resolveRate(rate) validates the rate picked (or gives
 * the default). Returns { lines, total }: the caller credits the bank with total.
 */
export async function bankChargeLines(charges, resolveRate) {
    const lines = [];
    let totalCents = 0;
    for (const charge of charges || []) {
        const concept = BANK_CHARGE_CONCEPTS[charge.concept];
        const amount = round2(charge.amount);
        if (!concept) {
            throw businessError(400, { error: 'invalid_charge', message: `Concepto de débito bancario desconocido: ${charge.concept}.` });
        }
        if (!(amount > 0)) {
            throw businessError(400, { error: 'invalid_charge', message: 'Cada débito bancario debe ser mayor a cero.' });
        }
        totalCents += Math.round(amount * 100);
        const label = charge.notes ? `${concept.label}: ${String(charge.notes).trim().slice(0, 120)}` : concept.label;
        const rate = concept.vatable ? await resolveRate(charge.vat_rate) : 0;
        const net = round2(amount / (1 + rate / 100));
        // A charge too small to carry a whole cent of VAT stays entirely in the expense.
        if (rate > 0 && round2(amount - net) > 0) {
            lines.push({ account_code: concept.account, debit: net, credit: 0, notes: `${label} (neto)` });
            lines.push({ account_code: vatCreditAccount(rate), debit: round2(amount - net), credit: 0, notes: `IVA crédito fiscal ${rate}% - ${concept.label}` });
        } else {
            lines.push({ account_code: concept.account, debit: amount, credit: 0, notes: label });
        }
    }
    return { lines, total: totalCents / 100 };
}
