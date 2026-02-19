import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Box, Check, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Order } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

export default function PickingPage() {
    const { id } = useParams<{ id?: string }>();
    const navigate = useNavigate();
    const [orders, setOrders] = useState<Order[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [scannerInput, setScannerInput] = useState("");
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
        const total = selectedOrder.items.length;
        if (total === 0) return 0;
        const picked = selectedOrder.items.filter((item) => item.picked).length;
        return Math.round((picked / total) * 100);
    }, [selectedOrder]);

    async function handleScan(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedOrder) return;

        const scannedSku = scannerInput.toUpperCase().trim();
        if (!scannedSku) return;

        const itemIndex = selectedOrder.items.findIndex((item) => item.sku.toUpperCase() === scannedSku && !item.picked);
        if (itemIndex < 0) {
            toast.error("SKU inválido o ya completado", {
                description: `El SKU ${scannedSku} no coincide con items pendientes.`,
            });
            setScannerInput("");
            return;
        }

        const item = selectedOrder.items[itemIndex];
        if (!item) return;

        const nextPicked = Math.min(Number(item.quantity || 0), Number(item.picked_quantity || 0) + 1);
        const updatedItem = {
            ...item,
            picked_quantity: nextPicked,
            picked: nextPicked >= Number(item.quantity || 0),
        };
        const nextItems = selectedOrder.items.map((current, index) => (index === itemIndex ? updatedItem : current));
        const nextOrder: Order = { ...selectedOrder, items: nextItems };
        setSelectedOrder(nextOrder);
        setScannerInput("");

        try {
            await api.pickOrderItem(item.id, nextPicked);
            const allPicked = nextItems.every((current) => current.picked);
            if (allPicked) {
                await api.updateOrderStatus(selectedOrder.id, "packed");
                toast.success("Picking completado", { description: `Pedido ${selectedOrder.id} listo para despacho.` });
                await loadOrders();
                navigate("/orders");
                return;
            }
            toast.success("Item registrado", {
                description: `${item.product_name} (${nextPicked}/${item.quantity})`,
            });
        } catch (error) {
            showErrorToast("Error al guardar picking", error);
        }
    }

    async function closeWithMissing() {
        if (!selectedOrder) return;
        const confirmed = window.confirm("Se cerrara el picking con faltantes. Deseas continuar?");
        if (!confirmed) return;
        try {
            await api.updateOrderStatus(selectedOrder.id, "packed");
            toast.warning("Picking cerrado con faltantes");
            await loadOrders();
            navigate("/orders");
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
        const completed = selectedOrder.items.every((item) => item.picked);
        return (
            <div className="space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => navigate("/orders")}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Volver a pedidos
                    </Button>
                    <h2 className="text-2xl font-bold">Picking: {selectedOrder.id}</h2>
                    <Badge variant="outline">{selectedOrder.status}</Badge>
                    <Badge className="bg-blue-600">{completion}%</Badge>
                </div>

                <Card className={cn("border", completed ? "border-green-500/40 bg-green-500/5" : "border-blue-500/30")}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ScanLine className="h-5 w-5" />
                            Escaner de productos
                        </CardTitle>
                        <CardDescription>
                            Escanea SKU o ingresa manualmente para validar cada item.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleScan} className="flex flex-col gap-3 md:flex-row">
                            <Input
                                value={scannerInput}
                                onChange={(event) => setScannerInput(event.target.value)}
                                placeholder="Ej: NK-AIR-001"
                                className="font-mono"
                                autoFocus
                            />
                            <Button type="submit" disabled={completed}>
                                Verificar
                            </Button>
                            {!completed ? (
                                <Button type="button" variant="outline" onClick={() => void closeWithMissing()}>
                                    Cerrar con faltantes
                                </Button>
                            ) : null}
                        </form>
                    </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {selectedOrder.items.map((item, index) => (
                        <Card
                            key={`${item.id}-${index}`}
                            className={cn(
                                "transition",
                                item.picked ? "border-emerald-400 bg-emerald-50/70" : "border-slate-200 bg-white",
                            )}
                        >
                            <CardContent className="space-y-3 p-4">
                                <div className="flex items-center justify-between">
                                    <Badge variant="outline">{item.location || "Sin ubicacion"}</Badge>
                                    <span className="font-mono text-xs text-slate-500">{item.sku}</span>
                                </div>
                                <h3 className={cn("font-semibold", item.picked ? "text-emerald-700 line-through" : "text-slate-900")}>
                                    {item.product_name}
                                </h3>
                                <div className="flex items-center justify-between text-sm">
                                    <span>
                                        Cantidad: <strong>{item.quantity}</strong>
                                    </span>
                                    <span>
                                        Picked: <strong>{item.picked_quantity || 0}</strong>
                                    </span>
                                </div>
                                <div className="flex justify-end">
                                    <div
                                        className={cn(
                                            "flex h-8 w-8 items-center justify-center rounded-full",
                                            item.picked ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500",
                                        )}
                                    >
                                        {item.picked ? <Check className="h-4 w-4" /> : <Box className="h-4 w-4" />}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
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
                        <Card key={order.id} className="cursor-pointer border-l-4 border-l-blue-500 transition hover:bg-slate-50">
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <CardTitle>{order.id}</CardTitle>
                                    <Badge variant={order.status === "pending" ? "default" : "secondary"}>{order.status}</Badge>
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
