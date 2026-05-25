import { useState } from "react"
import { Mail, Printer, AlertTriangle, ShieldCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatInvoiceNumber } from "./invoiceUtils"
import type { InvoiceView } from "./types"
import type { InvoiceItem } from "@/types/api"

import type { CompanySettings } from "@/types"

type InvoiceDocumentProps = {
    invoice: InvoiceView
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    printMode?: boolean | undefined
    onSendEmail?: ((invoice: InvoiceView) => void) | undefined
    onClose?: (() => void) | undefined
    onAuthorize?: ((invoice: InvoiceView) => void | Promise<void>) | undefined
    companySettings?: CompanySettings | undefined
}

export function InvoiceDocument({
    invoice,
    companyName,
    companyTaxId,
    companyAddress,
    taxRateLabel,
    printMode = false,
    onSendEmail,
    onClose,
    onAuthorize,
    companySettings,
}: InvoiceDocumentProps) {
    const isTicket = invoice.invoice_type === "TK"
    const [authorizing, setAuthorizing] = useState(false)

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
        : new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10).replace(/-/g, "")
    const barcodeValue = `${emisorCuit}${compTypeNum}${String(invoice.point_of_sale || 1).padStart(4, "0")}${invoice.cae || ""}${expDateStr}`

    return (
        <div
            id={printMode ? undefined : "printable-invoice-content"}
            className={printMode ? "w-full space-y-8 bg-white p-10" : "space-y-8 p-8"}
        >
            {invoice.status === "issued" && !isTicket && (
                <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-slate-800 print:hidden shadow-sm">
                    <div className="flex items-start gap-2">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold block text-amber-800">Comprobante Pendiente de Autorización Fiscal</span>
                            Este comprobante comercial aún no ha sido autorizado con el CAE de ARCA (ex-AFIP). Los totales no son válidos para balances oficiales hasta su aprobación.
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
                                    await onAuthorize(invoice)
                                } catch (err) {
                                    // Error is toasted at parent page
                                } finally {
                                    setAuthorizing(false)
                                }
                            }}
                        >
                            {authorizing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin animate" /> Autorizando...</> : "Autorizar con ARCA"}
                        </Button>
                    )}
                </div>
            )}
            <div className="flex justify-between border-b-2 border-slate-900 pb-4">
                <div className="space-y-1">
                    <h2 className="text-4xl font-black text-slate-800">{isTicket ? "TICKET" : "FACTURA"}</h2>
                    <div className="flex items-center gap-2">
                        <div className="flex h-14 w-14 items-center justify-center border-2 border-slate-900 text-3xl font-bold">
                            {isTicket ? "X" : invoice.invoice_type}
                        </div>
                        <div className="whitespace-pre-line text-[10px] font-bold uppercase leading-tight">
                            {isTicket ? "Documento\nNo válido\ncomo factura" : "Cod. 01\nComprobante\nOriginal"}
                        </div>
                    </div>
                </div>
                <div className="space-y-1 text-right">
                    <p className="text-xl font-bold">Nº {formatInvoiceNumber(invoice)}</p>
                    <p className="text-sm">
                        Fecha: <b>{invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString("es-AR") : "-"}</b>
                    </p>
                    <p className="text-sm">
                        CUIT: <b>{companyTaxId}</b>
                    </p>
                    <p className="text-sm">
                        Ingresos brutos: <b>{companySettings?.billing?.iibb || "Exento"}</b>
                    </p>
                    {companySettings?.billing?.start_date && (
                        <p className="text-sm">
                            Inicio Act.: <b>{new Date(companySettings.billing.start_date).toLocaleDateString("es-AR")}</b>
                        </p>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-8 text-sm">
                <div className="space-y-1 border-r border-slate-200 pr-4">
                    <p className="text-[10px] font-semibold uppercase text-slate-500">Emisor</p>
                    <p className="text-lg font-bold">{companyName}</p>
                    <p>{companyAddress}</p>
                    <p className="font-semibold italic">IVA {companySettings?.billing?.iva_condition || "Responsable Inscripto"}</p>
                </div>
                <div className="space-y-1 pl-4">
                    <p className="text-[10px] font-semibold uppercase text-slate-500">Receptor</p>
                    <p className="text-lg font-bold">{invoice.client_name || "Consumidor final"}</p>
                    <p>
                        CUIT/DNI: <b>{invoice.client_tax_id || "99-99999999-9"}</b>
                    </p>
                    <p>
                        Condición: <b>{invoice.client_tax_condition || "Consumidor final"}</b>
                    </p>
                    <p>Domicilio: {invoice.client_address || "S/D"}</p>
                </div>
            </div>

            <div className="overflow-hidden rounded-sm border-2 border-slate-900">
                <table className="w-full text-sm">
                    <thead className="bg-slate-200">
                        <tr>
                            <th className="border-r border-slate-300 p-2 text-left">Descripción</th>
                            <th className="w-20 border-r border-slate-300 p-2 text-center">Cant.</th>
                            <th className="w-32 border-r border-slate-300 p-2 text-right">Unitario</th>
                            <th className="w-32 p-2 text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {invoice.items && invoice.items.length > 0 ? (
                            invoice.items.map((item: InvoiceItem, index: number) => (
                                <tr key={index} className="border-b border-slate-200">
                                    <td className="border-r border-slate-200 p-2 text-left">
                                        {item.product_name || item.description || "Producto"}
                                    </td>
                                    <td className="border-r border-slate-200 p-2 text-center">{item.quantity}</td>
                                    <td className="border-r border-slate-200 p-2 text-right">
                                        ${Number(item.unit_price || 0).toLocaleString("es-AR")}
                                    </td>
                                    <td className="p-2 text-right font-semibold">
                                        ${(Number(item.quantity || 1) * Number(item.unit_price || 0)).toLocaleString("es-AR")}
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr className="border-b border-slate-200">
                                <td className="border-r border-slate-200 p-2 text-left">Venta comercial</td>
                                <td className="border-r border-slate-200 p-2 text-center">1</td>
                                <td className="border-r border-slate-200 p-2 text-right">
                                    ${Number(invoice.net_amount || invoice.subtotal || 0).toLocaleString("es-AR")}
                                </td>
                                <td className="p-2 text-right font-semibold">
                                    ${Number(invoice.total_amount || 0).toLocaleString("es-AR")}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex items-start justify-between">
                <div className="space-y-4 flex-1">
                    {invoice.cae ? (
                        <div className="space-y-3">
                            <div className="rounded-sm border-2 border-slate-900 bg-slate-50 p-3 font-mono text-xs max-w-sm">
                                <p className="mb-1 border-b border-slate-300 pb-1 font-black uppercase text-[10px] text-slate-700 flex items-center gap-1.5">
                                    <ShieldCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                    Autorización AFIP
                                </p>
                                <div className="space-y-0.5">
                                    <p>
                                        CAE: <span className="font-bold">{invoice.cae}</span>
                                    </p>
                                    <p>
                                        Vto. CAE: <span className="font-bold">
                                            {invoice.cae_expiration_date
                                                ? new Date(invoice.cae_expiration_date as string).toLocaleDateString("es-AR")
                                                : new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toLocaleDateString("es-AR")}
                                        </span>
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-start">
                                <div className="flex items-center gap-2 border-2 border-slate-900 p-2 bg-white rounded-sm select-none shrink-0">
                                    <div className="w-16 h-16 shrink-0 bg-white border border-slate-300 p-1 rounded flex flex-wrap gap-[1px]">
                                        {Array.from({ length: 64 }).map((_, idx) => {
                                            const isCorner = 
                                                (idx < 8 && idx % 8 < 3) || 
                                                (idx < 24 && idx >= 16 && idx % 8 < 3) || 
                                                (idx >= 40 && idx < 48 && idx % 8 < 3) ||
                                                (idx < 8 && idx % 8 >= 5) ||
                                                (idx >= 56 && idx % 8 < 3) ||
                                                (idx % 11 === 0) || (idx % 7 === 0);
                                            return (
                                                <div 
                                                    key={idx} 
                                                    className={`w-[6px] h-[6px] ${isCorner ? 'bg-slate-900' : 'bg-slate-300'}`} 
                                                />
                                            )
                                        })}
                                    </div>
                                    <div className="text-[10px] space-y-0.5 text-slate-700 leading-tight">
                                        <div className="font-black text-slate-900 flex items-center gap-1">
                                            <span className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white px-1 py-0.5 rounded text-[8px] tracking-wider uppercase font-black">ARCA</span>
                                            <span>AFIP</span>
                                        </div>
                                        <p className="font-semibold">Comprobante Autorizado</p>
                                        <p className="text-[8px] text-slate-500 font-mono break-all max-w-[120px] overflow-hidden truncate">
                                            {getAfipQrValue().substring(0, 30)}...
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-col items-center justify-center border-2 border-slate-900 p-2 bg-white rounded-sm select-none shrink-0 max-w-[280px]">
                                    <div className="flex h-10 items-stretch gap-[1.5px]">
                                        {Array.from({ length: 45 }).map((_, i) => {
                                            const widths = [1, 2, 3, 1, 4, 2, 1, 3, 2];
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
                                    <span className="font-mono text-[8px] mt-1 tracking-[1.5px] text-slate-800">{barcodeValue}</span>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {isTicket && (
                        <div className="text-[10px] italic text-slate-400">
                            Este documento no tiene validez fiscal.
                            <br />
                            Use el POS para emitir facturas legales A o B.
                        </div>
                    )}
                </div>
                <div className="w-72 space-y-2 rounded-sm bg-slate-100 p-4 text-sm">
                    <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span>${Number(invoice.net_amount || 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>{taxRateLabel}:</span>
                        <span>${Number(invoice.vat_amount || 0).toFixed(2)}</span>
                    </div>
                    <div className="mt-2 flex justify-between border-t-2 border-slate-900 pt-2 text-2xl font-black">
                        <span>TOTAL:</span>
                        <span>${Number(invoice.total_amount || 0).toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {!printMode && (
                <div className="no-print flex justify-end gap-3 pt-6">
                    <Button
                        variant="outline"
                        className="h-12 border-slate-300 text-slate-700 hover:bg-slate-100"
                        onClick={() => onSendEmail?.(invoice)}
                    >
                        <Mail className="mr-2 h-4 w-4" />
                        Enviar por email
                    </Button>
                    <Button className="h-12 bg-slate-900 text-white hover:bg-slate-800" onClick={() => window.print()}>
                        <Printer className="mr-2 h-4 w-4" />
                        Imprimir comprobante
                    </Button>
                    <Button
                        variant="ghost"
                        className="h-12 text-slate-500 hover:text-slate-900"
                        onClick={() => onClose?.()}
                    >
                        Cerrar
                    </Button>
                </div>
            )}
        </div>
    )
}
