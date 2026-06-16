import { Badge } from "@/components/ui/badge"
import type { Order } from "@/types"
import type { OrderStatus } from "@/types/orders"

export function statusLabel(status: OrderStatus): string {
    const labels: Record<OrderStatus, string> = {
        pending: "Pendiente",
        picking: "En picking",
        packed: "Listo para despacho",
        dispatched: "Despachado",
        delivered: "Entregado",
        completed: "Completado",
        cancelled: "Cancelado",
    }
    return labels[status] ?? status
}

export function packedReadyLabel(order: Order): string {
    if (order.shipping_method === "pickup") return "Listo para retiro"
    if (order.shipping_method === "delivery") return "Listo para envio"
    return "Listo para despacho"
}

export function orderHasShortage(order: Order): boolean {
    const items = order.items || []
    return items.some((item) => Number(item.picked_quantity || 0) < Number(item.quantity || 0))
}

export function renderStatusBadge(status: OrderStatus, order?: Order) {
    if (status === "packed") {
        const hasShortage = order ? orderHasShortage(order) : false
        const label = order ? packedReadyLabel(order) : "Listo para despacho"
        if (hasShortage) {
            return (
                <Badge className="bg-amber-500/10 text-amber-700 border border-amber-500/30 hover:bg-amber-500/10 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-800/50 font-semibold shadow-sm">
                    {label} c/faltante
                </Badge>
            )
        }
        return (
            <Badge className="bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 hover:bg-emerald-500/10 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-800/50 font-semibold shadow-sm">
                {label}
            </Badge>
        )
    }

    const badgeStyles: Record<OrderStatus, string> = {
        pending:
            "bg-indigo-50/80 text-indigo-700 border border-indigo-200 hover:bg-indigo-50/80 dark:bg-indigo-950/30 dark:text-indigo-400 dark:border-indigo-800/50 font-semibold shadow-sm",
        picking:
            "bg-amber-50/80 text-amber-700 border border-amber-200 hover:bg-amber-50/80 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/50 font-semibold shadow-sm",
        packed: "", // Handled above
        dispatched:
            "bg-slate-100/70 text-slate-500 border border-slate-200/80 dark:bg-slate-900/30 dark:text-slate-400 dark:border-slate-800/50 hover:bg-slate-100/70 font-normal shadow-sm",
        delivered:
            "bg-teal-50/50 text-teal-700 border border-teal-200 dark:bg-teal-950/20 dark:text-teal-450 dark:border-teal-900/30 hover:bg-teal-50/50 font-normal shadow-sm",
        completed:
            "bg-gray-100/60 text-gray-400 border border-gray-200/80 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-700/50 hover:bg-gray-100/60 font-normal shadow-sm",
        cancelled:
            "bg-red-50 text-red-650 border border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/30 hover:bg-red-50 font-normal shadow-sm",
    }

    return <Badge className={badgeStyles[status] || "outline font-medium"}>{statusLabel(status)}</Badge>
}
