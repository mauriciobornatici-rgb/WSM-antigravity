import { Plus, Trash2 } from "lucide-react";
import type { InvoiceType, PaymentMethod, PaymentSplit } from "@/components/pos/types";
import { INVOICE_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS } from "@/components/pos/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PaymentDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    paymentSplits: PaymentSplit[];
    onPaymentSplitsChange: (splits: PaymentSplit[]) => void;
    emitInvoice: boolean;
    onEmitInvoiceChange: (emit: boolean) => void;
    invoiceType: InvoiceType;
    onInvoiceTypeChange: (type: InvoiceType) => void;
    grandTotal: number;
    processing: boolean;
    onConfirm: () => void;
};

function roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function PaymentDialog({
    open,
    onOpenChange,
    paymentSplits,
    onPaymentSplitsChange,
    emitInvoice,
    onEmitInvoiceChange,
    invoiceType,
    onInvoiceTypeChange,
    grandTotal,
    processing,
    onConfirm,
}: PaymentDialogProps) {
    const paidAmount = roundMoney(paymentSplits.reduce((sum, line) => sum + Number(line.amount || 0), 0));
    const difference = roundMoney(grandTotal - paidAmount);
    const hasBalanceError = Math.abs(difference) > 0.01;

    function addSplitLine() {
        onPaymentSplitsChange([
            ...paymentSplits,
            {
                id: crypto.randomUUID(),
                method: "cash",
                amount: 0,
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

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Confirmar cobro</DialogTitle>
                    <DialogDescription>Puedes dividir el pago entre varios metodos.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <Label>Medios de pago</Label>
                            <Button type="button" variant="outline" size="sm" className="w-full gap-2 sm:w-auto" onClick={addSplitLine}>
                                <Plus className="h-4 w-4" />
                                Agregar linea
                            </Button>
                        </div>
                        <div className="space-y-2">
                            {paymentSplits.map((line) => (
                                <div key={line.id} className="grid gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1fr)_160px_auto]">
                                    <Select
                                        value={line.method}
                                        onValueChange={(value) => updateSplitMethod(line.id, value as PaymentMethod)}
                                    >
                                        <SelectTrigger>
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
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={line.amount}
                                        onChange={(event) => updateSplitAmount(line.id, Number(event.target.value))}
                                        placeholder="Monto"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="w-full md:w-auto"
                                        disabled={paymentSplits.length <= 1}
                                        onClick={() => removeSplitLine(line.id)}
                                        title="Eliminar linea"
                                    >
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={emitInvoice}
                            onChange={(event) => onEmitInvoiceChange(event.target.checked)}
                        />
                        Emitir factura
                    </label>

                    {emitInvoice ? (
                        <div className="space-y-2">
                            <Label>Tipo de factura</Label>
                            <Select value={invoiceType} onValueChange={(value) => onInvoiceTypeChange(value as InvoiceType)}>
                                <SelectTrigger>
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
                    ) : null}

                    <div className="rounded-md border bg-slate-50 p-3 text-sm">
                        <div className="flex items-center justify-between">
                            <span>Total venta</span>
                            <span className="font-semibold">${grandTotal.toLocaleString("es-AR")}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                            <span>Total asignado</span>
                            <span className="font-semibold">${paidAmount.toLocaleString("es-AR")}</span>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                            <span>Diferencia</span>
                            <span className={hasBalanceError ? "font-semibold text-red-600" : "font-semibold text-emerald-600"}>
                                ${difference.toLocaleString("es-AR")}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button type="button" onClick={onConfirm} disabled={processing || hasBalanceError}>
                        {processing ? "Procesando..." : "Confirmar venta"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
