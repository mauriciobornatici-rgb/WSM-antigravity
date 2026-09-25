import { InvoiceDocument } from "./InvoiceDocument"
import type { InvoiceView } from "./types"
import type { CompanySettings } from "@/types"
import { PrintPortal } from "@/components/common/PrintPortal"

type PrintableInvoiceAreaProps = {
    invoice: InvoiceView | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    companySettings?: CompanySettings | undefined
}

export function PrintableInvoiceArea({
    invoice,
    companyName,
    companyTaxId,
    companyAddress,
    taxRateLabel,
    companySettings,
}: PrintableInvoiceAreaProps) {
    return (
        <PrintPortal>
            <div id="printable-invoice" className="m-0 hidden bg-white p-0 text-black print:block w-full max-w-[210mm] mx-auto">
                {invoice ? (
                    <InvoiceDocument
                        invoice={invoice}
                        companyName={companyName}
                        companyTaxId={companyTaxId}
                        companyAddress={companyAddress}
                        taxRateLabel={taxRateLabel}
                        printMode
                        companySettings={companySettings}
                    />
                ) : null}
            </div>
        </PrintPortal>
    )
}
