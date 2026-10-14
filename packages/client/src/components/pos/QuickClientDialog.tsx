import { useState } from "react";
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
    // The field can be cleared while typing: the typed text is kept apart from the numeric value.
    const [limitText, setLimitText] = useState(String(newClient.credit_limit));
    const creditLimitText = Number(limitText || 0) === newClient.credit_limit ? limitText : String(newClient.credit_limit);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Crear cliente rápido</DialogTitle>
                    <DialogDescription>Alta mínima para operar en el POS.</DialogDescription>
                </DialogHeader>
                <form
                    className="space-y-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!creatingClient) onCreateClient();
                    }}
                >
                    <div className="space-y-1">
                        <Label htmlFor="quick-client-name">Nombre</Label>
                        <Input
                            id="quick-client-name"
                            value={newClient.name}
                            onChange={(event) => onNewClientChange({ name: event.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="quick-client-tax-id">CUIT / DNI</Label>
                        <Input
                            id="quick-client-tax-id"
                            inputMode="numeric"
                            value={newClient.tax_id}
                            onChange={(event) => onNewClientChange({ tax_id: event.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="quick-client-tax-condition">Condición IVA</Label>
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
                    <div className="space-y-1">
                        <Label htmlFor="quick-client-email">Correo electrónico</Label>
                        <Input
                            id="quick-client-email"
                            value={newClient.email}
                            onChange={(event) => onNewClientChange({ email: event.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="quick-client-phone">Teléfono</Label>
                        <Input
                            id="quick-client-phone"
                            value={newClient.phone}
                            onChange={(event) => onNewClientChange({ phone: event.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="quick-client-address">Dirección</Label>
                        <Input
                            id="quick-client-address"
                            value={newClient.address}
                            onChange={(event) => onNewClientChange({ address: event.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="quick-client-credit-limit">Límite de crédito</Label>
                        <Input
                            id="quick-client-credit-limit"
                            type="number"
                            value={creditLimitText}
                            onChange={(event) => {
                                setLimitText(event.target.value);
                                onNewClientChange({ credit_limit: Number(event.target.value) || 0 });
                            }}
                        />
                    </div>
                    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={creatingClient}>
                            {creatingClient ? "Guardando..." : "Crear cliente"}
                        </Button>
                    </div>
                </form>            </DialogContent>
        </Dialog>
    );
}
