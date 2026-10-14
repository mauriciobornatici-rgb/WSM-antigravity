import { useState } from "react";
import { Plus, Trash2, UserPlus, Banknote, CheckCircle2 } from "lucide-react";
import type { Client } from "@/types";
import type { InvoiceType, PaymentMethod, PaymentSplit } from "@/components/pos/types";
import { INVOICE_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS } from "@/components/pos/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatMoney } from "@/lib/formatters";
import { createClientUuid } from "@/lib/clientUuid";
import { ClientTaxConditionNotice } from "@/components/clients/ClientTaxConditionNotice";

type PaymentDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    clients: Client[];
    selectedClientId: string;
    onClientChange: (clientId: string) => void;
    onOpenClientDialog: () => void;
    selectedClient: Client | null;
    paymentSplits: PaymentSplit[];
    onPaymentSplitsChange: (splits: PaymentSplit[]) => void;
    emitInvoice: boolean;
    onEmitInvoiceChange: (emit: boolean) => void;
    invoiceType: InvoiceType;
    onInvoiceTypeChange: (type: InvoiceType) => void;
    grandTotal: number;
    processing: boolean;
    onConfirm: () => void;
    onClientUpdated?: (client: Client) => void;
};

function roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

const CONSUMIDOR_FINAL_VALUE = "__consumidor_final__";
const QUICK_CASH_AMOUNTS = [1000, 2000, 5000, 10000, 20000, 50000];

