import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { showErrorToast } from "@/lib/errorHandling"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Order } from "@/types"
import { ShippingChargeFields } from "./ShippingChargeFields"
import { EMPTY_SHIPPING_CHARGE, type ShippingChargeValue } from "./shippingCharge"

interface OrderShippingDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    order: Order
}

function initialShipping(order: Order): ShippingChargeValue {
    const current = (order.adjustments ?? []).find((adjustment) => adjustment.kind === "shipping")
    if (!current) return EMPTY_SHIPPING_CHARGE
    return {
        amount: String(Math.abs(Number(current.amount) || 0)),
        chargeCustomer: current.billable !== false,
        vatRate: String(current.vat_rate ?? 21),
    }
}

function ShippingForm({ order, onClose }: { order: Order; onClose: () => void }) {
    const queryClient = useQueryClient()
    const [shipping, setShipping] = useState<ShippingChargeValue>(() => initialShipping(order))

    const updateShippingMutation = useMutation({
        mutationFn: (body: Parameters<typeof api.updateOrderShipping>[1]) => api.updateOrderShipping(order.id, body),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
        },
    })

    async function save() {
        const amount = Number(shipping.amount)
        if (!Number.isFinite(amount) || amount < 0) {
            toast.error("Ingresá un importe de envío válido")
            return
        }
        try {
            await updateShippingMutation.mutateAsync({
                amount,
                charge_customer: shipping.chargeCustomer,
                vat_rate: Number(shipping.vatRate),
            })
            toast.success("Envío actualizado")
            onClose()
        } catch (error) {
            // Los 409 traen un mensaje en español (pedido facturado, con pagos, cancelado, de canal).
            showErrorToast("No se pudo actualizar el envío", error)
        }
    }

    return (
        <form
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault()
                void save()
            }}
        >
            <ShippingChargeFields
                idPrefix="edit-order-shipping"
                value={shipping}
                onChange={(patch) => setShipping((current) => ({ ...current, ...patch }))}
                disabled={updateShippingMutation.isPending}
            />
            <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={onClose} disabled={updateShippingMutation.isPending}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={updateShippingMutation.isPending}>
                    {updateShippingMutation.isPending ? "Guardando..." : "Guardar envío"}
                </Button>
            </div>
        </form>
    )
}

export function OrderShippingDialog({ open, onOpenChange, order }: OrderShippingDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Editar envío</DialogTitle>
                    <DialogDescription>
                        Cambiá el importe, la alícuota o si el envío se cobra al cliente.
                    </DialogDescription>
                </DialogHeader>
                <ShippingForm order={order} onClose={() => onOpenChange(false)} />
            </DialogContent>
        </Dialog>
    )
}
