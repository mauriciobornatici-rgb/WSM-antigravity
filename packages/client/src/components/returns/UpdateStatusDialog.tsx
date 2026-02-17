import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/services/api"

interface UpdateStatusDialogProps {
    warranty: {
        id: string
        status: Parameters<typeof api.updateWarrantyStatus>[1]["status"]
    }
    onSuccess: () => void
}

export function UpdateStatusDialog({ warranty, onSuccess }: UpdateStatusDialogProps) {
    const [open, setOpen] = useState(false)
    const [status, setStatus] = useState(warranty.status)
    const [notes, setNotes] = useState("")
    const [loading, setLoading] = useState(false)

    const handleUpdate = async () => {
        setLoading(true)
        await api.updateWarrantyStatus(warranty.id, { status, notes })
        setLoading(false)
        setOpen(false)
        onSuccess()
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>Actualizar Estado</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Actualizar Estado - {warranty.id}</DialogTitle>
                    <DialogDescription>
                        Seleccione el nuevo estado y agregue una nota obligatoria.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="status" className="text-right">
                            Estado
                        </Label>
                        <Select
                            value={status}
                            onValueChange={(value) => {
                                setStatus(value as Parameters<typeof api.updateWarrantyStatus>[1]["status"])
                            }}
                        >
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Seleccionar estado" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="sent_to_supplier">Enviado a Proveedor</SelectItem>
                                <SelectItem value="supplier_approved">Aprobado por Proveedor</SelectItem>
                                <SelectItem value="supplier_rejected">Rechazado por Proveedor</SelectItem>
                                <SelectItem value="resolved">Resuelto / Cerrado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="notes" className="text-right">
                            Notas
                        </Label>
                        <Textarea
                            id="notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="col-span-3"
                            placeholder="Ingrese detalles del cambio..."
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="submit" onClick={handleUpdate} disabled={loading || !notes}>
                        {loading ? "Guardando..." : "Guardar Cambios"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
