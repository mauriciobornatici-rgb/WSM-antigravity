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

type ArcaAlertDocument = {
    document_kind: "invoice" | "credit_note"
    id: string
    letter: string | null
    point_of_sale: number | null
    number: number | string | null
}

/** "Factura B 0001-00000042" / "Nota de crédito B 0001-00000007" (ADR-021 alerts). */
export function arcaAlertTitle(doc: ArcaAlertDocument): string {
    const kind = doc.document_kind === "invoice" ? "Factura" : "Nota de crédito"
    const letter = doc.letter ? ` ${String(doc.letter).replace(/^NC_/, "")}` : ""
    const number = doc.number == null || doc.number === ""
        ? ""
        : typeof doc.number === "number" || /^\d+$/.test(String(doc.number))
            ? ` ${formatFiscalNumber(doc.point_of_sale, doc.number)}`
            : ` ${doc.number}`
    return `${kind}${letter}${number}`
}

/** Where the document is reviewed: the invoice itself, or the credit notes tab. */
export function arcaAlertLink(doc: ArcaAlertDocument): string {
    return doc.document_kind === "invoice"
        ? `/invoices?invoice_id=${encodeURIComponent(doc.id)}`
        : "/returns-warranties?tab=credits"
}

/** Menu and dashboard text: "2 en conflicto · 1 sin confirmar". */
export function arcaAlertSummary(conflicts: number, stuck: number, rejected = 0, unauthorized = 0): string {
    const parts: string[] = []
    if (conflicts > 0) parts.push(`${conflicts} en conflicto`)
    if (stuck > 0) parts.push(`${stuck} sin confirmar`)
    if (rejected > 0) parts.push(`${rejected} ${rejected === 1 ? "rechazado" : "rechazados"}`)
    if (unauthorized > 0) parts.push(`${unauthorized} sin autorizar`)
    return parts.join(" · ")
}

/** Rejected by ARCA: back to pending with the reason and no CAE (AUD-009). */
export const ARCA_REJECTED_LABEL = "Rechazado por ARCA"

/** An electronic invoice still without a CAE and without any attempt after a day (ADR-022). */
export const ARCA_UNAUTHORIZED_LABEL = "Sin autorizar"

/** ADR-022: only an invoice ARCA never authorized can be annulled (with a CAE it takes a credit note). */
export function canReissueInvoice(invoice?: { cae?: string | null | undefined; status?: string | null | undefined } | null): boolean {
    return Boolean(invoice && !invoice.cae && invoice.status === "issued")
}

/**
 * ADR-022 / AUD-010: the letters an annulled document can be issued again as (same rule as the
 * server). A, B and the ticket are interchangeable; a C stays a C.
 */
export function reissueLetters(oldLetter?: string | null): Array<"A" | "B" | "C" | "TK"> {
    switch (String(oldLetter || "").toUpperCase()) {
        case "A":
        case "B":
            return ["A", "B", "TK"]
        case "TK":
            return ["TK", "A", "B"]
        case "C":
            return ["C"]
        default:
            return []
    }
}

/** ADR-022: days an invoice ARCA never authorized can be reissued (later, only an administrator). */
export const REISSUE_MAX_DAYS = 5

/** Total for the menu badge. */
export function arcaAlertCount(alerts?: { conflicts?: number; stuck?: number; rejected?: number; unauthorized?: number } | null): number {
    if (!alerts) return 0
    return (alerts.conflicts ?? 0) + (alerts.stuck ?? 0) + (alerts.rejected ?? 0) + (alerts.unauthorized ?? 0)
}

const NETWORK_ERROR = /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|timeout|network/i

/** The saved error of the last attempt in Spanish: a raw network error becomes a plain message. */
export function arcaErrorText(error?: string | null): string | null {
    if (!error || !error.trim()) return null
    return NETWORK_ERROR.test(error) ? "ARCA no respondió (error de conexión)." : error
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
