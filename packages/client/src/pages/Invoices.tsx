import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { toast } from "sonner"
import { api } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
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
    const [invoices, setInvoices] = useState<InvoiceView[]>([])
    const [loading, setLoading] = useState(true)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
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
    const emailFeatureEnabled = import.meta.env.VITE_ENABLE_INVOICE_EMAIL === "true"
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
        setDraftInvoice((prev) => ({ ...prev, items: [...prev.items, { ...manualItem }] }))
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
        }
    }

    const handleSendEmail = (invoice: InvoiceView) => {
        // TODO: Integrar con endpoint backend real de envío de comprobantes.
        if (!emailFeatureEnabled) {
            toast.info("Envío por email en modo simulación", {
                description: `No hay integración activa. Destinatario estimado: ${invoice.client_snapshot?.email || "cliente sin email"}.`,
            })
            return
        }

        toast.warning("Integración de email pendiente", {
            description: "Activaste la feature flag, pero aún falta implementar el endpoint de envío.",
        })
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

    const handlePrintInvoice = (invoice: InvoiceView) => {
        setActivePrintLayout("a4")
        setSelectedInvoice(invoice)
        setTimeout(() => window.print(), 200)
    }

    const handlePrintThermal = (invoice: InvoiceView) => {
        setActivePrintLayout("thermal")
        setSelectedInvoice(invoice)
        setTimeout(() => window.print(), 200)
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

    const handleAuthorizeInvoice = async (invoice: InvoiceView) => {
        try {
            const updatedInvoice = await api.authorizeInvoice(invoice.id)
            toast.success("Factura autorizada exitosamente con CAE")
            
            // Update selected invoice to show CAE immediately in the open preview modal
            setSelectedInvoice(updatedInvoice as InvoiceView)
            
            // Reload the list of invoices
            void loadData()
        } catch (error) {
            showErrorToast("Error al autorizar factura", error)
            throw error
        }
    }

    const taxRateLabel = `IVA (${getTaxRatePercentage(companySettings)}%)`
    const companyName = getCompanyDisplayName(companySettings)
    const companyTaxId = companySettings.identity.tax_id || "No informado"
    const companyAddress = getCompanyAddressLine(companySettings)

    return (
        <div className="space-y-6 p-6 print:hidden">
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
                    onDraftChange={setDraftInvoice}
                    onManualItemChange={setManualItem}
                    onAddItem={addDraftItem}
                    onCreateInvoice={handleCreateInvoice}
                />
            </div>

            <InvoicesTable
                invoices={visibleInvoices}
                loading={loading}
                onRefresh={loadData}
                onPreview={handleOpenPreview}
                onSendEmail={handleSendEmail}
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
                onSendEmail={handleSendEmail}
                onClose={() => setIsPreviewOpen(false)}
                onAuthorize={handleAuthorizeInvoice}
                companySettings={companySettings}
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
