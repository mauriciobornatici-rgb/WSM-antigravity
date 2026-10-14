/**
 * Prices are stored net (ADR-008) and shown VAT-included (ADR-015): every price or cost a
 * person sees is the final one. Same formulas as the server (packages/server/utils/vatMath.js)
 * so what the screen shows is exactly what gets charged.
 */
export const DEFAULT_VAT_RATE = 21

/** VAT rates the server accepts (21 % first: the default; the others are for exceptions). */
export const VAT_RATE_OPTIONS = [21, 10.5, 27, 5, 2.5, 0] as const

/** "10,5 %" style label for a VAT rate. */
export function formatVatRate(rate: number): string {
    return `${String(rate).replace(".", ",")} %`
}

const roundCents =(value: number) => Math.round((value + Number.EPSILON) * 100) / 100

type VatInput = number | string | null | undefined

export function vatRateOf(rate: VatInput): number {
    if (rate === null || rate === undefined || rate === "") return DEFAULT_VAT_RATE
    const parsed = Number(rate)
    return Number.isFinite(parsed) ? parsed : DEFAULT_VAT_RATE
}

/** Final (VAT-included) unit price for a net price, rounded to cents. */
export function grossPrice(net: VatInput, rate?: VatInput): number {
    return roundCents(Number(net || 0) * (1 + vatRateOf(rate) / 100))
}

/** Net price (4 decimals, as stored) for a final price typed by the user. */
export function netFromGross(gross: VatInput, rate?: VatInput): number {
    return Math.round((Number(gross || 0) / (1 + vatRateOf(rate) / 100)) * 10000) / 10000
}

/**
 * Net price to send for a final price typed in a form. A final price left untouched (equal to the
 * gross of the stored net) keeps the stored net, so merely saving never drifts a price by rounding.
 */
export function netForTypedFinalPrice(typedFinal: VatInput, storedNet: VatInput, rate?: VatInput): number {
    if (storedNet !== null && storedNet !== undefined && Number(typedFinal) === grossPrice(storedNet, rate)) {
        return Number(storedNet)
    }
    return netFromGross(typedFinal, rate)
}

/** Line amounts: VAT-included total first (quantity × final price), VAT = gross − net. */
export function lineAmounts(quantity: VatInput, netUnit: VatInput, rate?: VatInput) {
    const qty = Number(quantity || 0)
    const unit = Number(netUnit || 0)
    const net = roundCents(qty * unit)
    const gross = roundCents(qty * unit * (1 + vatRateOf(rate) / 100))
    return { net, vat: roundCents(gross - net), gross }
}

/** VAT-included line total, the amount shown next to a cart, order or purchase line. */
export function grossLineTotal(quantity: VatInput, netUnit: VatInput, rate?: VatInput): number {
    return lineAmounts(quantity, netUnit, rate).gross
}
