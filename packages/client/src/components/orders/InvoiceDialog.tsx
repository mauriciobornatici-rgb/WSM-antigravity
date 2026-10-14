import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchCompanySettingsSafe } from "@/lib/companySettings"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { formatMoney } from "@/lib/formatters"
import { grossLineTotal, grossPrice } from "@/lib/pricing"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import type { Order } from "@/types"
import type { InvoiceType } from "@/types/orders"
import { suggestedInvoiceLetter, taxConditionName } from "@/lib/taxConditions"
import { ClientTaxConditionNotice } from "@/components/clients/ClientTaxConditionNotice"

interface InvoiceDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    order: Order | null
    onInvoiceCreated: (invoiceId: string) => void
}

const INVOICE_TYPES: Array<{ value: InvoiceType; label: string }> = [
    { value: "A", label: "Factura A" },
    { value: "B", label: "Factura B" },
    { value: "C", label: "Factura C" },
    { value: "TK", label: "Ticket" },
]

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

// Same rules as the server invoice (sales.service createInvoice, ADR-016): once picking
// started only picked units are billed, a discount keeps its percentage over what was picked
// of its VAT rate (never more than those products), shipping and surcharges are billed whole.
function getInvoiceTotal(order: Order): number {
    const items = order.items || []
    const anyPicked = items.some((item) => Number(item.picked_quantity || 0) > 0)
    const ordered = new Map<number, number>()
    const billed = new Map<number, number>()
    for (const item of items) {
        const rate = item.vat_rate == null ? 21 : Number(item.vat_rate)
        ordered.set(rate, (ordered.get(rate) || 0) + grossLineTotal(item.quantity, item.unit_price, item.vat_rate))
        const quantity = anyPicked ? Number(item.picked_quantity || 0) : Number(item.quantity)
        billed.set(rate, (billed.get(rate) || 0) + grossLineTotal(quantity, item.unit_price, item.vat_rate))
    }
    let total = round2([...billed.values()].reduce((sum, value) => sum + value, 0))
    // Shipping paid by the business (billable=false) is neither charged nor invoiced.
    const adjustments = (order.adjustments || []).filter((adjustment) => adjustment.billable !== false)
    const orderedTotal = round2([...ordered.values()].reduce((sum, value) => sum + value, 0))
    const external = Boolean(order.external_source) && order.external_source !== "pos"
    if (external && adjustments.length === 0 && Math.abs(total - orderedTotal) < 0.005) {
        // Channel orders imported before ADR-016: the invoice matches what the customer paid.
        return round2(Number(order.total_amount || total))
    }
    // Charges first: a discount on the shipping can use the shipping line as room.
    const picked = new Map(billed)
    const sorted = [...adjustments].sort((a, b) => Number(b.amount) - Number(a.amount))
    for (const adjustment of sorted) {
        const rate = Number(adjustment.vat_rate)
        let amount = round2(Number(adjustment.amount || 0))
        if (amount > 0) {
            billed.set(rate, (billed.get(rate) || 0) + amount)
        } else if (amount < 0) {
            const orderedGross = ordered.get(rate) || 0
            const pickedGross = picked.get(rate) || 0
            const available = round2(billed.get(rate) || 0)
            // A shipping discount follows the shipping, billed whole on a partial delivery.
            if (adjustment.kind !== "shipping_discount" && orderedGross > 0 && pickedGross < orderedGross) {
                amount = round2(amount * pickedGross / orderedGross)
            }
            amount = Math.max(amount, -available)
            billed.set(rate, available + amount)
        }
        total += amount
    }
    return round2(total)
}

