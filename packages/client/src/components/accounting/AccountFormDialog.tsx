import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface AccountFormDialogProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    form: { code: string; name: string; type: string; active: boolean; isEdit: boolean }
    onChange: (updated: { code: string; name: string; type: string; active: boolean; isEdit: boolean }) => void
    onSave: () => void
}

export function AccountFormDialog({ isOpen, onOpenChange, form, onChange, onSave }: AccountFormDialogProps) {
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{form.isEdit ? "Editar Cuenta Contable" : "Nueva Cuenta Contable"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Código</label>
                        <Input
                            placeholder="Ej: 1.1.01"
                            value={form.code}
                            onChange={(e) => onChange({ ...form, code: e.target.value })}
                            disabled={form.isEdit}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Nombre de la Cuenta</label>
                        <Input
                            placeholder="Ej: Caja General"
                            value={form.name}
                            onChange={(e) => onChange({ ...form, name: e.target.value })}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Tipo</label>
                        <Select
                            value={form.type}
                            onValueChange={(val) => onChange({ ...form, type: val })}
                            disabled={form.isEdit}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="asset">Activo</SelectItem>
                                <SelectItem value="liability">Pasivo</SelectItem>
                                <SelectItem value="equity">Patrimonio Neto</SelectItem>
                                <SelectItem value="revenue">Ingreso / Ganancia</SelectItem>
                                <SelectItem value="expense">Egreso / Pérdida</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2 pt-2">
                        <input
                            type="checkbox"
                            id="accountActive"
                            checked={form.active}
                            onChange={(e) => onChange({ ...form, active: e.target.checked })}
                            className="h-4 w-4"
                        />
                        <label htmlFor="accountActive" className="text-sm">
                            Cuenta Activa
                        </label>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button onClick={onSave}>Guardar Cuenta</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
