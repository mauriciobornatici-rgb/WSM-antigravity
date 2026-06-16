import { useState, useMemo, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { showErrorToast } from "@/lib/errorHandling";
import type { InvoiceSummary } from "./ClientDocumentsCards";

type PaymentLine = {
    id: string;
    method: "cash" | "transfer" | "credit_account" | "card" | "debit_card" | "credit_card" | "qr";
    amount: string;
};

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentLine["method"]; label: string }> = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta debito" },
    { value: "credit_card", label: "Tarjeta credito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
    { value: "card", label: "Tarjeta" },
];

function createPaymentLine(defaultAmount = ""): PaymentLine {
    return {
        id: crypto.randomUUID(),
        method: "cash",
        amount: defaultAmount,
    };
}

function formatInvoiceLabel(invoice: Pick<InvoiceSummary, "invoice_type" | "point_of_sale" | "invoice_number" | "id">): string {
    if (!invoice.invoice_number) return invoice.id;
    const type = String(invoice.invoice_type || "B");
    const pos = String(Number(invoice.point_of_sale || 1)).padStart(4, "0");
    const number = String(Number(invoice.invoice_number || 0)).padStart(8, "0");
    return `${type}-${pos}-${number}`;
}

const formatMoney = (value: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value || 0));
};

interface ClientPaymentDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    openInvoices: InvoiceSummary[];
    invoices: InvoiceSummary[];
    invoicePaidById: Map<string, number>;
    onSuccess: () => Promise<void>;
}

