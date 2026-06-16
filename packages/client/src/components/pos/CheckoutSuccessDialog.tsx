import { useState, useEffect } from "react";
import type { CheckoutSuccessDialogProps } from "@/components/pos/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/services/api";
import { toast } from "sonner";
import { Loader2, Printer, ShieldCheck, AlertTriangle } from "lucide-react";
import type { Invoice } from "@/types/api";

export function CheckoutSuccessDialog({
    open,
    onOpenChange,
    lastOrderId,
    lastInvoice,
    grandTotal,
    onPrint,
}: CheckoutSuccessDialogProps) {
    const [invoiceState, setInvoiceState] = useState<Invoice | null>(null);
    const [authorizing, setAuthorizing] = useState(false);

    useEffect(() => {
        if (open) {
            setInvoiceState(lastInvoice);
        }
    }, [lastInvoice, open]);

    const handleAuthorize = async () => {
        if (!invoiceState) return;
        setAuthorizing(true);
        try {
            const updated = await api.authorizeInvoice(invoiceState.id);
            setInvoiceState(updated);
            toast.success("Factura autorizada exitosamente con CAE");
        } catch {
            toast.error("Error al autorizar factura con AFIP");
        } finally {
            setAuthorizing(false);
        }
    };

    const isTicket = invoiceState?.invoice_type === "TK";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-md bg-slate-900 border-slate-800 text-slate-100">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-white">
                        <ShieldCheck className="h-6 w-6 text-emerald-500" />
                        Venta Registrada con Éxito
                    </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950 p-4 text-sm font-mono">
                        <p className="flex justify-between border-b border-slate-800 pb-1">
                            <span className="text-slate-400">Orden:</span> 
                            <span className="font-bold text-slate-100">{lastOrderId || "-"}</span>
                        </p>
                        <p className="flex justify-between border-b border-slate-800 pb-1">
                            <span className="text-slate-400">Comprobante:</span> 
                            <span className="font-bold text-slate-100">
                                {invoiceState ? `${invoiceState.invoice_type}-${String(invoiceState.point_of_sale).padStart(4, "0")}-${String(invoiceState.invoice_number).padStart(8, "0")}` : "No emitida"}
                            </span>
                        </p>
                        <p className="flex justify-between border-b border-slate-800 pb-1">
                            <span className="text-slate-400">Total:</span> 
                            <span className="font-bold text-emerald-500">${grandTotal.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</span>
                        </p>
                        {invoiceState?.cae ? (
                            <p className="flex justify-between border-b border-slate-800 pb-1 text-emerald-400">
                                <span>CAE AFIP:</span> 
                                <span className="font-bold">{invoiceState.cae}</span>
                            </p>
                        ) : invoiceState && !isTicket ? (
                            <div className="rounded border border-amber-500/20 bg-amber-500/10 p-3 mt-2 text-xs flex flex-col gap-2">
                                <p className="flex items-start gap-1 text-amber-500 font-sans">
                                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                                    <span>Esta factura A/B requiere CAE para validez legal fiscal.</span>
                                </p>
                                <Button 
                                    size="sm" 
                                    className="bg-amber-600 hover:bg-amber-700 text-white font-sans w-full"
                                    onClick={handleAuthorize} 
                                    disabled={authorizing}
                                >
                                    {authorizing ? (
                                        <><Loader2 className="mr-2 h-3 w-3 animate-spin" /> Autorizando con AFIP...</>
                                    ) : (
                                        "Autorizar con ARCA/AFIP ahora"
                                    )}
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    {invoiceState && (
                        <div className="flex flex-col gap-2 pt-2">
                            <Button 
                                variant="outline" 
                                className="w-full flex items-center justify-center gap-2 border-slate-800 bg-slate-950 text-slate-200 hover:bg-slate-850 hover:text-white" 
                                onClick={() => onPrint?.('thermal', invoiceState)}
                            >
                                <Printer className="h-4 w-4 text-slate-400" />
                                Imprimir Ticket Térmico (80mm)
                            </Button>
                            
                            {!isTicket && (
                                <Button 
                                    variant="outline" 
                                    className="w-full flex items-center justify-center gap-2 border-slate-800 bg-slate-950 text-slate-200 hover:bg-slate-850 hover:text-white" 
                                    onClick={() => onPrint?.('a4', invoiceState)}
                                >
                                    <Printer className="h-4 w-4 text-slate-400" />
                                    Imprimir Factura A4 (Detallada)
                                </Button>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex justify-end border-t border-slate-800 pt-3 mt-4">
                    <Button type="button" onClick={() => onOpenChange(false)} className="bg-blue-600 text-white hover:bg-blue-500">
                        Nueva Venta
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
