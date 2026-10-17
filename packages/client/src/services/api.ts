/**
 * API service layer - all backend calls.
 * Uses httpClient for auth, error handling, and 401 auto-logout.
 */

import type {
    Client,
    CompanySettings,
    InventoryItem,
    WarehouseLocation,
    Order,
    OrderItem,
    OrderItemAllocation,
    Product,
    ProductCatalogOption,
    ProductCatalogOptionType,
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
    FiscalSaleStatus,
    BulkSupplierPaymentInput,
    BulkSupplierPaymentResponse,
    PendingSupplierInvoiceResponse,
    CustomerCheck,
    OutgoingCheck
} from "@/types/api";
import type { ImportEntity, ImportResponse } from "@wsm/common";
import { httpClient, isApiError } from "./httpClient";

type GenericRecord = Record<string, unknown>;

/** One spreadsheet row as the import sends it: its row number and the cells by column key. */
export type ImportRow = { row: number } & Record<string, string | number | boolean | null>;

/** Funds for "Caja 2" movements (ADR-015); "initial" only sends (opening balance). */
export type TreasuryFund = "drawer" | "treasury" | "bank" | "initial";

/** Bank debit that accompanies a movement or a card settlement (VAT included as debited). */
export type BankChargeConcept = "commission" | "maintenance" | "debits_credits_tax" | "withholding" | "other";

export type BankCharge = {
    concept: BankChargeConcept;
    amount: number;
    vat_rate?: number;
    notes?: string | null;
};

export type VatRate = { id: string; name: string; rate: number; is_default: boolean; active: boolean };

export type VatRateInput = { name: string; rate: number; is_default?: boolean; active?: boolean };

export type BankSummary = {
    balance: number;
    movements: Array<{ id: string; date: string; description: string; reference_type: string; amount: number }>;
};

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

export type PosExceptionType = "price" | "stock_shortage" | "channel_stock_shortage";

export type PosExceptionPriceDetails = {
    source: "offline_pos";
    role?: string;
    lines: Array<{ product_id: string; catalog_price: number; unit_price: number }>;
};

export type PosExceptionStockShortageDetails = {
    offline_captured_at?: string;
    lines: Array<{ product_id: string; requested: number; shortage: number }>;
};

export type PosExceptionReview = {
    decision: "approved" | "rejected";
    notes: string | null;
    order_id: string;
    reviewed_by: string;
    reviewed_at: string;
};

export type PosException = {
    id: number;
    type: PosExceptionType;
    order_id: string;
    customer_name: string | null;
    total_amount: number | null;
    user_id: string;
    user_name: string;
    created_at: string;
    details: PosExceptionPriceDetails | PosExceptionStockShortageDetails | Record<string, unknown>;
    review: PosExceptionReview | null;
};

/** ADR-021: ARCA documents that need someone (conflict, or stuck in verification). */
export type ArcaAlertItem = {
    document_kind: "invoice" | "credit_note";
    id: string;
    letter: string | null;
    point_of_sale: number | null;
    number: number | string | null;
    customer: string | null;
    amount: number;
    alert: "conflict" | "stuck" | "rejected" | "unauthorized";
    status: "arca_conflict" | "authorizing" | "issued";
    created_at?: string | null;
    arca_last_error: string | null;
    arca_requested_at: string | null;
    arca_attempts: number;
};

export type ArcaAlerts = {
    conflicts: number;
    stuck: number;
    rejected: number;
    unauthorized: number;
    stale_minutes: number;
    unauthorized_hours: number;
    items: ArcaAlertItem[];
};

export type PosExceptionReviewInput = {
    decision: "approved" | "rejected";
    notes?: string;
};

export type PosCheckoutInput = {
    idempotency_key: string;
    shift_id: string;
    offline_captured_at?: string;
    customer_name?: string;
    client_id?: string;
    payment_method?: string;
    payments: Array<{ method: string; amount: number }>;
    items: Array<{ product_id: string; quantity: number; unit_price?: number }>;
    emit_invoice?: boolean;
    invoice_type?: string;
    point_of_sale?: number;
};

export type PosCheckoutResult = {
    order_id: string;
    total_amount: number;
    invoice: Invoice | null;
    shift_id: string;
    expected_balance: number;
    idempotent_replay: boolean;
};

