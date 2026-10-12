import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Vault } from "lucide-react"
import { api, type TreasuryFund } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
import { createClientUuid } from "@/lib/clientUuid"
import { formatMoney } from "@/lib/formatters"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const TREASURY_KEY = ["treasury"] as const

const FUND_LABELS: Record<TreasuryFund, string> = {
    drawer: "Caja (turno abierto)",
    treasury: "Caja 2",
    bank: "Banco",
    initial: "Saldo inicial",
}

/**
 * "Caja 2" (ADR-015): treasury cash outside the POS drawer. It is filled from the drawer,
 * the bank or an opening balance, and pays suppliers ("Caja 2" as the payment method).
 */
export function TreasuryPanel() {
    const queryClient = useQueryClient()
    const [from, setFrom] = useState<TreasuryFund>("drawer")
    const [to, setTo] = useState<Exclude<TreasuryFund, "initial">>("treasury")
    const [amount, setAmount] = useState("")
    const [notes, setNotes] = useState("")
    const [transferKey, setTransferKey] = useState(() => createClientUuid())
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [cashRegisterId, setCashRegisterId] = useState("")

    const query = useQuery({ queryKey: TREASURY_KEY, queryFn: () => api.getTreasury() })

    // The drawer is an open register's shift: with more than one open, the user picks which.
    const involvesDrawer = from === "drawer" || to === "drawer"
    const registersQuery = useQuery({
        queryKey: ["cash-registers", "for-treasury"],
        queryFn: () => api.getCashRegisters(),
        enabled: involvesDrawer,
        meta: { silentError: true },
    })
    const openRegisters = (registersQuery.data ?? []).filter((register) => register.status === "open")
    const needsRegisterChoice = involvesDrawer && openRegisters.length > 1

    const mutation = useMutation({
        mutationFn: () => api.createTreasuryTransfer({
            idempotency_key: transferKey,
            from,
            to,
            amount: Number(amount),
            ...(involvesDrawer && cashRegisterId ? { cash_register_id: cashRegisterId } : {}),
            notes: notes.trim() || null,
        }),
        onSuccess: async () => {
            toast.success("Movimiento registrado")
            setAmount("")
            setNotes("")
            setTransferKey(createClientUuid())
            await queryClient.invalidateQueries({ queryKey: TREASURY_KEY })
            await queryClient.invalidateQueries({ queryKey: ["cash-registers"] })
        },
        onError: (error) => showErrorToast("No se pudo registrar el movimiento", error),
    })

    const invalid =
        !(Number(amount) > 0) ||
        from === to ||
        (from === "initial" && to !== "treasury") ||
        (needsRegisterChoice && !cashRegisterId)
    const loadFailed = query.isError
    const movements = query.data?.movements ?? []

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <Vault className="h-5 w-5" aria-hidden="true" /> Caja 2 (tesorería)
                </CardTitle>
                <CardDescription>
                    Efectivo fuera de la caja del mostrador. Saldo:{" "}
                    <span className="font-semibold text-foreground">
                        {query.isLoading ? "Cargando…" : loadFailed ? "No disponible" : formatMoney(query.data?.balance ?? 0)}
                    </span>
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-2">
                <form
                    className="space-y-3"
                    onSubmit={(event) => {
                        event.preventDefault()
                        if (!invalid) setConfirmOpen(true)
                    }}
                >
                    {loadFailed ? (
                        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                            <span>No se pudo cargar Caja 2.</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                                Reintentar
                            </Button>
                        </div>
                    ) : null}
                    <fieldset disabled={loadFailed || query.isLoading} className="min-w-0 space-y-3 border-0 p-0">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="treasury-from">Sale de</Label>
                                <Select value={from} onValueChange={(value) => setFrom(value as TreasuryFund)}>
                                    <SelectTrigger id="treasury-from"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(["drawer", "treasury", "bank", "initial"] as const).map((fund) => (
                                            <SelectItem key={fund} value={fund}>{FUND_LABELS[fund]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="treasury-to">Entra a</Label>
                                <Select value={to} onValueChange={(value) => setTo(value as Exclude<TreasuryFund, "initial">)}>
                                    <SelectTrigger id="treasury-to"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {(["treasury", "drawer", "bank"] as const).map((fund) => (
                                            <SelectItem key={fund} value={fund}>{FUND_LABELS[fund]}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        {needsRegisterChoice ? (
                            <div className="space-y-1.5">
                                <Label htmlFor="treasury-register">Caja del mostrador</Label>
                                <Select value={cashRegisterId} onValueChange={setCashRegisterId}>
                                    <SelectTrigger id="treasury-register">
                                        <SelectValue placeholder="Elegí la caja" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {openRegisters.map((register) => (
                                            <SelectItem key={register.id} value={register.id}>{register.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}
                        <div className="space-y-1.5">
                            <Label htmlFor="treasury-amount">Monto</Label>
                            <Input id="treasury-amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="treasury-notes">Detalle</Label>
                            <Input id="treasury-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
                        </div>
                        {from === to ? <p className="text-xs text-destructive">Origen y destino deben ser distintos.</p> : null}
                        {from === "initial" && to !== "treasury" ? (
                            <p className="text-xs text-destructive">El saldo inicial solo se carga en Caja 2.</p>
                        ) : null}
                        <Button type="submit" disabled={invalid || mutation.isPending} className="w-full sm:w-auto">
                            Registrar movimiento
                        </Button>
                    </fieldset>
                </form>
                <div>
                    <h3 className="mb-2 text-sm font-semibold">Últimos movimientos</h3>
                    {query.isLoading ? (
                        <p className="text-sm text-muted-foreground">Cargando…</p>
                    ) : loadFailed ? (
                        <p className="text-sm text-muted-foreground">No se pudieron cargar los movimientos.</p>
                    ) : movements.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sin movimientos.</p>
                    ) : (
                        <ul className="divide-y text-sm">
                            {movements.map((movement) => (
                                <li key={`${movement.id}-${movement.amount}`} className="flex items-center justify-between gap-3 py-2">
                                    <span className="min-w-0 truncate">{movement.description}</span>
                                    <span className={`shrink-0 font-mono ${movement.amount < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                                        {formatMoney(movement.amount)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </CardContent>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent className="w-[95vw] sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Confirmar movimiento</DialogTitle>
                        <DialogDescription>
                            ¿Pasar {formatMoney(Number(amount))} de {FUND_LABELS[from]} a {FUND_LABELS[to]}?
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
        </Card>
    )
}
