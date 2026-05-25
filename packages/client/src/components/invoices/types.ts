import type { Invoice } from "@/types/api"

export type InvoiceView = Invoice & {
    client_name?: string
    client_tax_condition?: string
    client_tax_id?: string
    client_address?: string
    cae?: string
    cae_expiration_date?: string
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

export type CreditNoteRow = {
    id: string
    number: string
    created_at: string
    client_name: string
    amount: number
    status: string
    point_of_sale?: number | undefined
    credit_note_type?: string | undefined
    cae?: string | undefined
    cae_expiration_date?: string | undefined
    reference_type?: string | undefined
    reference_id?: string | undefined
    customer_name?: string | undefined
    notes?: string | undefined
}
