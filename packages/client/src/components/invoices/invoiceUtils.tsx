import { Badge } from "@/components/ui/badge"
import type { DraftInvoice, InvoiceView } from "./types"

export const calculateDraftTotal = (invoice: DraftInvoice): number =>
    invoice.items.reduce((acc, item) => {
        const subtotal = item.quantity * item.unit_price
        const vat = subtotal * (item.vat_rate / 100)
        return acc + subtotal + vat
    }, 0)

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
