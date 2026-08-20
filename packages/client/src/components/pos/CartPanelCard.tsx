import { CreditCard, Plus, Trash2, UserPlus, RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import type { CartPanelProps } from "@/components/pos/types";
import { formatMoney } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CartPanelCard({
    clients,
    selectedClientId,
    onClientChange,
    onOpenClientDialog,
    selectedClient,
    cart,
    onRemoveFromCart,
    onUpdateQuantity,
    onClearCart,
    subtotal,
    taxLabel,
    taxAmount,
    grandTotal,
    onOpenPaymentDialog,
    currentShift,
    currentRegister,
}: CartPanelProps) {
    return (
        <Card className="border-blue-900/30 bg-gradient-to-b from-blue-950/30 to-background xl:sticky xl:top-4 shadow-sm">
            <CardHeader className="space-y-3 border-b border-blue-900/30 pb-4">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                        Carrito
                        {cart.length > 0 && (
                            <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full font-mono">
                                {cart.reduce((s, i) => s + i.quantity, 0)} ítems
                            </span>
                        )}
                    </CardTitle>
                    {cart.length > 0 && onClearCart && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onClearCart}
                            className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1 px-2"
                            title="Vaciar carrito (F9)"
                        >
                            <RotateCcw className="h-3 w-3" />
                            Vaciar <kbd className="hidden sm:inline-block text-[9px] bg-muted px-1 rounded font-mono">F9</kbd>
                        </Button>
                    )}
                </div>
                <div className="space-y-2">
                    <Label className="text-xs font-semibold">Cliente</Label>
                    <div className="flex gap-2">
                        <Select value={selectedClientId} onValueChange={onClientChange}>
                            <SelectTrigger className="h-9 text-sm">
                                <SelectValue placeholder="Consumidor final" />
                            </SelectTrigger>
                            <SelectContent>
                                {clients.map((client) => (
                                    <SelectItem key={client.id} value={client.id}>
                                        {client.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={onOpenClientDialog} title="Crear cliente rápido">
                            <UserPlus className="h-4 w-4" />
                        </Button>
                    </div>
                    {selectedClient ? (
                        <div className="rounded-md border bg-muted/20 p-2 text-xs flex justify-between items-center">
                            <div>
                                <div className="font-semibold">{selectedClient.name}</div>
                                <div className="text-muted-foreground">{selectedClient.tax_id}</div>
                            </div>
                            <div className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-2 py-1 rounded text-[11px] font-bold flex items-center gap-1">
                                <span>⭐</span> {selectedClient.loyalty_points || 0} pts
                            </div>
                        </div>
                    ) : null}
                </div>
            </CardHeader>

            <CardContent className="space-y-4 p-4 sm:p-5">
                {cart.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground space-y-1">
                        <p>Aún no agregaste productos.</p>
                        <p className="text-xs text-muted-foreground/70">
                            Presiona <kbd className="bg-muted px-1.5 py-0.5 rounded font-mono text-[10px]">F2</kbd> para buscar o escanea un código.
                        </p>
                    </div>
                ) : (
                    <div className="max-h-[44vh] space-y-2 overflow-y-auto pr-1">
                        {cart.map((item) => (
                            <div key={item.id} className="rounded-md border p-2 hover:border-primary/40 transition-colors bg-card/40">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex min-w-0 items-center gap-2">
                                        {item.image_url ? (
                                            <img
                                                src={item.image_url}
                                                alt={item.name}
                                                className="h-10 w-10 shrink-0 rounded-md object-cover"
                                            />
                                        ) : (
                                            <div className="h-10 w-10 shrink-0 rounded-md border bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground">
                                                WSM
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <div className="truncate font-medium text-sm">{item.name}</div>
                                            <div className="text-xs text-muted-foreground">
                                                ${Number(item.sale_price).toLocaleString("es-AR")}
                                            </div>
                                        </div>
                                    </div>
                                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onRemoveFromCart(item.id)}>
                                        <span className="sr-only">Quitar {item.name} del carrito</span>
                                        <Trash2 className="h-4 w-4 text-destructive/80 hover:text-destructive" />
                                    </Button>
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                                    <div className="flex items-center gap-1.5">
                                        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => onUpdateQuantity(item.id, -1)}>
                                            -
                                        </Button>
                                        <span className="w-8 text-center font-mono text-sm font-semibold">{item.quantity}</span>
                                        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => onUpdateQuantity(item.id, 1)}>
                                            <Plus className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    <div className="text-sm font-bold font-mono">
                                        ${(Number(item.sale_price) * item.quantity).toLocaleString("es-AR")}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="space-y-1.5 rounded-md border bg-muted/20 p-3 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                        <span>Subtotal</span>
                        <span className="font-mono">{formatMoney(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground text-xs">
                        <span>{taxLabel}</span>
                        <span className="font-mono">{formatMoney(taxAmount)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-base pt-1 border-t border-border/60">
                        <span>Total a Pagar</span>
                        <span className="font-mono text-primary text-lg">{formatMoney(grandTotal)}</span>
                    </div>
                </div>

                <Button
                    className="w-full h-11 text-base font-bold shadow-md gap-2"
                    onClick={onOpenPaymentDialog}
                    disabled={cart.length === 0}
                >
                    <CreditCard className="h-5 w-5" />
                    <span>Cobrar</span>
                    <kbd className="hidden sm:inline-block rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[11px] font-mono tracking-wider font-normal">
                        F4
                    </kbd>
                </Button>

                {!currentShift ? (
                    <p className="text-xs text-destructive text-center bg-destructive/10 p-2 rounded border border-destructive/20 font-medium">
                        Caja cerrada. Ábrela en{" "}
                        <Link to="/cash-management" className="underline font-bold">
                            Gestión de caja
                        </Link>
                        .
                    </p>
                ) : null}
                {currentRegister ? (
                    <p className="text-[11px] text-muted-foreground text-center">Caja activa: <span className="font-semibold text-foreground">{currentRegister.name}</span></p>
                ) : null}
            </CardContent>
        </Card>
    );
}
