import { Package, ShieldAlert, DollarSign, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/formatters";
import { grossPrice } from "@/lib/pricing";
import type { ProductWithStock } from "@/lib/inventorySnapshot";

interface InventorySummaryCardsProps {
    products: ProductWithStock[];
}

export function InventorySummaryCards({ products }: InventorySummaryCardsProps) {
    const totalUnits = products.reduce((sum, p) => sum + Number(p.stock_current ?? p.stock_available ?? 0), 0);
    const criticalCount = products.filter((p) => Number(p.stock_current ?? 0) <= Number(p.stock_min ?? 0)).length;
    const totalValuation = products.reduce((sum, p) => {
        const qty = Number(p.stock_current ?? p.stock_available ?? 0);
        // Final cost (VAT included, ADR-015); without a cost the product is valued at 0, never at its sale price.
        const cost = grossPrice(p.purchase_price, p.vat_rate);
        return sum + qty * cost;
    }, 0);
    const netValuation = products.reduce((sum, p) => {
        const qty = Number(p.stock_current ?? p.stock_available ?? 0);
        return sum + qty * Number(p.purchase_price || 0);
    }, 0);
    const withoutCostCount = products.filter((p) => {
        const qty = Number(p.stock_current ?? p.stock_available ?? 0);
        return qty > 0 && !(Number(p.purchase_price) > 0);
    }).length;
    const categoriesCount = new Set(products.map((p) => p.category).filter(Boolean)).size;

    return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Unidades</p>
                        <p className="text-2xl font-black text-foreground mt-0.5">{totalUnits.toLocaleString("es-AR")}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{products.length} productos activos</p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                        <Package className="h-5 w-5" />
                    </div>
                </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stock Crítico</p>
                        <p className={`text-2xl font-black mt-0.5 ${criticalCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                            {criticalCount}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            {criticalCount > 0 ? "Requieren reposición" : "Niveles saludables"}
                        </p>
                    </div>
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${criticalCount > 0 ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"}`}>
                        <ShieldAlert className="h-5 w-5" />
                    </div>
                </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Valorización Stock</p>
                        <p className="text-xl font-black text-foreground mt-0.5 font-mono">{formatMoney(totalValuation)}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Costo estimado total (IVA incl.)</p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">Neto: {formatMoney(netValuation)}</p>
                        {withoutCostCount > 0 ? (
                            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mt-0.5">
                                {withoutCostCount} {withoutCostCount === 1 ? "producto sin costo cargado" : "productos sin costo cargado"}
                            </p>
                        ) : null}
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <DollarSign className="h-5 w-5" />
                    </div>
                </CardContent>
            </Card>

            <Card className="border-border shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categorías</p>
                        <p className="text-2xl font-black text-foreground mt-0.5">{categoriesCount}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Familias de artículos</p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                        <Layers className="h-5 w-5" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
