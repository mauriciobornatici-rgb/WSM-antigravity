import { useState } from "react";
import { Clock, Play, Trash2, PauseCircle, Plus } from "lucide-react";
import type { ParkedCart } from "@/hooks/usePOSCart";
import { formatMoney } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ParkedCartsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    parkedCarts: ParkedCart[];
    hasActiveCart: boolean;
    onParkCurrentCart: (label?: string) => boolean;
    onRestoreCart: (id: string) => void;
    onDeleteCart: (id: string) => void;
}

export function ParkedCartsDialog({
    open,
    onOpenChange,
    parkedCarts,
    hasActiveCart,
    onParkCurrentCart,
    onRestoreCart,
    onDeleteCart,
}: ParkedCartsDialogProps) {
    const [cartLabel, setCartLabel] = useState("");

    function handlePark() {
        const success = onParkCurrentCart(cartLabel);
        if (success) {
            setCartLabel("");
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <PauseCircle className="h-5 w-5 text-amber-500" />
                        Ventas en Espera (Carritos Guardados)
                    </DialogTitle>
                    <DialogDescription>
                        Guarda temporalmente la venta actual para atender a otro cliente y recupérala cuando esté listo.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-2">
                    {hasActiveCart && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                                Poner carrito actual en espera
                            </span>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Nota opcional (ej: Cliente buscando talle)..."
                                    value={cartLabel}
                                    onChange={(e) => setCartLabel(e.target.value)}
                                    className="h-9 text-xs"
                                />
                                <Button size="sm" onClick={handlePark} className="gap-1.5 h-9 shrink-0 bg-amber-600 hover:bg-amber-700 font-semibold">
                                    <Plus className="h-4 w-4" /> Guardar
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Carritos en espera ({parkedCarts.length})
                        </span>

                        {parkedCarts.length === 0 ? (
                            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                                No hay ventas guardadas en espera.
                            </div>
                        ) : (
                            <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                                {parkedCarts.map((item) => (
                                    <div
                                        key={item.id}
                                        className="rounded-lg border bg-card p-3 flex items-center justify-between gap-3 hover:border-primary/40 transition-colors"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="font-semibold text-sm truncate text-foreground">
                                                {item.label}
                                            </div>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 font-mono">
                                                <Clock className="h-3 w-3 text-muted-foreground" />
                                                <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                                <span>•</span>
                                                <span>{item.items.reduce((s, i) => s + i.quantity, 0)} ítems</span>
                                                <span>•</span>
                                                <span className="font-bold text-foreground">{formatMoney(item.grandTotal)}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <Button
                                                size="sm"
                                                variant="default"
                                                onClick={() => {
                                                    onRestoreCart(item.id);
                                                    onOpenChange(false);
                                                }}
                                                className="gap-1 h-8 text-xs font-semibold"
                                                disabled={hasActiveCart}
                                                title={hasActiveCart ? "Guarda primero el carrito activo" : "Recuperar carrito"}
                                            >
                                                <Play className="h-3.5 w-3.5" /> Recuperar
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="ghost"
                                                onClick={() => onDeleteCart(item.id)}
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                title="Eliminar"
                                                aria-label={`Eliminar ${item.label}`}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
