import { useEffect, useRef, useState, type KeyboardEvent } from "react"
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
 * Also shown for a Responsable Inscripto without a valid CUIT: the A invoice cannot be issued.
 * Inline on purpose: it lives inside the payment and invoice dialogs.
 */
export function ClientTaxConditionNotice({ client, onUpdated }: ClientTaxConditionNoticeProps) {
    const [editing, setEditing] = useState(false)
    const [condition, setCondition] = useState("")
    const [taxId, setTaxId] = useState("")
    const [saving, setSaving] = useState(false)
    const [cuitError, setCuitError] = useState<string | null>(null)
    const startButtonRef = useRef<HTMLButtonElement>(null)
    const wasEditingRef = useRef(false)
    const fieldId = `tax-condition-${client?.id ?? "none"}`

    useEffect(() => {
        if (editing) {
            document.getElementById(fieldId)?.focus()
        } else if (wasEditingRef.current) {
            startButtonRef.current?.focus()
        }
        wasEditingRef.current = editing
    }, [editing, fieldId])

    const missingCondition = !client?.tax_condition_id
    const missingCuit = client?.tax_condition_id === "tc_RespInscripto" && taxConditionCuitError(client.tax_condition_id, client.tax_id) !== null
    if (!client?.id || (!missingCondition && !missingCuit)) return null

    const noticeId = `${fieldId}-notice`
    const cuitErrorId = `${fieldId}-cuit-error`

    function startEditing() {
        setCondition(client?.tax_condition_id || "")
        setTaxId(client?.tax_id || "")
        setCuitError(null)
        setEditing(true)
    }

    function cancelEditing() {
        setCuitError(null)
        setEditing(false)
    }

    async function save() {
        if (!client?.id || !condition) return
        const error = taxConditionCuitError(condition, taxId)
        if (error) {
            setCuitError(error)
            return
        }
        setCuitError(null)
        try {
            setSaving(true)
            const updated = await api.setClientTaxCondition(client.id, { tax_condition_id: condition, tax_id: taxId.trim() || null })
            toast.success("Condición frente al IVA guardada")
            setEditing(false)
            onUpdated(updated)
        } catch (err) {
            showErrorToast("No se pudo guardar la condición", err)
        } finally {
            setSaving(false)
        }
    }

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        // The select list is portaled: its own Escape must not cancel the edition.
        if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) {
            event.stopPropagation()
            cancelEditing()
        }
    }

    return (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs" role="group" aria-labelledby={noticeId}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p id={noticeId} className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {missingCondition ? (
                        <span><strong>{client.name}</strong> no tiene cargada la condición frente al IVA: la factura sale como Consumidor Final.</span>
                    ) : (
                        <span><strong>{client.name}</strong> es Responsable Inscripto pero no tiene CUIT cargado: la factura A no se puede emitir.</span>
                    )}
                </p>
                {!editing ? (
                    <Button ref={startButtonRef} type="button" size="sm" variant="outline" className="h-9 shrink-0" onClick={startEditing}>
                        Cargar ahora
                    </Button>
                ) : null}
            </div>
            {editing ? (
                // Only listens to Escape bubbling up from the fields inside; it is not interactive itself.
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start" onKeyDown={handleKeyDown}>
                    <div className="space-y-1">
                        <Label htmlFor={fieldId} className="text-xs">Condición IVA</Label>
                        <Select value={condition} onValueChange={setCondition}>
                            <SelectTrigger id={fieldId} className="h-9">
                                <SelectValue placeholder="Elegir condición…" />
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
                        <Input
                            id={`${fieldId}-cuit`}
                            className="h-9"
                            inputMode="numeric"
                            value={taxId}
                            aria-invalid={cuitError ? true : undefined}
                            aria-describedby={cuitError ? cuitErrorId : undefined}
                            onChange={(event) => {
                                setTaxId(event.target.value)
                                if (cuitError) setCuitError(null)
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault()
                                    void save()
                                }
                            }}
                        />
                        {cuitError ? <p id={cuitErrorId} className="text-xs text-destructive">{cuitError}</p> : null}
                    </div>
                    <div className="flex gap-2 sm:pt-5">
                        <Button type="button" size="sm" variant="ghost" className="h-9" onClick={cancelEditing} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button type="button" size="sm" className="h-9" onClick={() => void save()} disabled={saving || !condition}>
                            {saving ? "Guardando..." : "Guardar"}
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    )
}
