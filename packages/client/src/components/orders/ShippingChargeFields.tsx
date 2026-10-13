import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { VAT_RATE_OPTIONS, formatVatRate } from "@/lib/pricing"

import type { ShippingChargeValue } from "./shippingCharge"

interface ShippingChargeFieldsProps {
    idPrefix: string
    value: ShippingChargeValue
    onChange: (patch: Partial<ShippingChargeValue>) => void
    disabled?: boolean
}

/** Envío del pedido: importe final (con IVA), si se cobra al cliente y alícuota de IVA. */
export function ShippingChargeFields({ idPrefix, value, onChange, disabled = false }: ShippingChargeFieldsProps) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-amount`}>Importe del envío (final, con IVA)</Label>
                <Input
                    id={`${idPrefix}-amount`}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={value.amount}
                    disabled={disabled}
                    onChange={(event) => onChange({ amount: event.target.value })}
                    placeholder="0,00"
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-vat`}>IVA del envío</Label>
                <Select value={value.vatRate} onValueChange={(vatRate) => onChange({ vatRate })} disabled={disabled}>
                    <SelectTrigger id={`${idPrefix}-vat`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {VAT_RATE_OPTIONS.map((rate) => (
                            <SelectItem key={rate} value={String(rate)}>
                                {formatVatRate(rate)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
                <input
                    id={`${idPrefix}-charge`}
                    type="checkbox"
                    checked={value.chargeCustomer}
                    disabled={disabled}
                    onChange={(event) => onChange({ chargeCustomer: event.target.checked })}
                    className="h-4 w-4 cursor-pointer rounded accent-primary"
                />
                <Label htmlFor={`${idPrefix}-charge`} className="cursor-pointer">
                    Cobrar el envío al cliente
                </Label>
            </div>
        </div>
    )
}
