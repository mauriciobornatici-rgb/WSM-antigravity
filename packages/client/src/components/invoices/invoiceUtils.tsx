import { Badge } from "@/components/ui/badge"
import { grossLineTotal, lineAmounts, vatRateOf } from "@/lib/pricing"
import type { DraftInvoice, InvoiceView } from "./types"

export const calculateDraftTotal = (invoice: DraftInvoice): number =>
    // Draft items hold the net unit price (what the server expects); the total is the VAT-included one.
    invoice.items.reduce((acc, item) => acc + grossLineTotal(item.quantity, item.unit_price, item.vat_rate), 0)

/**
 * Net / VAT split of a VAT-included credit note amount, using the rates of the linked return items
 * (never a hardcoded 21%). Mixed rates split the amount in proportion to each item's net share.
 */
export const splitCreditNoteAmount = (
    amount: number,
    items: Array<{ quantity: number; unit_price: number; vat_rate?: number | undefined }> = []
): { net: number; vat: number; rate: number | null } => {
    const total = Number(amount || 0)
    const rates = Array.from(new Set(items.map((item) => vatRateOf(item.vat_rate))))
    const uniformRate = rates.length > 1 ? null : (rates[0] ?? vatRateOf(undefined))
    let net: number
    if (uniformRate === null) {
        const gross = items.reduce((sum, item) => sum + grossLineTotal(item.quantity, item.unit_price, item.vat_rate), 0)
        const netOfItems = items.reduce((sum, item) => sum + lineAmounts(item.quantity, item.unit_price, item.vat_rate).net, 0)
        net = gross > 0 ? Math.round(total * (netOfItems / gross) * 100) / 100 : total
    } else {
        net = Math.round((total / (1 + uniformRate / 100)) * 100) / 100
    }
    return { net, vat: Math.round((total - net) * 100) / 100, rate: uniformRate }
}

export const formatInvoiceNumber = (invoice: InvoiceView): string => {
    if (invoice.invoice_type === "TK") {
        return `TKT-${String(invoice.id).split("-")[1] || invoice.id.substring(4, 12)}`
    }
    return `${invoice.invoice_type}-${String(invoice.point_of_sale).padStart(4, "0")}-${String(invoice.invoice_number).padStart(8, "0")}`
}

export const getInvoiceStatusBadge = (status?: string, type?: string) => {
    if (type === "TK") return <Badge className="bg-slate-500">Ticket no fiscal</Badge>
    switch (status) {
        case "issued":
            return <Badge className="bg-blue-500">Emitida</Badge>
        case "authorized":
            return <Badge className="bg-green-500">Autorizada (CAE)</Badge>
        default:
            return <Badge variant="outline">{status || "Sin estado"}</Badge>
    }
}
