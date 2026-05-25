import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Box, Check, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { isApiError } from "@/services/httpClient";
import { queryKeys } from "@/lib/queryKeys";
import type { Order } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function sortItemsByLocation(order: Order, descending: boolean = true): Order {
    const items = order.items || [];
    const sortedItems = [...items].sort((left, right) => {
        const locA = left.location || "";
        const locB = right.location || "";
        if (locA === locB) return 0;
        if (!locA) return 1;
        if (!locB) return -1;
        return descending ? locB.localeCompare(locA) : locA.localeCompare(locB);
    });
    return {
        ...order,
        items: sortedItems,
    };
}

function toPickedFlag(order: Order): Order {
    const items = order.items || [];
    return {
        ...order,
        items: items.map((item) => ({
            ...item,
            picked: Number(item.picked_quantity || 0) >= Number(item.quantity || 0),
        })),
    };
}

function isPickableStatus(status: string): boolean {
    return status === "pending" || status === "picking";
}

function itemRemainingQuantity(item: Order["items"][number]): number {
    return Math.max(0, Number(item.quantity || 0) - Number(item.picked_quantity || 0));
}

function itemIsComplete(item: Order["items"][number]): boolean {
    return itemRemainingQuantity(item) === 0;
}

function itemIsPartial(item: Order["items"][number]): boolean {
    return Number(item.picked_quantity || 0) > 0 && itemRemainingQuantity(item) > 0;
}

