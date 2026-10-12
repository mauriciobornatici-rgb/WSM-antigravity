import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, type VatRate, type VatRateInput } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
import { formatVatRate, VAT_RATES_KEY } from "@/components/accounting/BankChargesEditor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

/** Rates ARCA accepts on a voucher. */
const ARCA_RATES = [0, 2.5, 5, 10.5, 21, 27] as const

const VAT_RATES_ADMIN_KEY = [...VAT_RATES_KEY, "all"] as const

/** VAT rates catalog (ADR-015): the default one is applied when a bank debit or fee carries no rate. */
export function VatRatesTab() {
    const queryClient = useQueryClient()
    const [name, setName] = useState("")
    const [rate, setRate] = useState("21")

    const query = useQuery({ queryKey: VAT_RATES_ADMIN_KEY, queryFn: () => api.getVatRates(true) })
    const rates = query.data ?? []
    const loadFailed = query.isError

    const refresh = async () => {
        await queryClient.invalidateQueries({ queryKey: VAT_RATES_KEY })
    }

    const createMutation = useMutation({
        mutationFn: (input: VatRateInput) => api.createVatRate(input),
        onSuccess: async () => {
            toast.success("Alícuota agregada")
            setName("")
            setRate("21")
            await refresh()
        },
        onError: (error) => showErrorToast("No se pudo agregar la alícuota", error),
    })

    const updateMutation = useMutation({
        mutationFn: ({ row, patch }: { row: VatRate; patch: Partial<VatRateInput> }) =>
            api.updateVatRate(row.id, { name: row.name, rate: row.rate, is_default: row.is_default, active: row.active, ...patch }),
        onSuccess: async () => {
            toast.success("Alícuota actualizada")
            await refresh()
        },
        onError: (error) => showErrorToast("No se pudo actualizar la alícuota", error),
    })

    const busy = createMutation.isPending || updateMutation.isPending
    const invalid = name.trim().length === 0

    return (
        <div className="grid gap-4 lg:grid-cols-2">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Alícuotas de IVA</CardTitle>
                    <CardDescription>La alícuota por defecto se usa cuando un débito o una comisión no indica otra.</CardDescription>
                </CardHeader>
                <CardContent>
                    {query.isLoading ? (
                        <p className="text-sm text-muted-foreground">Cargando…</p>
                    ) : loadFailed ? (
                        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                            <span>No se pudieron cargar las alícuotas.</span>
                            <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                                Reintentar
                            </Button>
                        </div>
                    ) : rates.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Todavía no hay alícuotas.</p>
                    ) : (
                        <ul className="divide-y text-sm">
                            {rates.map((row) => (
                                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <span className={row.active ? "font-medium" : "font-medium text-muted-foreground line-through"}>{row.name}</span>
                                        <span className="font-mono text-muted-foreground">{formatVatRate(row.rate)}</span>
                                        {row.is_default ? <Badge>Por defecto</Badge> : null}
                                        {!row.active ? <Badge variant="outline">Inactiva</Badge> : null}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {!row.is_default && row.active ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={busy}
                                                onClick={() => updateMutation.mutate({ row, patch: { is_default: true } })}
                                            >
                                                Marcar por defecto
                                            </Button>
                                        ) : null}
                                        <span className="flex items-center gap-2">
                                            <Switch
                                                aria-label={`${row.active ? "Desactivar" : "Activar"} ${row.name}`}
                                                checked={row.active}
                                                // The default rate can't be deactivated: pick another default first.
                                                disabled={busy || (row.is_default && row.active)}
                                                onChange={(event) => updateMutation.mutate({ row, patch: { active: event.target.checked } })}
                                            />
                                            <span className="text-xs text-muted-foreground">{row.active ? "Activa" : "Inactiva"}</span>
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Agregar alícuota</CardTitle>
                </CardHeader>
                <CardContent>
                    <form
                        className="space-y-3"
                        onSubmit={(event) => {
                            event.preventDefault()
                            if (!invalid) createMutation.mutate({ name: name.trim(), rate: Number(rate) })
                        }}
                    >
                        <fieldset disabled={loadFailed || query.isLoading} className="min-w-0 space-y-3 border-0 p-0">
                            <div className="space-y-1.5">
                                <Label htmlFor="vat-rate-name">Nombre</Label>
                                <Input id="vat-rate-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: IVA reducido" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="vat-rate-value">Alícuota</Label>
                                <Select value={rate} onValueChange={setRate}>
                                    <SelectTrigger id="vat-rate-value"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {ARCA_RATES.map((value) => (
                                            <SelectItem key={value} value={String(value)}>{formatVatRate(value)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button type="submit" disabled={invalid || busy} className="w-full sm:w-auto">
                                Agregar alícuota
                            </Button>
                        </fieldset>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}
