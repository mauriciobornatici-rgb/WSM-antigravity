import { ArrowLeft } from "lucide-react";
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

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-4">
            <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver a pedidos
                </Button>
                <h2 className="text-2xl font-bold font-sans">Picking: {order.id}</h2>
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
                    <Badge variant="outline" className="font-semibold">{statusLabel(order.status)}</Badge>
                )}
                <Badge className="bg-blue-600 text-white font-bold">{completion}%</Badge>
            </div>

            <div className="flex items-center gap-2">
                <Label className="text-xs font-semibold text-slate-500 shrink-0">Ruta de picking:</Label>
                <Select
                    value={routeDirection}
                    onValueChange={(val) => onRouteChange(val as "desc" | "asc")}
                >
                    <SelectTrigger className="w-48 h-9 text-xs font-semibold">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="desc">Mayor a Menor (Optimizada)</SelectItem>
                        <SelectItem value="asc">Menor a Mayor (Normal)</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