function orderTotalQuantity(order: Order): number {
    const items = order.items || [];
    return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function orderPickedQuantity(order: Order): number {
    const items = order.items || [];
    return items.reduce((sum, item) => sum + Number(item.picked_quantity || 0), 0);
}

function orderMissingQuantity(order: Order): number {
    return Math.max(0, orderTotalQuantity(order) - orderPickedQuantity(order));
}

function orderHasShortage(order: Order): boolean {
    return orderMissingQuantity(order) > 0;
}

function readyStatusLabel(order: Order): string {
    if (order.shipping_method === "pickup") return "Listo para retiro";
    if (order.shipping_method === "delivery") return "Listo para envio";
    return "Listo para despacho";
}

function statusLabel(status: Order["status"]): string {
    const labels: Record<Order["status"], string> = {
        pending: "Pendiente",
        picking: "En picking",
        packed: "Empaquetado",
        dispatched: "Despachado",
        delivered: "Entregado",
        completed: "Completado",
        cancelled: "Cancelado",
    };
    return labels[status] ?? status;
}

export default function PickingPage() {
    const { id } = useParams<{ id?: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [orders, setOrders] = useState<Order[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [scannerInput, setScannerInput] = useState("");
    const [pendingScanItemId, setPendingScanItemId] = useState<string | null>(null);
    const [pendingScanQuantity, setPendingScanQuantity] = useState<number>(1);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [routeDirection, setRouteDirection] = useState<'desc' | 'asc'>('desc');
    const [pickingStep, setPickingStep] = useState<'location' | 'barcode' | 'quantity'>('location');
    const [isLocationVerified, setIsLocationVerified] = useState(false);
    const [isBarcodeVerified, setIsBarcodeVerified] = useState(false);

    const selectItemForPicking = useCallback((item: Order["items"][number]) => {
        setPendingScanItemId(item.id);
        const remaining = Math.max(1, Number(item.quantity || 0) - Number(item.picked_quantity || 0));
        setPendingScanQuantity(remaining);
        
        const hasNoLocation = !item.location || item.location.trim().toLowerCase() === "general" || item.location.trim() === "";
        if (hasNoLocation) {
            setPickingStep('barcode');
            setIsLocationVerified(true);
        } else {
            setPickingStep('location');
            setIsLocationVerified(false);
        }
        setIsBarcodeVerified(false);
    }, []);

    const loadOrders = useCallback(async () => {
        try {
            setLoading(true);
            setErrorMessage(null);
            const response = await api.getOrders();
            const normalized = response.map((order) => toPickedFlag(sortItemsByLocation(order)));
            setOrders(normalized);
            if (id) {
                const found = normalized.find((order) => order.id === id);
                setSelectedOrder(found ?? null);
            }
        } catch (error) {
            setErrorMessage("No se pudieron cargar los pedidos para picking.");
            showErrorToast("Error al cargar pedidos", error);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void loadOrders();
    }, [loadOrders]);

    const completion = useMemo(() => {
        if (!selectedOrder) return 0;
        const total = orderTotalQuantity(selectedOrder);
        if (total === 0) return 0;
        const picked = orderPickedQuantity(selectedOrder);
        return Math.round((picked / total) * 100);
    }, [selectedOrder]);

    const sortedItems = useMemo(() => {
        if (!selectedOrder) return [];
        return [...selectedOrder.items].sort((left, right) => {
            const locA = left.location || "";
            const locB = right.location || "";
            if (locA === locB) return 0;
            if (!locA) return 1;
            if (!locB) return -1;
            return routeDirection === "desc" ? locB.localeCompare(locA) : locA.localeCompare(locB);
        });
    }, [selectedOrder, routeDirection]);

    const pendingScanItem = useMemo(() => {
        if (!selectedOrder || !pendingScanItemId) return null;
        return selectedOrder.items.find((item) => item.id === pendingScanItemId) ?? null;
    }, [pendingScanItemId, selectedOrder]);

    const pendingScanRemaining = pendingScanItem ? itemRemainingQuantity(pendingScanItem) : 0;
    const canPick = selectedOrder ? isPickableStatus(selectedOrder.status) : false;

    async function transitionToPacked(orderId: string): Promise<void> {
        const summary = await api.getOrderSummary(orderId);
        let currentStatus = String(summary.order?.status || "").toLowerCase();

        if (currentStatus === "packed") return;

        if (currentStatus === "pending") {
            try {
                await api.updateOrderStatus(orderId, "picking");
                currentStatus = "picking";
            } catch (error) {
                if (isApiError(error) && error.status === 400) {
                    throw new Error("El backend rechazo el estado 'picking'. Reinicia el servidor con la ultima version.");
                }
                throw error;
            }
        }

        if (currentStatus === "picking") {
            await api.updateOrderStatus(orderId, "packed");
            return;
        }

        if (currentStatus === "packed" || currentStatus === "dispatched" || currentStatus === "delivered" || currentStatus === "completed") {
            return;
        }

        throw new Error(`No se puede cerrar picking desde estado '${currentStatus || "desconocido"}'.`);
    }

    useEffect(() => {
        if (!pendingScanItem) return;
        if (pendingScanQuantity > pendingScanRemaining) {
            setPendingScanQuantity(Math.max(1, pendingScanRemaining));
        }
    }, [pendingScanItem, pendingScanQuantity, pendingScanRemaining]);

    async function handleScan(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedOrder) return;
        if (!canPick) {
            toast.warning("Este picking ya esta cerrado.");
            return;
        }

        const scannedText = scannerInput.toUpperCase().trim();
        setScannerInput("");
        if (!scannedText) return;

        // CASE 1: There is an active pending item
        if (pendingScanItem) {
            if (pickingStep === 'location') {
                const targetLoc = (pendingScanItem.location || "").toUpperCase().trim();
                if (scannedText === targetLoc) {
                    setIsLocationVerified(true);
                    setPickingStep('barcode');
                    toast.success("¡Ubicación confirmada!");
                    void api.recordPickingEvent(selectedOrder.id, {
                        product_id: pendingScanItem.product_id,
                        action_type: 'location_verified',
                        location_code: targetLoc
                    });
                } else {
                    toast.error(`Ubicación incorrecta: ${scannedText}`, {
                        description: `Debes ir a la ubicación: ${pendingScanItem.location || "Sin ubicación"}`,
                    });
                }
            } else if (pickingStep === 'barcode') {
                const skuMatch = pendingScanItem.sku.toUpperCase() === scannedText;
                const barcodeMatch = pendingScanItem.barcode && pendingScanItem.barcode.toUpperCase() === scannedText;
                if (skuMatch || barcodeMatch) {
                    setIsBarcodeVerified(true);
                    setPickingStep('quantity');
                    toast.success("¡Producto verificado!");
                    void api.recordPickingEvent(selectedOrder.id, {
                        product_id: pendingScanItem.product_id,
                        action_type: 'barcode_scanned',
                        barcode_scanned: scannedText
                    });
                } else {
                    toast.error(`Producto incorrecto`, {
                        description: `Se esperaba el SKU/Código: ${pendingScanItem.sku}`,
                    });
                }
            }
            return;
        }

        // CASE 2: No active pending item, let's look up by scanned location, SKU, or barcode!
        // First try matching location of any incomplete item
        const matchingLocItem = sortedItems.find(
            (item) => (item.location || "").toUpperCase().trim() === scannedText && itemRemainingQuantity(item) > 0
        );
        if (matchingLocItem) {
            selectItemForPicking(matchingLocItem);
            toast.info(`Ubicación detectada: ${matchingLocItem.location}`, {
                description: `Iniciando recolección de ${matchingLocItem.product_name}`,
            });
            return;
        }

        // Next try matching SKU or barcode of any incomplete item
        const matchingProductItem = sortedItems.find(
            (item) =>
                (item.sku.toUpperCase() === scannedText || (item.barcode && item.barcode.toUpperCase() === scannedText)) &&
                itemRemainingQuantity(item) > 0
        );
        if (matchingProductItem) {
            selectItemForPicking(matchingProductItem);
            toast.success(`Producto detectado: ${matchingProductItem.product_name}`);
            return;
        }

        toast.error("Código no reconocido", {
            description: `El código ${scannedText} no coincide con ninguna ubicación o producto pendiente en este pedido.`,
        });
    }

    async function confirmPendingScan() {
        if (!selectedOrder || !pendingScanItem) return;
        if (!canPick) {
            toast.warning("El pedido ya no admite picking.");
            return;
        }

        const currentPicked = Number(pendingScanItem.picked_quantity || 0);
        const remaining = itemRemainingQuantity(pendingScanItem);
        if (remaining <= 0) {
            toast.info("Este item ya esta completo.");
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
            return;
        }

        const quantityToAdd = Math.max(1, Math.min(Number(pendingScanQuantity || 1), remaining));
        const nextPicked = currentPicked + quantityToAdd;

        const nextItems = selectedOrder.items.map((item) =>
            item.id === pendingScanItem.id
                ? {
                    ...item,
                    picked_quantity: nextPicked,
                    picked: nextPicked >= Number(item.quantity || 0),
                }
                : item,
        );
        const nextOrder: Order = { ...selectedOrder, items: nextItems };
        const allPicked = nextItems.every((item) => itemIsComplete(item));

        setSelectedOrder(nextOrder);

        try {
            await api.pickOrderItem(pendingScanItem.id, nextPicked);
        } catch (error) {
            showErrorToast("Error al registrar cantidad", error);
            await loadOrders();
            return;
        }

        if (allPicked) {
            try {
                await transitionToPacked(selectedOrder.id);
                toast.success("Picking finalizado", {
                    description: `Pedido ${selectedOrder.id}: ${readyStatusLabel(selectedOrder)}.`,
                });
                setPendingScanItemId(null);
                setPendingScanQuantity(1);
                await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
                await loadOrders();
                return;
            } catch (error) {
                showErrorToast("Cantidad guardada, pero no se pudo cerrar el picking", error);
                setPendingScanItemId(null);
                setPendingScanQuantity(1);
                await loadOrders();
                return;
            }
        }

        toast.success("Cantidad registrada", {
            description: `${pendingScanItem.product_name} (${nextPicked}/${pendingScanItem.quantity})`,
        });

        // Auto-advance to the next incomplete item along the sorted route!
        const nextIncompleteItem = [...nextItems]
            .sort((left, right) => {
                const locA = left.location || "";
                const locB = right.location || "";
                if (locA === locB) return 0;
                if (!locA) return 1;
                if (!locB) return -1;
                return routeDirection === "desc" ? locB.localeCompare(locA) : locA.localeCompare(locB);
            })
            .find((item) => Number(item.picked_quantity || 0) < Number(item.quantity || 0));

        if (nextIncompleteItem) {
            selectItemForPicking(nextIncompleteItem);
        } else {
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
        }
    }

    async function closeWithMissing() {
        if (!selectedOrder) return;
        if (!canPick) {
            toast.info("El picking ya estaba cerrado.");
            return;
        }

        const missing = orderMissingQuantity(selectedOrder);
        if (missing <= 0) {
            toast.info("No hay faltantes para cerrar.");
            return;
        }

        const confirmed = window.confirm(`Se cerrara el picking con faltantes (${missing} unidades). Deseas continuar?`);
        if (!confirmed) return;
        try {
            void api.recordPickingEvent(selectedOrder.id, {
                product_id: "order_shortage_close",
                action_type: "shortage_closed",
                quantity: missing,
            });
            await transitionToPacked(selectedOrder.id);
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
            toast.warning("Picking cerrado con faltantes", {
                description: `${readyStatusLabel(selectedOrder)} con ${missing} unidades pendientes.`,
            });
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
            await loadOrders();
        } catch (error) {
            showErrorToast("Error al cerrar picking", error);
        }
    }

    async function finalizePicking() {
        if (!selectedOrder) return;
        if (!canPick) {
            toast.info("El picking ya estaba cerrado.");
            return;
        }

        const missing = orderMissingQuantity(selectedOrder);
        if (missing > 0) {
            toast.error(`Todavia hay faltantes (${missing}). Usa "Cerrar con faltantes" o completa el picking.`);
            return;
        }

        try {
            await transitionToPacked(selectedOrder.id);
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
            toast.success("Picking finalizado", {
                description: `Pedido ${selectedOrder.id}: ${readyStatusLabel(selectedOrder)}.`,
            });
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
            await loadOrders();
            navigate("/orders");
        } catch (error) {
            showErrorToast("No se pudo finalizar el picking", error);
        }
    }

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
        );
    }

    if (errorMessage && !selectedOrder) {
        return (
            <Card>
                <CardContent className="space-y-4 p-8 text-center">
                    <p className="text-sm text-muted-foreground">{errorMessage}</p>
                    <Button onClick={() => void loadOrders()}>Reintentar</Button>
                </CardContent>
            </Card>
        );
    }

    if (selectedOrder) {
        const completed = selectedOrder.items.every((item) => itemIsComplete(item));
        const hasShortage = orderHasShortage(selectedOrder);
        const missingQuantity = orderMissingQuantity(selectedOrder);
        const canFinalizeNow = canPick && missingQuantity === 0;
        const packedWithShortage = selectedOrder.status === "packed" && hasShortage;
        const packedComplete = selectedOrder.status === "packed" && !hasShortage;

        return (
            <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <Button variant="ghost" size="sm" onClick={() => navigate("/orders")}>
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Volver a pedidos
                        </Button>
                        <h2 className="text-2xl font-bold font-sans">Picking: {selectedOrder.id}</h2>
                        {packedWithShortage ? (
                            <Badge className="bg-amber-500/20 text-amber-700 border-amber-300 hover:bg-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-800/50 font-semibold">
                                {readyStatusLabel(selectedOrder)} c/faltante
                            </Badge>
                        ) : packedComplete ? (
                            <Badge className="bg-emerald-500/20 text-emerald-700 border-emerald-300 hover:bg-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-800/50 font-semibold">
                                {readyStatusLabel(selectedOrder)}
                            </Badge>
                        ) : canFinalizeNow ? (
                            <Badge className="bg-blue-600 text-white font-semibold">
                                Listo para cerrar
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="font-semibold">{statusLabel(selectedOrder.status)}</Badge>
                        )}
                        <Badge className="bg-blue-600 text-white font-bold">{completion}%</Badge>
                    </div>

                    <div className="flex items-center gap-2">
                        <Label className="text-xs font-semibold text-slate-500 shrink-0">Ruta de picking:</Label>
                        <Select 
                            value={routeDirection} 
                            onValueChange={(val) => setRouteDirection(val as 'desc' | 'asc')}
                        >
                            <SelectTrigger className="w-48 h-9 text-xs font-semibold">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="desc">Mayor a Menor (Optimizada)</SelectItem>
                                <SelectItem value="asc">Menor a Mayor (Normal)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <Card
                    className={cn(
                        "border",
                        packedWithShortage
                            ? "border-amber-500/50 bg-amber-500/10 dark:border-amber-400/50 dark:bg-amber-500/10"
                            : completed || packedComplete
                                ? "border-green-500/40 bg-green-500/5 dark:border-green-500/50 dark:bg-green-500/10"
                                : "border-blue-500/30 bg-blue-500/5 dark:border-blue-500/40 dark:bg-blue-950/30",
                    )}
                >
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ScanLine className="h-5 w-5" />
                            Escaner de productos
                        </CardTitle>
                        <CardDescription>
                            {canPick
                                ? "Escanea SKU, selecciona cantidad y confirma cada item."
                                : packedWithShortage
                                    ? "Pedido cerrado con faltantes. Los items pendientes quedan en naranja."
                                    : "Pedido cerrado. Ya no admite nuevas lecturas."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleScan} className="flex flex-col gap-3 md:flex-row">
                            <Input
                                value={scannerInput}
                                onChange={(event) => setScannerInput(event.target.value)}
                                placeholder="Ej: NK-AIR-001"
                                className="font-mono"
                                disabled={!canPick}
                                autoFocus
                            />
                            <Button type="submit" disabled={!canPick}>
                                Buscar SKU
                            </Button>
                            {canFinalizeNow ? (
                                <Button type="button" onClick={() => void finalizePicking()}>
                                    Finalizar picking
                                </Button>
                            ) : null}
                            {canPick && missingQuantity > 0 ? (
                                <Button type="button" variant="outline" onClick={() => void closeWithMissing()}>
                                    Cerrar con faltantes
                                </Button>
                            ) : null}
                        </form>

                        {pendingScanItem && canPick ? (
                            <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 dark:border-blue-400/30 dark:bg-blue-950/20 p-4 space-y-4 shadow-sm">
                                {/* Steps header */}
                                <div className="flex items-center justify-between border-b border-blue-500/20 pb-3">
                                    <div>
                                        <h3 className="font-bold text-slate-900 dark:text-slate-100">{pendingScanItem.product_name}</h3>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">SKU: {pendingScanItem.sku} | Cantidad Solicitada: {pendingScanItem.quantity}</p>
                                    </div>
                                    <Badge className="bg-blue-600 dark:bg-blue-500">
                                        {pickingStep === 'location' ? "Paso 1: Ubicación" : pickingStep === 'barcode' ? "Paso 2: Producto" : "Paso 3: Cantidad"}
                                    </Badge>
                                </div>

                                {/* Visual progress dots */}
                                <div className="flex items-center justify-center gap-6 py-2 text-xs font-semibold">
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                                            isLocationVerified 
                                                ? "bg-emerald-600 border-emerald-600 text-white" 
                                                : pickingStep === 'location' 
                                                    ? "bg-blue-600 border-blue-600 text-white animate-pulse" 
                                                    : "border-slate-300 text-slate-400"
                                        )}>
                                            {isLocationVerified ? "✓" : "1"}
                                        </span>
                                        <span className={isLocationVerified ? "text-emerald-500" : pickingStep === 'location' ? "text-blue-500" : "text-slate-400"}>Ubicación</span>
                                    </div>
                                    <div className="h-[1px] w-8 bg-slate-300 dark:bg-slate-700" />
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                                            isBarcodeVerified 
                                                ? "bg-emerald-600 border-emerald-600 text-white" 
                                                : pickingStep === 'barcode' 
                                                    ? "bg-blue-600 border-blue-600 text-white animate-pulse" 
                                                    : "border-slate-300 text-slate-400"
                                        )}>
                                            {isBarcodeVerified ? "✓" : "2"}
                                        </span>
                                        <span className={isBarcodeVerified ? "text-emerald-500" : pickingStep === 'barcode' ? "text-blue-500" : "text-slate-400"}>Producto</span>
                                    </div>
                                    <div className="h-[1px] w-8 bg-slate-300 dark:bg-slate-700" />
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                                            pickingStep === 'quantity' ? "bg-blue-600 border-blue-600 text-white animate-pulse" : "border-slate-300 text-slate-400"
                                        )}>
                                            3
                                        </span>
                                        <span className={pickingStep === 'quantity' ? "text-blue-500 animate-pulse" : "text-slate-400"}>Cantidad</span>
                                    </div>
                                </div>

                                {/* Step Content */}
                                {pickingStep === 'location' && (
                                    <div className="space-y-3 bg-white/50 dark:bg-black/20 p-3 rounded-lg border border-blue-500/10">
                                        <div className="text-center py-2">
                                            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Dirígete a la ubicación</p>
                                            <p className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 font-mono mt-1">{pendingScanItem.location || "Sin ubicación"}</p>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <p className="text-xs text-center text-slate-500">Usa el lector para escanear el código del estante o haz clic abajo para verificar manualmente.</p>
                                            <Button 
                                                type="button" 
                                                variant="secondary" 
                                                size="sm"
                                                onClick={() => {
                                                    setIsLocationVerified(true);
                                                    setPickingStep('barcode');
                                                    toast.success("¡Ubicación confirmada manualmente!");
                                                    void api.recordPickingEvent(selectedOrder.id, {
                                                        product_id: pendingScanItem.product_id,
                                                        action_type: 'location_verified_manual',
                                                        location_code: pendingScanItem.location
                                                    });
                                                }}
                                            >
                                                Confirmar ubicación manualmente
                                            </Button>
                                        </div>
                                    </div>
                                )}
 
                                {pickingStep === 'barcode' && (
                                    <div className="space-y-3 bg-white/50 dark:bg-black/20 p-3 rounded-lg border border-blue-500/10">
                                        <div className="text-center py-2">
                                            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Escanea el producto</p>
                                            <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">{pendingScanItem.product_name}</p>
                                            <div className="flex justify-center gap-4 text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 bg-slate-100 dark:bg-slate-900 py-1 px-3 rounded-md w-fit mx-auto">
                                                <span>SKU: {pendingScanItem.sku}</span>
                                                {pendingScanItem.barcode && <span>EAN: {pendingScanItem.barcode}</span>}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <p className="text-xs text-center text-slate-500">Escanea el código de barra del artículo o haz clic abajo para omitir el escaneo.</p>
                                            <Button 
                                                type="button" 
                                                variant="secondary" 
                                                size="sm"
                                                onClick={() => {
                                                    setIsBarcodeVerified(true);
                                                    setPickingStep('quantity');
                                                    toast.success("¡Producto verificado manualmente!");
                                                    void api.recordPickingEvent(selectedOrder.id, {
                                                        product_id: pendingScanItem.product_id,
                                                        action_type: 'barcode_scanned_manual',
                                                        barcode_scanned: pendingScanItem.sku
                                                    });
                                                }}
                                            >
                                                Omitir escaneo y verificar producto
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {pickingStep === 'quantity' && (
                                    <div className="space-y-3 bg-white/50 dark:bg-black/20 p-3 rounded-lg border border-blue-500/10">
                                        <div className="text-center py-1">
                                            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Confirma la cantidad recolectada</p>
                                            <p className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-1">{pendingScanItem.product_name}</p>
                                        </div>
                                        
                                        <div className="flex flex-col gap-3 items-center justify-center">
                                            <div className="flex items-center gap-4">
                                                <Button 
                                                    type="button" 
                                                    variant="outline" 
                                                    size="icon" 
                                                    className="h-10 w-10 text-xl font-bold"
                                                    onClick={() => setPendingScanQuantity(prev => Math.max(1, prev - 1))}
                                                >
                                                    -
                                                </Button>
                                                <Input 
                                                    type="number" 
                                                    min="1" 
                                                    max={pendingScanRemaining} 
                                                    value={pendingScanQuantity} 
                                                    onChange={(e) => setPendingScanQuantity(Math.max(1, Math.min(pendingScanRemaining, Number(e.target.value || 1))))}
                                                    className="w-20 text-center font-bold text-lg"
                                                />
                                                <Button 
                                                    type="button" 
                                                    variant="outline" 
                                                    size="icon" 
                                                    className="h-10 w-10 text-xl font-bold"
                                                    onClick={() => setPendingScanQuantity(prev => Math.min(pendingScanRemaining, prev + 1))}
                                                >
                                                    +
                                                </Button>
                                            </div>
                                            <span className="text-xs text-slate-500 dark:text-slate-400">Máximo pendiente: {pendingScanRemaining} unidades</span>
                                        </div>

                                        <div className="flex justify-end gap-2 border-t pt-3 mt-2">
                                            <Button type="button" variant="ghost" onClick={() => setPendingScanItemId(null)}>
                                                Cancelar
                                            </Button>
                                            <Button type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold" onClick={() => void confirmPendingScan()}>
                                                Confirmar y Avanzar
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : null}

                        <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-md border bg-background/70 p-3">
                                <p className="text-xs text-muted-foreground">Unidades solicitadas</p>
                                <p className="text-lg font-semibold">{orderTotalQuantity(selectedOrder)}</p>
                            </div>
                            <div className="rounded-md border bg-background/70 p-3">
                                <p className="text-xs text-muted-foreground">Unidades recolectadas</p>
                                <p className="text-lg font-semibold">{orderPickedQuantity(selectedOrder)}</p>
                            </div>
                            <div className={cn("rounded-md border p-3", missingQuantity > 0 ? "border-amber-500/50 bg-amber-500/10" : "bg-background/70")}>
                                <p className="text-xs text-muted-foreground">Faltante</p>
                                <p className={cn("text-lg font-semibold", missingQuantity > 0 ? "text-amber-400" : "")}>{missingQuantity}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {sortedItems.map((item, index) => {
                        const remaining = itemRemainingQuantity(item);
                        const complete = itemIsComplete(item);
                        const warning = itemIsPartial(item) || (!canPick && remaining > 0);
                        const isActive = pendingScanItemId === item.id;

                        return (
                            <Card
                                key={`${item.id}-${index}`}
                                onClick={() => !complete && canPick && selectItemForPicking(item)}
                                className={cn(
                                    "transition duration-200 cursor-pointer",
                                    isActive
                                        ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-950/20"
                                        : complete
                                            ? "border-emerald-500/40 bg-emerald-500/10 dark:border-emerald-500/50 dark:bg-emerald-500/10 hover:bg-emerald-500/5 cursor-default"
                                            : warning
                                                ? "border-amber-500/40 bg-amber-500/10 dark:border-amber-400/50 dark:bg-amber-500/10 hover:border-amber-500"
                                                : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70 hover:border-blue-500 dark:hover:border-blue-400",
                                )}
                            >
                                <CardContent className="space-y-3 p-4">
                                    <div className="flex items-center justify-between">
                                        <Badge variant="outline">{item.location || "Sin ubicacion"}</Badge>
                                        <span className="font-mono text-xs text-slate-500 dark:text-slate-300">{item.sku}</span>
                                    </div>
                                    <h3
                                        className={cn(
                                            "font-semibold",
                                            complete
                                                ? "text-emerald-700 line-through dark:text-emerald-300"
                                                : warning
                                                    ? "text-amber-200"
                                                    : "text-slate-900 dark:text-slate-100",
                                        )}
                                    >
                                        {item.product_name}
                                    </h3>
                                    <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
                                        <span>
                                            Cantidad: <strong>{item.quantity}</strong>
                                        </span>
                                        <span>
                                            Recolectado: <strong>{item.picked_quantity || 0}</strong>
                                        </span>
                                    </div>
                                    <div className={cn("text-xs", remaining > 0 ? "text-amber-300" : "text-emerald-300")}>
                                        {remaining > 0 ? `Faltante: ${remaining}` : "Item completo"}
                                    </div>
                                    <div className="flex justify-end">
                                        <div
                                            className={cn(
                                                "flex h-8 w-8 items-center justify-center rounded-full",
                                                complete
                                                    ? "bg-emerald-600 text-white"
                                                    : warning
                                                        ? "bg-amber-500 text-slate-950"
                                                        : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300",
                                            )}
                                        >
                                            {complete ? <Check className="h-4 w-4" /> : warning ? <AlertTriangle className="h-4 w-4" /> : <Box className="h-4 w-4" />}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>
        );
    }

    const pickableOrders = orders.filter((order) => isPickableStatus(order.status));

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Picking</h2>
                <p className="text-muted-foreground">Selecciona un pedido para iniciar la preparacion en deposito.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pickableOrders.length === 0 ? (
                    <Card>
                        <CardContent className="p-8 text-center text-muted-foreground">
                            No hay pedidos pendientes de picking.
                        </CardContent>
                    </Card>
                ) : (
                    pickableOrders.map((order) => (
                        <Card
                            key={order.id}
                            className="cursor-pointer border-l-4 border-l-blue-500 transition hover:bg-slate-50 dark:border-l-blue-400 dark:hover:bg-slate-900/70"
                        >
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <CardTitle>{order.id}</CardTitle>
                                    <Badge variant={order.status === "pending" ? "default" : "secondary"}>
                                        {statusLabel(order.status)}
                                    </Badge>
                                </div>
                                <CardDescription>{order.customer_name || order.client_name || "Sin cliente"}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="text-sm text-muted-foreground">
                                    {order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} items
                                </div>
                                <Button
                                    className="mt-4 w-full"
                                    onClick={() => {
                                        setSelectedOrder(toPickedFlag(sortItemsByLocation(order)));
                                    }}
                                >
                                    Iniciar picking
                                </Button>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
