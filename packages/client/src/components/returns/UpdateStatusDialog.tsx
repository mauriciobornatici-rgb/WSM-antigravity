import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
import { toast } from "sonner"

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
        try {
            setLoading(true)
            await api.updateWarrantyStatus(warranty.id, { status, notes })
            toast.success("Estado actualizado")
            setOpen(false)
            onSuccess()
        } catch (error) {
            showErrorToast("No se pudo actualizar el estado", error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm">Actualizar estado</Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Actualizar Estado - {warranty.id}</DialogTitle>
                    <DialogDescription>
                        Seleccione el nuevo estado y agregue una nota obligatoria.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="status" className="text-left sm:text-right">
                            Estado
                        </Label>
                        <Select
                            value={status}
                            onValueChange={(value) => {
                                setStatus(value as Parameters<typeof api.updateWarrantyStatus>[1]["status"])
                            }}
                        >
                            <SelectTrigger className="sm:col-span-3">
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
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="notes" className="text-left sm:text-right">
                            Notas
                        </Label>
                        <Textarea
                            id="notes"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="sm:col-span-3"
                            placeholder="Ingrese detalles del cambio..."
                        />
                    </div>
                </div>
                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button type="submit" onClick={handleUpdate} disabled={loading || !notes}>
                        {loading ? "Guardando..." : "Guardar cambios"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

