import type { FormEvent } from "react";
import { Camera, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Order, OrderItem } from "@/types";
import { orderPickedQuantity, orderTotalQuantity } from "@/lib/pickingUtils";

interface PickingScannerCardProps {
    order: Order;
    canPick: boolean;
    packedWithShortage: boolean;
    completed: boolean;
    packedComplete: boolean;
    scannerInput: string;
    onScannerInputChange: (value: string) => void;
    onScanSubmit: (event: FormEvent<HTMLFormElement>) => void;
    onOpenCamera: () => void;
    canFinalizeNow: boolean;
    missingQuantity: number;
    onFinalize: () => void;
    onCloseWithMissing: () => void;
    pendingScanItem: OrderItem | null;
    pickingStep: "location" | "barcode" | "quantity";
    isLocationVerified: boolean;
    isBarcodeVerified: boolean;
    pendingScanQuantity: number;
    pendingScanRemaining: number;
    onQuantityChange: (qty: number) => void;
    onConfirmManualLocation: () => void;
    onConfirmManualBarcode: () => void;
    onCancelPendingScan: () => void;
    onConfirmPendingScan: () => void;
}

export function PickingScannerCard({
    order,
    canPick,
    packedWithShortage,
    completed,
    packedComplete,
    scannerInput,
    onScannerInputChange,
    onScanSubmit,
    onOpenCamera,
    canFinalizeNow,
    missingQuantity,
    onFinalize,
    onCloseWithMissing,
    pendingScanItem,
    pickingStep,
    isLocationVerified,
    isBarcodeVerified,
    pendingScanQuantity,
    pendingScanRemaining,
    onQuantityChange,
    onConfirmManualLocation,
    onConfirmManualBarcode,
    onCancelPendingScan,
    onConfirmPendingScan,
}: PickingScannerCardProps) {
    return (
        <Card
            className={cn(
                "border",
                packedWithShortage
                    ? "border-amber-500/50 bg-amber-500/10 dark:border-amber-400/50 dark:bg-amber-500/10"
                    : completed || packedComplete
                        ? "border-green-500/40 bg-green-500/5 dark:border-green-500/50 dark:bg-green-500/10"
                        : "border-blue-500/30 bg-blue-500/5 dark:border-blue-500/40 dark:bg-blue-950/30",
            )}
        >
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ScanLine className="h-5 w-5" />
                    Escaner de productos
                </CardTitle>
                <CardDescription>
                    {canPick
                        ? "Escanea SKU, selecciona cantidad y confirma cada item."
                        : packedWithShortage
                            ? "Pedido cerrado con faltantes. Los items pendientes quedan en naranja."
                            : "Pedido cerrado. Ya no admite nuevas lecturas."}
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={onScanSubmit} className="flex flex-col gap-3 md:flex-row">
                    <Input
                        value={scannerInput}
                        onChange={(event) => onScannerInputChange(event.target.value)}
                        placeholder="Ej: NK-AIR-001"
                        className="font-mono"
                        disabled={!canPick}
                        autoFocus
                    />
                    <Button type="button" variant="outline" onClick={onOpenCamera} disabled={!canPick}>
                        <Camera className="mr-2 h-4 w-4" />Cámara
                    </Button>
                    <Button type="submit" disabled={!canPick}>
                        Buscar SKU
                    </Button>
                    {canFinalizeNow ? (
                        <Button type="button" onClick={onFinalize}>
                            Finalizar picking
                        </Button>
                    ) : null}
                    {canPick && missingQuantity > 0 ? (
                        <Button type="button" variant="outline" onClick={onCloseWithMissing}>
                            Cerrar con faltantes
                        </Button>
                    ) : null}
                </form>

                {pendingScanItem && canPick ? (
                    <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/10 dark:border-blue-400/30 dark:bg-blue-950/20 p-4 space-y-4 shadow-sm">
                        {/* Steps header */}
                        <div className="flex items-center justify-between border-b border-blue-500/20 pb-3">
                            <div>
                                <h3 className="font-bold text-slate-900 dark:text-slate-100">{pendingScanItem.product_name}</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    SKU: {pendingScanItem.sku} | Cantidad Solicitada: {pendingScanItem.quantity}
                                </p>
                            </div>
                            <Badge className="bg-blue-600 dark:bg-blue-500">
                                {pickingStep === "location" ? "Paso 1: Ubicación" : pickingStep === "barcode" ? "Paso 2: Producto" : "Paso 3: Cantidad"}
                            </Badge>
                        </div>

                        {/* Visual progress dots */}
                        <div className="flex items-center justify-center gap-6 py-2 text-xs font-semibold">
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                                    isLocationVerified
                                        ? "bg-emerald-600 border-emerald-600 text-white"
                                        : pickingStep === "location"
                                            ? "bg-blue-600 border-blue-600 text-white animate-pulse"
                                            : "border-border text-muted-foreground",
                                )}>
                                    {isLocationVerified ? "✓" : "1"}
                                </span>
                                <span className={isLocationVerified ? "text-emerald-600 dark:text-emerald-400" : pickingStep === "location" ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}>
                                    Ubicación
                                </span>
                            </div>
                            <div className="h-[1px] w-8 bg-border" />
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                                    isBarcodeVerified
                                        ? "bg-emerald-600 border-emerald-600 text-white"
                                        : pickingStep === "barcode"
                                            ? "bg-blue-600 border-blue-600 text-white animate-pulse"
                                            : "border-border text-muted-foreground",
                                )}>
                                    {isBarcodeVerified ? "✓" : "2"}
                                </span>
                                <span className={isBarcodeVerified ? "text-emerald-600 dark:text-emerald-400" : pickingStep === "barcode" ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}>
                                    Producto
                                </span>
                            </div>
                            <div className="h-[1px] w-8 bg-border" />
                            <div className="flex items-center gap-2">
                                <span className={cn(
                                    "flex h-6 w-6 items-center justify-center rounded-full border text-xs",
                                    pickingStep === "quantity" ? "bg-blue-600 border-blue-600 text-white animate-pulse" : "border-border text-muted-foreground",
                                )}>
                                    3
                                </span>
                                <span className={pickingStep === "quantity" ? "text-blue-600 dark:text-blue-400 animate-pulse" : "text-muted-foreground"}>
                                    Cantidad
                                </span>
                            </div>
                        </div>

                        {/* Step Content */}
                        {pickingStep === "location" && (
                            <div className="space-y-3 bg-white/50 dark:bg-black/20 p-3 rounded-lg border border-blue-500/10">
                                <div className="text-center py-2">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Dirígete a la ubicación</p>
                                    <p className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 font-mono mt-1">{pendingScanItem.location || "Sin ubicación"}</p>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <p className="text-xs text-center text-slate-500">Usa el lector para escanear el código del estante o haz clic abajo para verificar manualmente.</p>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={onConfirmManualLocation}
                                    >
                                        Confirmar ubicación manualmente
                                    </Button>
                                </div>
                            </div>
                        )}

                        {pickingStep === "barcode" && (
                            <div className="space-y-3 bg-white/50 dark:bg-black/20 p-3 rounded-lg border border-blue-500/10">
                                <div className="text-center py-2">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Escanea el producto</p>
                                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">{pendingScanItem.product_name}</p>
                                    <div className="flex justify-center gap-4 text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 bg-slate-100 dark:bg-slate-900 py-1 px-3 rounded-md w-fit mx-auto">
                                        <span>SKU: {pendingScanItem.sku}</span>
                                        {pendingScanItem.barcode && <span>EAN: {pendingScanItem.barcode}</span>}
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <p className="text-xs text-center text-slate-500">Escanea el código de barra del artículo o haz clic abajo para omitir el escaneo.</p>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={onConfirmManualBarcode}
                                    >
                                        Omitir escaneo y verificar producto
                                    </Button>
                                </div>
                            </div>
                        )}

                        {pickingStep === "quantity" && (
                            <div className="space-y-3 bg-white/50 dark:bg-black/20 p-3 rounded-lg border border-blue-500/10">
                                <div className="text-center py-1">
                                    <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">Confirma la cantidad recolectada</p>
                                    <p className="text-lg font-bold text-slate-800 dark:text-slate-200 mt-1">{pendingScanItem.product_name}</p>
                                </div>

                                <div className="flex flex-col gap-3 items-center justify-center">
                                    <div className="flex items-center gap-4">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="h-10 w-10 text-xl font-bold"
                                            onClick={() => onQuantityChange(Math.max(1, pendingScanQuantity - 1))}
                                        >
                                            -
                                        </Button>
                                        <Input
                                            type="number"
                                            min="1"
                                            max={pendingScanRemaining}
                                            value={pendingScanQuantity}
                                            onChange={(e) => onQuantityChange(Math.max(1, Math.min(pendingScanRemaining, Number(e.target.value || 1))))}
                                            className="w-20 text-center font-bold text-lg"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="h-10 w-10 text-xl font-bold"
                                            onClick={() => onQuantityChange(Math.min(pendingScanRemaining, pendingScanQuantity + 1))}
                                        >
                                            +
                                        </Button>
                                    </div>
                                    <span className="text-xs text-slate-500 dark:text-slate-400">Máximo pendiente: {pendingScanRemaining} unidades</span>
                                </div>

                                <div className="flex justify-end gap-2 border-t pt-3 mt-2">
                                    <Button type="button" variant="ghost" onClick={onCancelPendingScan}>
                                        Cancelar
                                    </Button>
                                    <Button type="button" className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold" onClick={onConfirmPendingScan}>
                                        Confirmar y Avanzar
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border bg-background/70 p-3">
                        <p className="text-xs text-muted-foreground">Unidades solicitadas</p>
                        <p className="text-lg font-semibold">{orderTotalQuantity(order)}</p>
                    </div>
                    <div className="rounded-md border bg-background/70 p-3">
                        <p className="text-xs text-muted-foreground">Unidades recolectadas</p>
                        <p className="text-lg font-semibold">{orderPickedQuantity(order)}</p>
                    </div>
                    <div className={cn("rounded-md border p-3", missingQuantity > 0 ? "border-amber-500/50 bg-amber-500/10" : "bg-background/70")}>
                        <p className="text-xs text-muted-foreground">Faltante</p>
                        <p className={cn("text-lg font-semibold", missingQuantity > 0 ? "text-amber-400" : "")}>{missingQuantity}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
