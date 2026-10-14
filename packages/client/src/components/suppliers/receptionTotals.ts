export type ReceptionTotalsInput = {
    purchase_order_id?: string | null;
    items?: Array<{
        quantity_received?: number | string | null;
        unit_cost?: number | string | null;
    }>;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Neto recibido de un remito: Σ cantidad recibida × costo unitario.
export function receptionNet(reception: ReceptionTotalsInput): number {
    const items = Array.isArray(reception.items) ? reception.items : [];
    return round2(items.reduce((sum, item) => sum + Number(item.quantity_received || 0) * Number(item.unit_cost || 0), 0));
}

// Neto recibido en varios remitos.
export function receptionsNetTotal(receptions: ReceptionTotalsInput[]): number {
    return round2(receptions.reduce((sum, reception) => sum + receptionNet(reception), 0));
}

// Orden de compra común a todos los remitos; vacío si no hay o si difieren.
export function sharedPurchaseOrderId(receptions: ReceptionTotalsInput[]): string {
    if (receptions.length === 0) return "";
    const first = receptions[0]?.purchase_order_id || "";
    if (!first) return "";
    return receptions.every((reception) => reception.purchase_order_id === first) ? first : "";
}
