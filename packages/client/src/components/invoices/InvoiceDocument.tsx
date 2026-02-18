import { Mail, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatInvoiceNumber } from "./invoiceUtils"
import type { InvoiceView } from "./types"
import type { InvoiceItem } from "@/types/api"

type InvoiceDocumentProps = {
    invoice: InvoiceView
    companyName: string
    companyTaxId: string
    companyAddress: string
    taxRateLabel: string
    printMode?: boolean
    onSendEmail?: (invoice: InvoiceView) => void
    onClose?: () => void
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
}: InvoiceDocumentProps) {
    const isTicket = invoice.invoice_type === "TK"

    return (
        <div
            id={printMode ? undefined : "printable-invoice-content"}
            className={printMode ? "w-full space-y-8 bg-white p-10" : "space-y-8 p-8"}
        >
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
                        Ingresos brutos: <b>Exento</b>
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-8 text-sm">
                <div className="space-y-1 border-r border-slate-200 pr-4">
                    <p className="text-[10px] font-semibold uppercase text-slate-500">Emisor</p>
                    <p className="text-lg font-bold">{companyName}</p>
                    <p>{companyAddress}</p>
                    <p className="font-semibold italic">IVA Responsable Inscripto</p>
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
                <div className="space-y-4">
                    {invoice.cae && (
                        <div className="rounded border-2 border-slate-900 bg-slate-50 p-4 font-mono text-xs">
                            <p className="mb-1 border-b pb-1 font-bold uppercase">Autorización AFIP</p>
                            <p>
                                CAE: <span className="font-bold">{invoice.cae}</span>
                            </p>
                            <p>
                                Vto. CAE: <span className="font-bold">{new Date().toLocaleDateString("es-AR")}</span>
                            </p>
                        </div>
                    )}
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
