import { Printer, Landmark, Calendar, User, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CashShiftSummary } from "@/types/api";
import { formatMoney } from "@/lib/formatters";

interface ZReportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    registerName: string;
    shiftSummary: CashShiftSummary | null;
    actualBalance: number;
    notes?: string | null | undefined;
    cashierName?: string;
    closedAt?: string;
}

export function ZReportDialog({
    open,
    onOpenChange,
    registerName,
    shiftSummary,
    actualBalance,
    notes,
    cashierName,
    closedAt,
}: ZReportDialogProps) {
    if (!shiftSummary) return null;

    const openingBalance = Number(shiftSummary.opening_balance || 0);
    const expectedBalance = Number(shiftSummary.expected_balance || 0);
    const difference = actualBalance - expectedBalance;
    const dateStr = closedAt ? new Date(closedAt).toLocaleString("es-AR") : new Date().toLocaleString("es-AR");

    const handlePrint = () => {
        window.print();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-xl p-6">
                <DialogHeader className="border-b border-border pb-4">
                    <div className="flex items-center gap-2 text-primary font-bold text-lg">
                        <Landmark className="h-5 w-5" />
                        <span>REPORTE COMPROBANTE CIERRE Z DE CAJA</span>
                    </div>
                    <DialogTitle className="text-xl font-black mt-1">Cierre Z - {registerName}</DialogTitle>
                    <DialogDescription>
                        Informe consolidado de ventas, medios de pago y arqueo físico del turno.
                    </DialogDescription>
                </DialogHeader>

                {/* Printable Document Container */}
                <div id="printable-ticket" className="space-y-4 py-4 text-foreground font-sans text-sm">
                    {/* Header Info */}
                    <div className="grid grid-cols-2 gap-3 p-3 bg-muted/40 rounded-lg border border-border text-xs">
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span><strong>Fecha/Hora:</strong> {dateStr}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            <span><strong>Cajero:</strong> {cashierName || "Sistema / Operador"}</span>
                        </div>
                        <div className="flex items-center gap-2 col-span-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span><strong>Caja:</strong> {registerName}</span>
                        </div>
                    </div>

                    {/* Sales Summary Breakdown */}
                    <div className="space-y-2 border border-border rounded-lg p-4 bg-card">
                        <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5">
                            Movimientos del Turno
                        </h4>
                        <div className="space-y-1.5 pt-1 text-xs">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Fondo de Caja Inicial:</span>
                                <span className="font-mono font-bold">{formatMoney(openingBalance)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Ingresos Efectivo en Turno:</span>
                                <span className="font-mono font-bold text-green-600 dark:text-green-400">
                                    +{formatMoney(shiftSummary.inflow || 0)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Retiros / Egresos Directos:</span>
                                <span className="font-mono font-bold text-red-600 dark:text-red-400">
                                    -{formatMoney(shiftSummary.outflow || 0)}
                                </span>
                            </div>
                            <div className="border-t border-dashed border-border pt-1.5 flex justify-between font-bold">
                                <span>Saldo Sistema Esperado:</span>
                                <span className="font-mono text-sm">{formatMoney(expectedBalance)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Audit Arqueo Breakdown */}
                    <div className="space-y-2 border border-border rounded-lg p-4 bg-card">
                        <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5">
                            Arqueo de Efectivo Físico
                        </h4>
                        <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                            <div className="p-2.5 rounded bg-muted/30 border border-border text-center">
                                <span className="text-muted-foreground block text-[11px]">Efectivo Declarado</span>
                                <span className="font-mono font-black text-base text-foreground">{formatMoney(actualBalance)}</span>
                            </div>
                            <div className="p-2.5 rounded bg-muted/30 border border-border text-center">
                                <span className="text-muted-foreground block text-[11px]">Diferencia de Caja</span>
                                <span className={`font-mono font-black text-base ${difference === 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {formatMoney(difference)}
                                </span>
                            </div>
                        </div>
                        {notes && (
                            <p className="text-xs italic text-muted-foreground pt-1">
                                <strong>Observaciones:</strong> {notes}
                            </p>
                        )}
                    </div>
                </div>

                <DialogFooter className="flex-col-reverse sm:flex-row gap-2 pt-2 border-t border-border">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cerrar
                    </Button>
                    <Button onClick={handlePrint} className="gap-2 bg-blue-600 hover:bg-blue-700">
                        <Printer className="h-4 w-4" /> Imprimir Cierre Z
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
