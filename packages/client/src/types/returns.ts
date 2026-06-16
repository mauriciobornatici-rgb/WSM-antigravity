import type { OrderItem } from "@/types"

export type WarrantyRow = {
    id: string;
    created_at: string;
    client_name: string;
    product_name: string;
    issue_description: string;
    status: string;
};

export type ClientReturnItemRow = {
    id?: string;
    product_id?: string;
    product_name: string;
    product?: {
        name?: string;
    };
    sku?: string;
    quantity: number;
    unit_price: number;
    condition_status?: string;
};

export type ClientReturnRow = {
    id: string;
    created_at: string;
    client_name: string;
    order_id?: string;
    reason: string;
    status: string;
    total_amount: number;
    items?: ClientReturnItemRow[];
};

export type CreditNoteRow = {
    id: string;
    number: string;
    created_at: string;
    client_name: string;
    amount: number;
    status: string;
    point_of_sale?: number | undefined;
    credit_note_type?: string | undefined;
    cae?: string | undefined;
    cae_expiration_date?: string | undefined;
    reference_type?: string | undefined;
    reference_id?: string | undefined;
    customer_name?: string | undefined;
    notes?: string | undefined;
};

export type GenericRow = Record<string, unknown>;

export type ReturnFormItem = {
    product_id: string;
    product_name: string;
    quantity: number;
    max_quantity: number;
    condition_status: string;
    unit_price: number;
};

export type SupplierReturnItem = {
    id: string;
    return_id: string;
    product_id: string;
    product_name: string;
    sku: string;
    quantity: number;
    unit_cost: number;
    reason?: string;
};

export type SupplierReturnFormItem = {
    product_id: string;
    quantity: number;
    unit_cost: number;
    reason: string;
};

export type SupplierReturnFormField = keyof SupplierReturnFormItem;

export type OrderReturnSourceItem = OrderItem & {
    product?: {
        name?: string;
    };
};

export interface SupplierReturnRow {
    id: string;
    return_number: string;
    supplier_id: string;
    supplier_name: string;
    date: string;
    status: 'draft' | 'approved' | 'cancelled';
    notes?: string;
    created_at: string;
    items: SupplierReturnItem[];
}
