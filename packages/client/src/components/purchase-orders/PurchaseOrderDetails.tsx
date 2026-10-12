import { useCallback, useEffect, useState } from "react";
import { Calendar, Loader2, Package, Truck, User } from "lucide-react";
import { api } from "@/services/api";
import type { PurchaseOrder } from "@/types";
import type { AuditLogEntry } from "@/types/api";
import { showErrorToast } from "@/lib/errorHandling";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";

interface PurchaseOrderDetailsProps {
    orderId: string;
    onClose: () => void;
}

type PurchaseStatus = PurchaseOrder["status"];
type PurchaseOrderItem = NonNullable<PurchaseOrder["items"]>[number];

function getStatusLabel(status: PurchaseStatus): string {
    const labels: Record<PurchaseStatus, string> = {
        draft: "Borrador",
        sent: "Enviada",
        partial: "Parcial",
        received: "Recibida",
        cancelled: "Cancelada",
        ordered: "Ordenada",
        completed: "Completada",
    };
    return labels[status] ?? status;
}

function getStatusVariant(status: PurchaseStatus): BadgeProps["variant"] {
    switch (status) {
        case "received":
        case "completed":
            return "default";
        case "partial":
            return "secondary";
        case "cancelled":
            return "destructive";
        default:
            return "outline";
    }
}

