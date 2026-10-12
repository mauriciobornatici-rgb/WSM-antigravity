import { Printer, Tag, MapPin, Layers } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/formatters";
import { grossPrice } from "@/lib/pricing";
import type { ReceptionRecord } from "./types";
import { PrintPortal } from "@/components/common/PrintPortal";

interface PrintableBarcodeLabelsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    reception: ReceptionRecord | null;
}

function LabelsItemsList({ items }: { items: ReceptionRecord["items"] }) {
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) {
        return (
            <div className="p-8 text-center text-muted-foreground bg-muted/20 rounded-lg">
                <Tag className="h-10 w-10 mx-auto mb-2 opacity-40" aria-hidden="true" />
                <p>No hay Ã­tems detallados en esta recepciÃ³n para etiquetar.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 print:grid-cols-3 print:gap-2">
            {list.map((item, idx) => {
                const name = String(item.product_name || item.name || "Producto Deportivo");
                const sku = String(item.sku || "SKU-GEN-001");
                const barcode = String(item.barcode || item.ean || sku);
                const size = item.size ? String(item.size) : null;
                const color = item.color ? String(item.color) : null;
                const category = item.category ? String(item.category) : null;
                const location = String(item.location || item.warehouse_location || "DepÃ³sito Central / Rack A-1");
                // Stored prices are net; the label shows the final (VAT-included) price (ADR-015).
                // Never falls back to unit_price/cost: without a sale price the label prints no price.
                const salePrice = Number(item.sale_price || 0);
                const price = salePrice > 0 ? grossPrice(salePrice, item.vat_rate as number | string | null | undefined) : null;
                const qty = Number(item.quantity_received || item.quantity || 1);

                const detailParts = [
                    size ? `Talle: ${size}` : null,
                    color ? `Color: ${color}` : null,
                    category ? category : null,
                ].filter(Boolean);
                const detailText = detailParts.length > 0 ? detailParts.join(" | ") : "EstÃ¡ndar / Unisex";

                return (
                    <div
                        key={idx}
                        className="border-2 border-slate-300 dark:border-slate-700 p-3 rounded-lg bg-card text-foreground flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow print:border-black print:rounded-none print:shadow-none print:break-inside-avoid"
                    >
                        {/* Header: Producto y Cantidad */}
                        <div>
                            <div className="flex justify-between items-start border-b border-border pb-1 mb-1.5 gap-1">
                                <span className="font-extrabold text-sm uppercase tracking-tight line-clamp-1 text-slate-900 dark:text-slate-100">
                                    {name}
                                </span>
                                <span className="text-[10px] font-mono font-bold bg-muted px-1.5 py-0.5 rounded border border-border shrink-0">
                                    x{qty}
                                </span>
                            </div>

                            {/* Detalle (Talle, Color, CategorÃ­a) */}
                            <div className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                                <Layers className="h-3 w-3 text-blue-500 shrink-0" />
                                <span className="truncate">{detailText}</span>
                            </div>

                            {/* UbicaciÃ³n en DepÃ³sito */}
                            <div className="text-[11px] font-bold text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1 bg-amber-50 dark:bg-amber-950/30 px-1.5 py-0.5 rounded border border-amber-200 dark:border-amber-900/50">
                                <MapPin className="h-3 w-3 shrink-0" />
                                <span className="truncate">Ubic: {location}</span>
                            </div>
                        </div>

                        {/* Barcode & SKU Box */}
                        <div className="my-2 text-center bg-white p-2 rounded border border-slate-200 shadow-inner">
                            {/* Barcode Visualization */}
                            <div className="h-9 flex items-center justify-center gap-[2px]">
                                {barcode.split("").map((_char, cIdx) => (
                                    <div
                                        key={cIdx}
                                        className="bg-black h-full"
                                        style={{
                                            width: (cIdx % 3 === 0 ? "3px" : cIdx % 2 === 0 ? "2px" : "1px"),
                                            marginRight: cIdx % 4 === 0 ? "1px" : "0px",
                                        }}
                                    />
                                ))}
                            </div>
                            <div className="flex justify-between items-center text-[10px] font-mono font-bold text-slate-900 mt-1 px-1 border-t border-slate-100 pt-0.5">
                                <span>SKU: {sku}</span>
                                <span className="tracking-[1px]">{barcode}</span>
                            </div>
                        </div>

                        {/* Footer: Marca y Precio */}
                        <div className="flex justify-between items-center pt-1 border-t border-border">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">WSM Sports</span>
                            <span className="font-mono font-black text-sm text-primary">
                                {price !== null ? formatMoney(price) : ""}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function PrintableBarcodeLabelsDialog({
    open,
    onOpenChange,
    reception,
}: PrintableBarcodeLabelsDialogProps) {
    if (!reception) return null;

    const items = Array.isArray(reception.items) ? reception.items : [];

    const handlePrint = () => {
        window.print();
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-4xl p-6 print:hidden">
                <DialogHeader className="border-b border-border pb-4">
                    <div className="flex items-center gap-2 text-primary font-bold text-lg">
                        <Tag className="h-5 w-5" />
                        <span>ROTULADO INDUSTRIAL â€” ETIQUETAS WMS</span>
                    </div>
                    <DialogTitle className="text-xl font-black mt-1">
                        {reception.reception_number} â€” {reception.supplier_name}
                    </DialogTitle>
                    <DialogDescription>
                        Vista previa e impresiÃ³n de etiquetas con Producto, Detalle, UbicaciÃ³n de DepÃ³sito, CÃ³digo de Barras y SKU.
                    </DialogDescription>
                </DialogHeader>

                {/* Screen Preview Container */}
                <div className="py-4 space-y-4">
                    <LabelsItemsList items={items} />
                </div>

                <DialogFooter className="border-t border-border pt-4 flex flex-row justify-between sm:justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cerrar
                    </Button>
                    <Button onClick={handlePrint} disabled={items.length === 0} className="gap-2">
                        <Printer className="h-4 w-4" />
                        Imprimir Lote de Etiquetas
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {open && items.length > 0 && (
            <PrintPortal>
                <div id="printable-labels" className="hidden print:block py-4 space-y-4 max-w-[210mm] mx-auto">
                    <LabelsItemsList items={items} />
                </div>
            </PrintPortal>
        )}
        </>
    );
}
