import type { NewClientForm } from "@/components/pos/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Crear cliente rápido</DialogTitle>
                    <DialogDescription>Alta mínima para operar en POS.</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                    <Input
                        placeholder="Nombre"
                        value={newClient.name}
                        onChange={(event) => onNewClientChange({ name: event.target.value })}
                    />
                    <Input
                        placeholder="CUIT / DNI"
                        value={newClient.tax_id}
                        onChange={(event) => onNewClientChange({ tax_id: event.target.value })}
                    />
                    <Input
                        placeholder="Email"
                        value={newClient.email}
                        onChange={(event) => onNewClientChange({ email: event.target.value })}
                    />
                    <Input
                        placeholder="Teléfono"
                        value={newClient.phone}
                        onChange={(event) => onNewClientChange({ phone: event.target.value })}
                    />
                    <Input
                        placeholder="Dirección"
                        value={newClient.address}
                        onChange={(event) => onNewClientChange({ address: event.target.value })}
                    />
                    <Input
                        type="number"
                        placeholder="Límite crédito"
                        value={newClient.credit_limit}
                        onChange={(event) => onNewClientChange({ credit_limit: Number(event.target.value) || 0 })}
                    />
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button onClick={onCreateClient} disabled={creatingClient}>
                        {creatingClient ? "Guardando..." : "Crear cliente"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
