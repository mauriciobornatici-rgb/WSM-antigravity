import type { Invoice } from "@/types/api"

export type InvoiceView = Invoice & {
    client_name?: string
    client_tax_condition?: string
    client_tax_id?: string
    client_address?: string
    cae?: string
    net_amount?: number
    vat_amount?: number
    subtotal?: number
    client_snapshot?: {
        email?: string | null
    }
}

export type DraftInvoiceItem = {
    description: string
    quantity: number
    unit_price: number
    vat_rate: number
    product_name?: string
}

export type DraftInvoice = {
    client_id: string
    invoice_type: "A" | "B"
    point_of_sale: number
    items: DraftInvoiceItem[]
    notes: string
}
