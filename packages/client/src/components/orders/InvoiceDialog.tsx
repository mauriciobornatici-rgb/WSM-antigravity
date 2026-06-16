import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
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
        .reduce((sum, item) => sum + Number(item.picked_quantity || 0) * Number(item.unit_price || 0), 0)
    if (picked > 0) return picked
    return items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0)
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
                            <span className="text-muted-foreground">Total factura</span>
                            <strong className="text-foreground">
                                ${invoiceTotalAmount.toLocaleString("es-AR")}
                            </strong>
                        </div>
                        <p className="border-t pt-2 text-xs text-muted-foreground">
                            No se registra cobro en este paso. El pago se carga luego en cuenta corriente (parcial o mixto).
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
