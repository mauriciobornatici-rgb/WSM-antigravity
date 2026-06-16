import { useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleDashed, Eye, FileText, Package, Plus, Search, Truck, XCircle } from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/services/api"
import type { Order } from "@/types"
import { queryKeys } from "@/lib/queryKeys"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PaginationControls } from "@/components/common/PaginationControls"
import { PrintableOrderArea } from "@/components/orders/PrintableOrderArea"
import { PrintableLabelArea } from "@/components/orders/PrintableLabelArea"
import { PrintableManifestArea } from "@/components/orders/PrintableManifestArea"

// Extracted Components
import { SummaryCard } from "@/components/orders/SummaryCard"
import { CreateOrderDialog } from "@/components/orders/CreateOrderDialog"
import { DispatchDialog } from "@/components/orders/DispatchDialog"
import { DeliverDialog } from "@/components/orders/DeliverDialog"
import { InvoiceDialog } from "@/components/orders/InvoiceDialog"
import { OrderDetailDialog } from "@/components/orders/OrderDetailDialog"
import { ManifestDialog } from "@/components/orders/ManifestDialog"

// Helpers and Types
import { orderHasShortage, renderStatusBadge } from "@/components/orders/helpers"
import type { OrderFilter } from "@/types/orders"

const EMPTY_ORDERS: Order[] = []
const ORDERS_PAGE_SIZE = 20

