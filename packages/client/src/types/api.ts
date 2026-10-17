import type {
    Client,
    CompanySettings,
    Order,
    Product,
    PurchaseOrder,
    Supplier,
    SupplierPayment,
    Transaction,
    User,
} from "@/types";

export interface LoginCredentials {
    email: string;
    password: string;
}

export interface LoginResponse {
    user: User;
}

export type QueryPrimitive = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryPrimitive>;

export interface PaginationMeta {
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface PaginatedResponse<T> {
    data: T;
    pagination?: PaginationMeta;
}

type ClientEditableFields = Pick<Client, "name" | "email" | "phone" | "tax_id" | "address" | "credit_limit"> & { tax_condition_id?: string | null };
// `expected`: the values the edit form loaded (AUD-009), so a save over someone else's change is refused.
export type ClientUpsertInput = ClientEditableFields & { expected?: Partial<{ [K in keyof ClientEditableFields]: ClientEditableFields[K] | null }> };
export type SupplierUpsertInput = Pick<Supplier, "name" | "tax_id" | "contact_name" | "email" | "phone" | "address"> & { category?: string | null };

export type UserRole = User["role"];
export type UserStatus = User["status"];

export interface UserFormValues {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    status: UserStatus;
}

export interface UserCreateInput {
    name: string;
    email: string;
    password: string;
    role: UserRole;
}

export interface UserUpdateInput {
    name: string;
    email: string;
    password?: string;
    role: UserRole;
    status: UserStatus;
}

export interface AuditLogEntry {
    id: string;
    user_id?: string | null;
    user_name?: string | null;
    user_email?: string | null;
    action: string;
    entity_type: string;
    entity_id?: string | null;
    old_values?: string | null;
    new_values?: string | null;
    ip_address?: string | null;
    created_at: string;
}

export type InventoryMovementInput = {
    type: string;
    product_id: string;
    from_location?: string;
    to_location?: string;
    quantity: number;
    unit_cost?: number;
    reason?: string;
    notes?: string;
    performed_by?: string;
};

export type InventoryMovement = InventoryMovementInput & {
    id: string;
    created_at?: string;
};

export type Batch = {
    id: string;
    product_id: string;
    batch_number: string;
    quantity_initial: number;
    quantity_current: number;
    status?: string;
    location?: string | null;
    expiration_date?: string | null;
    created_at?: string;
};

export type BatchCreateInput = {
    product_id: string;
    batch_number: string;
    manufacturing_date?: string;
    expiration_date?: string;
    supplier_id?: string;
    quantity_initial: number;
    location?: string;
    notes?: string;
};

export type BatchUpdateInput = {
    quantity_current: number;
    status?: string;
};

export type SerialNumber = {
    id: string;
    product_id: string;
    serial_number: string;
    status: string;
    location?: string | null;
    created_at?: string;
};

export type SerialNumberCreateInput = {
    product_id: string;
    serial_number: string;
    batch_id?: string;
    location?: string;
    warranty_months?: number;
};

export type SerialNumberUpdateInput = {
    status: string;
    sold_to_client_id?: string;
    sold_in_order_id?: string;
    location?: string;
};

export interface SupplierPaymentLineInput {
    amount: number;
    payment_method?: string;
    reference_number?: string;
}

export interface SupplierPaymentCreateInput {
    /** One key per payment attempt: a retry does not pay twice (ADR-015). */
    idempotency_key?: string;
    supplier_id: string;
    /** Drawer the cash comes from when more than one register is open (ADR-014). */
    cash_register_id?: string;
    payment_date: string;
    notes?: string;
    payments: SupplierPaymentLineInput[];
}

export type PurchaseOrderCreateInput = {
    supplier_id: string;
    order_date: string;
    expected_delivery_date?: string;
    items: Array<{
        product_id: string;
        quantity_ordered: number;
        unit_cost: number;
    }>;
    notes?: string;
};

export type ReceptionCreateInput = {
    purchase_order_id?: string;
    supplier_id: string;
    remito_number?: string;
    items: Array<{
        product_id: string;
        po_item_id?: string;
        quantity_expected?: number;
        quantity_received: number;
        unit_cost: number;
        location_assigned?: string;
        batch_number?: string;
        expiration_date?: string;
        status?: "approved" | "rejected";
        notes?: string;
    }>;
    notes?: string;
};

export type QualityCheckCreateInput = {
    reception_id: string;
    product_id: string;
    inspector_id?: string;
    result: "pass" | "fail" | "conditional";
    quantity_checked: number;
    quantity_passed: number;
    quantity_failed: number;
    defect_description?: string;
    action_taken?: "approve" | "reject" | "return_to_supplier" | "discount";
    notes?: string;
};

export type Invoice = {
    id: string;
    client_id?: string;
    status?: string;
    invoice_type?: string;
    point_of_sale?: number;
    invoice_number?: number;
    total_amount: number;
    payment_status?: "pending" | "partial" | "paid";
    payment_method?: string | null;
    issue_date?: string;
    due_date?: string;
    created_at?: string;
    customer_name?: string;
    cae?: string;
    cae_expiration_date?: string;
    // ARCA tracking (ADR-020): last rejection / failure text, attempts and when the request was sent.
    arca_last_error?: string | null;
    arca_attempts?: number;
    arca_requested_at?: string | null;
    items?: InvoiceItem[];
    [key: string]: unknown;
};

export type InvoiceItem = {
    id?: string;
    invoice_id?: string;
    product_id?: string | null;
    description?: string;
    product_name?: string;
    sku?: string | null;
    quantity: number;
    unit_price: number;
    vat_rate?: number;
    total_line?: number;
};

export type InvoiceCreateInput = Record<string, unknown>;

export type InvoicePaymentLineInput = {
    method: "cash" | "transfer" | "credit_account" | "card" | "debit_card" | "credit_card" | "qr" | "check";
    amount: number;
    check?: {
        issuer_name: string;
        bank_name: string;
        check_number: string;
        issue_date?: string;
        due_date: string;
        instrument_amount?: number;
        source_type?: "own" | "third_party";
        source_customer_check_id?: string;
    };
};

export type InvoicePaymentRegisterInput = {
    payments: InvoicePaymentLineInput[];
    notes?: string;
};

export type InvoicePaymentRegisterResponse = {
    id: string;
    total_amount: number;
    paid_before: number;
    paid_now: number;
    paid_amount: number;
    pending_amount: number;
    payment_status: "pending" | "partial" | "paid";
};

export type CashRegister = {
    id: string;
    name: string;
    status: "open" | "closed";
    current_shift_id?: string | null;
    opened_at?: string | null;
    opening_balance?: number | null;
    expected_balance?: number | null;
};

export type CashShiftSummary = {
    id: string;
    status: "open" | "closed";
    cash_register_id: string;
    opening_balance: number;
    expected_balance: number;
    actual_balance?: number | null;
    difference?: number | null;
    notes?: string | null;
    opened_at?: string;
    closed_at?: string | null;
    inflow?: number;
    outflow?: number;
};

export type ShiftPaymentCreateInput = {
    order_id?: string;
    payment_method?: string;
    amount: number;
    type?: "sale" | "income" | "refund" | "expense";
};

export type ShiftPaymentCreateResponse = {
    id: string;
    expected_balance: number;
};

export type ShiftOpenInput = {
    opening_balance: number;
    opened_by?: string;
};

export type ShiftCloseInput = {
    actual_balance: number;
    notes?: string;
    closed_by?: string;
};

export type ShiftOpenResponse = {
    id: string;
    success: boolean;
};

export type ShiftCloseResponse = {
    success: boolean;
    expected_balance: number;
    actual_balance: number;
    difference: number;
};

export type CashTransactionInput = {
    register_id: string;
    type: "income" | "expense";
    amount: number;
    reason: string;
    notes?: string;
};

export type CashTransactionResponse = {
    id: string;
    success: boolean;
    expected_balance?: number;
};

export type ApiCatalog = {
    clients: Client[];
    suppliers: Supplier[];
    users: User[];
    products: Product[];
    orders: Order[];
    purchaseOrders: PurchaseOrder[];
    transactions: Transaction[];
    supplierPayments: SupplierPayment[];
    companySettings: CompanySettings;
};

export type BulkPaymentAllocation = {
    invoiceId?: string;
    documentId?: string;
    documentType?: "invoice" | "order";
    payments: InvoicePaymentLineInput[];
};

export type BulkPaymentInput = {
    clientId: string;
    allocations: BulkPaymentAllocation[];
    notes?: string;
};

export type BulkPaymentResponse = {
    success: boolean;
    total_paid: number;
    invoices: Array<{
        invoiceId: string;
        paid_now: number;
        payment_status: "pending" | "partial" | "paid";
    }>;
};

export type CustomerCheck = {
    id: string;
    client_id?: string | null;
    client_name?: string | null;
    issuer_name: string;
    bank_name: string;
    check_number: string;
    amount: number;
    issue_date?: string | null;
    due_date: string;
    status: 'received' | 'deposited' | 'cleared' | 'endorsed' | 'rejected' | 'cancelled';
    received_at: string;
    deposited_at?: string | null;
    cleared_at?: string | null;
    delivered_to?: string | null;
    notes?: string | null;
    allocated_amount?: number;
    invoice_count?: number;
    events?: Array<{
        id: string;
        status: CustomerCheck["status"];
        notes?: string | null;
        performed_by_name?: string | null;
        created_at: string;
    }>;
    allocations?: Array<{
        id: string;
        invoice_id?: string | null;
        invoice_type?: string | null;
        point_of_sale?: number | null;
        invoice_number?: number | string | null;
        amount: number;
        created_at: string;
    }>;
};

export type OutgoingCheck = {
    id: string;
    supplier_id: string;
    supplier_name?: string | null;
    source_type: "own" | "third_party";
    source_customer_check_id?: string | null;
    issuer_name: string;
    bank_name: string;
    check_number: string;
    amount: number;
    issue_date?: string | null;
    due_date: string;
    status: "delivered" | "cleared" | "rejected" | "cancelled";
    delivered_at?: string | null;
    cleared_at?: string | null;
    notes?: string | null;
    allocated_amount?: number;
    invoice_count?: number;
    events?: Array<{
        id: string;
        status: OutgoingCheck["status"];
        notes?: string | null;
        performed_by_name?: string | null;
        created_at: string;
    }>;
    allocations?: Array<{
        id: string;
        supplier_invoice_id?: string | null;
        invoice_type?: string | null;
        invoice_number?: string | null;
        amount: number;
        created_at: string;
    }>;
};

export type PendingInvoiceResponse = Invoice & {
    document_type: "invoice" | "order";
    fiscal_status: "authorized" | "pending_cae" | "not_invoiced";
    order_id?: string | null;
    client_name?: string;
    client_tax_id?: string;
    paid_amount: number;
    pending_amount: number;
};

export type FiscalSaleStatus = {
    order_id: string;
    sale_date: string;
    order_total: number;
    customer_name?: string | null;
    client_id: string;
    client_name: string;
    client_tax_id?: string | null;
    invoice_id?: string | null;
    invoice_type?: string | null;
    point_of_sale?: number | null;
    invoice_number?: number | null;
    invoice_total?: number | null;
    invoice_status?: string | null;
    cae?: string | null;
    cae_expiration_date?: string | null;
    fiscal_status: "authorized" | "pending_cae" | "not_invoiced";
};

/** Supplier payments also accept "treasury" (cash from Caja 2, ADR-015). */
export type SupplierSettlementLineInput = Omit<InvoicePaymentLineInput, "method"> & {
    method: InvoicePaymentLineInput["method"] | "treasury";
};

export type BulkSupplierPaymentAllocation = {
    invoiceId: string;
    payments: SupplierSettlementLineInput[];
};

export type BulkSupplierPaymentInput = {
    supplierId: string;
    allocations: BulkSupplierPaymentAllocation[];
    notes?: string;
    /** Drawer the cash comes from when more than one register is open (ADR-014). */
    cash_register_id?: string;
    /** One key per payment attempt: a retry does not pay twice (ADR-015). */
    idempotency_key?: string;
};

export type BulkSupplierPaymentResponse = {
    success: boolean;
    total_paid: number;
    invoices: Array<{
        invoiceId: string;
        paid_now: number;
        payment_status: "pending" | "partial" | "paid";
    }>;
};

export type PendingSupplierInvoiceResponse = {
    id: string;
    invoice_type: "A" | "B" | "C" | "M";
    invoice_number: string;
    issue_date: string;
    supplier_id: string;
    supplier_name: string;
    supplier_tax_id?: string;
    reception_number?: string;
    po_number?: string;
    net_amount: number;
    vat_amount: number;
    total_amount: number;
    paid_amount: number;
    pending_amount: number;
    payment_status: "pending" | "partial" | "paid";
};
