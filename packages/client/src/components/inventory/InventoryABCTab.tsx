import { useMemo, useState } from "react";
import { DollarSign, TrendingUp, Award, Layers, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/formatters";
import { grossLineTotal, grossPrice } from "@/lib/pricing";
import { analyzeInventoryABC, type ABCClass } from "@/lib/inventoryAnalytics";
import type { ProductWithStock } from "@/lib/inventorySnapshot";

interface InventoryABCTabProps {
    products: ProductWithStock[];
}

export function InventoryABCTab({ products }: InventoryABCTabProps) {
    const [selectedClass, setSelectedClass] = useState<"ALL" | ABCClass>("ALL");
    const [searchQuery, setSearchQuery] = useState("");

    const analysis = useMemo(() => {
        const input = products.map((p) => ({
            id: p.id,
            name: p.name,
            cost_price: Number(p.purchase_price || 0),
            sale_price: Number(p.sale_price || 0),
            stock_current: Number(p.stock_current ?? p.stock_available ?? 0),
            category: p.category,
            sku: p.sku,
        }));
        return analyzeInventoryABC(input);
    }, [products]);

    // Analytics run on net values (margins must not include VAT); unit prices and valuation are shown final.
    const vatById = useMemo(() => new Map(products.map((p) => [p.id, p.vat_rate])), [products]);

    const filteredItems = useMemo(() => {
        return analysis.items.filter((item) => {
            const matchesClass = selectedClass === "ALL" || item.abcClass === selectedClass;
            if (!matchesClass) return false;

            const q = searchQuery.toLowerCase().trim();
            if (!q) return true;
            return (
                item.name.toLowerCase().includes(q) ||
                Boolean(item.sku?.toLowerCase().includes(q)) ||
                (item.category && item.category.toLowerCase().includes(q))
            );
        });
    }, [analysis, selectedClass, searchQuery]);

    const { summary } = analysis;

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="border-border">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Margen Promedio</p>
                            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                                {summary.averageMarginPercent}%
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">Sobre el precio de venta</p>
                        </div>
                        <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                            <TrendingUp className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-border">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ganancia Potencial (neta)</p>
                            <p className="text-xl font-black text-foreground mt-0.5 font-mono">
                                {formatMoney(summary.potentialProfit)}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">Margen bruto en stock</p>
                        </div>
                        <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                            <DollarSign className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-border">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Clase A (Pareto 80%)</p>
                            <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-0.5 font-mono">
                                {summary.classACount} <span className="text-xs text-muted-foreground font-normal">artículos</span>
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">80% de la inversión en stock</p>
                        </div>
                        <div className="h-10 w-10 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                            <Award className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-border">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Clases B y C</p>
                            <p className="text-xl font-black text-foreground mt-0.5 font-mono">
                                {summary.classBCount} <span className="text-xs text-muted-foreground font-normal">en B /</span> {summary.classCCount} <span className="text-xs text-muted-foreground font-normal">en C</span>
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">20% restante de inversión</p>
                        </div>
                        <div className="h-10 w-10 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                            <Layers className="h-5 w-5" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Table Card */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <CardTitle className="text-lg">Clasificación ABC y Análisis de Rentabilidad</CardTitle>
                            <CardDescription>
                                Identifica los productos clave para maximizar rotación y margen financiero (Principio de Pareto).
                            </CardDescription>
                        </div>

                        {/* Filter Buttons */}
                        <div className="flex flex-wrap items-center gap-1.5 bg-muted/40 p-1 rounded-lg border">
                            <button
                                type="button"
                                aria-pressed={selectedClass === "ALL"}
                                onClick={() => setSelectedClass("ALL")}
                                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                                    selectedClass === "ALL" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Todos ({analysis.items.length})
                            </button>
                            <button
                                type="button"
                                aria-pressed={selectedClass === "A"}
                                onClick={() => setSelectedClass("A")}
                                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                                    selectedClass === "A" ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/30" : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Clase A ({summary.classACount})
                            </button>
                            <button
                                type="button"
                                aria-pressed={selectedClass === "B"}
                                onClick={() => setSelectedClass("B")}
                                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                                    selectedClass === "B" ? "bg-blue-500/20 text-blue-700 dark:text-blue-300 font-bold border border-blue-500/30" : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Clase B ({summary.classBCount})
                            </button>
                            <button
                                type="button"
                                aria-pressed={selectedClass === "C"}
                                onClick={() => setSelectedClass("C")}
                                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                                    selectedClass === "C" ? "bg-purple-500/20 text-purple-700 dark:text-purple-300 font-bold border border-purple-500/30" : "text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                Clase C ({summary.classCCount})
                            </button>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="space-y-4">
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1 max-w-sm">
                            <label htmlFor="inventory-abc-search" className="sr-only">Filtrar inventario por nombre, SKU o categoría</label>
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="inventory-abc-search"
                                placeholder="Filtrar por nombre, SKU o categoría..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 text-sm"
                            />
                        </div>
                    </div>

                    <div className="rounded-md border overflow-x-auto">
                        <table className="w-full text-sm">
                            <caption className="sr-only">Clasificación ABC y rentabilidad del inventario</caption>
                            <thead>
                                <tr className="border-b bg-muted/40 text-left text-xs font-semibold text-muted-foreground">
                                    <th scope="col" className="p-3">Clase</th>
                                    <th scope="col" className="p-3">Producto / SKU</th>
                                    <th scope="col" className="p-3">Categoría</th>
                                    <th scope="col" className="p-3 text-right">Costo Compra (IVA incl.)</th>
                                    <th scope="col" className="p-3 text-right">Precio Venta (IVA incl.)</th>
                                    <th scope="col" className="p-3 text-right">Margen Bruto $ (neto) y %</th>
                                    <th scope="col" className="p-3 text-right">Markup %</th>
                                    <th scope="col" className="p-3 text-right">Stock</th>
                                    <th scope="col" className="p-3 text-right">Valorización (costo c/IVA)</th>
                                    <th scope="col" className="p-3 text-right">% Acum.</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="p-6 text-center text-muted-foreground">
                                            No se encontraron productos en esta categoría o filtro.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredItems.map((item) => (
                                        <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
                                            <td className="p-3">
                                                {item.abcClass === "A" && (
                                                    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20 font-bold">
                                                        A (Top 80%)
                                                    </Badge>
                                                )}
                                                {item.abcClass === "B" && (
                                                    <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30 hover:bg-blue-500/20 font-bold">
                                                        B (Medio)
                                                    </Badge>
                                                )}
                                                {item.abcClass === "C" && (
                                                    <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 hover:bg-purple-500/20 font-bold">
                                                        C (Bajo)
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="p-3">
                                                <div className="font-semibold text-foreground">{item.name}</div>
                                                <div className="text-xs text-muted-foreground font-mono">
                                                    {item.sku || "Sin SKU"}
                                                </div>
                                            </td>
                                            <td className="p-3 text-muted-foreground text-xs">{item.category || "General"}</td>
                                            <td className="p-3 text-right font-mono text-xs">{formatMoney(grossPrice(item.numericCost, vatById.get(item.id)))}</td>
                                            <td className="p-3 text-right font-mono text-xs font-semibold">{formatMoney(grossPrice(item.numericPrice, vatById.get(item.id)))}</td>
                                            <td className="p-3 text-right font-mono text-xs">
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                                    {formatMoney(item.grossMarginAmount)}
                                                </span>{" "}
                                                <span className="text-[10px] text-muted-foreground">({item.grossMarginPercent}%)</span>
                                            </td>
                                            <td className="p-3 text-right font-mono text-xs font-medium">
                                                {item.markupPercent > 0 ? `+${item.markupPercent}%` : "0%"}
                                            </td>
                                            <td className="p-3 text-right font-mono text-xs">{item.numericStock} u.</td>
                                            <td className="p-3 text-right font-mono text-xs font-bold text-foreground">
                                                {formatMoney(grossLineTotal(item.numericStock, item.numericCost, vatById.get(item.id)))}
                                            </td>
                                            <td className="p-3 text-right font-mono text-[11px] text-muted-foreground">
                                                {item.cumulativeSharePercent}%
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-muted-foreground">Los importes de margen se calculan sin IVA.</p>
                </CardContent>
            </Card>
        </div>
    );
}
