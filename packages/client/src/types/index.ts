export interface Product {
    id: string
    family_id?: string | null
    family_name?: string | null
    family_image_url?: string | null
    sku: string
    barcode?: string | null
    name: string
    description: string
    category: string
    subcategory?: string | null
    category_option_id?: string | null
    subcategory_option_id?: string | null
    brand_option_id?: string | null
    size_option_id?: string | null
    color_option_id?: string | null
    brand?: string | null
    size?: string | null
    color?: string | null
    image_url?: string | null
    purchase_price: number
    sale_price: number
    stock_current?: number
    stock_min?: number
    supplier_id?: string
    location?: string
    vat_rate?: number
    created_at: string
    tiendanube_sync_enabled?: boolean | number
    tiendanube_product_id?: string
    tiendanube_variant_id?: string
}

export interface InventoryItem {
    id: string
    product_id: string
    variant_id?: string
    location: string
    quantity: number
    reserved_quantity?: number
    min_stock_level: number
    updated_at: string
    product?: Product
    product_name?: string | null
    sku?: string | null
    category?: string | null
}

export type ProductCatalogOptionType = "group" | "subgroup" | "brand" | "size" | "color"

export interface ProductCatalogOption {
    id: string
    type: ProductCatalogOptionType
    name: string
    normalized_name: string
    parent_id?: string | null
    parent_name?: string | null
    active: boolean
    sort_order: number
    usage_count?: number
    created_at?: string
    updated_at?: string
}

export interface Client {
    id: string
    name: string
    email: string
    phone: string
    tax_id: string
    address: string
    current_account_balance: number
    credit_limit: number
    loyalty_points?: number
    created_at: string
}

export interface Supplier {
    id: string
    name: string
    tax_id: string
    contact_name: string
    email: string
    phone: string
    address: string
    category: string
    active: boolean
    rating: number
    account_balance: number
}

export interface OrderItem {
    id: string
    product_id: string
    product_name: string
    sku: string
    location?: string
    barcode?: string | null
    quantity: number
    picked_quantity?: number
    unit_price: number
    vat_rate?: number
    picked?: boolean
}

export interface OrderItemAllocation {
    id: string
    order_id: string
    order_item_id: string
    product_id: string
    inventory_id: string
    location_code: string
    reserved_quantity: number
    picked_quantity: number
    shortage_quantity: number
    status: 'reserved' | 'picked' | 'shortage' | 'cancelled'
    inventory_location?: string
}

/** Shipping / discount / surcharge line of an order (amount VAT included, negative for a discount). */
export interface OrderAdjustment {
    kind: 'shipping' | 'shipping_discount' | 'discount' | 'surcharge'
    description: string
    amount: number
    vat_rate?: number
    /** false = envío a cargo del negocio (no se cobra ni se factura). */
    billable?: boolean
}

export interface Order {
    id: string
    customer_name: string
    counter_name?: string
    counter_user_id?: string
    client_name?: string
    client_id?: string
    status: 'pending' | 'picking' | 'packed' | 'dispatched' | 'delivered' | 'completed' | 'cancelled'
    payment_status?: 'pending' | 'partial' | 'paid' | 'voided' | 'credit_balance'
    payment_method?: string
    total_amount: number
    created_at: string
    invoice_id?: string
    items: OrderItem[]
    payments?: Array<{ id: string; method: string; amount: number }>
    adjustments?: OrderAdjustment[]
    // Sales channel that created the order ('pos', 'tiendanube'); null for orders made here.
    external_source?: string | null
    cancellation_credit_amount?: number
    cancellation_financial_status?: 'client_credit' | 'debt_voided'

    // Shipping fields
    shipping_method?: 'pickup' | 'delivery'
    shipping_address?: string
    tracking_number?: string
    estimated_delivery?: string
    dispatched_at?: string
    delivered_at?: string
    recipient_name?: string
    recipient_dni?: string
    delivery_notes?: string
    notes?: string
}

export interface Transaction {
    id: string
    type: 'sale' | 'income' | 'refund' | 'expense' | 'purchase' | 'adjustment' | 'credit_note'
    amount: number
    date: string
    description: string
    reference_id?: string
    client_id?: string
    supplier_id?: string
    client_name?: string
    supplier_name?: string
    payment_method?: string
}

