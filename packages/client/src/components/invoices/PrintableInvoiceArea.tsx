import { InvoiceDocument } from "./InvoiceDocument"
import type { InvoiceView } from "./types"
import type { CompanySettings } from "@/types"

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
        <div id="printable-invoice" className="fixed inset-0 z-[9999] m-0 hidden bg-white p-0 text-black print:block">
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
    )
}
