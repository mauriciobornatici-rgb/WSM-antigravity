import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NONE = "none";

type ReceptionOption = Awaited<ReturnType<typeof api.getReceptions>>[number];

interface ReceptionPickerProps {
    id: string;
    supplierId: string;
    value: string;
    onChange: (receptionId: string) => void;
}

/**
 * The delivery note a supplier return is made against (ADR-027, D7). While the supplier has not
 * invoiced it, the return lowers what is owed for it; goods never invoiced need it.
 */
export function ReceptionPicker({ id, supplierId, value, onChange }: ReceptionPickerProps) {
    // The list loaded for a supplier; another supplier shows none until its own arrives.
    const [loaded, setLoaded] = useState<{ supplierId: string; rows: ReceptionOption[] }>({ supplierId: "", rows: [] });
    const receptions = supplierId && loaded.supplierId === supplierId ? loaded.rows : [];

    useEffect(() => {
        if (!supplierId) return;
        let active = true;
        api.getReceptions({ supplier_id: supplierId, status: "approved" })
            .then((rows) => { if (active) setLoaded({ supplierId, rows }); })
            .catch(() => { if (active) setLoaded({ supplierId, rows: [] }); });
        return () => { active = false; };
    }, [supplierId]);

    const selected = receptions.find((reception) => reception.id === value);

    return (
        <div className="space-y-2">
            <Label htmlFor={id}>Remito con el que llegó</Label>
            <Select value={value || NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)} disabled={!supplierId}>
                <SelectTrigger id={id} aria-describedby={`${id}-hint`}>
                    <SelectValue placeholder={supplierId ? "Elegí el remito" : "Elegí primero el proveedor"} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={NONE}>Sin remito (el proveedor ya la facturó)</SelectItem>
                    {receptions.map((reception) => (
                        <SelectItem key={reception.id} value={reception.id}>
                            Remito {reception.remito_number || reception.reception_number}
                            {reception.supplier_invoice_id ? " · facturado" : " · sin facturar"}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p id={`${id}-hint`} className="text-xs text-muted-foreground" aria-live="polite">
                {selected && !selected.supplier_invoice_id
                    ? "El proveedor todavía no lo facturó: la devolución descuenta lo que se le debe por ese remito y la factura cobra solo lo que quedó."
                    : "Si el proveedor todavía no facturó la mercadería, elegí su remito."}
            </p>
        </div>
    );
}