type OrderCreateInput = {
    idempotency_key?: string;
    offline_captured_at?: string;
    client_id?: string;
    customer_name?: string;
    counter_user_id?: string;
    counter_name?: string;
    payment_method?: string;
    payments?: Array<{ method: string; amount: number }>;
    shipping_method?: "pickup" | "delivery";
    shipping_address?: string;
    estimated_delivery?: string;
    recipient_name?: string;
    recipient_dni?: string;
    delivery_notes?: string;
    notes?: string;
    total_amount?: number;
    /** Envío (importe final con IVA). Si charge_customer es false queda a cargo del negocio y no se cobra. */
    shipping_charge?: { amount: number; charge_customer: boolean; vat_rate?: number };
    items: Array<{ product_id: string; quantity: number; unit_price?: number; vat_rate?: number }>;
    [key: string]: unknown;
};

export type OrderShippingInput = { amount: number; charge_customer: boolean; vat_rate?: number };

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
    /** Bonificar el envío cobrado (solo tiene efecto si la devolución tiene pedido). */
    refund_shipping?: boolean;
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
    idempotency_key?: string;
    client_id: string;
    /** Invoice the note corrects (ADR-014: required, ARCA needs the associated voucher). */
    invoice_id: string;
    amount: number;
    reason?: string;
    reference_type?: "return" | "warranty" | "discount" | "other" | "manual";
    reference_id?: string;
    notes?: string;
};

export type SupplierInvoiceCreateResult = {
    id: string;
    success: boolean;
    total_amount: number;
    // Neto recibido al costo y diferencia contra el neto de la factura (solo con remitos vinculados).
    receptions_net?: number;
    receptions_difference?: number;
    // ADR-027 (D1): productos cuyo costo (y precio, si lo sigue) cambió con esta factura.
    cost_updates?: Array<{ product_id: string; name?: string; old_cost: number; new_cost: number; new_sale_price?: number }>;
};

