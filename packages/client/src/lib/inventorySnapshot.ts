import { api } from "@/services/api";
import type { PaginatedResponse, PaginationMeta } from "@/types/api";
import type { Order, Product } from "@/types";

export type ProductWithStock = Product & {
    stock_available: number;
    stock_immobilized: number;
};

export type InventorySnapshot = {
    rows: ProductWithStock[];
    pagination?: PaginationMeta;
};

type InventorySnapshotOptions = {
    force?: boolean;
    page?: number;
    limit?: number;
};

const INVENTORY_CACHE_TTL_MS = 30_000;

const inventorySnapshotCache = new Map<string, { data: InventorySnapshot; timestamp: number }>();
const inventorySnapshotPromises = new Map<string, Promise<InventorySnapshot>>();

function computeImmobilizedStock(productId: string, orders: Order[]): number {
    return orders
        .filter((order) => order.status === "pending" || order.status === "picking")
        .flatMap((order) => order.items)
        .filter((item) => item.product_id === productId)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function buildCacheKey(page?: number, limit?: number): string {
    return `${page ?? "all"}:${limit ?? "all"}`;
}

function isCacheFresh(cacheKey: string): boolean {
    const snapshot = inventorySnapshotCache.get(cacheKey);
    if (!snapshot) return false;
    return Date.now() - snapshot.timestamp < INVENTORY_CACHE_TTL_MS;
}

export function invalidateInventorySnapshotCache(): void {
    inventorySnapshotCache.clear();
}

export async function fetchInventorySnapshot(options: InventorySnapshotOptions = {}): Promise<InventorySnapshot> {
    const { force = false, page, limit } = options;
    const cacheKey = buildCacheKey(page, limit);

    if (!force && isCacheFresh(cacheKey)) {
        const snapshot = inventorySnapshotCache.get(cacheKey);
        if (snapshot) return snapshot.data;
    }

    if (!force) {
        const inFlight = inventorySnapshotPromises.get(cacheKey);
        if (inFlight) return inFlight;
    }

    const promise = (async () => {
        const [productsResponse, ordersResponse] = await Promise.all([
            (async (): Promise<PaginatedResponse<Product[]>> => {
                if (page != null || limit != null) {
                    return api.getProductsPage({
                        ...(page != null ? { page } : {}),
                        ...(limit != null ? { limit } : {}),
                    });
                }
                const data = await api.getProducts();
                return { data };
            })(),
            api.getOrders(),
        ]);

        const rows = productsResponse.data.map((product) => ({
            ...product,
            stock_available: Number(product.stock_current ?? 0),
            stock_immobilized: computeImmobilizedStock(product.id, ordersResponse),
        }));

        const snapshot: InventorySnapshot = {
            rows,
            ...(productsResponse.pagination ? { pagination: productsResponse.pagination } : {}),
        };

        inventorySnapshotCache.set(cacheKey, { data: snapshot, timestamp: Date.now() });
        return snapshot;
    })();

    inventorySnapshotPromises.set(cacheKey, promise);

    try {
        return await promise;
    } finally {
        inventorySnapshotPromises.delete(cacheKey);
    }
}
