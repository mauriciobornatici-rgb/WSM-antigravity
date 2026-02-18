import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InvoiceDocument } from "./InvoiceDocument"
import type { InvoiceView } from "./types"

type InvoicePreviewDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    invoice: InvoiceView | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    onSendEmail: (invoice: InvoiceView) => void
    onClose: () => void
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
}: InvoicePreviewDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="no-print h-[90vh] max-w-[800px] overflow-y-auto border-none bg-white text-slate-900 print:hidden">
                <DialogHeader className="sr-only">
                    <DialogTitle>Previsualización de comprobante</DialogTitle>
                </DialogHeader>
                {invoice ? (
                    <InvoiceDocument
                        invoice={invoice}
                        companyName={companyName}
                        companyTaxId={companyTaxId}
                        companyAddress={companyAddress}
                        taxRateLabel={taxRateLabel}
                        onSendEmail={onSendEmail}
                        onClose={onClose}
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
