import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle } from "lucide-react";
import type { ReceptionRecord } from "./types";

export type QualityCheckItemInput = {
    productId: string;
    productName: string;
    sku: string;
    quantityReceived: number;
    quantityPassed: number;
    quantityFailed: number;
    defectDescription: string;
};

type QualityCheckDialogProps = {
    reception: ReceptionRecord | null;
    open: boolean;
    onClose: () => void;
    onSubmit: (items: QualityCheckItemInput[], notes: string) => Promise<void>;
    submitting: boolean;
};

export function QualityCheckDialog({
    reception,
    open,
    onClose,
    onSubmit,
    submitting,
}: QualityCheckDialogProps) {
    const [items, setItems] = useState<QualityCheckItemInput[]>(() => {
        if (!reception) return [];
        const rawItems = (reception.items || []) as Array<{
            product_id: string;
            product_name?: string;
            sku?: string;
            quantity_received: number;
        }>;
        return rawItems.map((item) => ({
            productId: item.product_id,
            productName: item.product_name || "Producto Desconocido",
            sku: item.sku || "-",
            quantityReceived: Number(item.quantity_received || 0),
            quantityPassed: Number(item.quantity_received || 0),
            quantityFailed: 0,
            defectDescription: "",
        }));
    });
    const [notes, setNotes] = useState("");

    // Live validation computed during render
    let validationError: string | null = null;
    for (const item of items) {
        const total = item.quantityPassed + item.quantityFailed;
        if (item.quantityPassed < 0 || item.quantityFailed < 0) {
            validationError = `Las cantidades de '${item.productName}' no pueden ser negativas.`;
            break;
        }
        if (total !== item.quantityReceived) {
            validationError = `La suma de aprobadas y defectuosas para '${item.productName}' (${total}) debe ser igual a la cantidad recibida (${item.quantityReceived}).`;
            break;
        }
    }

    const handleUpdateQty = (index: number, field: "quantityPassed" | "quantityFailed", valStr: string) => {
        const value = valStr === "" ? 0 : Math.max(0, parseInt(valStr, 10) || 0);
        setItems((prev) =>
            prev.map((item, idx) => {
                if (idx !== index) return item;
                const updated = { ...item, [field]: value };
                // Auto-calculate the other field to match total received, as a helper
                if (field === "quantityPassed") {
                    updated.quantityFailed = Math.max(0, item.quantityReceived - value);
                } else {
                    updated.quantityPassed = Math.max(0, item.quantityReceived - value);
                }
                return updated;
            })
        );
    };

    const handleUpdateDefect = (index: number, val: string) => {
        setItems((prev) =>
            prev.map((item, idx) => (idx === index ? { ...item, defectDescription: val } : item))
        );
    };

    const handleConfirm = async () => {
        if (validationError) return;
        await onSubmit(items, notes);
    };

    if (!reception) return null;

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-2xl bg-white text-slate-900 border border-slate-200">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold">Control de Calidad y Aprobación</DialogTitle>
                    <DialogDescription className="text-slate-600">
                        Inspección del remito <span className="font-semibold text-slate-800">{reception.reception_number}</span> de {reception.supplier_name}.
                        Verifica e ingresa las cantidades aprobadas y defectuosas por cada producto.
                    </DialogDescription>
                </DialogHeader>

                <div className="my-4 space-y-4 max-h-[380px] overflow-y-auto pr-1">
                    {items.map((item, index) => (
                        <div key={item.productId} className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50/50">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                    <h4 className="font-semibold text-slate-900 text-sm">{item.productName}</h4>
                                    <p className="text-xs text-slate-500">SKU: {item.sku} | Recibido: <span className="font-semibold">{item.quantityReceived}</span> unid.</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="space-y-1">
                                        <Label className="text-xs text-slate-600">Aprobadas</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            max={item.quantityReceived}
                                            value={item.quantityPassed}
                                            onChange={(e) => handleUpdateQty(index, "quantityPassed", e.target.value)}
                                            className="w-20 text-center h-8 bg-white border-slate-300"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs text-slate-600">Defectuosas</Label>
                                        <Input
                                            type="number"
                                            min={0}
                                            max={item.quantityReceived}
                                            value={item.quantityFailed}
                                            onChange={(e) => handleUpdateQty(index, "quantityFailed", e.target.value)}
                                            className="w-20 text-center h-8 bg-white border-slate-300 text-red-600 font-semibold"
                                        />
                                    </div>
                                </div>
                            </div>

                            {item.quantityFailed > 0 && (
                                <div className="space-y-1 animate-in fade-in duration-200">
                                    <Label className="text-xs text-red-700 font-medium">Detalle del defecto</Label>
                                    <Input
                                        placeholder="Ej: Costura descosida, suela despegada, talle incorrecto..."
                                        value={item.defectDescription}
                                        onChange={(e) => handleUpdateDefect(index, e.target.value)}
                                        className="h-8 bg-white border-red-300 focus-visible:ring-red-400"
                                    />
                                </div>
                            )}
                        </div>
                    ))}

                    <div className="space-y-2">
                        <Label htmlFor="qc-notes" className="text-sm font-semibold">Observaciones Generales</Label>
                        <Textarea
                            id="qc-notes"
                            placeholder="Notas generales de la inspección del lote..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="bg-white border-slate-300 min-h-[60px]"
                        />
                    </div>
                </div>

                {validationError && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 border border-amber-200">
                        <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                        <span>{validationError}</span>
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={onClose} disabled={submitting} className="border-slate-300">
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={!!validationError || submitting}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
                    >
                        {submitting ? "Procesando..." : "Aprobar y Registrar QC"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
