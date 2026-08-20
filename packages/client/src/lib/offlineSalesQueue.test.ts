import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearOfflineQueue,
    enqueueOfflineSale,
    getOfflineQueue,
    removeOfflineSale,
    syncOfflineSales,
    type POSApiClient,
} from "./offlineSalesQueue";

describe("offlineSalesQueue", () => {
    beforeEach(() => {
        clearOfflineQueue();
    });

    it("should enqueue and retrieve offline sales correctly", () => {
        expect(getOfflineQueue()).toHaveLength(0);

        const entry = enqueueOfflineSale({
            customer_name: "Juan Perez",
            payment_method: "cash",
            payments: [{ method: "cash", amount: 1500 }],
            items: [{ product_id: "p1", name: "Pelota", quantity: 1, sale_price: 1500 }],
            emit_invoice: false,
        });

        const queue = getOfflineQueue();
        expect(queue).toHaveLength(1);
        expect(queue[0]!.id).toBe(entry.id);
        expect(queue[0]!.idempotency_key).toBe(entry.id);
        expect(queue[0]!.customer_name).toBe("Juan Perez");
        expect(queue[0]!.retry_count).toBe(0);
    });

    it("upserts retries with the same idempotency key instead of duplicating sales", () => {
        const sale = {
            idempotency_key: "checkout-1",
            customer_name: "Cliente",
            payment_method: "cash",
            payments: [{ method: "cash", amount: 100 }],
            items: [{ product_id: "p1", quantity: 1, sale_price: 100 }],
            emit_invoice: false,
        };

        enqueueOfflineSale(sale);
        enqueueOfflineSale(sale);

        expect(getOfflineQueue()).toHaveLength(1);
        expect(getOfflineQueue()[0]!.idempotency_key).toBe("checkout-1");
    });

    it("fails explicitly when the contingency sale cannot be persisted", () => {
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
            throw new DOMException("Quota exceeded", "QuotaExceededError");
        });

        expect(() => enqueueOfflineSale({
            customer_name: "Cliente",
            payment_method: "cash",
            payments: [{ method: "cash", amount: 100 }],
            items: [{ product_id: "p1", quantity: 1, sale_price: 100 }],
            emit_invoice: false,
        })).toThrow("No se pudo guardar la venta");

        setItem.mockRestore();
    });

    it("should remove individual sales from queue", () => {
        const item1 = enqueueOfflineSale({
            customer_name: "Cliente 1",
            payment_method: "cash",
            payments: [{ method: "cash", amount: 100 }],
            items: [{ product_id: "p1", quantity: 1, sale_price: 100 }],
            emit_invoice: false,
        });
        const item2 = enqueueOfflineSale({
            customer_name: "Cliente 2",
            payment_method: "card",
            payments: [{ method: "card", amount: 200 }],
            items: [{ product_id: "p2", quantity: 2, sale_price: 100 }],
            emit_invoice: false,
        });

        expect(getOfflineQueue()).toHaveLength(2);
        removeOfflineSale(item1.id);

        const remaining = getOfflineQueue();
        expect(remaining).toHaveLength(1);
        expect(remaining[0]!.id).toBe(item2.id);
    });

    it("should sync offline sales successfully with apiClient", async () => {
        enqueueOfflineSale({
            customer_name: "Cliente Test",
            payment_method: "cash",
            payments: [{ method: "cash", amount: 3000 }],
            items: [{ product_id: "prod-1", name: "Zapatillas", quantity: 1, sale_price: 3000, vat_rate: 21 }],
            emit_invoice: true,
            invoice_type: "B",
            shift_id: "shift-123",
        });

        const createOrder = vi.fn().mockResolvedValue({ id: "order-999" });
        const createInvoice = vi.fn().mockResolvedValue({ id: "inv-999" });
        const addShiftPayment = vi.fn().mockResolvedValue({ ok: true });

        const mockApi: POSApiClient = {
            createOrder,
            createInvoice,
            addShiftPayment,
        };

        const result = await syncOfflineSales(mockApi);

        expect(result.synced).toBe(1);
        expect(result.failed).toBe(0);
        expect(createOrder).toHaveBeenCalledTimes(1);
        expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ idempotency_key: expect.any(String) }));
        expect(createInvoice).toHaveBeenCalledTimes(1);
        expect(addShiftPayment).toHaveBeenCalledTimes(1);
        expect(getOfflineQueue()).toHaveLength(0);
    });

    it("should retain failed sales and increment retry_count", async () => {
        enqueueOfflineSale({
            customer_name: "Cliente Fallo",
            payment_method: "cash",
            payments: [{ method: "cash", amount: 500 }],
            items: [{ product_id: "prod-x", quantity: 1, sale_price: 500 }],
            emit_invoice: false,
        });

        const mockApi: POSApiClient = {
            createOrder: vi.fn().mockRejectedValue(new Error("Network connection timeout")),
        };

        const result = await syncOfflineSales(mockApi);

        expect(result.synced).toBe(0);
        expect(result.failed).toBe(1);
        expect(result.errors).toHaveLength(1);

        const remaining = getOfflineQueue();
        expect(remaining).toHaveLength(1);
        expect(remaining[0]!.retry_count).toBe(1);
        expect(remaining[0]!.last_error).toContain("Network connection timeout");
    });

    it("retains a sale when invoice synchronization fails", async () => {
        enqueueOfflineSale({
            customer_name: "Cliente Factura",
            payment_method: "cash",
            payments: [{ method: "cash", amount: 1210 }],
            items: [{ product_id: "prod-1", quantity: 1, sale_price: 1000 }],
            emit_invoice: true,
        });

        const result = await syncOfflineSales({
            createOrder: vi.fn().mockResolvedValue({ id: "order-1" }),
            createInvoice: vi.fn().mockRejectedValue(new Error("AFIP unavailable")),
        });

        expect(result.failed).toBe(1);
        expect(getOfflineQueue()).toHaveLength(1);
        expect(getOfflineQueue()[0]!.last_error).toContain("AFIP unavailable");
    });

    it("migrates legacy array storage and reuses the queue id as idempotency key", () => {
        localStorage.setItem("wsm_pos_offline_sales_queue", JSON.stringify([{
            id: "legacy-id",
            timestamp: 1,
            customer_name: "Legacy",
            payment_method: "cash",
            payments: [{ method: "cash", amount: 100 }],
            items: [{ product_id: "p1", quantity: 1, sale_price: 100 }],
            emit_invoice: false,
            retry_count: 0,
        }]));

        expect(getOfflineQueue()[0]!.idempotency_key).toBe("legacy-id");
    });
});
