import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { formatMoney } from "@/lib/formatters"
import { grossLineTotal, grossPrice } from "@/lib/pricing"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import type { Order } from "@/types"
import type { InvoiceType } from "@/types/orders"

interface InvoiceDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    order: Order | null
    onInvoiceCreated: (invoiceId: string) => void
}

const INVOICE_TYPES: Array<{ value: InvoiceType; label: string }> = [
    { value: "A", label: "Factura A" },
    { value: "B", label: "Factura B" },
    { value: "C", label: "Factura C" },
    { value: "TK", label: "Ticket" },
]

function getInvoiceTotal(order: Order): number {
    const items = order.items || []
    const picked = items
        .filter((item) => Number(item.picked_quantity || 0) > 0)
        .reduce((sum, item) => sum + grossLineTotal(item.picked_quantity, item.unit_price, item.vat_rate), 0)
    if (picked > 0) return picked
    return items.reduce((sum, item) => sum + grossLineTotal(item.quantity, item.unit_price, item.vat_rate), 0)
}

export function InvoiceDialog({ open, onOpenChange, order, onInvoiceCreated }: InvoiceDialogProps) {
    const queryClient = useQueryClient()
    const [invoiceType, setInvoiceType] = useState<InvoiceType>("B")

    const createInvoiceMutation = useMutation({
        mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof api.createInvoiceFromOrder>[1] }) =>
            api.createInvoiceFromOrder(orderId, payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
        },
    })

    const invoiceTotalAmount = order ? getInvoiceTotal(order) : 0

    async function submitInvoice() {
        if (!order) return
        try {
            const createdInvoice = await createInvoiceMutation.mutateAsync({
                orderId: order.id,
                payload: {
                    invoice_type: invoiceType,
                },
            })
            toast.success("Factura creada")
            onOpenChange(false)
            if (createdInvoice?.id) {
                onInvoiceCreated(String(createdInvoice.id))
            }
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Facturar pedido</DialogTitle>
                    <DialogDescription>Emite la factura y deja el saldo pendiente para cobrar luego.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <span className="text-muted-foreground">Cliente: </span>
                            <strong className="text-foreground">{order?.customer_name || order?.client_name || "Consumidor final"}</strong>
                        </div>
                        {order?.id ? (
                            <div className="text-muted-foreground">
                                Pedido: <span className="font-mono text-foreground font-semibold">#{order.id.slice(0, 8)}</span>
                            </div>
                        ) : null}
                    </div>

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

                    {/* Detalle de la venta */}
                    <div className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center justify-between">
                            <Label className="text-sm font-semibold">Detalle de la venta</Label>
                            <span className="text-xs text-muted-foreground">
                                {order?.items?.length || 0} {order?.items?.length === 1 ? "ítem" : "ítems"}
                            </span>
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-md border">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-muted/50 text-muted-foreground border-b sticky top-0">
                                    <tr>
                                        <th className="p-2 font-medium">Producto</th>
                                        <th className="p-2 font-medium text-center">Cant.</th>
                                        <th className="p-2 font-medium text-right">Precio Unit. (IVA incl.)</th>
                                        <th className="p-2 font-medium text-right">Subtotal (IVA incl.)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {order?.items && order.items.length > 0 ? (
                                        order.items.map((item) => {
                                            const billedQty = Number(item.picked_quantity || 0) > 0 ? Number(item.picked_quantity) : Number(item.quantity || 1)
                                            const unitPrice = grossPrice(item.unit_price, item.vat_rate)
                                            const subtotal = grossLineTotal(billedQty, item.unit_price, item.vat_rate)
                                            return (
                                                <tr key={item.id || item.product_id} className="hover:bg-muted/20">
                                                    <td className="p-2">
                                                        <span className="font-medium block text-foreground">{item.product_name || item.product_id}</span>
                                                        {item.sku ? <span className="text-muted-foreground text-[11px]">{item.sku}</span> : null}
                                                    </td>
                                                    <td className="p-2 text-center font-medium">
                                                        {billedQty}
                                                        {Number(item.picked_quantity || 0) > 0 && Number(item.picked_quantity) !== Number(item.quantity) ? (
                                                            <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                                                                (de {item.quantity} ped.)
                                                            </span>
                                                        ) : null}
                                                    </td>
                                                    <td className="p-2 text-right text-muted-foreground">
                                                        {formatMoney(unitPrice)}
                                                    </td>
                                                    <td className="p-2 text-right font-semibold text-foreground">
                                                        {formatMoney(subtotal)}
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    ) : (
                                        <tr>
                                            <td colSpan={4} className="p-3 text-center text-muted-foreground">
                                                Sin productos detallados
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                        <div className="flex items-center justify-between text-base">
                            <span className="text-muted-foreground font-medium">Total factura</span>
                            <strong className="text-foreground text-lg">
                                {formatMoney(invoiceTotalAmount)}
                            </strong>
                        </div>
                        <p className="border-t pt-2 text-xs text-muted-foreground">
                            No se registra cobro en este paso. La factura se emite y el cobro se registra en <strong>Cobranzas</strong> (Caja/Efectivo, Tarjeta, Transferencia o Cta Cte).
                        </p>
                    </div>
                </div>
                <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={() => void submitInvoice()} disabled={createInvoiceMutation.isPending}>
                        {createInvoiceMutation.isPending ? "Facturando..." : "Emitir factura"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
