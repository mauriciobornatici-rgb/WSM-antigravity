import { CreditNoteDocument } from "./CreditNoteDocument"
import type { CompanySettings } from "@/types"
import type { ClientReturnRow, CreditNoteRow } from "@/types/returns"
import { PrintPortal } from "@/components/common/PrintPortal"

type PrintableCreditNoteAreaProps = {
    creditNote: CreditNoteRow | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    companySettings?: CompanySettings | undefined
    linkedReturn?: ClientReturnRow | null | undefined
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
        <PrintPortal>
            <div id="printable-invoice" className="m-0 hidden bg-white p-0 text-black print:block w-full max-w-[210mm] mx-auto">
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
        </PrintPortal>
    )
}
