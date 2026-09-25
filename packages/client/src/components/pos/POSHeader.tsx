import { ArrowLeft, History, Moon, Package, PauseCircle, RefreshCw, Sun, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface POSHeaderProps {
    onBack: () => void;
    onOpenHistory: () => void;
    parkedCartsCount: number;
    onOpenParkedCarts: () => void;
    pickupOrdersCount?: number;
    onOpenPickupOrders?: () => void;
    offlineQueueCount: number;
    syncingOffline: boolean;
    onSyncOffline: () => void;
    theme: string;
    onToggleTheme: () => void;
    isOnline: boolean;
}

export function POSHeader({
    onBack,
    onOpenHistory,
    parkedCartsCount,
    onOpenParkedCarts,
    pickupOrdersCount = 0,
    onOpenPickupOrders,
    offlineQueueCount,
    syncingOffline,
    onSyncOffline,
    theme,
    onToggleTheme,
    isOnline,
}: POSHeaderProps) {
    return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-card/60 p-3 rounded-lg border">
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={onBack}
                >
                    <ArrowLeft className="h-4 w-4" />
                    <span className="hidden sm:inline">Volver</span>
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-blue-800/30 bg-blue-950/20 text-blue-400 hover:bg-blue-950/40 hover:text-blue-300"
                    onClick={onOpenHistory}
                >
                    <History className="h-4 w-4" />
                    <span>Historial</span>
                    <kbd className="hidden md:inline-block text-[9px] bg-muted/40 px-1 rounded font-mono">F3</kbd>
                </Button>

                {onOpenPickupOrders && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={`gap-1.5 ${
                            pickupOrdersCount > 0
                                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold hover:bg-emerald-500/20"
                                : ""
                        }`}
                        onClick={onOpenPickupOrders}
                        title="Pedidos listos para retiro en mostrador"
                    >
                        <Package className="h-4 w-4 text-emerald-500" />
                        <span>Retiro Mostrador ({pickupOrdersCount})</span>
                    </Button>
                )}

                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={`gap-1.5 ${parkedCartsCount > 0 ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold" : ""}`}
                    onClick={onOpenParkedCarts}
                    title="Ventas en espera"
                >
                    <PauseCircle className="h-4 w-4" />
                    <span>En Espera ({parkedCartsCount})</span>
                </Button>

                {offlineQueueCount > 0 && (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                        onClick={onSyncOffline}
                        disabled={syncingOffline}
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${syncingOffline ? "animate-spin" : ""}`} />
                        <span>Sincronizar Offline ({offlineQueueCount})</span>
                    </Button>
                )}

                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onToggleTheme}
                    title={theme === "dark" ? "Cambiar a Modo Día" : "Cambiar a Modo Noche"}
                >
                    {theme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-500" />}
                </Button>
            </div>

            <div className="flex items-center gap-3 text-xs">
                {/* Indicador de red */}
                <div className="flex items-center gap-1.5 font-medium">
                    {isOnline ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                            <Wifi className="h-3 w-3" /> Online
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                            <WifiOff className="h-3 w-3" /> Modo Contingencia Offline
                        </span>
                    )}
                </div>

                {/* Atajos de ayuda */}
                <div className="hidden lg:flex items-center gap-2 text-muted-foreground bg-muted/30 px-2.5 py-1 rounded border text-[11px] font-mono">
                    <span><kbd className="bg-background px-1 py-0.5 rounded border">F2</kbd> Buscar</span>
                    <span><kbd className="bg-background px-1 py-0.5 rounded border">F4</kbd> Cobrar</span>
                    <span><kbd className="bg-background px-1 py-0.5 rounded border">F8</kbd> Comprobante</span>
                    <span><kbd className="bg-background px-1 py-0.5 rounded border">F9</kbd> Vaciar</span>
                    <span><kbd className="bg-background px-1 py-0.5 rounded border">Esc</kbd> Salir</span>
                </div>
            </div>
        </div>
    );
}
