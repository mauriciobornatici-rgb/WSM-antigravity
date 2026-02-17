import type { Database } from "@/types/database.types"

export type Product = Database['public']['Tables']['products']['Row'] & { location?: string }
export type InventoryItem = Database['public']['Tables']['inventory']['Row'] & { product?: Product }

// Mock Data
export const MOCK_PRODUCTS: Product[] = [
    {
        id: "1",
        sku: "NK-AIR-001",
        name: "Nike Air Zoom Pegasus 39",
        description: "Running shoes for daily training.",
        category: "Footwear",
        image_url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&auto=format&fit=crop&q=60",
        purchase_price: 80.00,
        sale_price: 120.00,
        location: "A1-01-01",
        created_at: new Date().toISOString()
    },
    {
        id: "2",
        sku: "AD-ULT-002",
        name: "Adidas Ultraboost Light",
        description: "Lightweight running shoes.",
        category: "Footwear",
        image_url: "https://images.unsplash.com/photo-1608231387042-66d1773070a5?w=500&auto=format&fit=crop&q=60",
        purchase_price: 110.00,
        sale_price: 180.00,
        created_at: new Date().toISOString()
    },
    {
        id: "3",
        sku: "PM-TSH-003",
        name: "Puma Training Tee",
        description: "Breathable fabric for workouts.",
        category: "Apparel",
        image_url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=500&auto=format&fit=crop&q=60",
        purchase_price: 15.00,
        sale_price: 35.00,
        created_at: new Date().toISOString()
    },
    {
        id: "4",
        sku: "WIL-BKT-004",
        name: "Wilson Evolution Basketball",
        description: "Indoor game ball.",
        category: "Equipment",
        image_url: "https://images.unsplash.com/photo-1519861531473-9200262188be?w=500&auto=format&fit=crop&q=60",
        purchase_price: 45.00,
        sale_price: 80.00,
        created_at: new Date().toISOString()
    }
]

export const MOCK_INVENTORY: InventoryItem[] = [
    { id: "101", variant_id: "var_1", location: "A1-01-01", quantity: 15, min_stock_level: 5, updated_at: new Date().toISOString() },
    { id: "102", variant_id: "var_2", location: "A1-01-02", quantity: 3, min_stock_level: 10, updated_at: new Date().toISOString() },
    { id: "103", variant_id: "var_3", location: "B2-05-01", quantity: 50, min_stock_level: 20, updated_at: new Date().toISOString() },
    { id: "104", variant_id: "var_4", location: "C3-02-04", quantity: 0, min_stock_level: 5, updated_at: new Date().toISOString() },
    { id: "104", variant_id: "var_4", location: "C3-02-04", quantity: 0, min_stock_level: 5, updated_at: new Date().toISOString() },
]

export interface Client {
    id: string
    name: string
    email: string
    phone: string
    tax_id: string // RUC/DNI
    address: string
    current_account_balance: number // Positive means debt (owed to us), Negative means credit (we owe them)
    credit_limit: number
    created_at: string
}

export const MOCK_CLIENTS: Client[] = [
    {
        id: "CLI-001",
        name: "Juan Pérez",
        email: "juan@example.com",
        phone: "+595 981 123456",
        tax_id: "1234567-8",
        address: "Avda. España 1234",
        current_account_balance: 150000,
        credit_limit: 5000000,
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString()
    },
    {
        id: "CLI-002",
        name: "Empresa S.A.",
        email: "contacto@empresa.com",
        phone: "+595 21 654321",
        tax_id: "80001234-5",
        address: "Mcal. López 5555",
        current_account_balance: 0,
        credit_limit: 20000000,
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString()
    }
]

// ... imports

export interface Transaction {
    id: string
    type: 'sale' | 'expense' | 'purchase'
    amount: number
    date: string
    description: string
    reference_id?: string
    client_id?: string
}

