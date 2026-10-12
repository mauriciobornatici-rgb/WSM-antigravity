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

// Net unit price (4 decimals) for a final price: what gets stored when a price is set VAT-included.
export function netFromGross(grossUnitPrice, vatRatePercent = 21) {
    const rate = vatRatePercent == null || vatRatePercent === '' ? 21 : Number(vatRatePercent);
    return Math.round((Number(grossUnitPrice || 0) / (1 + rate / 100)) * 10000) / 10000;
}
