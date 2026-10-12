import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, type BankCharge } from "@/services/api"
import { BankChargesEditor, VAT_RATES_KEY, bankChargesTotal, formatVatRate, hasIncompleteBankCharges, toBankChargesPayload } from "@/components/accounting/BankChargesEditor"
import { showErrorToast } from "@/lib/errorHandling"
import { createClientUuid } from "@/lib/clientUuid"
import { formatMoney } from "@/lib/formatters"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const CARD_SETTLEMENTS_KEY = ["card-settlements"] as const

/**
 * Card/QR settlements (ADR-014): what the processors deposit in the bank moves out of
 * "Tarjetas y QR a cobrar"; the fee they keep is posted as a bank expense.
 */
export function CardSettlementsTab() {
    const queryClient = useQueryClient()
    const [amount, setAmount] = useState("")
    const [fee, setFee] = useState("")
    const [reference, setReference] = useState("")
    // "" = the default rate, until the user picks another one.
    const [feeVatRate, setFeeVatRate] = useState("")
    const [charges, setCharges] = useState<BankCharge[]>([])
    // One key per settlement attempt: a retry after a lost response does not deposit twice.
    const [idempotencyKey, setIdempotencyKey] = useState(() => createClientUuid())

    const query = useQuery({ queryKey: CARD_SETTLEMENTS_KEY, queryFn: () => api.getCardSettlements() })
    const pending = Number(query.data?.pending_balance ?? 0)

    const ratesQuery = useQuery({ queryKey: VAT_RATES_KEY, queryFn: () => api.getVatRates(), meta: { silentError: true } })
    const rates = ratesQuery.data ?? []
    const defaultRate = rates.find((rate) => rate.is_default)
    const selectedFeeRate = feeVatRate || (defaultRate ? String(defaultRate.rate) : "")

    const mutation = useMutation({
        mutationFn: () => api.createCardSettlement({
            idempotency_key: idempotencyKey,
            amount: Number(amount),
            fee_amount: fee ? Number(fee) : 0,
            ...(fee && Number(fee) > 0 && selectedFeeRate ? { fee_vat_rate: Number(selectedFeeRate) } : {}),
            ...(charges.length > 0 ? { charges: toBankChargesPayload(charges) } : {}),
            reference: reference.trim() || null,
        }),
        onSuccess: async () => {
            toast.success("AcreditaciÃ³n registrada")
            setAmount("")
            setFee("")
            setReference("")
            setFeeVatRate("")
            setCharges([])
            setIdempotencyKey(createClientUuid())
            await queryClient.invalidateQueries({ queryKey: CARD_SETTLEMENTS_KEY })
        },
        onError: (error) => showErrorToast("No se pudo registrar la acreditaciÃ³n", error),
    })

    const amountValue = Number(amount)
    const feeValue = Number(fee || 0)
    const chargesTotal = bankChargesTotal(charges)
    const feeTooHigh = amountValue > 0 && (feeValue < 0 || feeValue + chargesTotal >= amountValue)
    const amountTooHigh = amountValue > pending + 0.001
    const invalid = !(amountValue > 0) || feeTooHigh || amountTooHigh || hasIncompleteBankCharges(charges)
    const loadFailed = query.isError
    const settlements = query.data?.settlements ?? []

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Acreditar cobros con tarjeta y QR</CardTitle>
                    <CardDescription>
                        Pendiente de acreditar:{" "}
                        <span className="font-semibold text-foreground">
                            {query.isLoading ? "Cargandoâ€¦" : loadFailed ? "No disponible" : formatMoney(pending)}
                        </span>
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form
                        className="space-y-3"
                        onSubmit={(event) => {
                            event.preventDefault()
                            if (!invalid) mutation.mutate()
                        }}
                    >
                        {loadFailed ? (
                            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                                <span>No se pudieron cargar las acreditaciones.</span>
                                <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                                    Reintentar
                                </Button>
                            </div>
                        ) : null}
                        <fieldset disabled={loadFailed || query.isLoading} className="min-w-0 space-y-3 border-0 p-0">
                            <div className="space-y-1.5">
                                <Label htmlFor="settlement-amount">Monto liquidado (bruto)</Label>
                                <Input
                                    id="settlement-amount"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    aria-invalid={amountTooHigh}
                                    aria-describedby={amountTooHigh ? "settlement-amount-error" : undefined}
                                />
                                {amountTooHigh ? (
                                    <p id="settlement-amount-error" role="alert" className="text-sm font-medium text-destructive">
                                        Supera lo pendiente de acreditar ({formatMoney(pending)})
                                    </p>
                                ) : null}
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="settlement-fee">ComisiÃ³n retenida</Label>
                                <Input
                                    id="settlement-fee"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={fee}
                                    onChange={(e) => setFee(e.target.value)}
                                    aria-invalid={feeTooHigh}
                                    aria-describedby={feeTooHigh ? "settlement-fee-error" : undefined}
                                />
                                {feeTooHigh ? (
                                    <p id="settlement-fee-error" role="alert" className="text-sm font-medium text-destructive">
                                        La comisiÃ³n y los dÃ©bitos deben sumar menos que el monto
                                    </p>
                                ) : null}
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="settlement-fee-vat">IVA de la comisiÃ³n</Label>
                                <Select
                                    value={selectedFeeRate}
                                    onValueChange={setFeeVatRate}
                                    disabled={rates.length === 0}
                                >
                                    <SelectTrigger id="settlement-fee-vat">
                                        <SelectValue placeholder={ratesQuery.isError ? "No disponible" : "Cargandoâ€¦"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {rates.map((rate) => (
                                            <SelectItem key={rate.id} value={String(rate.rate)}>{formatVatRate(rate.rate)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold">Otros dÃ©bitos del procesador (retenciones, impuestos)</h3>
                                <BankChargesEditor value={charges} onChange={setCharges} idPrefix="settlement-charge" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="settlement-reference">Referencia (lote / liquidaciÃ³n)</Label>
                                <Input id="settlement-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                            </div>
                            {amountValue > 0 && !feeTooHigh && !amountTooHigh ? (
                                <p className="text-sm text-muted-foreground" aria-live="polite">
                                    Ingresa al banco {formatMoney(Math.max(amountValue - feeValue - chargesTotal, 0))}
                                </p>
                            ) : null}
                            <Button type="submit" disabled={invalid || mutation.isPending} className="w-full sm:w-auto">
                                Registrar acreditaciÃ³n
                            </Button>
                        </fieldset>
                    </form>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Ãšltimas acreditaciones</CardTitle>
                </CardHeader>
                <CardContent>
                    {query.isLoading ? (
                        <p className="text-sm text-muted-foreground">Cargandoâ€¦</p>
                    ) : loadFailed ? (
                        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
                            <span>No se pudieron cargar las acreditaciones.</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                                Reintentar
                            </Button>
                        </div>
                    ) : settlements.length === 0 ? (
                        <p className="text-sm text-muted-foreground">TodavÃ­a no hay acreditaciones.</p>
                    ) : (
                        <ul className="divide-y text-sm">
                            {settlements.map((row) => (
                                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                                    <span className="min-w-0 truncate" title={row.description}>
                                        <span className="mr-2 text-muted-foreground">{new Date(row.date).toLocaleDateString("es-AR")}</span>
                                        {row.description}
                                    </span>
                                    <span className="shrink-0 font-mono">{formatMoney(row.amount)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
