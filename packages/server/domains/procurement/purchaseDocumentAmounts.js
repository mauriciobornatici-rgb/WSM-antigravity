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
    // AUD-018: with a single rate, its VAT is checked like a line's (a VAT unrelated to the net
    // would post, or reverse, an arbitrary fiscal credit). A VAT of 0 is a document without it.
    const singleRate = !vatLines && data.vat_rate != null && data.vat_rate !== '' ? Number(data.vat_rate) : null;
    if (singleRate > 0 && vat > 0) {
        const expected = net * singleRate / 100;
        if (Math.abs(vat - expected) > Math.max(0.05, net * 0.001)) {
            throw businessError(400, {
                error: 'invalid_vat_line',
                message: `El IVA (${vat.toFixed(2)}) no corresponde al ${singleRate}% del neto (${expected.toFixed(2)}).`
            });
        }
    }
    return { vatLines, net, vat, taxes, total };
}

/**
 * A voucher number as "point of sale-number" (0001-00000123), so the same voucher typed as
 * "1-123" is the same one. Anything else is kept as typed (trimmed).
 */
export function normalizeVoucherNumber(value) {
    const text = String(value ?? '').trim();
    const match = /^(\d{1,5})\s*-\s*(\d{1,8})$/.exec(text);
    return match ? `${match[1].padStart(4, '0')}-${match[2].padStart(8, '0')}` : text;
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