export function PurchaseOrderDetails({ orderId, onClose }: PurchaseOrderDetailsProps) {
    const [order, setOrder] = useState<PurchaseOrder | null>(null);
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);
    const [timeline, setTimeline] = useState<AuditLogEntry[]>([]);

    const loadOrder = useCallback(async () => {
        try {
            setLoading(true);
            const [response, auditRows] = await Promise.all([
                api.getPurchaseOrder(orderId),
                api.getAuditLogs({ entity_type: "purchase_order", entity_id: orderId, limit: 100 }).catch(() => []),
            ]);
            setOrder(response);
            setTimeline(auditRows);
        } catch (error) {
            showErrorToast("Error al cargar detalles de la orden", error);
            setOrder(null);
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    useEffect(() => {
        void loadOrder();
    }, [loadOrder]);

    async function handleStatusUpdate(nextStatus: PurchaseStatus) {
        try {
            setUpdating(true);
            await api.updatePurchaseOrderStatus(orderId, nextStatus);
            toast.success(`Estado actualizado a: ${getStatusLabel(nextStatus)}`);
            await loadOrder();
        } catch (error) {
            showErrorToast("Error al actualizar estado", error);
        } finally {
            setUpdating(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (!order) {
        return <div className="p-8 text-center text-muted-foreground">No se pudo cargar la orden.</div>;
    }

    const items: PurchaseOrderItem[] = order.items ?? [];
    // Goods already in (approved or in quality control) belong to the order: it can no longer be cancelled.
    const hasArrivedGoods = items.some(
        (item) => Number(item.quantity_received ?? item.received_quantity ?? 0) > 0 || Number(item.quantity_pending_qc ?? 0) > 0
    );

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        Proveedor
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{order.supplier_name ?? "-"}</div>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        Fecha de orden
                    </div>
                    <div className="text-slate-800 dark:text-slate-200">{order.order_date ? new Date(order.order_date).toLocaleDateString("es-AR") : "-"}</div>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Truck className="h-3 w-3" />
                        Entrega estimada
                    </div>
                    <div className="text-slate-800 dark:text-slate-200">{order.expected_delivery_date ? new Date(order.expected_delivery_date).toLocaleDateString("es-AR") : "-"}</div>
                </div>

                <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Estado</div>
                    <Badge variant={getStatusVariant(order.status)}>{getStatusLabel(order.status)}</Badge>
                </div>
            </div>

            <div className="space-y-3">
                <h3 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
                    <Package className="h-5 w-5 text-blue-600 dark:text-blue-500" />
                    Items de la orden
                </h3>

                <div className="rounded-md border border-slate-200 dark:border-slate-800">
                    <div className="overflow-x-auto">
                        <Table className="min-w-[680px]">
                        <TableHeader>
                            <TableRow className="border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
                                <TableHead className="text-slate-700 dark:text-slate-300">Producto</TableHead>
                                <TableHead className="text-right text-slate-700 dark:text-slate-300">Cant. pedida</TableHead>
                                <TableHead className="text-right text-slate-700 dark:text-slate-300">Cant. recibida</TableHead>
                                <TableHead className="text-right text-slate-700 dark:text-slate-300">Costo unitario</TableHead>
                                <TableHead className="text-right text-slate-700 dark:text-slate-300">Subtotal</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                                        La orden no tiene items.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                items.map((item) => {
                                    const ordered = Number(item.quantity_ordered ?? item.quantity ?? 0);
                                    const received = Number(item.quantity_received ?? item.received_quantity ?? 0);
                                    const unitCost = Number(item.unit_cost ?? 0);
                                    const rowKey = item.id ?? `${item.product_id}-${item.sku ?? "sku"}`;
                                    return (
                                        <TableRow key={rowKey} className="border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/30">
                                            <TableCell>
                                                <div className="font-medium text-slate-900 dark:text-slate-100">{item.product_name ?? item.name ?? "Producto"}</div>
                                                <div className="text-xs text-muted-foreground">{item.sku ?? "-"}</div>
                                            </TableCell>
                                            <TableCell className="text-right text-slate-800 dark:text-slate-200">{ordered}</TableCell>
                                            <TableCell className="text-right text-slate-800 dark:text-slate-200">{received}</TableCell>
                                            <TableCell className="text-right text-slate-800 dark:text-slate-200">${unitCost.toLocaleString("es-AR")}</TableCell>
                                            <TableCell className="text-right font-medium text-slate-950 dark:text-slate-100">
                                                ${(ordered * unitCost).toLocaleString("es-AR")}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                        </Table>
                    </div>
                </div>
            </div>

            {order.notes ? (
                <div className="rounded-lg border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-4">
                    <div className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">Notas</div>
                    <p className="text-sm text-amber-900 dark:text-slate-300">{order.notes}</p>
                </div>
            ) : null}

            <div className="rounded-lg border p-4">
                <h3 className="text-sm font-semibold">Trazabilidad de la orden</h3>
                <p className="mt-1 text-xs text-muted-foreground">“Marcar enviada” habilita el circuito de recepción y registra el cambio. No despacha correo al proveedor.</p>
                <div className="mt-3 space-y-2">
                    {timeline.length === 0 ? <p className="text-xs text-muted-foreground">Sin eventos registrados.</p> : timeline.map((event) => (
                        <div key={event.id} className="flex flex-col gap-1 rounded border bg-muted/20 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                            <span className="font-medium">{event.action.replaceAll("_", " ")}</span>
                            <span className="text-muted-foreground">{new Date(event.created_at).toLocaleString("es-AR")} · {event.user_name || event.user_email || "Sistema"}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-col gap-4 border-t pt-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row">
                    {order.status === "draft" ? (
                        <>
                            <Button onClick={() => void handleStatusUpdate("sent")} disabled={updating} className="bg-green-600 hover:bg-green-700">
                                Marcar enviada
                            </Button>
                            <Button onClick={() => void handleStatusUpdate("cancelled")} disabled={updating} variant="destructive">
                                Cancelar
                            </Button>
                        </>
                    ) : null}
                    {order.status === "sent" && !hasArrivedGoods ? (
                        <Button onClick={() => void handleStatusUpdate("cancelled")} disabled={updating} variant="destructive">
                            Anular orden
                        </Button>
                    ) : null}
                    {order.status === "sent" && hasArrivedGoods ? (
                        <p className="text-sm text-muted-foreground">
                            No se puede anular: ya llegó mercadería de esta orden (recibida o en control de calidad).
                        </p>
                    ) : null}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:justify-end lg:gap-6">
                    <div className="text-right">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Total OC</span>
                        <div className="text-2xl font-bold text-blue-600">${Number(order.total_amount ?? 0).toLocaleString("es-AR")}</div>
                    </div>
                    <Button onClick={onClose} variant="secondary">
                        Cerrar
                    </Button>
                </div>
            </div>
        </div>
    );
}
