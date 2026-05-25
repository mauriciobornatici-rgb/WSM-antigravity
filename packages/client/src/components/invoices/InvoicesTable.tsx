import { Download, Eye, FileCheck, Mail, Printer, ReceiptText } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatInvoiceNumber, getInvoiceStatusBadge } from "./invoiceUtils"
import type { InvoiceView } from "./types"

type InvoicesTableProps = {
    invoices: InvoiceView[]
    loading: boolean
    onRefresh: () => void
    onPreview: (invoice: InvoiceView) => void
    onSendEmail: (invoice: InvoiceView) => void
    onPrint: (invoice: InvoiceView) => void
    onExportCSV: () => void
    onPrintThermal?: ((invoice: InvoiceView) => void) | undefined
}

export function InvoicesTable({
    invoices,
    loading,
    onRefresh,
    onPreview,
    onSendEmail,
    onPrint,
    onExportCSV,
    onPrintThermal,
}: InvoicesTableProps) {
    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Comprobantes y tickets</CardTitle>
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <Button className="w-full sm:w-auto border-emerald-600/40 text-emerald-500 hover:bg-emerald-600/10 hover:text-emerald-600" variant="outline" onClick={onExportCSV} disabled={loading} title="Exportar reporte Libro IVA a Excel">
                        <Download className="mr-2 h-4 w-4" />
                        Exportar Libro IVA
                    </Button>
                    <Button className="w-full sm:w-auto" variant="outline" onClick={onRefresh} disabled={loading} title="Actualizar lista">
                        <Download className="mr-2 h-4 w-4" />
                        Actualizar
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <Table className="min-w-[820px]">
                    <TableHeader>
                        <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Comprobante</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>CAE</TableHead>
                            <TableHead>Importe total</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {invoices.map((invoice) => (
                            <TableRow key={invoice.id}>
                                <TableCell>
                                    {invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString("es-AR") : "-"}
                                </TableCell>
                                <TableCell className="flex items-center gap-2 font-mono font-bold">
                                    {invoice.invoice_type === "TK" ? (
                                        <ReceiptText className="h-4 w-4 text-slate-400" />
                                    ) : (
                                        <FileCheck className="h-4 w-4 text-blue-400" />
                                    )}
                                    {formatInvoiceNumber(invoice)}
                                </TableCell>
                                <TableCell>
                                    <div>{invoice.client_name}</div>
                                    <div className="text-xs text-muted-foreground">{invoice.client_tax_condition}</div>
                                </TableCell>
                                <TableCell>
                                    {invoice.cae ? (
                                        <span className="text-xs font-mono font-bold text-green-600">{invoice.cae}</span>
                                    ) : (
                                        <span className="text-muted-foreground">-</span>
                                    )}
                                </TableCell>
                                <TableCell className="font-bold">
                                    ${Number(invoice.total_amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell>{getInvoiceStatusBadge(invoice.status, invoice.invoice_type)}</TableCell>
                                <TableCell className="flex justify-end gap-1 text-right">
                                    <Button variant="ghost" size="sm" title="Ver detalles" onClick={() => onPreview(invoice)}>
                                        <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="sm" title="Enviar por email" onClick={() => onSendEmail(invoice)}>
                                        <Mail className="h-4 w-4 text-blue-500" />
                                    </Button>
                                    <Button variant="ghost" size="sm" title="Imprimir Factura A4" onClick={() => onPrint(invoice)}>
                                        <Printer className="h-4 w-4" />
                                    </Button>
                                    {invoice.invoice_type !== "TK" && onPrintThermal && (
                                        <Button variant="ghost" size="sm" title="Imprimir Ticket (80mm)" onClick={() => onPrintThermal(invoice)}>
                                            <ReceiptText className="h-4 w-4 text-slate-400" />
                                        </Button>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                        {invoices.length === 0 && !loading && (
                            <TableRow>
                                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                    No hay ventas registradas.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}
