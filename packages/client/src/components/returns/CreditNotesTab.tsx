import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Eye, Printer, ReceiptText } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { showErrorToast } from "@/lib/errorHandling"
import { createClientUuid } from "@/lib/clientUuid"
import { isApiError } from "@/services/httpClient"
import { formatMoney } from "@/lib/formatters"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { QueryErrorBanner, QueryLoadingState } from "./QueryStates"
import { mapCreditNoteRows, creditNoteStatusLabel } from "./helpers"
import { CreditNotePreviewDialog } from "@/components/invoices/CreditNotePreviewDialog"
import { ArcaLastError } from "@/components/invoices/ArcaLastError"
import {
    ARCA_VERIFYING_HELP,
    arcaAuthorizeButtonLabel,
    creditNoteFiscalNumber,
    isArcaAuthorizing,
    reportArcaAuthorizeError,
} from "@/lib/arca"
import type { CompanySettings, Client } from "@/types"
import type { CreditNoteRow, ClientReturnRow } from "@/types/returns"

const EMPTY_CREDIT_NOTES: CreditNoteRow[] = []
const EMPTY_CLIENTS: Client[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null
}

type CreditNotesTabProps = {
    companySettings: CompanySettings
    onPrintCreditNote: (cn: CreditNoteRow, layout: "a4" | "thermal") => void
    linkedReturn: ClientReturnRow | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
}

