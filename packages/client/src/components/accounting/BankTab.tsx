import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, type BankCharge } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
import { createClientUuid } from "@/lib/clientUuid"
import { formatMoney } from "@/lib/formatters"
import { BankChargesEditor, bankChargesTotal, hasIncompleteBankCharges, toBankChargesPayload } from "@/components/accounting/BankChargesEditor"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const BANK_KEY = ["bank"] as const
const TREASURY_KEY = ["treasury"] as const

/** Local calendar day as YYYY-MM-DD (not UTC: at night in Argentina UTC is already tomorrow). */
function todayLocal(): string {
    const now = new Date()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    return `${now.getFullYear()}-${month}-${day}`
}

/** Bank account (ADR-015): balance, latest movements and the debits the bank takes on its own. */
export function BankTab() {
    const queryClient = useQueryClient()
    const [date, setDate] = useState(todayLocal)
    const [reference, setReference] = useState("")
    const [charges, setCharges] = useState<BankCharge[]>([{ concept: "commission", amount: 0 }])
    // One key per attempt: a retry after a lost response does not debit twice.
    const [idempotencyKey, setIdempotencyKey] = useState(() => createClientUuid())
    const [confirmOpen, setConfirmOpen] = useState(false)

    const query = useQuery({ queryKey: BANK_KEY, queryFn: () => api.getBank() })

    const mutation = useMutation({
        mutationFn: () => api.createBankCharges({
            idempotency_key: idempotencyKey,
            date: date || null,
            reference: reference.trim() || null,
            charges: toBankChargesPayload(charges),
        }),
        onSuccess: async () => {
            toast.success("Débitos bancarios registrados")
            setReference("")
            setDate(todayLocal())
            setCharges([{ concept: "commission", amount: 0 }])
            setIdempotencyKey(createClientUuid())
            await queryClient.invalidateQueries({ queryKey: BANK_KEY })
            await queryClient.invalidateQueries({ queryKey: TREASURY_KEY })
        },
        onError: (error) => showErrorToast("No se pudieron registrar los débitos", error),
    })

    const total = bankChargesTotal(charges)
    const invalid = charges.length === 0 || hasIncompleteBankCharges(charges) || total <= 0
    const loadFailed = query.isError
    const balance = Number(query.data?.balance ?? 0)
    const movements = query.data?.movements ?? []

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Registrar débitos bancarios</CardTitle>
                    <CardDescription>
                        Saldo del banco:{" "}
                        <span className={`font-semibold ${!query.isLoading && !loadFailed && balance < 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                            {query.isLoading ? "Cargando…" : loadFailed ? "No disponible" : formatMoney(balance)}
                        </span>
                        {!query.isLoading && !loadFailed && balance < 0 ? (
                            <span className="ml-2 text-red-600 dark:text-red-400">Saldo negativo (descubierto)</span>
                        ) : null}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form
                        className="space-y-3"
                        onSubmit={(event) => {
                            event.preventDefault()
                            if (!invalid) setConfirmOpen(true)
                        }}
                    >
                        {loadFailed ? (
                            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                                <span>No se pudo cargar el banco.</span>
                                <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                                    Reintentar
                                </Button>
                            </div>
                        ) : null}
                        <fieldset disabled={loadFailed || query.isLoading} className="min-w-0 space-y-3 border-0 p-0">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="bank-date">Fecha</Label>
                                    <Input id="bank-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="bank-reference">Referencia (resumen / extracto)</Label>
                                    <Input id="bank-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
                                </div>
                            </div>
                            <BankChargesEditor value={charges} onChange={setCharges} idPrefix="bank-tab-charge" />
                            <Button type="submit" disabled={invalid || mutation.isPending} className="w-full sm:w-auto">
                                Registrar débitos
                            </Button>
                        </fieldset>
                    </form>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Últimos movimientos del banco</CardTitle>
                </CardHeader>
                <CardContent>
                    {query.isLoading ? (
                        <p className="text-sm text-muted-foreground">Cargando…</p>
                    ) : loadFailed ? (
                        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
                            <span>No se pudieron cargar los movimientos.</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                                Reintentar
                            </Button>
                        </div>
                    ) : movements.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>
                    ) : (
                        <ul className="divide-y text-sm">
                            {movements.map((movement) => (
                                <li key={`${movement.id}-${movement.amount}`} className="flex items-center justify-between gap-3 py-2">
                                    <span className="min-w-0 truncate" title={movement.description}>
                                        <span className="mr-2 text-muted-foreground">{new Date(movement.date).toLocaleDateString("es-AR")}</span>
                                        {movement.description}
                                    </span>
                                    <span className={`shrink-0 font-mono ${movement.amount < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                        {formatMoney(movement.amount)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent className="w-[95vw] sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Confirmar débitos bancarios</DialogTitle>
                        <DialogDescription>
                            ¿Registrar {charges.length} {charges.length === 1 ? "débito" : "débitos"} por {formatMoney(total)} en el banco?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
                        <Button
                            type="button"
                            disabled={invalid || mutation.isPending}
                            onClick={() => {
                                setConfirmOpen(false)
                                mutation.mutate()
                            }}
                        >
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
