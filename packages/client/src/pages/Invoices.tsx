import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/queryKeys"
import { toast } from "sonner"
import { api } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
import { netFromGross } from "@/lib/pricing"
import { reportArcaAuthorizeError } from "@/lib/arca"
import type { Client, CompanySettings } from "@/types"
import type { InvoiceItem } from "@/types/api"
import {
    DEFAULT_COMPANY_SETTINGS,
    fetchCompanySettingsSafe,
    getCompanyAddressLine,
    getCompanyDisplayName,
    getTaxRatePercentage,
} from "@/lib/companySettings"
import { InvoiceCreateDialog } from "@/components/invoices/InvoiceCreateDialog"
import { InvoicesTable } from "@/components/invoices/InvoicesTable"
import { InvoicePreviewDialog } from "@/components/invoices/InvoicePreviewDialog"
import { PrintableInvoiceArea } from "@/components/invoices/PrintableInvoiceArea"
import { PrintableThermalTicket } from "@/components/invoices/PrintableThermalTicket"
import { calculateDraftTotal } from "@/components/invoices/invoiceUtils"
import type { DraftInvoice, DraftInvoiceItem, InvoiceView } from "@/components/invoices/types"

export default function InvoicesPage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const queryClient = useQueryClient()
    const [invoices, setInvoices] = useState<InvoiceView[]>([])
    const [loading, setLoading] = useState(true)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isCreating, setIsCreating] = useState(false)
    const creatingRef = useRef(false)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [selectedInvoice, setSelectedInvoice] = useState<InvoiceView | null>(null)
    const [activePrintLayout, setActivePrintLayout] = useState<'a4' | 'thermal' | null>(null)
    const [clients, setClients] = useState<Client[]>([])
    const [companySettings, setCompanySettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS)
    const [draftInvoice, setDraftInvoice] = useState<DraftInvoice>({
        client_id: "",
        invoice_type: "B",
        point_of_sale: 1,
        items: [],
        notes: "",
    })
    const [manualItem, setManualItem] = useState<DraftInvoiceItem>({
        description: "",
        quantity: 1,
        unit_price: 0,
        vat_rate: getTaxRatePercentage(DEFAULT_COMPANY_SETTINGS),
    })
    const invoiceIdFilter = (searchParams.get("invoice_id") || "").trim()
    const visibleInvoices = useMemo(() => {
        if (!invoiceIdFilter) return invoices
        return invoices.filter((invoice) => String(invoice.id) === invoiceIdFilter)
    }, [invoices, invoiceIdFilter])

    useEffect(() => {
        void loadData()
    }, [])

    const loadData = async () => {
        setLoading(true)
        try {
            const [invoicesData, clientsData, settings] = await Promise.all([
                api.getInvoices(),
                api.getClients(),
                fetchCompanySettingsSafe(),
            ])
            setInvoices(invoicesData as InvoiceView[])
            setClients(clientsData)
            setCompanySettings(settings)
            setManualItem((prev) => ({ ...prev, vat_rate: getTaxRatePercentage(settings) }))
        } catch (error) {
            showErrorToast("Error cargando historial", error)
        } finally {
            setLoading(false)
        }
    }

    const addDraftItem = () => {
        if (!manualItem.description || manualItem.unit_price <= 0) return
        if (!(manualItem.quantity > 0)) {
            toast.error("La cantidad debe ser mayor a 0")
            return
        }
        // The price is typed as the final one (VAT included); the draft keeps the net price the server expects (ADR-015).
        const netItem = { ...manualItem, unit_price: netFromGross(manualItem.unit_price, manualItem.vat_rate) }
        setDraftInvoice((prev) => ({ ...prev, items: [...prev.items, netItem] }))
        setManualItem({
            description: "",
            quantity: 1,
            unit_price: 0,
            vat_rate: getTaxRatePercentage(companySettings),
        })
    }

    const resetDraftInvoice = () => {
        setDraftInvoice({
            client_id: "",
            invoice_type: "B",
            point_of_sale: 1,
            items: [],
            notes: "",
        })
    }

    const handleCreateInvoice = async () => {
        if (creatingRef.current) return
        creatingRef.current = true
        setIsCreating(true)
        try {
            if (!draftInvoice.client_id) {
                toast.error("Seleccione un cliente")
                return
            }
            if (draftInvoice.items.length === 0) {
                toast.error("Agregue al menos un ítem")
                return
            }

            await api.createInvoice(draftInvoice)
            toast.success("Factura emitida exitosamente")
            setIsCreateOpen(false)
            resetDraftInvoice()
            void loadData()
        } catch (error) {
            showErrorToast("Error al emitir factura", error)
        } finally {
            creatingRef.current = false
            setIsCreating(false)
        }
    }

    const handleOpenPreview = async (invoice: InvoiceView) => {
        try {
            if (invoice.items && invoice.items.length > 0) {
                setSelectedInvoice(invoice)
                setIsPreviewOpen(true)
                return
            }

            const items = await api.getInvoiceItems(invoice.id)
            setSelectedInvoice({ ...invoice, items: items as InvoiceItem[] })
            setIsPreviewOpen(true)
        } catch (error) {
            showErrorToast("No se pudieron cargar los ítems de la factura", error)
            setSelectedInvoice(invoice)
            setIsPreviewOpen(true)
        }
    }

    const prepareAndPrint = async (invoice: InvoiceView, layout: "a4" | "thermal") => {
        try {
            const items = invoice.items?.length ? invoice.items : await api.getInvoiceItems(invoice.id)
            setSelectedInvoice({ ...invoice, items: items as InvoiceItem[] })
            setActivePrintLayout(layout)
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
            window.print()
            const cleanup = () => {
                setActivePrintLayout(null)
                window.removeEventListener("afterprint", cleanup)
            }
            window.addEventListener("afterprint", cleanup)
            setTimeout(cleanup, 1000)
        } catch (error) {
            showErrorToast("No se pudo preparar el comprobante para imprimir", error)
        }
    }

    const handlePrintInvoice = (invoice: InvoiceView) => {
        void prepareAndPrint(invoice, "a4")
    }

    const handlePrintThermal = (invoice: InvoiceView) => {
        void prepareAndPrint(invoice, "thermal")
    }

    const handleExportLibroIVA = () => {
        if (visibleInvoices.length === 0) {
            toast.info("No hay facturas para exportar")
            return
        }

        // Define CSV headers
        const headers = [
            "Fecha",
            "Tipo",
            "Punto de Venta",
            "Nro Comprobante",
            "CUIT/DNI Receptor",
            "Razón Social / Nombre",
            "Neto Gravado",
            "IVA Liquidado",
            "Total",
            "CAE",
        ]

        // Map visibleInvoices to rows
        const rows = visibleInvoices.map((inv) => {
            const dateStr = inv.issue_date ? new Date(inv.issue_date).toLocaleDateString("es-AR") : ""
            const typeStr = inv.invoice_type || ""
            const posStr = String(inv.point_of_sale || 1).padStart(4, "0")
            const numStr = inv.invoice_number ? String(inv.invoice_number).padStart(8, "0") : ""
            const clientCuit = inv.client_tax_id || ""
            const clientName = inv.client_name || ""
            const netVal = Number(inv.net_amount || 0).toFixed(2)
            const ivaVal = Number(inv.vat_amount || 0).toFixed(2)
            const totalVal = Number(inv.total_amount || 0).toFixed(2)
            const caeVal = inv.cae || ""

            return [
                dateStr,
                typeStr,
                posStr,
                numStr,
                clientCuit,
                clientName,
                netVal,
                ivaVal,
                totalVal,
                caeVal,
            ]
        })

        // Combine headers and rows
        const csvContent = [
            headers.join(";"),
            ...rows.map((row) => row.map((val) => {
                const str = String(val)
                if (str.includes(";") || str.includes('"')) {
                    return `"${str.replace(/"/g, '""')}"`
                }
                return str
            }).join(";")),
        ].join("\n")

        // Prepend UTF-8 Byte Order Mark (\uFEFF) for Excel
        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.setAttribute("href", url)
        link.setAttribute("download", `Libro_IVA_Ventas_${new Date().toISOString().substring(0, 10)}.csv`)
        link.style.visibility = "hidden"
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        
        toast.success("Libro IVA exportado exitosamente")
    }

    // ADR-022: annul an invoice ARCA never authorized and issue it again.
    const handleReissueInvoice = async (invoice: InvoiceView, data: { invoice_type: "A" | "B" | "C" | "TK"; client_id: string | null }) => {
        try {
            const reissued = await api.reissueInvoice(invoice.id, data)
            toast.success("Factura anulada y emitida de nuevo", { description: "Ahora podés autorizarla con ARCA." })
            setSelectedInvoice(reissued as InvoiceView)
            if (invoiceIdFilter === invoice.id) setSearchParams({ invoice_id: String(reissued.id) })
            void loadData()
            void queryClient.invalidateQueries({ queryKey: queryKeys.arcaAlerts })
        } catch (error) {
            showErrorToast("No se pudo volver a emitir la factura", error)
            throw error
        }
    }

    const handleAuthorizeInvoice = async (invoice: InvoiceView) => {
        // Any attempt can settle or raise an ARCA alert (dashboard and menu).
        const refreshArcaAlerts = () => void queryClient.invalidateQueries({ queryKey: queryKeys.arcaAlerts })
        try {
            const updatedInvoice = await api.authorizeInvoice(invoice.id)
            toast.success("Factura autorizada exitosamente con CAE")
            
            // Update selected invoice to show CAE immediately in the open preview modal
            setSelectedInvoice(updatedInvoice as InvoiceView)
            
            // Reload the list of invoices
            void loadData()
            refreshArcaAlerts()
        } catch (error) {
            reportArcaAuthorizeError("Error al autorizar factura", error)
            refreshArcaAlerts()
            // The invoice keeps its new state (rejected with reason, or in verification): refresh list and open preview.
            try {
                const [refreshed, fresh] = await Promise.all([api.getInvoices(), api.getInvoice(invoice.id)])
                setInvoices(refreshed as InvoiceView[])
                setSelectedInvoice((prev) => (prev?.id === invoice.id ? { ...prev, ...(fresh as InvoiceView) } : prev))
            } catch {
                // The list refresh is best effort; the authorize error was already reported.
            }
            throw error
        }
    }

    const taxRateLabel = `IVA (${getTaxRatePercentage(companySettings)}%)`
    const companyName = getCompanyDisplayName(companySettings)
    const companyTaxId = companySettings.identity.tax_id || "No informado"
    const companyAddress = getCompanyAddressLine(companySettings)

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Historial de ventas</h1>
                    <p className="text-muted-foreground">Consulta de facturas legales y tickets de venta emitidos.</p>
                </div>
                <InvoiceCreateDialog
                    open={isCreateOpen}
                    onOpenChange={setIsCreateOpen}
                    clients={clients}
                    draftInvoice={draftInvoice}
                    manualItem={manualItem}
                    total={calculateDraftTotal(draftInvoice)}
                    isSubmitting={isCreating}
                    onDraftChange={setDraftInvoice}
                    onManualItemChange={setManualItem}
                    onAddItem={addDraftItem}
                    onCreateInvoice={handleCreateInvoice}
                    companyIvaCondition={companySettings.billing?.iva_condition}
                    onClientUpdated={(client) => setClients((current) => current.map((candidate) => (candidate.id === client.id ? { ...candidate, ...client } : candidate)))}
                />
            </div>

            <InvoicesTable
                invoices={visibleInvoices}
                loading={loading}
                onRefresh={loadData}
                onPreview={handleOpenPreview}
                onPrint={handlePrintInvoice}
                onExportCSV={handleExportLibroIVA}
                onPrintThermal={handlePrintThermal}
            />
            {invoiceIdFilter ? (
                <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <span>
                            Mostrando factura puntual para el comprobante: <strong>{invoiceIdFilter}</strong>
                        </span>
                        <button
                            type="button"
                            className="text-sm underline underline-offset-2"
                            onClick={() => {
                                const next = new URLSearchParams(searchParams)
                                next.delete("invoice_id")
                                setSearchParams(next)
                            }}
                        >
                            Ver todas
                        </button>
                    </div>
                </div>
            ) : null}

            <InvoicePreviewDialog
                open={isPreviewOpen}
                onOpenChange={setIsPreviewOpen}
                invoice={selectedInvoice}
                companyName={companyName}
                companyTaxId={companyTaxId}
                companyAddress={companyAddress}
                taxRateLabel={taxRateLabel}
                onClose={() => setIsPreviewOpen(false)}
                onAuthorize={handleAuthorizeInvoice}
                clients={clients}
                onReissue={handleReissueInvoice}
                companySettings={companySettings}
                onPrint={handlePrintInvoice}
                onPrintThermal={handlePrintThermal}
            />

            {activePrintLayout === "a4" && selectedInvoice && (
                <PrintableInvoiceArea
                    invoice={selectedInvoice}
                    companyName={companyName}
                    companyTaxId={companyTaxId}
                    companyAddress={companyAddress}
                    taxRateLabel={taxRateLabel}
                    companySettings={companySettings}
                />
            )}

            {activePrintLayout === "thermal" && selectedInvoice && (
                <PrintableThermalTicket
                    invoice={selectedInvoice}
                    companyName={companyName}
                    companyTaxId={companyTaxId}
                    companyAddress={companyAddress}
                    companySettings={companySettings}
                />
            )}
        </div>
    )
}
