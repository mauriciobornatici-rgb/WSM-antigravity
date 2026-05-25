import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { showErrorToast } from "@/lib/errorHandling";
import type { Invoice, InvoiceItem } from "@/types/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { 
    Search, 
    Printer, 
    AlertTriangle, 
    Loader2, 
    Calendar, 
    Receipt, 
    User, 
    CreditCard, 
    Clock, 
    RefreshCw 
} from "lucide-react";

export interface POSHistoryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onPrint: (layout: "a4" | "thermal", invoice: Invoice) => void;
}

export function POSHistoryDialog({
    open,
    onOpenChange,
    onPrint
}: POSHistoryDialogProps) {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loadingList, setLoadingList] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [dateFilter, setDateFilter] = useState<"today" | "week" | "all">("today");
    
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
    const [loadingItems, setLoadingItems] = useState(false);
    const [authorizingId, setAuthorizingId] = useState<string | null>(null);

    // Load recent invoices
    const loadInvoices = async () => {
        if (!open) return;
        setLoadingList(true);
        try {
            const data = await api.getInvoices();
            setInvoices(data);
            
            // Auto-select the first one if none selected or if previously selected is not in the list
            if (data.length > 0) {
                const alreadySelected = data.find(inv => inv.id === selectedInvoice?.id);
                if (!alreadySelected) {
                    const firstInvoice = data[0];
                    if (firstInvoice) {
                        void handleSelectInvoice(firstInvoice);
                    }
                }
            } else {
                setSelectedInvoice(null);
            }
        } catch (error) {
            showErrorToast("Error al cargar historial de ventas", error);
        } finally {
            setLoadingList(false);
        }
    };

    useEffect(() => {
        if (open) {
            void loadInvoices();
        }
    }, [open]);

    // Handle selecting an invoice and loading its items
    const handleSelectInvoice = async (invoice: Invoice) => {
        setSelectedInvoice(invoice);
        
        // If items are not loaded, fetch them
        if (!invoice.items || invoice.items.length === 0) {
            setLoadingItems(true);
            try {
                const items = await api.getInvoiceItems(invoice.id);
                const updatedInvoice = { ...invoice, items: items as InvoiceItem[] };
                setSelectedInvoice(updatedInvoice);
                
                // Update in invoices list so we don't refetch next time
                setInvoices(prev => prev.map(inv => inv.id === invoice.id ? updatedInvoice : inv));
            } catch (error) {
                showErrorToast("Error al obtener los detalles de la venta", error);
            } finally {
                setLoadingItems(false);
            }
        }
    };

    // AFIP/ARCA authorization
    const handleAuthorize = async (invoiceId: string) => {
        setAuthorizingId(invoiceId);
        try {
            const updated = await api.authorizeInvoice(invoiceId);
            toast.success("Factura autorizada exitosamente con CAE");
            
            // Update local state
            setInvoices(prev => prev.map(inv => inv.id === invoiceId ? { ...inv, ...updated } : inv));
            if (selectedInvoice?.id === invoiceId) {
                setSelectedInvoice(prev => prev ? { ...prev, ...updated } : null);
            }
        } catch (err) {
            toast.error("Error al autorizar factura con AFIP");
        } finally {
            setAuthorizingId(null);
        }
    };

    // Date formatting helper
    const formatDate = (dateStr?: string) => {
        if (!dateStr) return "-";
        return new Date(dateStr).toLocaleString("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    };

    // Invoice number formatter
    const getInvoiceLabel = (invoice: Invoice) => {
        if (invoice.invoice_type === "TK") {
            return `TKT-${String(invoice.id).split("-")[1] || invoice.id.substring(4, 12).toUpperCase()}`;
        }
        return `${invoice.invoice_type}-${String(invoice.point_of_sale || 1).padStart(4, "0")}-${String(invoice.invoice_number || 0).padStart(8, "0")}`;
    };

    // Filter invoices based on search term and selected date filter
    const filteredInvoices = useMemo(() => {
        return invoices.filter(invoice => {
            // Search filter
            const query = searchTerm.trim().toLowerCase();
            const clientName = String(invoice.client_name || invoice.customer_name || "").toLowerCase();
            const invNumber = getInvoiceLabel(invoice).toLowerCase();
            const invTotal = String(invoice.total_amount);
            
            const matchesSearch = !query || 
                clientName.includes(query) || 
                invNumber.includes(query) || 
                invTotal.includes(query);

            if (!matchesSearch) return false;

            // Date filter
            if (dateFilter === "all") return true;

            const issueDate = invoice.issue_date ? new Date(invoice.issue_date) : new Date();
            const today = new Date();
            
            if (dateFilter === "today") {
                return issueDate.toDateString() === today.toDateString();
            }
            
            if (dateFilter === "week") {
                const diffTime = Math.abs(today.getTime() - issueDate.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                return diffDays <= 7;
            }

            return true;
        });
    }, [invoices, searchTerm, dateFilter]);

    const getStatusBadge = (invoice: Invoice) => {
        if (invoice.invoice_type === "TK") {
            return <Badge className="bg-slate-700/80 text-slate-300 hover:bg-slate-700">Ticket No Fiscal</Badge>;
        }
        
        if (invoice.cae) {
            return <Badge className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30">Autorizada (CAE)</Badge>;
        }
        
        return <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30">Pendiente CAE</Badge>;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[96vw] max-w-6xl h-[90vh] flex flex-col p-6 bg-slate-900 border-slate-800 text-slate-100">
                <DialogHeader className="flex flex-row items-center justify-between border-b border-slate-800 pb-3">
                    <DialogTitle className="flex items-center gap-2 text-xl font-bold text-white">
                        <Receipt className="h-6 w-6 text-blue-500" />
                        Historial de Ventas Recientes
                    </DialogTitle>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="text-slate-400 hover:text-white"
                        onClick={() => void loadInvoices()}
                        disabled={loadingList}
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${loadingList ? 'animate-spin' : ''}`} />
                        Sincronizar
                    </Button>
                </DialogHeader>

                {/* Filters Row */}
                <div className="flex flex-col sm:flex-row gap-3 py-3 items-center justify-between">
                    <div className="relative w-full sm:max-w-xs">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                        <Input
                            placeholder="Buscar por cliente, nro o total..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-500 focus-visible:ring-blue-500"
                        />
                    </div>
                    
                    <div className="flex bg-slate-950 p-1 rounded-md border border-slate-800 self-stretch sm:self-auto">
                        <Button
                            size="sm"
                            variant={dateFilter === "today" ? "secondary" : "ghost"}
                            onClick={() => setDateFilter("today")}
                            className={`text-xs px-4 ${dateFilter === "today" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}
                        >
                            <Calendar className="h-3 w-3 mr-1.5" />
                            Hoy
                        </Button>
                        <Button
                            size="sm"
                            variant={dateFilter === "week" ? "secondary" : "ghost"}
                            onClick={() => setDateFilter("week")}
                            className={`text-xs px-4 ${dateFilter === "week" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}
                        >
                            Última Semana
                        </Button>
                        <Button
                            size="sm"
                            variant={dateFilter === "all" ? "secondary" : "ghost"}
                            onClick={() => setDateFilter("all")}
                            className={`text-xs px-4 ${dateFilter === "all" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`}
                        >
                            Todos
                        </Button>
                    </div>
                </div>

                {/* Main Content Grid */}
                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-6 min-h-0">
                    {/* Left Column: List of Invoices */}
                    <div className="md:col-span-7 flex flex-col border border-slate-800 rounded-lg bg-slate-950 overflow-hidden">
                        <div className="flex-1 overflow-y-auto">
                            {loadingList ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                    <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                                    Cargando historial de ventas...
                                </div>
                            ) : filteredInvoices.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-500 p-6 text-center gap-2">
                                    <Receipt className="h-12 w-12 text-slate-700" />
                                    <p className="font-semibold text-slate-400">No se encontraron ventas</p>
                                    <p className="text-xs max-w-xs">Intenta modificando los filtros de búsqueda o fecha.</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader className="bg-slate-900/60 sticky top-0 backdrop-blur-sm z-10 border-b border-slate-800">
                                        <TableRow className="border-slate-850 hover:bg-transparent">
                                            <TableHead className="text-slate-400 font-semibold py-3 pl-4">Fecha</TableHead>
                                            <TableHead className="text-slate-400 font-semibold">Comprobante</TableHead>
                                            <TableHead className="text-slate-400 font-semibold">Cliente</TableHead>
                                            <TableHead className="text-slate-400 font-semibold text-right pr-4">Total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredInvoices.map((invoice) => {
                                            const isSelected = selectedInvoice?.id === invoice.id;
                                            return (
                                                <TableRow
                                                    key={invoice.id}
                                                    onClick={() => void handleSelectInvoice(invoice)}
                                                    className={`border-slate-850 cursor-pointer transition-colors ${
                                                        isSelected 
                                                            ? "bg-blue-600/10 hover:bg-blue-600/15 text-white" 
                                                            : "hover:bg-slate-900/40 text-slate-300"
                                                    }`}
                                                >
                                                    <TableCell className="py-3.5 pl-4 font-sans text-xs">
                                                        <div className="flex flex-col">
                                                            <span>{formatDate(invoice.issue_date).split(", ")[0]}</span>
                                                            <span className="text-slate-500 text-[10px] mt-0.5">
                                                                {formatDate(invoice.issue_date).split(", ")[1] || ""}
                                                            </span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs">
                                                        <div className="flex flex-col gap-1 items-start">
                                                            <span className="font-bold text-slate-200">
                                                                {getInvoiceLabel(invoice)}
                                                            </span>
                                                            {getStatusBadge(invoice)}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="font-sans text-xs font-medium max-w-[150px] truncate">
                                                        {String(invoice.client_name || invoice.customer_name || "Consumidor final")}
                                                    </TableCell>
                                                    <TableCell className="font-mono text-xs font-bold text-right pr-4 text-emerald-400">
                                                        ${Number(invoice.total_amount).toLocaleString("es-AR", { 
                                                            minimumFractionDigits: 2,
                                                            maximumFractionDigits: 2
                                                        })}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                        <div className="p-3 border-t border-slate-800 bg-slate-900/40 text-[11px] text-slate-500 flex justify-between">
                            <span>Mostrando {filteredInvoices.length} de {invoices.length} ventas</span>
                            <span>WSM ERP Sports</span>
                        </div>
                    </div>

                    {/* Right Column: Active Invoice Detail & Print actions */}
                    <div className="md:col-span-5 flex flex-col border border-slate-800 rounded-lg bg-slate-950 overflow-hidden">
                        {selectedInvoice ? (
                            <div className="flex-1 flex flex-col min-h-0">
                                {/* Detail Header */}
                                <div className="p-4 border-b border-slate-850 bg-slate-900/40 space-y-2">
                                    <div className="flex justify-between items-start">
                                        <div className="space-y-1">
                                            <span className="text-[10px] uppercase tracking-wider font-bold text-blue-400">
                                                Detalle de Venta
                                            </span>
                                            <h3 className="text-base font-mono font-bold text-white">
                                                {getInvoiceLabel(selectedInvoice)}
                                            </h3>
                                        </div>
                                        {getStatusBadge(selectedInvoice)}
                                    </div>
                                </div>

                                {/* Detail Contents */}
                                <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-sm">
                                    {/* Quick Info Grid */}
                                    <div className="grid grid-cols-2 gap-3 text-xs border-b border-slate-900 pb-3">
                                        <div className="space-y-1">
                                            <p className="text-slate-500 flex items-center gap-1">
                                                <User className="h-3 w-3" /> Cliente
                                            </p>
                                            <p className="font-semibold text-slate-200 truncate">
                                                {String(selectedInvoice.client_name || selectedInvoice.customer_name || "Consumidor final")}
                                            </p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-slate-500 flex items-center gap-1">
                                                <Clock className="h-3 w-3" /> Fecha y Hora
                                            </p>
                                            <p className="font-semibold text-slate-200">
                                                {formatDate(selectedInvoice.issue_date)}
                                            </p>
                                        </div>
                                        {!!selectedInvoice.client_tax_id && (
                                            <div className="space-y-1">
                                                <p className="text-slate-500">CUIT / DNI</p>
                                                <p className="font-mono text-slate-200">{String(selectedInvoice.client_tax_id)}</p>
                                            </div>
                                        )}
                                        {selectedInvoice.payment_method && (
                                            <div className="space-y-1">
                                                <p className="text-slate-500 flex items-center gap-1">
                                                    <CreditCard className="h-3 w-3" /> Medio de Pago
                                                </p>
                                                <p className="font-semibold text-slate-200 uppercase">
                                                    {selectedInvoice.payment_method === "cash" ? "Efectivo" : 
                                                     selectedInvoice.payment_method === "debit_card" ? "Débito" :
                                                     selectedInvoice.payment_method === "credit_card" ? "Crédito" :
                                                     selectedInvoice.payment_method === "qr" ? "Código QR" :
                                                     selectedInvoice.payment_method === "transfer" ? "Transferencia" :
                                                     selectedInvoice.payment_method === "credit_account" ? "Cuenta Corriente" : String(selectedInvoice.payment_method)}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Items Table */}
                                    <div className="space-y-2">
                                        <h4 className="text-xs font-semibold text-slate-400">Productos Vendidos</h4>
                                        
                                        {loadingItems ? (
                                            <div className="py-8 flex flex-col items-center justify-center text-slate-500 gap-2">
                                                <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                                                <span className="text-xs">Cargando ítems...</span>
                                            </div>
                                        ) : !selectedInvoice.items || selectedInvoice.items.length === 0 ? (
                                            <div className="py-4 text-center text-xs text-slate-500">
                                                No hay ítems cargados
                                            </div>
                                        ) : (
                                            <div className="border border-slate-900 rounded bg-slate-950 overflow-hidden text-xs">
                                                <Table>
                                                    <TableHeader className="bg-slate-900/30">
                                                        <TableRow className="border-slate-900 hover:bg-transparent">
                                                            <TableHead className="text-[10px] text-slate-500 py-1.5">Desc</TableHead>
                                                            <TableHead className="text-[10px] text-slate-500 text-center py-1.5">Cant</TableHead>
                                                            <TableHead className="text-[10px] text-slate-500 text-right py-1.5">P.Unit</TableHead>
                                                            <TableHead className="text-[10px] text-slate-500 text-right py-1.5 pr-2">Total</TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {selectedInvoice.items.map((item, idx) => (
                                                            <TableRow key={idx} className="border-slate-900 hover:bg-transparent text-slate-300">
                                                                <TableCell className="py-2 max-w-[120px] truncate">
                                                                    <div className="flex flex-col">
                                                                        <span className="font-medium text-slate-200">{String(item.description || item.product_name)}</span>
                                                                        {item.sku && <span className="text-[9px] text-slate-500 font-mono mt-0.5">{item.sku}</span>}
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="text-center font-bold font-mono py-2">{item.quantity}</TableCell>
                                                                <TableCell className="text-right font-mono py-2">${Number(item.unit_price).toFixed(2)}</TableCell>
                                                                <TableCell className="text-right font-mono py-2 pr-2 font-semibold">
                                                                    ${Number((item.total_line != null ? item.total_line : (item.quantity * item.unit_price))).toFixed(2)}
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </div>
                                        )}
                                    </div>

                                    {/* CAE / Fiscal Section */}
                                    {selectedInvoice.invoice_type !== "TK" && (
                                        <div className="space-y-2">
                                            {selectedInvoice.cae ? (
                                                <div className="rounded-md border border-emerald-500/10 bg-emerald-500/5 p-3 text-xs space-y-1 font-mono">
                                                    <div className="flex justify-between text-emerald-400">
                                                        <span>CAE AFIP:</span>
                                                        <span className="font-bold">{String(selectedInvoice.cae)}</span>
                                                    </div>
                                                    {selectedInvoice.cae_expiration_date && (
                                                        <div className="flex justify-between text-slate-500 text-[10px]">
                                                            <span>Vto. CAE:</span>
                                                            <span>{new Date(selectedInvoice.cae_expiration_date as string).toLocaleDateString("es-AR")}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs flex flex-col gap-2">
                                                    <div className="flex items-start gap-1.5 text-amber-500">
                                                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                                                        <div className="space-y-0.5 font-sans">
                                                            <p className="font-semibold">Requiere CAE de AFIP</p>
                                                            <p className="text-[10px] text-slate-400">Esta factura A/B requiere autorización fiscal de validez legal.</p>
                                                        </div>
                                                    </div>
                                                    <Button 
                                                        size="sm" 
                                                        className="bg-amber-600 hover:bg-amber-700 text-white font-semibold w-full mt-1 h-8"
                                                        onClick={() => void handleAuthorize(selectedInvoice.id)} 
                                                        disabled={authorizingId === selectedInvoice.id}
                                                    >
                                                        {authorizingId === selectedInvoice.id ? (
                                                            <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Autorizando...</>
                                                        ) : (
                                                            "Solicitar CAE AFIP ahora"
                                                        )}
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Totals Summary */}
                                    <div className="space-y-1.5 rounded-md border border-slate-900 bg-slate-950/60 p-3 text-xs font-mono">
                                        {selectedInvoice.net_amount != null && (
                                            <p className="flex justify-between text-slate-400">
                                                <span>Neto Gravado:</span>
                                                <span>${Number(selectedInvoice.net_amount).toFixed(2)}</span>
                                            </p>
                                        )}
                                        {selectedInvoice.vat_amount != null && (
                                            <p className="flex justify-between text-slate-400">
                                                <span>IVA Liquidado:</span>
                                                <span>${Number(selectedInvoice.vat_amount).toFixed(2)}</span>
                                            </p>
                                        )}
                                        <p className="flex justify-between border-t border-slate-900 pt-1.5 text-sm font-bold">
                                            <span className="text-slate-300">TOTAL:</span>
                                            <span className="text-emerald-400 text-base">
                                                ${Number(selectedInvoice.total_amount).toLocaleString("es-AR", { 
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2
                                                })}
                                            </span>
                                        </p>
                                    </div>
                                </div>

                                {/* Actions footer */}
                                <div className="p-4 border-t border-slate-850 bg-slate-900/30 flex flex-col gap-2">
                                    <Button 
                                        variant="outline" 
                                        className="w-full flex items-center justify-center gap-2 border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" 
                                        onClick={() => onPrint('thermal', selectedInvoice)}
                                        disabled={loadingItems}
                                    >
                                        <Printer className="h-4 w-4 text-slate-400" />
                                        Reimprimir Ticket Térmico (80mm)
                                    </Button>
                                    
                                    {selectedInvoice.invoice_type !== "TK" && (
                                        <Button 
                                            variant="outline" 
                                            className="w-full flex items-center justify-center gap-2 border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" 
                                            onClick={() => onPrint('a4', selectedInvoice)}
                                            disabled={loadingItems}
                                        >
                                            <Printer className="h-4 w-4 text-slate-400" />
                                            Reimprimir Factura A4 (Detallada)
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-6 text-center gap-2">
                                <Receipt className="h-10 w-10 text-slate-800" />
                                <span className="font-semibold text-slate-400">Ninguna venta seleccionada</span>
                                <span className="text-xs">Elige una venta de la lista de la izquierda para ver su detalle e imprimir.</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex justify-end border-t border-slate-800 pt-4 mt-4">
                    <Button type="button" onClick={() => onOpenChange(false)} className="bg-blue-600 text-white hover:bg-blue-500 px-6 font-semibold">
                        Cerrar Historial
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
