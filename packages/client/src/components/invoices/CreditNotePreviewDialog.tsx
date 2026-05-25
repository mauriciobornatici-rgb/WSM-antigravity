import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CreditNoteDocument } from "./CreditNoteDocument"
import type { CompanySettings } from "@/types"
import type { CreditNoteRow } from "@/pages/ReturnsAndWarranties"

type CreditNotePreviewDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    creditNote: CreditNoteRow | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    onClose: () => void
    onAuthorize?: (cn: CreditNoteRow) => void | Promise<void>
    companySettings?: CompanySettings
    linkedReturn?: any
}

export function CreditNotePreviewDialog({
    open,
    onOpenChange,
    creditNote,
    companyName,
    companyTaxId,
    companyAddress,
    taxRateLabel,
    onClose,
    onAuthorize,
    companySettings,
    linkedReturn,
}: CreditNotePreviewDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="no-print h-[90vh] max-w-[800px] overflow-y-auto border-none bg-white text-slate-900 print:hidden">
                <DialogHeader className="sr-only">
                    <DialogTitle>Previsualización de nota de crédito</DialogTitle>
                </DialogHeader>
                {creditNote ? (
                    <CreditNoteDocument
                        creditNote={creditNote}
                        companyName={companyName}
                        companyTaxId={companyTaxId}
                        companyAddress={companyAddress}
                        taxRateLabel={taxRateLabel}
                        onClose={onClose}
                        onAuthorize={onAuthorize}
                        companySettings={companySettings}
                        linkedReturn={linkedReturn}
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
