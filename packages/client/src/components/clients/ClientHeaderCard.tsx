import { ArrowLeft, Mail, Phone, MapPin, CreditCard, Plus, User, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Client } from "@/types";

interface ClientHeaderCardProps {
    client: Client;
    accountTotals: {
        billed: number;
        credited: number;
        paid: number;
        balance: number;
    };
    openInvoices: unknown[];
    onOpenPaymentDialog: () => void;
    onBack: () => void;
}

import { formatMoney } from "@/lib/formatters";
import { taxConditionName } from "@/lib/taxConditions";

export function ClientHeaderCard({
    client,
    accountTotals,
    openInvoices,
    onOpenPaymentDialog,
    onBack,
}: ClientHeaderCardProps) {
    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button variant="ghost" onClick={onBack}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver
                </Button>
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{client.name}</h2>
                    <p className="text-muted-foreground">
                        {client.tax_id ? `${client.tax_id} · ` : ""}{taxConditionName(client.tax_condition_id) ?? "Condición IVA sin especificar"}
                    </p>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5 text-blue-500" />
                            Datos del cliente
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                        <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span>{client.email || "-"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span>{client.phone || "-"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm md:col-span-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span>{client.address || "-"}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className={cn(client.current_account_balance > client.credit_limit ? "border-red-500/40 bg-red-500/5" : "")}>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                                <CreditCard className="h-5 w-5 text-green-500" />
                                Cuenta corriente
                            </span>
                            <div className="flex items-center gap-1.5">
                                {client.phone && accountTotals.balance > 0 && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="bg-green-500/10 text-green-600 hover:bg-green-500/20 border-green-500/30 font-semibold"
                                        onClick={() => {
                                            const cleanPhone = String(client.phone || "").replace(/\D/g, "");
                                            const message = `Hola ${client.name}, le enviamos el resumen de su cuenta corriente en SportsERP. Su saldo pendiente es de ${formatMoney(accountTotals.balance)}. Muchas gracias.`;
                                            window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, "_blank");
                                        }}
                                        title="Enviar recordatorio de cobro por WhatsApp"
                                    >
                                        <MessageCircle className="mr-1 h-4 w-4" />
                                        WhatsApp
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    size="sm"
                                    onClick={onOpenPaymentDialog}
                                    disabled={openInvoices.length === 0}
                                >
                                    <Plus className="mr-1 h-4 w-4" />
                                    Registrar cobro
                                </Button>
                            </div>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div>
                            <p className="text-sm text-muted-foreground">Saldo</p>
                            <p className={cn("text-3xl font-bold", accountTotals.balance > 0 ? "text-amber-500" : "text-emerald-500")}>
                                {formatMoney(accountTotals.balance)}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Límite</p>
                            <p className="font-semibold">{formatMoney(client.credit_limit)}</p>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                                className="h-full bg-blue-600"
                                style={{
                                    width: `${client.credit_limit > 0 ? Math.min(100, (accountTotals.balance / client.credit_limit) * 100) : 0}%`
                                }}
                            />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Facturado: {formatMoney(accountTotals.billed)} | NC: {formatMoney(accountTotals.credited)} | Cobrado: {formatMoney(accountTotals.paid)}
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
