import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Eye, Trash2 } from "lucide-react"
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
import { returnStatusLabel } from "./helpers"
import type { SupplierReturnRow, SupplierReturnFormItem, SupplierReturnFormField } from "@/types/returns"
import type { Supplier } from "@/types"

export function SupplierReturnsTab() {
    const queryClient = useQueryClient()

    const [createOpen, setCreateOpen] = useState(false)
    const [detailOpen, setDetailOpen] = useState(false)
    const [selectedReturn, setSelectedReturn] = useState<SupplierReturnRow | null>(null)

    // Form state for creating a new return
    const [supplierId, setSupplierId] = useState("")
    const [notes, setNotes] = useState("")
    const [items, setItems] = useState<SupplierReturnFormItem[]>([
        { product_id: "", quantity: 1, unit_cost: 0, reason: "Defectuoso" }
    ])

    const returnsQuery = useQuery({
        queryKey: queryKeys.supplierReturns.all,
        queryFn: async () => {
            const raw = await api.getSupplierReturns()
            return (raw || []) as unknown as SupplierReturnRow[]
        },
    })

    const suppliersQuery = useQuery({
        queryKey: queryKeys.suppliers.all,
        queryFn: () => api.getSuppliers(),
    })

    const productsQuery = useQuery({
        queryKey: queryKeys.products.all,
        queryFn: () => api.getProducts(),
    })

    const createReturnMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createReturn>[0]) => api.createReturn(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.supplierReturns.all })
        },
    })

    const approveReturnMutation = useMutation({
        mutationFn: (id: string) => api.approveReturn(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.supplierReturns.all })
        },
    })

    const returns = returnsQuery.data ?? []
    const suppliers = (suppliersQuery.data ?? []) as Supplier[]
    const products = productsQuery.data ?? []

    const loading = returnsQuery.isLoading || suppliersQuery.isLoading || productsQuery.isLoading
    const hasLoadError = returnsQuery.isError || suppliersQuery.isError || productsQuery.isError

    // Helper to calculate total amount of a return row
    const getReturnTotal = (row: SupplierReturnRow) => {
        if (!row.items) return 0
        return row.items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_cost), 0)
    }

    const handleAddItem = () => {
        setItems([...items, { product_id: "", quantity: 1, unit_cost: 0, reason: "Defectuoso" }])
    }

    const handleRemoveItem = (index: number) => {
        if (items.length === 1) {
            toast.error("Debe tener al menos un ítem")
            return
        }
        const newItems = [...items]
        newItems.splice(index, 1)
        setItems(newItems)
    }

    const handleItemChange = (index: number, field: SupplierReturnFormField, value: string | number) => {
        const newItems = [...items]
        const currentItem = { ...newItems[index] }

        if (field === "product_id") {
            currentItem.product_id = value as string
            const prod = products.find((p) => p.id === value)
            if (prod) {
                currentItem.unit_cost = Number(prod.purchase_price || 0)
            }
        } else if (field === "quantity") {
            currentItem.quantity = Number(value)
        } else if (field === "unit_cost") {
            currentItem.unit_cost = Number(value)
        } else if (field === "reason") {
            currentItem.reason = value as string
        }

        newItems[index] = currentItem as typeof newItems[number]
        setItems(newItems)
    }

    async function handleCreateReturn() {
        if (!supplierId) {
            toast.error("Seleccioná un proveedor")
            return
        }

        const validItems = items.filter((item) => item.product_id && item.quantity > 0)
        if (validItems.length === 0) {
            toast.error("Agregá al menos un producto válido con cantidad mayor a 0")
            return
        }

        try {
            await createReturnMutation.mutateAsync({
                supplier_id: supplierId,
                notes: notes.trim(),
                items: validItems,
            })
            toast.success("Devolución a proveedor registrada en borrador")
            setCreateOpen(false)
            setSupplierId("")
            setNotes("")
            setItems([{ product_id: "", quantity: 1, unit_cost: 0, reason: "Defectuoso" }])
        } catch (error) {
            showErrorToast("No se pudo registrar la devolución a proveedor", error)
        }
    }

    async function handleApproveReturn(id: string) {
        try {
            await approveReturnMutation.mutateAsync(id)
            toast.success("Devolución aprobada exitosamente")
            if (selectedReturn?.id === id) {
                setDetailOpen(false)
            }
        } catch (error) {
            showErrorToast("No se pudo aprobar la devolución", error)
        }
    }

    function retry() {
        void Promise.all([returnsQuery.refetch(), suppliersQuery.refetch(), productsQuery.refetch()])
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Devoluciones a proveedores</CardTitle>
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
                        <Table className="min-w-[760px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>N° Comprobante</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Monto Total</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {returns.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                                            Sin devoluciones a proveedores.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    returns.map((row) => {
                                        const total = getReturnTotal(row)
                                        return (
                                            <TableRow key={row.id}>
                                                <TableCell className="font-mono font-bold">{row.return_number}</TableCell>
                                                <TableCell>
                                                    {new Date(row.created_at || row.date).toLocaleDateString("es-AR")}
                                                </TableCell>
                                                <TableCell>{row.supplier_name}</TableCell>
                                                <TableCell>
                                                    <Badge variant={row.status === "approved" ? "default" : "outline"}>
                                                        {returnStatusLabel(row.status)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right font-bold">
                                                    ${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            title="Ver detalles"
                                                            onClick={() => {
                                                                setSelectedReturn(row)
                                                                setDetailOpen(true)
                                                            }}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
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
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                ) : null}
            </CardContent>

            {/* Modal de Detalle */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Detalle de Devolución a Proveedor</DialogTitle>
                        <DialogDescription>Comprobante: {selectedReturn?.return_number}</DialogDescription>
                    </DialogHeader>
                    {selectedReturn && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="font-semibold text-muted-foreground">Proveedor:</span>{" "}
                                    {selectedReturn.supplier_name}
                                </div>
                                <div>
                                    <span className="font-semibold text-muted-foreground">Fecha:</span>{" "}
                                    {new Date(selectedReturn.created_at || selectedReturn.date).toLocaleDateString("es-AR")}
                                </div>
                                <div>
                                    <span className="font-semibold text-muted-foreground">Estado:</span>{" "}
                                    <Badge
                                        variant={selectedReturn.status === "approved" ? "default" : "outline"}
                                        className="ml-1"
                                    >
                                        {returnStatusLabel(selectedReturn.status)}
                                    </Badge>
                                </div>
                                <div>
                                    <span className="font-semibold text-muted-foreground">Monto Total:</span>{" "}
                                    <span className="font-bold">
                                        $
                                        {getReturnTotal(selectedReturn).toLocaleString("es-AR", {
                                            minimumFractionDigits: 2,
                                        })}
                                    </span>
                                </div>
                            </div>

                            {selectedReturn.notes && (
                                <div className="rounded-md bg-muted p-3 text-sm">
                                    <span className="font-semibold text-muted-foreground block mb-1">
                                        Notas/Observaciones:
                                    </span>
                                    {selectedReturn.notes}
                                </div>
                            )}

                            <div>
                                <h4 className="font-semibold mb-2 text-sm text-muted-foreground">Ítems Devueltos</h4>
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Producto</TableHead>
                                                <TableHead>SKU</TableHead>
                                                <TableHead className="text-right">Cantidad</TableHead>
                                                <TableHead className="text-right">Costo Unit.</TableHead>
                                                <TableHead className="text-right">Total</TableHead>
                                                <TableHead>Motivo</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {selectedReturn.items &&
                                                selectedReturn.items.map((item) => (
                                                    <TableRow key={item.id}>
                                                        <TableCell>{item.product_name}</TableCell>
                                                        <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                                                        <TableCell className="text-right">
                                                            {Number(item.quantity).toLocaleString("es-AR")}
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            $
                                                            {Number(item.unit_cost).toLocaleString("es-AR", {
                                                                minimumFractionDigits: 2,
                                                            })}
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold">
                                                            $
                                                            {(Number(item.quantity) * Number(item.unit_cost)).toLocaleString(
                                                                "es-AR",
                                                                { minimumFractionDigits: 2 }
                                                            )}
                                                        </TableCell>
                                                        <TableCell className="text-xs text-muted-foreground">
                                                            {item.reason || "-"}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>

                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-4">
                                <Button variant="outline" onClick={() => setDetailOpen(false)}>
                                    Cerrar
                                </Button>
                                {selectedReturn.status !== "approved" && (
                                    <Button
                                        onClick={() => void handleApproveReturn(selectedReturn.id)}
                                        disabled={approveReturnMutation.isPending}
                                    >
                                        Aprobar Devolución
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Modal "Nueva Devolución" */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Nueva devolución a proveedor</DialogTitle>
                        <DialogDescription>
                            Registrá mercadería en mal estado o rechazada para devolver al proveedor. Se creará en estado
                            Borrador.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Proveedor</Label>
                                <Select value={supplierId} onValueChange={setSupplierId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar proveedor" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {suppliers.map((supplier) => (
                                            <SelectItem key={supplier.id} value={supplier.id}>
                                                {supplier.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Notas/Observaciones</Label>
                                <Input
                                    placeholder="Ej: Lote defectuoso detectado por control de calidad..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="border-t pt-4">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="font-semibold text-sm">Ítems a Devolver</h4>
                                <Button type="button" variant="outline" size="sm" onClick={handleAddItem}>
                                    <Plus className="mr-1 h-3.5 w-3.5" />
                                    Agregar ítem
                                </Button>
                            </div>

                            <div className="space-y-3">
                                {items.map((item, index) => (
                                    <div
                                        key={index}
                                        className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-12 items-end"
                                    >
                                        <div className="space-y-1 sm:col-span-4">
                                            <Label className="text-xs">Producto</Label>
                                            <Select
                                                value={item.product_id}
                                                onValueChange={(val) => handleItemChange(index, "product_id", val)}
                                            >
                                                <SelectTrigger className="h-9">
                                                    <SelectValue placeholder="Seleccionar" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {products.map((prod) => (
                                                        <SelectItem key={prod.id} value={prod.id}>
                                                            {prod.name} (SKU: {prod.sku})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1 sm:col-span-2">
                                            <Label className="text-xs">Cantidad</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                step="any"
                                                className="h-9"
                                                value={item.quantity}
                                                onChange={(e) => handleItemChange(index, "quantity", Number(e.target.value))}
                                            />
                                        </div>
                                        <div className="space-y-1 sm:col-span-2">
                                            <Label className="text-xs">Costo Unitario ($)</Label>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="h-9"
                                                value={item.unit_cost}
                                                onChange={(e) => handleItemChange(index, "unit_cost", Number(e.target.value))}
                                            />
                                        </div>
                                        <div className="space-y-1 sm:col-span-3">
                                            <Label className="text-xs">Motivo</Label>
                                            <Select
                                                value={item.reason}
                                                onValueChange={(val) => handleItemChange(index, "reason", val)}
                                            >
                                                <SelectTrigger className="h-9">
                                                    <SelectValue placeholder="Seleccionar motivo" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Defectuoso">Defectuoso</SelectItem>
                                                    <SelectItem value="Error de envío">Error de envío</SelectItem>
                                                    <SelectItem value="Vencido">Vencido</SelectItem>
                                                    <SelectItem value="Otro">Otro</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="flex justify-end sm:col-span-1 pb-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => handleRemoveItem(index)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-4 pt-4 border-t">
                            <Button variant="outline" onClick={() => setCreateOpen(false)}>
                                Cancelar
                            </Button>
                            <Button onClick={() => void handleCreateReturn()} disabled={createReturnMutation.isPending}>
                                Guardar Borrador
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
