export type OnlineVisibility = 'visible' | 'unlisted' | 'hidden'
export type OnlineSyncStatus = 'local_only' | 'pending' | 'synced' | 'conflict' | 'error'

export interface OnlineStoreOverview {
    connected: boolean
    revenue30d: number
    catalog: { families: number; synced: number; attention: number; visible: number }
    orders: { orders: number; paid: number; awaiting_fulfillment: number }
    synchronization: {
        failed_stock: number
        pending_events: number
        last_order_sync?: string | null
        last_catalog_sync?: string | null
    }
}

export interface OnlineCatalogVariant {
    id: string
    product_id: string
    remote_variant_id?: string | null
    sync_status: OnlineSyncStatus
    last_error?: string | null
    sku: string
    barcode?: string | null
    name: string
    size?: string | null
    color?: string | null
    sale_price: number
    purchase_price: number
    image_url?: string | null
    status: string
    stock: number
}

export interface OnlineCatalogFamily {
    id: string
    name: string
    description?: string | null
    brand?: string | null
    category?: string | null
    visibility: OnlineVisibility
    remote_product_id?: string | null
    sync_status: OnlineSyncStatus
    last_error?: string | null
    last_synced_at?: string | null
    variant_count: number
    total_stock: number
    variants: OnlineCatalogVariant[]
}

export interface OnlineProductDraft {
    name: string
    description?: string | null
    brand?: string | null
    category?: string | null
    visibility: OnlineVisibility
    publish: boolean
    variants: Array<{
        sku: string
        barcode?: string | null
        size?: string | null
        color?: string | null
        sale_price: number
        purchase_price: number
        stock_initial: number
        image_url?: string | null
    }>
}

export interface OnlineOrder {
    id: string
    external_id: string
    external_number?: string | null
    customer_name: string
    contact_email?: string | null
    contact_phone?: string | null
    contact_identification?: string | null
    total_amount: number
    remote_status?: string | null
    remote_payment_status?: string | null
    remote_shipping_status?: string | null
    gateway_name?: string | null
    shipping_address?: string | null
    shipping_address_json?: unknown
    tracking_number?: string | null
    item_lines: number
    item_units: number
    fulfillment_count: number
    created_at: string
}

export interface OnlineCustomer {
    external_id: string
    local_client_id?: string | null
    name: string
    email?: string | null
    phone?: string | null
    identification?: string | null
    default_address?: unknown
    actual_orders_count: number
    actual_total_spent: number
    last_synced_at?: string | null
}

export interface OnlineFulfillment {
    id: string
    order_id: string
    external_order_id: string
    external_number?: string | null
    number?: string | null
    status: string
    customer_name: string
    contact_email?: string | null
    contact_phone?: string | null
    contact_identification?: string | null
    recipient?: unknown
    destination?: unknown
    local_shipping_address?: string | null
    shipping?: unknown
    tracking_info?: unknown
    tracking_events?: unknown
    tracking_number?: string | null
    estimated_delivery?: string | null
    fulfilled_at?: string | null
    updated_at: string
}

export interface OnlineStoreAnalytics {
    daily: Array<{ date: string; orders: number; revenue: number }>
    topProducts: Array<{ sku: string; name: string; size?: string | null; color?: string | null; units: number; revenue: number }>
    paymentStates: Array<{ state: string; total: number }>
    topCustomers: Array<{ external_id: string; name: string; email?: string | null; orders: number; revenue: number }>
}

export interface OnlineSyncCenter {
    runs: Array<Record<string, unknown> & { id: string; operation: string; status: string; created_at: string }>
    events: Array<Record<string, unknown> & { id: string; event: string; resource_id: string; status: string; created_at: string }>
    failedStock: Array<Record<string, unknown> & { id: string; status: string; product_name?: string; last_error?: string }>
}
