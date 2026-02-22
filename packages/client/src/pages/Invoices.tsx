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
import { calculateDraftTotal } from "@/components/invoices/invoiceUtils"
import type { DraftInvoice, DraftInvoiceItem, InvoiceView } from "@/components/invoices/types"

export default function InvoicesPage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const [invoices, setInvoices] = useState<InvoiceView[]>([])
    const [loading, setLoading] = useState(true)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [selectedInvoice, setSelectedInvoice] = useState<InvoiceView | null>(null)
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
        setSelectedInvoice(invoice)
        setTimeout(() => window.print(), 200)
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
            />

            <PrintableInvoiceArea
                invoice={selectedInvoice}
                companyName={companyName}
                companyTaxId={companyTaxId}
                companyAddress={companyAddress}
                taxRateLabel={taxRateLabel}
            />
        </div>
    )
}
