import type { InvoiceType, PaymentMethod } from "@/components/pos/types";
import { INVOICE_TYPE_OPTIONS, PAYMENT_METHOD_OPTIONS } from "@/components/pos/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PaymentDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    paymentMethod: PaymentMethod;
    onPaymentMethodChange: (method: PaymentMethod) => void;
    emitInvoice: boolean;
    onEmitInvoiceChange: (emit: boolean) => void;
    invoiceType: InvoiceType;
    onInvoiceTypeChange: (type: InvoiceType) => void;
    grandTotal: number;
    processing: boolean;
    onConfirm: () => void;
};

export function PaymentDialog({
    open,
    onOpenChange,
    paymentMethod,
    onPaymentMethodChange,
    emitInvoice,
    onEmitInvoiceChange,
    invoiceType,
    onInvoiceTypeChange,
    grandTotal,
    processing,
    onConfirm,
}: PaymentDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirmar cobro</DialogTitle>
                    <DialogDescription>Define forma de pago y opción de factura.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-2">
                        <Label>Método</Label>
                        <Select value={paymentMethod} onValueChange={(value) => onPaymentMethodChange(value as PaymentMethod)}>
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

                    <div className="rounded-md border bg-slate-50 p-3 text-right font-semibold">
                        Total: ${grandTotal.toLocaleString("es-AR")}
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button onClick={onConfirm} disabled={processing}>
                        {processing ? "Procesando..." : "Confirmar venta"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