export function CreditNotesTab({
    companySettings,
    onPrintCreditNote,
    linkedReturn,
    companyName,
    companyTaxId,
    companyAddress,
    taxRateLabel,
}: CreditNotesTabProps) {
    const queryClient = useQueryClient()

    const [createOpen, setCreateOpen] = useState(false)
    const [clientId, setClientId] = useState("")
    const [invoiceId, setInvoiceId] = useState("")
    const [amount, setAmount] = useState(0)
    const [reason, setReason] = useState("")
    // One key per issuing attempt, kept across retries until the note is confirmed: a retry
    // after a lost response returns the note already issued instead of creating another.
    const [idempotencyKey, setIdempotencyKey] = useState(() => createClientUuid())

    const [previewOpen, setPreviewOpen] = useState(false)
    const [previewCreditNote, setPreviewCreditNote] = useState<CreditNoteRow | null>(null)

    const creditNotesQuery = useQuery({
        queryKey: queryKeys.creditNotes.all,
        queryFn: async () => mapCreditNoteRows(await api.getCreditNotes()),
    })

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    })

    // A credit note corrects one invoice of the client (ADR-014).
    const clientInvoicesQuery = useQuery({
        queryKey: ["invoices", "by-client", clientId],
        queryFn: () => api.getInvoices({ client_id: clientId }),
        enabled: createOpen && Boolean(clientId),
    })
    const clientInvoices = (clientInvoicesQuery.data ?? []).filter((invoice) => invoice.status !== "cancelled")

    const createCreditNoteMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createCreditNote>[0]) => api.createCreditNote(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all })
        },
    })

    const authorizeCreditNoteMutation = useMutation({
        mutationFn: (id: string) => api.authorizeCreditNote(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all })
        },
        // Any attempt can settle or raise an ARCA alert (dashboard and menu).
        onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.arcaAlerts }),
    })

    const creditNotes = creditNotesQuery.data ?? EMPTY_CREDIT_NOTES
    const clients = clientsQuery.data ?? EMPTY_CLIENTS
    const loading = creditNotesQuery.isLoading || clientsQuery.isLoading
    const hasLoadError = creditNotesQuery.isError || clientsQuery.isError

    async function handleCreateCreditNote() {
        if (!clientId || !invoiceId || amount <= 0) {
            toast.error("Cliente, factura y monto son obligatorios")
            return
        }

        try {
            const trimmedReason = reason.trim()
            const created = await createCreditNoteMutation.mutateAsync({
                idempotency_key: idempotencyKey,
                client_id: clientId,
                invoice_id: invoiceId,
                amount: Number(amount),
                ...(trimmedReason ? { reason: trimmedReason, notes: trimmedReason } : {}),
                reference_type: "manual",
            })
            if (created.idempotent_replay) {
                // A previous attempt whose response was lost had already issued it.
                toast.info(`La nota ${String(created.number ?? "")} ya estaba emitida; no se creó otra`)
            } else {
                toast.success("Nota de crédito creada")
            }
            setIdempotencyKey(createClientUuid())
            setCreateOpen(false)
            setClientId("")
            setInvoiceId("")
            setAmount(0)
            setReason("")
        } catch (error) {
            if (isApiError(error) && isRecord(error.body) && error.body.error === "idempotency_key_reused") {
                // That attempt already issued a different note: show it, and let the next
                // save start a new attempt.
                setIdempotencyKey(createClientUuid())
                void queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all })
            }
            showErrorToast("No se pudo crear la nota de crédito", error)
        }
    }

    async function handleAuthorizeCreditNote(cn: CreditNoteRow) {
        try {
            const updated = await authorizeCreditNoteMutation.mutateAsync(cn.id)
            toast.success("Nota de crédito autorizada exitosamente con CAE")
            if (previewCreditNote?.id === cn.id) {
                setPreviewCreditNote(mapCreditNoteRows([updated])[0] ?? null)
            }
        } catch (error) {
            reportArcaAuthorizeError("No se pudo autorizar la nota de crédito", error)
            // The note keeps its new state (rejected with reason, or in verification): refresh list and open preview.
            const refreshed = await creditNotesQuery.refetch()
            const row = refreshed.data?.find((item) => item.id === cn.id)
            if (row && previewCreditNote?.id === cn.id) setPreviewCreditNote(row)
        }
    }

    function retry() {
        void Promise.all([creditNotesQuery.refetch(), clientsQuery.refetch()])
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Notas de crédito</CardTitle>
                <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva nota
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                {hasLoadError ? <QueryErrorBanner onRetry={retry} /> : null}
                {loading ? <QueryLoadingState /> : null}

                {!loading ? (
                    <div className="overflow-x-auto">
                        <Table className="min-w-[760px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Número</TableHead>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead>CAE</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {creditNotes.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                                            Sin notas de crédito.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    creditNotes.map((row) => (
                                        <TableRow key={row.id}>
                                            <TableCell>{new Date(row.created_at).toLocaleDateString("es-AR")}</TableCell>
                                            <TableCell className="font-mono font-bold">
                                                {creditNoteFiscalNumber(row) ?? row.number}
                                                {creditNoteFiscalNumber(row) ? (
                                                    <span className="block text-xs font-normal text-muted-foreground">{row.number}</span>
                                                ) : null}
                                            </TableCell>
                                            <TableCell>
                                                {row.client_name || row.customer_name || "Consumidor Final"}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={row.status === "authorized" ? "default" : "outline"}
                                                    title={isArcaAuthorizing(row.status) ? ARCA_VERIFYING_HELP : undefined}
                                                >
                                                    {creditNoteStatusLabel(row.status)}
                                                </Badge>
                                                {isArcaAuthorizing(row.status) ? (
                                                    <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">{ARCA_VERIFYING_HELP}</p>
                                                ) : null}
                                                <ArcaLastError doc={row} className="mt-1 max-w-[220px]" />
                                            </TableCell>
                                            <TableCell>
                                                {row.cae ? (
                                                    <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                        {row.cae}
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-mono font-bold">
                                                {formatMoney(row.amount)}
                                            </TableCell>
                                            <TableCell className="flex justify-end gap-1 text-right">
                                                {(row.status === "issued" || isArcaAuthorizing(row.status)) && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="border-amber-600/40 text-amber-500 hover:bg-amber-600/10 hover:text-amber-600"
                                                        onClick={() => void handleAuthorizeCreditNote(row)}
                                                        disabled={authorizeCreditNoteMutation.isPending}
                                                        title="Autorizar con ARCA/AFIP"
                                                    >
                                                        {arcaAuthorizeButtonLabel(row.status, "Autorizar")}
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    title="Ver detalles"
                                                    onClick={() => {
                                                        setPreviewCreditNote(row)
                                                        setPreviewOpen(true)
                                                    }}
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    title="Imprimir A4"
                                                    onClick={() => onPrintCreditNote(row, "a4")}
                                                >
                                                    <Printer className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    title="Imprimir Ticket (80mm)"
                                                    onClick={() => onPrintCreditNote(row, "thermal")}
                                                >
                                                    <ReceiptText className="h-4 w-4 text-slate-400" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                ) : null}
            </CardContent>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Nueva nota de crédito</DialogTitle>
                        <DialogDescription>Emití una nota manual para el cliente seleccionado.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label>Cliente</Label>
                            <Select
                                value={clientId}
                                onValueChange={(value) => {
                                    setClientId(value)
                                    setInvoiceId("")
                                }}
                            >
                                <SelectTrigger aria-label="Cliente">
                                    <SelectValue placeholder="Seleccionar" />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Factura que corrige</Label>
                            <Select value={invoiceId} onValueChange={setInvoiceId} disabled={!clientId}>
                                <SelectTrigger aria-label="Factura que corrige">
                                    <SelectValue
                                        placeholder={
                                            !clientId
                                                ? "Elegí primero el cliente"
                                                : clientInvoicesQuery.isLoading
                                                    ? "Cargando facturas…"
                                                    : clientInvoices.length === 0
                                                        ? "El cliente no tiene facturas"
                                                        : "Seleccionar factura"
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {clientInvoices.map((invoice) => (
                                        <SelectItem key={invoice.id} value={invoice.id}>
                                            {invoice.invoice_type ?? ""} {String(invoice.point_of_sale ?? 1).padStart(4, "0")}-
                                            {String(invoice.invoice_number ?? "").padStart(8, "0")} · {formatMoney(invoice.total_amount)}
                                            {invoice.cae ? "" : " · sin CAE"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                La nota se autoriza en ARCA asociada a esta factura y no puede superar su saldo acreditable.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label>Monto</Label>
                            <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={amount}
                                onChange={(event) => setAmount(Number(event.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Motivo</Label>
                            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
                        </div>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void handleCreateCreditNote()} disabled={createCreditNoteMutation.isPending}>
                            Guardar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <CreditNotePreviewDialog
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                creditNote={previewCreditNote}
                companyName={companyName}
                companyTaxId={companyTaxId}
                companyAddress={companyAddress}
                taxRateLabel={taxRateLabel}
                onClose={() => setPreviewOpen(false)}
                onAuthorize={handleAuthorizeCreditNote}
                companySettings={companySettings}
                linkedReturn={linkedReturn}
            />
        </Card>
    )
}
