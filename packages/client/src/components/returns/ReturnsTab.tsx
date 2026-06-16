import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { showErrorToast } from "@/lib/errorHandling"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { QueryErrorBanner, QueryLoadingState } from "./QueryStates"
import { mapClientReturnRows, returnStatusLabel } from "./helpers"
import type { ClientReturnRow, ReturnFormItem, OrderReturnSourceItem } from "@/types/returns"
import type { Client } from "@/types"

const EMPTY_CLIENTS: Client[] = []
const EMPTY_CLIENT_RETURNS: ClientReturnRow[] = []

export function ReturnsTab() {
    const queryClient = useQueryClient()

    const [createOpen, setCreateOpen] = useState(false)
    const [clientId, setClientId] = useState("")
    const [orderId, setOrderId] = useState("")
    const [reason, setReason] = useState("")
    const [returnItems, setReturnItems] = useState<ReturnFormItem[]>([])

    const returnsQuery = useQuery({
        queryKey: queryKeys.clientReturns.all,
        queryFn: async () => mapClientReturnRows(await api.getClientReturns()),
    })

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    })

    const ordersQuery = useQuery({
        queryKey: queryKeys.orders.all,
        queryFn: () => api.getOrders(),
    })

    const createReturnMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createClientReturn>[0]) => api.createClientReturn(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.clientReturns.all })
        },
    })

    const approveReturnMutation = useMutation({
        mutationFn: (id: string) => api.approveClientReturn(id),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.clientReturns.all }),
                queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all }),
            ])
        },
    })

    const returns = returnsQuery.data ?? EMPTY_CLIENT_RETURNS
    const clients = clientsQuery.data ?? EMPTY_CLIENTS
    const orders = ordersQuery.data ?? []

    const loading = returnsQuery.isLoading || clientsQuery.isLoading || ordersQuery.isLoading
    const hasLoadError = returnsQuery.isError || clientsQuery.isError || ordersQuery.isError

    function handleOrderChange(nextOrderId: string) {
        setOrderId(nextOrderId)
        if (!nextOrderId) {
            setReturnItems([])
            setClientId("")
            return
        }

        const order = orders.find((o) => o.id === nextOrderId)
        if (order && order.items) {
            const items = order.items.map((i: OrderReturnSourceItem): ReturnFormItem => ({
                product_id: i.product_id,
                product_name: i.product_name || i.product?.name || "Producto desconocido",
                quantity: 0,
                max_quantity: i.quantity,
                condition_status: "sellable",
                unit_price: i.unit_price || 0,
            }))
            setReturnItems(items)
            if (order.client_id) {
                setClientId(order.client_id)
            }
        }
    }

    async function handleCreateReturn() {
        const validItems = returnItems.filter((i) => i.quantity > 0)
        if (!orderId || validItems.length === 0) {
            toast.error("Seleccioná una orden e indicá cantidades a devolver mayores a 0")
            return
        }
        try {
            const selectedClient = clients.find((client) => client.id === clientId)
            const payload: Parameters<typeof api.createClientReturn>[0] = {
                order_id: orderId,
                customer_name: selectedClient?.name || "Consumidor final",
                reason,
                items: validItems.map((i) => ({
                    product_id: i.product_id,
                    quantity: i.quantity,
                    condition_status: i.condition_status,
                    unit_price: i.unit_price,
                })),
            }
            if (clientId) payload.client_id = clientId

            await createReturnMutation.mutateAsync(payload)
            toast.success("Devolución registrada")
            setCreateOpen(false)
            setClientId("")
            setOrderId("")
            setReturnItems([])
            setReason("")
        } catch (error) {
            showErrorToast("No se pudo registrar la devolución", error)
        }
    }

    async function handleApproveReturn(id: string) {
        try {
            await approveReturnMutation.mutateAsync(id)
            toast.success("Devolución aprobada")
        } catch (error) {
            showErrorToast("No se pudo aprobar la devolución", error)
        }
    }

    function retry() {
        void Promise.all([returnsQuery.refetch(), clientsQuery.refetch(), ordersQuery.refetch()])
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Devoluciones de clientes</CardTitle>
                <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva devolución
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                {hasLoadError ? <QueryErrorBanner onRetry={retry} /> : null}
                {loading ? <QueryLoadingState /> : null}

                {!loading ? (
                    <div className="overflow-x-auto">
                        <Table className="min-w-[860px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Orden</TableHead>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Motivo</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {returns.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                                            Sin devoluciones.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    returns.map((row) => (
                                        <TableRow key={row.id}>
                                            <TableCell>{new Date(row.created_at).toLocaleDateString("es-AR")}</TableCell>
                                            <TableCell>
                                                {row.order_id ? (
                                                    <Badge variant="secondary" className="font-mono text-xs">
                                                        {row.order_id.slice(0, 8)}
                                                    </Badge>
                                                ) : (
                                                    "-"
                                                )}
                                            </TableCell>
                                            <TableCell>{row.client_name}</TableCell>
                                            <TableCell>{row.reason}</TableCell>
                                            <TableCell>
                                                <Badge variant={row.status === "approved" ? "default" : "outline"}>
                                                    {returnStatusLabel(row.status)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                ${row.total_amount.toLocaleString("es-AR")}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                {row.status !== "approved" ? (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={approveReturnMutation.isPending}
                                                        onClick={() => void handleApproveReturn(row.id)}
                                                    >
                                                        Aprobar
                                                    </Button>
                                                ) : null}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                ) : null}
            </CardContent>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Nueva devolución</DialogTitle>
                        <DialogDescription>Registrá mercadería devuelta vinculada a una orden.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Orden de Venta</Label>
                                <Select value={orderId} onValueChange={handleOrderChange}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar orden" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {orders.map((order) => (
                                            <SelectItem key={order.id} value={order.id}>
                                                {order.id.slice(0, 8)} -{" "}
                                                {new Date(order.created_at).toLocaleDateString("es-AR")}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Cliente</Label>
                                <Select value={clientId} onValueChange={setClientId} disabled>
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
                        </div>
                        <div className="space-y-2">
                            <Label>Motivo general</Label>
                            <Input
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                placeholder="Ej: Cambio de talle, Defectuoso..."
                            />
                        </div>

                        {orderId && returnItems.length > 0 && (
                            <div className="border-t pt-4">
                                <Label className="mb-2 block font-semibold">Ítems de la orden</Label>
                                <div className="space-y-3">
                                    {returnItems.map((item, index) => (
                                        <div
                                            key={`${item.product_id}-${index}`}
                                            className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-12 items-center"
                                        >
                                            <div className="sm:col-span-4">
                                                <Label className="text-xs text-muted-foreground block">Producto</Label>
                                                <span className="text-sm font-medium">{item.product_name}</span>
                                            </div>
                                            <div className="sm:col-span-3">
                                                <Label className="text-xs text-muted-foreground block">
                                                    Cantidad a devolver
                                                </Label>
                                                <div className="flex items-center gap-2">
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        max={item.max_quantity}
                                                        value={item.quantity}
                                                        onChange={(e) => {
                                                            const newItems = [...returnItems]
                                                            const it = newItems[index]
                                                            if (it) {
                                                                it.quantity = Number(e.target.value)
                                                                setReturnItems(newItems)
                                                            }
                                                        }}
                                                        className="h-8 w-20"
                                                    />
                                                    <span className="text-xs text-muted-foreground">
                                                        / {item.max_quantity}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="sm:col-span-5">
                                                <Label className="text-xs text-muted-foreground block">Estado</Label>
                                                <Select
                                                    value={item.condition_status}
                                                    onValueChange={(val) => {
                                                        const newItems = [...returnItems]
                                                        const it = newItems[index]
                                                        if (it) {
                                                            it.condition_status = val
                                                            setReturnItems(newItems)
                                                        }
                                                    }}
                                                >
                                                    <SelectTrigger className="h-8">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="sellable">Reingreso a Stock</SelectItem>
                                                        <SelectItem value="loss">Pérdida</SelectItem>
                                                        <SelectItem value="supplier_rma">A proveedor</SelectItem>
                                                        <SelectItem value="rejected">Rechazado sin garantía</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-4">
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void handleCreateReturn()} disabled={createReturnMutation.isPending}>
                            Guardar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
