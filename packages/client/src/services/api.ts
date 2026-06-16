/**
 * API service layer - all backend calls.
 * Uses httpClient for auth, error handling, and 401 auto-logout.
 */

import type {
    Client,
    CompanySettings,
    InventoryItem,
    Order,
    OrderItem,
    Product,
    PurchaseOrder,
    Supplier,
    SupplierPayment,
    Transaction,
    User,
    FailedSync,
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
    InvoicePaymentRegisterInput,
    InvoicePaymentRegisterResponse,
    BulkPaymentInput,
    BulkPaymentResponse,
    PendingInvoiceResponse,
    BulkSupplierPaymentInput,
    BulkSupplierPaymentResponse,
    PendingSupplierInvoiceResponse
} from "@/types/api";
import { httpClient, isApiError } from "./httpClient";

type GenericRecord = Record<string, unknown>;

export type ReturnsAnalyticsResponse = {
    totalLossAmount?: number;
    topReasons?: Array<{
        reason: string;
        count: number;
    }>;
    topDefectiveProducts?: Array<{
        name: string;
        count: number;
    }>;
};

export type DashboardStatsResponse = {
    salesToday: number;
    salesYesterday: number;
    todayOperations: number;
    pendingOrders: number;
    readyToDispatch: number;
    lowStockCount: number;
    completionRate: number;
    closedOrdersCount: number;
    totalActionable: number;
    dailySalesHistory?: Array<{
        label: string;
        amount: number;
    }>;
    activities?: Array<{
        id: string;
        title: string;
        date?: string;
        amount?: number;
        positive?: boolean;
    }>;
    pickerLeaderboard?: Array<{
        picker_name: string;
        sessions_count: number;
        total_picked: number;
        avg_duration_sec: number;
        shortage_count: number;
    }>;
};

export type ChartAccountResponse = {
    code: string;
    name: string;
    type: "asset" | "liability" | "equity" | "revenue" | "expense";
    active: boolean;
    total_debit: number;
    total_credit: number;
    balance: number;
};

export type JournalEntryResponse = {
    id: string;
    entry_number: number;
    date: string;
    description: string;
    reference_type: string;
    reference_id: string;
    lines: Array<{
        id: string;
        account_code: string;
        account_name: string;
        account_type: string;
        debit: number;
        credit: number;
        notes: string;
    }>;
};

export type TrialBalanceItemResponse = {
    code: string;
    name: string;
    type: string;
    initial_balance: number;
    debit: number;
    credit: number;
    final_balance: number;
};

export type IncomeStatementResponse = {
    revenues: Array<{ code: string; name: string; balance: number }>;
    expenses: Array<{ code: string; name: string; balance: number }>;
    total_revenues: number;
    total_expenses: number;
    net_result: number;
};

export type BalanceSheetAccount = {
    code: string;
    name: string;
    balance: number;
};

export type BalanceSheetResponse = {
    assets: {
        corriente: BalanceSheetAccount[];
        no_corriente: BalanceSheetAccount[];
    };
    liabilities: {
        corriente: BalanceSheetAccount[];
        no_corriente: BalanceSheetAccount[];
    };
    equity: {
        items: BalanceSheetAccount[];
    };
    totals: {
        total_assets: number;
        total_liabilities: number;
        total_equity: number;
        total_liabilities_and_equity: number;
        discrepancy: number;
    };
};

export type SupplierInvoiceResponse = {
    id: string;
    invoice_type: "A" | "B" | "C" | "M";
    invoice_number: string;
    issue_date: string;
    due_date?: string;
    status?: string;
    created_at?: string;
    supplier_name: string;
    supplier_tax_id?: string;
    reception_number?: string;
    po_number?: string;
    net_amount: number;
    vat_amount: number;
    total_amount: number;
};

export type TraceabilityEvent = {
    id: string;
    occurred_at: string;
    event_type: "inventory_movement" | "batch" | "serial" | "audit" | string;
    title: string;
    description: string;
    product_id?: string | null;
    product_name?: string | null;
    sku?: string | null;
    quantity?: number | null;
    from_location?: string | null;
    to_location?: string | null;
    reference_type?: string | null;
    reference_id?: string | null;
    actor_name?: string | null;
    source_table: string;
    metadata?: GenericRecord;
};

export type TraceabilityTimelineFilters = {
    product_id?: string;
    sku?: string;
    barcode?: string;
    limit?: number;
};

