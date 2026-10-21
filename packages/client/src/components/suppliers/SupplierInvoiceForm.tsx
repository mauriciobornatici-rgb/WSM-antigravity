import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArgentinaDateInput } from '@/components/common/ArgentinaDateInput';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, DollarSign, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api, type SupplierInvoiceCreateResult } from '@/services/api';
import { formatMoney } from '@/lib/formatters';
import { invoiceLines, netByRate, receptionPendingNet, sharedPurchaseOrderId, type InvoiceLineEdit, type InvoiceLineSource } from './receptionTotals';
import { SupplierInvoiceLines } from './SupplierInvoiceLines';
import { createClientUuid } from '@/lib/clientUuid';
import { VAT_RATE_OPTIONS, formatVatRate } from '@/lib/pricing';
import { Switch } from '@/components/ui/switch';
import type { Supplier } from '@/types';

export type SupplierInvoicePayload = {
    invoice_number: string;
    invoice_type: 'A' | 'B' | 'C' | 'M';
    supplier_id: string;
    reception_ids?: string[];
    purchase_order_id?: string;
    issue_date: string;
    due_date?: string;
    net_amount: number;
    vat_amount: number;
    // ADR-016: the fiscal credit goes to the account of this rate (single rate; omitted with vat_lines).
    vat_rate?: number;
    // One line per rate when the voucher carries several; net/VAT above are their sums.
    vat_lines?: Array<{ vat_rate: number; net_amount: number; vat_amount: number }>;
    // ADR-028: units and net unit cost the invoice charges per delivery note line.
    items?: Array<{ reception_item_id: string; quantity: number; unit_cost: number }>;
    purchase_kind?: 'goods' | 'shipping' | 'expense';
    other_taxes: number;
    total_amount: number;
    notes?: string;
};

type SupplierReceptionOption = {
    id: string;
    reception_number: string;
    remito_number?: string;
    created_at?: string;
    status: string;
    purchase_order_id?: string;
    supplier_invoice_id?: string | null;
    // ADR-027: its purchase order was invoiced without naming its delivery notes (before ADR-019).
    invoiced_by_order?: number | boolean | null;
    // ADR-028: how much of it is left to invoice.
    invoice_status?: 'pending' | 'partial' | 'invoiced' | 'returned';
    items?: InvoiceLineSource[];
};

type SupplierPurchaseOrderOption = {
    id: string;
    po_number: string;
    total_amount: number;
    subtotal?: number;
    tax_amount?: number;
};

type SupplierInvoiceType = SupplierInvoicePayload['invoice_type'];
type PurchaseKind = NonNullable<SupplierInvoicePayload['purchase_kind']>;

const PURCHASE_KINDS: Array<{ value: PurchaseKind; label: string }> = [
    { value: 'goods', label: 'Mercadería' },
    { value: 'shipping', label: 'Fletes y envíos' },
    { value: 'expense', label: 'Otros gastos' },
];

type VatLineState = { id: string; rate: string; net: string; vat: string };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function computeLineVat(net: string, rate: string): string {
    const netNumber = parseFloat(net);
    const rateNumber = parseFloat(rate);
    if (isNaN(netNumber) || isNaN(rateNumber)) return '';
    return String(round2(netNumber * rateNumber / 100));
}

function newVatLine(rate = '21', net = ''): VatLineState {
    return { id: createClientUuid(), rate, net, vat: computeLineVat(net, rate) };
}

interface SupplierInvoiceFormProps {
    suppliers: Supplier[];
    initialSupplierId?: string;
    initialOrderId?: string;
    initialReceptionId?: string;
    onSubmit: (data: SupplierInvoicePayload) => Promise<SupplierInvoiceCreateResult | void>;
    onCancel: () => void;
}

