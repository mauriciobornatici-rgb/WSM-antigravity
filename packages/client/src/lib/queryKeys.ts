type PurchaseOrderFilter = "all" | "draft" | "sent" | "partial" | "received";
type ReceptionsFilter = "all" | "pending_qc" | "approved" | "rejected";

export const queryKeys = {
    orders: {
        all: ["orders"] as const,
    },
    products: {
        all: ["products"] as const,
    },
    clients: {
        all: ["clients"] as const,
    },
    purchaseOrders: {
        all: ["purchase-orders"] as const,
        byFilter: (filter: PurchaseOrderFilter) => ["purchase-orders", filter] as const,
        pendingReception: ["purchase-orders", "pending-reception"] as const,
    },
    receptions: {
        all: ["receptions"] as const,
        byFilter: (filter: ReceptionsFilter) => ["receptions", filter] as const,
    },
    supplierReturns: {
        all: ["supplier-returns"] as const,
    },
    warranties: {
        all: ["warranties"] as const,
    },
    clientReturns: {
        all: ["client-returns"] as const,
    },
    creditNotes: {
        all: ["credit-notes"] as const,
    },
} as const;