type ManualJournalEntryInput = {
    date: string;
    description: string;
    lines: Array<{
        account_code: string;
        debit: number;
        credit: number;
        notes: string | null;
    }>;
};

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
    getTransactions: (filters?: { supplier_id?: string; client_id?: string; type?: string; start_date?: string; end_date?: string }) =>
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

    recordPickingEvent: (
        orderId: string,
        data: {
            product_id: string;
            action_type: string;
            location_code?: string | undefined;
            barcode_scanned?: string | undefined;
            quantity?: number;
        }
    ) => httpClient.post<GenericRecord>(`/api/orders/${orderId}/picking-event`, data),

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
            items: OrderItem[];
            summary: { total_items: number; total_picked: number; completion_percent: number };
            picking_session?: {
                id: string;
                order_id: string;
                picker_id: string;
                picker_name?: string;
                status: string;
                started_at: string;
                completed_at: string | null;
                total_items_requested: number;
                total_items_picked: number;
            } | null;
        }>(`/api/orders/${id}/summary`),

    // ==================== DASHBOARD ====================
    getDashboardStats: () =>
        httpClient.get<DashboardStatsResponse>("/api/dashboard/stats"),

    // ==================== RETURNS ====================
    getReturns: (filters?: { supplier_id?: string; status?: string }) =>
        httpClient.get<GenericRecord[]>(withQuery("/api/returns", filters)),

    createReturn: (data: ReturnCreateInput) =>
        httpClient.post<{ id: string; return_number: string }>("/api/returns", data),

    approveReturn: (id: string) =>
        httpClient.post<{ success: boolean; message?: string }>(`/api/returns/${id}/approve`),

    getSupplierReturns: (filters?: { supplier_id?: string }) =>
        httpClient.get<GenericRecord[]>(withQuery("/api/supplier-returns", filters)),

    // ==================== CLIENT RETURNS ====================
    getClientReturns: (filters?: { client_id?: string; status?: string }) =>
        httpClient.get<GenericRecord[]>(withQuery("/api/client-returns", filters)),

    getReturnsAnalytics: () =>
        httpClient.get<ReturnsAnalyticsResponse>("/api/client-returns/analytics"),

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

    authorizeCreditNote: (id: string) =>
        httpClient.post<GenericRecord>(`/api/credit-notes/${id}/authorize`),

    // ==================== SETTINGS ====================
    getCompanyPublicProfile: () =>
        httpClient.get<CompanySettings>("/api/settings/company/public"),

    getCompanySettings: () =>
        httpClient.get<CompanySettings>("/api/settings/company"),

    updateCompanySettings: (settings: CompanySettings) =>
        httpClient.put<{ success: boolean }>("/api/settings/company", settings),

    syncTiendanubeOrders: () =>
        httpClient.post<{ success: boolean; syncedCount: number }>("/api/integrations/tiendanube/sync-orders"),

    autoLinkTiendanubeCatalog: () =>
        httpClient.post<{ success: boolean; totalVariantsFound: number; linkedCount: number }>("/api/integrations/tiendanube/auto-link"),

    getFailedSyncs: () =>
        httpClient.get<FailedSync[]>("/api/integrations/tiendanube/failed-syncs"),

    retryFailedSync: (id: string) =>
        httpClient.post<{ success: boolean; message: string }>(`/api/integrations/tiendanube/failed-syncs/${id}/retry`),

    retryAllFailedSyncs: () =>
        httpClient.post<{ success: boolean; message: string }>("/api/integrations/tiendanube/failed-syncs/retry-all"),

    testAfipConnection: (billing: NonNullable<CompanySettings["billing"]>) =>
        httpClient.post<{ success: boolean; logs: string[]; nextVoucherNumber: number }>("/api/settings/afip/test-connection", billing),

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

    // ==================== SUPPLIER INVOICES ====================
    getSupplierInvoices: (filters?: { supplier_id?: string; status?: string }) =>
        httpClient.get<SupplierInvoiceResponse[]>(withQuery("/api/supplier-invoices", filters)),

    createSupplierInvoice: (data: {
        invoice_number: string;
        invoice_type: "A" | "B" | "C" | "M";
        supplier_id: string;
        reception_id?: string;
        purchase_order_id?: string;
        issue_date: string;
        due_date?: string;
        net_amount: number;
        vat_amount: number;
        other_taxes?: number;
        total_amount?: number;
        notes?: string;
    }) => httpClient.post<{ id: string; success: boolean; total_amount: number }>("/api/supplier-invoices", data),

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
    getIVACompras: () =>
        httpClient.get<Array<{
            date: string
            type: string
            number: string
            tax_id: string
            supplier_name: string
            subtotal: number
            iva: number
            total: number
        }>>("/api/iva-compras"),

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

    registerInvoicePayment: (invoiceId: string, data: InvoicePaymentRegisterInput) =>
        httpClient.post<InvoicePaymentRegisterResponse>(`/api/invoices/${invoiceId}/payments`, data),

    // ==================== COLLECTIONS (CUENTA CORRIENTE) ====================
    getPendingInvoices: (filters?: { client_id?: string }) =>
        httpClient.get<PendingInvoiceResponse[]>("/api/collections/pending-invoices" + (filters?.client_id ? `?client_id=${filters.client_id}` : "")),

    registerBulkInvoicePayments: (data: BulkPaymentInput) =>
        httpClient.post<BulkPaymentResponse>("/api/collections", data),

    // ==================== SUPPLIER PAYMENTS (PAGOS PROVEEDORES) ====================
    getPendingSupplierInvoices: (filters?: { supplier_id?: string }) =>
        httpClient.get<PendingSupplierInvoiceResponse[]>("/api/supplier-invoices/pending" + (filters?.supplier_id ? `?supplier_id=${filters.supplier_id}` : "")),

    registerBulkSupplierPayments: (data: BulkSupplierPaymentInput) =>
        httpClient.post<BulkSupplierPaymentResponse>("/api/supplier-payments/bulk", data),



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

    // ==================== DOUBLE-ENTRY ACCOUNTING ====================
    getChartOfAccounts: () =>
        httpClient.get<ChartAccountResponse[]>("/api/accounting/chart-of-accounts"),

    getJournalEntries: (filters?: { start_date?: string; end_date?: string }) =>
        httpClient.get<JournalEntryResponse[]>(withQuery("/api/accounting/journal-entries", filters)),

    getTrialBalance: (filters?: { start_date?: string; end_date?: string }) =>
        httpClient.get<TrialBalanceItemResponse[]>(withQuery("/api/accounting/trial-balance", filters)),

    getIncomeStatement: (filters?: { start_date?: string; end_date?: string }) =>
        httpClient.get<IncomeStatementResponse>(withQuery("/api/accounting/income-statement", filters)),

    getBalanceSheet: (filters?: { start_date?: string; end_date?: string }) =>
        httpClient.get<BalanceSheetResponse>(withQuery("/api/accounting/balance-sheet", filters)),

    createAccount: (data: { code: string; name: string; type: string; active: boolean }) =>
        httpClient.post<GenericRecord>("/api/accounting/chart-of-accounts", data),

    updateAccount: (code: string, data: { name: string; active: boolean }) =>
        httpClient.put<GenericRecord>(`/api/accounting/chart-of-accounts/${code}`, data),

    deleteAccount: (code: string) =>
        httpClient.del<GenericRecord>(`/api/accounting/chart-of-accounts/${code}`),

    createManualJournalEntry: (data: ManualJournalEntryInput) =>
        httpClient.post<GenericRecord>("/api/accounting/journal-entries", data),

    updateJournalEntry: (id: string, data: GenericRecord) =>
        httpClient.put<GenericRecord>(`/api/accounting/journal-entries/${id}`, data),

    reverseJournalEntry: (id: string) =>
        httpClient.post<GenericRecord>(`/api/accounting/journal-entries/${id}/reverse`),

    deleteJournalEntry: (id: string) =>
        httpClient.del<GenericRecord>(`/api/accounting/journal-entries/${id}`),

    // ==================== WMS TRANSFER ====================
    transferStock: (data: { product_id: string; from_location: string; to_location: string; quantity: number }) =>
        httpClient.post<GenericRecord>("/api/inventory/transfer", data),

    // ==================== TRACEABILITY ====================
    traceability: {
        getTimeline: (filters: TraceabilityTimelineFilters) =>
            httpClient.get<TraceabilityEvent[]>(withQuery("/api/traceability/timeline", filters)),
    },

    // ==================== INVENTORY NAMESPACE ====================
    inventory: {
        getProducts: (filters?: QueryParams) => httpClient.get<Product[]>(withQuery("/api/products", filters)),
        bulkUpdateTiendaNube: (products: {id: string, tiendanube_sync_enabled: boolean, tiendanube_product_id: string, tiendanube_variant_id: string}[]) =>
            httpClient.post<GenericRecord>("/api/products/tiendanube/bulk-update", { products }),
    },
};
