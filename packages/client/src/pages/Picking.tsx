import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Box, Check, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { isApiError } from "@/services/httpClient";
import type { Order } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function sortItemsByLocation(order: Order): Order {
    const sortedItems = [...order.items].sort((left, right) => (left.location || "").localeCompare(right.location || ""));
    return {
        ...order,
        items: sortedItems,
    };
}

function toPickedFlag(order: Order): Order {
    return {
        ...order,
        items: order.items.map((item) => ({
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
    return order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function orderPickedQuantity(order: Order): number {
    return order.items.reduce((sum, item) => sum + Number(item.picked_quantity || 0), 0);
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
    const [orders, setOrders] = useState<Order[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [scannerInput, setScannerInput] = useState("");
    const [pendingScanItemId, setPendingScanItemId] = useState<string | null>(null);
    const [pendingScanQuantity, setPendingScanQuantity] = useState<number>(1);
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

    const pendingScanItem = useMemo(() => {
        if (!selectedOrder || !pendingScanItemId) return null;
        return selectedOrder.items.find((item) => item.id === pendingScanItemId) ?? null;
    }, [pendingScanItemId, selectedOrder]);

    const pendingScanRemaining = pendingScanItem ? itemRemainingQuantity(pendingScanItem) : 0;
    const canPick = selectedOrder ? isPickableStatus(selectedOrder.status) : false;

    async function transitionToPacked(order: Order): Promise<void> {
        if (order.status === "pending") {
            try {
                await api.updateOrderStatus(order.id, "picking");
            } catch (error) {
                const payload =
                    isApiError(error) && error.body && typeof error.body === "object"
                        ? (error.body as Record<string, unknown>)
                        : null;
                const recoverable =
                    isApiError(error)
                    && (
                        error.status === 409
                        || (error.status === 400 && payload?.error === "validation_error")
                    );
                if (!recoverable) throw error;
            }
        }
        await api.updateOrderStatus(order.id, "packed");
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

        const scannedSku = scannerInput.toUpperCase().trim();
        if (!scannedSku) return;

        const foundItem = selectedOrder.items.find(
            (item) => item.sku.toUpperCase() === scannedSku && itemRemainingQuantity(item) > 0,
        );
        if (!foundItem) {
            toast.error("SKU invalido o ya completo", {
                description: `El SKU ${scannedSku} no tiene pendiente en este pedido.`,
            });
            setScannerInput("");
            return;
        }

        const remaining = itemRemainingQuantity(foundItem);
        setPendingScanItemId(foundItem.id);
        setPendingScanQuantity(Math.max(1, remaining));
        setScannerInput("");
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
        setPendingScanItemId(null);
        setPendingScanQuantity(1);

        try {
            await api.pickOrderItem(pendingScanItem.id, nextPicked);
        } catch (error) {
            showErrorToast("Error al registrar cantidad", error);
            await loadOrders();
            return;
        }

        if (allPicked) {
            try {
                await transitionToPacked(selectedOrder);
                toast.success("Picking finalizado", {
                    description: `Pedido ${selectedOrder.id}: ${readyStatusLabel(selectedOrder)}.`,
                });
                await loadOrders();
                return;
            } catch (error) {
                showErrorToast("Cantidad guardada, pero no se pudo cerrar el picking", error);
                await loadOrders();
                return;
            }
        }

        toast.success("Cantidad registrada", {
            description: `${pendingScanItem.product_name} (${nextPicked}/${pendingScanItem.quantity})`,
        });
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
            await transitionToPacked(selectedOrder);
            setPendingScanItemId(null);
            setPendingScanQuantity(1);
            toast.warning("Picking cerrado con faltantes", {
                description: `${readyStatusLabel(selectedOrder)} con ${missing} unidades pendientes.`,
            });
            await loadOrders();
        } catch (error) {
            showErrorToast("Error al cerrar picking", error);
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
        const packedWithShortage = selectedOrder.status === "packed" && hasShortage;
        const packedComplete = selectedOrder.status === "packed" && !hasShortage;

        return (
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => navigate("/orders")}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Volver a pedidos
                    </Button>
                    <h2 className="text-2xl font-bold">Picking: {selectedOrder.id}</h2>
                    {packedWithShortage ? (
                        <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                            {readyStatusLabel(selectedOrder)} c/faltante
                        </Badge>
                    ) : packedComplete ? (
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                            {readyStatusLabel(selectedOrder)}
                        </Badge>
                    ) : (
                        <Badge variant="outline">{statusLabel(selectedOrder.status)}</Badge>
                    )}
                    <Badge className="bg-blue-600">{completion}%</Badge>
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
                            {canPick ? (
                                <Button type="button" variant="outline" onClick={() => void closeWithMissing()}>
                                    Cerrar con faltantes
                                </Button>
                            ) : null}
                        </form>

                        {pendingScanItem && canPick ? (
                            <div className="mt-4 space-y-3 rounded-md border border-blue-500/30 bg-blue-500/10 p-3">
                                <div className="space-y-1">
                                    <p className="text-sm font-semibold">{pendingScanItem.product_name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        SKU: {pendingScanItem.sku} | Solicitado: {pendingScanItem.quantity} | Recolectado: {Number(pendingScanItem.picked_quantity || 0)} | Pendiente: {pendingScanRemaining}
                                    </p>
                                </div>
                                <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)] md:items-end">
                                    <div className="space-y-2">
                                        <Label>Cantidad a registrar</Label>
                                        <Select
                                            value={String(pendingScanQuantity)}
                                            onValueChange={(value) => setPendingScanQuantity(Number(value))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {Array.from({ length: Math.max(1, pendingScanRemaining) }, (_, index) => index + 1).map((value) => (
                                                    <SelectItem key={value} value={String(value)}>
                                                        {value}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                                        <Button type="button" variant="outline" onClick={() => setPendingScanItemId(null)}>
                                            Cancelar
                                        </Button>
                                        <Button type="button" onClick={() => void confirmPendingScan()}>
                                            Confirmar cantidad
                                        </Button>
                                    </div>
                                </div>
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
                    {selectedOrder.items.map((item, index) => {
                        const remaining = itemRemainingQuantity(item);
                        const complete = itemIsComplete(item);
                        const warning = itemIsPartial(item) || (!canPick && remaining > 0);

                        return (
                            <Card
                                key={`${item.id}-${index}`}
                                className={cn(
                                    "transition",
                                    complete
                                        ? "border-emerald-500/40 bg-emerald-500/10 dark:border-emerald-500/50 dark:bg-emerald-500/10"
                                        : warning
                                            ? "border-amber-500/40 bg-amber-500/10 dark:border-amber-400/50 dark:bg-amber-500/10"
                                            : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70",
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
