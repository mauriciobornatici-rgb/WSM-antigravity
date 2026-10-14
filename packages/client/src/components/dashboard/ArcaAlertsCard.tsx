import { Link } from "react-router-dom"
import { AlertTriangle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatMoney } from "@/lib/formatters"
import {
    ARCA_CONFLICT_LABEL,
    ARCA_REJECTED_LABEL,
    ARCA_UNAUTHORIZED_LABEL,
    ARCA_VERIFYING_LABEL,
    arcaAlertCount,
    arcaAlertLink,
    arcaAlertSummary,
    arcaAlertTitle,
    arcaErrorText,
} from "@/lib/arca"
import { useArcaAlerts } from "@/hooks/useArcaAlerts"
import type { ArcaAlertItem } from "@/services/api"

const VISIBLE_ITEMS = 8

const ALERT_BADGE: Record<ArcaAlertItem["alert"], { label: string; className: string }> = {
    conflict: { label: ARCA_CONFLICT_LABEL, className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400" },
    stuck: { label: ARCA_VERIFYING_LABEL, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
    rejected: { label: ARCA_REJECTED_LABEL, className: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400" },
    unauthorized: { label: ARCA_UNAUTHORIZED_LABEL, className: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300" },
}

/**
 * ADR-021 / AUD-009: ARCA documents that need a person. A conflict never resolves by itself,
 * a long verification means the server cannot reach ARCA, a rejection will not authorize by
 * retrying as it is, and an invoice a day old without a CAE was forgotten (ADR-022). Hidden
 * when all is well. Conflicts come first.
 */
export function ArcaAlertsCard() {
    const alerts = useArcaAlerts()
    const data = alerts.data
    if (!data || data.items.length === 0) return null
    const total = arcaAlertCount(data)

    return (
        <Card className="border-amber-500/40 bg-amber-500/5" role="region" aria-label="Alertas de ARCA">
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    Comprobantes con ARCA para revisar
                </CardTitle>
                <CardDescription>
                    {arcaAlertSummary(data.conflicts, data.stuck, data.rejected ?? 0, data.unauthorized ?? 0)}.
                    {data.conflicts > 0 ? " Un conflicto no se resuelve solo: revisá el comprobante en ARCA antes de reintentar." : ""}
                    {data.stuck > 0 ? ` Sin confirmar: más de ${data.stale_minutes} minutos en verificación (ARCA no responde).` : ""}
                    {(data.rejected ?? 0) > 0 ? " Rechazado: corregí el motivo, o anulá la factura y emitila de nuevo." : ""}
                    {(data.unauthorized ?? 0) > 0 ? ` Sin autorizar: más de ${data.unauthorized_hours} h sin pedir el CAE.` : ""}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="divide-y divide-border text-sm">
                    {data.items.slice(0, VISIBLE_ITEMS).map((item) => {
                        const badge = ALERT_BADGE[item.alert] ?? ALERT_BADGE.rejected
                        const error = arcaErrorText(item.arca_last_error)
                        return (
                            <li key={`${item.document_kind}-${item.id}`} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <Link to={arcaAlertLink(item)} className="font-medium text-primary underline-offset-2 hover:underline">
                                        {arcaAlertTitle(item)}
                                    </Link>
                                    <span className="text-muted-foreground"> · {item.customer || "Consumidor final"} · {formatMoney(item.amount)}</span>
                                    {error ? (
                                        <p className="truncate text-xs text-muted-foreground" title={error}>{error}</p>
                                    ) : null}
                                </div>
                                <Badge variant="outline" className={`shrink-0 ${badge.className}`}>{badge.label}</Badge>
                            </li>
                        )
                    })}
                </ul>
                {total > VISIBLE_ITEMS ? (
                    <p className="pt-2 text-xs text-muted-foreground">Y {total - Math.min(VISIBLE_ITEMS, data.items.length)} más.</p>
                ) : null}
            </CardContent>
        </Card>
    )
}