export function ClientPaymentDialog({
    open,
    onOpenChange,
    openInvoices,
    invoices,
    invoicePaidById,
    onSuccess,
}: ClientPaymentDialogProps) {
    const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
    const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([createPaymentLine()]);
    const [paymentNotes, setPaymentNotes] = useState("");
    const [registeringPayment, setRegisteringPayment] = useState(false);

    // Sync selected invoice when dialog opens or invoices change
    useEffect(() => {
        if (open) {
            const target = openInvoices[0]?.id || "";
            setSelectedInvoiceId(target);
            const targetPending = target
                ? Math.max(0, Number((invoices.find((inv) => inv.id === target)?.total_amount || 0) - Number(invoicePaidById.get(target) || 0)))
                : 0;
            const suggested = targetPending > 0 ? String(targetPending.toFixed(2)) : "";
            setPaymentLines([createPaymentLine(suggested)]);
            setPaymentNotes("");
        }
    }, [open, openInvoices, invoices, invoicePaidById]);

    const selectedInvoice = useMemo(() => {
        if (!selectedInvoiceId) return null;
        return invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null;
    }, [invoices, selectedInvoiceId]);

    const selectedInvoicePaid = useMemo(
        () => (selectedInvoice ? Number(invoicePaidById.get(selectedInvoice.id) || 0) : 0),
        [invoicePaidById, selectedInvoice]
    );

    const selectedInvoicePending = useMemo(() => {
        if (!selectedInvoice) return 0;
        return Math.max(0, Number(selectedInvoice.total_amount || 0) - selectedInvoicePaid);
    }, [selectedInvoice, selectedInvoicePaid]);

    const paymentLinesTotal = useMemo(
        () => paymentLines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
        [paymentLines]
    );

    function handleClose() {
        onOpenChange(false);
        setSelectedInvoiceId("");
        setPaymentLines([createPaymentLine()]);
        setPaymentNotes("");
        setRegisteringPayment(false);
    }

    function updatePaymentLine(lineId: string, patch: Partial<PaymentLine>) {
        setPaymentLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
    }

    async function submitPaymentRegistration() {
        if (!selectedInvoice) {
            toast.error("Selecciona una factura para registrar el cobro.");
            return;
        }
        if (selectedInvoicePending <= 0) {
            toast.info("La factura seleccionada ya esta saldada.");
            return;
        }

        if (paymentLines.some((line) => Number(line.amount || 0) <= 0)) {
            toast.error("Existen lineas de pago con monto 0 o vacio.");
            return;
        }

        const sanitized = paymentLines
            .map((line) => ({
                method: line.method,
                amount: Number(line.amount || 0),
            }));

        const totalToRegister = sanitized.reduce((sum, line) => sum + line.amount, 0);
        if (totalToRegister - selectedInvoicePending > 0.01) {
            toast.error("El cobro supera el saldo pendiente de la factura seleccionada.");
            return;
        }

        try {
            setRegisteringPayment(true);
            await api.registerInvoicePayment(selectedInvoice.id, {
                payments: sanitized,
                ...(paymentNotes.trim() ? { notes: paymentNotes.trim() } : {}),
            });
            toast.success("Cobro registrado", {
                description: `Se aplicaron $${totalToRegister.toLocaleString("es-AR")} a la factura.`,
            });
            handleClose();
            await onSuccess();
        } catch (error) {
            showErrorToast("No se pudo registrar el cobro", error);
        } finally {
            setRegisteringPayment(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(val) => (val ? onOpenChange(true) : handleClose())}>
            <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Registrar cobro de factura</DialogTitle>
                    <DialogDescription>
                        Registra pagos parciales o mixtos para impactar cuenta corriente y estado de pago.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="invoice-select">Factura</Label>
                        <Select
                            value={selectedInvoiceId}
                            onValueChange={(value) => {
                                setSelectedInvoiceId(value);
                                const pending = Math.max(
                                    0,
                                    Number((invoices.find((invoice) => invoice.id === value)?.total_amount || 0) - Number(invoicePaidById.get(value) || 0))
                                );
                                setPaymentLines([createPaymentLine(pending > 0 ? String(pending.toFixed(2)) : "")]);
                            }}
                        >
                            <SelectTrigger id="invoice-select">
                                <SelectValue placeholder="Selecciona una factura pendiente" />
                            </SelectTrigger>
                            <SelectContent>
                                {openInvoices.map((invoice) => {
                                    const paid = Number(invoicePaidById.get(invoice.id) || 0);
                                    const pending = Math.max(0, Number(invoice.total_amount || 0) - paid);
                                    return (
                                        <SelectItem key={invoice.id} value={invoice.id}>
                                            {formatInvoiceLabel(invoice)} | Pendiente {formatMoney(pending)}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                        {openInvoices.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No hay facturas pendientes para este cliente.</p>
                        ) : null}
                    </div>

                    {selectedInvoice ? (
                        <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
                            <div>
                                <p className="text-muted-foreground">Total factura</p>
                                <p className="font-semibold">{formatMoney(selectedInvoice.total_amount)}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">Pagado</p>
                                <p className="font-semibold text-emerald-500">{formatMoney(selectedInvoicePaid)}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">Pendiente</p>
                                <p className="font-semibold text-amber-500">{formatMoney(selectedInvoicePending)}</p>
                            </div>
                        </div>
                    ) : null}

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <Label>Lineas de pago</Label>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setPaymentLines((prev) => [...prev, createPaymentLine()])}
                            >
                                <Plus className="mr-1 h-4 w-4" />
                                Agregar linea
                            </Button>
                        </div>
                        <div className="space-y-2">
                            {paymentLines.map((line) => (
                                <div key={line.id} className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                                    <Select
                                        value={line.method}
                                        onValueChange={(value) => updatePaymentLine(line.id, { method: value as PaymentLine["method"] })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PAYMENT_METHOD_OPTIONS.map((option) => (
                                                <SelectItem key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={line.amount}
                                        onChange={(event) => updatePaymentLine(line.id, { amount: event.target.value })}
                                        placeholder="Monto"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() =>
                                            setPaymentLines((prev) => (prev.length <= 1 ? prev : prev.filter((entry) => entry.id !== line.id)))
                                        }
                                        disabled={paymentLines.length <= 1}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="payment-notes">Observaciones</Label>
                        <Textarea
                            id="payment-notes"
                            value={paymentNotes}
                            onChange={(event) => setPaymentNotes(event.target.value)}
                            placeholder="Detalle opcional del cobro..."
                            rows={3}
                        />
                    </div>

                    <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
                        <div>
                            <p className="text-muted-foreground">Total a registrar</p>
                            <p className="font-semibold">{formatMoney(paymentLinesTotal)}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">Pendiente actual</p>
                            <p className="font-semibold">{formatMoney(selectedInvoicePending)}</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">Saldo restante</p>
                            <p className={cn("font-semibold", paymentLinesTotal - selectedInvoicePending > 0.01 ? "text-red-500" : "text-emerald-500")}>
                                {formatMoney(selectedInvoicePending - paymentLinesTotal)}
                            </p>
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={handleClose}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        onClick={() => void submitPaymentRegistration()}
                        disabled={
                            registeringPayment || 
                            !selectedInvoiceId || 
                            openInvoices.length === 0 || 
                            paymentLines.some(line => Number(line.amount || 0) <= 0) || 
                            paymentLinesTotal <= 0 || 
                            paymentLinesTotal - selectedInvoicePending > 0.01
                        }
                    >
                        {registeringPayment ? "Registrando..." : "Registrar cobro"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
