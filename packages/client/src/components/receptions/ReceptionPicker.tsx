import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NO_RECEPTION } from "@/lib/receptionChoice";

type ReceptionOption = Awaited<ReturnType<typeof api.getReceptions>>[number];

interface ReceptionPickerProps {
    id: string;
    supplierId: string;
    // "" = nothing chosen yet; "none" = chosen explicitly: no delivery note (already invoiced).
    value: string;
    onChange: (receptionId: string) => void;
}

type Loaded = { supplierId: string; rows: ReceptionOption[]; failed: boolean };

/**
 * The delivery note a supplier return is made against (ADR-027, D7). While the supplier has not
 * invoiced it, the return lowers what is owed for it; goods never invoiced need it. "No delivery
 * note" is a choice of its own, never the default: it changes how the return is booked.
 */
export function ReceptionPicker({ id, supplierId, value, onChange }: ReceptionPickerProps) {
    const [loaded, setLoaded] = useState<Loaded>({ supplierId: "", rows: [], failed: false });
    const [attempt, setAttempt] = useState(0);
    const current = supplierId && loaded.supplierId === supplierId ? loaded : null;
    const loading = Boolean(supplierId) && !current;
    const receptions = current?.rows ?? [];

    useEffect(() => {
        if (!supplierId) return;
        let active = true;
        api.getReceptions({ supplier_id: supplierId, status: "approved" })
            .then((rows) => { if (active) setLoaded({ supplierId, rows, failed: false }); })
            .catch(() => { if (active) setLoaded({ supplierId, rows: [], failed: true }); });
        return () => { active = false; };
    }, [supplierId, attempt]);

    function retry() {
        setLoaded({ supplierId: "", rows: [], failed: false });
        setAttempt((count) => count + 1);
    }

    const selected = receptions.find((reception) => reception.id === value);
    // Invoiced by its own invoice, or by an invoice of its purchase order that did not name it.
    const invoiced = (reception: ReceptionOption) => Boolean(reception.supplier_invoice_id) || Number(reception.invoiced_by_order) === 1;
    const placeholder = !supplierId ? "Elegí primero el proveedor" : loading ? "Cargando remitos..." : "Elegí el remito";

    return (
        <div className="space-y-2">
            <Label htmlFor={id}>Remito con el que llegó *</Label>
            {/* "" shows the placeholder (Radix Select 2): nothing is chosen for the user. */}
            <Select value={value} onValueChange={onChange} disabled={!supplierId || loading}>
                <SelectTrigger id={id} aria-describedby={`${id}-hint`}>
                    <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent>
                    {receptions.map((reception) => (
                        <SelectItem key={reception.id} value={reception.id}>
                            Remito {reception.remito_number || reception.reception_number}
                            {reception.supplier_invoice_id
                                ? " · facturado"
                                : Number(reception.invoiced_by_order) === 1 ? " · facturado con la orden de compra" : " · sin facturar"}
                        </SelectItem>
                    ))}
                    <SelectItem value={NO_RECEPTION}>Sin remito: el proveedor ya facturó esta mercadería</SelectItem>
                </SelectContent>
            </Select>
            {current?.failed ? (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                    No se pudieron cargar los remitos.
                    <Button type="button" variant="outline" size="sm" onClick={retry}>Reintentar</Button>
                </div>
            ) : null}
            <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {selected && !invoiced(selected)
                    ? "El proveedor todavía no lo facturó: la devolución descuenta lo que se le debe por ese remito y la factura cobra solo lo que quedó."
                    : "Si el proveedor todavía no facturó la mercadería, elegí su remito."}
            </p>
        </div>
    );
}
