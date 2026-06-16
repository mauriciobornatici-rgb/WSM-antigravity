import type { TraceabilityEvent, TraceabilityTimelineFilters } from "@/services/api";

export type TraceabilitySearchMode = "sku" | "barcode" | "product_id";

const EVENT_TITLES: Record<string, string> = {
    inventory_movement: "Movimiento de inventario",
    batch: "Lote",
    serial: "Número de serie",
    audit: "Auditoría",
};

export function buildTraceabilityFilters(
    rawValue: string,
    mode: TraceabilitySearchMode,
): TraceabilityTimelineFilters | null {
    const value = rawValue.trim();
    if (!value) return null;

    return {
        [mode]: value,
        limit: 100,
    };
}

export function formatTraceabilityEventTitle(event: TraceabilityEvent): string {
    if (event.title?.trim()) return event.title;
    return EVENT_TITLES[event.event_type] ?? event.event_type;
}

export function resolveTraceabilityLocation(event: TraceabilityEvent): string {
    const from = event.from_location?.trim();
    const to = event.to_location?.trim();

    if (from && to) return `${from} -> ${to}`;
    if (to) return to;
    if (from) return from;
    return "-";
}

export function formatTraceabilityDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
    });
}
