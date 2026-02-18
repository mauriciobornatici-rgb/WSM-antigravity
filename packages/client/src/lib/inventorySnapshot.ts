import { api } from "@/services/api";
import type { Order, Product } from "@/types";

export type ProductWithStock = Product & {
    stock_available: number;
    stock_immobilized: number;
};

const INVENTORY_CACHE_TTL_MS = 30_000;

let inventorySnapshotCache: { data: ProductWithStock[]; timestamp: number } | null = null;
let inventorySnapshotPromise: Promise<ProductWithStock[]> | null = null;

function computeImmobilizedStock(productId: string, orders: Order[]): number {
    return orders
        .filter((order) => order.status === "pending" || order.status === "picking")
        .flatMap((order) => order.items)
        .filter((item) => item.product_id === productId)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function isInventoryCacheFresh(): boolean {
    if (!inventorySnapshotCache) return false;
    return Date.now() - inventorySnapshotCache.timestamp < INVENTORY_CACHE_TTL_MS;
}

export function invalidateInventorySnapshotCache(): void {
    inventorySnapshotCache = null;
}

export async function fetchInventorySnapshot(force = false): Promise<ProductWithStock[]> {
    if (!force && isInventoryCacheFresh() && inventorySnapshotCache) {
        return inventorySnapshotCache.data;
    }

    if (!force && inventorySnapshotPromise) {
        return inventorySnapshotPromise;
    }

    inventorySnapshotPromise = (async () => {
        const [productsResponse, ordersResponse] = await Promise.all([api.getProducts(), api.getOrders()]);
        return productsResponse.map((product) => ({
            ...product,
            stock_available: Number(product.stock_current ?? 0),
            stock_immobilized: computeImmobilizedStock(product.id, ordersResponse),
        }));
    })();

    try {
        const snapshot = await inventorySnapshotPromise;
        inventorySnapshotCache = { data: snapshot, timestamp: Date.now() };
        return snapshot;
    } finally {
        inventorySnapshotPromise = null;
    }
}
