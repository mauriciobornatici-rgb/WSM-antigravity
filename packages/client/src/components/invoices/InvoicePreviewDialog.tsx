import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InvoiceDocument } from "./InvoiceDocument"
import type { InvoiceView } from "./types"
import type { Client, CompanySettings } from "@/types"
import { InvoiceReissuePanel } from "./InvoiceReissuePanel"

type InvoicePreviewDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    invoice: InvoiceView | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    onSendEmail?: ((invoice: InvoiceView) => void) | undefined
    onClose: () => void
    onAuthorize?: (invoice: InvoiceView) => void | Promise<void>
    companySettings?: CompanySettings
    onPrint?: (invoice: InvoiceView) => void
    onPrintThermal?: (invoice: InvoiceView) => void
    clients?: Client[]
    onReissue?: (invoice: InvoiceView, data: { invoice_type: "A" | "B" | "C" | "TK"; client_id: string | null }) => Promise<void>
}

export function InvoicePreviewDialog({
    open,
    onOpenChange,
    invoice,
    companyName,
    companyTaxId,
    companyAddress,
    taxRateLabel,
    onSendEmail,
    onClose,
    onAuthorize,
    companySettings,
    onPrint,
    onPrintThermal,
    clients = [],
    onReissue,
}: InvoicePreviewDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="no-print h-[90vh] max-w-[800px] overflow-y-auto border-none bg-white text-slate-900 print:hidden">
                <DialogHeader className="sr-only">
                    <DialogTitle>Previsualización de comprobante</DialogTitle>
                </DialogHeader>
                {invoice && onReissue ? (
                    <InvoiceReissuePanel
                        key={invoice.id}
                        invoice={invoice}
                        clients={clients}
                        companyIvaCondition={companySettings?.billing?.iva_condition}
                        onReissue={onReissue}
                    />
                ) : null}
                {invoice?.replaces_label ? (
                    <p className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                        Reemplaza a la factura {invoice.replaces_label}, anulada sin autorizar.
                    </p>
                ) : null}
                {invoice ? (
                    <InvoiceDocument
                        invoice={invoice}
                        companyName={companyName}
                        companyTaxId={companyTaxId}
                        companyAddress={companyAddress}
                        taxRateLabel={taxRateLabel}
                        {...(onSendEmail ? { onSendEmail } : {})}
                        onClose={onClose}
                        onAuthorize={onAuthorize}
                        companySettings={companySettings}
                        {...(onPrint ? { onPrint } : {})}
                        {...(onPrintThermal ? { onPrintThermal } : {})}
                    />
                ) : (
                    <div className="flex h-64 items-center justify-center">
                        <p>Cargando detalles...</p>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
