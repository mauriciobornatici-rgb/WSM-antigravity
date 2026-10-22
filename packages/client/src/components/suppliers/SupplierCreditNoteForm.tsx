import { useId, useState } from 'react';
import { AlertCircle, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArgentinaDateInput } from '@/components/common/ArgentinaDateInput';
import { todayInArgentina } from '@/lib/argentinaDate';
import { formatMoney } from '@/lib/formatters';
import { VAT_RATE_OPTIONS, formatVatRate } from '@/lib/pricing';
import type { SupplierCreditNoteCreateInput, SupplierInvoiceResponse } from '@/services/api';
import { creditPending, round2 } from './supplierCredit';

interface SupplierCreditNoteFormProps {
    invoice: SupplierInvoiceResponse;
    onSubmit: (data: SupplierCreditNoteCreateInput) => Promise<void>;
    onCancel: () => void;
}

type FieldErrors = Partial<Record<'number' | 'net' | 'vat' | 'taxes' | 'excess', string>>;

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
    const [issueDate, setIssueDate] = useState(() => todayInArgentina());
    const [net, setNet] = useState(String(initialNet));
    const [rate, setRate] = useState('21');
    const [vat, setVat] = useState(hasVat ? String(type === 'B' ? round2(pending - initialNet) : round2(initialNet * 0.21)) : '0');
    const [otherTaxes, setOtherTaxes] = useState('');
    const [notes, setNotes] = useState('');
    // The note is worth more than what is left to receive: the user confirms the difference.
    const [acceptExcess, setAcceptExcess] = useState(false);
    const [errors, setErrors] = useState<FieldErrors>({});
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
    const netLabel = type === 'C' ? 'Importe *' : 'Neto (sin IVA) *';

    const fieldId = (field: keyof FieldErrors) => `${ids}-${field}`;
    const errorId = (field: keyof FieldErrors) => `${ids}-${field}-error`;
    const errorProps = (field: keyof FieldErrors, hintId?: string) => ({
        'aria-invalid': Boolean(errors[field]),
        'aria-describedby': [hintId, errors[field] ? errorId(field) : ''].filter(Boolean).join(' ') || undefined,
    });
    const fieldError = (field: keyof FieldErrors) => (errors[field] ? (
        <p id={errorId(field)} role="alert" className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> {errors[field]}
        </p>
    ) : null);
    const clearError = (field: keyof FieldErrors) => setErrors((current) => {
        if (!current[field]) return current;
        const next = { ...current };
        delete next[field];
        return next;
    });

    const changeNet = (value: string) => {
        setNet(value);
        clearError('net');
        const parsed = parseFloat(value);
        if (hasVat && !Number.isNaN(parsed)) setVat(String(round2(parsed * (parseFloat(rate) || 0) / 100)));
    };
    const changeRate = (value: string) => {
        setRate(value);
        const newRate = parseFloat(value) || 0;
        if (type === 'B') {
            // A note B shows its total: the rate splits that same total into net and VAT.
            const gross = round2(netValue + vatValue);
            const newNet = round2(gross / (1 + newRate / 100));
            setNet(String(newNet));
            setVat(String(round2(gross - newNet)));
            return;
        }
        if (hasVat) setVat(String(round2(netValue * newRate / 100)));
    };

    const validate = (): FieldErrors => {
        const found: FieldErrors = {};
        if (number.trim().length < 2) found.number = 'Ingresá el número de la nota de crédito';
        if (!(netValue > 0)) found.net = type === 'C' ? 'El importe tiene que ser mayor a 0' : 'El neto tiene que ser mayor a 0';
        if (hasVat && (parseFloat(vat) || 0) < 0) found.vat = 'El IVA no puede ser negativo';
        if (taxValue < 0) found.taxes = 'Las percepciones no pueden ser negativas';
        if (extra > 0 && !acceptExcess) found.excess = 'Confirmá la diferencia o corregí el importe';
        return found;
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const found = validate();
        setErrors(found);
        const first = (['number', 'net', 'vat', 'taxes', 'excess'] as const).find((field) => found[field]);
        if (first) {
            document.getElementById(fieldId(first))?.focus();
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
                ...(extra > 0 ? { accept_excess: acceptExcess } : {}),
            });
        } catch {
            // El manejo global de React Query ya informa el error.
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div>
                    Factura {type} <span className="font-mono">{invoice.invoice_number}</span> · {invoice.supplier_name}
                </div>
                <div className="mt-1">
                    Nota de crédito a recibir de esta factura: <span className="font-mono font-semibold">{formatMoney(pending)}</span>
                    <span className="text-muted-foreground">{discriminatesVat ? ' (neto, sin IVA)' : type === 'B' ? ' (con IVA)' : ''}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor={fieldId('number')}>Número de la nota de crédito {type} *</Label>
                    <div className="relative">
                        <FileText className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <Input
                            id={fieldId('number')}
                            value={number}
                            onChange={(e) => { setNumber(e.target.value); clearError('number'); }}
                            placeholder="Ej: 0001-00000123"
                            className={`h-11 pl-9 lg:h-9 ${errors.number ? 'border-destructive' : ''}`}
                            maxLength={100}
                            {...errorProps('number')}
                        />
                    </div>
                    {fieldError('number')}
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`${ids}-date`}>Fecha de emisión *</Label>
                    <ArgentinaDateInput id={`${ids}-date`} value={issueDate} onChange={setIssueDate} ariaLabel="Fecha de emisión" required />
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div className="space-y-2">
                    <Label htmlFor={fieldId('net')}>{netLabel}</Label>
                    <Input
                        id={fieldId('net')}
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={net}
                        onChange={(e) => changeNet(e.target.value)}
                        className={`h-11 font-mono lg:h-9 ${errors.net ? 'border-destructive' : ''}`}
                        {...errorProps('net', hasVat ? `${ids}-vat-hint` : undefined)}
                    />
                    {fieldError('net')}
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
                            <Label htmlFor={fieldId('vat')}>IVA</Label>
                            <Input
                                id={fieldId('vat')}
                                type="number"
                                step="0.01"
                                min="0"
                                inputMode="decimal"
                                value={vat}
                                onChange={(e) => { setVat(e.target.value); clearError('vat'); }}
                                className={`h-11 font-mono lg:h-9 ${errors.vat ? 'border-destructive' : ''}`}
                                {...errorProps('vat', `${ids}-vat-hint`)}
                            />
                            {fieldError('vat')}
                        </div>
                    </>
                ) : null}
                <div className="space-y-2">
                    <Label htmlFor={fieldId('taxes')}>Percepciones</Label>
                    <Input
                        id={fieldId('taxes')}
                        type="number"
                        step="0.01"
                        min="0"
                        inputMode="decimal"
                        value={otherTaxes}
                        onChange={(e) => { setOtherTaxes(e.target.value); clearError('taxes'); }}
                        placeholder="0,00"
                        className={`h-11 font-mono lg:h-9 ${errors.taxes ? 'border-destructive' : ''}`}
                        {...errorProps('taxes')}
                    />
                    {fieldError('taxes')}
                </div>
            </div>
            {hasVat ? (
                <p id={`${ids}-vat-hint`} className="-mt-2 text-xs text-muted-foreground">
                    El IVA se recalcula al cambiar el neto o la alícuota; si la nota trae otro por redondeo, corregilo.
                </p>
            ) : null}

            <div className="space-y-2">
                <Label htmlFor={`${ids}-notes`}>Notas</Label>
                <Input id={`${ids}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className="h-11 lg:h-9" />
            </div>

            <div className="space-y-1 rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between font-semibold">
                    <span>Total de la nota (baja la deuda)</span>
                    <span className="font-mono">{formatMoney(total)}</span>
                </div>
                <p role="status" className="text-xs text-muted-foreground">
                    {netValue > 0
                        ? `Salda ${formatMoney(applied)} de lo que falta recibir.${left > 0 ? ` Quedan ${formatMoney(left)} por recibir en otra nota.` : ''}`
                        : ''}
                </p>
                {extra > 0 ? (
                    <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                        <p id={`${ids}-excess-help`}>
                            Esta nota es {formatMoney(extra)} mayor que lo que falta recibir. Esa diferencia se registra a favor, como mejor
                            precio de la compra. Revisá el importe antes de guardar.
                        </p>
                        <div className="flex min-h-11 items-center gap-2 lg:min-h-0">
                            <input
                                id={fieldId('excess')}
                                type="checkbox"
                                checked={acceptExcess}
                                onChange={(e) => { setAcceptExcess(e.target.checked); clearError('excess'); }}
                                className="h-4 w-4 shrink-0 cursor-pointer rounded accent-primary"
                                {...errorProps('excess', `${ids}-excess-help`)}
                            />
                            <Label htmlFor={fieldId('excess')} className="cursor-pointer text-xs font-medium">
                                Confirmo el importe: la diferencia es un mejor precio
                            </Label>
                        </div>
                        {fieldError('excess')}
                    </div>
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
