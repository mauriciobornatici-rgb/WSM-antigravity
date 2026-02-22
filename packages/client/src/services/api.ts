/**
 * API service layer - all backend calls.
 * Uses httpClient for auth, error handling, and 401 auto-logout.
 */

import type {
    Client,
    CompanySettings,
    InventoryItem,
    Order,
    Product,
    PurchaseOrder,
    Supplier,
    SupplierPayment,
    Transaction,
    User,
} from "@/types";
import type {
    AuditLogEntry,
    Batch,
    BatchCreateInput,
    BatchUpdateInput,
    CashRegister,
    CashShiftSummary,
    CashTransactionInput,
    CashTransactionResponse,
    ClientUpsertInput,
    Invoice,
    InvoiceCreateInput,
    InvoiceItem,
    LoginCredentials,
    LoginResponse,
    PaginatedResponse,
    PurchaseOrderCreateInput,
    QualityCheckCreateInput,
    QueryParams,
    ReceptionCreateInput,
    SerialNumber,
    SerialNumberCreateInput,
    SerialNumberUpdateInput,
    ShiftCloseInput,
    ShiftCloseResponse,
    ShiftOpenInput,
    ShiftOpenResponse,
    ShiftPaymentCreateInput,
    ShiftPaymentCreateResponse,
    SupplierPaymentCreateInput,
    SupplierUpsertInput,
    UserCreateInput,
    UserUpdateInput,
    InventoryMovement,
    InventoryMovementInput,
} from "@/types/api";
import { httpClient, isApiError } from "./httpClient";

type GenericRecord = Record<string, unknown>;

type ProductUpsertInput =
    Partial<Omit<Product, "id" | "created_at">> & {
        sku: string;
        barcode?: string | null;
        name: string;
        sale_price: number;
        purchase_price?: number;
        cost_price?: number;
        stock_initial?: number;
        status?: "active" | "inactive";
    };

type OrderCreateInput = {
    client_id?: string;
    customer_name?: string;
    counter_user_id?: string;
    counter_name?: string;
    payment_method?: string;
    shipping_method?: "pickup" | "delivery";
    shipping_address?: string;
    estimated_delivery?: string;
    recipient_name?: string;
    recipient_dni?: string;
    delivery_notes?: string;
    notes?: string;
    total_amount?: number;
    items: Array<{ product_id: string; quantity: number }>;
    [key: string]: unknown;
};

type ReturnCreateInput = {
    supplier_id: string;
    notes?: string;
    items: Array<{
        product_id: string;
        quantity: number;
        unit_cost?: number;
        reason?: string;
    }>;
};

type ClientReturnCreateInput = {
    client_id?: string;
    customer_name?: string;
    order_id?: string;
    reason?: string;
    items?: Array<{
        product_id: string;
        quantity: number;
        condition_status?: string;
        unit_price?: number;
    }>;
};

type WarrantyCreateInput = {
    client_id?: string;
    customer_name?: string;
    product_id: string;
    serial_number?: string;
    issue_description: string;
};

type WarrantyStatusUpdateInput = {
    status:
        | "initiated"
        | "received"
        | "in_progress"
        | "resolved"
        | "rejected"
        | "closed"
        | "sent_to_supplier"
        | "supplier_approved"
        | "supplier_rejected";
    resolution_type?: "repaired" | "replaced" | "refunded";
    resolution_notes?: string;
    notes?: string;
};

type CreditNoteCreateInput = {
    client_id: string;
    amount: number;
    reason?: string;
    reference_type?: "return" | "warranty" | "discount" | "other" | "manual";
    reference_id?: string;
    notes?: string;
};

type ReceptionRecord = {
    id: string;
    reception_number: string;
    supplier_name: string;
    po_number?: string;
    reception_date?: string;
    status: "pending_qc" | "approved" | "partially_approved" | "rejected";
    items?: Array<GenericRecord>;
    [key: string]: unknown;
};

function withQuery(path: string, params?: QueryParams): string {
    if (!params) return path;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") continue;
        search.append(key, String(value));
    }
    const query = search.toString();
    return query ? `${path}?${query}` : path;
}

