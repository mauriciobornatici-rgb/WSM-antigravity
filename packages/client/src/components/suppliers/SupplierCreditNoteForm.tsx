import { useId, useState } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArgentinaDateInput } from '@/components/common/ArgentinaDateInput';
import { formatMoney } from '@/lib/formatters';
import { VAT_RATE_OPTIONS, formatVatRate } from '@/lib/pricing';
import type { SupplierCreditNoteCreateInput, SupplierInvoiceResponse } from '@/services/api';
import { creditPending, round2 } from './supplierCredit';

interface SupplierCreditNoteFormProps {
    invoice: SupplierInvoiceResponse;
    onSubmit: (data: SupplierCreditNoteCreateInput) => Promise<void>;
    onCancel: () => void;
}

/**
 * ADR-029: the supplier's credit note for units its invoice charged of more. It carries the
 * invoice's letter; on a Factura B its VAT is part of what was owed back (it was cost).
 */
export function SupplierCreditNoteForm({ invoice, onSubmit, onCancel }: SupplierCreditNoteFormProps) {
    const ids = useId();
    const type = invoice.invoice_type;
    const pending = creditPending(invoice);
    const discriminatesVat = type === 'A' || type === 'M';
    const hasVat = type !== 'C';
    // Por defecto, una nota por todo lo que falta recibir (en una B, lo pendiente ya incluye el IVA).
    const initialNet = type === 'B' ? round2(pending / 1.21) : pending;
    const [number, setNumber] = useState('');
    const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
    const [net, setNet] = useState(String(initialNet));
    const [rate, setRate] = useState('21');
    const [vat, setVat] = useState(hasVat ? String(type === 'B' ? round2(pending - initialNet) : round2(initialNet * 0.21)) : '0');
    const [otherTaxes, setOtherTaxes] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const netValue = parseFloat(net) || 0;
    const vatValue = hasVat ? parseFloat(vat) || 0 : 0;
    const taxValue = parseFloat(otherTaxes) || 0;
    const total = round2(netValue + vatValue + taxValue);
    // Lo que vale contra lo pendiente: el neto, y en una B también su IVA (la factura lo puso en el costo).
    const base = round2(netValue + (discriminatesVat ? 0 : vatValue));
    const applied = Math.min(base, pending);
    const extra = round2(base - applied);
    const left = round2(pending - applied);

    const changeNet = (value: string) => {
        setNet(value);
        const parsed = parseFloat(value);
        if (hasVat && !Number.isNaN(parsed)) setVat(String(round2(parsed * (parseFloat(rate) || 0) / 100)));
    };
    const changeRate = (value: string) => {
        setRate(value);
        if (hasVat) setVat(String(round2(netValue * (parseFloat(value) || 0) / 100)));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (number.trim().length < 2) {
            toast.error('Ingresá el número de la nota de crédito');
            document.getElementById(`${ids}-number`)?.focus();
            return;
        }
        if (!(netValue > 0)) {
            toast.error('El neto de la nota de crédito tiene que ser mayor a 0');
            document.getElementById(`${ids}-net`)?.focus();
            return;
        }
        setSubmitting(true);
        try {
            await onSubmit({
                supplier_invoice_id: invoice.id,
                credit_note_number: number.trim(),
                issue_date: issueDate,
                net_amount: round2(netValue),
                vat_amount: round2(vatValue),
                ...(hasVat ? { vat_rate: parseFloat(rate) || 0 } : {}),
                other_taxes: round2(taxValue),
                total_amount: total,
                ...(notes.trim() ? { notes: notes.trim() } : {}),
            });
        } catch {
            // El manejo global de React Query ya informa el error.
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div>
                    Factura {type} <span className="font-mono">{invoice.invoice_number}</span> · {invoice.supplier_name}
                </div>
                <div className="mt-1">
                    Falta recibir: <span className="font-mono font-semibold">{formatMoney(pending)}</span>
                    <span className="text-muted-foreground">{discriminatesVat ? ' (neto, sin IVA)' : type === 'B' ? ' (con IVA)' : ''}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor={`${ids}-number`}>Número de la nota de crédito {type} *</Label>
                    <div className="relative">
                        <FileText className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            id={`${ids}-number`}
                            value={number}
                            onChange={(e) => setNumber(e.target.value)}
                            placeholder="Ej: 0001-00000123"
                            className="h-11 pl-9 lg:h-9"
                            maxLength={100}
                            required
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`${ids}-date`}>Fecha de emisión *</Label>
                    <ArgentinaDateInput id={`${ids}-date`} value={issueDate} onChange={setIssueDate} ariaLabel="Fecha de emisión" required />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div className="space-y-2">
                    <Label htmlFor={`${ids}-net`}>Neto *</Label>
                    <Input
                        id={`${ids}-net`}
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={net}
                        onChange={(e) => changeNet(e.target.value)}
                        className="h-11 font-mono lg:h-9"
                        required
                    />
                </div>
                {hasVat ? (
                    <>
                        <div className="space-y-2">
                            <Label htmlFor={`${ids}-rate`}>Alícuota</Label>
                            <Select value={rate} onValueChange={changeRate}>
                                <SelectTrigger id={`${ids}-rate`} className="h-11 lg:h-9">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {VAT_RATE_OPTIONS.map((option) => (
                                        <SelectItem key={option} value={String(option)}>{formatVatRate(option)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`${ids}-vat`}>IVA</Label>
                            <Input
                                id={`${ids}-vat`}
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={vat}
                                onChange={(e) => setVat(e.target.value)}
                                className="h-11 font-mono lg:h-9"
                            />
                        </div>
                    </>
                ) : null}
                <div className="space-y-2">
                    <Label htmlFor={`${ids}-taxes`}>Percepciones</Label>
                    <Input
                        id={`${ids}-taxes`}
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={otherTaxes}
                        onChange={(e) => setOtherTaxes(e.target.value)}
                        placeholder="0.00"
                        className="h-11 font-mono lg:h-9"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor={`${ids}-notes`}>Notas</Label>
                <Input id={`${ids}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="h-11 lg:h-9" />
            </div>

            <div className="space-y-1 rounded-md border p-3 text-sm" aria-live="polite">
                <div className="flex items-center justify-between font-semibold">
                    <span>Total de la nota (baja la deuda)</span>
                    <span className="font-mono">{formatMoney(total)}</span>
                </div>
                {netValue > 0 ? (
                    <p className="text-xs text-muted-foreground">
                        Salda {formatMoney(applied)} de lo que falta recibir.
                        {extra > 0 ? ` Los ${formatMoney(extra)} de más quedan como ganancia por mejor precio.` : ''}
                        {left > 0 ? ` Quedan ${formatMoney(left)} por recibir en otra nota.` : ''}
                    </p>
                ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="h-11 lg:h-9">
                    Cancelar
                </Button>
                <Button type="submit" disabled={submitting} className="h-11 lg:h-9">
                    {submitting ? 'Guardando...' : 'Registrar nota de crédito'}
                </Button>
            </div>
        </form>
    );
}
