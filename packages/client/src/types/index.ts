export interface Product {
    id: string
    sku: string
    barcode?: string | null
    name: string
    description: string
    category: string
    image_url?: string | null
    purchase_price: number
    sale_price: number
    stock_current?: number
    stock_min?: number
    location?: string
    created_at: string
}

export interface InventoryItem {
    id: string
    product_id: string
    variant_id?: string
    location: string
    quantity: number
    min_stock_level: number
    updated_at: string
    product?: Product
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
    quantity: number
    picked_quantity?: number
    unit_price: number
    picked?: boolean
}

export interface Order {
    id: string
    customer_name: string
    client_name?: string
    client_id?: string
    status: 'pending' | 'picking' | 'packed' | 'dispatched' | 'delivered' | 'completed' | 'cancelled'
    payment_status?: 'pending' | 'partial' | 'paid'
    payment_method?: string
    total_amount: number
    created_at: string
    invoice_id?: string
    items: OrderItem[]

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
    received_quantity?: number
    quantity_received?: number
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
