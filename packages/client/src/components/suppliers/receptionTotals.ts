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

// ADR-028: una línea de remito que la factura puede cobrar (lo que le falta facturar).
export type InvoiceLineSource = {
    id: string;
    product_name?: string | null;
    sku?: string | null;
    vat_rate?: number | string | null;
    quantity_to_invoice?: number | string | null;
    unit_cost?: number | string | null;
};

export type InvoiceLineEdit = { quantity: string; unitCost: string };

export type InvoiceLineView = {
    id: string;
    receptionId: string;
    receptionLabel: string;
    productName: string;
    sku: string;
    vatRate: number;
    pending: number;
    remitoCost: number;
    quantity: string;
    unitCost: string;
    quantityValid: boolean;
    costValid: boolean;
    valid: boolean;
    units: number;
    cost: number;
    // Neto de la línea y lo que valía al costo del remito, en centavos.
    netCents: number;
    remitoCents: number;
};

const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);

// Ids of a line's inputs, so the form can take the user to the one to fix.
export const invoiceLineQuantityId = (lineId: string) => `invoice-line-qty-${lineId}`;
export const invoiceLineCostId = (lineId: string) => `invoice-line-cost-${lineId}`;

// Las líneas pendientes de los remitos elegidos, con lo que el usuario cargó (por defecto, todo lo
// pendiente al costo del remito).
export function invoiceLines(
    receptions: Array<{ id: string; remito_number?: string | null; reception_number: string; items?: InvoiceLineSource[] }>,
    edits: Record<string, InvoiceLineEdit>,
): InvoiceLineView[] {
    return receptions.flatMap((reception) => (reception.items ?? [])
        .filter((item) => Number(item.quantity_to_invoice || 0) > 0)
        .map((item) => {
            const pending = Number(item.quantity_to_invoice || 0);
            const remitoCost = Number(item.unit_cost || 0);
            const quantity = edits[item.id]?.quantity ?? String(pending);
            const unitCost = edits[item.id]?.unitCost ?? String(remitoCost);
            const units = Number(quantity);
            const cost = Number(unitCost);
            const quantityValid = quantity.trim() !== '' && Number.isInteger(units) && units >= 0 && units <= pending;
            const costValid = unitCost.trim() !== '' && Number.isFinite(cost) && cost >= 0;
            const valid = quantityValid && costValid;
            return {
                id: item.id,
                receptionId: reception.id,
                receptionLabel: reception.remito_number || reception.reception_number,
                productName: item.product_name || 'Producto',
                sku: item.sku || '',
                vatRate: item.vat_rate == null || item.vat_rate === '' ? 21 : Number(item.vat_rate),
                pending,
                remitoCost,
                quantity,
                unitCost,
                quantityValid,
                costValid,
                valid,
                units: valid ? units : 0,
                cost: valid ? cost : 0,
                // The unit price as the invoice prints it (up to 4 decimals): the line is rounded once.
                netCents: valid ? Math.round(Number((units * cost).toFixed(4)) * 100) : 0,
                remitoCents: valid ? Math.round(units * toCents(remitoCost)) : 0,
            };
        }));
}

// El neto de las líneas por alícuota (las de 0 unidades no cuentan).
export function netByRate(lines: InvoiceLineView[]): Array<{ rate: number; netCents: number }> {
    const totals = new Map<number, number>();
    for (const line of lines) {
        if (line.units <= 0) continue;
        totals.set(line.vatRate, (totals.get(line.vatRate) ?? 0) + line.netCents);
    }
    return [...totals.entries()].sort((a, b) => b[0] - a[0]).map(([rate, netCents]) => ({ rate, netCents }));
}

// Neto pendiente de facturar de un remito (lo que le falta, al costo del remito).
export function receptionPendingNet(reception: { items?: InvoiceLineSource[] }): number {
    const items = Array.isArray(reception.items) ? reception.items : [];
    return round2(items.reduce((sum, item) => sum + Number(item.quantity_to_invoice || 0) * Number(item.unit_cost || 0), 0));
}

// Orden de compra común a todos los remitos; vacío si no hay o si difieren.
export function sharedPurchaseOrderId(receptions: ReceptionTotalsInput[]): string {
    if (receptions.length === 0) return "";
    const first = receptions[0]?.purchase_order_id || "";
    if (!first) return "";
    return receptions.every((reception) => reception.purchase_order_id === first) ? first : "";
}
