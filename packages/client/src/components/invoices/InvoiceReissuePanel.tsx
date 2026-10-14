import { useState } from "react"
import { RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { arcaErrorText, canReissueInvoice, REISSUE_MAX_DAYS, reissueLetters } from "@/lib/arca"
import { suggestedInvoiceLetter, taxConditionName } from "@/lib/taxConditions"
import type { Client } from "@/types"
import type { InvoiceView } from "./types"

type ReissueLetter = "A" | "B" | "C" | "TK"
const ANONYMOUS = "__consumidor_final__"
// The invoice preview is always light (it is what gets printed): explicit colors, not the theme ones.
const LIGHT_OUTLINE = "border-amber-600 bg-white text-amber-900 hover:bg-amber-100 hover:text-amber-950"
const LIGHT_FIELD = "border-slate-300 bg-white text-slate-900"
const LETTERS: Array<{ value: ReissueLetter; label: string }> = [
    { value: "A", label: "Factura A" },
    { value: "B", label: "Factura B" },
    { value: "C", label: "Factura C" },
    { value: "TK", label: "Ticket" },
]

type InvoiceReissuePanelProps = {
    invoice: InvoiceView
    clients: Client[]
    companyIvaCondition?: string | null | undefined
    onReissue: (invoice: InvoiceView, data: { invoice_type: ReissueLetter; client_id: string | null }) => Promise<void>
}

/**
 * ADR-022: annul an invoice ARCA never authorized and issue it again with another letter
 * and/or customer. Same lines and amounts; the collections and the order follow it.
 */
export function InvoiceReissuePanel({ invoice, clients, companyIvaCondition, onReissue }: InvoiceReissuePanelProps) {
    const [open, setOpen] = useState(false)
    const [confirming, setConfirming] = useState(false)
    const [saving, setSaving] = useState(false)
    const [clientId, setClientId] = useState<string>(invoice.client_id || ANONYMOUS)
    const [letter, setLetter] = useState<ReissueLetter>((invoice.invoice_type as ReissueLetter) || "B")

    if (!canReissueInvoice(invoice)) return null
    const error = arcaErrorText(typeof invoice.arca_last_error === "string" ? invoice.arca_last_error : null)
    const client = clients.find((candidate) => candidate.id === clientId) ?? null
    // The same customer can be issued again when its data changed (VAT condition or CUIT loaded later).
    const sameClient = (clientId === ANONYMOUS ? null : clientId) === (invoice.client_id || null)
    const sameData = !client || (
        (taxConditionName(client.tax_condition_id) ?? "Consumidor Final") === (invoice.client_tax_condition || "Consumidor Final")
        && (client.tax_id || "") === (invoice.client_tax_id || "")
    )
    const unchanged = letter === invoice.invoice_type && sameClient && sameData
    // Same window as the server (ADR-022): later, only an administrator can reissue it.
    const issuedAt = invoice.issue_date ? new Date(invoice.issue_date) : null
    const ageDays = issuedAt && !Number.isNaN(issuedAt.getTime()) ? Math.floor((Date.now() - issuedAt.getTime()) / 86_400_000) : 0
    const late = ageDays > REISSUE_MAX_DAYS
    const letterOptions = LETTERS.filter((option) => reissueLetters(invoice.invoice_type).includes(option.value))

    function chooseClient(value: string) {
        setClientId(value)
        setConfirming(false)
        const next = clients.find((candidate) => candidate.id === value)
        const suggested = suggestedInvoiceLetter(next?.tax_condition_id, companyIvaCondition)
        if (suggested && reissueLetters(invoice.invoice_type).includes(suggested)) setLetter(suggested)
    }

    async function submit() {
        try {
            setSaving(true)
            await onReissue(invoice, { invoice_type: letter, client_id: clientId === ANONYMOUS ? null : clientId })
            setOpen(false)
            setConfirming(false)
        } catch {
            // The error is already reported by the caller.
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-slate-900">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p className="font-medium">Factura sin autorizar en ARCA</p>
                    {error ? <p className="text-xs text-slate-600">Motivo: {error}</p> : null}
                    {late ? (
                        <p className="text-xs text-slate-600">
                            Pasaron más de {REISSUE_MAX_DAYS} días desde la emisión: solo un administrador puede volver a emitirla.
                        </p>
                    ) : null}
                </div>
                {!open ? (
                    <Button type="button" size="sm" variant="outline" className={LIGHT_OUTLINE} onClick={() => setOpen(true)}>
                        <RefreshCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                        Anular y volver a emitir
                    </Button>
                ) : null}
            </div>
            {open ? (
                <div className="mt-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                            <Label htmlFor="reissue-client" className="text-slate-800">Cliente</Label>
                            <Select value={clientId} onValueChange={chooseClient}>
                                <SelectTrigger id="reissue-client" className={LIGHT_FIELD}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ANONYMOUS}>Consumidor final (sin cliente)</SelectItem>
                                    {clients.map((candidate) => (
                                        <SelectItem key={candidate.id} value={candidate.id}>
                                            {candidate.name}{candidate.tax_id ? ` · ${candidate.tax_id}` : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {client ? (
                                <p className="text-xs text-slate-600">
                                    {taxConditionName(client.tax_condition_id) ?? "Condición IVA sin especificar"}
                                </p>
                            ) : null}
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="reissue-letter" className="text-slate-800">Tipo</Label>
                            <Select value={letter} onValueChange={(value) => { setLetter(value as ReissueLetter); setConfirming(false) }}>
                                <SelectTrigger id="reissue-letter" className={LIGHT_FIELD}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {letterOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <p className="text-xs text-slate-600">
                        La factura actual queda anulada (nunca fue autorizada). La nueva lleva los mismos productos e importes;
                        los cobros y el pedido pasan a ella.
                    </p>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button type="button" size="sm" variant="ghost" className="text-slate-700 hover:bg-amber-100 hover:text-slate-900" onClick={() => { setOpen(false); setConfirming(false) }} disabled={saving}>
                            Cancelar
                        </Button>
                        {!confirming ? (
                            <Button type="button" size="sm" onClick={() => setConfirming(true)} disabled={unchanged}>
                                Continuar
                            </Button>
                        ) : (
                            <Button type="button" size="sm" variant="destructive" onClick={() => void submit()} disabled={saving}>
                                {saving ? "Emitiendo..." : "Confirmar anulación y nueva factura"}
                            </Button>
                        )}
                    </div>
                    {unchanged ? <p className="text-xs text-slate-600">Elegí otra letra u otro cliente.</p> : null}
                </div>
            ) : null}
        </div>
    )
}
