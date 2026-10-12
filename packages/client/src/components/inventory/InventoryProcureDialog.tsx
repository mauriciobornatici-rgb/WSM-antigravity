import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/formatters";
import { grossLineTotal, grossPrice } from "@/lib/pricing";
import type { ProductWithStock } from "@/lib/inventorySnapshot";
import type { Supplier } from "@/types";

interface InventoryProcureDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedReplenishItems: Record<string, { quantity: number; supplierId: string }>;
    products: ProductWithStock[];
    suppliers: Supplier[];
    isProcuring: boolean;
    onSubmitProcure: () => void;
}

export function InventoryProcureDialog({
    open,
    onOpenChange,
    selectedReplenishItems,
    products,
    suppliers,
    isProcuring,
    onSubmitProcure,
}: InventoryProcureDialogProps) {
    const selectedItemsArray = Object.entries(selectedReplenishItems).map(([id, value]) => ({ id, ...value }));
    const itemsBySupplier: Record<string, typeof selectedItemsArray> = {};
    for (const item of selectedItemsArray) {
        if (!itemsBySupplier[item.supplierId]) {
            itemsBySupplier[item.supplierId] = [];
        }
        itemsBySupplier[item.supplierId]!.push(item);
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Revisar órdenes de reposición a generar</DialogTitle>
                    <DialogDescription>
                        Se generarán órdenes de compra (PO) en estado Borrador agrupadas automáticamente por proveedor.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-2 space-y-4">
                    <div className="max-h-[300px] overflow-y-auto space-y-4 pr-1">
                        {Object.entries(itemsBySupplier).map(([supplierId, supplierItems]) => {
                            const supplier = suppliers.find((s) => s.id === supplierId);
                            const poTotal = supplierItems.reduce((acc, item) => {
                                const prod = products.find((p) => p.id === item.id);
                                return acc + grossLineTotal(item.quantity, prod?.purchase_price, prod?.vat_rate);
                            }, 0);

                            return (
                                <div key={supplierId} className="border-b border-border pb-3 last:border-0 last:pb-0">
                                    <strong className="block text-sm text-primary mb-1">{supplier?.name || supplierId}</strong>
                                    <div className="pl-2 space-y-1 text-xs">
                                        {supplierItems.map((item) => {
                                            const prod = products.find((p) => p.id === item.id);
                                            return (
                                                <div key={item.id} className="flex justify-between text-muted-foreground">
                                                    <span>
                                                        {prod?.sku} - {prod?.name}
                                                    </span>
                                                    <span className="font-mono">
                                                        Cant: {item.quantity} x {formatMoney(grossPrice(prod?.purchase_price, prod?.vat_rate))}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                        <div className="text-right font-bold text-foreground mt-1 border-t border-border/50 pt-1 border-dashed font-mono">
                                            Subtotal PO (IVA incl.):{formatMoney(poTotal)}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <DialogFooter className="flex flex-col-reverse gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button onClick={onSubmitProcure} disabled={isProcuring}>
                        {isProcuring ? "Creando Órdenes..." : "Confirmar Órdenes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
