import { useQuery } from "@tanstack/react-query"
import { CircleDashed, Package, FileText, Truck } from "lucide-react"
import { api } from "@/services/api"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { renderStatusBadge } from "./helpers"
import type { Order, OrderItem } from "@/types"

interface OrderDetailDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    orderId: string | null
    onTriggerPrint: (order: Order, type: "remito" | "label") => void
}

export function OrderDetailDialog({ open, onOpenChange, orderId, onTriggerPrint }: OrderDetailDialogProps) {
    const orderDetailQuery = useQuery({
        queryKey: ["orders", "detail", orderId ?? ""],
        queryFn: () => api.getOrderSummary(orderId!),
        enabled: !!orderId,
    })

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-3xl no-print print:hidden">
                <DialogHeader>
                    <DialogTitle>Detalle del Pedido</DialogTitle>
                    <DialogDescription>
                        Información comercial, artículos y auditoría de preparación WMS.
                    </DialogDescription>
                </DialogHeader>

                {orderDetailQuery.isLoading ? (
                    <div className="flex h-40 items-center justify-center">
                        <CircleDashed className="h-8 w-8 animate-spin text-primary" />
                        <span className="ml-2 text-sm text-muted-foreground">Cargando detalles...</span>
                    </div>
                ) : orderDetailQuery.isError ? (
                    <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-center text-sm text-red-500">
                        Ocurrió un error al cargar la información detallada del pedido.
                    </div>
                ) : orderDetailQuery.data ? (
                    (() => {
                        const {
                            order: detailOrder,
                            items: detailItems,
                            picking_session: detailSession,
                        } = orderDetailQuery.data

                        let speedText = "-"
                        let durationText = "-"
                        if (detailSession?.started_at && detailSession?.completed_at) {
                            const start = new Date(detailSession.started_at).getTime()
                            const end = new Date(detailSession.completed_at).getTime()
                            const diffMs = end - start
                            const diffSec = Math.floor(diffMs / 1000)
                            const minutes = Math.floor(diffSec / 60)
                            const seconds = diffSec % 60
                            durationText = `${minutes}m ${seconds}s`

                            const itemsPicked = Number(detailSession.total_items_picked || 0)
                            if (itemsPicked > 0 && diffSec > 0) {
                                const itemsPerMinute = ((itemsPicked / diffSec) * 60).toFixed(1)
                                speedText = `${itemsPerMinute} art/min`
                            }
                        }

                        return (
                            <div className="space-y-6">
                                <div className="grid gap-4 sm:grid-cols-2 rounded-lg border p-4 bg-muted/10">
                                    <div>
                                        <h4 className="font-semibold text-sm text-muted-foreground mb-2">
                                            Información del Pedido
                                        </h4>
                                        <div className="space-y-1 text-sm">
                                            <p>
                                                <strong>Pedido ID:</strong>{" "}
                                                <span className="font-mono text-xs">{detailOrder.id}</span>
                                            </p>
                                            <p>
                                                <strong>Fecha Creación:</strong>{" "}
                                                {new Date(detailOrder.created_at).toLocaleString("es-AR")}
                                            </p>
                                            <p>
                                                <strong>Estado:</strong>{" "}
                                                {renderStatusBadge(detailOrder.status, {
                                                    ...detailOrder,
                                                    items: detailItems,
                                                })}
                                            </p>
                                            <p>
                                                <strong>Total Comercial:</strong>{" "}
                                                <strong className="text-foreground">
                                                    ${Number(detailOrder.total_amount || 0).toLocaleString("es-AR")}
                                                </strong>
                                            </p>
                                        </div>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold text-sm text-muted-foreground mb-2">
                                            Logística & Entrega
                                        </h4>
                                        <div className="space-y-1 text-sm">
                                            <p>
                                                <strong>Método Logístico:</strong>{" "}
                                                {detailOrder.shipping_method === "delivery"
                                                    ? "Envío a Domicilio"
                                                    : "Retiro en Local"}
                                            </p>
                                            <p>
                                                <strong>Receptor:</strong> {detailOrder.recipient_name || "-"}{" "}
                                                {detailOrder.recipient_dni ? `(DNI: ${detailOrder.recipient_dni})` : ""}
                                            </p>
                                            {detailOrder.shipping_method === "delivery" && (
                                                <p>
                                                    <strong>Dirección:</strong> {detailOrder.shipping_address || "No indicada"}
                                                </p>
                                            )}
                                            {detailOrder.tracking_number && (
                                                <p>
                                                    <strong>Nº Seguimiento:</strong>{" "}
                                                    <span className="font-mono text-xs">{detailOrder.tracking_number}</span>
                                                </p>
                                            )}
                                            {detailOrder.estimated_delivery && (
                                                <p>
                                                    <strong>Fecha Estimada:</strong>{" "}
                                                    {new Date(detailOrder.estimated_delivery).toLocaleDateString("es-AR")}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-4 sm:grid-cols-2 border-b pb-4">
                                    <div className="text-sm">
                                        <span className="text-muted-foreground block text-xs uppercase font-bold tracking-wider">
                                            Cliente
                                        </span>
                                        <span className="font-medium text-base">
                                            {detailOrder.client_name ||
                                                detailOrder.customer_name ||
                                                "Consumidor Final"}
                                        </span>
                                    </div>
                                    <div className="text-sm">
                                        <span className="text-muted-foreground block text-xs uppercase font-bold tracking-wider">
                                            Operador de Venta
                                        </span>
                                        <span className="font-medium text-base">
                                            {detailOrder.counter_name || "Sistema"}
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-semibold text-sm">Artículos del Pedido</h4>
                                    <div className="rounded-md border overflow-hidden">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Ubicación</TableHead>
                                                    <TableHead>SKU</TableHead>
                                                    <TableHead>Producto</TableHead>
                                                    <TableHead className="text-right">Cantidad</TableHead>
                                                    <TableHead className="text-right">Preparado</TableHead>
                                                    <TableHead className="text-right">Unitario</TableHead>
                                                    <TableHead className="text-right">Subtotal</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {detailItems.map((item: OrderItem, idx: number) => {
                                                    const subtotal = Number(item.quantity || 0) * Number(item.unit_price || 0)
                                                    return (
                                                        <TableRow key={`${item.id}-${idx}`}>
                                                            <TableCell className="font-mono font-bold text-xs">
                                                                {item.location || "Sin Ubicación"}
                                                            </TableCell>
                                                            <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                                                            <TableCell className="text-sm">{item.product_name}</TableCell>
                                                            <TableCell className="text-right font-semibold">
                                                                {item.quantity}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono">
                                                                <span
                                                                    className={
                                                                        Number(item.picked_quantity || 0) <
                                                                        Number(item.quantity || 0)
                                                                            ? "text-amber-500 font-bold"
                                                                            : "text-emerald-500"
                                                                    }
                                                                >
                                                                    {item.picked_quantity || 0}
                                                                </span>
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono">
                                                                ${Number(item.unit_price || 0).toLocaleString("es-AR")}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono font-semibold">
                                                                ${subtotal.toLocaleString("es-AR")}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </div>

                                <div className="space-y-3 rounded-lg border p-4 bg-emerald-500/5">
                                    <h4 className="font-semibold text-sm flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                                        <Package className="h-4 w-4" /> Audición WMS (Sistemas de Depósito)
                                    </h4>
                                    {detailSession ? (
                                        <div className="grid gap-3 sm:grid-cols-3 text-sm">
                                            <div>
                                                <span className="text-muted-foreground block text-xs">
                                                    Operario Responsable
                                                </span>
                                                <span className="font-medium">
                                                    {detailSession.picker_name || `Picker ID: ${detailSession.picker_id}`}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground block text-xs">
                                                    Tiempo Transcurrido
                                                </span>
                                                <span className="font-medium">{durationText}</span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground block text-xs">
                                                    Velocidad del Operario
                                                </span>
                                                <span className="font-medium">{speedText}</span>
                                            </div>
                                            <div className="sm:col-span-3 border-t pt-2 mt-1 grid grid-cols-2 gap-2 text-xs">
                                                <p>
                                                    <strong>Inicio Picking:</strong>{" "}
                                                    {new Date(detailSession.started_at).toLocaleString("es-AR")}
                                                </p>
                                                <p>
                                                    <strong>Fin Picking:</strong>{" "}
                                                    {detailSession.completed_at
                                                        ? new Date(detailSession.completed_at).toLocaleString("es-AR")
                                                        : "En progreso..."}
                                                </p>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            No hay registros de picking WMS para este pedido. El picking comienza cuando
                                            la orden pasa a estado "picking".
                                        </p>
                                    )}
                                </div>

                                {detailOrder.notes && (
                                    <div className="rounded-md border p-3 bg-slate-50 dark:bg-slate-900/50 text-sm">
                                        <strong className="block mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                                            Observaciones del Pedido
                                        </strong>
                                        <p className="text-slate-700 dark:text-slate-350">{detailOrder.notes}</p>
                                    </div>
                                )}
                                {detailOrder.delivery_notes && (
                                    <div className="rounded-md border p-3 bg-amber-500/5 text-sm">
                                        <strong className="block mb-1 text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400">
                                            Instrucciones de Despacho
                                        </strong>
                                        <p className="text-amber-900 dark:text-amber-300">{detailOrder.delivery_notes}</p>
                                    </div>
                                )}

                                <div className="flex flex-wrap gap-2 justify-between border-t pt-4">
                                    <div className="flex gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => onTriggerPrint(detailOrder, "remito")}
                                        >
                                            <FileText className="mr-2 h-4 w-4" />
                                            Imprimir Remito (A4)
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => onTriggerPrint(detailOrder, "label")}
                                        >
                                            <Truck className="mr-2 h-4 w-4" />
                                            Imprimir Etiqueta (10x15)
                                        </Button>
                                    </div>
                                    <Button type="button" onClick={() => onOpenChange(false)}>
                                        Cerrar
                                    </Button>
                                </div>
                            </div>
                        )
                    })()
                ) : null}
            </DialogContent>
        </Dialog>
    )
}
