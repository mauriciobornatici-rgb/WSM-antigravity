import { CLIENT_TAX_CONDITIONS } from "@wsm/common"

export const TAX_CONDITION_OPTIONS = CLIENT_TAX_CONDITIONS.map(({ id, name }) => ({ value: id, label: name }))

/** Select value for "not loaded": Radix Select does not accept an empty string. */
export const NO_TAX_CONDITION = "none"

export function taxConditionName(id?: string | null): string | null {
    if (!id) return null
    return CLIENT_TAX_CONDITIONS.find((condition) => condition.id === id)?.name ?? null
}

/**
 * A Responsable Inscripto is invoiced with an A, which needs the CUIT (same rule as the
 * server schema). Returns the message to show, or null when it is fine.
 */
export function taxConditionCuitError(taxConditionId?: string | null, taxId?: string | null): string | null {
    if (taxConditionId !== "tc_RespInscripto" || String(taxId || "").replace(/\D/g, "").length === 11) return null
    return "Un Responsable Inscripto necesita el CUIT (11 dígitos)."
}

/**
 * ADR-021/022: the invoice letter ARCA expects for the customer (RG 5616). A Responsable
 * Inscripto gets an A; everyone else a B, a Monotributista included (Argentine rule). Null
 * when the condition was never loaded, or when the company issues C (monotributo) and the
 * letter does not depend on the customer.
 */
export function suggestedInvoiceLetter(
    taxConditionId?: string | null,
    companyIvaCondition?: string | null,
): "A" | "B" | null {
    if (!taxConditionId) return null
    if (String(companyIvaCondition || "").toLowerCase().includes("monotribut")) return null
    return taxConditionId === "tc_RespInscripto" ? "A" : "B"
}
