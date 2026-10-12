import { useState, useMemo } from "react";
import {
    Calendar,
    Clock,
    Layers,
    Package,
    Play,
    ScanLine,
    Search,
    Store,
    Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Order } from "@/types";
import { isPickableStatus, orderPickedQuantity, orderTotalQuantity, statusLabel } from "@/lib/pickingUtils";

interface PickingOrdersTableProps {
    orders: Order[];
    onSelectOrder: (order: Order) => void;
}

function formatDeliveryInfo(order: Order) {
    const dateStr = order.estimated_delivery || order.created_at;
    if (!dateStr) return { label: "Fecha", formatted: "-", isUrgent: false, isCommitment: false };

    const dateObj = new Date(dateStr);
    const now = new Date();
    const isToday =
        dateObj.getDate() === now.getDate() &&
        dateObj.getMonth() === now.getMonth() &&
        dateObj.getFullYear() === now.getFullYear();
    const isPast = dateObj.getTime() < now.getTime() && !isToday;

    const formatted = dateObj.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "short",
        year: dateObj.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });

    return {
        label: order.estimated_delivery ? "Entrega requerida" : "Fecha pedido",
        formatted,
        isUrgent: isToday || isPast,
        isCommitment: Boolean(order.estimated_delivery),
    };
}

export function PickingOrdersTable({ orders, onSelectOrder }: PickingOrdersTableProps) {
    const [searchTerm, setSearchTerm] = useState("");

    const sortedAndFilteredOrders = useMemo(() => {
        const term = searchTerm.toLowerCase().trim();
        return orders
            .filter((order) => isPickableStatus(order.status))
            .filter((order) => {
                if (!term) return true;
                const client = (order.customer_name || order.client_name || "").toLowerCase();
                const id = order.id.toLowerCase();
                const itemsMatch = order.items.some(
                    (item) =>
                        item.product_name.toLowerCase().includes(term) ||
                        item.sku.toLowerCase().includes(term) ||
                        (item.barcode && item.barcode.toLowerCase().includes(term)),
                );
                return client.includes(term) || id.includes(term) || itemsMatch;
            })
            .sort((a, b) => {
                // Primary: earliest delivery date / required date first
                const timeA = new Date(a.estimated_delivery || a.created_at).getTime();
                const timeB = new Date(b.estimated_delivery || b.created_at).getTime();
                if (timeA !== timeB) return timeA - timeB;
                // Secondary: oldest created order first
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            });
    }, [orders, searchTerm]);

    const totalOrdersCount = orders.filter((o) => isPickableStatus(o.status)).length;

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Picking de Almacén</h2>
                    <p className="text-muted-foreground">
                        {totalOrdersCount === 1
                            ? "1 pedido pendiente de preparación en depósito."
                            : `${totalOrdersCount} pedidos pendientes de preparación en depósito.`}
                    </p>
                </div>

                <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por cliente, N° o SKU..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 text-sm"
                    />
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {sortedAndFilteredOrders.length === 0 ? (
                    <Card className="md:col-span-2 lg:col-span-3">
                        <CardContent className="p-12 text-center text-muted-foreground space-y-2">
                            <Package className="h-10 w-10 mx-auto text-muted-foreground/40" />
                            <p className="font-semibold text-foreground">
                                {searchTerm ? "No se encontraron pedidos con ese criterio" : "No hay pedidos pendientes de picking"}
                            </p>
                            <p className="text-xs">
                                {searchTerm
                                    ? "Prueba buscando con otro término o limpia el buscador."
                                    : "Los nuevos pedidos listos para recolección aparecerán aquí automáticamente."}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    sortedAndFilteredOrders.map((order) => {
                        const totalUnits = orderTotalQuantity(order);
                        const pickedUnits = orderPickedQuantity(order);
                        const isPickingInProgress = order.status === "picking";
                        const shortId = order.id.slice(0, 8).toUpperCase();
                        const deliveryInfo = formatDeliveryInfo(order);
                        const progressPercent = totalUnits > 0 ? Math.round((pickedUnits / totalUnits) * 100) : 0;

                        return (
                            <Card
                                key={order.id}
                                onClick={() => onSelectOrder(order)}
                                className="group cursor-pointer border-l-4 border-l-blue-500 hover:border-l-blue-600 transition-all hover:shadow-md bg-card dark:border-l-blue-400 flex flex-col justify-between"
                            >
                                <CardHeader className="p-4 pb-2 space-y-2">
                                    {/* Top Row: Customer Name as Title & Status Badge */}
                                    <div className="flex items-start justify-between gap-2">
                                        <h3 className="font-bold text-base sm:text-lg text-foreground truncate group-hover:text-blue-600 transition-colors">
                                            {order.customer_name || order.client_name || "Consumidor final"}
                                        </h3>
                                        <Badge
                                            variant={isPickingInProgress ? "default" : "secondary"}
                                            className={
                                                isPickingInProgress
                                                    ? "bg-blue-600 text-white font-semibold text-xs shrink-0"
                                                    : "font-semibold text-xs shrink-0"
                                            }
                                        >
                                            {statusLabel(order.status)}
                                        </Badge>
                                    </div>

                                    {/* Subtitle Row: Small subtle ID & Shipping Method */}
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono text-xs text-muted-foreground bg-muted/80 px-2 py-0.5 rounded">
                                            #{shortId}
                                        </span>
                                        {order.shipping_method === "delivery" ? (
                                            <Badge
                                                variant="outline"
                                                className="text-[11px] gap-1 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30 py-0"
                                            >
                                                <Truck className="h-3 w-3" /> Envío a domicilio
                                            </Badge>
                                        ) : (
                                            <Badge
                                                variant="outline"
                                                className="text-[11px] gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 py-0"
                                            >
                                                <Store className="h-3 w-3" /> Retiro en mostrador
                                            </Badge>
                                        )}
                                    </div>
                                </CardHeader>

                                <CardContent className="p-4 pt-2 space-y-3">
                                    {/* Required Delivery / Preparation Date with Urgency */}
                                    <div className="flex items-center justify-between text-xs bg-muted/40 p-2 rounded-md">
                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                            <Calendar className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                                            <span>
                                                {deliveryInfo.label}:{" "}
                                                <strong className="text-foreground">{deliveryInfo.formatted}</strong>
                                            </span>
                                        </div>
                                        {deliveryInfo.isUrgent && (
                                            <Badge
                                                variant="destructive"
                                                className="text-[10px] py-0 px-1.5 font-bold uppercase gap-0.5"
                                            >
                                                <Clock className="h-2.5 w-2.5" /> Urgente
                                            </Badge>
                                        )}
                                    </div>

                                    {/* Metrics: Items and Units */}
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span className="flex items-center gap-1">
                                            <Layers className="h-3.5 w-3.5" />
                                            {order.items.length} {order.items.length === 1 ? "ítem" : "ítems"}
                                        </span>
                                        <span className="flex items-center gap-1 font-medium text-foreground">
                                            <Package className="h-3.5 w-3.5 text-muted-foreground" />
                                            {totalUnits} {totalUnits === 1 ? "unidad" : "unidades"}
                                        </span>
                                    </div>

                                    {/* Progress bar if picking has started */}
                                    {isPickingInProgress && totalUnits > 0 && (
                                        <div className="space-y-1">
                                            <div className="flex justify-between text-[11px] text-muted-foreground">
                                                <span>Progreso de recolección</span>
                                                <span className="font-semibold text-blue-600">{progressPercent}%</span>
                                            </div>
                                            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-600 transition-all rounded-full"
                                                    style={{ width: `${progressPercent}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Action Button */}
                                    <Button
                                        className="mt-2 w-full gap-2 font-semibold"
                                        variant={isPickingInProgress ? "default" : "secondary"}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelectOrder(order);
                                        }}
                                    >
                                        {isPickingInProgress ? (
                                            <>
                                                <ScanLine className="h-4 w-4" /> Continuar picking
                                            </>
                                        ) : (
                                            <>
                                                <Play className="h-4 w-4" /> Iniciar picking
                                            </>
                                        )}
                                    </Button>
                                </CardContent>
                            </Card>
                        );
                    })
                )}
            </div>
        </div>
    );
}
