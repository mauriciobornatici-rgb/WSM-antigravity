import { Flame, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface SizeColorAnalyticsRow {
    category: string;
    size: string;
    units_sold: number;
}

interface SizeColorHeatmapCardProps {
    data: SizeColorAnalyticsRow[] | undefined;
    isLoading: boolean;
}

export function SizeColorHeatmapCard({ data, isLoading }: SizeColorHeatmapCardProps) {
    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base font-bold flex items-center gap-2">
                        <Flame className="h-5 w-5 text-amber-500" />
                        Matriz de Rotación por Talle (Heatmap WMS)
                    </CardTitle>
                </CardHeader>
                <CardContent className="h-44 flex items-center justify-center">
                    <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
                </CardContent>
            </Card>
        );
    }

    const items = data || [];
    const maxUnits = Math.max(...items.map((i) => Number(i.units_sold || 0)), 1);

    return (
        <Card className="border-border shadow-sm">
            <CardHeader className="pb-3 border-b border-border bg-muted/20">
                <div className="flex justify-between items-start">
                    <div>
                        <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                            <Flame className="h-5 w-5 text-amber-500 animate-pulse" />
                            Matriz de Rotación por Talle (Heatmap de Ventas)
                        </CardTitle>
                        <CardDescription className="text-xs mt-1">
                            Unidades vendidas agrupadas por talle y categoría para planificación de compras a proveedores.
                        </CardDescription>
                    </div>
                    <Badge variant="secondary" className="font-mono text-xs gap-1">
                        <Layers className="h-3 w-3" /> {items.length} variantes
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="pt-4">
                {items.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                        No hay suficientes datos de ventas por talle registrados.
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                        {items.slice(0, 12).map((row, idx) => {
                            const units = Number(row.units_sold || 0);
                            const intensityRatio = Math.min(units / maxUnits, 1);
                            
                            let bgClass = "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
                            if (intensityRatio > 0.75) {
                                bgClass = "bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40 font-black";
                            } else if (intensityRatio > 0.4) {
                                bgClass = "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
                            }

                            return (
                                <div
                                    key={idx}
                                    className={`p-2.5 rounded-lg border text-center transition-all hover:scale-[1.02] ${bgClass}`}
                                >
                                    <span className="text-[10px] uppercase font-bold text-muted-foreground block truncate">
                                        {row.category || "General"}
                                    </span>
                                    <span className="text-lg font-black block font-mono my-0.5">
                                        Talle {row.size}
                                    </span>
                                    <span className="text-[11px] font-mono opacity-80 block">
                                        {units} u. vendidas
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