export function SupplierInvoiceForm({
    suppliers,
    initialSupplierId = '',
    initialOrderId = '',
    initialReceptionId = '',
    onSubmit,
    onCancel
}: SupplierInvoiceFormProps) {
    const [supplierId, setSupplierId] = useState(initialSupplierId);
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [invoiceType, setInvoiceType] = useState<'A' | 'B' | 'C' | 'M'>('A');
    const [receptionIds, setReceptionIds] = useState<string[]>(initialReceptionId ? [initialReceptionId] : []);
    const [purchaseOrderId, setPurchaseOrderId] = useState(initialOrderId);
    const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
    const [dueDate, setDueDate] = useState('');
    
    const [netAmount, setNetAmount] = useState('');
    const [vatRate, setVatRate] = useState('0.2100');
    const [vatAmount, setVatAmount] = useState('');
    const [otherTaxes, setOtherTaxes] = useState('');
    const [notes, setNotes] = useState('');
    const [purchaseKind, setPurchaseKind] = useState<PurchaseKind>('goods');
    const [multiRate, setMultiRate] = useState(false);
    const [vatLines, setVatLines] = useState<VatLineState[]>([]);
    const [submitting, setSubmitting] = useState(false);
    // ADR-028: what the user typed per delivery note line, and a VAT typed per rate (the supplier's rounding).
    const [lineEdits, setLineEdits] = useState<Record<string, InvoiceLineEdit>>({});
    const [vatEdits, setVatEdits] = useState<Record<string, string>>({});

    // Dynamic dropdown states
    const [receptions, setReceptions] = useState<SupplierReceptionOption[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<SupplierPurchaseOrderOption[]>([]);
    const [loadingDropdowns, setLoadingDropdowns] = useState(false);

    // Fetch receptions and purchase orders when supplier is selected
    useEffect(() => {
        if (!supplierId) {
            setReceptions([]);
            setPurchaseOrders([]);
            return;
        }

        const fetchSupplierDocs = async () => {
            setLoadingDropdowns(true);
            try {
                const [recs, pos] = await Promise.all([
                    api.getReceptions({ supplier_id: supplierId }) as Promise<SupplierReceptionOption[]>,
                    api.getPurchaseOrders({ supplier_id: supplierId }) as Promise<SupplierPurchaseOrderOption[]>
                ]);
                // ADR-028: a delivery note invoiced in part still has units to invoice.
                const available = recs.filter(r => r.status === 'approved'
                    && (r.invoice_status ? r.invoice_status === 'pending' || r.invoice_status === 'partial' : !r.supplier_invoice_id));
                setReceptions(available);
                setPurchaseOrders(pos);
                // A reception handed in by the caller starts marked (and prefills the amounts).
                if (initialReceptionId && available.some(r => r.id === initialReceptionId)) {
                    applyReceptionSelection([initialReceptionId], available);
                }
            } catch (err) {
                console.error("Error al cargar comprobantes del proveedor:", err);
            } finally {
                setLoadingDropdowns(false);
            }
        };

        void fetchSupplierDocs();
        // Only a supplier change reloads; the initial remito prefill must not re-run on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [supplierId]);

    // Marking remitos brings their pending lines (ADR-028): the net and VAT come from them.
    const applyReceptionSelection = (ids: string[], source: SupplierReceptionOption[]) => {
        setReceptionIds(ids);
        setVatEdits({});
        const selected = source.filter(r => ids.includes(r.id));
        // When every marked remito comes from the same PO, link it as well
        const sharedPo = sharedPurchaseOrderId(selected);
        if (sharedPo) setPurchaseOrderId(sharedPo);
    };

    const updateInvoiceLine = (lineId: string, patch: { quantity?: string; unitCost?: string }) => {
        setLineEdits(current => {
            const line = lines.find(item => item.id === lineId);
            const previous = current[lineId] ?? { quantity: line?.quantity ?? '', unitCost: line?.unitCost ?? '' };
            return { ...current, [lineId]: { ...previous, ...patch } };
        });
        // A VAT typed for the old net no longer applies.
        setVatEdits({});
    };

    const toggleReception = (id: string, checked: boolean) => {
        const next = checked ? [...receptionIds.filter(item => item !== id), id] : receptionIds.filter(item => item !== id);
        applyReceptionSelection(next, receptions);
    };

    // Auto-prefill from purchase order
    const handlePOChange = (value: string) => {
        const poId = value === 'none' ? '' : value;
        setPurchaseOrderId(poId);
        if (!poId || receptionIds.length > 0) return; // If remitos are marked, they take priority

        const selectedPo = purchaseOrders.find(p => p.id === poId);
        if (selectedPo) {
            const netPrefill = Math.round(Number(selectedPo.subtotal || 0) * 100) / 100;
            setNetAmount(String(netPrefill));
            const vatPrefill = Math.round(Number(selectedPo.tax_amount || (netPrefill * 0.21)) * 100) / 100;
            setVatAmount(String(vatPrefill));
            if (multiRate) setVatLines([newVatLine('21', String(netPrefill))]);
        }
    };

    // A voucher tied to a reception or purchase order is always goods.
    const linkedToDocument = receptionIds.length > 0 || Boolean(purchaseOrderId);
    const effectivePurchaseKind: PurchaseKind = linkedToDocument ? 'goods' : purchaseKind;

    const handleMultiRateChange = (enabled: boolean) => {
        setMultiRate(enabled);
        if (enabled && vatLines.length === 0) {
            const singleRate = String(Math.round((parseFloat(vatRate) || 0) * 1000) / 10);
            setVatLines([newVatLine(singleRate, netAmount)]);
        }
    };

    const updateVatLine = (id: string, patch: Partial<Pick<VatLineState, 'rate' | 'net'>> & { vat?: string }) => {
        setVatLines(current => current.map(line => {
            if (line.id !== id) return line;
            const next = { ...line, ...patch };
            // Net or rate changes recalculate the VAT; typing the VAT directly keeps it.
            if (patch.vat === undefined) next.vat = computeLineVat(next.net, next.rate);
            return next;
        }));
    };

    // Auto-calculate VAT when net or rate changes
    useEffect(() => {
        const net = parseFloat(netAmount);
        const rate = parseFloat(vatRate);
        if (!isNaN(net) && !isNaN(rate)) {
            const computedVat = Math.round((net * rate) * 100) / 100;
            setVatAmount(String(computedVat));
        } else {
            setVatAmount('');
        }
    }, [netAmount, vatRate]);

    // ADR-028: goods are invoiced per delivery note line; the net of each rate is the sum of its lines
    // (the product's rate) and its VAT is calculated, or typed when the supplier rounded it otherwise.
    const selectedReceptions = receptions.filter(r => receptionIds.includes(r.id));
    const lines = invoiceLines(selectedReceptions, lineEdits);
    const linesMode = effectivePurchaseKind === 'goods' && lines.length > 0;
    const rateRows = netByRate(lines).map(({ rate, netCents }) => {
        const computed = round2(netCents / 100 * rate / 100);
        const vat = vatEdits[String(rate)] ?? String(computed);
        return { rate, net: netCents / 100, vat };
    });
    const invoicedLines = lines.filter(line => line.units > 0);
    const linesDifference = round2(invoicedLines.reduce((sum, line) => sum + line.netCents - line.remitoCents, 0) / 100);

    // With several rates the voucher's net and VAT are the sums of the lines.
    let netVal = parseFloat(netAmount) || 0;
    let vatVal = parseFloat(vatAmount) || 0;
    if (linesMode) {
        netVal = round2(rateRows.reduce((sum, row) => sum + row.net, 0));
        vatVal = round2(rateRows.reduce((sum, row) => sum + (parseFloat(row.vat) || 0), 0));
    } else if (multiRate) {
        netVal = round2(vatLines.reduce((sum, line) => sum + (parseFloat(line.net) || 0), 0));
        vatVal = round2(vatLines.reduce((sum, line) => sum + (parseFloat(line.vat) || 0), 0));
    }
    // The net and VAT fields only show sums when they come from lines or rates.
    const derivedAmounts = linesMode || multiRate;
    const taxVal = parseFloat(otherTaxes) || 0;
    const totalAmount = Math.round((netVal + vatVal + taxVal) * 100) / 100;
    // ADR-027 (D2): goods are invoiced against their delivery notes (the stock came in with them).
    const goodsWithoutReception = effectivePurchaseKind === 'goods' && receptionIds.length === 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!supplierId) {
            toast.error("Debe seleccionar un proveedor");
            return;
        }
        if (!invoiceNumber.trim()) {
            toast.error("Debe ingresar el número de factura");
            return;
        }
        if (linesMode) {
            const invalid = lines.find(line => !line.valid);
            if (invalid) {
                toast.error(`Revisá ${invalid.productName}`, {
                    description: `Las unidades van enteras, de 0 a ${invalid.pending} (lo pendiente del remito), y el costo no puede ser negativo.`,
                });
                return;
            }
            if (invoicedLines.length === 0) {
                toast.error("Indicá al menos una línea con unidades facturadas");
                return;
            }
        }
        if (netVal <= 0) {
            toast.error("El Neto Gravado debe ser mayor a 0");
            return;
        }
        if (goodsWithoutReception) {
            toast.error("Elegí el remito de la mercadería", {
                description: purchaseOrderId
                    ? "Una factura de mercadería se carga contra su remito. Si es un flete o un gasto, desvinculá la orden de compra y cambiá el tipo de compra."
                    : "Una factura de mercadería se carga contra su remito. Si es un flete o un gasto, cambiá el tipo de compra.",
            });
            return;
        }

        if (multiRate && vatLines.some(line => !(parseFloat(line.net) > 0))) {
            toast.error("Cada alícuota debe tener un neto mayor a 0");
            return;
        }

        setSubmitting(true);
        try {
            const payload: SupplierInvoicePayload = {
                invoice_number: invoiceNumber.trim(),
                invoice_type: invoiceType,
                supplier_id: supplierId,
                issue_date: issueDate,
                net_amount: netVal,
                vat_amount: vatVal,
                purchase_kind: effectivePurchaseKind,
                other_taxes: taxVal,
                total_amount: totalAmount,
            };
            if (linesMode) {
                payload.items = invoicedLines.map(line => ({ reception_item_id: line.id, quantity: line.units, unit_cost: line.cost }));
                if (rateRows.length === 1) {
                    payload.vat_rate = rateRows[0]?.rate ?? 21;
                } else {
                    payload.vat_lines = rateRows.map(row => ({
                        vat_rate: row.rate,
                        net_amount: round2(row.net),
                        vat_amount: round2(parseFloat(row.vat) || 0),
                    }));
                }
            } else if (multiRate) {
                payload.vat_lines = vatLines.map(line => ({
                    vat_rate: parseFloat(line.rate) || 0,
                    net_amount: round2(parseFloat(line.net) || 0),
                    vat_amount: round2(parseFloat(line.vat) || 0),
                }));
            } else {
                payload.vat_rate = Math.round((parseFloat(vatRate) || 0) * 1000) / 10;
            }
            if (receptionIds.length > 0) payload.reception_ids = receptionIds;
            if (purchaseOrderId) payload.purchase_order_id = purchaseOrderId;
            if (dueDate) payload.due_date = dueDate;
            if (notes.trim()) payload.notes = notes.trim();
            const result = await onSubmit(payload);
            const difference = Number(result?.receptions_difference || 0);
            if (difference !== 0) {
                toast.info(`La factura difiere de lo recibido en ${formatMoney(Math.abs(difference))}`, {
                    description: difference > 0 ? 'El neto facturado es mayor al recibido en los remitos.' : 'El neto facturado es menor al recibido en los remitos.',
                });
            }
            const updates = result?.cost_updates ?? [];
            if (updates.length > 0) {
                const repriced = updates.filter(update => update.new_sale_price != null).length;
                const shown = updates.slice(0, 3).map(update => `${update.name || 'Producto'}: ${formatMoney(update.old_cost)} → ${formatMoney(update.new_cost)}`
                    + (update.new_sale_price != null ? ` · precio neto ${formatMoney(update.new_sale_price)}` : ''));
                toast.info(
                    (updates.length === 1 ? 'Se actualizó el costo de 1 producto' : `Se actualizó el costo de ${updates.length} productos`)
                    + (repriced > 0 ? ` y el precio de venta de ${repriced}` : ''),
                    {
                        description: shown.join(' · ') + (updates.length > 3 ? ` · y ${updates.length - 3} más` : ''),
                        duration: 10000,
                    }
                );
            }
        } catch {
            // Handled by parent or API caller
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Supplier Selection */}
                <div className="space-y-2">
                    <Label htmlFor="supplier">Proveedor *</Label>
                    <Select value={supplierId} onValueChange={setSupplierId} disabled={!!initialSupplierId}>
                        <SelectTrigger id="supplier">
                            <SelectValue placeholder="Seleccione un proveedor" />
                        </SelectTrigger>
                        <SelectContent>
                            {suppliers.map(s => (
                                <SelectItem key={s.id} value={s.id}>{s.name} ({s.tax_id})</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Optional Reception Links (one or several remitos) */}
                <fieldset className="space-y-2" aria-describedby="receptions-help">
                    <legend className="text-sm font-medium leading-none">
                        Remitos a facturar {effectivePurchaseKind === 'goods' ? '*' : '(opcional)'}
                    </legend>
                    {!supplierId ? (
                        <p id="receptions-help" className="text-xs text-muted-foreground">Elegí un proveedor para ver sus remitos pendientes de factura.</p>
                    ) : loadingDropdowns ? (
                        <p id="receptions-help" className="text-xs text-muted-foreground">Cargando remitos...</p>
                    ) : receptions.length === 0 ? (
                        <p id="receptions-help" className="text-xs text-muted-foreground">
                            Este proveedor no tiene remitos aprobados sin facturar.
                            {effectivePurchaseKind === 'goods' ? ' Registrá primero la recepción de la mercadería (puede ser sin orden de compra).' : ''}
                        </p>
                    ) : (
                        <>
                            <p id="receptions-help" className="text-xs text-muted-foreground">Podés marcar uno o varios remitos del mismo proveedor.</p>
                            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
                                {receptions.map(r => (
                                    <div key={r.id} className="flex min-h-11 items-center gap-3 rounded px-2 hover:bg-muted/50">
                                        <input
                                            id={`reception-${r.id}`}
                                            type="checkbox"
                                            checked={receptionIds.includes(r.id)}
                                            onChange={e => toggleReception(r.id, e.target.checked)}
                                            className="h-4 w-4 shrink-0 cursor-pointer rounded accent-primary"
                                        />
                                        <Label htmlFor={`reception-${r.id}`} className="flex flex-1 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-0.5 font-normal">
                                            <span>
                                                Remito {r.remito_number || r.reception_number}
                                                {r.created_at ? <span className="text-muted-foreground"> · {new Date(r.created_at).toLocaleDateString('es-AR')}</span> : null}
                                                {r.invoice_status === 'partial' ? (
                                                    <span className="text-muted-foreground"> · facturado en parte</span>
                                                ) : null}
                                                {Number(r.invoiced_by_order) === 1 ? (
                                                    <span className="block text-xs text-amber-800 dark:text-amber-300">
                                                        Su orden de compra ya tiene una factura: elegilo solo si esa factura no lo incluyó.
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="font-mono text-xs">
                                                <span className="sr-only">Pendiente de facturar: </span>{formatMoney(receptionPendingNet(r))}
                                            </span>
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </fieldset>
            </div>

            {linesMode ? (
                <section className="space-y-2" aria-labelledby="invoice-lines-title">
                    <h4 id="invoice-lines-title" className="text-sm font-semibold">Qué cobra la factura</h4>
                    <SupplierInvoiceLines lines={lines} onChange={updateInvoiceLine} />
                    <div aria-live="polite">
                        {Math.abs(linesDifference) > 0.01 ? (
                            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
                                La factura cobra {formatMoney(Math.abs(linesDifference))} {linesDifference > 0 ? 'más' : 'menos'} que el costo de los remitos.
                                La diferencia corrige el costo de los productos que lo actualizan con cada compra; en los de costo fijo se anota como
                                {linesDifference > 0 ? ' pérdida' : ' ganancia'}.
                            </p>
                        ) : null}
                    </div>
                </section>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Optional Purchase Order Link */}
                <div className="space-y-2">
                    <Label htmlFor="po">Vincular a Orden de Compra (Opcional)</Label>
                    <Select 
                        value={purchaseOrderId} 
                        onValueChange={handlePOChange}
                        disabled={loadingDropdowns || !supplierId || !!initialOrderId}
                    >
                        <SelectTrigger id="po">
                            <SelectValue placeholder={loadingDropdowns ? "Cargando..." : "Ninguna"} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Ninguna</SelectItem>
                            {purchaseOrders.map(p => (
                                <SelectItem key={p.id} value={p.id}>{p.po_number} - ${Number(p.total_amount).toLocaleString()}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Invoice Type */}
                <div className="space-y-2">
                    <Label htmlFor="invoiceType">Tipo de Comprobante *</Label>
                    <Select value={invoiceType} onValueChange={(val) => setInvoiceType(val as SupplierInvoiceType)}>
                        <SelectTrigger id="invoiceType">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="A">Factura A</SelectItem>
                            <SelectItem value="B">Factura B</SelectItem>
                            <SelectItem value="C">Factura C</SelectItem>
                            <SelectItem value="M">Factura M</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Invoice Number */}
                <div className="space-y-2">
                    <Label htmlFor="invoiceNumber">Número de Factura *</Label>
                    <div className="relative">
                        <FileText className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            id="invoiceNumber"
                            value={invoiceNumber}
                            onChange={e => setInvoiceNumber(e.target.value)}
                            placeholder="Ej: 0001-00004321"
                            className="pl-9"
                            required
                        />
                    </div>
                </div>
            </div>

            {/* Purchase kind */}
            <div className="space-y-2">
                <Label htmlFor="purchaseKind">Tipo de compra</Label>
                <Select
                    value={effectivePurchaseKind}
                    onValueChange={(val) => setPurchaseKind(val as PurchaseKind)}
                    disabled={linkedToDocument}
                >
                    <SelectTrigger id="purchaseKind">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {PURCHASE_KINDS.map(kind => (
                            <SelectItem key={kind.value} value={kind.value}>{kind.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {linkedToDocument ? (
                    <p className="text-xs text-muted-foreground">
                        Un comprobante vinculado a una recepción u orden de compra es siempre mercadería.
                    </p>
                ) : null}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Issue Date */}
                <div className="space-y-2">
                    <Label htmlFor="issueDate">Fecha de Emisión *</Label>
                    <ArgentinaDateInput
                        id="issueDate"
                        value={issueDate}
                        onChange={setIssueDate}
                        ariaLabel="Fecha de emisión"
                        required
                    />
                </div>

                {/* Due Date */}
                <div className="space-y-2">
                    <Label htmlFor="dueDate">Fecha de Vencimiento (Opcional)</Label>
                    <ArgentinaDateInput
                        id="dueDate"
                        value={dueDate}
                        onChange={setDueDate}
                        ariaLabel="Fecha de vencimiento"
                    />
                </div>
            </div>

            {/* Financial Breakdown */}
            <div className="bg-slate-50 dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-4">
                <h4 className="text-sm font-semibold border-b pb-2">Desglose Impositivo y Financiero</h4>

                {linesMode ? (
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                            El neto sale de las líneas, por la alícuota de cada producto. Si el IVA de la factura difiere por redondeo, corregilo acá.
                        </p>
                        {rateRows.map(row => (
                            <div key={row.rate} className="grid grid-cols-1 gap-3 rounded-md border bg-background p-3 sm:grid-cols-3 sm:items-end">
                                <div className="text-sm">
                                    <span className="text-muted-foreground">Alícuota</span>{' '}
                                    <span className="font-medium">{formatVatRate(row.rate)}</span>
                                </div>
                                <div className="text-sm">
                                    <span className="text-muted-foreground">Neto</span>{' '}
                                    <span className="font-mono font-medium">{formatMoney(row.net)}</span>
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor={`rate-vat-${row.rate}`}>IVA {formatVatRate(row.rate)}</Label>
                                    <Input
                                        id={`rate-vat-${row.rate}`}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        inputMode="decimal"
                                        value={row.vat}
                                        onChange={e => setVatEdits(current => ({ ...current, [String(row.rate)]: e.target.value }))}
                                        className="font-mono"
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <Switch
                            checked={multiRate}
                            onChange={e => handleMultiRateChange(e.target.checked)}
                            aria-label="Varias alícuotas"
                        />
                        <span className="text-sm">Varias alícuotas</span>
                    </div>
                )}

                {multiRate && !linesMode ? (
                    <div className="space-y-3">
                        {vatLines.map((line, index) => (
                            <div key={line.id} className="grid grid-cols-1 gap-3 rounded-md border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                                <div className="space-y-2">
                                    <Label htmlFor={`vat-line-rate-${line.id}`}>Alícuota {index + 1}</Label>
                                    <Select value={line.rate} onValueChange={rate => updateVatLine(line.id, { rate })}>
                                        <SelectTrigger id={`vat-line-rate-${line.id}`}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {VAT_RATE_OPTIONS.map(rate => (
                                                <SelectItem key={rate} value={String(rate)}>{formatVatRate(rate)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor={`vat-line-net-${line.id}`}>Neto {index + 1}</Label>
                                    <Input
                                        id={`vat-line-net-${line.id}`}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={line.net}
                                        onChange={e => updateVatLine(line.id, { net: e.target.value })}
                                        placeholder="0.00"
                                        className="font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor={`vat-line-vat-${line.id}`}>IVA {index + 1}</Label>
                                    <Input
                                        id={`vat-line-vat-${line.id}`}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={line.vat}
                                        onChange={e => updateVatLine(line.id, { vat: e.target.value })}
                                        placeholder="0.00"
                                        className="font-mono"
                                    />
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-11 w-11"
                                    aria-label={`Quitar alícuota ${index + 1}`}
                                    disabled={vatLines.length === 1}
                                    onClick={() => setVatLines(current => current.filter(item => item.id !== line.id))}
                                >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                            </div>
                        ))}
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setVatLines(current => [...current, newVatLine('10.5')])}
                        >
                            <Plus className="mr-1 h-3.5 w-3.5" /> Agregar alícuota
                        </Button>
                    </div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Net Amount */}
                    <div className="space-y-2">
                        <Label htmlFor="netAmount">Neto Gravado *</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="netAmount"
                                type="number"
                                step="0.01"
                                min="0"
                                value={derivedAmounts ? String(netVal) : netAmount}
                                onChange={e => setNetAmount(e.target.value)}
                                placeholder="0.00"
                                className="pl-9 font-mono"
                                readOnly={derivedAmounts}
                                required={!derivedAmounts}
                            />
                        </div>
                    </div>

                    {/* VAT Rate (with lines, each product brings its own: see above) */}
                    <div className={linesMode ? 'hidden' : 'space-y-2'}>
                        <Label htmlFor="vatRate">Alícuota IVA</Label>
                        <Select value={vatRate} onValueChange={setVatRate} disabled={derivedAmounts}>
                            <SelectTrigger id="vatRate">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="0.2100">21%</SelectItem>
                                <SelectItem value="0.1050">10.5%</SelectItem>
                                <SelectItem value="0.2700">27%</SelectItem>
                                <SelectItem value="0.0000">Exento / 0%</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* VAT Amount (calculated but editable) */}
                    <div className="space-y-2">
                        <Label htmlFor="vatAmount">Monto IVA</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="vatAmount"
                                type="number"
                                step="0.01"
                                min="0"
                                value={derivedAmounts ? String(vatVal) : vatAmount}
                                onChange={e => setVatAmount(e.target.value)}
                                placeholder="0.00"
                                className="pl-9 font-mono"
                                readOnly={derivedAmounts}
                            />
                        </div>
                    </div>

                    {/* Other taxes (percepciones) */}
                    <div className="space-y-2">
                        <Label htmlFor="otherTaxes">Percepciones / Otros</Label>
                        <div className="relative">
                            <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="otherTaxes"
                                type="number"
                                step="0.01"
                                min="0"
                                value={otherTaxes}
                                onChange={e => setOtherTaxes(e.target.value)}
                                placeholder="0.00"
                                className="pl-9 font-mono"
                            />
                        </div>
                    </div>
                </div>

                <div className="flex justify-between items-center border-t pt-3 mt-4 text-sm font-semibold">
                    <span className="text-muted-foreground">Total de Comprobante (Deuda):</span>
                    <span className="text-2xl font-extrabold text-blue-600 font-mono">${totalAmount.toLocaleString()}</span>
                </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
                <Label htmlFor="notes">Notas / Observaciones</Label>
                <Input
                    id="notes"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Ej: Facturación correspondiente al lote de calzado ingresado el 25/05..."
                />
            </div>

            {/* Form Actions */}
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={submitting || totalAmount <= 0} className="bg-blue-600 hover:bg-blue-700 text-white font-medium">
                    {submitting ? 'Guardando...' : 'Cargar y Registrar Factura'}
                </Button>
            </div>
        </form>
    );
}
