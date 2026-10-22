import { businessError } from '../../utils/businessError.js';
import { vatCreditAccount } from '../../utils/vatAccounts.js';

/**
 * The amounts of a purchase document (a supplier invoice or credit note), validated: its net, VAT,
 * perceptions and total, and its lines per VAT rate (ADR-017: one line per rate) when it has them.
 */
export function purchaseDocumentAmounts(data) {
    const { net_amount, vat_amount, other_taxes, total_amount } = data;
    const vatLines = Array.isArray(data.vat_lines) && data.vat_lines.length > 0
        ? data.vat_lines.map((line) => ({
            vat_rate: Number(line.vat_rate),
            net: Math.round(Number(line.net_amount || 0) * 100) / 100,
            vat: Math.round(Number(line.vat_amount || 0) * 100) / 100,
        }))
        : null;
    const net = vatLines
        ? vatLines.reduce((sum, line) => sum + Math.round(line.net * 100), 0) / 100
        : Math.round(Number(net_amount || 0) * 100) / 100;
    const vat = vatLines
        ? vatLines.reduce((sum, line) => sum + Math.round(line.vat * 100), 0) / 100
        : Math.round(Number(vat_amount || 0) * 100) / 100;
    if (vatLines && vatLines.some((line) => line.vat > 0 && line.vat_rate === 0)) {
        throw businessError(400, { error: 'invalid_vat_rate', message: 'Una línea con IVA no puede tener alícuota 0 %.' });
    }
    // AUD-006: each line's VAT must match its rate (a few cents of rounding per item are
    // allowed), and the header amounts, when sent, must be the sums of the lines.
    for (const line of vatLines || []) {
        const expected = line.net * line.vat_rate / 100;
        if (line.vat_rate > 0 && Math.abs(line.vat - expected) > Math.max(0.05, line.net * 0.001)) {
            throw businessError(400, {
                error: 'invalid_vat_line',
                message: `El IVA de la línea al ${line.vat_rate}% (${line.vat.toFixed(2)}) no corresponde a su neto (${expected.toFixed(2)}).`
            });
        }
    }
    if (vatLines && ((net_amount != null && Math.round(Number(net_amount) * 100) !== Math.round(net * 100))
        || (vat_amount != null && Math.round(Number(vat_amount) * 100) !== Math.round(vat * 100)))) {
        throw businessError(400, {
            error: 'invalid_invoice_total',
            message: 'El neto y el IVA del comprobante deben ser la suma de sus alícuotas.'
        });
    }
    if (!(net > 0)) {
        throw businessError(400, { error: 'invalid_net_amount', message: 'El neto del comprobante debe ser mayor a cero.' });
    }
    const taxes = Math.round(Number(other_taxes || 0) * 100) / 100;
    const total = Math.round(Number(total_amount || (net + vat + taxes)) * 100) / 100;
    // The total is what we owe (or are credited): it must be the sum of its parts or the entry
    // would not balance (a typed total that disagrees used to post an unbalanced purchase).
    const partsCents = Math.round(net * 100) + Math.round(vat * 100) + Math.round(taxes * 100);
    if (Math.round(total * 100) !== partsCents) {
        throw businessError(400, {
            error: 'invalid_invoice_total',
            message: `El total (${total.toFixed(2)}) no coincide con neto + IVA + percepciones (${(partsCents / 100).toFixed(2)}).`
        });
    }
    if (vat > 0 && data.vat_rate != null && Number(data.vat_rate) === 0) {
        throw businessError(400, {
            error: 'invalid_vat_rate',
            message: 'El comprobante tiene IVA: elegí su alícuota (0 % es solo para comprobantes sin IVA).'
        });
    }
    return { vatLines, net, vat, taxes, total };
}

/**
 * The fiscal credit of a document per ledger account (ADR-016): only a Factura A (or M), and its
 * notes, give it, one line per account of its rates.
 */
export function vatCreditByAccount(rateLines) {
    const creditByAccount = new Map();
    for (const line of rateLines) {
        if (!(line.vat > 0)) continue;
        const account = vatCreditAccount(line.vat_rate);
        const current = creditByAccount.get(account) || { amount: 0, rates: new Set() };
        current.amount = Math.round((current.amount + line.vat) * 100) / 100;
        current.rates.add(line.vat_rate);
        creditByAccount.set(account, current);
    }
    return creditByAccount;
}
