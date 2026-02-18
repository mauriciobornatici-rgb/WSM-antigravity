import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CircleDashed, FileText, Package, Plus, Search, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Client, Order, Product } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type OrderStatus = Order["status"];
type OrderFilter = OrderStatus | "all";
type ShippingMethod = "pickup" | "delivery";
type PaymentLine = { method: string; amount: number };

const PAYMENT_METHODS = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta debito" },
    { value: "credit_card", label: "Tarjeta credito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
];

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
    const [orders, setOrders] = useState<Order[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<OrderFilter>("all");

    const [createOpen, setCreateOpen] = useState(false);
    const [createSubmitting, setCreateSubmitting] = useState(false);
    const [createClientId, setCreateClientId] = useState("");
    const [createProductId, setCreateProductId] = useState("");
    const [createQuantity, setCreateQuantity] = useState(1);
    const [createPaymentMethod, setCreatePaymentMethod] = useState("cash");
    const [createCustomerName, setCreateCustomerName] = useState("");

    const [dispatchOpen, setDispatchOpen] = useState(false);
    const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null);
    const [dispatchSubmitting, setDispatchSubmitting] = useState(false);
    const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("delivery");
    const [trackingNumber, setTrackingNumber] = useState("");
    const [shippingAddress, setShippingAddress] = useState("");
    const [estimatedDelivery, setEstimatedDelivery] = useState("");
    const [dispatchRecipientName, setDispatchRecipientName] = useState("");
    const [dispatchRecipientDni, setDispatchRecipientDni] = useState("");

    const [deliverOpen, setDeliverOpen] = useState(false);
    const [deliverOrder, setDeliverOrder] = useState<Order | null>(null);
    const [deliverSubmitting, setDeliverSubmitting] = useState(false);
    const [deliverRecipientName, setDeliverRecipientName] = useState("");
    const [deliverRecipientDni, setDeliverRecipientDni] = useState("");
    const [deliveryNotes, setDeliveryNotes] = useState("");

    const [invoiceOpen, setInvoiceOpen] = useState(false);
    const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
    const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);
    const [invoicePayments, setInvoicePayments] = useState<PaymentLine[]>([]);

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
            const matchesFilter = filter === "all" || order.status === filter;
            if (!matchesFilter) return false;
            if (!query) return true;
            const clientText = (order.client_name ?? order.customer_name ?? "").toLowerCase();
            return order.id.toLowerCase().includes(query) || clientText.includes(query);
        });
    }, [orders, search, filter]);

    async function createOrder() {
        if (!createProductId || createQuantity <= 0) {
            toast.error("Selecciona producto y cantidad valida");
            return;
        }
        try {
            setCreateSubmitting(true);
            const selectedClient = clients.find((client) => client.id === createClientId);
            const payload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedClient?.name || createCustomerName || "Consumidor final",
                payment_method: createPaymentMethod,
                items: [{ product_id: createProductId, quantity: createQuantity }],
            };
            if (createClientId) payload.client_id = createClientId;

            await api.createOrder(payload);
            toast.success("Pedido creado");
            setCreateOpen(false);
            setCreateClientId("");
            setCreateProductId("");
            setCreateQuantity(1);
            setCreatePaymentMethod("cash");
            setCreateCustomerName("");
            await loadData();
        } catch (error) {
            showErrorToast("Error al crear pedido", error);
        } finally {
            setCreateSubmitting(false);
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
            setDispatchSubmitting(true);
            await api.dispatchOrder(dispatchOrder.id, payload);
            toast.success("Pedido despachado");
            setDispatchOpen(false);
            setDispatchOrder(null);
            await loadData();
        } catch (error) {
            showErrorToast("Error al despachar", error);
        } finally {
            setDispatchSubmitting(false);
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
            setDeliverSubmitting(true);
            await api.deliverOrder(deliverOrder.id, {
                recipient_name: deliverRecipientName,
                recipient_dni: deliverRecipientDni,
                ...(deliveryNotes ? { delivery_notes: deliveryNotes } : {}),
            });
            toast.success("Entrega confirmada");
            setDeliverOpen(false);
            setDeliverOrder(null);
            await loadData();
        } catch (error) {
            showErrorToast("Error al confirmar entrega", error);
        } finally {
            setDeliverSubmitting(false);
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
            setInvoiceSubmitting(true);
            await api.createInvoiceFromOrder(invoiceOrder.id, { payments: invoicePayments });
            toast.success("Factura creada");
            setInvoiceOpen(false);
            setInvoiceOrder(null);
            await loadData();
        } catch (error) {
            showErrorToast("Error al facturar", error);
        } finally {
            setInvoiceSubmitting(false);
        }
    }

    async function cancelOrder(order: Order) {
        try {
            await api.updateOrderStatus(order.id, "cancelled");
            toast.success("Pedido cancelado");
            await loadData();
        } catch (error) {
            showErrorToast("Error al cancelar", error);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Pedidos de venta</h2>
                    <p className="text-muted-foreground">Gestion de ciclo comercial desde alta hasta entrega.</p>
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
                                <Label>Metodo de pago</Label>
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
                            <Button onClick={() => void createOrder()} disabled={createSubmitting}>
                                {createSubmitting ? "Creando..." : "Crear"}
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
                </CardContent>
            </Card>

            <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Despachar pedido</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label>Metodo</Label>
                            <Select value={shippingMethod} onValueChange={(value) => setShippingMethod(value as ShippingMethod)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="delivery">Envio</SelectItem>
                                    <SelectItem value="pickup">Retiro</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {shippingMethod === "delivery" ? (
                            <>
                                <Input placeholder="Tracking" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
                                <Input placeholder="Direccion" value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} />
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
                        <Button onClick={() => void submitDispatch()} disabled={dispatchSubmitting}>
                            {dispatchSubmitting ? "Guardando..." : "Confirmar"}
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
                        <Button onClick={() => void submitDelivery()} disabled={deliverSubmitting}>
                            {deliverSubmitting ? "Guardando..." : "Confirmar"}
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
                        <Button onClick={() => void submitInvoice()} disabled={invoiceSubmitting}>
                            {invoiceSubmitting ? "Facturando..." : "Emitir factura"}
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
