import { CreditNoteDocument } from "./CreditNoteDocument"
import type { CompanySettings } from "@/types"
import type { CreditNoteRow } from "@/pages/ReturnsAndWarranties"

type PrintableCreditNoteAreaProps = {
    creditNote: CreditNoteRow | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    companySettings?: CompanySettings | undefined
    linkedReturn?: any
}

export function PrintableCreditNoteArea({
    creditNote,
    companyName,
    companyTaxId,
    companyAddress,
    taxRateLabel,
    companySettings,
    linkedReturn,
}: PrintableCreditNoteAreaProps) {
    return (
        <div id="printable-invoice" className="fixed inset-0 z-[9999] m-0 hidden bg-white p-0 text-black print:block">
            {creditNote ? (
                <CreditNoteDocument
                    creditNote={creditNote}
                    companyName={companyName}
                    companyTaxId={companyTaxId}
                    companyAddress={companyAddress}
                    taxRateLabel={taxRateLabel}
                    printMode
                    companySettings={companySettings}
                    linkedReturn={linkedReturn}
                />
            ) : null}
        </div>
    )
}
