// Line amounts from a net unit price (ADR-015). The VAT-included line total is computed
// first, so what is charged is exactly quantity × the final price shown to the customer;
// net and VAT are then its two parts (VAT = gross − net).
const roundCents = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function lineAmounts(quantity, netUnitPrice, vatRatePercent = 21) {
    const qty = Number(quantity || 0);
    const unit = Number(netUnitPrice || 0);
    const rate = vatRatePercent == null || vatRatePercent === '' ? 21 : Number(vatRatePercent);
    const net = roundCents(qty * unit);
    const gross = roundCents(qty * unit * (1 + rate / 100));
    return { net, vat: roundCents(gross - net), gross };
}

// A line set by its final amount (shipping, discount, surcharge, ADR-016): the amount is
// exact and split into net and VAT. Negative for a discount. One formula for the invoice and
// for the returns that reverse it.
export function grossLineAmounts(grossAmount, vatRatePercent = 21) {
    const rate = vatRatePercent == null || vatRatePercent === '' ? 21 : Number(vatRatePercent);
    const gross = roundCents(grossAmount);
    const net = roundCents(gross / (1 + rate / 100));
    return { net, vat: roundCents(gross - net), gross };
}

// Splits totalCents over weights in proportion, by the largest remainder: the parts add up
// to totalCents exactly. Works with a negative total (a discount).
export function allocateCents(totalCents, weights) {
    const sum = weights.reduce((acc, weight) => acc + Math.max(0, Number(weight) || 0), 0);
    if (weights.length === 0) return [];
    if (sum <= 0) return weights.map((_, index) => (index === weights.length - 1 ? totalCents : 0));
    const sign = totalCents < 0 ? -1 : 1;
    const magnitude = Math.abs(totalCents);
    const exact = weights.map((weight) => magnitude * Math.max(0, Number(weight) || 0) / sum);
    const parts = exact.map(Math.floor);
    let left = magnitude - parts.reduce((acc, part) => acc + part, 0);
    const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) }))
        .sort((a, b) => b.rest - a.rest || a.index - b.index);
    for (const { index } of order) {
        if (left <= 0) break;
        parts[index] += 1;
        left -= 1;
    }
    return parts.map((part) => sign * part);
}

// Net unit price (4 decimals) for a final price: what gets stored when a price is set VAT-included.
export function netFromGross(grossUnitPrice, vatRatePercent = 21) {
    const rate = vatRatePercent == null || vatRatePercent === '' ? 21 : Number(vatRatePercent);
    return Math.round((Number(grossUnitPrice || 0) / (1 + rate / 100)) * 10000) / 10000;
}