export const MOCK_TRANSACTIONS: Transaction[] = [
    { id: "t1", type: "sale", amount: 120.00, date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), description: "Venta POS #1023", reference_id: "#1023", client_id: "CLI-001" },
    { id: "t2", type: "sale", amount: 35.00, date: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), description: "Venta POS #1022", reference_id: "#1022", client_id: "CLI-001" },
    { id: "t3", type: "purchase", amount: 500.00, date: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), description: "Compra Stock Nike", reference_id: "PO-445" },
    { id: "t4", type: "expense", amount: 50.00, date: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), description: "Pago Servicios Luz", reference_id: "BILL-001" },
    { id: "t5", type: "sale", amount: 180.00, date: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(), description: "Venta Online #992", reference_id: "#992", client_id: "CLI-002" },
]

// ... imports

// WMS Types
export type OrderStatus = 'pending' | 'picking' | 'packed' | 'completed'

export interface MockOrder {
    id: string
    customer: string
    client_id?: string
    status: OrderStatus
    items: {
        product_id: string
        product_name: string
        sku: string
        quantity: number
        location?: string // Location snapshot for picking
        picked: boolean
    }[]
    created_at: string
}



export interface ReturnRequest {
    id: string
    transaction_id: string
    product_id: string
    product_name: string
    reason: 'defective' | 'wrong_size' | 'client_preference' | 'other'
    condition: 'new_sealed' | 'open_box' | 'damaged'
    action: 'restock' | 'supplier_return' | 'discard'
    status: 'pending' | 'completed' | 'rejected'
    notes: string
    date: string
}

export interface WarrantyClaim {
    id: string
    transaction_id: string
    product_id: string
    product_name: string
    issue_description: string
    status: 'initiated' | 'sent_to_supplier' | 'supplier_approved' | 'supplier_rejected' | 'replacement_issued' | 'resolved'
    history: { date: string, status: string, notes: string }[]
    created_at: string
    updated_at: string
}

export const MOCK_RETURNS: ReturnRequest[] = []
export const MOCK_WARRANTIES: WarrantyClaim[] = []
export const MOCK_ORDERS: MockOrder[] = [
    {
        id: "ORD-001",
        customer: "Cliente A (Retail)",
        status: "pending",
        items: [
            { product_id: "1", product_name: "Nike Air Zoom Pegasus 39", sku: "NK-AIR-001", quantity: 2, location: "A1-01-01", picked: false },
            { product_id: "3", product_name: "Puma Training Tee", sku: "PM-TSH-003", quantity: 1, location: "B2-05-01", picked: false }
        ],
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString()
    },
    {
        id: "ORD-002",
        customer: "Cliente B (Wholesale)",
        status: "picking",
        items: [
            { product_id: "2", product_name: "Adidas Ultraboost Light", sku: "AD-ULT-002", quantity: 5, location: "A1-01-02", picked: true }, // Partially picked demo
            { product_id: "4", product_name: "Wilson Evolution Basketball", sku: "WIL-BKT-004", quantity: 2, location: "C3-02-04", picked: false }
        ],
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
    }
]

