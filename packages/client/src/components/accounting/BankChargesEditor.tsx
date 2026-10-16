/* eslint-disable react-refresh/only-export-components */
import { useQuery } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { api, type BankCharge, type BankChargeConcept } from "@/services/api"
import { formatMoney } from "@/lib/formatters"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export const VAT_RATES_KEY = ["vat-rates"] as const

const CONCEPT_LABELS: Record<BankChargeConcept, string> = {
    commission: "Comisión",
    maintenance: "Mantenimiento de cuenta",
    debits_credits_tax: "Impuesto a los débitos y créditos",
    withholding: "Retenciones y percepciones",
    other: "Otros gastos bancarios",
}

const CONCEPTS = Object.keys(CONCEPT_LABELS) as BankChargeConcept[]

/** Only these concepts carry computable VAT; taxes and withholdings do not. */
const CONCEPTS_WITH_VAT: BankChargeConcept[] = ["commission", "maintenance", "other"]

export function bankChargesTotal(charges: BankCharge[]): number {
    const total = charges.reduce((sum, charge) => sum + (Number(charge.amount) > 0 ? Number(charge.amount) : 0), 0)
    return Math.round(total * 100) / 100
}

/** True when a line was added but has no positive amount yet. */
export function hasIncompleteBankCharges(charges: BankCharge[]): boolean {
    return charges.some((charge) => !(Number(charge.amount) > 0))
}

/** Payload form: blank notes are omitted. */
export function toBankChargesPayload(charges: BankCharge[]): BankCharge[] {
    return charges.map((charge) => {
        const { notes, ...rest } = charge
        const trimmed = notes?.trim()
        return trimmed ? { ...rest, notes: trimmed } : rest
    })
}

export function formatVatRate(rate: number): string {
    return `${String(rate).replace(".", ",")} %`
}

interface BankChargesEditorProps {
    value: BankCharge[]
    onChange: (charges: BankCharge[]) => void
    /** Prefix for element ids when more than one editor is on screen. */
    idPrefix?: string
    disabled?: boolean
}

/** Controlled list of bank debits (commissions, taxes, withholdings) shared by treasury, card settlements and the bank tab. */
export function BankChargesEditor({ value, onChange, idPrefix = "bank-charge", disabled = false }: BankChargesEditorProps) {
    const ratesQuery = useQuery({ queryKey: VAT_RATES_KEY, queryFn: () => api.getVatRates(), meta: { silentError: true } })
    const rates = ratesQuery.data ?? []
    const defaultRate = rates.find((rate) => rate.is_default)

    const updateLine = (index: number, patch: Partial<BankCharge>) => {
        onChange(value.map((charge, position) => (position === index ? { ...charge, ...patch } : charge)))
    }

    const changeConcept = (index: number, concept: BankChargeConcept) => {
        // Taxes and withholdings have no VAT: drop a rate chosen for a previous concept.
        onChange(value.map((charge, position) => {
            if (position !== index) return charge
            const next: BankCharge = { ...charge, concept }
            if (!CONCEPTS_WITH_VAT.includes(concept)) delete next.vat_rate
            return next
        }))
    }

    return (
        <div className="space-y-3">
            {value.map((charge, index) => {
                const lineNumber = index + 1
                const hasVat = CONCEPTS_WITH_VAT.includes(charge.concept)
                const selectedRate = charge.vat_rate ?? defaultRate?.rate
                return (
                    <div key={index} className="space-y-3 rounded-md border p-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor={`${idPrefix}-${index}-concept`}>Concepto del débito {lineNumber}</Label>
                                <Select value={charge.concept} onValueChange={(concept) => changeConcept(index, concept as BankChargeConcept)} disabled={disabled}>
                                    <SelectTrigger id={`${idPrefix}-${index}-concept`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {CONCEPTS.map((concept) => (
                                            <SelectItem key={concept} value={concept}>{CONCEPT_LABELS[concept]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor={`${idPrefix}-${index}-amount`}>Importe debitado (IVA incl.)</Label>
                                <Input
                                    id={`${idPrefix}-${index}-amount`}
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    disabled={disabled}
                                    value={charge.amount > 0 ? charge.amount : ""}
                                    onChange={(event) => updateLine(index, { amount: Number(event.target.value) })}
                                />
                            </div>
                            {hasVat ? (
                                <div className="space-y-1.5">
                                    <Label htmlFor={`${idPrefix}-${index}-vat`}>IVA del débito</Label>
                                    <Select
                                        value={selectedRate === undefined ? "" : String(selectedRate)}
                                        onValueChange={(rate) => updateLine(index, { vat_rate: Number(rate) })}
                                        disabled={disabled || rates.length === 0}
                                    >
                                        <SelectTrigger id={`${idPrefix}-${index}-vat`}>
                                            <SelectValue placeholder={ratesQuery.isError ? "No disponible" : "Cargando…"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {rates.map((rate) => (
                                                <SelectItem key={rate.id} value={String(rate.rate)}>{formatVatRate(rate.rate)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : null}
                            <div className="space-y-1.5">
                                <Label htmlFor={`${idPrefix}-${index}-notes`}>Detalle (opcional)</Label>
                                <Input
                                    id={`${idPrefix}-${index}-notes`}
                                    maxLength={120}
                                    disabled={disabled}
                                    value={charge.notes ?? ""}
                                    onChange={(event) => updateLine(index, { notes: event.target.value })}
                                />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-11 w-11 p-0"
                                aria-label={`Quitar débito ${lineNumber}`}
                                disabled={disabled}
                                onClick={() => onChange(value.filter((_, position) => position !== index))}
                            >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </Button>
                        </div>
                    </div>
                )
            })}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || value.length >= 20}
                    onClick={() => onChange([...value, { concept: "commission", amount: 0 }])}
                >
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> Agregar débito
                </Button>
                {value.length > 0 ? (
                    <p className="text-sm text-muted-foreground" aria-live="polite">
                        Total de débitos: <span className="font-semibold text-foreground">{formatMoney(bankChargesTotal(value))}</span>
                    </p>
                ) : null}
            </div>
        </div>
    )
}
