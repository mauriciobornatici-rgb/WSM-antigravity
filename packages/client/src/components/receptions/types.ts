import type { PurchaseOrder } from "@/types";

export type ReceptionsFilter = "all" | "pending_qc" | "approved" | "rejected";
export type ReceptionsTab = "pending" | "history" | "returns";

export type ReceptionRecord = {
    id: string;
    reception_number: string;
    supplier_name: string;
    po_number?: string;
    reception_date?: string;
    status: string;
    items?: Array<Record<string, unknown>>;
    [key: string]: unknown;
};

export type SupplierReturnRecord = {
    id: string;
    return_number: string;
    supplier_name: string;
    created_at: string;
    status: string;
};

export type PendingReceptionOrder = PurchaseOrder;
