import type { Invoice } from "@/types/api";

export interface OfflineSaleItem {
    product_id: string;
    name?: string;
    quantity: number;
    sale_price: number;
    vat_rate?: number;
}

export interface OfflinePaymentSplit {
    method: string;
    amount: number;
}

export interface OfflineSalePayload {
    id: string;
    idempotency_key: string;
    timestamp: number;
    customer_name: string;
    client_id?: string | undefined;
    payment_method: string;
    payments: OfflinePaymentSplit[];
    items: OfflineSaleItem[];
    emit_invoice: boolean;
    invoice_type?: string | undefined;
    shift_id?: string | undefined;
    retry_count: number;
    last_error?: string | undefined;
}

export interface SyncResult {
    synced: number;
    failed: number;
    errors: Array<{ id: string; error: string }>;
}

const STORAGE_KEY = "wsm_pos_offline_sales_queue";
const STORAGE_VERSION = 1;

type OfflineSaleInput = Omit<OfflineSalePayload, "id" | "idempotency_key" | "timestamp" | "retry_count"> & {
    idempotency_key?: string;
};

function normalizeStoredSale(value: unknown): OfflineSalePayload | null {
    if (!value || typeof value !== "object") return null;
    const sale = value as Partial<OfflineSalePayload>;
    if (!sale.id || !Array.isArray(sale.items) || !Array.isArray(sale.payments)) return null;
    return {
        ...sale,
        id: sale.id,
        idempotency_key: sale.idempotency_key || sale.id,
        timestamp: Number(sale.timestamp || Date.now()),
        customer_name: String(sale.customer_name || "Consumidor final"),
        payment_method: String(sale.payment_method || "cash"),
        payments: sale.payments,
        items: sale.items,
        emit_invoice: Boolean(sale.emit_invoice),
        retry_count: Number(sale.retry_count || 0),
    };
}

export function getOfflineQueue(): OfflineSalePayload[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        const values = Array.isArray(parsed)
            ? parsed
            : (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
                ? (parsed as { items: unknown[] }).items
                : []);
        return values.map(normalizeStoredSale).filter((sale): sale is OfflineSalePayload => sale !== null);
    } catch {
        return [];
    }
}

export function saveOfflineQueue(queue: OfflineSalePayload[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, items: queue }));
    } catch (e) {
        console.error("Error saving offline sales queue", e);
    }
}

export function enqueueOfflineSale(sale: OfflineSaleInput): OfflineSalePayload {
    const queue = getOfflineQueue();
    const idempotencyKey = sale.idempotency_key || crypto.randomUUID();
    const entry: OfflineSalePayload = {
        ...sale,
        id: idempotencyKey,
        idempotency_key: idempotencyKey,
        timestamp: Date.now(),
        retry_count: 0,
    };
    queue.push(entry);
    saveOfflineQueue(queue);
    return entry;
}

export function removeOfflineSale(id: string): void {
    const queue = getOfflineQueue().filter((item) => item.id !== id);
    saveOfflineQueue(queue);
}

export function clearOfflineQueue(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.error("Error clearing offline queue", e);
    }
}

export interface POSApiClient {
    createOrder: (payload: {
        idempotency_key: string;
        customer_name: string;
        payment_method: string;
        client_id?: string;
        items: Array<{ product_id: string; quantity: number }>;
    }) => Promise<{ id: string }>;
    createInvoice?: (payload: Record<string, unknown>) => Promise<Invoice>;
    addShiftPayment?: (shiftId: string, payload: {
        order_id: string;
        payment_method: string;
        amount: number;
        type: "sale";
    }) => Promise<unknown>;
}

let syncInFlight: Promise<SyncResult> | null = null;

function consolidatePayments(payments: OfflinePaymentSplit[]): OfflinePaymentSplit[] {
    const amountsByMethod = new Map<string, number>();
    for (const payment of payments) {
        const amount = Number(payment.amount || 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        amountsByMethod.set(payment.method, (amountsByMethod.get(payment.method) || 0) + amount);
    }
    return Array.from(amountsByMethod, ([method, amount]) => ({ method, amount }));
}

async function performOfflineSync(apiClient: POSApiClient): Promise<SyncResult> {
    const queue = getOfflineQueue();
    if (queue.length === 0) {
        return { synced: 0, failed: 0, errors: [] };
    }

    let synced = 0;
    let failed = 0;
    const errors: Array<{ id: string; error: string }> = [];
    const remainingQueue: OfflineSalePayload[] = [];
    const initialIds = new Set(queue.map((sale) => sale.id));

    for (const sale of queue) {
        try {
            const consolidatedPayments = consolidatePayments(sale.payments);
            const order = await apiClient.createOrder({
                idempotency_key: sale.idempotency_key,
                customer_name: sale.customer_name,
                payment_method: sale.payment_method,
                ...(sale.client_id ? { client_id: sale.client_id } : {}),
                items: sale.items.map((i) => ({
                    product_id: i.product_id,
                    quantity: i.quantity,
                })),
            });

            if (sale.emit_invoice && apiClient.createInvoice) {
                await apiClient.createInvoice({
                    order_id: order.id,
                    customer_name: sale.customer_name,
                    invoice_type: sale.invoice_type || "B",
                    point_of_sale: 1,
                    payment_method: sale.payment_method,
                    payments: consolidatedPayments,
                    ...(sale.client_id ? { client_id: sale.client_id } : {}),
                    items: sale.items.map((i) => ({
                        product_id: i.product_id,
                        description: i.name || "Producto",
                        quantity: i.quantity,
                        unit_price: i.sale_price,
                        vat_rate: i.vat_rate ?? 21,
                    })),
                });
            }

            if (sale.shift_id && apiClient.addShiftPayment) {
                for (const line of consolidatedPayments) {
                    await apiClient.addShiftPayment(sale.shift_id, {
                        order_id: order.id,
                        payment_method: line.method,
                        amount: line.amount,
                        type: "sale",
                    });
                }
            }

            synced++;
        } catch (error) {
            failed++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push({ id: sale.id, error: errorMessage });
            remainingQueue.push({
                ...sale,
                retry_count: sale.retry_count + 1,
                last_error: errorMessage,
            });
        }
    }

    const newlyQueued = getOfflineQueue().filter((sale) => !initialIds.has(sale.id));
    saveOfflineQueue([...remainingQueue, ...newlyQueued]);
    return { synced, failed, errors };
}

export function syncOfflineSales(apiClient: POSApiClient): Promise<SyncResult> {
    if (syncInFlight) return syncInFlight;
    syncInFlight = performOfflineSync(apiClient).finally(() => {
        syncInFlight = null;
    });
    return syncInFlight;
}
