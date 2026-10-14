import type { NewClientForm } from "@/components/pos/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NO_TAX_CONDITION, TAX_CONDITION_OPTIONS } from "@/lib/taxConditions";

type QuickClientDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    newClient: NewClientForm;
    onNewClientChange: (patch: Partial<NewClientForm>) => void;
    creatingClient: boolean;
    onCreateClient: () => void;
};

export function QuickClientDialog({
    open,
    onOpenChange,
    newClient,
    onNewClientChange,
    creatingClient,
    onCreateClient,
}: QuickClientDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Crear cliente rápido</DialogTitle>
                    <DialogDescription>Alta mínima para operar en el POS.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <Input
                        aria-label="Nombre"
                        placeholder="Nombre"
                        value={newClient.name}
                        onChange={(event) => onNewClientChange({ name: event.target.value })}
                    />
                    <Input
                        aria-label="CUIT o DNI"
                        placeholder="CUIT / DNI"
                        value={newClient.tax_id}
                        onChange={(event) => onNewClientChange({ tax_id: event.target.value })}
                    />
                    <div className="space-y-1">
                        <Label htmlFor="quick-client-tax-condition">Condición frente al IVA</Label>
                        <Select
                            value={newClient.tax_condition_id}
                            onValueChange={(value) => onNewClientChange({ tax_condition_id: value })}
                        >
                            <SelectTrigger id="quick-client-tax-condition">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={NO_TAX_CONDITION}>Sin especificar</SelectItem>
                                {TAX_CONDITION_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Input
                        aria-label="Correo electrónico"
                        placeholder="Correo electrónico"
                        value={newClient.email}
                        onChange={(event) => onNewClientChange({ email: event.target.value })}
                    />
                    <Input
                        aria-label="Teléfono"
                        placeholder="Teléfono"
                        value={newClient.phone}
                        onChange={(event) => onNewClientChange({ phone: event.target.value })}
                    />
                    <Input
                        aria-label="Dirección"
                        placeholder="Dirección"
                        value={newClient.address}
                        onChange={(event) => onNewClientChange({ address: event.target.value })}
                    />
                    <Input
                        type="number"
                        aria-label="Límite de crédito"
                        placeholder="Límite de crédito"
                        value={newClient.credit_limit}
                        onChange={(event) => onNewClientChange({ credit_limit: Number(event.target.value) || 0 })}
                    />
                </div>
                <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={onCreateClient} disabled={creatingClient}>
                        {creatingClient ? "Guardando..." : "Crear cliente"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
