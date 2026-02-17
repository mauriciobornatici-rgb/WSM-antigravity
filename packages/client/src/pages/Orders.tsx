import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleDashed, Package, Plus, Search, Truck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Client, Order, Product } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type OrderStatus = Order["status"];
type OrderFilter = OrderStatus | "all";

function statusLabel(status: OrderStatus): string {
    const labels: Record<OrderStatus, string> = {
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

export default function OrdersPage() {
    const navigate = useNavigate();
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<OrderFilter>("all");

    const [selectedClientId, setSelectedClientId] = useState("");
    const [selectedProductId, setSelectedProductId] = useState("");
    const [quantity, setQuantity] = useState(1);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        void loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [ordersResponse, productsResponse, clientsResponse] = await Promise.all([
                api.getOrders(),
                api.getProducts(),
                api.getClients(),
            ]);
            setOrders(ordersResponse);
            setProducts(productsResponse);
            setClients(clientsResponse);
        } catch (error) {
            showErrorToast("Error al cargar pedidos", error);
        } finally {
            setLoading(false);
        }
    }

    const filteredOrders = useMemo(() => {
        const query = search.trim().toLowerCase();
        return orders.filter((order) => {
            const byStatus = filter === "all" || order.status === filter;
            if (!byStatus) return false;
            if (!query) return true;
            const clientText = (order.client_name ?? order.customer_name ?? "").toLowerCase();
            return order.id.toLowerCase().includes(query) || clientText.includes(query);
        });
    }, [orders, search, filter]);

    async function handleCreateOrder() {
        if (!selectedProductId || quantity <= 0) {
            toast.error("Selecciona producto y cantidad valida");
            return;
        }
        try {
            setCreating(true);
            const selectedClient = clients.find((client) => client.id === selectedClientId);
            const payload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedClient?.name ?? "Consumidor final",
                payment_method: "cash",
                items: [{ product_id: selectedProductId, quantity }],
            };
            if (selectedClientId) payload.client_id = selectedClientId;
            await api.createOrder(payload);
            toast.success("Pedido creado");
            setSelectedProductId("");
            setQuantity(1);
            await loadData();
        } catch (error) {
            showErrorToast("Error al crear pedido", error);
        } finally {
            setCreating(false);
        }
    }

    async function startPicking(order: Order) {
        try {
            if (order.status === "pending") {
                await api.updateOrderStatus(order.id, "picking");
            }
            navigate(`/picking/${order.id}`);
        } catch (error) {
            showErrorToast("Error al iniciar picking", error);
        }
    }

    async function markDispatched(order: Order) {
        try {
            await api.dispatchOrder(order.id, { shipping_method: "pickup" });
            toast.success("Pedido despachado");
            await loadData();
        } catch (error) {
            showErrorToast("Error al despachar", error);
        }
    }

    async function markDelivered(order: Order) {
        try {
            await api.deliverOrder(order.id, {
                recipient_name: "Retiro en mostrador",
                recipient_dni: "S/D",
            });
            toast.success("Pedido entregado");
            await loadData();
        } catch (error) {
            showErrorToast("Error al entregar", error);
        }
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Pedidos de venta</h2>
                <p className="text-muted-foreground">Gestion de ciclo comercial desde alta hasta entrega.</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Crear pedido rapido
                    </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 md:grid-cols-4">
                    <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Cliente (opcional)" />
                        </SelectTrigger>
                        <SelectContent>
                            {clients.map((client) => (
                                <SelectItem key={client.id} value={client.id}>
                                    {client.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Producto" />
                        </SelectTrigger>
                        <SelectContent>
                            {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                    {product.sku} - {product.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
                    <Button onClick={() => void handleCreateOrder()} disabled={creating}>
                        {creating ? "Creando..." : "Crear"}
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                    <CardTitle>Listado</CardTitle>
                    <div className="flex flex-col gap-2 md:flex-row">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar" className="pl-8" />
                        </div>
                        <Select value={filter} onValueChange={(value) => setFilter(value as OrderFilter)}>
                            <SelectTrigger className="w-44">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="pending">Pendiente</SelectItem>
                                <SelectItem value="picking">En picking</SelectItem>
                                <SelectItem value="packed">Empaquetado</SelectItem>
                                <SelectItem value="dispatched">Despachado</SelectItem>
                                <SelectItem value="delivered">Entregado</SelectItem>
                                <SelectItem value="completed">Completado</SelectItem>
                                <SelectItem value="cancelled">Cancelado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>ID</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                                        Cargando...
                                    </TableCell>
                                </TableRow>
                            ) : filteredOrders.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                                        Sin resultados.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredOrders.map((order) => (
                                    <TableRow key={order.id}>
                                        <TableCell className="font-mono text-xs">{order.id}</TableCell>
                                        <TableCell>{order.client_name || order.customer_name || "-"}</TableCell>
                                        <TableCell>
                                            <Badge variant={order.status === "cancelled" ? "destructive" : "outline"}>
                                                {statusLabel(order.status)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            ${Number(order.total_amount || 0).toLocaleString("es-AR")}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                {(order.status === "pending" || order.status === "picking") ? (
                                                    <Button size="sm" variant="outline" onClick={() => void startPicking(order)}>
                                                        <CircleDashed className="mr-1 h-4 w-4" />
                                                        Picking
                                                    </Button>
                                                ) : null}
                                                {order.status === "packed" ? (
                                                    <Button size="sm" variant="outline" onClick={() => void markDispatched(order)}>
                                                        <Truck className="mr-1 h-4 w-4" />
                                                        Despachar
                                                    </Button>
                                                ) : null}
                                                {order.status === "dispatched" ? (
                                                    <Button size="sm" variant="outline" onClick={() => void markDelivered(order)}>
                                                        <Package className="mr-1 h-4 w-4" />
                                                        Entregar
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
