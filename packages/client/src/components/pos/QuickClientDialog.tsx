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
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Crear cliente rapido</DialogTitle>
                    <DialogDescription>Alta minima para operar en POS.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
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
                        placeholder="Correo electronico"
                        value={newClient.email}
                        onChange={(event) => onNewClientChange({ email: event.target.value })}
                    />
                    <Input
                        placeholder="Telefono"
                        value={newClient.phone}
                        onChange={(event) => onNewClientChange({ phone: event.target.value })}
                    />
                    <Input
                        placeholder="Direccion"
                        value={newClient.address}
                        onChange={(event) => onNewClientChange({ address: event.target.value })}
                    />
                    <Input
                        type="number"
                        placeholder="Limite de credito"
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