export function InvoiceDialog({ open, onOpenChange, order, onInvoiceCreated }: InvoiceDialogProps) {
    const queryClient = useQueryClient()
    // ADR-021: the letter starts from the customer's VAT condition, and a choice is kept per order.
    const [choice, setChoice] = useState<{ orderId: string; type: InvoiceType } | null>(null)
    // Same rule as the POS: a monotributista company issues C, so nothing is suggested then.
    const companySettings = useQuery({ queryKey: queryKeys.companySettings, queryFn: fetchCompanySettingsSafe, staleTime: 5 * 60_000 })
    // A condition loaded here (ADR-022) applies at once, before the order list refreshes.
    const [loaded, setLoaded] = useState<{ clientId: string; taxConditionId: string; taxId: string } | null>(null)
    const loadedHere = loaded && loaded.clientId === order?.client_id ? loaded : null
    const clientTaxConditionId = loadedHere?.taxConditionId ?? order?.client_tax_condition_id
    const suggestedType: InvoiceType = suggestedInvoiceLetter(clientTaxConditionId, companySettings.data?.billing?.iva_condition) ?? "B"
    const invoiceType: InvoiceType = choice && choice.orderId === order?.id ? choice.type : suggestedType
    const setInvoiceType = (type: InvoiceType) => { if (order) setChoice({ orderId: order.id, type }) }
    const clientTaxCondition = taxConditionName(clientTaxConditionId)
    const letterIsSuggested = !(choice && choice.orderId === order?.id)
        && suggestedInvoiceLetter(clientTaxConditionId, companySettings.data?.billing?.iva_condition) !== null
    // A Factura A needs a customer with CUIT: the server refuses it otherwise (AUD-009).
    const clientTaxId = loadedHere?.taxId ?? order?.client_tax_id ?? ""
    const invoiceCuitError = invoiceType === "A" && String(clientTaxId).replace(/\D/g, "").length !== 11

    const createInvoiceMutation = useMutation({
        mutationFn: ({ orderId, payload }: { orderId: string; payload: Parameters<typeof api.createInvoiceFromOrder>[1] }) =>
            api.createInvoiceFromOrder(orderId, payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
        },
    })

    const invoiceTotalAmount = order ? getInvoiceTotal(order) : 0

    async function submitInvoice() {
        if (!order) return
        try {
            const createdInvoice = await createInvoiceMutation.mutateAsync({
                orderId: order.id,
                payload: {
                    invoice_type: invoiceType,
                },
            })
            toast.success("Factura creada")
            onOpenChange(false)
            if (createdInvoice?.id) {
                onInvoiceCreated(String(createdInvoice.id))
            }
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Facturar pedido</DialogTitle>
                    <DialogDescription>Emite la factura y deja el saldo pendiente para cobrar luego.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="flex flex-col gap-1 rounded-md border bg-muted/20 p-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <span className="text-muted-foreground">Cliente: </span>
                            <strong className="text-foreground">{order?.customer_name || order?.client_name || "Consumidor final"}</strong>
                            {clientTaxCondition ? <span className="text-muted-foreground"> · {clientTaxCondition}</span> : null}
                        </div>
                        {order?.id ? (
                            <div className="text-muted-foreground">
                                Pedido: <span className="font-mono text-foreground font-semibold">#{order.id.slice(0, 8)}</span>
                            </div>
                        ) : null}
                    </div>

                    <ClientTaxConditionNotice
                        client={order?.client_id ? {
                            id: order.client_id,
                            name: order.client_name || order.customer_name || "El cliente",
                            tax_id: loadedHere?.taxId ?? order.client_tax_id ?? "",
                            tax_condition_id: clientTaxConditionId ?? null,
                        } : null}
                        onUpdated={(client) => {
                            if (order) setChoice(null)
                            setLoaded({ clientId: client.id, taxConditionId: client.tax_condition_id || "", taxId: client.tax_id || "" })
                            void queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
                        }}
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="order-invoice-type">Tipo de factura</Label>
                            <Select value={invoiceType} onValueChange={(value) => setInvoiceType(value as InvoiceType)}>
                                <SelectTrigger id="order-invoice-type">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {INVOICE_TYPES.map((invoiceTypeOption) => (
                                        <SelectItem key={invoiceTypeOption.value} value={invoiceTypeOption.value}>
                                            {invoiceTypeOption.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {letterIsSuggested ? (
                                <p className="text-xs text-muted-foreground">Sugerida por la condición IVA del cliente.</p>
                            ) : null}
                        </div>
                    </div>

                    {invoiceCuitError ? (
                        <p id="order-invoice-cuit-error" role="alert" className="text-xs font-medium text-destructive bg-destructive/10 p-2 rounded border border-destructive/20">
                            La factura A necesita un cliente con CUIT (11 dígitos).
                        </p>
                    ) : null}

                    {/* Detalle de la venta */}
                    <div className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center justify-between">
                            <Label className="text-sm font-semibold">Detalle de la venta</Label>
                            <span className="text-xs text-muted-foreground">
                                {order?.items?.length || 0} {order?.items?.length === 1 ? "ítem" : "ítems"}
                            </span>
                        </div>
                        <div className="max-h-56 overflow-y-auto rounded-md border">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-muted/50 text-muted-foreground border-b sticky top-0">
                                    <tr>
                                        <th className="p-2 font-medium">Producto</th>
                                        <th className="p-2 font-medium text-center">Cant.</th>
                                        <th className="p-2 font-medium text-right">Precio Unit. (IVA incl.)</th>
                                        <th className="p-2 font-medium text-right">Subtotal (IVA incl.)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {order?.items && order.items.length > 0 ? (
                                        order.items.map((item) => {
                                            const billedQty = Number(item.picked_quantity || 0) > 0 ? Number(item.picked_quantity) : Number(item.quantity || 1)
                                            const unitPrice = grossPrice(item.unit_price, item.vat_rate)
                                            const subtotal = grossLineTotal(billedQty, item.unit_price, item.vat_rate)
                                            return (
                                                <tr key={item.id || item.product_id} className="hover:bg-muted/20">
                                                    <td className="p-2">
                                                        <span className="font-medium block text-foreground">{item.product_name || item.product_id}</span>
                                                        {item.sku ? <span className="text-muted-foreground text-[11px]">{item.sku}</span> : null}
                                                    </td>
                                                    <td className="p-2 text-center font-medium">
                                                        {billedQty}
                                                        {Number(item.picked_quantity || 0) > 0 && Number(item.picked_quantity) !== Number(item.quantity) ? (
                                                            <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                                                                (de {item.quantity} ped.)
                                                            </span>
                                                        ) : null}
                                                    </td>
                                                    <td className="p-2 text-right text-muted-foreground">
                                                        {formatMoney(unitPrice)}
                                                    </td>
                                                    <td className="p-2 text-right font-semibold text-foreground">
                                                        {formatMoney(subtotal)}
                                                    </td>
                                                </tr>
                                            )
                                        })
                                    ) : (
                                        <tr>
                                            <td colSpan={4} className="p-3 text-center text-muted-foreground">
                                                Sin productos detallados
                                            </td>
                                        </tr>
                                    )}
                                    {(order?.adjustments ?? []).filter((adjustment) => adjustment.billable !== false).map((adjustment, idx) => (
                                        <tr key={`adjustment-${idx}`} className="bg-muted/20">
                                            <td colSpan={3} className="p-2 font-medium text-foreground">{adjustment.description}</td>
                                            <td className={`p-2 text-right font-semibold ${adjustment.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                                                {adjustment.amount < 0 ? "-" : ""}
                                                {formatMoney(Math.abs(adjustment.amount))}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
                        <div className="flex items-center justify-between text-base">
                            <span className="text-muted-foreground font-medium">Total factura</span>
                            <strong className="text-foreground text-lg">
                                {formatMoney(invoiceTotalAmount)}
                            </strong>
                        </div>
                        <p className="border-t pt-2 text-xs text-muted-foreground">
                            No se registra cobro en este paso. La factura se emite y el cobro se registra en <strong>Cobranzas</strong> (Caja/Efectivo, Tarjeta, Transferencia o Cta Cte).
                        </p>
                    </div>
                </div>
                <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        onClick={() => void submitInvoice()}
                        aria-describedby={invoiceCuitError ? "order-invoice-cuit-error" : undefined}
                        disabled={createInvoiceMutation.isPending || invoiceCuitError}
                    >
                        {createInvoiceMutation.isPending ? "Facturando..." : "Emitir factura"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
