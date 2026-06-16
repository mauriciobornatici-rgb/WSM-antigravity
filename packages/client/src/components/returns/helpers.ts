import type { WarrantyRow, ClientReturnRow, ClientReturnItemRow, CreditNoteRow, GenericRow } from "@/types/returns"

export function readText(value: unknown, fallback = "-"): string {
    return typeof value === "string" && value.length > 0 ? value : fallback
}

export function readNumber(value: unknown): number {
    const parsed = Number(value || 0)
    return Number.isFinite(parsed) ? parsed : 0
}

export function readIsoDate(value: unknown): string {
    return typeof value === "string" && value.length > 0 ? value : new Date().toISOString()
}

export function isGenericRow(value: unknown): value is GenericRow {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function mapClientReturnItemRows(value: unknown): ClientReturnItemRow[] | undefined {
    if (!Array.isArray(value)) return undefined
    return value.filter(isGenericRow).map((item) => ({
        ...(typeof item.id === "string" ? { id: item.id } : {}),
        ...(typeof item.product_id === "string" ? { product_id: item.product_id } : {}),
        product_name: readText(item.product_name, "Producto desconocido"),
        ...(isGenericRow(item.product) && typeof item.product.name === "string"
            ? { product: { name: item.product.name } }
            : {}),
        ...(typeof item.sku === "string" ? { sku: item.sku } : {}),
        quantity: readNumber(item.quantity),
        unit_price: readNumber(item.unit_price),
        ...(typeof item.condition_status === "string" ? { condition_status: item.condition_status } : {}),
    }))
}

export function warrantyStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        initiated: "Iniciada",
        received: "Recibida",
        in_progress: "En proceso",
        resolved: "Resuelta",
        rejected: "Rechazada",
        closed: "Cerrada",
    }
    return labels[status] ?? status
}

export function returnStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        draft: "Borrador",
        initiated: "Iniciada",
        pending: "Pendiente",
        approved: "Aprobada",
        rejected: "Rechazada",
        closed: "Cerrada",
    }
    return labels[status] ?? status
}

export function creditNoteStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        draft: "Borrador",
        pending: "Pendiente",
        issued: "Emitida",
        approved: "Aprobada",
        cancelled: "Anulada",
        closed: "Cerrada",
    }
    return labels[status] ?? status
}

export function mapWarrantyRows(rows: GenericRow[]): WarrantyRow[] {
    return rows.map((row) => ({
        id: readText(row.id, crypto.randomUUID()),
        created_at: readIsoDate(row.created_at),
        client_name: readText(row.client_name),
        product_name: readText(row.product_name),
        issue_description: readText(row.issue_description),
        status: readText(row.status, "initiated"),
    }))
}

export function mapClientReturnRows(rows: GenericRow[]): ClientReturnRow[] {
    return rows.map((row) => {
        const items = mapClientReturnItemRows(row.items)
        const mapped: ClientReturnRow = {
            id: readText(row.id, crypto.randomUUID()),
            created_at: readIsoDate(row.created_at),
            client_name: readText(row.client_name),
            reason: readText(row.reason),
            status: readText(row.status, "draft"),
            total_amount: readNumber(row.total_amount),
        }
        if (typeof row.order_id === "string") {
            mapped.order_id = row.order_id
        }
        if (items) {
            mapped.items = items
        }
        return mapped
    })
}

export function mapCreditNoteRows(rows: GenericRow[]): CreditNoteRow[] {
    return rows.map((row) => ({
        id: readText(row.id, crypto.randomUUID()),
        number: readText(row.number, "-"),
        created_at: readIsoDate(row.created_at),
        client_name: readText(row.client_name),
        amount: readNumber(row.amount),
        status: readText(row.status, "issued"),
        point_of_sale: row.point_of_sale ? Number(row.point_of_sale) : undefined,
        credit_note_type: typeof row.credit_note_type === "string" ? row.credit_note_type : undefined,
        cae: typeof row.cae === "string" ? row.cae : undefined,
        cae_expiration_date: typeof row.cae_expiration_date === "string" ? row.cae_expiration_date : undefined,
        reference_type: typeof row.reference_type === "string" ? row.reference_type : undefined,
        reference_id: typeof row.reference_id === "string" ? row.reference_id : undefined,
        customer_name: typeof row.customer_name === "string" ? row.customer_name : undefined,
        notes: typeof row.notes === "string" ? row.notes : undefined,
    }))
}
