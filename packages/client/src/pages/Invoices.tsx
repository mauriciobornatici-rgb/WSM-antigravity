import { useState, useEffect } from "react"
import { api } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Plus, Printer, FileCheck, Mail, Eye, Download, ReceiptText } from "lucide-react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { showErrorToast } from "@/lib/errorHandling"
import {
    DEFAULT_COMPANY_SETTINGS,
    fetchCompanySettingsSafe,
    getCompanyAddressLine,
    getCompanyDisplayName,
    getTaxRatePercentage,
} from "@/lib/companySettings"
import type { Client, CompanySettings } from "@/types"
import type { Invoice, InvoiceItem } from "@/types/api"

type InvoiceView = Invoice & {
    client_name?: string
    client_tax_condition?: string
    client_tax_id?: string
    client_address?: string
    cae?: string
    net_amount?: number
    vat_amount?: number
    subtotal?: number
    client_snapshot?: {
        email?: string | null
    }
}

type DraftInvoiceItem = {
    description: string
    quantity: number
    unit_price: number
    vat_rate: number
    product_name?: string
}

type DraftInvoice = {
    client_id: string
    invoice_type: "A" | "B"
    point_of_sale: number
    items: DraftInvoiceItem[]
    notes: string
}

export default function InvoicesPage() {
    const [invoices, setInvoices] = useState<InvoiceView[]>([])
    const [loading, setLoading] = useState(true)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [selectedInvoice, setSelectedInvoice] = useState<InvoiceView | null>(null)
    const [clients, setClients] = useState<Client[]>([])
    const [companySettings, setCompanySettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS)

    const [newInvoice, setNewInvoice] = useState<DraftInvoice>({
        client_id: "", invoice_type: "B", point_of_sale: 1, items: [], notes: ""
    })
    const [manualItem, setManualItem] = useState<DraftInvoiceItem>({
        description: "", quantity: 1, unit_price: 0, vat_rate: getTaxRatePercentage(DEFAULT_COMPANY_SETTINGS)
    })
    const emailFeatureEnabled = import.meta.env.VITE_ENABLE_INVOICE_EMAIL === "true"

    useEffect(() => { void loadData() }, [])

    const loadData = async () => {
        setLoading(true)
        try {
            const [data, clientsData, settings] = await Promise.all([
                api.getInvoices(),
                api.getClients(),
                fetchCompanySettingsSafe(),
            ])
            setInvoices(data as InvoiceView[])
            setClients(clientsData)
            setCompanySettings(settings)
            const defaultVatRate = getTaxRatePercentage(settings)
            setManualItem((prev) => ({ ...prev, vat_rate: defaultVatRate }))
        } catch (error) {
            showErrorToast("Error cargando historial", error)
        } finally {
            setLoading(false)
        }
    }

    const addItem = () => {
        if (!manualItem.description || manualItem.unit_price <= 0) return
        setNewInvoice({ ...newInvoice, items: [...newInvoice.items, { ...manualItem }] })
        setManualItem({ description: "", quantity: 1, unit_price: 0, vat_rate: getTaxRatePercentage(companySettings) })
    }

    const calculateTotal = () => {
        return newInvoice.items.reduce((acc, item) => {
            const subtotal = item.quantity * item.unit_price;
            const vat = subtotal * (item.vat_rate / 100);
            return acc + subtotal + vat;
        }, 0);
    }

    const handleCreateInvoice = async () => {
        try {
            if (!newInvoice.client_id) { toast.error("Seleccione un cliente"); return; }
            if (newInvoice.items.length === 0) { toast.error("Agregue al menos un ítem"); return; }
            await api.createInvoice(newInvoice)
            toast.success("Factura emitida exitosamente")
            setIsCreateOpen(false)
            setNewInvoice({ client_id: "", invoice_type: "B", point_of_sale: 1, items: [], notes: "" })
            void loadData()
        } catch (error) {
            showErrorToast("Error al emitir factura", error)
        }
    }

    const handleSendEmail = (invoice: InvoiceView) => {
        // TODO: Integrar con endpoint backend real de envio de comprobantes.
        if (!emailFeatureEnabled) {
            toast.info("Envio por email en modo simulacion", {
                description: `No hay integracion activa. Destinatario estimado: ${invoice.client_snapshot?.email || "cliente sin email"}.`,
            });
            return;
        }

        toast.warning("Integracion de email pendiente", {
            description: "Activaste la feature flag, pero aun falta implementar el endpoint de envio.",
        });
    }

    const openInvoicePreview = async (invoice: InvoiceView) => {
        try {
            // Already have items if it comes from a fresh creation
            if (invoice.items && invoice.items.length > 0) {
                setSelectedInvoice(invoice);
                setIsPreviewOpen(true);
                return;
            }

            const items = await api.getInvoiceItems(invoice.id);
            setSelectedInvoice({ ...invoice, items });
            setIsPreviewOpen(true);
        } catch (error) {
            // Items failed to load — show invoice without line items
            showErrorToast("No se pudieron cargar los items de la factura", error)
            setSelectedInvoice(invoice);
            setIsPreviewOpen(true);
        }
    }

    const getStatusBadge = (status?: string, type?: string) => {
        if (type === 'TK') return <Badge className="bg-slate-500">Ticket No-Fiscal</Badge>
        switch (status) {
            case 'issued': return <Badge className="bg-blue-500">Emitida</Badge>
            case 'authorized': return <Badge className="bg-green-500">Autorizada (CAE)</Badge>
            default: return <Badge variant="outline">{status}</Badge>
        }
    }

    const formatInvoiceNumber = (inv: InvoiceView) => {
        if (inv.invoice_type === 'TK') return `TKT-${String(inv.id).split('-')[1] || inv.id.substring(4, 12)}`
        return `${inv.invoice_type}-${String(inv.point_of_sale).padStart(4, '0')}-${String(inv.invoice_number).padStart(8, '0')}`
    }

    const taxRateLabel = `IVA (${getTaxRatePercentage(companySettings)}%)`
    const companyName = getCompanyDisplayName(companySettings)
    const companyTaxId = companySettings.identity.tax_id || "No informado"
    const companyAddress = getCompanyAddressLine(companySettings)

    return (
        <div className="p-6 space-y-6 print:hidden">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Historial de Ventas</h1>
                    <p className="text-muted-foreground">Consulta de facturas legales y tickets de venta emitidos.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={loadData} disabled={loading} title="Actualizar Lista"><Download className="mr-2 h-4 w-4" /> Actualizar</Button>
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild><Button className="bg-primary"><Plus className="mr-2 h-4 w-4" /> Factura Manual</Button></DialogTrigger>
                        <DialogContent className="sm:max-w-[800px]">
                            <DialogHeader><DialogTitle>Nueva Factura de Venta</DialogTitle></DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Cliente</Label>
                                        <Select value={newInvoice.client_id} onValueChange={(val) => setNewInvoice({ ...newInvoice, client_id: val })}>
                                            <SelectTrigger><SelectValue placeholder="Seleccionar Cliente" /></SelectTrigger>
                                            <SelectContent>{clients.map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-2"><Label>Tipo</Label><Select value={newInvoice.invoice_type} onValueChange={(val) => setNewInvoice({ ...newInvoice, invoice_type: val as "A" | "B" })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A">Factura A</SelectItem><SelectItem value="B">Factura B</SelectItem></SelectContent></Select></div>
                                        <div className="space-y-2"><Label>Pto. Venta</Label><Input value={newInvoice.point_of_sale} disabled className="bg-muted" /></div>
                                    </div>
                                </div>
                                <div className="border rounded-md p-4 bg-slate-50 dark:bg-slate-900/50 space-y-4">
                                    <Table><TableHeader><TableRow><TableHead>Descripción</TableHead><TableHead className="w-20">Cant.</TableHead><TableHead>Precio Unit.</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                                        <TableBody>{newInvoice.items.map((item, idx) => (
                                            <TableRow key={idx}><TableCell>{item.description}</TableCell><TableCell>{item.quantity}</TableCell><TableCell>${item.unit_price}</TableCell><TableCell className="text-right">${((item.quantity * item.unit_price) * (1 + item.vat_rate / 100)).toFixed(2)}</TableCell></TableRow>
                                        ))}</TableBody></Table>
                                    <div className="grid grid-cols-12 gap-2"><div className="col-span-6"><Input placeholder="Descripción..." value={manualItem.description} onChange={e => setManualItem({ ...manualItem, description: e.target.value })} /></div><div className="col-span-2"><Input type="number" value={manualItem.quantity} onChange={e => setManualItem({ ...manualItem, quantity: Number(e.target.value) })} /></div><div className="col-span-2"><Input type="number" value={manualItem.unit_price} onChange={e => setManualItem({ ...manualItem, unit_price: Number(e.target.value) })} /></div><div className="col-span-2"><Button variant="secondary" className="w-full" onClick={addItem}>Agregar</Button></div></div>
                                </div>
                                <div className="flex justify-end text-xl font-bold">Total: ${calculateTotal().toFixed(2)}</div>
                            </div>
                            <DialogFooter><Button onClick={handleCreateInvoice}>Emitir Factura</Button></DialogFooter>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            <Card>
                <CardHeader><CardTitle>Comprobantes y Tickets</CardTitle></CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Comprobante</TableHead><TableHead>Cliente</TableHead><TableHead>CAE</TableHead><TableHead>Importe Total</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {invoices.map((inv) => (
                                <TableRow key={inv.id}>
                                    <TableCell>{inv.issue_date ? new Date(inv.issue_date).toLocaleDateString() : '-'}</TableCell>
                                    <TableCell className="font-mono font-bold flex items-center gap-2">
                                        {inv.invoice_type === 'TK' ? <ReceiptText className="h-4 w-4 text-slate-400" /> : <FileCheck className="h-4 w-4 text-blue-400" />}
                                        {formatInvoiceNumber(inv)}
                                    </TableCell>
                                    <TableCell><div>{inv.client_name}</div><div className="text-xs text-muted-foreground">{inv.client_tax_condition}</div></TableCell>
                                    <TableCell>{inv.cae ? <span className="text-xs font-mono text-green-600 font-bold">{inv.cae}</span> : <span className="text-muted-foreground">-</span>}</TableCell>
                                    <TableCell className="font-bold">${Number(inv.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                    <TableCell>{getStatusBadge(inv.status, inv.invoice_type)}</TableCell>
                                    <TableCell className="text-right flex justify-end gap-1">
                                        <Button variant="ghost" size="sm" title="Ver Detalles" onClick={() => openInvoicePreview(inv)}><Eye className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="sm" title="Enviar por email" onClick={() => handleSendEmail(inv)}><Mail className="h-4 w-4 text-blue-500" /></Button>
                                        <Button variant="ghost" size="sm" title="Imprimir" onClick={() => { setSelectedInvoice(inv); setTimeout(() => window.print(), 200); }}><Printer className="h-4 w-4" /></Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {invoices.length === 0 && !loading && (
                                <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No hay ventas registradas.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                <DialogContent className="max-w-[800px] h-[90vh] overflow-y-auto bg-white text-slate-900 border-none no-print print:hidden">
                    <DialogHeader className="sr-only"><DialogTitle>Previsualización de Comprobante</DialogTitle></DialogHeader>
                    {selectedInvoice ? (
                        <div className="p-8 space-y-8" id="printable-invoice-content">
                            <div className="flex justify-between border-b-2 border-slate-900 pb-4">
                                <div className="space-y-1">
                                    <h2 className="text-4xl font-black text-slate-800">{selectedInvoice.invoice_type === 'TK' ? 'TICKET' : 'FACTURA'}</h2>
                                    <div className="flex items-center gap-2">
                                        <div className="w-14 h-14 border-2 border-slate-900 flex items-center justify-center font-bold text-3xl">
                                            {selectedInvoice.invoice_type === 'TK' ? 'X' : selectedInvoice.invoice_type}
                                        </div>
                                        <div className="text-[10px] font-bold leading-tight uppercase">
                                            {selectedInvoice.invoice_type === 'TK' ? 'Documento\nNo Válido\nComo Factura' : 'Cod. 01\nComprobante\nOriginal'}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right space-y-1">
                                    <p className="text-xl font-bold">Nº {formatInvoiceNumber(selectedInvoice)}</p>
                                    <p className="text-sm">Fecha: <b>{selectedInvoice.issue_date ? new Date(selectedInvoice.issue_date).toLocaleDateString() : '-'}</b></p>
                                    <p className="text-sm">CUIT: <b>{companyTaxId}</b></p>
                                    <p className="text-sm">Ingresos Brutos: <b>Exento</b></p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-8 text-sm">
                                <div className="space-y-1 border-r pr-4">
                                    <p className="text-slate-500 uppercase font-semibold text-[10px]">Emisor</p>
                                    <p className="font-bold text-lg">{companyName}</p>
                                    <p>{companyAddress}</p>
                                    <p className="font-semibold italic">IVA Responsable Inscripto</p>
                                </div>
                                <div className="space-y-1 pl-4">
                                    <p className="text-slate-500 uppercase font-semibold text-[10px]">Receptor</p>
                                    <p className="font-bold text-lg">{selectedInvoice.client_name || 'Consumidor Final'}</p>
                                    <p>CUIT/DNI: <b>{selectedInvoice.client_tax_id || '99-99999999-9'}</b></p>
                                    <p>Condición: <b>{selectedInvoice.client_tax_condition || 'Consumidor Final'}</b></p>
                                    <p>Domicilio: {selectedInvoice.client_address || 'S/D'}</p>
                                </div>
                            </div>

                            <div className="border-2 border-slate-900 rounded-sm overflow-hidden">
                                <Table>
                                    <TableHeader className="bg-slate-200"><TableRow><TableHead className="text-slate-900 font-bold border-r border-slate-300">Descripción</TableHead><TableHead className="text-slate-900 font-bold text-center border-r border-slate-300 w-20">Cant.</TableHead><TableHead className="text-slate-900 font-bold text-right border-r border-slate-300 w-32">Unitario</TableHead><TableHead className="text-slate-900 font-bold text-right w-32">Total</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {(selectedInvoice.items && selectedInvoice.items.length > 0) ? (
                                            selectedInvoice.items.map((item: InvoiceItem, idx: number) => (
                                                <TableRow key={idx} className="border-b border-slate-200">
                                                    <TableCell className="border-r border-slate-200">{item.product_name || item.description || 'Producto'}</TableCell>
                                                    <TableCell className="text-center border-r border-slate-200">{item.quantity}</TableCell>
                                                    <TableCell className="text-right border-r border-slate-200">${Number(item.unit_price || 0).toLocaleString()}</TableCell>
                                                    <TableCell className="text-right font-semibold">${(Number(item.quantity || 1) * Number(item.unit_price || 0)).toLocaleString()}</TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow className="border-b border-slate-200">
                                                <TableCell className="border-r border-slate-200">Venta comercial</TableCell>
                                                <TableCell className="text-center border-r border-slate-200">1</TableCell>
                                                <TableCell className="text-right border-r border-slate-200">${Number(selectedInvoice.net_amount || selectedInvoice.subtotal || 0).toLocaleString()}</TableCell>
                                                <TableCell className="text-right font-semibold">${Number(selectedInvoice.total_amount || 0).toLocaleString()}</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            <div className="flex justify-between items-start">
                                <div className="space-y-4">
                                    {selectedInvoice.cae && (
                                        <div className="p-4 bg-slate-50 border-2 border-slate-900 rounded text-xs font-mono">
                                            <p className="font-bold border-b pb-1 mb-1">AUTORIZACIÓN AFIP</p>
                                            <p>CAE: <span className="font-bold">{selectedInvoice.cae}</span></p>
                                            <p>Vto. CAE: <span className="font-bold">{new Date().toLocaleDateString()}</span></p>
                                        </div>
                                    )}
                                    {selectedInvoice.invoice_type === 'TK' && (
                                        <div className="text-[10px] text-slate-400 italic">
                                            Este documento no tiene validez fiscal.<br />
                                            Use el POS para emitir facturas legales A o B.
                                        </div>
                                    )}
                                </div>
                                <div className="w-72 space-y-2 text-sm bg-slate-100 p-4 rounded-sm">
                                    <div className="flex justify-between"><span>Subtotal:</span><span>${Number(selectedInvoice.net_amount || 0).toFixed(2)}</span></div>
                                    <div className="flex justify-between"><span>{taxRateLabel}:</span><span>${Number(selectedInvoice.vat_amount || 0).toFixed(2)}</span></div>
                                    <div className="flex justify-between text-2xl font-black border-t-2 border-slate-900 pt-2 mt-2">
                                        <span>TOTAL:</span><span>${Number(selectedInvoice.total_amount || 0).toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end gap-3 pt-6 no-print">
                                <Button variant="outline" className="h-12 border-slate-300 text-slate-700 hover:bg-slate-100" onClick={() => handleSendEmail(selectedInvoice)}><Mail className="mr-2 h-4 w-4" /> Enviar por Email</Button>
                                <Button className="h-12 bg-slate-900 text-white hover:bg-slate-800" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Imprimir Comprobante</Button>
                                <Button variant="ghost" className="h-12 text-slate-500 hover:text-slate-900" onClick={() => setIsPreviewOpen(false)}>Cerrar</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-64 flex items-center justify-center"><p>Cargando detalles...</p></div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Hidden Printable Invoice Area (Native Print) */}
            <div id="printable-invoice" className="hidden print:block fixed inset-0 bg-white text-black p-0 m-0 z-[9999]">
                {selectedInvoice && (
                    <div className="p-10 w-full bg-white">
                        <div className="flex justify-between border-b-2 border-slate-900 pb-4">
                            <div className="space-y-1">
                                <h2 className="text-4xl font-black text-slate-800">{selectedInvoice.invoice_type === 'TK' ? 'TICKET' : 'FACTURA'}</h2>
                                <div className="flex items-center gap-2">
                                    <div className="w-14 h-14 border-2 border-slate-900 flex items-center justify-center font-bold text-3xl">
                                        {selectedInvoice.invoice_type === 'TK' ? 'X' : selectedInvoice.invoice_type}
                                    </div>
                                    <div className="text-[10px] font-bold leading-tight uppercase">
                                        {selectedInvoice.invoice_type === 'TK' ? 'Documento\nNo Válido\nComo Factura' : 'Cod. 01\nComprobante\nOriginal'}
                                    </div>
                                </div>
                            </div>
                            <div className="text-right space-y-1">
                                <p className="text-xl font-bold">Nº {formatInvoiceNumber(selectedInvoice)}</p>
                                <p className="text-sm">Fecha: <b>{selectedInvoice.issue_date ? new Date(selectedInvoice.issue_date).toLocaleDateString() : '-'}</b></p>
                                <p className="text-sm">CUIT: <b>{companyTaxId}</b></p>
                                <p className="text-sm">Ingresos Brutos: <b>Exento</b></p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-8 text-sm mt-8">
                            <div className="space-y-1 border-r border-slate-200 pr-4">
                                <p className="text-slate-500 uppercase font-semibold text-[10px]">Emisor</p>
                                <p className="font-bold text-lg">{companyName}</p>
                                <p>{companyAddress}</p>
                                <p className="font-semibold italic">IVA Responsable Inscripto</p>
                            </div>
                            <div className="space-y-1 pl-4">
                                <p className="text-slate-500 uppercase font-semibold text-[10px]">Receptor</p>
                                <p className="font-bold text-lg">{selectedInvoice.client_name || 'Consumidor Final'}</p>
                                <p>CUIT/DNI: <b>{selectedInvoice.client_tax_id || '99-99999999-9'}</b></p>
                                <p>Condición: <b>{selectedInvoice.client_tax_condition || 'Consumidor Final'}</b></p>
                                <p>Domicilio: {selectedInvoice.client_address || 'S/D'}</p>
                            </div>
                        </div>

                        <div className="border-2 border-slate-900 rounded-sm overflow-hidden mt-8">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-200">
                                    <tr>
                                        <th className="text-left p-2 border-r border-slate-300">Descripción</th>
                                        <th className="p-2 border-r border-slate-300 w-20">Cant.</th>
                                        <th className="text-right p-2 border-r border-slate-300 w-32">Unitario</th>
                                        <th className="text-right p-2 w-32">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(selectedInvoice.items && selectedInvoice.items.length > 0) ? (
                                        selectedInvoice.items.map((item: InvoiceItem, idx: number) => (
                                            <tr key={idx} className="border-b border-slate-200">
                                                <td className="p-2 border-r border-slate-200 text-left">{item.product_name || item.description || 'Producto'}</td>
                                                <td className="p-2 border-r border-slate-200 text-center">{item.quantity}</td>
                                                <td className="p-2 border-r border-slate-200 text-right">${Number(item.unit_price || 0).toLocaleString()}</td>
                                                <td className="p-2 text-right font-semibold">${(Number(item.quantity || 1) * Number(item.unit_price || 0)).toLocaleString()}</td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr className="border-b border-slate-200">
                                            <td className="p-2 border-r border-slate-200 text-left">Venta comercial</td>
                                            <td className="p-2 border-r border-slate-200 text-center">1</td>
                                            <td className="p-2 border-r border-slate-200 text-right">${Number(selectedInvoice.net_amount || selectedInvoice.subtotal || 0).toLocaleString()}</td>
                                            <td className="p-2 text-right font-semibold">${Number(selectedInvoice.total_amount || 0).toLocaleString()}</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="flex justify-between items-start mt-8">
                            <div className="space-y-4">
                                {selectedInvoice.cae && (
                                    <div className="p-4 bg-slate-50 border-2 border-slate-900 rounded text-xs font-mono">
                                        <p className="font-bold border-b pb-1 mb-1 uppercase text-left">Autorización AFIP</p>
                                        <p className="text-left">CAE: <span className="font-bold">{selectedInvoice.cae}</span></p>
                                        <p className="text-left">Vto. CAE: <span className="font-bold">{new Date().toLocaleDateString()}</span></p>
                                    </div>
                                )}
                            </div>
                            <div className="w-72 space-y-2 text-sm bg-slate-100 p-4 rounded-sm">
                                <div className="flex justify-between text-left"><span>Subtotal:</span><span>${Number(selectedInvoice.net_amount || 0).toFixed(2)}</span></div>
                                <div className="flex justify-between text-left"><span>{taxRateLabel}:</span><span>${Number(selectedInvoice.vat_amount || 0).toFixed(2)}</span></div>
                                <div className="flex justify-between text-2xl font-black border-t-2 border-slate-900 pt-2 mt-2 text-left">
                                    <span>TOTAL:</span><span>${Number(selectedInvoice.total_amount || 0).toFixed(2)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

