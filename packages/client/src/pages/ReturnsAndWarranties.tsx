import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileText, RotateCcw, ShieldCheck, Truck, BarChart3 } from "lucide-react"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { 
    fetchCompanySettingsSafe, 
    DEFAULT_COMPANY_SETTINGS, 
    getCompanyAddressLine, 
    getCompanyDisplayName, 
    getTaxRatePercentage 
} from "@/lib/companySettings"
import { PrintableCreditNoteArea } from "@/components/invoices/PrintableCreditNoteArea"
import { PrintableThermalCreditNote } from "@/components/invoices/PrintableThermalCreditNote"
import type { CompanySettings } from "@/types"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// Extracted Tab Components
import { WarrantiesTab } from "@/components/returns/WarrantiesTab"
import { ReturnsTab } from "@/components/returns/ReturnsTab"
import { SupplierReturnsTab } from "@/components/returns/SupplierReturnsTab"
import { CreditNotesTab } from "@/components/returns/CreditNotesTab"
import { AnalyticsTab } from "@/components/returns/AnalyticsTab"

// Helpers and Types
import { mapClientReturnRows } from "@/components/returns/helpers"
import type { CreditNoteRow } from "@/types/returns"

export default function ReturnsAndWarrantiesPage() {
    const [companySettings, setCompanySettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS)
    const [selectedCreditNote, setSelectedCreditNote] = useState<CreditNoteRow | null>(null)
    const [activePrintLayout, setActivePrintLayout] = useState<"a4" | "thermal" | null>(null)

    useEffect(() => {
        void fetchCompanySettingsSafe().then(setCompanySettings)
    }, [])

    const returnsQuery = useQuery({
        queryKey: queryKeys.clientReturns.all,
        queryFn: async () => mapClientReturnRows(await api.getClientReturns()),
    })
    const returns = returnsQuery.data || []

    const linkedReturn = selectedCreditNote
        ? returns.find((r) => r.id === selectedCreditNote.reference_id) ?? null
        : null

    const companyName = getCompanyDisplayName(companySettings)
    const companyTaxId = companySettings.identity.tax_id || "No informado"
    const companyAddress = getCompanyAddressLine(companySettings)
    const taxRateLabel = `IVA (${getTaxRatePercentage(companySettings)}%)`

    return (
        <div className="space-y-6 print:hidden">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Devoluciones y garantías</h2>
                <p className="text-muted-foreground">Gestión de reclamos, devoluciones y notas de crédito.</p>
            </div>

            <Tabs defaultValue="warranties" className="space-y-4">
                <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto p-1">
                    <TabsTrigger value="warranties" className="shrink-0 gap-2">
                        <ShieldCheck className="h-4 w-4" />
                        Garantías
                    </TabsTrigger>
                    <TabsTrigger value="returns" className="shrink-0 gap-2">
                        <RotateCcw className="h-4 w-4" />
                        Devoluciones (Clientes)
                    </TabsTrigger>
                    <TabsTrigger value="supplier-returns" className="shrink-0 gap-2">
                        <Truck className="h-4 w-4" />
                        Devoluciones a Proveedores
                    </TabsTrigger>
                    <TabsTrigger value="credits" className="shrink-0 gap-2">
                        <FileText className="h-4 w-4" />
                        Notas de crédito
                    </TabsTrigger>
                    <TabsTrigger value="analytics" className="shrink-0 gap-2">
                        <BarChart3 className="h-4 w-4" />
                        Estadísticas
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="warranties">
                    <WarrantiesTab />
                </TabsContent>
                <TabsContent value="returns">
                    <ReturnsTab />
                </TabsContent>
                <TabsContent value="supplier-returns">
                    <SupplierReturnsTab />
                </TabsContent>
                <TabsContent value="credits">
                    <CreditNotesTab
                        companySettings={companySettings}
                        onPrintCreditNote={(cn, layout) => {
                            setActivePrintLayout(layout)
                            setSelectedCreditNote(cn)
                            setTimeout(() => window.print(), 200)
                        }}
                        linkedReturn={linkedReturn}
                        companyName={companyName}
                        companyTaxId={companyTaxId}
                        companyAddress={companyAddress}
                        taxRateLabel={taxRateLabel}
                    />
                </TabsContent>
                <TabsContent value="analytics">
                    <AnalyticsTab />
                </TabsContent>
            </Tabs>

            {activePrintLayout === "a4" && selectedCreditNote && (
                <PrintableCreditNoteArea
                    creditNote={selectedCreditNote}
                    companyName={companyName}
                    companyTaxId={companyTaxId}
                    companyAddress={companyAddress}
                    taxRateLabel={taxRateLabel}
                    companySettings={companySettings}
                    linkedReturn={linkedReturn}
                />
            )}

            {activePrintLayout === "thermal" && selectedCreditNote && (
                <PrintableThermalCreditNote
                    creditNote={selectedCreditNote}
                    companyName={companyName}
                    companyTaxId={companyTaxId}
                    companyAddress={companyAddress}
                    companySettings={companySettings}
                    linkedReturn={linkedReturn}
                />
            )}
        </div>
    )
}
