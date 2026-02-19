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
    token: string;
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

export type ClientUpsertInput = Pick<Client, "name" | "email" | "phone" | "tax_id" | "address" | "credit_limit">;
export type SupplierUpsertInput = Pick<Supplier, "name" | "tax_id" | "contact_name" | "email" | "phone" | "address">;

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
    supplier_id: string;
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
    status?: string;
    invoice_type?: string;
    point_of_sale?: number;
    invoice_number?: number;
    total_amount: number;
    issue_date?: string;
    customer_name?: string;
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
