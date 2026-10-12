import { useCallback, useEffect, useState } from "react";
import { api } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Landmark, Lock, Unlock, History, DollarSign, AlertTriangle, CheckCircle2, Calculator, Banknote } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { showErrorToast } from "@/lib/errorHandling";
import { formatMoney } from "@/lib/formatters";
import type { CashRegister, CashShiftSummary, ShiftCloseInput, ShiftOpenInput } from "@/types/api";
import { ZReportDialog } from "@/components/cash/ZReportDialog";

const BILL_DENOMINATIONS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100];

export default function CashManagementPage() {
    const [registers, setRegisters] = useState<CashRegister[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRegister, setSelectedRegister] = useState<CashRegister | null>(null);
    const [openShiftData, setOpenShiftData] = useState<ShiftOpenInput>({ opening_balance: 0 });
    const [closeShiftData, setCloseShiftData] = useState<ShiftCloseInput>({ actual_balance: 0, notes: "" });
    const [isOpening, setIsOpening] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [shiftSummary, setShiftSummary] = useState<CashShiftSummary | null>(null);
    const [showZReport, setShowZReport] = useState(false);
    const [zReportDate, setZReportDate] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Denomination breakdown state
    const [showCalculator, setShowCalculator] = useState(false);
    const [billCounts, setBillCounts] = useState<Record<number, number>>({
        20000: 0,
        10000: 0,
        5000: 0,
        2000: 0,
        1000: 0,
        500: 0,
        200: 0,
        100: 0,
    });

    const loadRegisters = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getCashRegisters();
            setRegisters(data);
        } catch (error) {
            showErrorToast("Error cargando cajas", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void loadRegisters(); }, [loadRegisters]);

    const handlePrepareClose = async (reg: CashRegister) => {
        setSelectedRegister(reg);
        setIsClosing(true);
        setShowCalculator(false);
        setBillCounts({
            20000: 0,
            10000: 0,
            5000: 0,
            2000: 0,
            1000: 0,
            500: 0,
            200: 0,
            100: 0,
        });
        try {
            const summary = await api.getOpenShift(reg.id);
            setShiftSummary(summary);
            // Default actual balance to expected to save time, user can correct it
            setCloseShiftData((prev) => ({ ...prev, actual_balance: summary?.expected_balance || 0, notes: "" }));
        } catch (error) {
            showErrorToast("No se pudo cargar el resumen del turno", error);
        }
    };

    const handleOpenShift = async () => {
        if (!selectedRegister || submitting) return;
        setSubmitting(true);
        try {
            await api.openShift(selectedRegister.id, openShiftData);
            toast.success("Caja abierta exitosamente");
            setIsOpening(false);
            void loadRegisters();
        } catch (error) {
            showErrorToast("Error al abrir caja", error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCloseShift = async () => {
        if (!selectedRegister?.current_shift_id || submitting) return;
        setSubmitting(true);
        try {
            const res = await api.closeShift(selectedRegister.current_shift_id, closeShiftData);
            if (res.difference === 0) {
                toast.success("Caja cerrada correctamente. ¡Arqueo perfecto!");
            } else if (res.difference > 0) {
                toast.warning(`Caja cerrada con sobrante de ${formatMoney(res.difference)}`);
            } else {
                toast.error(`Caja cerrada con faltante de ${formatMoney(Math.abs(res.difference))}`);
            }
            setIsClosing(false);
            setZReportDate(new Date().toISOString());
            setShowZReport(true);
            void loadRegisters();
        } catch (error) {
            showErrorToast("Error al cerrar caja", error);
        } finally {
            setSubmitting(false);
        }
    };

    const handleBillCountChange = (denom: number, count: number) => {
        const validCount = Math.max(0, Math.trunc(count || 0));
        const updated = { ...billCounts, [denom]: validCount };
        setBillCounts(updated);

        const total = Object.entries(updated).reduce((sum, [d, c]) => sum + Number(d) * Number(c), 0);
        setCloseShiftData((prev) => ({ ...prev, actual_balance: total }));
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestión de Cajas</h1>
                    <p className="text-muted-foreground">Apertura, cierre y arqueo de turnos de caja.</p>
                </div>
                <Button className="w-full sm:w-auto" variant="outline" onClick={loadRegisters} disabled={loading}>
                    <History className="mr-2 h-4 w-4" /> Historial de Turnos
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {registers.map((reg) => (
                    <Card key={reg.id} className={`${reg.status === "open" ? "border-emerald-500/50 bg-emerald-500/5" : "border-border"}`}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-lg font-bold">{reg.name}</CardTitle>
                            <Landmark className={`h-5 w-5 ${reg.status === "open" ? "text-emerald-500" : "text-muted-foreground"}`} />
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Estado</span>
                                    <Badge variant={reg.status === "open" ? "default" : "secondary"} className={reg.status === "open" ? "bg-emerald-600" : ""}>
                                        {reg.status === "open" ? "ABIERTA" : "CERRADA"}
                                    </Badge>
                                </div>

                                {reg.status === "open" ? (
                                    <div className="space-y-2 py-2 border-y border-dashed border-border">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">Abierta desde:</span>
                                            <span className="font-mono">{reg.opened_at ? new Date(reg.opened_at).toLocaleString("es-AR") : "-"}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">Monto Inicial:</span>
                                            <span className="font-bold font-mono text-emerald-600 dark:text-emerald-400">{formatMoney(reg.opening_balance)}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-14 flex items-center justify-center text-sm text-muted-foreground italic">
                                        Sin turno activo
                                    </div>
                                )}

                                <div className="pt-2">
                                    {reg.status === "open" ? (
                                        <Button className="w-full bg-rose-600 hover:bg-rose-700 text-white font-medium shadow-sm" onClick={() => void handlePrepareClose(reg)}>
                                            <Lock className="mr-2 h-4 w-4" /> Cerrar Caja / Arqueo
                                        </Button>
                                    ) : (
                                        <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-sm" onClick={() => { setSelectedRegister(reg); setIsOpening(true); }}>
                                            <Unlock className="mr-2 h-4 w-4" /> Abrir Caja
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Open Shift Dialog */}
            <Dialog open={isOpening} onOpenChange={setIsOpening}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-md bg-card text-card-foreground border-border">
                    <DialogHeader>
                        <DialogTitle>Abrir Turno de Caja</DialogTitle>
                        <DialogDescription>Ingrese el monto inicial de efectivo disponible en la caja.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="opening_balance">Monto Inicial (Base de Caja)</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    id="opening_balance"
                                    type="number"
                                    min="0"
                                    className="pl-9 h-12 text-xl font-bold font-mono bg-background border-input text-foreground"
                                    value={openShiftData.opening_balance}
                                    onChange={(e) => setOpenShiftData({ ...openShiftData, opening_balance: Number(e.target.value) })}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setIsOpening(false)} className="border-border">Cancelar</Button>
                        <Button disabled={submitting} className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => void handleOpenShift()}>
                            {submitting ? "Abriendo..." : "Confirmar Apertura"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Close Shift Dialog */}
            <Dialog open={isClosing} onOpenChange={setIsClosing}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-lg bg-card text-card-foreground border-border">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Lock className="h-5 w-5 text-rose-500" /> Cierre de Caja y Arqueo
                        </DialogTitle>
                        <DialogDescription>Contabilice el efectivo físico en caja y compárelo con el sistema.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-5 py-3">
                        <div className="bg-muted/40 p-3.5 rounded-lg border border-border space-y-2.5">
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center">Resumen de Ventas del Turno</h4>
                            <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-2">
                                <div className="p-2.5 bg-card rounded-md border border-border">
                                    <p className="text-[11px] text-muted-foreground mb-0.5">Efectivo Sistema</p>
                                    <p className="text-lg font-black font-mono text-foreground">{formatMoney(shiftSummary?.expected_balance)}</p>
                                </div>
                                <div className="p-2.5 bg-card rounded-md border border-border">
                                    <p className="text-[11px] text-muted-foreground mb-0.5">Diferencia</p>
                                    <p className={`text-lg font-black font-mono ${(closeShiftData.actual_balance - (shiftSummary?.expected_balance || 0)) === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                                        {formatMoney(closeShiftData.actual_balance - (shiftSummary?.expected_balance || 0))}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Arqueo por Billetes Toggle */}
                        <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold flex items-center gap-1.5 text-foreground">
                                    <Banknote className="h-4 w-4 text-emerald-600" /> Desglose por Billetes (Opcional)
                                </span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowCalculator((v) => !v)}
                                    className="h-7 text-xs gap-1 text-primary"
                                >
                                    <Calculator className="h-3.5 w-3.5" />
                                    {showCalculator ? "Ocultar contador" : "Abrir contador"}
                                </Button>
                            </div>

                            {showCalculator && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t">
                                    {BILL_DENOMINATIONS.map((denom) => (
                                        <div key={denom} className="space-y-1">
                                            <span className="text-[10px] font-mono font-semibold text-muted-foreground">
                                                ${denom.toLocaleString("es-AR")}
                                            </span>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="1"
                                                placeholder="0"
                                                value={billCounts[denom] || ""}
                                                onChange={(e) => handleBillCountChange(denom, Number(e.target.value))}
                                                className="h-8 font-mono text-center text-xs font-bold"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="actual_balance" className="text-sm font-bold">Efectivo Físico en Caja</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                <Input
                                    id="actual_balance"
                                    type="number"
                                    min="0"
                                    className="pl-10 h-12 text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 bg-background border-input"
                                    value={closeShiftData.actual_balance}
                                    onChange={(e) => setCloseShiftData({ ...closeShiftData, actual_balance: Number(e.target.value) })}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                                Asegúrese de contar bien el dinero antes de confirmar el cierre.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="notes" className="text-xs font-semibold">Observaciones / Notas del Cierre</Label>
                            <Input
                                id="notes"
                                placeholder="Ej: Faltante de $10 por error en vuelto..."
                                value={closeShiftData.notes}
                                onChange={(e) => setCloseShiftData({ ...closeShiftData, notes: e.target.value })}
                                className="h-9 text-xs"
                            />
                        </div>
                    </div>
                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t pt-3">
                        <Button variant="outline" onClick={() => setIsClosing(false)} className="border-border">Cancelar</Button>
                        <Button disabled={submitting} className="bg-rose-600 hover:bg-rose-700 font-bold h-10 px-6 text-white shadow-md" onClick={() => void handleCloseShift()}>
                            <CheckCircle2 className="mr-2 h-4 w-4" /> {submitting ? "Cerrando..." : "Confirmar Cierre de Caja"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Z Report Printable Dialog */}
            <ZReportDialog
                open={showZReport}
                onOpenChange={setShowZReport}
                registerName={selectedRegister?.name || "Caja Principal"}
                shiftSummary={shiftSummary}
                actualBalance={closeShiftData.actual_balance}
                notes={closeShiftData.notes}
                closedAt={zReportDate}
            />
        </div>
    );
}
