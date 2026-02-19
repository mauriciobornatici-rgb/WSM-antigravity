import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDashed, FileText, Package, Plus, Search, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Client, Order, Product } from "@/types";
import { queryKeys } from "@/lib/queryKeys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationControls } from "@/components/common/PaginationControls";

type OrderStatus = Order["status"];
type OrderFilter = OrderStatus | "all";
type ShippingMethod = "pickup" | "delivery";
type PaymentLine = { method: string; amount: number };

const PAYMENT_METHODS = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta débito" },
    { value: "credit_card", label: "Tarjeta crédito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
];
const EMPTY_ORDERS: Order[] = [];
const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_CLIENTS: Client[] = [];
const ORDERS_PAGE_SIZE = 20;

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

function getInvoiceTotal(order: Order): number {
    const picked = order.items
        .filter((item) => Number(item.picked_quantity || 0) > 0)
        .reduce((sum, item) => sum + Number(item.picked_quantity || 0) * Number(item.unit_price || 0), 0);
    if (picked > 0) return picked;
    return order.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
}

export default function OrdersPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<OrderFilter>("all");
    const [ordersPage, setOrdersPage] = useState(1);

    const [createOpen, setCreateOpen] = useState(false);
    const [createClientId, setCreateClientId] = useState("");
    const [createProductId, setCreateProductId] = useState("");
    const [createQuantity, setCreateQuantity] = useState(1);
    const [createPaymentMethod, setCreatePaymentMethod] = useState("cash");
    const [createCustomerName, setCreateCustomerName] = useState("");

    const [dispatchOpen, setDispatchOpen] = useState(false);
    const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null);
    const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("delivery");
    const [trackingNumber, setTrackingNumber] = useState("");
    const [shippingAddress, setShippingAddress] = useState("");
    const [estimatedDelivery, setEstimatedDelivery] = useState("");
    const [dispatchRecipientName, setDispatchRecipientName] = useState("");
    const [dispatchRecipientDni, setDispatchRecipientDni] = useState("");

    const [deliverOpen, setDeliverOpen] = useState(false);
    const [deliverOrder, setDeliverOrder] = useState<Order | null>(null);
    const [deliverRecipientName, setDeliverRecipientName] = useState("");
    const [deliverRecipientDni, setDeliverRecipientDni] = useState("");
    const [deliveryNotes, setDeliveryNotes] = useState("");

    const [invoiceOpen, setInvoiceOpen] = useState(false);
    const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
    const [invoicePayments, setInvoicePayments] = useState<PaymentLine[]>([]);

    const ordersQuery = useQuery({
        queryKey: queryKeys.orders.paged(filter, ordersPage, ORDERS_PAGE_SIZE),
        queryFn: () =>
            api.getOrdersPage({
                ...(filter !== "all" ? { status: filter } : {}),
                page: ordersPage,
                limit: ORDERS_PAGE_SIZE,
            }),
    });

    const productsQuery = useQuery({
        queryKey: queryKeys.products.all,
        queryFn: () => api.getProducts(),
    });

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    });

    const createOrderMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createOrder>[0]) => api.createOrder(payload),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.orders.all }),
                queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
            ]);
        },
    });

    const updateOrderStatusMutation = useMutation({
        mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
            api.updateOrderStatus(orderId, status),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
        },
    });

    const dispatchOrderMutation = useMutation({
        mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof api.dispatchOrder>[1] }) =>
            api.dispatchOrder(orderId, payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
        },
    });

    const deliverOrderMutation = useMutation({
        mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof api.deliverOrder>[1] }) =>
            api.deliverOrder(orderId, payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
        },
    });

    const createInvoiceMutation = useMutation({
        mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof api.createInvoiceFromOrder>[1] }) =>
            api.createInvoiceFromOrder(orderId, payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
        },
    });

    const orders: Order[] = ordersQuery.data?.data ?? EMPTY_ORDERS;
    const ordersPagination = ordersQuery.data?.pagination;
    const totalOrders = Number(ordersPagination?.totalCount ?? orders.length);
    const totalOrderPages = Number(ordersPagination?.totalPages ?? 1);
    const currentOrdersPage = Number(ordersPagination?.page ?? ordersPage);
    const products: Product[] = productsQuery.data ?? EMPTY_PRODUCTS;
    const clients: Client[] = clientsQuery.data ?? EMPTY_CLIENTS;
    const loading = ordersQuery.isLoading || productsQuery.isLoading || clientsQuery.isLoading;
    const hasLoadError = ordersQuery.isError || productsQuery.isError || clientsQuery.isError;

    const filteredOrders = useMemo(() => {
        const query = search.trim().toLowerCase();
        return orders.filter((order) => {
            const matchesFilter = filter === "all" || order.status === filter;
            if (!matchesFilter) return false;
            if (!query) return true;
            const clientText = (order.client_name ?? order.customer_name ?? "").toLowerCase();
            return order.id.toLowerCase().includes(query) || clientText.includes(query);
        });
    }, [orders, search, filter]);

    function handleFilterChange(nextFilter: OrderFilter) {
        setFilter(nextFilter);
        setOrdersPage(1);
    }

    async function createOrder() {
        if (!createProductId || createQuantity <= 0) {
            toast.error("Selecciona producto y cantidad válida");
            return;
        }
        try {
            const selectedClient = clients.find((client) => client.id === createClientId);
            const payload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedClient?.name || createCustomerName || "Consumidor final",
                payment_method: createPaymentMethod,
                items: [{ product_id: createProductId, quantity: createQuantity }],
            };
            if (createClientId) payload.client_id = createClientId;

            await createOrderMutation.mutateAsync(payload);
            toast.success("Pedido creado");
            setCreateOpen(false);
            setCreateClientId("");
            setCreateProductId("");
            setCreateQuantity(1);
            setCreatePaymentMethod("cash");
            setCreateCustomerName("");
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    async function startPicking(order: Order) {
        try {
            if (order.status === "pending") {
                await updateOrderStatusMutation.mutateAsync({ orderId: order.id, status: "picking" });
            }
            navigate(`/picking/${order.id}`);
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    function openDispatch(order: Order) {
        setDispatchOrder(order);
        setShippingMethod(order.shipping_method || "delivery");
        setTrackingNumber(order.tracking_number || "");
        setShippingAddress(order.shipping_address || "");
        setEstimatedDelivery(order.estimated_delivery || "");
        setDispatchRecipientName(order.recipient_name || "");
        setDispatchRecipientDni(order.recipient_dni || "");
        setDispatchOpen(true);
    }

    async function submitDispatch() {
        if (!dispatchOrder) return;
        const payload: Parameters<typeof api.dispatchOrder>[1] = { shipping_method: shippingMethod };
        if (shippingMethod === "delivery") {
            if (trackingNumber) payload.tracking_number = trackingNumber;
            if (shippingAddress) payload.shipping_address = shippingAddress;
            if (estimatedDelivery) payload.estimated_delivery = estimatedDelivery;
        } else {
            if (dispatchRecipientName) payload.recipient_name = dispatchRecipientName;
            if (dispatchRecipientDni) payload.recipient_dni = dispatchRecipientDni;
        }

        try {
            await dispatchOrderMutation.mutateAsync({ orderId: dispatchOrder.id, payload });
            toast.success("Pedido despachado");
            setDispatchOpen(false);
            setDispatchOrder(null);
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    function openDeliver(order: Order) {
        setDeliverOrder(order);
        setDeliverRecipientName(order.recipient_name || "");
        setDeliverRecipientDni(order.recipient_dni || "");
        setDeliveryNotes(order.delivery_notes || "");
        setDeliverOpen(true);
    }

    async function submitDelivery() {
        if (!deliverOrder) return;
        if (!deliverRecipientName || !deliverRecipientDni) {
            toast.error("Nombre y DNI son obligatorios");
            return;
        }
        try {
            await deliverOrderMutation.mutateAsync({
                orderId: deliverOrder.id,
                payload: {
                    recipient_name: deliverRecipientName,
                    recipient_dni: deliverRecipientDni,
                    ...(deliveryNotes ? { delivery_notes: deliveryNotes } : {}),
                },
            });
            toast.success("Entrega confirmada");
            setDeliverOpen(false);
            setDeliverOrder(null);
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    function openInvoice(order: Order) {
        const total = getInvoiceTotal(order);
        setInvoiceOrder(order);
        setInvoicePayments([{ method: "cash", amount: total }]);
        setInvoiceOpen(true);
    }

    function updateInvoicePayment(index: number, patch: Partial<PaymentLine>) {
        setInvoicePayments((current) =>
            current.map((line, currentIndex) => (currentIndex === index ? { ...line, ...patch } : line)),
        );
    }

    async function submitInvoice() {
        if (!invoiceOrder) return;
        const totalToPay = getInvoiceTotal(invoiceOrder);
        const totalPayments = invoicePayments.reduce((sum, line) => sum + Number(line.amount || 0), 0);
        if (Math.abs(totalPayments - totalToPay) > 0.01) {
            toast.error("El total de pagos no coincide con el monto a facturar");
            return;
        }
        try {
            await createInvoiceMutation.mutateAsync({ orderId: invoiceOrder.id, payload: { payments: invoicePayments } });
            toast.success("Factura creada");
            setInvoiceOpen(false);
            setInvoiceOrder(null);
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    async function cancelOrder(order: Order) {
        try {
            await updateOrderStatusMutation.mutateAsync({ orderId: order.id, status: "cancelled" });
            toast.success("Pedido cancelado");
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Pedidos de venta</h2>
                    <p className="text-muted-foreground">Gestión de ciclo comercial desde alta hasta entrega.</p>
                </div>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="gap-2">
                            <Plus className="h-4 w-4" />
                            Nuevo pedido
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Crear pedido</DialogTitle>
                            <DialogDescription>Carga cliente, producto y forma de pago.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                            <div className="space-y-2">
                                <Label>Cliente (opcional)</Label>
                                <Select value={createClientId} onValueChange={setCreateClientId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Consumidor final" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {clients.map((client) => (
                                            <SelectItem key={client.id} value={client.id}>
                                                {client.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Nombre mostrador</Label>
                                <Input value={createCustomerName} onChange={(event) => setCreateCustomerName(event.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>Producto</Label>
                                <Select value={createProductId} onValueChange={setCreateProductId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar producto" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {products.map((product) => (
                                            <SelectItem key={product.id} value={product.id}>
                                                {product.sku} - {product.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Cantidad</Label>
                                <Input
                                    type="number"
                                    min="1"
                                    value={createQuantity}
                                    onChange={(event) => setCreateQuantity(Math.max(1, Number(event.target.value) || 1))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Método de pago</Label>
                                <Select value={createPaymentMethod} onValueChange={setCreatePaymentMethod}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PAYMENT_METHODS.map((method) => (
                                            <SelectItem key={method.value} value={method.value}>
                                                {method.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setCreateOpen(false)}>
                                Cancelar
                            </Button>
                            <Button onClick={() => void createOrder()} disabled={createOrderMutation.isPending}>
                                {createOrderMutation.isPending ? "Creando..." : "Crear"}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                    <CardTitle>Listado</CardTitle>
                    <div className="flex flex-col gap-2 md:flex-row">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar" className="pl-8" />
                        </div>
                        <Select value={filter} onValueChange={(value) => handleFilterChange(value as OrderFilter)}>
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
                    {hasLoadError ? (
                        <div className="mb-4 flex flex-col gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100 md:flex-row md:items-center md:justify-between">
                            <span>No pudimos cargar la información de pedidos. Reintenta para actualizar los datos.</span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    void Promise.all([
                                        ordersQuery.refetch(),
                                        productsQuery.refetch(),
                                        clientsQuery.refetch(),
                                    ]);
                                }}
                            >
                                Reintentar
                            </Button>
                        </div>
                    ) : null}
                    <div className="mb-4 grid gap-4 md:grid-cols-3">
                        <SummaryCard title="Pendientes" count={orders.filter((o) => o.status === "pending").length} />
                        <SummaryCard title="En picking" count={orders.filter((o) => o.status === "picking").length} />
                        <SummaryCard title="Completos/Despachados" count={orders.filter((o) => ["packed", "dispatched", "delivered", "completed"].includes(o.status)).length} />
                    </div>
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
                                            <Badge variant={order.status === "cancelled" ? "destructive" : "outline"}>{statusLabel(order.status)}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">${Number(order.total_amount || 0).toLocaleString("es-AR")}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                {(order.status === "pending" || order.status === "picking") ? (
                                                    <Button size="sm" variant="outline" onClick={() => void startPicking(order)}>
                                                        <CircleDashed className="mr-1 h-4 w-4" />
                                                        Picking
                                                    </Button>
                                                ) : null}
                                                {order.status === "packed" ? (
                                                    <Button size="sm" variant="outline" onClick={() => openDispatch(order)}>
                                                        <Truck className="mr-1 h-4 w-4" />
                                                        Despachar
                                                    </Button>
                                                ) : null}
                                                {order.status === "dispatched" ? (
                                                    <Button size="sm" variant="outline" onClick={() => openDeliver(order)}>
                                                        <Package className="mr-1 h-4 w-4" />
                                                        Entregar
                                                    </Button>
                                                ) : null}
                                                {(order.status === "packed" || order.status === "dispatched" || order.status === "delivered" || order.status === "completed") && !order.invoice_id ? (
                                                    <Button size="sm" variant="outline" onClick={() => openInvoice(order)}>
                                                        <FileText className="mr-1 h-4 w-4" />
                                                        Facturar
                                                    </Button>
                                                ) : null}
                                                {(order.status === "pending" || order.status === "picking" || order.status === "packed") ? (
                                                    <Button size="sm" variant="destructive" onClick={() => void cancelOrder(order)}>
                                                        <XCircle className="mr-1 h-4 w-4" />
                                                        Cancelar
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                    <PaginationControls
                        page={Math.max(1, currentOrdersPage)}
                        totalPages={Math.max(1, totalOrderPages)}
                        totalCount={totalOrders}
                        itemLabel="pedido"
                        isLoading={ordersQuery.isFetching}
                        onPageChange={(nextPage) => setOrdersPage(Math.max(1, nextPage))}
                    />
                </CardContent>
            </Card>

            <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Despachar pedido</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label>Método</Label>
                            <Select value={shippingMethod} onValueChange={(value) => setShippingMethod(value as ShippingMethod)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="delivery">Envío</SelectItem>
                                    <SelectItem value="pickup">Retiro</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {shippingMethod === "delivery" ? (
                            <>
                                <Input placeholder="Tracking" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
                                <Input placeholder="Dirección" value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} />
                                <Input type="date" value={estimatedDelivery} onChange={(event) => setEstimatedDelivery(event.target.value)} />
                            </>
                        ) : (
                            <>
                                <Input placeholder="Nombre receptor" value={dispatchRecipientName} onChange={(event) => setDispatchRecipientName(event.target.value)} />
                                <Input placeholder="DNI receptor" value={dispatchRecipientDni} onChange={(event) => setDispatchRecipientDni(event.target.value)} />
                            </>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setDispatchOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void submitDispatch()} disabled={dispatchOrderMutation.isPending}>
                            {dispatchOrderMutation.isPending ? "Guardando..." : "Confirmar"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmar entrega</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Input placeholder="Nombre receptor" value={deliverRecipientName} onChange={(event) => setDeliverRecipientName(event.target.value)} />
                        <Input placeholder="DNI receptor" value={deliverRecipientDni} onChange={(event) => setDeliverRecipientDni(event.target.value)} />
                        <Input placeholder="Notas" value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setDeliverOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void submitDelivery()} disabled={deliverOrderMutation.isPending}>
                            {deliverOrderMutation.isPending ? "Guardando..." : "Confirmar"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Facturar pedido</DialogTitle>
                        <DialogDescription>Configura pagos para generar la factura.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="rounded-md border bg-slate-50 p-3 text-sm">
                            Total: <strong>${Number(invoiceOrder ? getInvoiceTotal(invoiceOrder) : 0).toLocaleString("es-AR")}</strong>
                        </div>
                        {invoicePayments.map((line, index) => (
                            <div key={`line-${index}`} className="grid grid-cols-12 gap-2">
                                <div className="col-span-7">
                                    <Select value={line.method} onValueChange={(value) => updateInvoicePayment(index, { method: value })}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PAYMENT_METHODS.map((method) => (
                                                <SelectItem key={method.value} value={method.value}>
                                                    {method.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="col-span-5">
                                    <Input type="number" min="0" step="0.01" value={line.amount} onChange={(event) => updateInvoicePayment(index, { amount: Number(event.target.value) || 0 })} />
                                </div>
                            </div>
                        ))}
                        <Button variant="outline" onClick={() => setInvoicePayments((current) => [...current, { method: "cash", amount: 0 }])}>
                            Agregar pago
                        </Button>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setInvoiceOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void submitInvoice()} disabled={createInvoiceMutation.isPending}>
                            {createInvoiceMutation.isPending ? "Facturando..." : "Emitir factura"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function SummaryCard({ title, count }: { title: string; count: number }) {
    return (
        <Card>
            <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">{title}</p>
                <p className="text-2xl font-bold">{count}</p>
            </CardContent>
        </Card>
    );
}
