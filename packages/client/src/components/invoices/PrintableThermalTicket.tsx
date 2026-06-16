import type { InvoiceView } from "./types"
import type { CompanySettings } from "@/types"
import { formatInvoiceNumber } from "./invoiceUtils"

const DEFAULT_CAE_EXPIRATION_DATE = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
    .toISOString()
    .substring(0, 10)
    .replace(/-/g, "")

type PrintableThermalTicketProps = {
    invoice: InvoiceView | null
    companyName: string
    companyTaxId: string
    companyAddress: string
    companySettings?: CompanySettings | undefined
}

export function PrintableThermalTicket({
    invoice,
    companyName,
    companyTaxId,
    companyAddress,
    companySettings,
}: PrintableThermalTicketProps) {
    if (!invoice) return null

    const isTicket = invoice.invoice_type === "TK"
    const taxRateLabel = companySettings?.operation?.tax_rate 
        ? `${Number(companySettings.operation.tax_rate * 100).toFixed(0)}%`
        : "21%"

    const getAfipQrValue = () => {
        const cleanCuit = companyTaxId.replace(/-/g, "") || "20123456789"
        const cleanClientCuit = (invoice.client_tax_id || "99999999999").replace(/-/g, "")
        const qrData = {
            ver: 1,
            fecha: invoice.issue_date ? String(invoice.issue_date).substring(0, 10) : new Date().toISOString().substring(0, 10),
            cuit: Number(cleanCuit) || 20123456789,
            ptoVta: Number(invoice.point_of_sale || 1),
            tipoCmp: invoice.invoice_type === "A" ? 1 : 6,
            nroCmp: Number(invoice.invoice_number || 1),
            importe: Number(invoice.total_amount || 0),
            moneda: "PES",
            cotiz: 1,
            tipoDocRec: cleanClientCuit.length > 8 ? 80 : 99,
            nroDocRec: Number(cleanClientCuit) || 99999999999,
            tipoCodAut: "E",
            codAut: Number(invoice.cae) || 0
        }
        try {
            const jsonStr = JSON.stringify(qrData)
            const b64 = btoa(unescape(encodeURIComponent(jsonStr)))
            return `https://www.afip.gob.ar/fe/qr/?p=${b64}`
        } catch {
            return "https://www.afip.gob.ar/fe/qr/?p=mock"
        }
    }

    const emisorCuit = companyTaxId.replace(/-/g, "") || "20123456789"
    const compTypeNum = invoice.invoice_type === "A" ? "01" : "06"
    const expDateStr = invoice.cae_expiration_date
        ? String(invoice.cae_expiration_date).substring(0, 10).replace(/-/g, "")
        : DEFAULT_CAE_EXPIRATION_DATE
    const barcodeValue = `${emisorCuit}${compTypeNum}${String(invoice.point_of_sale || 1).padStart(4, "0")}${invoice.cae || ""}${expDateStr}`

    return (
        <div id="printable-ticket" className="fixed inset-0 z-[9999] m-0 hidden bg-white p-4 text-black print:block font-mono text-xs w-[80mm] leading-tight">
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
                <h3 className="text-xs font-bold uppercase">{isTicket ? "TICKET NO FISCAL" : `FACTURA DE COMPRA ${invoice.invoice_type}`}</h3>
                <p className="text-[10px]">Comprobante Nº {formatInvoiceNumber(invoice)}</p>
                <p className="text-[10px]">Fecha: {invoice.issue_date ? new Date(invoice.issue_date).toLocaleString("es-AR") : "-"}</p>
            </div>

            {/* Client Info */}
            <div className="py-2 border-b border-dashed border-slate-400 text-[10px] space-y-0.5">
                <p>Cliente: <strong>{invoice.client_name || "Consumidor Final"}</strong></p>
                <p>CUIT/DNI: <strong>{invoice.client_tax_id || "99-99999999-9"}</strong></p>
                <p>Cond. IVA: <strong>{invoice.client_tax_condition || "Consumidor Final"}</strong></p>
                {invoice.client_address && <p>Dir: <strong>{invoice.client_address}</strong></p>}
            </div>

            {/* Items Table */}
            <div className="py-2 border-b border-dashed border-slate-400">
                <div className="flex justify-between text-[10px] font-bold pb-1">
                    <span>Item / Descripción</span>
                    <span>Total</span>
                </div>
                <div className="space-y-1">
                    {invoice.items && invoice.items.length > 0 ? (
                        invoice.items.map((item, index) => (
                            <div key={index} className="text-[10px] space-y-0.5 border-b border-dotted border-slate-200 pb-1 last:border-b-0">
                                <div className="flex justify-between">
                                    <span className="truncate max-w-[200px]">{item.product_name || item.description || "Producto"}</span>
                                    <span>${(Number(item.quantity) * Number(item.unit_price)).toFixed(2)}</span>
                                </div>
                                <div className="text-[9px] text-slate-500">
                                    {item.quantity} x ${Number(item.unit_price).toFixed(2)} (IVA {item.vat_rate || 21}%)
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="flex justify-between text-[10px]">
                            <span>Venta Comercial</span>
                            <span>${Number(invoice.total_amount).toFixed(2)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Totals Section */}
            <div className="py-2 space-y-1 text-right text-[10px]">
                <div className="flex justify-between">
                    <span>Neto Gravado:</span>
                    <span>${Number(invoice.net_amount || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                    <span>IVA ({taxRateLabel}):</span>
                    <span>${Number(invoice.vat_amount || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-black border-t border-dashed border-slate-400 pt-1.5 mt-1">
                    <span>TOTAL FACTURADO:</span>
                    <span>${Number(invoice.total_amount || 0).toFixed(2)}</span>
                </div>
            </div>

            {/* AFIP Section */}
            {!isTicket && invoice.cae ? (
                <div className="border-t border-dashed border-slate-400 pt-2.5 text-center space-y-2.5">
                    <div className="text-[9px] font-bold font-mono">
                        <p>CAE: {invoice.cae}</p>
                        <p>VTO. CAE: {invoice.cae_expiration_date ? new Date(invoice.cae_expiration_date).toLocaleDateString("es-AR") : "-"}</p>
                    </div>

                    {/* Compact Simulated QR Code */}
                    <div className="flex items-center justify-center gap-2 border border-slate-400 p-1.5 bg-white rounded-sm select-none">
                        <div className="w-12 h-12 shrink-0 bg-white border border-slate-200 p-0.5 rounded flex flex-wrap gap-[0.5px]">
                            {Array.from({ length: 49 }).map((_, idx) => {
                                const isCorner = 
                                    (idx < 5 && idx % 7 < 2) || 
                                    (idx < 15 && idx >= 10 && idx % 7 < 2) || 
                                    (idx >= 25 && idx % 7 < 2) ||
                                    (idx < 5 && idx % 7 >= 4) ||
                                    (idx >= 40 && idx % 7 < 2) ||
                                    (idx % 9 === 0) || (idx % 5 === 0);
                                return (
                                    <div 
                                        key={idx} 
                                        className={`w-[5px] h-[5px] ${isCorner ? 'bg-slate-900' : 'bg-slate-200'}`} 
                                    />
                                )
                            })}
                        </div>
                        <div className="text-[8px] space-y-0.5 text-slate-800 leading-tight text-left">
                            <span className="bg-slate-900 text-white px-1 py-0.2 rounded font-black text-[7px] tracking-wider">ARCA/AFIP</span>
                            <p className="font-bold">Factura Autorizada</p>
                            <p className="font-mono text-[6px] text-slate-500 max-w-[130px] truncate">{getAfipQrValue().substring(0, 24)}...</p>
                        </div>
                    </div>

                    {/* Compact Linear Barcode */}
                    <div className="flex flex-col items-center justify-center border border-slate-400 p-1.5 bg-white rounded-sm select-none">
                        <div className="flex h-6 items-stretch gap-[1px]">
                            {Array.from({ length: 30 }).map((_, i) => {
                                const widths = [1, 2, 1, 3, 1, 2, 1];
                                const w = widths[i % widths.length];
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
            ) : isTicket ? (
                <div className="border-t border-dashed border-slate-400 pt-2 text-center text-[8px] italic text-slate-500 uppercase">
                    Comprobante no válido como factura
                </div>
            ) : null}

            {/* Footer Greeting */}
            <div className="text-center text-[9px] pt-4 mt-2 border-t border-dashed border-slate-300 italic text-slate-600">
                ¡Gracias por su compra en WSM Sports!
            </div>
        </div>
    )
}
