import { AlertTriangle, Box, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OrderItem } from "@/types";
import { itemIsComplete, itemIsPartial, itemRemainingQuantity } from "@/lib/pickingUtils";

interface PickingItemsGridProps {
    items: OrderItem[];
    canPick: boolean;
    pendingScanItemId: string | null;
    onSelectItem: (item: OrderItem) => void;
}

export function PickingItemsGrid({
    items,
    canPick,
    pendingScanItemId,
    onSelectItem,
}: PickingItemsGridProps) {
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => {
                const remaining = itemRemainingQuantity(item);
                const complete = itemIsComplete(item);
                const warning = itemIsPartial(item) || (!canPick && remaining > 0);
                const isActive = pendingScanItemId === item.id;

                return (
                    <Card
                        key={`${item.id}-${index}`}
                        onClick={() => !complete && canPick && onSelectItem(item)}
                        className={cn(
                            "transition duration-200 cursor-pointer",
                            isActive
                                ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-950/20"
                                : complete
                                    ? "border-emerald-500/40 bg-emerald-500/10 dark:border-emerald-500/50 dark:bg-emerald-500/10 hover:bg-emerald-500/5 cursor-default"
                                    : warning
                                        ? "border-amber-500/40 bg-amber-500/10 dark:border-amber-400/50 dark:bg-amber-500/10 hover:border-amber-500"
                                        : "border-border bg-card text-card-foreground hover:border-blue-500 dark:hover:border-blue-400",
                        )}
                    >
                        <CardContent className="space-y-3 p-4">
                            <div className="flex items-center justify-between">
                                <Badge variant="outline">{item.location || "Sin ubicacion"}</Badge>
                                <span className="font-mono text-xs text-muted-foreground">{item.sku}</span>
                            </div>
                            <h3
                                className={cn(
                                    "font-semibold",
                                    complete
                                        ? "text-emerald-700 line-through dark:text-emerald-300"
                                        : warning
                                            ? "text-amber-700 dark:text-amber-300"
                                            : "text-foreground",
                                )}
                            >
                                {item.product_name}
                            </h3>
                            <div className="flex items-center justify-between text-sm text-foreground">
                                <span>
                                    Cantidad: <strong>{item.quantity}</strong>
                                </span>
                                <span>
                                    Recolectado: <strong>{item.picked_quantity || 0}</strong>
                                </span>
                            </div>
                            <div className={cn("text-xs font-medium", remaining > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
                                {remaining > 0 ? `Faltante: ${remaining}` : "Item completo"}
                            </div>
                            <div className="flex justify-end">
                                <div
                                    className={cn(
                                        "flex h-8 w-8 items-center justify-center rounded-full",
                                        complete
                                            ? "bg-emerald-600 text-white"
                                            : warning
                                                ? "bg-amber-500 text-slate-950"
                                                : "bg-muted text-muted-foreground",
                                    )}
                                >
                                    {complete ? <Check className="h-4 w-4" /> : warning ? <AlertTriangle className="h-4 w-4" /> : <Box className="h-4 w-4" />}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