export interface CompanySettings {
    identity: {
        brand_name: string
        legal_name: string
        tax_id: string
        logo_url: string
    }
    contact: {
        phone: string
        email: string
        website: string
    }
    address: {
        street: string
        number: string
        city: string
        state?: string
        zip?: string
    }
    socials: {
        instagram: string
        facebook: string
        linkedin: string
    }
    operation: {
        tax_rate: number
        default_currency: string
    }
    billing?: {
        iibb: string
        start_date: string
        iva_condition: string
        pos: number
        afip_crt: string
        afip_key: string
        afip_credentials_configured?: boolean
        afip_env: 'homologacion' | 'produccion'
    }
    integrations?: {
        tiendanube_access_token?: string
        tiendanube_access_token_configured?: boolean
        tiendanube_store_id?: string
        tiendanube_location_id?: string
        tiendanube_client_id?: string
        tiendanube_client_secret?: string
        tiendanube_client_secret_configured?: boolean
    }
}

export interface SystemSettings {
    regional: {
        currency: string
        timezone: string
    }
    operation: {
        default_tax_rate: number
        stock_warning_threshold: number
    }
}

export interface User {
    id: string
    name: string
    email: string
    role: 'admin' | 'manager' | 'cashier' | 'warehouse'
    status: 'active' | 'inactive'
    last_login?: string | null
}

export interface SupplierPayment {
    id: string
    supplier_id: string
    supplier_name?: string
    supplier_invoice_id?: string
    amount: number
    payment_date: string
    payment_method?: string
    reference_number?: string
    notes?: string
    created_at?: string
}

export interface PurchaseOrderItem {
    id?: string
    product_id: string
    sku?: string
    name?: string
    product_name?: string
    quantity?: number
    quantity_ordered?: number
    unit_cost: number
    vat_rate?: number
    received_quantity?: number
    quantity_received?: number
    quantity_pending_qc?: number
}

export interface PurchaseOrder {
    id: string
    supplier_id: string
    supplier_name?: string
    date?: string
    order_date?: string
    status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled' | 'ordered' | 'completed'
    expected_date?: string
    expected_delivery_date?: string
    po_number?: string
    items: PurchaseOrderItem[]
    total_amount: number
    notes?: string
}

export interface FailedSync {
    id: string
    product_id: string
    tiendanube_product_id: string
    tiendanube_variant_id: string
    stock: number
    attempts: number
    max_attempts: number
    status: 'pending' | 'retrying' | 'completed' | 'failed'
    last_error?: string | null
    last_attempt_at?: string | null
    created_at: string
    updated_at: string
    product_name?: string
    product_sku?: string
}

export type StockAuditScope = "A" | "B" | "C" | "ALL"
export type StockAuditStatus = "in_progress" | "completed" | "adjusted" | "cancelled"

export interface StockAuditItem {
    id: string
    audit_id: string
    product_id: string
    product_name: string
    sku: string
    barcode?: string | null
    location_code: string
    abc_class: "A" | "B" | "C"
    expected_quantity?: number
    counted_quantity: number | null
    variance?: number | null
    is_unexpected: boolean
    notes?: string | null
    counted_at?: string | null
    counted_by_name?: string | null
    count_attempts: number
}

export interface StockAuditSession {
    id: string
    audit_number: string
    location_code: string
    location_name?: string | null
    abc_class: StockAuditScope
    status: StockAuditStatus
    blind_count: boolean
    notes?: string | null
    created_by_name?: string | null
    adjusted_by_name?: string | null
    started_at: string
    completed_at?: string | null
    adjusted_at?: string | null
    total_items: number
    counted_items: number
    pending_items: number
    exact_items?: number
    variance_units?: number
    accuracy_percent?: number
    items?: StockAuditItem[]
}

export interface StockAuditDashboard {
    summary: {
        total_audits: number
        active_audits: number
        counted_items: number
        exact_items: number
        variance_units: number
        accuracy_percent: number
    }
    by_class: Array<{
        abc_class: "A" | "B" | "C"
        counted_items: number
        exact_items: number
        variance_units: number
        accuracy_percent: number
    }>
    sessions: StockAuditSession[]
}

export interface WarehouseLocation {
    id: string
    code: string
    name: string
    description?: string | null
    active: boolean
    /** The counter (POS) sells from these locations first (ADR-015). */
    is_sales_floor?: boolean
    sku_count?: number
    total_quantity?: number
}

export interface TiendaNubeIntegrationStatus {
    connected: boolean
    connectionStatus?: 'connected' | 'disconnected' | 'suspended' | 'resumed' | 'uninstalled'
    storeId?: string
    apiVersion?: string
    locationId?: string | null
    stockLocation?: { valid: boolean; locationId?: string | null; message?: string }
    webhook: {
        configured: boolean
        id?: string | number
        reason?: 'missing_public_url' | 'not_connected' | 'not_registered'
        configuredCount?: number
        expectedCount?: number
        missingEvents?: string[]
    }
}

export interface TiendaNubeIntegrationConfig {
    clientId: string
    clientSecretConfigured: boolean
    locationId: string
}