type ReceptionRecord = {
    id: string;
    reception_number: string;
    remito_number?: string | null;
    // Factura de proveedor que ya cubre este remito.
    supplier_invoice_id?: string | null;
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
    getProductCatalogOptions: (filters?: { type?: ProductCatalogOptionType; parent_id?: string; include_inactive?: boolean }) =>
        httpClient.get<ProductCatalogOption[]>(withQuery("/api/product-catalog-options", filters)),
    createProductCatalogOption: (data: { type: ProductCatalogOptionType; name: string; parent_id?: string | null; sort_order?: number }) =>
        httpClient.post<ProductCatalogOption>("/api/product-catalog-options", data),
    updateProductCatalogOption: (id: string, data: { name?: string; parent_id?: string | null; active?: boolean; sort_order?: number }) =>
        httpClient.put<ProductCatalogOption>(`/api/product-catalog-options/${id}`, data),

    // ==================== CLIENTS ====================
    getClients: () =>
        httpClient.get<Client[]>("/api/clients"),

    getClient: (id: string) =>
        httpClient.get<Client>(`/api/clients/${id}`),

    createClient: (data: ClientUpsertInput) =>
        httpClient.post<Client>("/api/clients", data),

    updateClient: (id: string, data: ClientUpsertInput) =>
        httpClient.put<Client>(`/api/clients/${id}`, data),

    // ADR-022: only the VAT condition (and the CUIT it may need), at the moment of use.
    setClientTaxCondition: (id: string, data: { tax_condition_id: string; tax_id?: string | null }) =>
        httpClient.put<Client>(`/api/clients/${id}/tax-condition`, data),

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

    // ==================== IMPORTS (spreadsheets) ====================
    // Checks every row of a file and says what would happen, without saving.
    previewImport: (entity: ImportEntity, data: { rows: ImportRow[]; update_existing: boolean }) =>
        httpClient.post<ImportResponse>(`/api/imports/${entity}/preview`, data),

    // Saves one batch of rows (IMPORT_BATCH_ROWS at most).
    commitImport: (entity: ImportEntity, data: { rows: ImportRow[]; update_existing: boolean; batch_id: string }) =>
        httpClient.post<ImportResponse>(`/api/imports/${entity}/commit`, data),

    // ==================== TRANSACTIONS ====================
    getTransactions: (filters?: { supplier_id?: string; client_id?: string; type?: string; start_date?: string; end_date?: string }) =>
        httpClient.get<Transaction[]>(withQuery("/api/transactions", filters)),

    // ==================== INVENTORY ====================
    getInventory: () =>
        httpClient.get<InventoryItem[]>("/api/inventory"),
    getWarehouseLocations: () =>
        httpClient.get<WarehouseLocation[]>("/api/inventory/locations"),
    createWarehouseLocation: (data: { code: string; name: string; description?: string; is_sales_floor?: boolean }) =>
        httpClient.post<WarehouseLocation>("/api/inventory/locations", data),
    updateWarehouseLocation: (id: string, data: { code?: string; name?: string; description?: string | null; active?: boolean; is_sales_floor?: boolean }) =>
        httpClient.put<WarehouseLocation>(`/api/inventory/locations/${id}`, data),
    getStockAuditDashboard: (filters?: { status?: import("@/types").StockAuditStatus; abc_class?: import("@/types").StockAuditScope; location_code?: string }) =>
        httpClient.get<import("@/types").StockAuditDashboard>(withQuery("/api/inventory/audits/dashboard", filters)),
    getStockAudit: (id: string) =>
        httpClient.get<import("@/types").StockAuditSession>(`/api/inventory/audits/${id}`),
    createStockAudit: (data: { location_code: string; abc_class: import("@/types").StockAuditScope; notes?: string | null }) =>
        httpClient.post<import("@/types").StockAuditSession>("/api/inventory/audits", data),
    countStockAuditItem: (id: string, data: { code: string; quantity: number; notes?: string | null }) =>
        httpClient.post<import("@/types").StockAuditSession>(`/api/inventory/audits/${id}/counts`, data),
    completeStockAudit: (id: string) =>
        httpClient.post<import("@/types").StockAuditSession>(`/api/inventory/audits/${id}/complete`),
    cancelStockAudit: (id: string) =>
        httpClient.post<import("@/types").StockAuditSession>(`/api/inventory/audits/${id}/cancel`),
    applyStockAuditAdjustments: (id: string) =>
        httpClient.post<import("@/types").StockAuditSession>(`/api/inventory/audits/${id}/adjust`),

    // ==================== ORDERS ====================
    getOrders: (filters?: { client_id?: string; status?: string; shipping_method?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.get<Order[]>(withQuery("/api/orders", filters)),
    getOrdersPage: (filters?: { client_id?: string; status?: string; shipping_method?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.getWithMeta<Order[]>(withQuery("/api/orders", filters)) as Promise<PaginatedResponse<Order[]>>,

    createOrder: (data: OrderCreateInput) =>
        httpClient.post<{ id: string; total_amount: number }>("/api/orders", data),

    updateOrderShipping: (orderId: string, body: OrderShippingInput) =>
        httpClient.put<{ id: string; total_amount: number; shipping: unknown }>(`/api/orders/${orderId}/shipping`, body),

    // Counter sale in one server transaction: sale + stock + optional invoice + cash-shift payments.
    posCheckout: (data: PosCheckoutInput) =>
        httpClient.post<PosCheckoutResult>("/api/pos/checkout", data),

    // Offline POS sales that broke a rule (ADR-010): pending/reviewed exceptions for manager review.
    getPosExceptions: (status?: "pending" | "reviewed", limit?: number) =>
        httpClient.get<PosException[]>(withQuery("/api/pos/exceptions", { status, limit })),

    reviewPosException: (id: number, data: PosExceptionReviewInput) =>
        httpClient.post<{ id: number; decision: "approved" | "rejected"; notes: string | null }>(
            `/api/pos/exceptions/${id}/review`,
            data
        ),

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

    checkoutPickupOrder: (
        orderId: string,
        data: {
            recipient_name?: string | undefined;
            recipient_dni?: string | undefined;
            delivery_notes?: string | undefined;
            shift_id?: string | undefined;
            invoice_type?: "A" | "B" | "C" | "TK" | undefined;
            point_of_sale?: number | undefined;
            payments?: Array<{ method: string; amount: number }> | undefined;
            extra_items?: Array<{
                product_id: string;
                quantity: number;
                unit_price?: number;
            }> | undefined;
            notes?: string | undefined;
        }
    ) => httpClient.post<{ order: Order; invoice: Invoice }>(`/api/orders/${orderId}/pickup-checkout`, data),

    getOrderSummary: (id: string) =>
        httpClient.get<{
            order: Order;
            items: OrderItem[];
            allocations?: OrderItemAllocation[];
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

    getSizeColorAnalytics: () =>
        httpClient.get<Array<{ category: string; size: string; units_sold: number }>>("/api/dashboard/size-color-analytics"),

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
    // ADR-024: internal notes (annulment of an invoice ARCA did not authorize) only on request.
    getCreditNotes: (filters?: { client_id?: string; include_internal?: "true" }) =>
        httpClient.get<GenericRecord[]>(withQuery("/api/credit-notes", filters)),

    getTreasury: () =>
        httpClient.get<{ balance: number; movements: Array<{ id: string; date: string; description: string; reference_type: string; amount: number }> }>("/api/treasury"),
    createTreasuryTransfer: (data: { idempotency_key: string; from: TreasuryFund; to: Exclude<TreasuryFund, "initial">; amount: number; cash_register_id?: string; notes?: string | null; charges?: BankCharge[] }) =>
        httpClient.post<{ id: string; amount: number; charges_total?: number; idempotent_replay?: boolean }>("/api/treasury/transfers", data),

    getCardSettlements: () =>
        httpClient.get<{ pending_balance: number; settlements: Array<{ id: string; amount: number; description: string; date: string }> }>("/api/card-settlements"),
    createCardSettlement: (data: { idempotency_key: string; amount: number; fee_amount?: number; fee_vat_rate?: number; charges?: BankCharge[]; reference?: string | null }) =>
        httpClient.post<{ id: string; amount: number; deposited?: number; idempotent_replay?: boolean }>("/api/card-settlements", data),

    getBank: () =>
        httpClient.get<BankSummary>("/api/bank"),
    createBankCharges: (data: { idempotency_key: string; date?: string | null; reference?: string | null; charges: BankCharge[] }) =>
        httpClient.post<{ id: string; total: number; idempotent_replay?: boolean }>("/api/bank/charges", data),

    getVatRates: (all = false) =>
        httpClient.get<VatRate[]>(withQuery("/api/vat-rates", all ? { all: "true" } : undefined)),
    createVatRate: (data: VatRateInput) =>
        httpClient.post<VatRate>("/api/vat-rates", data),
    updateVatRate: (id: string, data: VatRateInput) =>
        httpClient.put<VatRate>(`/api/vat-rates/${id}`, data),

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
        httpClient.post<{ success: boolean; syncedCount: number; skippedCount: number; failures: Array<{ externalId: string; message: string }>; pages: number }>("/api/integrations/tiendanube/sync-orders"),

    autoLinkTiendanubeCatalog: () =>
        httpClient.post<{ success: boolean; totalVariantsFound: number; linkedCount: number }>("/api/integrations/tiendanube/auto-link"),

    getFailedSyncs: () =>
        httpClient.get<FailedSync[]>("/api/integrations/tiendanube/failed-syncs"),

    retryFailedSync: (id: string) =>
        httpClient.post<{ success: boolean; message: string }>(`/api/integrations/tiendanube/failed-syncs/${id}/retry`),

    retryAllFailedSyncs: () =>
        httpClient.post<{ success: boolean; message: string }>("/api/integrations/tiendanube/failed-syncs/retry-all"),

    getTiendanubeStatus: () =>
        httpClient.get<import("@/types").TiendaNubeIntegrationStatus>("/api/integrations/tiendanube/status"),

    getTiendanubeConfig: () =>
        httpClient.get<import("@/types").TiendaNubeIntegrationConfig>("/api/integrations/tiendanube/config"),

    updateTiendanubeConfig: (config: { clientId: string; clientSecret?: string; locationId: string; safetyStockEnabled?: boolean; safetyStock?: number }) =>
        httpClient.patch<import("@/types").TiendaNubeIntegrationConfig>("/api/integrations/tiendanube/config", config),

    getOnlineStoreOverview: () =>
        httpClient.get<import("@/types/onlineStore").OnlineStoreOverview>("/api/integrations/tiendanube/operations/overview"),

    getOnlineCatalog: (filters?: { page?: number; limit?: number; q?: string; visibility?: string; sync_status?: string }) =>
        httpClient.getWithMeta<import("@/types/onlineStore").OnlineCatalogFamily[]>(
            withQuery("/api/integrations/tiendanube/operations/catalog", filters)
        ) as Promise<PaginatedResponse<import("@/types/onlineStore").OnlineCatalogFamily[]>>,

    createOnlineProduct: (data: import("@/types/onlineStore").OnlineProductDraft) =>
        httpClient.post<import("@/types/onlineStore").OnlineCatalogFamily>("/api/integrations/tiendanube/operations/catalog", {
            ...data,
            description: data.description?.trim() || null,
            brand: data.brand?.trim() || null,
            category: data.category?.trim() || null,
            variants: data.variants.map((variant) => ({
                ...variant,
                sku: variant.sku.trim(),
                barcode: variant.barcode?.trim() || null,
                size: variant.size?.trim() || null,
                color: variant.color?.trim() || null,
                image_url: variant.image_url?.trim() || null,
            })),
        }),

    updateOnlineProduct: (id: string, data: Partial<Pick<import("@/types/onlineStore").OnlineProductDraft, "name" | "description" | "brand" | "category" | "visibility">>) =>
        httpClient.put<import("@/types/onlineStore").OnlineCatalogFamily>(`/api/integrations/tiendanube/operations/catalog/${id}`, data),

    archiveOnlineProduct: (id: string) =>
        httpClient.del<{ success: boolean }>(`/api/integrations/tiendanube/operations/catalog/${id}`),

    publishOnlineProduct: (id: string) =>
        httpClient.post<{ success: boolean; remoteProductId: string }>(`/api/integrations/tiendanube/operations/catalog/${id}/publish`),

    importOnlineCatalog: (q?: string) =>
        httpClient.post<{ success: boolean; processed: number; succeeded: number; failures: Array<{ id?: string; message: string }> }>(
            "/api/integrations/tiendanube/operations/catalog/import", q ? { q } : {}
        ),

    getOnlineOrders: (filters?: { page?: number; limit?: number; q?: string; payment_status?: string; shipping_status?: string; from?: string; to?: string }) =>
        httpClient.getWithMeta<import("@/types/onlineStore").OnlineOrder[]>(
            withQuery("/api/integrations/tiendanube/operations/orders", filters)
        ) as Promise<PaginatedResponse<import("@/types/onlineStore").OnlineOrder[]>>,

    getOnlineCustomers: (filters?: { page?: number; limit?: number; q?: string }) =>
        httpClient.getWithMeta<import("@/types/onlineStore").OnlineCustomer[]>(
            withQuery("/api/integrations/tiendanube/operations/customers", filters)
        ) as Promise<PaginatedResponse<import("@/types/onlineStore").OnlineCustomer[]>>,

    getOnlineFulfillments: (filters?: { page?: number; limit?: number; q?: string; shipping_status?: string }) =>
        httpClient.getWithMeta<import("@/types/onlineStore").OnlineFulfillment[]>(
            withQuery("/api/integrations/tiendanube/operations/fulfillments", filters)
        ) as Promise<PaginatedResponse<import("@/types/onlineStore").OnlineFulfillment[]>>,

    syncOnlineFulfillments: () =>
        httpClient.post<{ success: boolean; orders: number; synced: number; failures: Array<{ externalId: string; message: string }> }>(
            "/api/integrations/tiendanube/operations/fulfillments/sync"
        ),

    updateOnlineFulfillment: (id: string, data: { status?: string; tracking_code?: string | null; tracking_url?: string | null; notify_customer?: boolean }) =>
        httpClient.patch<import("@/types/onlineStore").OnlineFulfillment>(`/api/integrations/tiendanube/operations/fulfillments/${id}`, data),

    createOnlineTrackingEvent: (id: string, data: { status: string; description: string; address?: string | null; happened_at?: string; estimated_delivery_at?: string | null }) =>
        httpClient.post<Record<string, unknown>>(`/api/integrations/tiendanube/operations/fulfillments/${id}/tracking-events`, data),

    getOnlineStoreAnalytics: () =>
        httpClient.get<import("@/types/onlineStore").OnlineStoreAnalytics>("/api/integrations/tiendanube/operations/analytics"),

    getOnlineSyncCenter: () =>
        httpClient.get<import("@/types/onlineStore").OnlineSyncCenter>("/api/integrations/tiendanube/operations/sync-center"),

    ensureTiendanubeWebhook: () =>
        httpClient.post<{ success: boolean; configured: boolean; created?: boolean }>("/api/integrations/tiendanube/webhook/ensure"),

    disconnectTiendanube: () =>
        httpClient.post<{ success: boolean; removed: number }>("/api/integrations/tiendanube/disconnect"),

    testAfipConnection: (billing: NonNullable<CompanySettings["billing"]>) =>
        httpClient.post<{ success: boolean; logs: string[]; nextVoucherNumber: number }>("/api/settings/afip/test-connection", billing),

    getAuditLogs: (filters?: { entity_type?: string; entity_id?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.get<AuditLogEntry[]>(withQuery("/api/settings/audit-logs", filters)),
    getAuditLogsPage: (filters?: { entity_type?: string; entity_id?: string; page?: number; limit?: number; offset?: number }) =>
        httpClient.getWithMeta<AuditLogEntry[]>(withQuery("/api/settings/audit-logs", filters)) as Promise<PaginatedResponse<AuditLogEntry[]>>,

    // ==================== USERS & AUTH ====================
    login: (credentials: LoginCredentials) =>
        httpClient.post<LoginResponse>("/api/login", credentials),

    getSession: () =>
        httpClient.get<LoginResponse>("/api/session"),

    logout: () =>
        httpClient.post<void>("/api/logout"),

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
        reception_ids?: string[];
        purchase_order_id?: string;
        issue_date: string;
        due_date?: string;
        net_amount: number;
        vat_amount: number;
        vat_rate?: number;
        purchase_kind?: "goods" | "shipping" | "expense";
        vat_lines?: Array<{ vat_rate: number; net_amount: number; vat_amount: number }>;
        other_taxes?: number;
        total_amount?: number;
        notes?: string;
    }) => httpClient.post<SupplierInvoiceCreateResult>("/api/supplier-invoices", data),

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
    // ADR-022: annul an invoice ARCA never authorized and issue it again (letter and/or customer).
    reissueInvoice: (id: string, data: { invoice_type?: "A" | "B" | "C" | "TK"; client_id?: string | null }) =>
        httpClient.post<Invoice>(`/api/invoices/${id}/reissue`, data),

    getArcaAlerts: () =>
        httpClient.get<ArcaAlerts>("/api/fiscal/arca-alerts"),

    getTaxConditions: () =>
        httpClient.get<Array<{ id: string; name: string; code: string }>>("/api/tax-conditions"),

    getInvoices: (filters?: { client_id?: string; status?: string; start_date?: string; end_date?: string }) =>
        httpClient.get<Invoice[]>(withQuery("/api/invoices", filters)),

    getInvoice: (id: string) =>
        httpClient.get<Invoice>(`/api/invoices/${id}`),

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
    getFiscalSalesStatus: () =>
        httpClient.get<FiscalSaleStatus[]>("/api/collections/fiscal-status"),

    registerBulkInvoicePayments: (data: BulkPaymentInput) =>
        httpClient.post<BulkPaymentResponse>("/api/collections", data),
    getCustomerChecks: (filters?: { status?: string }) =>
        httpClient.get<CustomerCheck[]>(withQuery("/api/checks", filters)),
    getCustomerCheck: (id: string) =>
        httpClient.get<CustomerCheck>(`/api/checks/${id}`),
    updateCustomerCheckStatus: (id: string, data: { status: CustomerCheck["status"]; notes?: string; delivered_to?: string }) =>
        httpClient.put<CustomerCheck>(`/api/checks/${id}/status`, data),

    // ==================== SUPPLIER PAYMENTS (PAGOS PROVEEDORES) ====================
    getPendingSupplierInvoices: (filters?: { supplier_id?: string }) =>
        httpClient.get<PendingSupplierInvoiceResponse[]>("/api/supplier-invoices/pending" + (filters?.supplier_id ? `?supplier_id=${filters.supplier_id}` : "")),

    registerBulkSupplierPayments: (data: BulkSupplierPaymentInput) =>
        httpClient.post<BulkSupplierPaymentResponse>("/api/supplier-payments/bulk", data),

    getOutgoingChecks: (filters?: { status?: string }) =>
        httpClient.get<OutgoingCheck[]>(withQuery("/api/outgoing-checks", filters)),
    getOutgoingCheck: (id: string) =>
        httpClient.get<OutgoingCheck>(`/api/outgoing-checks/${id}`),
    updateOutgoingCheckStatus: (id: string, data: { status: OutgoingCheck["status"]; notes?: string }) =>
        httpClient.put<OutgoingCheck>(`/api/outgoing-checks/${id}/status`, data),



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

    reverseJournalEntry: (id: string) =>
        httpClient.post<GenericRecord>(`/api/accounting/journal-entries/${id}/reverse`),

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
