import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/formatters';
import type { InvoiceLineView } from './receptionTotals';

interface SupplierInvoiceLinesProps {
    lines: InvoiceLineView[];
    onChange: (lineId: string, patch: { quantity?: string; unitCost?: string }) => void;
}

/**
 * ADR-028: what the invoice charges of each delivery note line. The units left out stay to invoice
 * (another invoice, or a return); a cost other than the delivery note's corrects the product's cost.
 */
export function SupplierInvoiceLines({ lines, onChange }: SupplierInvoiceLinesProps) {
    return (
        <div className="space-y-2">
            <p id="invoice-lines-help" className="text-xs text-muted-foreground">
                Indicá cuántas unidades de cada remito cobra esta factura y a qué costo neto. Lo que no se facture ahora
                queda pendiente para otra factura.
            </p>
            <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-sm" aria-describedby="invoice-lines-help">
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
                        {lines.map((line) => (
                            <tr key={line.id} className={line.valid ? undefined : 'bg-destructive/5'}>
                                <td className="px-2 py-2">
                                    <div className="font-medium">{line.productName}</div>
                                    <div className="text-xs text-muted-foreground">
                                        Remito {line.receptionLabel}{line.sku ? ` · ${line.sku}` : ''}
                                    </div>
                                </td>
                                <td className="px-2 py-2 text-right font-mono">{line.pending}</td>
                                <td className="px-2 py-2">
                                    <Input
                                        type="number"
                                        min="0"
                                        max={line.pending}
                                        step="1"
                                        inputMode="numeric"
                                        aria-label={`Unidades facturadas de ${line.productName}`}
                                        aria-invalid={!line.quantityValid}
                                        className="mx-auto h-11 w-24 text-center sm:h-9"
                                        value={line.quantity}
                                        onChange={(event) => onChange(line.id, { quantity: event.target.value })}
                                    />
                                </td>
                                <td className="px-2 py-2">
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        aria-label={`Costo neto unitario de ${line.productName}`}
                                        aria-describedby={`invoice-line-cost-${line.id}`}
                                        aria-invalid={!line.costValid}
                                        className="mx-auto h-11 w-32 text-center sm:h-9"
                                        value={line.unitCost}
                                        onChange={(event) => onChange(line.id, { unitCost: event.target.value })}
                                    />
                                    <p id={`invoice-line-cost-${line.id}`} className="mt-0.5 text-center text-[11px] text-muted-foreground">
                                        En el remito: {formatMoney(line.remitoCost)}
                                    </p>
                                </td>
                                <td className="px-2 py-2 text-right font-mono">{formatMoney(line.netCents / 100)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
