import { Plus } from "lucide-react"
import type { Client } from "@/types"
import { formatMoney } from "@/lib/formatters"
import { grossLineTotal, grossPrice } from "@/lib/pricing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { DraftInvoice, DraftInvoiceItem } from "./types"
import { suggestedInvoiceLetter } from "@/lib/taxConditions"
import { ClientTaxConditionNotice } from "@/components/clients/ClientTaxConditionNotice"

type InvoiceCreateDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    clients: Client[]
    draftInvoice: DraftInvoice
    manualItem: DraftInvoiceItem
    total: number
    isSubmitting?: boolean
    onDraftChange: (invoice: DraftInvoice) => void
    onManualItemChange: (item: DraftInvoiceItem) => void
    onAddItem: () => void
    onCreateInvoice: () => void
    companyIvaCondition?: string | null | undefined
    onClientUpdated?: (client: Client) => void
}

export function InvoiceCreateDialog({
    open,
    onOpenChange,
    clients,
    draftInvoice,
    manualItem,
    total,
    isSubmitting = false,
    onDraftChange,
    onManualItemChange,
    onAddItem,
    onCreateInvoice,
    companyIvaCondition,
    onClientUpdated,
}: InvoiceCreateDialogProps) {
    const quantityInvalid = !(manualItem.quantity > 0)
    const selectedClient = clients.find((client) => client.id === draftInvoice.client_id) ?? null
    // ADR-021/022: the letter follows the customer's VAT condition (it can still be changed).
    function selectClient(clientId: string, list: Client[] = clients) {
        const client = list.find((candidate) => candidate.id === clientId)
        const letter = suggestedInvoiceLetter(client?.tax_condition_id, companyIvaCondition)
        onDraftChange({ ...draftInvoice, client_id: clientId, ...(letter ? { invoice_type: letter } : {}) })
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button className="bg-primary">
                    <Plus className="mr-2 h-4 w-4" />
                    Factura manual
                </Button>
            </DialogTrigger>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-[800px]">
                <DialogHeader>
                    <DialogTitle>Nueva factura de venta</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="manual-invoice-client">Cliente</Label>
                            <Select
                                value={draftInvoice.client_id}
                                onValueChange={(value) => selectClient(value)}
                            >
                                <SelectTrigger id="manual-invoice-client">
                                    <SelectValue placeholder="Seleccionar cliente" />
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
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="manual-invoice-type">Tipo</Label>
                                <Select
                                    value={draftInvoice.invoice_type}
                                    onValueChange={(value) => onDraftChange({ ...draftInvoice, invoice_type: value as "A" | "B" })}
                                >
                                    <SelectTrigger id="manual-invoice-type">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="A">Factura A</SelectItem>
                                        <SelectItem value="B">Factura B</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Pto. venta</Label>
                                <Input value={draftInvoice.point_of_sale} disabled className="bg-muted" />
                            </div>
                        </div>
                    </div>

                    {onClientUpdated ? (
                        <ClientTaxConditionNotice
                            client={selectedClient}
                            onUpdated={(client) => {
                                onClientUpdated(client)
                                selectClient(client.id, clients.map((candidate) => (candidate.id === client.id ? { ...candidate, ...client } : candidate)))
                            }}
                        />
                    ) : null}

                    <div className="space-y-4 rounded-md border bg-slate-50 p-4 dark:bg-slate-900/50">
                        <div className="overflow-x-auto">
                        <Table className="min-w-[560px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Descripción</TableHead>
                                    <TableHead className="w-20">Cant.</TableHead>
                                    <TableHead>Precio unit. (IVA incl.)</TableHead>
                                    <TableHead className="text-right">Total (IVA incl.)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {draftInvoice.items.map((item, index) => (
                                    <TableRow key={index}>
                                        <TableCell>{item.description}</TableCell>
                                        <TableCell>{item.quantity}</TableCell>
                                        <TableCell>{formatMoney(grossPrice(item.unit_price, item.vat_rate))}</TableCell>
                                        <TableCell className="text-right">
                                            {formatMoney(grossLineTotal(item.quantity, item.unit_price, item.vat_rate))}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                            <div className="col-span-1 sm:col-span-6">
                                <Input
                                    aria-label="Descripción del ítem"
                                    placeholder="Descripción..."
                                    value={manualItem.description}
                                    onChange={(event) =>
                                        onManualItemChange({
                                            ...manualItem,
                                            description: event.target.value,
                                        })
                                    }
                                />
                            </div>
                            <div className="col-span-1 sm:col-span-2">
                                <Input
                                    type="number"
                                    aria-label="Cantidad"
                                    aria-invalid={quantityInvalid}
                                    aria-describedby={quantityInvalid ? "manual-item-quantity-error" : undefined}
                                    value={manualItem.quantity}
                                    onChange={(event) =>
                                        onManualItemChange({
                                            ...manualItem,
                                            quantity: Number(event.target.value),
                                        })
                                    }
                                />
                            </div>
                            <div className="col-span-1 sm:col-span-2">
                                <Input
                                    type="number"
                                    aria-label="Precio unitario final (IVA incluido)"
                                    placeholder="Precio final c/IVA"
                                    value={manualItem.unit_price}
                                    onChange={(event) =>
                                        onManualItemChange({
                                            ...manualItem,
                                            unit_price: Number(event.target.value),
                                        })
                                    }
                                />
                            </div>
                            <div className="col-span-1 sm:col-span-2">
                                <Button variant="secondary" className="w-full" onClick={onAddItem} disabled={quantityInvalid}>
                                    Agregar
                                </Button>
                            </div>
                        </div>
                        {quantityInvalid ? (
                            <p id="manual-item-quantity-error" role="alert" className="text-sm font-medium text-destructive">
                                La cantidad debe ser mayor a 0
                            </p>
                        ) : null}
                    </div>

                    <div className="flex justify-end text-xl font-bold">Total (IVA incl.): {formatMoney(total)}</div>
                </div>
                <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button onClick={onCreateInvoice} disabled={isSubmitting}>
                        {isSubmitting ? "Emitiendo..." : "Emitir factura"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

