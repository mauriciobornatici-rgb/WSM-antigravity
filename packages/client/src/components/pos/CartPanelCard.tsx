import { CreditCard, Plus, Trash2, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import type { CartPanelProps } from "@/components/pos/types";
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
    subtotal,
    taxLabel,
    taxAmount,
    grandTotal,
    onOpenPaymentDialog,
    currentShift,
    currentRegister,
}: CartPanelProps) {
    return (
        <Card>
            <CardHeader className="space-y-3">
                <CardTitle>Carrito</CardTitle>
                <div className="space-y-2">
                    <Label>Cliente</Label>
                    <div className="flex gap-2">
                        <Select value={selectedClientId} onValueChange={onClientChange}>
                            <SelectTrigger>
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
                        <Button variant="outline" size="icon" onClick={onOpenClientDialog} title="Crear cliente">
                            <UserPlus className="h-4 w-4" />
                        </Button>
                    </div>
                    {selectedClient ? (
                        <div className="rounded-md border bg-slate-50 p-2 text-xs">
                            <div>{selectedClient.name}</div>
                            <div className="text-muted-foreground">{selectedClient.tax_id}</div>
                        </div>
                    ) : null}
                </div>
            </CardHeader>

            <CardContent className="space-y-3">
                {cart.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aún no agregaste productos.</p>
                ) : (
                    cart.map((item) => (
                        <div key={item.id} className="rounded-md border p-2">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="font-medium">{item.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        ${Number(item.sale_price).toLocaleString("es-AR")}
                                    </div>
                                </div>
                                <Button size="icon" variant="ghost" onClick={() => onRemoveFromCart(item.id)}>
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                <Button size="sm" variant="outline" onClick={() => onUpdateQuantity(item.id, -1)}>
                                    -
                                </Button>
                                <span className="w-8 text-center">{item.quantity}</span>
                                <Button size="sm" variant="outline" onClick={() => onUpdateQuantity(item.id, 1)}>
                                    <Plus className="h-3 w-3" />
                                </Button>
                            </div>
                        </div>
                    ))
                )}

                <div className="space-y-1 rounded-md border bg-slate-50 p-3 text-sm">
                    <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span>${subtotal.toLocaleString("es-AR")}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>{taxLabel}</span>
                        <span>${taxAmount.toLocaleString("es-AR")}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                        <span>Total</span>
                        <span>${grandTotal.toLocaleString("es-AR")}</span>
                    </div>
                </div>

                <Button className="w-full" onClick={onOpenPaymentDialog} disabled={cart.length === 0}>
                    <CreditCard className="mr-2 h-4 w-4" />
                    Cobrar
                </Button>

                {!currentShift ? (
                    <p className="text-xs text-red-600">
                        Caja cerrada. Ábrela en{" "}
                        <Link to="/cash-management" className="underline">
                            Gestión de caja
                        </Link>
                        .
                    </p>
                ) : null}
                {currentRegister ? (
                    <p className="text-xs text-muted-foreground">Caja activa: {currentRegister.name}</p>
                ) : null}
            </CardContent>
        </Card>
    );
}
