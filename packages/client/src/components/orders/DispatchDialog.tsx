import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Order } from "@/types"
import type { ShippingMethod } from "@/types/orders"

interface DispatchDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    order: Order | null
}

export function DispatchDialog({ open, onOpenChange, order }: DispatchDialogProps) {
    const queryClient = useQueryClient()

    const [shippingMethod, setShippingMethod] = useState<ShippingMethod>(order?.shipping_method || "delivery")
    const [trackingNumber, setTrackingNumber] = useState(order?.tracking_number || "")
    const [shippingAddress, setShippingAddress] = useState(order?.shipping_address || "")
    const [estimatedDelivery, setEstimatedDelivery] = useState(order?.estimated_delivery || "")
    const [dispatchRecipientName, setDispatchRecipientName] = useState(order?.recipient_name || "")
    const [dispatchRecipientDni, setDispatchRecipientDni] = useState(order?.recipient_dni || "")

    const dispatchOrderMutation = useMutation({
        mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof api.dispatchOrder>[1] }) =>
            api.dispatchOrder(orderId, payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
        },
    })

    async function submitDispatch() {
        if (!order) return
        const payload: Parameters<typeof api.dispatchOrder>[1] = { shipping_method: shippingMethod }
        if (shippingMethod === "delivery") {
            if (trackingNumber) payload.tracking_number = trackingNumber
            if (shippingAddress) payload.shipping_address = shippingAddress
            if (estimatedDelivery) payload.estimated_delivery = estimatedDelivery
        } else {
            if (dispatchRecipientName) payload.recipient_name = dispatchRecipientName
            if (dispatchRecipientDni) payload.recipient_dni = dispatchRecipientDni
        }

        try {
            await dispatchOrderMutation.mutateAsync({ orderId: order.id, payload })
            toast.success("Pedido despachado")
            onOpenChange(false)
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Despachar pedido</DialogTitle>
                    <DialogDescription>Completa datos segun metodo logistico.</DialogDescription>
                </DialogHeader>
                <form
                    className="space-y-4"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void submitDispatch()
                    }}
                >
                    <div className="space-y-2">
                        <Label>Metodo logistico</Label>
                        <Select
                            value={shippingMethod}
                            onValueChange={(value) => setShippingMethod(value as ShippingMethod)}
                        >
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
                                <Input
                                    placeholder="Ej: TRACK-0001"
                                    value={trackingNumber}
                                    onChange={(event) => setTrackingNumber(event.target.value)}
                                />
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label>Direccion de entrega</Label>
                                <Input
                                    placeholder="Calle, numero, localidad"
                                    value={shippingAddress}
                                    onChange={(event) => setShippingAddress(event.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Fecha estimada</Label>
                                <Input
                                    type="date"
                                    value={estimatedDelivery}
                                    onChange={(event) => setEstimatedDelivery(event.target.value)}
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Nombre de quien retira</Label>
                                <Input
                                    placeholder="Nombre completo"
                                    value={dispatchRecipientName}
                                    onChange={(event) => setDispatchRecipientName(event.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>DNI de quien retira</Label>
                                <Input
                                    placeholder="Solo numeros"
                                    value={dispatchRecipientDni}
                                    onChange={(event) => setDispatchRecipientDni(event.target.value)}
                                />
                            </div>
                        </div>
                    )}
                    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={dispatchOrderMutation.isPending}>
                            {dispatchOrderMutation.isPending ? "Guardando..." : "Confirmar"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
