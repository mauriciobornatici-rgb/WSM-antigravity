import { RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/formatters";
import { grossLineTotal } from "@/lib/pricing";
import type { ProductWithStock } from "@/lib/inventorySnapshot";
import type { Supplier } from "@/types";

interface InventoryReplenishmentTabProps {
    criticalProducts: ProductWithStock[];
    suppliers: Supplier[];
    selectedReplenishItems: Record<string, { quantity: number; supplierId: string }>;
    onToggleItem: (productId: string, suggestedQty: number, supplierId?: string) => void;
    onUpdateQty: (productId: string, quantity: number) => void;
    onUpdateSupplier: (productId: string, supplierId: string) => void;
    onOpenProcureDialog: () => void;
}

export function InventoryReplenishmentTab({
    criticalProducts,
    suppliers,
    selectedReplenishItems,
    onToggleItem,
    onUpdateQty,
    onUpdateSupplier,
    onOpenProcureDialog,
}: InventoryReplenishmentTabProps) {
    const selectedCount = Object.keys(selectedReplenishItems).length;

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle className="text-amber-500 flex items-center gap-2">
                            <ShieldAlert className="h-5 w-5" /> Alertas Críticas & Reposición
                        </CardTitle>
                        <CardDescription>
                            Productos con existencias por debajo del límite mínimo. Selecciona proveedor y cantidades para reabastecer de inmediato.
                        </CardDescription>
                    </div>
                    {selectedCount > 0 && (
                        <Button className="w-full gap-2 sm:w-auto" onClick={onOpenProcureDialog}>
                            <RefreshCw className="h-4 w-4 animate-spin-slow" />
                            Generar Órdenes ({selectedCount})
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {criticalProducts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
                        <p className="text-emerald-600 dark:text-emerald-400 font-semibold text-lg">
                            ¡Excelente! Todos los productos están con stock óptimo.
                        </p>
                        <p className="text-muted-foreground text-sm mt-1">
                            Ningún artículo de catálogo está por debajo del stock mínimo.
                        </p>
                    </div>
                ) : (
                    <div className="rounded-md border overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10"></TableHead>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Producto</TableHead>
                                    <TableHead className="text-center">Stock Actual</TableHead>
                                    <TableHead className="text-center">Stock Mínimo</TableHead>
                                    <TableHead className="w-40 text-center">Cantidad a Pedir</TableHead>
                                    <TableHead className="w-60">Proveedor Reposición</TableHead>
                                    <TableHead className="text-right">Costo Estimado (IVA incl.)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {criticalProducts.map((p) => {
                                    const checked = Boolean(selectedReplenishItems[p.id]);
                                    const suggested = Math.max(1, Number(p.stock_min || 0) * 2 - Number(p.stock_current || 0));
                                    const itemValue = selectedReplenishItems[p.id] || {
                                        quantity: suggested,
                                        supplierId: p.supplier_id || "",
                                    };
                                    const itemCost = grossLineTotal(itemValue.quantity, p.purchase_price, p.vat_rate);

                                    return (
                                        <TableRow key={p.id} className={checked ? "bg-muted/30" : ""}>
                                            <TableCell className="text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => onToggleItem(p.id, suggested, p.supplier_id || "")}
                                                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                                                />
                                            </TableCell>
                                            <TableCell className="font-mono text-xs font-bold">{p.sku}</TableCell>
                                            <TableCell className="font-semibold text-foreground">{p.name}</TableCell>
                                            <TableCell className="text-center font-bold text-red-500">{p.stock_current}</TableCell>
                                            <TableCell className="text-center text-muted-foreground">{p.stock_min}</TableCell>
                                            <TableCell className="text-center">
                                                <Input
                                                    type="number"
                                                    disabled={!checked}
                                                    value={itemValue.quantity}
                                                    onChange={(e) => onUpdateQty(p.id, Number(e.target.value))}
                                                    className="h-8 w-24 text-center font-bold text-foreground mx-auto"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Select
                                                    disabled={!checked}
                                                    value={itemValue.supplierId}
                                                    onValueChange={(val) => onUpdateSupplier(p.id, val)}
                                                >
                                                    <SelectTrigger className="h-8 text-xs">
                                                        <SelectValue placeholder="Proveedor..." />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {suppliers.map((s) => (
                                                            <SelectItem key={s.id} value={s.id} className="text-xs">
                                                                {s.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                            <TableCell className="text-right font-bold text-foreground font-mono">
                                                {formatMoney(itemCost)}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
