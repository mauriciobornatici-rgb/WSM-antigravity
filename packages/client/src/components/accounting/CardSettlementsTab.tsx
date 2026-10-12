import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
import { createClientUuid } from "@/lib/clientUuid"
import { formatMoney } from "@/lib/formatters"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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
    // One key per settlement attempt: a retry after a lost response does not deposit twice.
    const [idempotencyKey, setIdempotencyKey] = useState(() => createClientUuid())

    const query = useQuery({ queryKey: CARD_SETTLEMENTS_KEY, queryFn: () => api.getCardSettlements() })
    const pending = Number(query.data?.pending_balance ?? 0)

    const mutation = useMutation({
        mutationFn: () => api.createCardSettlement({
            idempotency_key: idempotencyKey,
            amount: Number(amount),
            fee_amount: fee ? Number(fee) : 0,
            reference: reference.trim() || null,
        }),
        onSuccess: async () => {
            toast.success("Acreditación registrada")
            setAmount("")
            setFee("")
            setReference("")
            setIdempotencyKey(createClientUuid())
            await queryClient.invalidateQueries({ queryKey: CARD_SETTLEMENTS_KEY })
        },
        onError: (error) => showErrorToast("No se pudo registrar la acreditación", error),
    })

    const amountValue = Number(amount)
    const feeValue = Number(fee || 0)
    const invalid = !(amountValue > 0) || feeValue < 0 || feeValue >= amountValue || amountValue > pending + 0.001

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Acreditar cobros con tarjeta y QR</CardTitle>
                    <CardDescription>
                        Pendiente de acreditar: <span className="font-semibold text-foreground">{formatMoney(pending)}</span>
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
                        <div className="space-y-1.5">
                            <Label htmlFor="settlement-amount">Monto liquidado (bruto)</Label>
                            <Input id="settlement-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="settlement-fee">Comisión retenida</Label>
                            <Input id="settlement-fee" type="number" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="settlement-reference">Referencia (lote / liquidación)</Label>
                            <Input id="settlement-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                        </div>
                        {amountValue > 0 ? (
                            <p className="text-sm text-muted-foreground" aria-live="polite">
                                Ingresa al banco {formatMoney(Math.max(amountValue - feeValue, 0))}
                                {amountValue > pending + 0.001 ? " · supera lo pendiente" : ""}
                            </p>
                        ) : null}
                        <Button type="submit" disabled={invalid || mutation.isPending} className="w-full sm:w-auto">
                            Registrar acreditación
                        </Button>
                    </form>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Últimas acreditaciones</CardTitle>
                </CardHeader>
                <CardContent>
                    {(query.data?.settlements ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">Todavía no hay acreditaciones.</p>
                    ) : (
                        <ul className="divide-y text-sm">
                            {(query.data?.settlements ?? []).map((row) => (
                                <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                                    <span className="min-w-0 truncate">{row.description}</span>
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