export const api = {
    // ==================== PRODUCTS ====================
    getProducts: (filters?: { supplier_id?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.get<Product[]>(withQuery("/api/products", filters)),
    getProductsPage: (filters?: { supplier_id?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.getWithMeta<Product[]>(withQuery("/api/products", filters)) as Promise<PaginatedResponse<Product[]>>,

    createProduct: (data: ProductUpsertInput) =>
        httpClient.post<Product>("/api/products", data),

    updateProduct: (id: string, data: ProductUpsertInput) =>
        httpClient.put<Product>(`/api/products/${id}`, data),

    uploadProductImage: (dataUrl: string) =>
        httpClient.post<{ image_url: string }>("/api/products/image-upload", { data_url: dataUrl }),

    deleteProduct: (id: string) =>
        httpClient.del<{ success: boolean; message?: string }>(`/api/products/${id}`),

    // ==================== CLIENTS ====================
    getClients: () =>
        httpClient.get<Client[]>("/api/clients"),

    getClient: (id: string) =>
        httpClient.get<Client>(`/api/clients/${id}`),

    createClient: (data: ClientUpsertInput) =>
        httpClient.post<Client>("/api/clients", data),

    updateClient: (id: string, data: ClientUpsertInput) =>
        httpClient.put<Client>(`/api/clients/${id}`, data),

    deleteClient: (id: string) =>
        httpClient.del<{ success: boolean }>(`/api/clients/${id}`),

    // ==================== SUPPLIERS ====================
    getSuppliers: () =>
        httpClient.get<Supplier[]>("/api/suppliers"),

    createSupplier: (data: SupplierUpsertInput) =>
        httpClient.post<Supplier>("/api/suppliers", data),

    updateSupplier: (id: string, data: SupplierUpsertInput) =>
        httpClient.put<Supplier>(`/api/suppliers/${id}`, data),

    deleteSupplier: (id: string) =>
        httpClient.del<{ success: boolean }>(`/api/suppliers/${id}`),

    // ==================== TRANSACTIONS ====================
    getTransactions: (filters?: { supplier_id?: string; client_id?: string; type?: string }) =>
        httpClient.get<Transaction[]>(withQuery("/api/transactions", filters)),

    // ==================== INVENTORY ====================
    getInventory: () =>
        httpClient.get<InventoryItem[]>("/api/inventory"),

    // ==================== ORDERS ====================
    getOrders: (filters?: { client_id?: string; status?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.get<Order[]>(withQuery("/api/orders", filters)),
    getOrdersPage: (filters?: { client_id?: string; status?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.getWithMeta<Order[]>(withQuery("/api/orders", filters)) as Promise<PaginatedResponse<Order[]>>,

    createOrder: (data: OrderCreateInput) =>
        httpClient.post<{ id: string; total_amount: number }>("/api/orders", data),

    updateOrderStatus: (id: string, status: string) =>
        httpClient.put<Order>(`/api/orders/${id}/status`, { status }),

    dispatchOrder: (
        id: string,
        data: {
            shipping_method: "pickup" | "delivery";
            tracking_number?: string;
            estimated_delivery?: string;
            shipping_address?: string;
            recipient_name?: string;
            recipient_dni?: string;
        }
    ) => httpClient.put<Order>(`/api/orders/${id}/dispatch`, data),

    deliverOrder: (
        id: string,
        data: {
            recipient_name: string;
            recipient_dni: string;
            delivery_notes?: string;
        }
    ) => httpClient.put<Order>(`/api/orders/${id}/deliver`, data),

    pickOrderItem: (itemId: string, picked_quantity: number) =>
        httpClient.put<GenericRecord>(`/api/order-items/${itemId}/pick`, { picked_quantity }),

    createInvoiceFromOrder: (
        orderId: string,
        data: {
            invoice_type?: "A" | "B" | "C" | "TK";
            point_of_sale?: number;
            payments?: Array<{ method: string; amount: number }>;
            notes?: string;
        }
    ) => httpClient.post<Invoice>(`/api/orders/${orderId}/invoice`, data),

    getOrderSummary: (id: string) =>
        httpClient.get<{
            order: Order;
            items: Array<GenericRecord>;
            summary: { total_items: number; total_picked: number; completion_percent: number };
        }>(`/api/orders/${id}/summary`),

    // ==================== RETURNS ====================
    getReturns: (filters?: { supplier_id?: string; status?: string }) =>
        httpClient.get<GenericRecord[]>(withQuery("/api/returns", filters)),

    createReturn: (data: ReturnCreateInput) =>
        httpClient.post<{ id: string; return_number: string }>("/api/returns", data),

    approveReturn: (id: string) =>
        httpClient.post<{ success: boolean; message?: string }>(`/api/returns/${id}/approve`),

    getSupplierReturns: () =>
        httpClient.get<GenericRecord[]>("/api/supplier-returns"),

    // ==================== CLIENT RETURNS ====================
    getClientReturns: (filters?: { client_id?: string; status?: string }) =>
        httpClient.get<GenericRecord[]>(withQuery("/api/client-returns", filters)),

    createClientReturn: (data: ClientReturnCreateInput) =>
        httpClient.post<{ id: string } & GenericRecord>("/api/client-returns", data),

    approveClientReturn: (id: string) =>
        httpClient.post<{ success: boolean; message?: string }>(`/api/client-returns/${id}/approve`),

    // ==================== WARRANTIES ====================
    getWarranties: (filters?: { client_id?: string; status?: string }) =>
        httpClient.get<GenericRecord[]>(withQuery("/api/warranties", filters)),

    createWarranty: (data: WarrantyCreateInput) =>
        httpClient.post<GenericRecord>("/api/warranties", data),

    updateWarrantyStatus: (id: string, data: WarrantyStatusUpdateInput) =>
        httpClient.put<GenericRecord>(`/api/warranties/${id}/status`, data),

    // ==================== CREDIT NOTES ====================
    getCreditNotes: (filters?: { client_id?: string }) =>
        httpClient.get<GenericRecord[]>(withQuery("/api/credit-notes", filters)),

    createCreditNote: (data: CreditNoteCreateInput) =>
        httpClient.post<GenericRecord>("/api/credit-notes", data),

    // ==================== SETTINGS ====================
    getCompanyPublicProfile: () =>
        httpClient.get<CompanySettings>("/api/settings/company/public"),

    getCompanySettings: () =>
        httpClient.get<CompanySettings>("/api/settings/company"),

    updateCompanySettings: (settings: CompanySettings) =>
        httpClient.put<{ success: boolean }>("/api/settings/company", settings),

    getAuditLogs: (filters?: { entity_type?: string; entity_id?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.get<AuditLogEntry[]>(withQuery("/api/settings/audit-logs", filters)),
    getAuditLogsPage: (filters?: { entity_type?: string; entity_id?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.getWithMeta<AuditLogEntry[]>(withQuery("/api/settings/audit-logs", filters)) as Promise<PaginatedResponse<AuditLogEntry[]>>,

    // ==================== USERS & AUTH ====================
    login: (credentials: LoginCredentials) =>
        httpClient.post<LoginResponse>("/api/login", credentials),

    getUsers: () =>
        httpClient.get<User[]>("/api/users"),

    createUser: (data: UserCreateInput) =>
        httpClient.post<User>("/api/users", data),

    updateUser: (id: string, data: UserUpdateInput) =>
        httpClient.put<User>(`/api/users/${id}`, data),

    deleteUser: (id: string) =>
        httpClient.del<{ success: boolean; message?: string }>(`/api/users/${id}`),

    // ==================== INVENTORY MOVEMENTS ====================
    getInventoryMovements: (filters?: {
        product_id?: string;
        type?: string;
        start_date?: string;
        end_date?: string;
        limit?: number;
    }) => httpClient.get<InventoryMovement[]>(withQuery("/api/inventory-movements", filters)),

    createInventoryMovement: (data: InventoryMovementInput) =>
        httpClient.post<InventoryMovement>("/api/inventory-movements", data),

    getProductMovements: (productId: string) =>
        httpClient.get<InventoryMovement[]>(`/api/products/${productId}/movements`),

    // ==================== BATCHES ====================
    getBatches: (productId?: string, status?: string) =>
        httpClient.get<Batch[]>(withQuery("/api/batches", { product_id: productId, status })),

    createBatch: (data: BatchCreateInput) =>
        httpClient.post<{ id: string }>("/api/batches", data),

    updateBatch: (id: string, data: BatchUpdateInput) =>
        httpClient.put<Batch>(`/api/batches/${id}`, data),

    // ==================== SERIAL NUMBERS ====================
    getSerialNumbers: (productId?: string, status?: string) =>
        httpClient.get<SerialNumber[]>(withQuery("/api/serials", { product_id: productId, status })),

    createSerialNumber: (data: SerialNumberCreateInput) =>
        httpClient.post<{ id: string }>("/api/serials", data),

    updateSerialNumber: (id: string, data: SerialNumberUpdateInput) =>
        httpClient.put<SerialNumber>(`/api/serials/${id}`, data),

    // ==================== SUPPLIER PAYMENTS ====================
    getSupplierPayments: (supplierId?: string) =>
        httpClient.get<SupplierPayment[]>(withQuery("/api/supplier-payments", { supplier_id: supplierId })),

    createSupplierPayment: (data: SupplierPaymentCreateInput) =>
        httpClient.post<{ success: boolean; ids: string[]; total: number }>("/api/supplier-payments", data),

    // ==================== PURCHASE ORDERS ====================
    getPurchaseOrders: (filters?: { supplier_id?: string; status?: string }) =>
        httpClient.get<PurchaseOrder[]>(withQuery("/api/purchase-orders", filters)),

    getPurchaseOrder: (id: string) =>
        httpClient.get<PurchaseOrder>(`/api/purchase-orders/${id}`),

    createPurchaseOrder: (data: PurchaseOrderCreateInput) =>
        httpClient.post<{ id: string; po_number: string }>("/api/purchase-orders", data),

    updatePurchaseOrderStatus: (id: string, status: string) =>
        httpClient.put<PurchaseOrder>(`/api/purchase-orders/${id}/status`, { status }),

    // ==================== RECEPTIONS ====================
    getReceptions: (filters?: { status?: string; supplier_id?: string }) =>
        httpClient.get<ReceptionRecord[]>(withQuery("/api/receptions", filters)),

    createReception: (data: ReceptionCreateInput) =>
        httpClient.post<{ id: string; reception_number: string }>("/api/receptions", data),

    approveReception: (id: string, approved_by?: string) =>
        httpClient.post<{ success: boolean; message?: string }>(
            `/api/receptions/${id}/approve`,
            approved_by ? { approved_by } : {}
        ),

    // ==================== QUALITY CHECKS ====================
    createQualityCheck: (data: QualityCheckCreateInput) =>
        httpClient.post<{ id: string; success: boolean }>("/api/quality-checks", data),

    // ==================== INVOICING ====================
    getTaxConditions: () =>
        httpClient.get<Array<{ id: string; name: string; code: string }>>("/api/tax-conditions"),

    getInvoices: (filters?: { client_id?: string; status?: string; start_date?: string; end_date?: string }) =>
        httpClient.get<Invoice[]>(withQuery("/api/invoices", filters)),

    getInvoiceItems: (invoiceId: string) =>
        httpClient.get<InvoiceItem[]>(withQuery("/api/invoice-items", { invoice_id: invoiceId })),

    createInvoice: (data: InvoiceCreateInput) =>
        httpClient.post<Invoice>("/api/invoices", data),

    authorizeInvoice: (id: string) =>
        httpClient.post<Invoice>(`/api/invoices/${id}/authorize`),

    // ==================== CASH MANAGEMENT ====================
    getCashRegisters: () =>
        httpClient.get<CashRegister[]>("/api/cash-registers"),

    getOpenShift: async (registerId: string): Promise<CashShiftSummary | null> => {
        try {
            return await httpClient.get<CashShiftSummary>(`/api/cash-registers/${registerId}/shift`);
        } catch (error) {
            if (isApiError(error) && error.status === 404) return null;
            throw error;
        }
    },

    openShift: (registerId: string, data: ShiftOpenInput) =>
        httpClient.post<ShiftOpenResponse>(`/api/cash-registers/${registerId}/open`, data),

    closeShift: (shiftId: string, data: ShiftCloseInput) =>
        httpClient.post<ShiftCloseResponse>(`/api/cash-shifts/${shiftId}/close`, data),

    addShiftPayment: (shiftId: string, data: ShiftPaymentCreateInput) =>
        httpClient.post<ShiftPaymentCreateResponse>(`/api/cash-shifts/${shiftId}/payments`, data),

    createCashTransaction: (data: CashTransactionInput) =>
        httpClient.post<CashTransactionResponse>("/api/cash-transactions", data),
};
