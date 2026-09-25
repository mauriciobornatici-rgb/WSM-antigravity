import { ArrowLeft, Calendar, Compass, Store, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Order } from "@/types";
import { readyStatusLabel, statusLabel } from "@/lib/pickingUtils";

interface PickingHeaderProps {
    order: Order;
    completion: number;
    canPick: boolean;
    missingQuantity: number;
    hasShortage: boolean;
    routeDirection: "desc" | "asc";
    onRouteChange: (val: "desc" | "asc") => void;
    onBack: () => void;
}

export function PickingHeader({
    order,
    completion,
    canPick,
    missingQuantity,
    hasShortage,
    routeDirection,
    onRouteChange,
    onBack,
}: PickingHeaderProps) {
    const canFinalizeNow = canPick && missingQuantity === 0;
    const packedWithShortage = order.status === "packed" && hasShortage;
    const packedComplete = order.status === "packed" && !hasShortage;

    const shortId = order.id.slice(0, 8).toUpperCase();
    const dateStr = order.estimated_delivery || order.created_at;
    const formattedDate = dateStr
        ? new Date(dateStr).toLocaleDateString("es-AR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
          })
        : "-";

    return (
        <div className="flex flex-col gap-4 border-b pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                {/* Left side: Back button & Order identification */}
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2 text-xs">
                            <ArrowLeft className="mr-1 h-4 w-4" />
                            Volver a pedidos
                        </Button>
                        <span className="font-mono text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-semibold">
                            #{shortId}
                        </span>
                        {order.shipping_method === "delivery" ? (
                            <Badge
                                variant="outline"
                                className="text-[11px] gap-1 bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30 py-0"
                            >
                                <Truck className="h-3 w-3" /> Domicilio
                            </Badge>
                        ) : (
                            <Badge
                                variant="outline"
                                className="text-[11px] gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 py-0"
                            >
                                <Store className="h-3 w-3" /> Mostrador
                            </Badge>
                        )}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3 text-blue-600" />
                            {order.estimated_delivery ? "Entrega:" : "Pedido:"} {formattedDate}
                        </span>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-2xl font-bold tracking-tight text-foreground">
                            {order.customer_name || order.client_name || "Consumidor final"}
                        </h2>

                        {packedWithShortage ? (
                            <Badge className="bg-amber-500/20 text-amber-700 border-amber-300 hover:bg-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-800/50 font-semibold">
                                {readyStatusLabel(order)} c/faltante
                            </Badge>
                        ) : packedComplete ? (
                            <Badge className="bg-emerald-500/20 text-emerald-700 border-emerald-300 hover:bg-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-800/50 font-semibold">
                                {readyStatusLabel(order)}
                            </Badge>
                        ) : canFinalizeNow ? (
                            <Badge className="bg-blue-600 text-white font-semibold">
                                Listo para cerrar
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="font-semibold">
                                {statusLabel(order.status)}
                            </Badge>
                        )}

                        <Badge className="bg-blue-600 text-white font-bold">{completion}% recolectado</Badge>
                    </div>
                </div>

                {/* Right side: Warehouse Route Selector */}
                <div className="flex items-center gap-2 self-start lg:self-center bg-muted/40 p-1.5 rounded-lg border">
                    <Label className="text-xs font-semibold text-muted-foreground shrink-0 flex items-center gap-1 pl-1">
                        <Compass className="h-3.5 w-3.5 text-blue-600" />
                        Ruta WMS:
                    </Label>
                    <Select
                        value={routeDirection}
                        onValueChange={(val) => onRouteChange(val as "desc" | "asc")}
                    >
                        <SelectTrigger className="w-56 h-8 text-xs font-semibold bg-background">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="asc">Zona A → Z (Ruta estándar)</SelectItem>
                            <SelectItem value="desc">Zona Z → A (Ruta inversa)</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
}