// Settings Interfaces
export interface CompanySettings {
    identity: {
        brand_name: string
        legal_name: string
        tax_id: string
        logo_url: string
    }
    tax: {
        category: string
        start_date: string
    }
    contact: {
        phone: string
        email: string
        website: string
    }
    address: {
        street: string
        number: string
        floor?: string
        city: string
        state: string
        zip: string
    }
    socials: {
        instagram: string
        facebook: string
        linkedin: string
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
    last_login: string
}

// --- PURCHASING & SUPPLIERS INTERFACES ---

export interface Supplier {
    id: string
    name: string
    tax_id: string
    contact_name: string
    email: string
    phone: string
    address: string
    category: string // e.g., 'Footwear', 'Logistics'
    active: boolean
    rating: number // 1-5 stars based on QC
    account_balance: number
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
    product_id: string
    sku: string
    name: string
    quantity: number
    unit_cost: number
    received_quantity: number
}

export interface PurchaseOrder {
    id: string
    supplier_id: string
    supplier_name: string
    date: string
    status: 'draft' | 'ordered' | 'partial' | 'completed' | 'cancelled'
    expected_date?: string
    items: PurchaseOrderItem[]
    total_amount: number
    notes?: string
}

export interface Reception {
    id: string
    purchase_order_id: string
    date: string
    remito_number: string // Delivery Note ID
    items: {
        product_id: string
        quantity_declared: number // What the paper says
    }[]
    status: 'pending_qc' | 'checked'
}

export interface QualityCheck {
    id: string
    reception_id: string
    date: string
    inspector_id: string
    results: {
        product_id: string
        quantity_passed: number
        quantity_rejected: number
        rejection_reason?: string
    }[]
    status: 'completed'
}

export interface SupplierReturn {
    id: string
    supplier_id: string
    original_reception_id: string
    date: string
    items: {
        product_id: string
        quantity: number
        reason: string
    }[]
    status: 'pending' | 'shipped' | 'resolved' // 'resolved' means credit note or replacement received
    notes?: string
}

// --- MOCK DATA FOR PURCHASING ---

export const MOCK_SUPPLIERS: Supplier[] = [
    {
        id: "sup-1",
        name: "Nike Distribution SA",
        tax_id: "80012345-1",
        contact_name: "Carlos Rodriguez",
        email: "orders@nikedist.com",
        phone: "+595 981 111 222",
        address: "Av. Aviadores del Chaco 2050",
        category: "Footwear",
        active: true,
        rating: 4.8,
        account_balance: 1500000
    },
    {
        id: "sup-2",
        name: "Adidas Paraguay",
        tax_id: "80054321-5",
        contact_name: "Ana Benitez",
        email: "sales.py@adidas.com",
        phone: "+595 971 333 444",
        address: "Shopping del Sol, Local 12",
        category: "Footwear",
        active: true,
        rating: 4.5,
        account_balance: 0
    },
    {
        id: "sup-3",
        name: "Global Sports Equipments",
        tax_id: "80099887-7",
        contact_name: "Roberto Gomez",
        email: "roberto@gse.com.py",
        phone: "+595 21 600 700",
        address: "Ruta Transchaco Km 10",
        category: "Equipment",
        active: true,
        rating: 3.9,
        account_balance: 500000
    }
]

export const MOCK_PURCHASE_ORDERS: PurchaseOrder[] = [
    {
        id: "PO-2024-001",
        supplier_id: "sup-1",
        supplier_name: "Nike Distribution SA",
        date: "2024-02-01T10:00:00Z",
        status: 'ordered',
        expected_date: "2024-02-05",
        total_amount: 5000.00,
        items: [
            { product_id: "1", sku: "NK-AIR-001", name: "Nike Air Zoom Pegasus 39", unit_cost: 80.00, quantity: 50, received_quantity: 0 },
            { product_id: "5", sku: "NK-DRY-005", name: "Nike Dri-FIT Shorts", unit_cost: 20.00, quantity: 50, received_quantity: 0 }
        ]
    }
]

export interface Invoice {
    id: string
    purchase_order_id: string
    supplier_id: string
    number: string // Legal Invoice Number
    date: string
    due_date: string
    total_amount: number
    status: 'unpaid' | 'paid' | 'overdue'
}

export const MOCK_RECEPTIONS: Reception[] = []
export const MOCK_QUALITY_CHECKS: QualityCheck[] = []
export const MOCK_SUPPLIER_RETURNS: SupplierReturn[] = []
export const MOCK_INVOICES: Invoice[] = []
export const MOCK_SUPPLIER_PAYMENTS: SupplierPayment[] = [
    { id: "PAY-1", supplier_id: "sup-1", payment_date: "2024-02-05T10:00:00Z", amount: 5000, payment_method: "Transferencia", reference_number: "TRF-001" }
]

// Mock Data for Settings
export const MOCK_COMPANY_SETTINGS: CompanySettings = {
    identity: {
        brand_name: "Antigravity Store",
        legal_name: "Antigravity S.A.",
        tax_id: "80088999-1",
        logo_url: "https://via.placeholder.com/150"
    },
    tax: {
        category: "Responsable Inscripto",
        start_date: "2020-01-01"
    },
    contact: {
        phone: "+595 981 555 666",
        email: "hola@antigravity.com",
        website: "www.antigravity.com.py"
    },
    address: {
        street: "Avda. Aviadores del Chaco",
        number: "2050",
        floor: "3A",
        city: "Asunción",
        state: "Asunción",
        zip: "1001"
    },
    socials: {
        instagram: "@antigravity_py",
        facebook: "AntigravityPY",
        linkedin: "antigravity-sa"
    }
}

export const MOCK_SYSTEM_SETTINGS: SystemSettings = {
    regional: {
        currency: "ARS",
        timezone: "America/Argentina/Buenos_Aires"
    },
    operation: {
        default_tax_rate: 21,
        stock_warning_threshold: 5
    }
}

export const MOCK_USERS: User[] = [
    { id: "USR-001", name: "Mauricio Admin", email: "mauri@admin.com", role: "admin", status: "active", last_login: new Date().toISOString() },
    { id: "USR-002", name: "Juan Cajero", email: "juan@pos.com", role: "cashier", status: "active", last_login: new Date(Date.now() - 86400000).toISOString() },
    { id: "USR-003", name: "Maria Depósito", email: "maria@wms.com", role: "warehouse", status: "active", last_login: new Date(Date.now() - 172800000).toISOString() }
]

// Service
export const mockService = {
    getProducts: async (): Promise<Product[]> => {
        return new Promise((resolve) => {
            setTimeout(() => resolve(MOCK_PRODUCTS), 600)
        })
    },

    getInventory: async (): Promise<InventoryItem[]> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                // Join simulation
                const inventoryWithProducts = MOCK_INVENTORY.map(inv => {
                    // Find product matching variant or SKU logic
                    // First try explicit link via variant_id
                    let product = MOCK_PRODUCTS.find(p => p.id === inv.variant_id)

                    // Fallback to demo logic if not found (legacy mock data support)
                    if (!product && inv.id) {
                        const productIndex = parseInt(inv.id) % MOCK_PRODUCTS.length
                        product = MOCK_PRODUCTS[productIndex]
                    }

                    return {
                        ...inv,
                        product,
                    }
                })
                // Filter out items where product wasn't found (shouldn't happen often in demo)
                resolve(inventoryWithProducts.filter(i => i.product))
            }, 500)
        })
    },

    getOrders: async (): Promise<MockOrder[]> => {
        return new Promise((resolve) => {
            setTimeout(() => resolve(MOCK_ORDERS), 500)
        })
    },

    createOrder: async (customer: string, items: { product_id: string, quantity: number }[], client_id?: string): Promise<MockOrder> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const newOrder: MockOrder = {
                    id: `ORD-${Math.floor(Math.random() * 10000)}`,
                    customer,
                    client_id,
                    status: 'pending',
                    items: items.map(item => {
                        const product = MOCK_PRODUCTS.find(p => p.id === item.product_id)!
                        // Deduct stock (simplified: find inventory item for this product)
                        // In real app, we'd find the specific inventory batch/location
                        const invItem = MOCK_INVENTORY.find(inv => parseInt(inv.id) % MOCK_PRODUCTS.length === MOCK_PRODUCTS.indexOf(product))

                        if (invItem) {
                            invItem.quantity = Math.max(0, invItem.quantity - item.quantity)
                        }

                        return {
                            product_id: product.id,
                            product_name: product.name,
                            sku: product.sku,
                            quantity: item.quantity,
                            location: product.location || "Sin Asignar", // Use product default location
                            picked: false
                        }
                    }),
                    created_at: new Date().toISOString()
                }
                MOCK_ORDERS.unshift(newOrder) // Add to top
                resolve(newOrder)
            }, 800)
        })
    },

    updateOrderStatus: async (orderId: string, status: OrderStatus): Promise<void> => {
        console.log(`Updated Order ${orderId} to ${status}`)
        const order = MOCK_ORDERS.find(o => o.id === orderId)
        if (order) order.status = status
        return Promise.resolve()
    },

    getTransactions: async (): Promise<Transaction[]> => {
        return new Promise((resolve) => {
            setTimeout(() => resolve(MOCK_TRANSACTIONS), 400)
        })
    },

    getClients: async (): Promise<Client[]> => {
        return new Promise((resolve) => {
            setTimeout(() => resolve(MOCK_CLIENTS), 500)
        })
    },

    createClient: async (client: Omit<Client, "id" | "created_at" | "current_account_balance">): Promise<Client> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const newClient: Client = {
                    id: `CLI-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
                    ...client,
                    current_account_balance: 0,
                    created_at: new Date().toISOString()
                }
                MOCK_CLIENTS.unshift(newClient)
                resolve(newClient)
            }, 600)
        })
    },

    addTransaction: async (transaction: Omit<Transaction, "id" | "date">): Promise<Transaction> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const newTx: Transaction = {
                    id: `TX-${Math.random().toString(36).substr(2, 9)}`,
                    date: new Date().toISOString(),
                    ...transaction
                }
                MOCK_TRANSACTIONS.unshift(newTx)
                resolve(newTx)
            }, 300)
        })
    },

    updateClientBalance: async (clientId: string, amount: number): Promise<void> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const client = MOCK_CLIENTS.find(c => c.id === clientId)
                if (client) {
                    client.current_account_balance += amount
                }
                resolve()
            }, 200)
        })
    },

    // Returns & Warranties
    createReturn: async (data: Omit<ReturnRequest, "id" | "date" | "status">): Promise<ReturnRequest> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const newReturn: ReturnRequest = {
                    id: `RET-${Math.floor(Math.random() * 10000)}`,
                    ...data,
                    date: new Date().toISOString(),
                    status: 'completed' // Auto-complete for demo
                }
                MOCK_RETURNS.unshift(newReturn)

                // Simulating Stock Update if Restock
                if (data.action === 'restock') {
                    // Logic to find and increment stock would go here in real app
                    console.log(`Restocking product ${data.product_id}`)
                }

                resolve(newReturn)
            }, 600)
        })
    },

    createWarranty: async (data: Omit<WarrantyClaim, "id" | "created_at" | "updated_at" | "history">): Promise<WarrantyClaim> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const newWarranty: WarrantyClaim = {
                    id: `WAR-${Math.floor(Math.random() * 10000)}`,
                    ...data,
                    history: [{
                        date: new Date().toISOString(),
                        status: data.status,
                        notes: "Reclamo de garantía iniciado"
                    }],
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
                MOCK_WARRANTIES.unshift(newWarranty)
                resolve(newWarranty)
            }, 600)
        })
    },

    updateWarrantyStatus: async (id: string, status: WarrantyClaim['status'], notes: string): Promise<void> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const warranty = MOCK_WARRANTIES.find(w => w.id === id)
                if (warranty) {
                    warranty.status = status
                    const timestamp = new Date().toISOString()
                    warranty.updated_at = timestamp
                    warranty.history.push({
                        date: timestamp,
                        status: status,
                        notes: notes
                    })
                }
                resolve()
            }, 400)
        })
    },

    // Settings
    getCompanySettings: async (): Promise<CompanySettings> => {
        return new Promise(resolve => setTimeout(() => resolve(MOCK_COMPANY_SETTINGS), 300))
    },

    updateCompanySettings: async (settings: CompanySettings): Promise<void> => {
        return new Promise(resolve => {
            // In a real app we would merge changes. Here we reference the object but simple mutation works for mock
            Object.assign(MOCK_COMPANY_SETTINGS, settings)
            setTimeout(resolve, 500)
        })
    },

    updateSystemSettings: async (settings: SystemSettings): Promise<void> => {
        return new Promise(resolve => {
            Object.assign(MOCK_SYSTEM_SETTINGS, settings)
            setTimeout(resolve, 500)
        })
    },

    getSystemSettings: async (): Promise<SystemSettings> => {
        return new Promise(resolve => setTimeout(() => resolve(MOCK_SYSTEM_SETTINGS), 300))
    },

    getUsers: async (): Promise<User[]> => {
        return new Promise(resolve => setTimeout(() => resolve(MOCK_USERS), 400))
    },

    updateUserRole: async (userId: string, role: User['role']): Promise<void> => {
        return new Promise(resolve => {
            const user = MOCK_USERS.find(u => u.id === userId)
            if (user) user.role = role
            setTimeout(resolve, 300)
        })
    },

    toggleUserStatus: async (userId: string): Promise<void> => {
        return new Promise(resolve => {
            const user = MOCK_USERS.find(u => u.id === userId)
            if (user) {
                user.status = user.status === 'active' ? 'inactive' : 'active'
            }
            setTimeout(resolve, 300)
        })
    },

    getWarranties: async (transactionId?: string): Promise<WarrantyClaim[]> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                if (transactionId) {
                    resolve(MOCK_WARRANTIES.filter(w => w.transaction_id === transactionId))
                } else {
                    resolve(MOCK_WARRANTIES)
                }
            }, 400)
        })
    },

    getReturns: async (): Promise<ReturnRequest[]> => {
        return new Promise((resolve) => {
            setTimeout(() => resolve(MOCK_RETURNS), 400)
        })
    },

    // --- PURCHASING & SUPPLIERS METHODS ---
    getSuppliers: async (): Promise<Supplier[]> => {
        return new Promise(resolve => setTimeout(() => resolve(MOCK_SUPPLIERS), 400))
    },

    createSupplier: async (supplier: Omit<Supplier, 'id' | 'rating' | 'active'>): Promise<Supplier> => {
        return new Promise(resolve => {
            const newSupplier: Supplier = {
                ...supplier,
                id: `sup-${Date.now()}`,
                active: true,
                rating: 5.0
            }
            MOCK_SUPPLIERS.push(newSupplier)
            setTimeout(() => resolve(newSupplier), 500)
        })
    },

    getPurchaseOrders: async (): Promise<PurchaseOrder[]> => {
        return new Promise(resolve => setTimeout(() => resolve(MOCK_PURCHASE_ORDERS), 400))
    },

    createPurchaseOrder: async (po: Omit<PurchaseOrder, 'id' | 'status'>): Promise<PurchaseOrder> => {
        return new Promise(resolve => {
            const newPO: PurchaseOrder = {
                ...po,
                id: `PO-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000)}`,
                status: 'draft'
            }
            MOCK_PURCHASE_ORDERS.push(newPO)
            setTimeout(() => resolve(newPO), 500)
        })
    },

    updatePurchaseStatus: async (id: string, status: PurchaseOrder['status']): Promise<void> => {
        return new Promise(resolve => {
            const po = MOCK_PURCHASE_ORDERS.find(p => p.id === id)
            if (po) po.status = status
            resolve()
        })
    },

    createReception: async (reception: Omit<Reception, 'id' | 'status'>): Promise<Reception> => {
        return new Promise(resolve => {
            const newReception: Reception = {
                ...reception,
                id: `REC-${Date.now()}`,
                status: 'pending_qc'
            }
            MOCK_RECEPTIONS.push(newReception)
            resolve(newReception)
        })
    },

    getReceptions: async (): Promise<Reception[]> => {
        return new Promise(resolve => setTimeout(() => resolve(MOCK_RECEPTIONS), 400))
    },

    performQualityCheck: async (check: Omit<QualityCheck, 'id' | 'status'>): Promise<QualityCheck> => {
        return new Promise(resolve => {
            const newCheck: QualityCheck = {
                ...check,
                id: `QC-${Date.now()}`,
                status: 'completed'
            }
            MOCK_QUALITY_CHECKS.push(newCheck)

            // 1. Get Reception and Purchase Order
            const reception = MOCK_RECEPTIONS.find(r => r.id === check.reception_id)
            if (reception) {
                reception.status = 'checked'

                const po = MOCK_PURCHASE_ORDERS.find(p => p.id === reception.purchase_order_id)
                if (po) {
                    // 2. Update PO Received Quantities and Stock
                    check.results.forEach(result => {
                        // Update PO Item
                        const item = po.items.find(i => i.product_id === result.product_id)
                        if (item) {
                            item.received_quantity = (item.received_quantity || 0) + result.quantity_passed
                        }

                        // 3. Update Stock (Inventory)
                        if (result.quantity_passed > 0) {
                            // Try to find existing inventory for this product
                            const existingInv = MOCK_INVENTORY.find(inv => inv.variant_id === result.product_id)

                            if (existingInv) {
                                existingInv.quantity += result.quantity_passed
                                existingInv.updated_at = new Date().toISOString()
                            } else {
                                // Create new inventory item
                                MOCK_INVENTORY.push({
                                    id: `inv-${Date.now()}-${Math.floor(Math.random() * 100)}`,
                                    variant_id: result.product_id, // Link to product
                                    location: "REC-ZONE", // Default receiving zone
                                    quantity: result.quantity_passed,
                                    min_stock_level: 10,
                                    updated_at: new Date().toISOString()
                                })
                            }
                        }
                    })

                    // Check if PO is fully completed (optional, logic can vary)
                    const allReceived = po.items.every(i => i.received_quantity >= i.quantity)
                    if (allReceived && po.status !== 'completed') {
                        po.status = 'completed'
                    } else if (!allReceived && po.status === 'ordered') {
                        po.status = 'partial'
                    }
                }
            }

            resolve(newCheck)
        })
    },

    createSupplierReturn: async (ret: Omit<SupplierReturn, 'id' | 'status'>): Promise<SupplierReturn> => {
        return new Promise(resolve => {
            const newReturn: SupplierReturn = {
                ...ret,
                id: `RET-${Date.now()}`,
                status: 'pending'
            }
            MOCK_SUPPLIER_RETURNS.push(newReturn)
            resolve(newReturn)
        })
    },

    getSupplierReturns: async (): Promise<SupplierReturn[]> => {
        return new Promise((resolve) => {
            setTimeout(() => resolve(MOCK_SUPPLIER_RETURNS), 400)
        })
    },

    // Invoice & Payments
    getInvoices: async (): Promise<Invoice[]> => {
        return new Promise(resolve => setTimeout(() => resolve(MOCK_INVOICES), 400))
    },

    createInvoice: async (invoice: Omit<Invoice, 'id' | 'status'>): Promise<Invoice> => {
        return new Promise(resolve => {
            const newInvoice: Invoice = {
                ...invoice,
                id: `INV-${Date.now()}`,
                status: 'unpaid'
            }
            MOCK_INVOICES.push(newInvoice)

            // Update Supplier Balance (Increase Debt)
            const supplier = MOCK_SUPPLIERS.find(s => s.id === invoice.supplier_id)
            if (supplier) {
                supplier.account_balance = (supplier.account_balance || 0) + invoice.total_amount
            }

            resolve(newInvoice)
        })
    },

    getSupplierPayments: async (supplierId?: string): Promise<SupplierPayment[]> => {
        return new Promise(resolve => {
            setTimeout(() => {
                if (supplierId) {
                    resolve(MOCK_SUPPLIER_PAYMENTS.filter(p => p.supplier_id === supplierId))
                } else {
                    resolve(MOCK_SUPPLIER_PAYMENTS)
                }
            }, 400)
        })
    },

    createSupplierPayment: async (payment: Omit<SupplierPayment, 'id'>): Promise<SupplierPayment> => {
        return new Promise(resolve => {
            const newPayment: SupplierPayment = {
                ...payment,
                id: `PAY-${Date.now()}`
            }
            MOCK_SUPPLIER_PAYMENTS.push(newPayment)

            // Update Supplier Balance (Decrease Debt)
            const supplier = MOCK_SUPPLIERS.find(s => s.id === payment.supplier_id)
            if (supplier) {
                supplier.account_balance = (supplier.account_balance || 0) - payment.amount
            }

            resolve(newPayment)
        })
    }
}
