import type { StockAuditScope, StockAuditStatus } from "@/types"

export const STOCK_AUDIT_CLASS_GUIDANCE: Record<Exclude<StockAuditScope, "ALL">, { label: string; cadence: string; description: string }> = {
    A: { label: "Clase A", cadence: "Semanal", description: "Mayor valor inmovilizado; control prioritario." },
    B: { label: "Clase B", cadence: "Mensual", description: "Valor intermedio; control periódico." },
    C: { label: "Clase C", cadence: "Trimestral", description: "Menor valor relativo; control rotativo." },
}

export function stockAuditScopeLabel(scope: StockAuditScope): string {
    return scope === "ALL" ? "Todas las clases" : `Clase ${scope}`
}

export function stockAuditStatusLabel(status: StockAuditStatus): string {
    const labels: Record<StockAuditStatus, string> = {
        in_progress: "En conteo",
        completed: "Pendiente de ajuste",
        adjusted: "Ajustada",
        cancelled: "Cancelada",
    }
    return labels[status]
}

export function stockAccuracyLevel(value: number): "excellent" | "warning" | "critical" | "empty" {
    if (!Number.isFinite(value) || value <= 0) return "empty"
    if (value >= 98) return "excellent"
    if (value >= 95) return "warning"
    return "critical"
}
