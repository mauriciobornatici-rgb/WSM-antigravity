import { AlertTriangle, Check, Compass, MapPin, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { OrderItem } from "@/types";
import {
    isGenericOrEmptyLocation,
    itemIsComplete,
    itemIsPartial,
    itemRemainingQuantity,
} from "@/lib/pickingUtils";

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
                const isGenericLoc = isGenericOrEmptyLocation(item.location);
                const pickedQty = Number(item.picked_quantity || 0);
                const totalQty = Number(item.quantity || 0);
                const progressPercent = totalQty > 0 ? Math.round((pickedQty / totalQty) * 100) : 0;

                return (
                    <Card
                        key={`${item.id}-${index}`}
                        onClick={() => !complete && canPick && onSelectItem(item)}
                        className={cn(
                            "transition-all duration-200 cursor-pointer flex flex-col justify-between shadow-sm",
                            isActive
                                ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/30 dark:border-blue-400 dark:bg-blue-950/20"
                                : complete
                                    ? "border-emerald-500/40 bg-emerald-500/5 dark:border-emerald-500/40 dark:bg-emerald-500/10 cursor-default"
                                    : warning
                                        ? "border-amber-500/40 bg-amber-500/5 dark:border-amber-400/40 dark:bg-amber-500/10 hover:border-amber-500"
                                        : "border-border bg-card hover:border-blue-500/60 hover:shadow dark:hover:border-blue-400",
                        )}
                    >
                        <CardContent className="space-y-3 p-4 flex flex-col justify-between h-full">
                            <div className="space-y-3">
                                {/* Top Line: Route sequence stop and warehouse location */}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <Badge
                                        variant="secondary"
                                        className="font-mono text-xs gap-1 font-semibold text-muted-foreground py-0.5"
                                    >
                                        <Compass className="h-3 w-3 text-blue-600" />
                                        Parada #{index + 1}
                                    </Badge>

                                    {isGenericLoc ? (
                                        <Badge
                                            variant="outline"
                                            className="font-mono text-xs text-muted-foreground bg-muted gap-1 py-0.5 px-2"
                                        >
                                            <MapPin className="h-3 w-3 text-muted-foreground" />
                                            {item.location || "Sin ubicación"}
                                        </Badge>
                                    ) : (
                                        <Badge
                                            className="bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/30 font-mono font-bold text-xs gap-1 py-0.5 px-2.5 shadow-none"
                                        >
                                            <MapPin className="h-3.5 w-3.5 text-blue-600" />
                                            {item.location}
                                        </Badge>
                                    )}
                                </div>

                                {/* Product Name and SKU */}
                                <div>
                                    <h3
                                        className={cn(
                                            "font-bold text-base leading-tight",
                                            complete
                                                ? "text-emerald-700 line-through dark:text-emerald-300"
                                                : warning
                                                    ? "text-amber-700 dark:text-amber-300"
                                                    : "text-foreground",
                                        )}
                                    >
                                        {item.product_name}
                                    </h3>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-mono">
                                        <span>SKU: {item.sku}</span>
                                        {item.barcode ? <span>EAN: {item.barcode}</span> : null}
                                    </div>
                                </div>

                                {/* Quantities & Progress Bar */}
                                <div className="bg-muted/40 p-2 rounded-md space-y-1.5 text-xs">
                                    <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground">
                                            Solicitado: <strong className="text-foreground">{totalQty} un.</strong>
                                        </span>
                                        <span className="text-muted-foreground">
                                            Recolectado:{" "}
                                            <strong
                                                className={
                                                    pickedQty > 0
                                                        ? "text-blue-600 dark:text-blue-400 font-bold"
                                                        : "text-foreground"
                                                }
                                            >
                                                {pickedQty} un.
                                            </strong>
                                        </span>
                                    </div>
                                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                                        <div
                                            className={cn(
                                                "h-full transition-all rounded-full",
                                                complete
                                                    ? "bg-emerald-600"
                                                    : warning
                                                        ? "bg-amber-500"
                                                        : "bg-blue-600",
                                            )}
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Bottom Interactive Action Area */}
                            <div className="pt-2 border-t mt-2">
                                {complete ? (
                                    <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                                        <span>Listo para empaque</span>
                                        <Badge className="bg-emerald-600 text-white gap-1 py-1 px-2.5 font-semibold text-xs shadow-none">
                                            <Check className="h-3.5 w-3.5" /> Recolectado
                                        </Badge>
                                    </div>
                                ) : isActive ? (
                                    <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-400 font-semibold animate-pulse">
                                        <span>En proceso de escaneo...</span>
                                        <Button
                                            size="sm"
                                            className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 h-8 text-xs font-semibold shadow-sm"
                                        >
                                            <ScanLine className="h-3.5 w-3.5" /> En escaneo
                                        </Button>
                                    </div>
                                ) : canPick ? (
                                    <div className="flex items-center justify-between">
                                        <span
                                            className={cn(
                                                "text-xs font-medium",
                                                warning
                                                    ? "text-amber-600 dark:text-amber-400"
                                                    : "text-muted-foreground",
                                            )}
                                        >
                                            {warning ? (
                                                <span className="flex items-center gap-1">
                                                    <AlertTriangle className="h-3 w-3" /> Faltan {remaining} un.
                                                </span>
                                            ) : (
                                                `Pendiente: ${remaining} un.`
                                            )}
                                        </span>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-blue-500/40 text-blue-700 dark:text-blue-300 hover:bg-blue-500/10 gap-1.5 h-8 text-xs font-semibold shadow-sm"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onSelectItem(item);
                                            }}
                                        >
                                            <ScanLine className="h-3.5 w-3.5" /> Recolectar
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span>Pedido cerrado</span>
                                        {remaining > 0 ? (
                                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                                                Faltante: {remaining} un.
                                            </Badge>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
