import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
import { TAX_CONDITION_OPTIONS, taxConditionCuitError } from "@/lib/taxConditions"
import type { Client } from "@/types"

type ClientTaxConditionNoticeProps = {
    client: Pick<Client, "id" | "name" | "tax_id" | "tax_condition_id"> | null | undefined
    onUpdated: (client: Client) => void
}

/**
 * ADR-022: a customer without a VAT condition is noticed where it matters (selling,
 * invoicing) and completed right there, instead of going through the customers one by one.
 * Inline on purpose: it lives inside the payment and invoice dialogs.
 */
export function ClientTaxConditionNotice({ client, onUpdated }: ClientTaxConditionNoticeProps) {
    const [editing, setEditing] = useState(false)
    const [condition, setCondition] = useState("tc_ConsFinal")
    const [taxId, setTaxId] = useState("")
    const [saving, setSaving] = useState(false)

    if (!client?.id || client.tax_condition_id) return null
    const fieldId = `tax-condition-${client.id}`

    function startEditing() {
        setCondition("tc_ConsFinal")
        setTaxId(client?.tax_id || "")
        setEditing(true)
    }

    async function save() {
        if (!client?.id) return
        const cuitError = taxConditionCuitError(condition, taxId)
        if (cuitError) {
            toast.error(cuitError)
            return
        }
        try {
            setSaving(true)
            const updated = await api.setClientTaxCondition(client.id, { tax_condition_id: condition, tax_id: taxId.trim() || null })
            toast.success("Condición frente al IVA guardada")
            setEditing(false)
            onUpdated(updated)
        } catch (error) {
            showErrorToast("No se pudo guardar la condición", error)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs" role="status">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span><strong>{client.name}</strong> no tiene cargada la condición frente al IVA: la factura sale como Consumidor Final.</span>
                </p>
                {!editing ? (
                    <Button type="button" size="sm" variant="outline" className="h-7 shrink-0" onClick={startEditing}>
                        Cargar ahora
                    </Button>
                ) : null}
            </div>
            {editing ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                    <div className="space-y-1">
                        <Label htmlFor={fieldId} className="text-xs">Condición IVA</Label>
                        <Select value={condition} onValueChange={setCondition}>
                            <SelectTrigger id={fieldId} className="h-8">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {TAX_CONDITION_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor={`${fieldId}-cuit`} className="text-xs">CUIT / DNI</Label>
                        <Input id={`${fieldId}-cuit`} className="h-8" value={taxId} onChange={(event) => setTaxId(event.target.value)} />
                    </div>
                    <div className="flex gap-2">
                        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditing(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button type="button" size="sm" className="h-8" onClick={() => void save()} disabled={saving}>
                            {saving ? "Guardando..." : "Guardar"}
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
