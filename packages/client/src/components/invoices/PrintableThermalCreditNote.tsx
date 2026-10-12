import type { CompanySettings } from "@/types"
import type { ClientReturnRow, CreditNoteRow, ClientReturnItemRow } from "@/types/returns"
import { buildAfipQrUrl } from "./afipQr"
import { AfipQrImage } from "./AfipQrImage"
import { PrintPortal } from "@/components/common/PrintPortal"

function defaultCaeExpirationDate(): string {
    return new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        .toISOString()
        .substring(0, 10)
        .replace(/-/g, "")
}

type PrintableThermalCreditNoteProps = {
    creditNote: CreditNoteRow | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    companySettings?: CompanySettings | undefined
    linkedReturn?: ClientReturnRow | null | undefined
}

export function PrintableThermalCreditNote({
    creditNote,
    companyName,
    companyTaxId,
    companyAddress,
    companySettings,
    linkedReturn,
}: PrintableThermalCreditNoteProps) {
    if (!creditNote) return null

    const cnType = creditNote.credit_note_type || "B"

    const afipQrUrl = buildAfipQrUrl({
        emisorCuit: companyTaxId,
        invoiceType: cnType === "A" ? "NC_A" : "NC_B",
        pointOfSale: creditNote.point_of_sale ?? null,
        invoiceNumber: Number(creditNote.number.split("-").pop() || 0),
        issueDate: creditNote.created_at ? String(creditNote.created_at) : null,
        totalAmount: creditNote.amount,
        cae: creditNote.cae ?? null,
    })

    const emisorCuit = companyTaxId.replace(/-/g, "") || "20123456789"
    const compTypeNum = cnType === "A" ? "03" : "08"
    const expDateStr = creditNote.cae_expiration_date
        ? String(creditNote.cae_expiration_date).substring(0, 10).replace(/-/g, "")
        : defaultCaeExpirationDate()
    const barcodeValue = `${emisorCuit}${compTypeNum}${String(creditNote.point_of_sale || 1).padStart(4, "0")}${creditNote.cae || ""}${expDateStr}`

    return (
        <PrintPortal>
            <div id="printable-ticket" className="m-0 hidden bg-white p-4 text-black print:block font-mono text-xs w-[80mm] max-w-[80mm] mx-auto leading-tight box-border">
            {/* Header */}
            <div className="text-center space-y-1 pb-2 border-b border-dashed border-slate-400">
                <h2 className="text-sm font-black uppercase tracking-wider">{companyName}</h2>
                <p className="text-[10px]">{companyAddress}</p>
                <p className="text-[10px]">IVA: {companySettings?.billing?.iva_condition || "Responsable Inscripto"}</p>
                <p className="text-[10px]">CUIT: {companyTaxId}</p>
                <p className="text-[10px]">IIBB: {companySettings?.billing?.iibb || "Exento"}</p>
                {companySettings?.billing?.start_date && (
                    <p className="text-[10px]">Inicio Act.: {new Date(companySettings.billing.start_date).toLocaleDateString("es-AR")}</p>
                )}
            </div>

            {/* Document Title */}
            <div className="text-center py-2 border-b border-dashed border-slate-400">
                <h3 className="text-xs font-bold uppercase">NOTA DE CRÉDITO {cnType}</h3>
                <p className="text-[10px]">Comprobante Nº {String(creditNote.point_of_sale || 1).padStart(4, "0")}-{String(creditNote.number.split("-").pop() || "").padStart(8, "0")}</p>
                <p className="text-[10px]">Fecha: {new Date(creditNote.created_at).toLocaleString("es-AR")}</p>
            </div>

            {/* Client Info */}
            <div className="py-2 border-b border-dashed border-slate-400 text-[10px] space-y-0.5">
                <p>Cliente: <strong>{creditNote.client_name || "Consumidor Final"}</strong></p>
                <p>Cond. IVA: <strong>{creditNote.client_name ? "Responsable Inscripto" : "Consumidor Final"}</strong></p>
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-dashed border-slate-400">
                <div className="flex justify-between text-[10px] font-bold pb-1">
                    <span>Item / Descripción</span>
                    <span>Total</span>
                </div>
                <div className="space-y-1">
                    {linkedReturn && linkedReturn.items && linkedReturn.items.length > 0 ? (
                        linkedReturn.items.map((item: ClientReturnItemRow, index: number) => (
                            <div key={index} className="text-[10px] space-y-0.5 border-b border-dotted border-slate-200 pb-1 last:border-b-0">
                                <div className="flex justify-between">
                                    <span className="truncate max-w-[200px]">{item.product_name || "Producto devuelto"}</span>
                                    <span>${(Number(item.quantity) * Number(item.unit_price)).toFixed(2)}</span>
                                </div>
                                <div className="text-[9px] text-slate-500">
                                    {item.quantity} x ${Number(item.unit_price).toFixed(2)} (IVA 21%)
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="flex justify-between text-[10px]">
                            <span>{creditNote.notes || "Ajuste Comercial / Nota de Crédito Manual"}</span>
                            <span>${Number(creditNote.amount).toFixed(2)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Totals Section */}
            <div className="py-2 space-y-1 text-right text-[10px]">
                <div className="flex justify-between">
                    <span>Neto Acreditado:</span>
                    <span>${(Number(creditNote.amount || 0) / 1.21).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>IVA (21%):</span>
                    <span>${(Number(creditNote.amount || 0) - (Number(creditNote.amount || 0) / 1.21)).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-black border-t border-dashed border-slate-400 pt-1.5 mt-1">
                    <span>TOTAL COMPENSADO:</span>
                    <span>${Number(creditNote.amount || 0).toFixed(2)}</span>
                </div>
            </div>

            {/* AFIP Section */}
            {creditNote.status === "authorized" && creditNote.cae ? (
                <div className="border-t border-dashed border-slate-400 pt-2.5 text-center space-y-2.5">
                    <div className="text-[9px] font-bold font-mono">
                        <p>CAE: {creditNote.cae}</p>
                        <p>VTO. CAE: {creditNote.cae_expiration_date ? new Date(creditNote.cae_expiration_date).toLocaleDateString("es-AR") : "-"}</p>
                    </div>

                    {/* Compact AFIP QR Code (generado localmente) */}
                    <div className="flex items-center justify-center gap-2 border border-slate-400 p-1.5 bg-white rounded-sm select-none text-left">
                        {afipQrUrl && (
                            <AfipQrImage
                                url={afipQrUrl}
                                size={120}
                                className="w-12 h-12 shrink-0 bg-white border border-slate-200 p-0.5 rounded"
                            />
                        )}
                        <div className="text-[8px] space-y-0.5 text-slate-800 leading-tight">
                            <span className="bg-slate-900 text-white px-1 py-0.2 rounded font-black text-[7px] tracking-wider">ARCA/AFIP</span>
                            <p className="font-bold">Nota de Crédito Autorizada</p>
                            {afipQrUrl && (
                                <p className="font-mono text-[6px] text-slate-500 max-w-[130px] truncate">{afipQrUrl.substring(0, 24)}...</p>
                            )}
                        </div>
                    </div>

                    {/* Compact Linear Barcode */}
                    <div className="flex flex-col items-center justify-center border border-slate-400 p-1.5 bg-white rounded-sm select-none">
                        <div className="flex h-6 items-stretch gap-[1px]">
                            {Array.from({ length: 30 }).map((_, i) => {
                                const widths = [1, 2, 1, 3, 1, 2, 1];
                                const w = Number(widths[i % widths.length] || 1);
                                return (
                                    <div 
                                        key={i} 
                                        className="bg-slate-950" 
                                        style={{ width: `${w}px` }} 
                                    />
                                )
                            })}
                        </div>
                        <span className="font-mono text-[7px] mt-0.5 tracking-[0.5px] text-slate-800">{barcodeValue}</span>
                    </div>
                </div>
            ) : (
                <div className="border-t border-dashed border-slate-400 pt-2 text-center text-[8px] italic text-slate-500 uppercase">
                    Comprobante no válido - Requiere CAE
                </div>
            )}

            {/* Footer Greeting */}
            <div className="text-center text-[9px] pt-4 mt-2 border-t border-dashed border-slate-300 italic text-slate-600">
                ¡Nota de Crédito procesada con éxito!
            </div>
        </div>
        </PrintPortal>
    )
}
