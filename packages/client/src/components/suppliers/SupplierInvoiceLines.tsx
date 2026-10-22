import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/formatters';
import { invoiceLineCostId, invoiceLineQuantityId, type InvoiceLineView } from './receptionTotals';

interface SupplierInvoiceLinesProps {
    lines: InvoiceLineView[];
    onChange: (lineId: string, patch: { quantity?: string; unitCost?: string }) => void;
    // Every line at all it has pending, or none (to mark only a few by hand).
    onSetAll: (mode: 'pending' | 'none') => void;
    // ADR-029: the supplier will send a credit note, so a line may charge more than is pending.
    allowExcess?: boolean;
}

/**
 * ADR-028: what the invoice charges of each delivery note line. The units left out stay to invoice
 * (another invoice, or a return); a cost other than the delivery note's corrects the product's cost.
 */
export function SupplierInvoiceLines({ lines, onChange, onSetAll, allowExcess = false }: SupplierInvoiceLinesProps) {
    const pendingUnits = lines.reduce((sum, line) => sum + line.pending, 0);
    const invoicedUnits = lines.reduce((sum, line) => sum + line.units - line.excess, 0);
    const excessUnits = lines.reduce((sum, line) => sum + line.excess, 0);
    const netCents = lines.reduce((sum, line) => sum + line.netCents, 0);

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p id="invoice-lines-help" className="text-xs text-muted-foreground">
                    Indicá cuántas unidades de cada remito cobra esta factura y a qué costo neto. Lo que no se facture ahora
                    queda pendiente para otra factura.
                </p>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-11 lg:h-9" onClick={() => onSetAll('pending')}>Todo lo pendiente</Button>
                    <Button type="button" variant="outline" size="sm" className="h-11 lg:h-9" onClick={() => onSetAll('none')}>Ninguna</Button>
                </div>
            </div>
            <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[600px] text-sm" aria-describedby="invoice-lines-help">
                    <caption className="sr-only">Líneas de los remitos a facturar</caption>
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                        <tr>
                            <th scope="col" className="px-2 py-2 text-left font-semibold">Producto</th>
                            <th scope="col" className="px-2 py-2 text-right font-semibold">Pendiente</th>
                            <th scope="col" className="px-2 py-2 text-center font-semibold">Unidades facturadas</th>
                            <th scope="col" className="px-2 py-2 text-center font-semibold">Costo neto unitario</th>
                            <th scope="col" className="px-2 py-2 text-right font-semibold">Subtotal neto</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y">
                        {lines.map((line) => {
                            const name = `${line.productName} (remito ${line.receptionLabel})`;
                            const pendingId = `invoice-line-pending-${line.id}`;
                            const quantityErrorId = `invoice-line-qty-error-${line.id}`;
                            const costHintId = `invoice-line-cost-hint-${line.id}`;
                            const costErrorId = `invoice-line-cost-error-${line.id}`;
                            const excessId = `invoice-line-excess-${line.id}`;
                            const quantityDescription = [pendingId, line.quantityValid ? '' : quantityErrorId, line.excess > 0 ? excessId : '']
                                .filter(Boolean).join(' ');
                            const unitDifference = Math.round((line.cost - line.remitoCost) * 100) / 100;
                            return (
                                <tr key={line.id} className={line.valid ? undefined : 'bg-destructive/5'}>
                                    <td className="px-2 py-2">
                                        <div className="font-medium">{line.productName}</div>
                                        <div className="text-xs text-muted-foreground">
                                            Remito {line.receptionLabel}{line.sku ? ` · ${line.sku}` : ''}
                                        </div>
                                    </td>
                                    <td id={pendingId} className="px-2 py-2 text-right font-mono">
                                        <span className="sr-only">Pendiente: </span>{line.pending}
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                        <Input
                                            id={invoiceLineQuantityId(line.id)}
                                            type="number"
                                            min="0"
                                            max={allowExcess ? undefined : line.pending}
                                            step="1"
                                            inputMode="numeric"
                                            aria-label={`Unidades facturadas de ${name}`}
                                            aria-describedby={quantityDescription}
                                            aria-invalid={!line.quantityValid}
                                            className={`mx-auto h-11 w-24 text-center lg:h-9 ${line.quantityValid ? '' : 'border-destructive'}`}
                                            value={line.quantity}
                                            onChange={(event) => onChange(line.id, { quantity: event.target.value })}
                                        />
                                        {line.quantityValid ? null : (
                                            <p id={quantityErrorId} role="alert" className="mt-1 flex items-center justify-center gap-1 text-xs text-destructive">
                                                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                                {allowExcess ? 'Un número entero, 0 o más' : `Entero de 0 a ${line.pending}`}
                                            </p>
                                        )}
                                        {line.excess > 0 ? (
                                            <p id={excessId} className="mt-1 text-center text-xs font-medium text-amber-800 dark:text-amber-300">
                                                {line.excess === 1 ? '1 u. de más' : `${line.excess} u. de más`}: nota de crédito a recibir
                                            </p>
                                        ) : null}
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                        <Input
                                            id={invoiceLineCostId(line.id)}
                                            type="number"
                                            min="0"
                                            step="0.0001"
                                            inputMode="decimal"
                                            aria-label={`Costo neto unitario de ${name}`}
                                            aria-describedby={line.costValid ? costHintId : `${costHintId} ${costErrorId}`}
                                            aria-invalid={!line.costValid}
                                            className={`mx-auto h-11 w-32 text-center lg:h-9 ${line.costValid ? '' : 'border-destructive'}`}
                                            value={line.unitCost}
                                            onChange={(event) => onChange(line.id, { unitCost: event.target.value })}
                                        />
                                        <p id={costHintId} className="mt-0.5 text-center text-xs text-muted-foreground">
                                            En el remito: {formatMoney(line.remitoCost)}
                                            {line.costValid && unitDifference !== 0 ? (
                                                <span className="block font-medium text-amber-800 dark:text-amber-300">
                                                    Difiere del remito ({unitDifference > 0 ? '+' : '−'}{formatMoney(Math.abs(unitDifference))} por unidad)
                                                </span>
                                            ) : null}
                                        </p>
                                        {line.costValid ? null : (
                                            <p id={costErrorId} role="alert" className="mt-1 flex items-center justify-center gap-1 text-xs text-destructive">
                                                <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> Cargá un costo de 0 o más
                                            </p>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-right font-mono">{formatMoney(line.netCents / 100)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="border-t bg-muted/30">
                            <th scope="row" colSpan={4} className="px-2 py-2 text-right font-semibold">Neto de las líneas</th>
                            <td className="px-2 py-2 text-right font-mono font-semibold">{formatMoney(netCents / 100)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
                {pendingUnits > 0
                    ? `Facturás ${invoicedUnits} de ${pendingUnits} unidades pendientes`
                        + (pendingUnits - invoicedUnits > 0 ? `; quedan ${pendingUnits - invoicedUnits} sin facturar en los remitos` : '')
                    : 'Estos remitos no tienen unidades pendientes de facturar'}
                {excessUnits > 0
                    ? `${pendingUnits > 0 ? ', y' : ':'} ${excessUnits === 1 ? '1 unidad de más queda' : `${excessUnits} unidades de más quedan`} como nota de crédito a recibir.`
                    : '.'}
            </p>
        </div>
    );
}
