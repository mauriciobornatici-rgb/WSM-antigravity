import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDashed, Eye, FileText, Package, Plus, Search, Trash2, Truck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/services/api";
import { isApiError } from "@/services/httpClient";
import type { Client, Order, Product } from "@/types";
import { queryKeys } from "@/lib/queryKeys";
import { QuickClientDialog } from "@/components/pos/QuickClientDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PaginationControls } from "@/components/common/PaginationControls";

type OrderStatus = Order["status"];
type OrderFilter = OrderStatus | "all";
type ShippingMethod = "pickup" | "delivery";
type PaymentLine = { method: string; amount: number };
type InvoiceType = "A" | "B" | "C" | "TK";
type CreateOrderItem = { product_id: string; quantity: number };
type NewClientForm = {
    name: string;
    tax_id: string;
    email: string;
    phone: string;
    address: string;
    credit_limit: number;
};

const PAYMENT_METHODS = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta débito" },
    { value: "credit_card", label: "Tarjeta crédito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
];
const INVOICE_TYPES: Array<{ value: InvoiceType; label: string }> = [
    { value: "A", label: "Factura A" },
    { value: "B", label: "Factura B" },
    { value: "C", label: "Factura C" },
    { value: "TK", label: "Ticket" },
];
const EMPTY_ORDERS: Order[] = [];
const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_CLIENTS: Client[] = [];
const EMPTY_CREATE_ITEMS: CreateOrderItem[] = [];
const ORDERS_PAGE_SIZE = 20;
const CONSUMIDOR_FINAL_VALUE = "__consumidor_final__";

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
    const { user } = useAuth();

    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState<OrderFilter>("all");
    const [ordersPage, setOrdersPage] = useState(1);

    const [createOpen, setCreateOpen] = useState(false);
    const [createClientId, setCreateClientId] = useState("");
    const [createCounterName, setCreateCounterName] = useState("");
    const [createPaymentMethod, setCreatePaymentMethod] = useState("cash");
    const [createShippingMethod, setCreateShippingMethod] = useState<ShippingMethod>("pickup");
    const [createEstimatedDelivery, setCreateEstimatedDelivery] = useState("");
    const [createShippingAddress, setCreateShippingAddress] = useState("");
    const [createRecipientName, setCreateRecipientName] = useState("");
    const [createRecipientDni, setCreateRecipientDni] = useState("");
    const [createNotes, setCreateNotes] = useState("");
    const [createItems, setCreateItems] = useState<CreateOrderItem[]>(EMPTY_CREATE_ITEMS);
    const [productSearch, setProductSearch] = useState("");

    const [clientDialogOpen, setClientDialogOpen] = useState(false);
    const [creatingClient, setCreatingClient] = useState(false);
    const [newClient, setNewClient] = useState<NewClientForm>({
        name: "",
        tax_id: "",
        email: "",
        phone: "",
        address: "",
        credit_limit: 0,
    });

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
    const [invoiceType, setInvoiceType] = useState<InvoiceType>("B");

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
    const invoiceTotalAmount = Number(invoiceOrder ? getInvoiceTotal(invoiceOrder) : 0);
    const invoiceAssignedAmount = invoicePayments.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const invoiceDifference = invoiceTotalAmount - invoiceAssignedAmount;

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

    const selectedCreateClient = useMemo(
        () => clients.find((client) => client.id === createClientId) ?? null,
        [clients, createClientId],
    );

    const productById = useMemo(() => {
        return new Map(products.map((product) => [product.id, product]));
    }, [products]);

    const createProductsSearchResults = useMemo(() => {
        const query = productSearch.trim().toLowerCase();
        if (!query) return [];
        return products
            .filter((product) => {
                return (
                    product.name.toLowerCase().includes(query)
                    || product.sku.toLowerCase().includes(query)
                    || (product.barcode ?? "").toLowerCase().includes(query)
                );
            })
            .slice(0, 30);
    }, [products, productSearch]);

    const createOrderTotal = useMemo(() => {
        return createItems.reduce((sum, item) => {
            const product = productById.get(item.product_id);
            return sum + Number(item.quantity || 0) * Number(product?.sale_price || 0);
        }, 0);
    }, [createItems, productById]);

    useEffect(() => {
        if (!createOpen) return;
        setCreateCounterName(user?.name || "");
    }, [createOpen, user?.name]);

    function handleFilterChange(nextFilter: OrderFilter) {
        setFilter(nextFilter);
        setOrdersPage(1);
    }

    function resetCreateForm() {
        setCreateClientId("");
        setCreateCounterName(user?.name || "");
        setCreatePaymentMethod("cash");
        setCreateShippingMethod("pickup");
        setCreateEstimatedDelivery("");
        setCreateShippingAddress("");
        setCreateRecipientName("");
        setCreateRecipientDni("");
        setCreateNotes("");
        setCreateItems([]);
        setProductSearch("");
    }

    function handleCreateDialogOpenChange(open: boolean) {
        setCreateOpen(open);
        if (!open) resetCreateForm();
    }

    function addProductToCreateOrder(productId: string) {
        setCreateItems((current) => {
            const existing = current.find((item) => item.product_id === productId);
            if (existing) {
                return current.map((item) =>
                    item.product_id === productId
                        ? { ...item, quantity: item.quantity + 1 }
                        : item,
                );
            }
            return [...current, { product_id: productId, quantity: 1 }];
        });
    }

    function updateCreateItemQuantity(productId: string, quantity: number) {
        const safeQuantity = Math.max(1, Number(quantity || 1));
        setCreateItems((current) =>
            current.map((item) =>
                item.product_id === productId
                    ? { ...item, quantity: safeQuantity }
                    : item,
            ),
        );
    }

    function removeCreateItem(productId: string) {
        setCreateItems((current) => current.filter((item) => item.product_id !== productId));
    }

    async function createQuickClient() {
        if (!newClient.name || !newClient.tax_id) {
            toast.error("Nombre y CUIT/DNI son obligatorios");
            return;
        }

        try {
            setCreatingClient(true);
            const created = await api.createClient({
                name: newClient.name,
                tax_id: newClient.tax_id,
                email: newClient.email,
                phone: newClient.phone,
                address: newClient.address,
                credit_limit: Number(newClient.credit_limit || 0),
            });
            queryClient.setQueryData<Client[]>(queryKeys.clients.all, (current) =>
                current ? [created, ...current] : [created],
            );
            setCreateClientId(created.id);
            setClientDialogOpen(false);
            setNewClient({
                name: "",
                tax_id: "",
                email: "",
                phone: "",
                address: "",
                credit_limit: 0,
            });
            toast.success("Cliente creado");
        } catch {
            // El manejo global de httpClient ya informa el error.
        } finally {
            setCreatingClient(false);
        }
    }

    async function createOrder() {
        if (createItems.length === 0) {
            toast.error("Agrega al menos un producto al pedido");
            return;
        }
        if (createPaymentMethod === "credit_account" && !createClientId) {
            toast.error("Cuenta corriente requiere cliente");
            return;
        }
        if (!createEstimatedDelivery) {
            toast.error("Debes indicar la fecha de entrega o retiro");
            return;
        }
        if (!createRecipientName) {
            toast.error("Debes registrar quien retira o recibe");
            return;
        }
        if (createShippingMethod === "delivery" && !createShippingAddress) {
            toast.error("Completa la direccion para envio");
            return;
        }

        const invalidItem = createItems.find((item) => {
            const product = productById.get(item.product_id);
            if (!product) return true;
            const available = Number(product.stock_current ?? 0);
            return available <= 0 || Number(item.quantity || 0) > available;
        });
        if (invalidItem) {
            const product = productById.get(invalidItem.product_id);
            const available = Number(product?.stock_current ?? 0);
            toast.error(`Stock insuficiente para ${product?.name || invalidItem.product_id}. Disponible: ${available}`);
            return;
        }

        try {
            const payload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedCreateClient?.name || "Consumidor final",
                counter_name: createCounterName || user?.name || "",
                payment_method: createPaymentMethod,
                shipping_method: createShippingMethod,
                estimated_delivery: createEstimatedDelivery,
                shipping_address: createShippingMethod === "delivery" ? createShippingAddress : "",
                recipient_name: createRecipientName,
                recipient_dni: createRecipientDni,
                notes: createNotes,
                items: createItems.map((item) => ({
                    product_id: item.product_id,
                    quantity: Number(item.quantity || 1),
                })),
            };
            if (createClientId) payload.client_id = createClientId;
            if (user?.id) payload.counter_user_id = user.id;

            await createOrderMutation.mutateAsync(payload);
            toast.success("Pedido creado");
            handleCreateDialogOpenChange(false);
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
        } catch (error) {
            const payload =
                isApiError(error) && error.body && typeof error.body === "object"
                    ? (error.body as Record<string, unknown>)
                    : null;
            const recoverable =
                isApiError(error)
                && (
                    (error.status === 400 && payload?.error === "validation_error")
                    || error.status === 409
                );

            if (recoverable) {
                toast.warning("No se pudo actualizar estado automaticamente, continuamos en picking");
                navigate(`/picking/${order.id}`);
                return;
            }
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
        setInvoiceType("B");
        setInvoiceOpen(true);
    }

    function goToInvoice(invoiceId: string) {
        navigate(`/invoices?invoice_id=${encodeURIComponent(invoiceId)}`);
    }

    function updateInvoicePayment(index: number, patch: Partial<PaymentLine>) {
        setInvoicePayments((current) =>
            current.map((line, currentIndex) => (currentIndex === index ? { ...line, ...patch } : line)),
        );
    }

    function removeInvoicePayment(index: number) {
        setInvoicePayments((current) => {
            if (current.length <= 1) return current;
            return current.filter((_, currentIndex) => currentIndex !== index);
        });
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
            const createdInvoice = await createInvoiceMutation.mutateAsync({
                orderId: invoiceOrder.id,
                payload: {
                    invoice_type: invoiceType,
                    payments: invoicePayments,
                },
            });
            toast.success("Factura creada");
            setInvoiceOpen(false);
            setInvoiceOrder(null);
            setInvoicePayments([]);
            if (createdInvoice?.id) {
                goToInvoice(String(createdInvoice.id));
            }
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Pedidos de venta</h2>
                    <p className="text-muted-foreground">Gestión de ciclo comercial desde alta hasta entrega.</p>
                </div>
                <Dialog open={createOpen} onOpenChange={handleCreateDialogOpenChange}>
                    <DialogTrigger asChild>
                        <Button className="w-full gap-2 sm:w-auto">
                            <Plus className="h-4 w-4" />
                            Nuevo pedido
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                        <DialogHeader>
                            <DialogTitle>Crear pedido</DialogTitle>
                            <DialogDescription>
                                Registra cliente, productos y trazabilidad logistica del pedido.
                            </DialogDescription>
                        </DialogHeader>
                        <form
                            className="space-y-4"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void createOrder();
                            }}
                        >
                            <div className="space-y-3 rounded-md border p-3">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <Label>Cliente</Label>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="w-full sm:w-auto"
                                        onClick={() => setClientDialogOpen(true)}
                                    >
                                        Nuevo cliente
                                    </Button>
                                </div>
                                <Select
                                    value={createClientId || CONSUMIDOR_FINAL_VALUE}
                                    onValueChange={(value) =>
                                        setCreateClientId(value === CONSUMIDOR_FINAL_VALUE ? "" : value)
                                    }
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={CONSUMIDOR_FINAL_VALUE}>Consumidor final</SelectItem>
                                        {clients.map((client) => (
                                            <SelectItem key={client.id} value={client.id}>
                                                {client.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {selectedCreateClient ? (
                                    <div className="rounded-md border bg-muted/20 p-2 text-xs">
                                        <div>{selectedCreateClient.name}</div>
                                        <div className="text-muted-foreground">{selectedCreateClient.tax_id}</div>
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground">Se registrara como consumidor final.</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label>Nombre mostrador</Label>
                                <Input
                                    value={createCounterName}
                                    onChange={(event) => setCreateCounterName(event.target.value)}
                                    placeholder="Se completa segun usuario logueado"
                                />
                            </div>

                            <div className="space-y-3 rounded-md border p-3">
                                <Label>Productos del pedido</Label>
                                <Input
                                    value={productSearch}
                                    onChange={(event) => setProductSearch(event.target.value)}
                                    placeholder="Buscar por nombre, SKU o codigo de barras"
                                />
                                {productSearch.trim().length === 0 ? (
                                    <p className="text-xs text-muted-foreground">
                                        Escribe para buscar rapido y agregar productos.
                                    </p>
                                ) : null}
                                {productSearch.trim().length > 0 ? (
                                    <div className="max-h-52 overflow-y-auto rounded-md border">
                                        {createProductsSearchResults.length === 0 ? (
                                            <p className="px-3 py-2 text-sm text-muted-foreground">
                                                Sin coincidencias para la busqueda.
                                            </p>
                                        ) : (
                                            createProductsSearchResults.map((product) => {
                                                const alreadyAdded = createItems.some((item) => item.product_id === product.id);
                                                return (
                                                    <button
                                                        key={product.id}
                                                        type="button"
                                                        className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left hover:bg-muted/30"
                                                        onClick={() => addProductToCreateOrder(product.id)}
                                                    >
                                                        <span className="min-w-0">
                                                            <span className="block truncate text-sm font-medium">
                                                                {product.sku} - {product.name}
                                                            </span>
                                                            <span className="block text-xs text-muted-foreground">
                                                                Stock: {Number(product.stock_current ?? 0)}
                                                                {alreadyAdded ? " | Ya agregado" : ""}
                                                            </span>
                                                        </span>
                                                        <Plus className="h-4 w-4 shrink-0" />
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                ) : null}

                                {createItems.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">Aun no agregaste productos.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {createItems.map((item) => {
                                            const product = productById.get(item.product_id);
                                            return (
                                                <div key={item.product_id} className="grid gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1fr)_120px_130px_auto]">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium">
                                                            {product ? `${product.sku} - ${product.name}` : item.product_id}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            Stock disponible: {Number(product?.stock_current ?? 0)}
                                                        </p>
                                                    </div>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        value={item.quantity}
                                                        onChange={(event) =>
                                                            updateCreateItemQuantity(item.product_id, Number(event.target.value))
                                                        }
                                                    />
                                                    <div className="flex items-center text-sm font-semibold">
                                                        $
                                                        {(
                                                            Number(product?.sale_price || 0) * Number(item.quantity || 0)
                                                        ).toLocaleString("es-AR")}
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="w-full md:w-auto"
                                                        onClick={() => removeCreateItem(item.product_id)}
                                                    >
                                                        <Trash2 className="h-4 w-4 text-red-500" />
                                                    </Button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
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
                                <div className="space-y-2">
                                    <Label>Metodo logistico</Label>
                                    <Select value={createShippingMethod} onValueChange={(value) => setCreateShippingMethod(value as ShippingMethod)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="pickup">Retiro en local</SelectItem>
                                            <SelectItem value="delivery">Envio</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Fecha estimada entrega/retiro</Label>
                                    <Input
                                        type="date"
                                        value={createEstimatedDelivery}
                                        onChange={(event) => setCreateEstimatedDelivery(event.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Nombre de quien retira/recibe</Label>
                                    <Input
                                        value={createRecipientName}
                                        onChange={(event) => setCreateRecipientName(event.target.value)}
                                        placeholder="Nombre completo"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>DNI de quien retira/recibe</Label>
                                    <Input
                                        value={createRecipientDni}
                                        onChange={(event) => setCreateRecipientDni(event.target.value)}
                                        placeholder="Opcional"
                                    />
                                </div>
                                {createShippingMethod === "delivery" ? (
                                    <div className="space-y-2 sm:col-span-2">
                                        <Label>Direccion de entrega</Label>
                                        <Input
                                            value={createShippingAddress}
                                            onChange={(event) => setCreateShippingAddress(event.target.value)}
                                            placeholder="Calle, numero, localidad"
                                        />
                                    </div>
                                ) : null}
                                <div className="space-y-2 sm:col-span-2">
                                    <Label>Observaciones</Label>
                                    <Textarea
                                        value={createNotes}
                                        onChange={(event) => setCreateNotes(event.target.value)}
                                        placeholder="Notas internas, instrucciones, referencia de remito, etc."
                                    />
                                </div>
                            </div>

                            <div className="rounded-md border bg-muted/20 p-3 text-right text-sm">
                                Total pedido:{" "}
                                <strong>${createOrderTotal.toLocaleString("es-AR")}</strong>
                            </div>
                            <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                                <Button type="button" variant="outline" onClick={() => handleCreateDialogOpenChange(false)}>
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={createOrderMutation.isPending}>
                                    {createOrderMutation.isPending ? "Creando..." : "Crear"}
                                </Button>
                            </div>
                        </form>
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
                    <div className="overflow-x-auto">
                        <Table className="min-w-[900px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>ID</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Mostrador</TableHead>
                                <TableHead>Logistica</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead>Factura</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                                        Cargando...
                                    </TableCell>
                                </TableRow>
                            ) : filteredOrders.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                                        Sin resultados.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredOrders.map((order) => (
                                    <TableRow key={order.id}>
                                        <TableCell className="font-mono text-xs">{order.id}</TableCell>
                                        <TableCell>{order.client_name || order.customer_name || "-"}</TableCell>
                                        <TableCell>{order.counter_name || "-"}</TableCell>
                                        <TableCell>
                                            <div className="text-xs">
                                                <div>{order.shipping_method === "delivery" ? "Envio" : order.shipping_method === "pickup" ? "Retiro" : "-"}</div>
                                                <div className="text-muted-foreground">
                                                    {order.estimated_delivery
                                                        ? new Date(order.estimated_delivery).toLocaleDateString("es-AR")
                                                        : "-"}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={order.status === "cancelled" ? "destructive" : "outline"}>{statusLabel(order.status)}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">${Number(order.total_amount || 0).toLocaleString("es-AR")}</TableCell>
                                        <TableCell>
                                            {order.invoice_id ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => goToInvoice(String(order.invoice_id))}
                                                >
                                                    <Eye className="mr-1 h-4 w-4" />
                                                    Ver factura
                                                </Button>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
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
                    </div>
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

            <QuickClientDialog
                open={clientDialogOpen}
                onOpenChange={setClientDialogOpen}
                newClient={newClient}
                onNewClientChange={(patch) => setNewClient((current) => ({ ...current, ...patch }))}
                creatingClient={creatingClient}
                onCreateClient={() => {
                    void createQuickClient();
                }}
            />

            <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Despachar pedido</DialogTitle>
                        <DialogDescription>Completa datos segun metodo logistico.</DialogDescription>
                    </DialogHeader>
                    <form
                        className="space-y-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submitDispatch();
                        }}
                    >
                        <div className="space-y-2">
                            <Label>Metodo logistico</Label>
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
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2 sm:col-span-2">
                                    <Label>Codigo de seguimiento (opcional)</Label>
                                    <Input placeholder="Ej: TRACK-0001" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Label>Direccion de entrega</Label>
                                    <Input placeholder="Calle, numero, localidad" value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Fecha estimada</Label>
                                    <Input type="date" value={estimatedDelivery} onChange={(event) => setEstimatedDelivery(event.target.value)} />
                                </div>
                            </div>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Nombre de quien retira</Label>
                                    <Input placeholder="Nombre completo" value={dispatchRecipientName} onChange={(event) => setDispatchRecipientName(event.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>DNI de quien retira</Label>
                                    <Input placeholder="Solo numeros" value={dispatchRecipientDni} onChange={(event) => setDispatchRecipientDni(event.target.value)} />
                                </div>
                            </div>
                        )}
                        <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                            <Button type="button" variant="outline" onClick={() => setDispatchOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={dispatchOrderMutation.isPending}>
                                {dispatchOrderMutation.isPending ? "Guardando..." : "Confirmar"}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={deliverOpen} onOpenChange={setDeliverOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Confirmar entrega</DialogTitle>
                        <DialogDescription>Registra quien recibio el pedido y observaciones.</DialogDescription>
                    </DialogHeader>
                    <form
                        className="space-y-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submitDelivery();
                        }}
                    >
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Nombre receptor</Label>
                                <Input placeholder="Nombre completo" value={deliverRecipientName} onChange={(event) => setDeliverRecipientName(event.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>DNI receptor</Label>
                                <Input placeholder="Solo numeros" value={deliverRecipientDni} onChange={(event) => setDeliverRecipientDni(event.target.value)} />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label>Notas de entrega (opcional)</Label>
                                <Input placeholder="Observaciones" value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.target.value)} />
                            </div>
                        </div>
                        <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                            <Button type="button" variant="outline" onClick={() => setDeliverOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={deliverOrderMutation.isPending}>
                                {deliverOrderMutation.isPending ? "Guardando..." : "Confirmar"}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Facturar pedido</DialogTitle>
                        <DialogDescription>Configura tipo de comprobante y pagos para emitir la factura.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Tipo de factura</Label>
                                <Select value={invoiceType} onValueChange={(value) => setInvoiceType(value as InvoiceType)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {INVOICE_TYPES.map((invoiceTypeOption) => (
                                            <SelectItem key={invoiceTypeOption.value} value={invoiceTypeOption.value}>
                                                {invoiceTypeOption.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Total venta</span>
                                <strong className="text-foreground">
                                    ${invoiceTotalAmount.toLocaleString("es-AR")}
                                </strong>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">Total asignado</span>
                                <strong className="text-foreground">
                                    ${invoiceAssignedAmount.toLocaleString("es-AR")}
                                </strong>
                            </div>
                            <div className="flex items-center justify-between border-t pt-2">
                                <span className="text-muted-foreground">Diferencia</span>
                                <strong className={Math.abs(invoiceDifference) <= 0.01 ? "text-emerald-500" : "text-amber-500"}>
                                    ${invoiceDifference.toLocaleString("es-AR")}
                                </strong>
                            </div>
                        </div>
                        {invoicePayments.map((line, index) => (
                            <div key={`line-${index}`} className="grid grid-cols-12 gap-2">
                                <div className="col-span-12 sm:col-span-6">
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
                                <div className="col-span-9 sm:col-span-4">
                                    <Input type="number" min="0" step="0.01" value={line.amount} onChange={(event) => updateInvoicePayment(index, { amount: Number(event.target.value) || 0 })} />
                                </div>
                                <div className="col-span-3 flex justify-end sm:col-span-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-red-500"
                                        disabled={invoicePayments.length <= 1}
                                        onClick={() => removeInvoicePayment(index)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        <span className="sr-only">Quitar linea de pago</span>
                                    </Button>
                                </div>
                            </div>
                        ))}
                        <Button type="button" variant="outline" onClick={() => setInvoicePayments((current) => [...current, { method: "cash", amount: 0 }])}>
                            Agregar pago
                        </Button>
                    </div>
                    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={() => setInvoiceOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="button" onClick={() => void submitInvoice()} disabled={createInvoiceMutation.isPending}>
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

