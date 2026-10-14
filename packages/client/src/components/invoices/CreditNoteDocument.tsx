import { useState } from "react"
import { AlertTriangle, ShieldCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CompanySettings } from "@/types"
import type { ClientReturnRow, CreditNoteRow, ClientReturnItemRow } from "@/types/returns"
import { formatMoney } from "@/lib/formatters"
import { grossLineTotal, grossPrice, lineAmounts, vatRateOf } from "@/lib/pricing"
import {
    ARCA_VERIFYING_HELP,
    ARCA_VERIFYING_LABEL,
    arcaAuthorizeButtonLabel,
    creditNoteFiscalNumber,
    isArcaAuthorizing,
} from "@/lib/arca"
import { ArcaLastError } from "./ArcaLastError"
import { splitCreditNoteAmount } from "./invoiceUtils"
import { buildAfipQrUrl } from "./afipQr"
import { AfipQrImage } from "./AfipQrImage"

function defaultCaeExpirationDate(): string {
    return new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        .toISOString()
        .substring(0, 10)
        .replace(/-/g, "")
}

type CreditNoteDocumentProps = {
    creditNote: CreditNoteRow
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    printMode?: boolean | undefined
    onAuthorize?: ((cn: CreditNoteRow) => void | Promise<void>) | undefined
    companySettings?: CompanySettings | undefined
    linkedReturn?: ClientReturnRow | null | undefined
    onClose?: (() => void) | undefined
}

