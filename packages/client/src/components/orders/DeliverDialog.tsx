import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Order } from "@/types"

interface DeliverDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    order: Order | null
}

export function DeliverDialog({ open, onOpenChange, order }: DeliverDialogProps) {
    const queryClient = useQueryClient()

    const [deliverRecipientName, setDeliverRecipientName] = useState(order?.recipient_name || "")
    const [deliverRecipientDni, setDeliverRecipientDni] = useState(order?.recipient_dni || "")
    const [deliveryNotes, setDeliveryNotes] = useState(order?.delivery_notes || "")

    const deliverOrderMutation = useMutation({
        mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof api.deliverOrder>[1] }) =>
            api.deliverOrder(orderId, payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
        },
    })

    async function submitDelivery() {
        if (!order) return
        if (!deliverRecipientName || !deliverRecipientDni) {
            toast.error("Nombre y DNI son obligatorios")
            return
        }
        try {
            await deliverOrderMutation.mutateAsync({
                orderId: order.id,
                payload: {
                    recipient_name: deliverRecipientName,
                    recipient_dni: deliverRecipientDni,
                    ...(deliveryNotes ? { delivery_notes: deliveryNotes } : {}),
                },
            })
            toast.success("Entrega confirmada")
            onOpenChange(false)
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Confirmar entrega</DialogTitle>
                    <DialogDescription>Registra quien recibio el pedido y observaciones.</DialogDescription>
                </DialogHeader>
                <form
                    className="space-y-4"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void submitDelivery()
                    }}
                >
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Nombre receptor</Label>
                            <Input
                                placeholder="Nombre completo"
                                value={deliverRecipientName}
                                onChange={(event) => setDeliverRecipientName(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>DNI receptor</Label>
                            <Input
                                placeholder="Solo numeros"
                                value={deliverRecipientDni}
                                onChange={(event) => setDeliverRecipientDni(event.target.value)}
                            />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Notas de entrega (opcional)</Label>
                            <Input
                                placeholder="Observaciones"
                                value={deliveryNotes}
                                onChange={(event) => setDeliveryNotes(event.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={deliverOrderMutation.isPending}>
                            {deliverOrderMutation.isPending ? "Guardando..." : "Confirmar"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
