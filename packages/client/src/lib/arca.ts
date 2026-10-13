import { toast } from "sonner"
import { isApiError } from "@/services/httpClient"
import { showErrorToast } from "@/lib/errorHandling"

export const ARCA_VERIFYING_LABEL = "En verificación con ARCA"
export const ARCA_VERIFYING_HELP = "ARCA no confirmó todavía; se verifica sola cada 2 minutos"
export const ARCA_UNAVAILABLE_MESSAGE = "ARCA no responde: el comprobante queda en verificación y se resuelve solo."

/** A voucher ARCA issued with a number another local document holds: a person must review it. */
export const ARCA_CONFLICT_LABEL = "Conflicto con ARCA: revisar"

/** The request to ARCA is in flight or being checked because ARCA did not answer (ADR-020). */
export function isArcaAuthorizing(status?: string | null): boolean {
    return status === "authorizing"
}

/** Label of the authorize button: while verifying it re-asks the same endpoint. */
export function arcaAuthorizeButtonLabel(status?: string | null, fallback = "Autorizar con ARCA"): string {
    return isArcaAuthorizing(status) ? "Verificar ahora" : fallback
}

/** "PPPP-NNNNNNNN": point of sale with 4 digits, voucher number with 8. */
export function formatFiscalNumber(pointOfSale: number | null | undefined, voucherNumber: number | string): string {
    return `${String(pointOfSale || 1).padStart(4, "0")}-${String(voucherNumber).padStart(8, "0")}`
}

/** Fiscal number of a credit note, or null while ARCA has not assigned one (then the internal number is shown). */
export function creditNoteFiscalNumber(cn: {
    point_of_sale?: number | null | undefined
    arca_voucher_number?: number | null | undefined
}): string | null {
    return cn.arca_voucher_number ? formatFiscalNumber(cn.point_of_sale, cn.arca_voucher_number) : null
}

/** Error text of the last ARCA attempt, only for documents that are not authorized yet. */
export function arcaLastErrorText(doc: { status?: string | null | undefined; arca_last_error?: unknown }): string | null {
    if (doc.status === "authorized") return null
    const text = doc.arca_last_error
    return typeof text === "string" && text.trim().length > 0 ? text : null
}

/**
 * Reports a failed authorize call. Only "arca_unavailable" (the voucher stays in verification and the server
 * settles it) and "arca_verifying" (still within the waiting time) are informative; anything else, including
 * "arca_unreachable" (nothing was asked, retry), is an error toast with the server's message.
 */
export function reportArcaAuthorizeError(title: string, error: unknown): void {
    const body = isApiError(error) && typeof error.body === "object" && error.body !== null
        ? (error.body as Record<string, unknown>)
        : null
    if (body?.error === "arca_unavailable") {
        toast.info(ARCA_UNAVAILABLE_MESSAGE)
        return
    }
    if (body?.error === "arca_verifying") {
        toast.info(typeof body.message === "string" ? body.message : ARCA_UNAVAILABLE_MESSAGE)
        return
    }
    showErrorToast(title, error)
}
