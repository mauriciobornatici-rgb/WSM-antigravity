import type { Order } from "@/types";

export function sortItemsByLocation(order: Order, descending: boolean = true): Order {
    const items = order.items || [];
    const sortedItems = [...items].sort((left, right) => {
        const locA = left.location || "";
        const locB = right.location || "";
        if (locA === locB) return 0;
        if (!locA) return 1;
        if (!locB) return -1;
        return descending ? locB.localeCompare(locA) : locA.localeCompare(locB);
    });
    return {
        ...order,
        items: sortedItems,
    };
}

export function toPickedFlag(order: Order): Order {
    const items = order.items || [];
    return {
        ...order,
        items: items.map((item) => ({
            ...item,
            picked: Number(item.picked_quantity || 0) >= Number(item.quantity || 0),
        })),
    };
}

export function isPickableStatus(status: string): boolean {
    return status === "pending" || status === "picking";
}

export function itemRemainingQuantity(item: Order["items"][number]): number {
    return Math.max(0, Number(item.quantity || 0) - Number(item.picked_quantity || 0));
}

export function itemIsComplete(item: Order["items"][number]): boolean {
    return itemRemainingQuantity(item) === 0;
}

export function itemIsPartial(item: Order["items"][number]): boolean {
    return Number(item.picked_quantity || 0) > 0 && itemRemainingQuantity(item) > 0;
}

export function orderTotalQuantity(order: Order): number {
    const items = order.items || [];
    return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

export function orderPickedQuantity(order: Order): number {
    const items = order.items || [];
    return items.reduce((sum, item) => sum + Number(item.picked_quantity || 0), 0);
}

export function orderMissingQuantity(order: Order): number {
    return Math.max(0, orderTotalQuantity(order) - orderPickedQuantity(order));
}

export function orderHasShortage(order: Order): boolean {
    return orderMissingQuantity(order) > 0;
}

export function readyStatusLabel(order: Order): string {
    if (order.shipping_method === "pickup") return "Listo para retiro";
    if (order.shipping_method === "delivery") return "Listo para envio";
    return "Listo para despacho";
}

export function statusLabel(status: Order["status"]): string {
    const labels: Record<Order["status"], string> = {
        pending: "Pendiente",
        picking: "En picking",
        packed: "Empaquetado",
        dispatched: "Despachado",
        delivered: "Entregado",
        completed: "Completado",
        cancelled: "Cancelado",
    };
    return labels[status] ?? status;
}