export function CreditNoteDocument({
    creditNote,
    companyName,
    companyTaxId,
    companyAddress,
    printMode = false,
    onAuthorize,
    companySettings,
    linkedReturn,
    onClose,
}: CreditNoteDocumentProps) {
    const [authorizing, setAuthorizing] = useState(false)
    const verifying = isArcaAuthorizing(creditNote.status)
    const fiscalNumber = creditNoteFiscalNumber(creditNote)
    const cnType = creditNote.credit_note_type || "B"
    const isNoteA = cnType === "A"
    // The credit amount is VAT-included: the net is split with the linked return's own rates (no hardcoded 21%).
    const split = splitCreditNoteAmount(creditNote.amount, linkedReturn?.items)

    const afipQrUrl = buildAfipQrUrl({
        emisorCuit: companyTaxId,
        invoiceType: cnType === "A" ? "NC_A" : "NC_B",
        pointOfSale: creditNote.point_of_sale ?? null,
        invoiceNumber: creditNote.arca_voucher_number ?? Number(creditNote.number.split("-").pop() || 0),
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
        <div
            id={printMode ? undefined : "printable-invoice-content"}
            className={printMode ? "w-full space-y-8 bg-white p-10 text-slate-900" : "space-y-8 p-8 text-slate-900"}
        >
            {(creditNote.status === "issued" || verifying) && (
                <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-slate-800 print:hidden shadow-sm">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold block text-amber-800">
                                {verifying ? ARCA_VERIFYING_LABEL : "Nota de Crédito Pendiente de Autorización Fiscal"}
                            </span>
                            {verifying
                                ? `${ARCA_VERIFYING_HELP}.`
                                : "Este comprobante comercial aún no ha sido autorizado con el CAE de ARCA (ex-AFIP). Los totales no son válidos para balances oficiales hasta su aprobación."}
                            <ArcaLastError doc={creditNote} className="mt-1" />
                        </div>
                    </div>
                    {onAuthorize && (
                        <Button 
                            type="button" 
                            variant="outline" 
                            className="shrink-0 border-amber-600/40 text-amber-700 hover:bg-amber-600/10 hover:text-amber-850"
                            disabled={authorizing}
                            onClick={async () => {
                                setAuthorizing(true)
                                try {
                                    await onAuthorize(creditNote)
                                } catch {
                                    // Error handled in parent page
                                } finally {
                                    setAuthorizing(false)
                                }
                            }}
                        >
                            {authorizing ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> {verifying ? "Verificando..." : "Autorizando..."}</>
                            ) : (
                                arcaAuthorizeButtonLabel(creditNote.status)
                            )}
                        </Button>
                    )}
                </div>
            )}

            {creditNote.status === "authorized" && (
                <div className="no-print flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 print:hidden shadow-sm">
                    <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                    <span><strong>Nota de Crédito Autorizada Legalmente.</strong> Este comprobante cuenta con CAE de ARCA y validez fiscal oficial.</span>
                </div>
            )}

            {/* Document Layout */}
            <div className="border border-slate-300 rounded-sm overflow-hidden bg-white">
                {/* Header Grid */}
                <div className="grid grid-cols-2 border-b border-slate-300 relative">
                    {/* Tax Type Centered Badge */}
                    <div className="absolute left-1/2 top-0 -translate-x-1/2 w-14 h-14 bg-white border-x border-b border-slate-300 flex flex-col items-center justify-center select-none z-10">
                        <span className="text-2xl font-black">{cnType}</span>
                        <span className="text-[7px] text-slate-500">COD. {cnType === "A" ? "03" : "08"}</span>
                    </div>

                    {/* Left Column (Issuer Details) */}
                    <div className="p-6 pr-10 space-y-2 border-r border-slate-200">
                        <h1 className="text-xl font-black uppercase tracking-wider text-slate-900">{companyName}</h1>
                        <p className="text-xs text-slate-600">{companyAddress}</p>
                        <p className="text-xs text-slate-600">IVA: {companySettings?.billing?.iva_condition || "Responsable Inscripto"}</p>
                    </div>

                    {/* Right Column (Document Metadata) */}
                    <div className="p-6 pl-10 space-y-2 text-right">
                        <h2 className="text-lg font-bold tracking-tight text-slate-900">NOTA DE CRÉDITO</h2>
                        <p className="text-sm font-mono font-bold text-slate-800">
                            Nº {fiscalNumber ?? `${String(creditNote.point_of_sale || 1).padStart(4, "0")}-${String(creditNote.number.split("-").pop() || "").padStart(8, "0")}`}
                        </p>
                        {fiscalNumber ? (
                            <p className="text-[10px] font-mono text-slate-500">Ref. interna: {creditNote.number}</p>
                        ) : null}
                        <p className="text-xs text-slate-600">
                            Fecha: {new Date(creditNote.created_at).toLocaleDateString("es-AR")}
                        </p>
                        <p className="text-xs text-slate-600">CUIT: {companyTaxId}</p>
                        <p className="text-xs text-slate-600">IIBB: {companySettings?.billing?.iibb || "Exento"}</p>
                        <p className="text-xs text-slate-600">Inicio de Actividades: {companySettings?.billing?.start_date ? new Date(companySettings.billing.start_date).toLocaleDateString("es-AR") : "No informado"}</p>
                    </div>
                </div>

                {/* Receiver Info */}
                <div className="p-6 border-b border-slate-300 grid grid-cols-2 gap-4 bg-slate-50/50">
                    <div className="space-y-1">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wide">Receptor / Cliente</p>
                        <p className="text-sm font-bold text-slate-900">{creditNote.client_name || "Consumidor Final"}</p>
                        <p className="text-xs text-slate-600">CUIT/DNI: {creditNote.client_name ? "30-71234567-8" : "99-99999999-9"}</p>
                    </div>
                    <div className="space-y-1 text-right sm:text-left sm:pl-8">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-wide">Condición Fiscal</p>
                        <p className="text-sm text-slate-800">{creditNote.client_name ? "Responsable Inscripto" : "Consumidor Final"}</p>
                        <p className="text-xs text-slate-600">Condición de Venta: Cuenta Corriente</p>
                    </div>
                </div>

                {/* Itemized Table */}
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-slate-300 bg-slate-100 text-slate-700 text-xs uppercase font-bold">
                            <th className="p-4 pl-6">Código / Detalle</th>
                            <th className="p-4 text-center">Cant.</th>
                            <th className="p-4 text-right">{isNoteA ? "Precio Unitario (neto)" : "Precio Unitario (IVA incl.)"}</th>
                            <th className="p-4 text-center">IVA</th>
                            <th className="p-4 pr-6 text-right">{isNoteA ? "Subtotal (neto)" : "Subtotal"}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm text-slate-800">
                        {linkedReturn && linkedReturn.items && linkedReturn.items.length > 0 ? (
                            linkedReturn.items.map((item: ClientReturnItemRow, idx: number) => {
                                // Stored unit prices are net (ADR-015). Type A is fiscal: net detail; B / C: final prices.
                                const unit = isNoteA ? Number(item.unit_price || 0) : grossPrice(item.unit_price, item.vat_rate);
                                const sub = isNoteA
                                    ? lineAmounts(item.quantity, item.unit_price, item.vat_rate).net
                                    : grossLineTotal(item.quantity, item.unit_price, item.vat_rate);
                                return (
                                    <tr key={idx} className="hover:bg-slate-50/50">
                                        <td className="p-4 pl-6 font-medium">
                                            {item.product_name || "Producto devuelto"}
                                            <span className="block text-xs text-slate-500 font-mono">SKU: {item.sku || "N/D"}</span>
                                        </td>
                                        <td className="p-4 text-center">{item.quantity}</td>
                                        <td className="p-4 text-right">{formatMoney(unit)}</td>
                                        <td className="p-4 text-center">{vatRateOf(item.vat_rate)}%</td>
                                        <td className="p-4 pr-6 text-right font-semibold">{formatMoney(sub)}</td>
                                    </tr>
                                )
                            })
                        ) : (
                            <tr className="hover:bg-slate-50/50">
                                <td className="p-4 pl-6 font-medium">
                                    {creditNote.notes || "Ajuste Comercial / Nota de Crédito Manual"}
                                    <span className="block text-xs text-slate-500 font-mono">Ref: {creditNote.reference_type}</span>
                                </td>
                                <td className="p-4 text-center">1</td>
                                <td className="p-4 text-right">{formatMoney(isNoteA ? split.net : Number(creditNote.amount || 0))}</td>
                                <td className="p-4 text-center">{split.rate === null ? "-" : `${split.rate}%`}</td>
                                <td className="p-4 pr-6 text-right font-semibold">{formatMoney(isNoteA ? split.net : Number(creditNote.amount || 0))}</td>
                            </tr>
                        )}
                    </tbody>
                </table>

                {/* Summary Totals block */}
                <div className="p-6 border-t border-slate-300 bg-slate-50/20 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="text-xs text-slate-500 space-y-1.5 self-end">
                        <p>Comprobante de referencia: Devolución #{creditNote.reference_id?.substring(0, 8).toUpperCase() || "N/A"}</p>
                        <p>Observaciones: {creditNote.notes || "Sin observaciones adicionales."}</p>
                    </div>
                    <div className="space-y-2 text-right self-end max-w-sm ml-auto w-full text-xs">
                        {isNoteA ? (
                            <>
                                <div className="flex justify-between text-slate-600">
                                    <span>Subtotal Neto:</span>
                                    <span className="font-semibold">{formatMoney(split.net)}</span>
                                </div>
                                <div className="flex justify-between text-slate-600">
                                    <span>IVA Liquidado{split.rate === null ? "" : ` (${split.rate}%)`}:</span>
                                    <span className="font-semibold">{formatMoney(split.vat)}</span>
                                </div>
                            </>
                        ) : (
                            // Ley 27.743 (Transparencia Fiscal al Consumidor): B shows the VAT contained in the final amount.
                            <div className="flex justify-between text-slate-600">
                                <span>IVA contenido:</span>
                                <span className="font-semibold">{formatMoney(split.vat)}</span>
                            </div>
                        )}
                        <div className="flex justify-between border-t border-slate-300 pt-2 text-base font-black text-slate-900">
                            <span>TOTAL RECIBIDO:</span>
                            <span>{formatMoney(creditNote.amount)}</span>
                        </div>
                    </div>
                </div>

                {/* AFIP Fiscal Footer */}
                {creditNote.status === "authorized" && creditNote.cae ? (
                    <div className="border-t border-slate-300 p-6 bg-white grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
                        {/* AFIP QR Code (generado localmente, RG 4892) */}
                        <div className="flex items-center gap-3 border border-slate-200 p-3 rounded-md bg-slate-50 select-none">
                            {afipQrUrl && (
                                <AfipQrImage
                                    url={afipQrUrl}
                                    size={150}
                                    className="w-16 h-16 shrink-0 bg-white border border-slate-300 p-1 rounded"
                                />
                            )}
                            <div className="text-[10px] space-y-1 text-slate-800 leading-tight">
                                <span className="bg-slate-900 text-white px-1.5 py-0.5 rounded font-black text-[8px] tracking-wider uppercase">ARCA / AFIP</span>
                                <p className="font-bold">Comprobante Autorizado</p>
                                {afipQrUrl && (
                                    <p className="font-mono text-[7.5px] text-slate-500 max-w-[200px] truncate">{afipQrUrl}</p>
                                )}
                            </div>
                        </div>

                        {/* Simulated AFIP Barcode */}
                        <div className="flex flex-col items-center justify-center border border-slate-200 p-3 rounded-md bg-slate-50 select-none text-center">
                            <div className="flex h-8 items-stretch gap-[1.5px] justify-center">
                                {Array.from({ length: 30 }).map((_, i) => {
                                    const widths = [1, 2, 1, 3, 2, 1, 2];
                                    const w = Number(widths[i % widths.length] || 1);
                                    return (
                                        <div 
                                            key={i} 
                                            className="bg-slate-950" 
                                            style={{ width: `${w * 1.2}px` }} 
                                        />
                                    )
                                })}
                            </div>
                            <span className="font-mono text-[9px] mt-1.5 tracking-[0.5px] text-slate-800">{barcodeValue}</span>
                        </div>
                    </div>
                ) : (
                    <div className="border-t border-slate-300 p-6 bg-slate-50 text-center text-xs italic text-slate-500 uppercase tracking-wider">
                        Comprobante no válido como documento fiscal - Requiere autorización CAE
                    </div>
                )}
            </div>

            {/* Footer buttons */}
            {!printMode && (
                <div className="no-print flex justify-end gap-2 pt-4">
                    <Button variant="outline" onClick={onClose}>
                        Cerrar previsualización
                    </Button>
                    <Button variant="default" className="gap-2 bg-blue-600 hover:bg-blue-700" onClick={() => window.print()}>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                        </svg>
                        Imprimir A4
                    </Button>
                </div>
            )}
        </div>
    )
}