export function PaymentDialog({
    open,
    onOpenChange,
    clients,
    selectedClientId,
    onClientChange,
    onOpenClientDialog,
    selectedClient,
    paymentSplits,
    onPaymentSplitsChange,
    emitInvoice,
    onEmitInvoiceChange,
    invoiceType,
    onInvoiceTypeChange,
    grandTotal,
    processing,
    onConfirm,
    onClientUpdated,
}: PaymentDialogProps) {
    const [cashTendered, setCashTendered] = useState<number | "">("");

    const paidAmount = roundMoney(paymentSplits.reduce((sum, line) => sum + Number(line.amount || 0), 0));
    const difference = roundMoney(grandTotal - paidAmount);
    const hasBalanceError = Math.abs(difference) > 0.01;
    const hasCreditAccountPayment = paymentSplits.some(
        (line) => line.method === "credit_account" && Number(line.amount || 0) > 0,
    );
    const hasClientError = hasCreditAccountPayment && !selectedClientId;
    // A Factura A needs a customer with CUIT: the server refuses it otherwise (AUD-009).
    const hasInvoiceCuitError = emitInvoice && invoiceType === "A" && String(selectedClient?.tax_id || "").replace(/\D/g, "").length !== 11;

    const hasCashSplit = paymentSplits.some((line) => line.method === "cash");
    const cashRequired = roundMoney(paymentSplits.reduce(
        (sum, line) => sum + (line.method === "cash" ? Number(line.amount || 0) : 0),
        0,
    ));
    const numericTendered = typeof cashTendered === "number" ? cashTendered : 0;
    const changeDue = numericTendered > cashRequired ? roundMoney(numericTendered - cashRequired) : 0;

    function handleOpenChange(nextOpen: boolean) {
        if (!nextOpen) setCashTendered("");
        onOpenChange(nextOpen);
    }

    function handleConfirm() {
        setCashTendered("");
        onConfirm();
    }

    function addSplitLine() {
        onPaymentSplitsChange([
            ...paymentSplits,
            {
                id: createClientUuid(),
                method: "cash",
                amount: Math.max(0, difference),
            },
        ]);
    }

    function removeSplitLine(lineId: string) {
        if (paymentSplits.length <= 1) return;
        onPaymentSplitsChange(paymentSplits.filter((line) => line.id !== lineId));
    }

    function updateSplitMethod(lineId: string, method: PaymentMethod) {
        onPaymentSplitsChange(
            paymentSplits.map((line) => (line.id === lineId ? { ...line, method } : line)),
        );
    }

    function updateSplitAmount(lineId: string, amount: number) {
        const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
        onPaymentSplitsChange(
            paymentSplits.map((line) => (line.id === lineId ? { ...line, amount: safeAmount } : line)),
        );
    }

    function handleQuickCash(amount: number) {
        setCashTendered(amount);
        const first = paymentSplits[0];
        if (paymentSplits.length === 1 && first && first.method === "cash") {
            updateSplitAmount(first.id, grandTotal);
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto border border-border bg-card text-card-foreground sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold flex items-center gap-2">
                        <Banknote className="h-5 w-5 text-primary" />
                        Confirmar cobro
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Selecciona o divide los medios de pago y calcula el cambio en efectivo.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <Label htmlFor="payment-client" className="text-xs font-semibold">Cliente</Label>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="w-full gap-2 sm:w-auto h-7 text-xs"
                                onClick={onOpenClientDialog}
                            >
                                <UserPlus className="h-3.5 w-3.5" />
                                Nuevo cliente
                            </Button>
                        </div>
                        <Select
                            value={selectedClientId || CONSUMIDOR_FINAL_VALUE}
                            onValueChange={(value) =>
                                onClientChange(value === CONSUMIDOR_FINAL_VALUE ? "" : value)
                            }
                        >
                            <SelectTrigger id="payment-client" className="h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={CONSUMIDOR_FINAL_VALUE}>Consumidor final</SelectItem>
                                {clients.map((client) => (
                                    <SelectItem key={client.id} value={client.id}>
                                        {client.name} {client.tax_id ? `(${client.tax_id})` : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedClient ? (
                            <div className="rounded-md border bg-muted/20 p-2 text-xs flex justify-between items-center">
                                <div>
                                    <div className="font-semibold">{selectedClient.name}</div>
                                    <div className="text-muted-foreground">{selectedClient.tax_id}</div>
                                </div>
                                <div className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[11px] font-bold">
                                    ⭐ {selectedClient.loyalty_points || 0} pts
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">Se emitirá como consumidor final.</p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <Label className="text-xs font-semibold">Medios de pago</Label>
                            <Button type="button" variant="outline" size="sm" className="w-full gap-1 sm:w-auto h-7 text-xs" onClick={addSplitLine}>
                                <Plus className="h-3.5 w-3.5" />
                                Agregar medio de pago
                            </Button>
                        </div>
                        <div className="space-y-2">
                            {paymentSplits.map((line) => (
                                <div
                                    key={line.id}
                                    className="grid gap-2 rounded-md border bg-muted/20 p-2 md:grid-cols-[minmax(0,1fr)_160px_auto] items-center"
                                >
                                    <Select
                                        value={line.method}
                                        onValueChange={(value) => updateSplitMethod(line.id, value as PaymentMethod)}
                                    >
                                        <SelectTrigger className="h-9" aria-label="Medio de pago">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PAYMENT_METHOD_OPTIONS.map((method) => (
                                                <SelectItem key={method.value} value={method.value}>
                                                    {method.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        aria-label="Monto asignado al medio de pago"
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={line.amount}
                                        onChange={(event) => updateSplitAmount(line.id, Number(event.target.value))}
                                        placeholder="Monto"
                                        className="h-9 font-mono font-bold"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                        disabled={paymentSplits.length <= 1}
                                        onClick={() => removeSplitLine(line.id)}
                                        title="Eliminar línea"
                                        aria-label="Eliminar línea de pago"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Calculadora de Vuelto / Efectivo */}
                    {hasCashSplit && (
                        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2.5">
                            <div className="flex items-center justify-between">
                                <Label className="text-xs font-semibold flex items-center gap-1.5 text-blue-700 dark:text-blue-300">
                                    <Banknote className="h-4 w-4" /> Calculadora de Efectivo & Vuelto
                                </Label>
                                <button
                                    type="button"
                                    onClick={() => handleQuickCash(grandTotal)}
                                    className="text-[11px] font-semibold text-primary hover:underline"
                                >
                                    Importe Exacto ({formatMoney(grandTotal)})
                                </button>
                            </div>

                            <div className="flex flex-wrap gap-1.5">
                                {QUICK_CASH_AMOUNTS.filter((amt) => amt >= grandTotal || amt >= cashRequired).slice(0, 5).map((amt) => (
                                    <Button
                                        key={amt}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleQuickCash(amt)}
                                        className="h-7 text-xs font-mono font-semibold"
                                    >
                                        ${amt.toLocaleString("es-AR")}
                                    </Button>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                <div>
                                    <Label htmlFor="cash-tendered" className="text-[11px] text-muted-foreground">Paga con (recibido):</Label>
                                    <Input
                                        id="cash-tendered"
                                        type="number"
                                        min="0"
                                        step="100"
                                        placeholder={`Ej: ${grandTotal}`}
                                        value={cashTendered}
                                        onChange={(e) => setCashTendered(e.target.value === "" ? "" : Number(e.target.value))}
                                        className="h-9 font-mono font-bold text-base"
                                    />
                                </div>
                                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 flex flex-col justify-center">
                                    <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                                        <CheckCircle2 className="h-3.5 w-3.5" /> Vuelto a Entregar
                                    </span>
                                    <span className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">
                                        {formatMoney(changeDue)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {hasClientError ? (
                        <p className="text-xs font-medium text-destructive bg-destructive/10 p-2 rounded border border-destructive/20">
                            Debes seleccionar un cliente registrado para vender a cuenta corriente.
                        </p>
                    ) : null}

                    <div className="flex items-center justify-between p-2 rounded-md border bg-muted/20">
                        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                            <input
                                type="checkbox"
                                checked={emitInvoice}
                                onChange={(event) => onEmitInvoiceChange(event.target.checked)}
                                className="h-4 w-4 accent-primary rounded cursor-pointer"
                            />
                            Emitir comprobante comercial
                        </label>
                        {emitInvoice && (
                            <div className="flex items-center gap-2">
                                <Label htmlFor="payment-invoice-type" className="text-xs">Tipo:</Label>
                                <Select value={invoiceType} onValueChange={(value) => onInvoiceTypeChange(value as InvoiceType)}>
                                    <SelectTrigger id="payment-invoice-type" className="h-7 w-28 text-xs">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {INVOICE_TYPE_OPTIONS.map((type) => (
                                            <SelectItem key={type.value} value={type.value}>
                                                {type.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>

                    {emitInvoice && onClientUpdated ? (
                        <ClientTaxConditionNotice client={selectedClient} onUpdated={onClientUpdated} />
                    ) : null}

                    {hasInvoiceCuitError ? (
                        <p
                            id="payment-invoice-cuit-error"
                            role="alert"
                            className="flex flex-wrap items-center gap-2 text-xs font-medium text-destructive bg-destructive/10 p-2 rounded border border-destructive/20"
                        >
                            <span>La factura A necesita un cliente con CUIT (11 dígitos). Elegí el cliente o emití una factura B.</span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => onInvoiceTypeChange("B")}
                            >
                                Emitir factura B
                            </Button>
                        </p>
                    ) : null}

                    <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                        <div className="flex items-center justify-between text-muted-foreground">
                            <span>Total Venta</span>
                            <span className="font-semibold font-mono text-foreground text-base">{formatMoney(grandTotal)}</span>
                        </div>
                        <div className="flex items-center justify-between text-muted-foreground">
                            <span>Total Asignado</span>
                            <span className="font-semibold font-mono text-foreground">{formatMoney(paidAmount)}</span>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t">
                            <span className="font-medium">Diferencia</span>
                            <span
                                className={`font-mono font-bold ${
                                    hasBalanceError ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                                }`}
                            >
                                {formatMoney(difference)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        className="font-bold h-10 px-6 shadow-md"
                        onClick={handleConfirm}
                        aria-describedby={hasInvoiceCuitError ? "payment-invoice-cuit-error" : undefined}
                        disabled={processing || hasBalanceError || hasClientError || hasInvoiceCuitError}
                    >
                        {processing ? "Procesando..." : "Confirmar Cobro"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
