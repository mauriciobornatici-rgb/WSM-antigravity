import { useEffect, useState } from "react";
import { Calendar, Loader2, Package, Truck, User } from "lucide-react";
import { api } from "@/services/api";
import type { PurchaseOrder } from "@/types";
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

    useEffect(() => {
        void loadOrder();
    }, [orderId]);

    async function loadOrder() {
        try {
            setLoading(true);
            const response = await api.getPurchaseOrder(orderId);
            setOrder(response);
        } catch (error) {
            showErrorToast("Error al cargar detalles de la orden", error);
            setOrder(null);
        } finally {
            setLoading(false);
        }
    }

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

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 rounded-lg border bg-slate-50 p-4 lg:grid-cols-4">
                <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        Proveedor
                    </div>
                    <div className="font-semibold">{order.supplier_name ?? "-"}</div>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        Fecha de orden
                    </div>
                    <div>{order.order_date ? new Date(order.order_date).toLocaleDateString("es-AR") : "-"}</div>
                </div>

                <div className="space-y-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Truck className="h-3 w-3" />
                        Entrega estimada
                    </div>
                    <div>{order.expected_delivery_date ? new Date(order.expected_delivery_date).toLocaleDateString("es-AR") : "-"}</div>
                </div>

                <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Estado</div>
                    <Badge variant={getStatusVariant(order.status)}>{getStatusLabel(order.status)}</Badge>
                </div>
            </div>

            <div className="space-y-3">
                <h3 className="flex items-center gap-2 font-semibold">
                    <Package className="h-5 w-5 text-blue-600" />
                    Items de la orden
                </h3>

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Producto</TableHead>
                                <TableHead className="text-right">Cant. pedida</TableHead>
                                <TableHead className="text-right">Cant. recibida</TableHead>
                                <TableHead className="text-right">Costo unitario</TableHead>
                                <TableHead className="text-right">Subtotal</TableHead>
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
                                        <TableRow key={rowKey}>
                                            <TableCell>
                                                <div className="font-medium">{item.product_name ?? item.name ?? "Producto"}</div>
                                                <div className="text-xs text-muted-foreground">{item.sku ?? "-"}</div>
                                            </TableCell>
                                            <TableCell className="text-right">{ordered}</TableCell>
                                            <TableCell className="text-right">{received}</TableCell>
                                            <TableCell className="text-right">${unitCost.toLocaleString("es-AR")}</TableCell>
                                            <TableCell className="text-right font-medium">
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

            {order.notes ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-800">Notas</div>
                    <p className="text-sm text-amber-900">{order.notes}</p>
                </div>
            ) : null}

            <div className="flex items-center justify-between border-t pt-4">
                <div className="flex gap-2">
                    {order.status === "draft" ? (
                        <>
                            <Button onClick={() => void handleStatusUpdate("sent")} disabled={updating} className="bg-green-600 hover:bg-green-700">
                                Aprobar orden
                            </Button>
                            <Button onClick={() => void handleStatusUpdate("cancelled")} disabled={updating} variant="destructive">
                                Cancelar
                            </Button>
                        </>
                    ) : null}
                    {order.status === "sent" ? (
                        <Button onClick={() => void handleStatusUpdate("cancelled")} disabled={updating} variant="destructive">
                            Anular orden
                        </Button>
                    ) : null}
                </div>

                <div className="flex items-center gap-6">
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