export default function OrdersPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { user } = useAuth()

    const [search, setSearch] = useState("")
    const [filter, setFilter] = useState<OrderFilter>("all")
    const [ordersPage, setOrdersPage] = useState(1)

    // Modal state triggers
    const [createOpen, setCreateOpen] = useState(false)
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)
    const [dispatchOpen, setDispatchOpen] = useState(false)
    const [dispatchOrder, setDispatchOrder] = useState<Order | null>(null)
    const [deliverOpen, setDeliverOpen] = useState(false)
    const [deliverOrder, setDeliverOrder] = useState<Order | null>(null)
    const [invoiceOpen, setInvoiceOpen] = useState(false)
    const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null)

    // Printing state triggers
    const [printOrder, setPrintOrder] = useState<Order | null>(null)
    const [printType, setPrintType] = useState<"remito" | "label" | null>(null)

    // Manifest / Hoja de ruta selection
    const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
    const [manifestDialogOpen, setManifestDialogOpen] = useState(false)
    const [manifestDriver, setManifestDriver] = useState("")
    const [manifestPlate, setManifestPlate] = useState("")
    const [manifestCarrier, setManifestCarrier] = useState("Flete Propio")
    const [manifestNotes, setManifestNotes] = useState("")
    const [printManifestOrders, setPrintManifestOrders] = useState<Order[]>([])
    const [printManifestActive, setPrintManifestActive] = useState(false)

    const ordersQuery = useQuery({
        queryKey: queryKeys.orders.paged(filter, ordersPage, ORDERS_PAGE_SIZE),
        queryFn: () =>
            api.getOrdersPage({
                ...(filter !== "all" ? { status: filter } : {}),
                page: ordersPage,
                limit: ORDERS_PAGE_SIZE,
            }),
    })

    const productsQuery = useQuery({
        queryKey: queryKeys.products.all,
        queryFn: () => api.getProducts(),
    })

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    })

    const updateOrderStatusMutation = useMutation({
        mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
            api.updateOrderStatus(orderId, status),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
        },
    })

    const orders: Order[] = ordersQuery.data?.data ?? EMPTY_ORDERS
    const ordersPagination = ordersQuery.data?.pagination
    const totalOrders = Number(ordersPagination?.totalCount ?? orders.length)
    const totalOrderPages = Number(ordersPagination?.totalPages ?? 1)
    const currentOrdersPage = Number(ordersPagination?.page ?? ordersPage)
    const products = productsQuery.data ?? []
    const clients = clientsQuery.data ?? []
    const loading = ordersQuery.isLoading || productsQuery.isLoading || clientsQuery.isLoading
    const hasLoadError = ordersQuery.isError || productsQuery.isError || clientsQuery.isError

    const filteredOrders = useMemo(() => {
        const query = search.trim().toLowerCase()
        return orders.filter((order) => {
            const matchesFilter = filter === "all" || order.status === filter
            if (!matchesFilter) return false
            if (!query) return true
            const clientText = (order.client_name ?? order.customer_name ?? "").toLowerCase()
            return order.id.toLowerCase().includes(query) || clientText.includes(query)
        })
    }, [orders, search, filter])

    function handleFilterChange(nextFilter: OrderFilter) {
        setFilter(nextFilter)
        setOrdersPage(1)
    }

    function openOrderDetail(order: Order) {
        setSelectedOrderId(order.id)
        setDetailOpen(true)
    }

    function handleTriggerPrint(order: Order, type: "remito" | "label") {
        setPrintOrder(order)
        setPrintType(type)
        toast.success(`Preparando impresión de ${type === "remito" ? "remito de picking" : "etiqueta térmica"}`)
        setTimeout(() => {
            window.print()
            setPrintOrder(null)
            setPrintType(null)
        }, 150)
    }

    function toggleOrderSelection(orderId: string) {
        setSelectedOrderIds((current) =>
            current.includes(orderId) ? current.filter((id) => id !== orderId) : [...current, orderId]
        )
    }

    function handleGenerateManifest(driver: string, plate: string, carrier: string, notes: string) {
        setManifestDriver(driver)
        setManifestPlate(plate)
        setManifestCarrier(carrier)
        setManifestNotes(notes)

        const ordersToPrint = orders.filter((o) => selectedOrderIds.includes(o.id))
        setPrintManifestOrders(ordersToPrint)
        setPrintManifestActive(true)
        toast.success("Preparando impresión de hoja de ruta consolidada")
        setTimeout(() => {
            window.print()
            setPrintManifestOrders([])
            setPrintManifestActive(false)
            setSelectedOrderIds([]) // Clear selection after printing
            setManifestDialogOpen(false)
        }, 150)
    }

    async function startPicking(order: Order) {
        try {
            const summary = await api.getOrderSummary(order.id)
            const realStatus = String(summary.order?.status || order.status).toLowerCase()
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
            navigate(`/picking/${order.id}`)
            if (realStatus !== "pending" && realStatus !== "picking") {
                toast.info("Este pedido ya no esta pendiente de picking. Se abre en modo consulta.")
            }
        } catch {
            navigate(`/picking/${order.id}`)
        }
    }

    function openDispatch(order: Order) {
        setDispatchOrder(order)
        setDispatchOpen(true)
    }

    function openDeliver(order: Order) {
        setDeliverOrder(order)
        setDeliverOpen(true)
    }

    function openInvoice(order: Order) {
        setInvoiceOrder(order)
        setInvoiceOpen(true)
    }

    function goToInvoice(invoiceId: string) {
        navigate(`/invoices?invoice_id=${encodeURIComponent(invoiceId)}`)
    }

    async function cancelOrder(order: Order) {
        try {
            await updateOrderStatusMutation.mutateAsync({ orderId: order.id, status: "cancelled" })
            toast.success("Pedido cancelado")
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
                <Button className="w-full gap-2 sm:w-auto" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Nuevo pedido
                </Button>
            </div>

            <Card>
                <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
                    <CardTitle>Listado</CardTitle>
                    <div className="flex flex-col gap-2 md:flex-row">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar"
                                className="pl-8"
                            />
                        </div>
                        <Select value={filter} onValueChange={(value) => handleFilterChange(value as OrderFilter)}>
                            <SelectTrigger className="w-44">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="pending">Pendiente</SelectItem>
                                <SelectItem value="picking">En picking</SelectItem>
                                <SelectItem value="packed">Listo para despacho</SelectItem>
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
                                    ])
                                }}
                            >
                                Reintentar
                            </Button>
                        </div>
                    ) : null}
                    <div className="mb-4 grid gap-4 md:grid-cols-3">
                        <SummaryCard title="Pendientes" count={orders.filter((o) => o.status === "pending").length} />
                        <SummaryCard title="En picking" count={orders.filter((o) => o.status === "picking").length} />
                        <SummaryCard
                            title="Completos/Despachados"
                            count={orders.filter((o) =>
                                ["packed", "dispatched", "delivered", "completed"].includes(o.status)
                            ).length}
                        />
                    </div>
                    <div className="overflow-x-auto">
                        <Table className="min-w-[900px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10"></TableHead>
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
                                        <TableCell colSpan={9} className="h-20 text-center text-muted-foreground">
                                            Cargando...
                                        </TableCell>
                                    </TableRow>
                                ) : filteredOrders.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="h-20 text-center text-muted-foreground">
                                            Sin resultados.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredOrders.map((order) => (
                                        <TableRow key={order.id}>
                                            <TableCell className="w-10">
                                                {order.shipping_method === "delivery" &&
                                                (order.status === "packed" || order.status === "dispatched") ? (
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-slate-350 accent-primary cursor-pointer"
                                                        checked={selectedOrderIds.includes(order.id)}
                                                        onChange={() => toggleOrderSelection(order.id)}
                                                    />
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{order.id}</TableCell>
                                            <TableCell>{order.client_name || order.customer_name || "-"}</TableCell>
                                            <TableCell>{order.counter_name || "-"}</TableCell>
                                            <TableCell>
                                                <div className="text-xs">
                                                    <div>
                                                        {order.shipping_method === "delivery"
                                                            ? "Envio"
                                                            : order.shipping_method === "pickup"
                                                            ? "Retiro"
                                                            : "-"}
                                                    </div>
                                                    <div className="text-muted-foreground">
                                                        {order.estimated_delivery
                                                            ? new Date(order.estimated_delivery).toLocaleDateString("es-AR")
                                                            : "-"}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>{renderStatusBadge(order.status, order)}</TableCell>
                                            <TableCell className="text-right">
                                                ${Number(order.total_amount || 0).toLocaleString("es-AR")}
                                            </TableCell>
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
                                                    <Button size="sm" variant="outline" onClick={() => openOrderDetail(order)}>
                                                        <Eye className="mr-1 h-4 w-4" />
                                                        Detalle
                                                    </Button>
                                                    {order.status === "pending" ||
                                                    order.status === "picking" ||
                                                    (order.status === "packed" && orderHasShortage(order)) ? (
                                                        <Button
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => void startPicking(order)}
                                                        >
                                                            <CircleDashed className="mr-1 h-4 w-4" />
                                                            {order.status === "packed" ? "Ver faltante" : "Picking"}
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
                                                    {(order.status === "packed" ||
                                                        order.status === "dispatched" ||
                                                        order.status === "delivered" ||
                                                        order.status === "completed") &&
                                                    !order.invoice_id ? (
                                                        <Button size="sm" variant="outline" onClick={() => openInvoice(order)}>
                                                            <FileText className="mr-1 h-4 w-4" />
                                                            Facturar
                                                        </Button>
                                                    ) : null}
                                                    {order.status === "pending" ||
                                                    order.status === "picking" ||
                                                    order.status === "packed" ? (
                                                        <Button
                                                            size="sm"
                                                            variant="destructive"
                                                            onClick={() => void cancelOrder(order)}
                                                        >
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

            {/* Create Order Dialog */}
            <CreateOrderDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                clients={clients}
                products={products}
                currentUser={user}
            />

            {/* Dispatch Dialog */}
            <DispatchDialog
                key={dispatchOrder?.id || 'none'}
                open={dispatchOpen}
                onOpenChange={setDispatchOpen}
                order={dispatchOrder}
            />

            {/* Deliver Dialog */}
            <DeliverDialog
                key={deliverOrder?.id || 'none'}
                open={deliverOpen}
                onOpenChange={setDeliverOpen}
                order={deliverOrder}
            />

            {/* Invoice Dialog */}
            <InvoiceDialog
                key={invoiceOrder?.id || 'none'}
                open={invoiceOpen}
                onOpenChange={setInvoiceOpen}
                order={invoiceOrder}
                onInvoiceCreated={goToInvoice}
            />

            {/* Order Detail Dialog */}
            <OrderDetailDialog
                open={detailOpen}
                onOpenChange={setDetailOpen}
                orderId={selectedOrderId}
                onTriggerPrint={handleTriggerPrint}
            />

            {/* Manifest Dialog */}
            <ManifestDialog
                open={manifestDialogOpen}
                onOpenChange={setManifestDialogOpen}
                orders={orders}
                selectedOrderIds={selectedOrderIds}
                onGenerateManifest={handleGenerateManifest}
            />

            {/* Printable Order / Label Areas */}
            {printOrder && printType === "remito" && <PrintableOrderArea order={printOrder} />}
            {printOrder && printType === "label" && <PrintableLabelArea order={printOrder} />}

            {/* Floating Selection Bar */}
            {selectedOrderIds.length > 0 && (
                <div className="fixed bottom-6 left-1/2 z-[45] -translate-x-1/2 flex items-center justify-between gap-4 rounded-full border border-primary/25 bg-slate-900 px-6 py-3 text-white shadow-2xl animate-in slide-in-from-bottom duration-300 no-print print:hidden">
                    <span className="text-sm font-semibold">
                        {selectedOrderIds.length}{" "}
                        {selectedOrderIds.length === 1 ? "pedido seleccionado" : "pedidos seleccionados"}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            className="rounded-full bg-primary hover:bg-primary/95 text-white"
                            onClick={() => setManifestDialogOpen(true)}
                        >
                            Generar Hoja de Ruta
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
                            onClick={() => setSelectedOrderIds([])}
                        >
                            Limpiar
                        </Button>
                    </div>
                </div>
            )}

            {/* Printable Manifest Area */}
            {printManifestActive && (
                <PrintableManifestArea
                    orders={printManifestOrders}
                    driver={manifestDriver}
                    plate={manifestPlate}
                    carrier={manifestCarrier}
                    notes={manifestNotes}
                />
            )}
        </div>
    )
}
