import { Move } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProductWithStock } from "@/lib/inventorySnapshot";
import type { InventoryItem, WarehouseLocation } from "@/types";

interface InventoryTransferDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    products: ProductWithStock[];
    inventoryItems: InventoryItem[];
    warehouseLocations: WarehouseLocation[];
    selectedProductId: string;
    onSelectProduct: (productId: string) => void;
    fromLocation: string;
    onFromLocationChange: (loc: string) => void;
    toLocation: string;
    onToLocationChange: (loc: string) => void;
    transferQty: number;
    onTransferQtyChange: (qty: number) => void;
    isTransferring: boolean;
    onSubmitTransfer: () => void;
}

export function InventoryTransferDialog({
    open,
    onOpenChange,
    products,
    inventoryItems,
    warehouseLocations,
    selectedProductId,
    onSelectProduct,
    fromLocation,
    onFromLocationChange,
    toLocation,
    onToLocationChange,
    transferQty,
    onTransferQtyChange,
    isTransferring,
    onSubmitTransfer,
}: InventoryTransferDialogProps) {
    const transferSourceLocations = inventoryItems.filter(
        (item) => item.product_id === selectedProductId && item.quantity > 0
    );

    const activeLocations = Array.from(new Set([
        ...warehouseLocations.filter((location) => location.active).map((location) => location.code),
        ...inventoryItems.map((item) => item.location).filter(Boolean),
    ]));

    const selectedSourceLoc = transferSourceLocations.find((loc) => loc.location === fromLocation);
    const maxTransferQty = selectedSourceLoc
        ? Math.max(0, selectedSourceLoc.quantity - (selectedSourceLoc.reserved_quantity || 0))
        : 0;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-indigo-600">
                        <Move className="h-5 w-5" />
                        Traslado Interno de Stock (WMS)
                    </DialogTitle>
                    <DialogDescription>
                        Reubica stock de un producto entre ubicaciones/estanterías físicas del depósito de forma segura.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Product Selector */}
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="transfer-product" className="text-[10px] uppercase font-bold text-muted-foreground">Seleccionar Producto</label>
                        <Select
                            value={selectedProductId}
                            onValueChange={(val) => {
                                onSelectProduct(val);
                                onFromLocationChange("");
                                onTransferQtyChange(1);
                            }}
                        >
                            <SelectTrigger id="transfer-product">
                                <SelectValue placeholder="Selecciona un producto..." />
                            </SelectTrigger>
                            <SelectContent>
                                {products.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                        {p.sku} - {p.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {selectedProductId && (
                        <>
                            {/* From Location Selector */}
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="transfer-from-location" className="text-[10px] uppercase font-bold text-muted-foreground">Ubicación Origen</label>
                                <Select value={fromLocation} onValueChange={onFromLocationChange}>
                                    <SelectTrigger id="transfer-from-location">
                                        <SelectValue placeholder="Selecciona estante origen..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {transferSourceLocations.map((src) => {
                                            const avail = src.quantity - (src.reserved_quantity || 0);
                                            return (
                                                <SelectItem key={src.location} value={src.location}>
                                                    {src.location} (Disponible: {avail} u | Físico: {src.quantity} u)
                                                </SelectItem>
                                            );
                                        })}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Target Location Selector */}
                            <div className="flex flex-col gap-1.5">
                                <label htmlFor="transfer-to-location" className="text-[10px] uppercase font-bold text-muted-foreground">Ubicación Destino</label>
                                <Select value={toLocation} onValueChange={onToLocationChange}>
                                    <SelectTrigger id="transfer-to-location">
                                        <SelectValue placeholder="Selecciona una ubicación creada..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {activeLocations.filter((loc) => loc !== fromLocation).map((loc) => (
                                            <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">Las ubicaciones se crean y editan en la pestaña Góndolas &amp; Almacén.</p>
                            </div>

                            {/* Transfer Quantity */}
                            <div className="flex flex-col gap-1.5">
                                <div className="flex justify-between items-center">
                                    <label htmlFor="transfer-qty" className="text-[10px] uppercase font-bold text-muted-foreground">Cantidad a Trasladar</label>
                                    {fromLocation && (
                                        <span className="text-[10px] text-muted-foreground font-semibold">
                                            Máximo disponible: {maxTransferQty} u
                                        </span>
                                    )}
                                </div>
                                <Input
                                    id="transfer-qty"
                                    type="number"
                                    min={1}
                                    max={maxTransferQty || 1}
                                    value={transferQty || ""}
                                    onChange={(e) => onTransferQtyChange(Math.min(maxTransferQty, Math.max(1, Number(e.target.value))))}
                                />
                            </div>
                        </>
                    )}
                </div>

                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t pt-3">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button
                        onClick={onSubmitTransfer}
                        disabled={!selectedProductId || !fromLocation || !toLocation || transferQty < 1 || isTransferring}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                        {isTransferring ? "Trasladando..." : "Confirmar Traslado"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
