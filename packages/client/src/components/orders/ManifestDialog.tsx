import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import type { Order } from "@/types"

interface ManifestDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    orders: Order[]
    selectedOrderIds: string[]
    onGenerateManifest: (driver: string, plate: string, carrier: string, notes: string) => void
}

export function ManifestDialog({
    open,
    onOpenChange,
    orders,
    selectedOrderIds,
    onGenerateManifest,
}: ManifestDialogProps) {
    const [manifestDriver, setManifestDriver] = useState("")
    const [manifestPlate, setManifestPlate] = useState("")
    const [manifestCarrier, setManifestCarrier] = useState("Flete Propio")
    const [manifestNotes, setManifestNotes] = useState("")

    function handleSubmit(event: React.FormEvent) {
        event.preventDefault()
        onGenerateManifest(manifestDriver, manifestPlate, manifestCarrier, manifestNotes)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-xl no-print print:hidden">
                <DialogHeader>
                    <DialogTitle>Generar Hoja de Ruta de Reparto</DialogTitle>
                    <DialogDescription>
                        Asigna un chofer, vehículo y transportista para consolidar las entregas.
                    </DialogDescription>
                </DialogHeader>
                <form className="space-y-4" onSubmit={handleSubmit}>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Nombre del Chofer</Label>
                            <Input
                                value={manifestDriver}
                                onChange={(e) => setManifestDriver(e.target.value)}
                                placeholder="Nombre completo"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Patente del Vehículo</Label>
                            <Input
                                value={manifestPlate}
                                onChange={(e) => setManifestPlate(e.target.value)}
                                placeholder="Patente (Ej: AAA-000 o AA000AA)"
                                required
                            />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Empresa Logística / Transportista</Label>
                            <Input
                                value={manifestCarrier}
                                onChange={(e) => setManifestCarrier(e.target.value)}
                                placeholder="Ej: Andreani, Correo Argentino, Flete Propio"
                                required
                            />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                            <Label>Observaciones / Instrucciones de Ruta</Label>
                            <Textarea
                                value={manifestNotes}
                                onChange={(e) => setManifestNotes(e.target.value)}
                                placeholder="Instrucciones para el chofer, orden de visitas, etc."
                            />
                        </div>
                    </div>

                    <div className="rounded-md border p-3 bg-muted/20 text-xs space-y-1">
                        <strong className="block text-sm mb-1 text-slate-800 dark:text-slate-200">
                            Pedidos Consolidados:
                        </strong>
                        {orders
                            .filter((o) => selectedOrderIds.includes(o.id))
                            .map((o) => (
                                <div key={o.id} className="flex justify-between border-b pb-1 last:border-0">
                                    <span className="font-mono text-xs">{o.id.slice(0, 8).toUpperCase()}</span>
                                    <span className="truncate max-w-[200px] font-medium">
                                        {o.recipient_name || o.client_name || o.customer_name}
                                    </span>
                                    <span className="text-muted-foreground">{o.shipping_address ? "Envío" : "Sin dirección"}</span>
                                </div>
                            ))}
                    </div>

                    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit">Imprimir Hoja de Ruta</Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
