import { useState, useEffect } from "react"
import { api } from "@/services/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Landmark, Lock, Unlock, History, DollarSign, AlertTriangle, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { showErrorToast } from "@/lib/errorHandling"
import type { CashRegister, CashShiftSummary, ShiftCloseInput, ShiftOpenInput } from "@/types/api"

export default function CashManagementPage() {
    const [registers, setRegisters] = useState<CashRegister[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedRegister, setSelectedRegister] = useState<CashRegister | null>(null)
    const [openShiftData, setOpenShiftData] = useState<ShiftOpenInput>({ opening_balance: 0 })
    const [closeShiftData, setCloseShiftData] = useState<ShiftCloseInput>({ actual_balance: 0, notes: "" })
    const [isOpening, setIsOpening] = useState(false)
    const [isClosing, setIsClosing] = useState(false)
    const [shiftSummary, setShiftSummary] = useState<CashShiftSummary | null>(null)

    useEffect(() => { loadRegisters() }, [])

    const loadRegisters = async () => {
        setLoading(true)
        try {
            const data = await api.getCashRegisters()
            setRegisters(data)
        } catch (error) {
            showErrorToast("Error cargando cajas", error)
        } finally {
            setLoading(false)
        }
    }

    const handlePrepareClose = async (reg: CashRegister) => {
        setSelectedRegister(reg)
        setIsClosing(true)
        try {
            const summary = await api.getOpenShift(reg.id)
            setShiftSummary(summary)
            // Default actual balance to expected to save time, user can correct it
            setCloseShiftData(prev => ({ ...prev, actual_balance: summary?.expected_balance || 0 }))
        } catch (error) {
            showErrorToast("No se pudo cargar el resumen del turno", error)
        }
    }

    const handleOpenShift = async () => {
        if (!selectedRegister) return
        try {
            await api.openShift(selectedRegister.id, openShiftData)
            toast.success("Caja abierta exitosamente")
            setIsOpening(false)
            loadRegisters()
        } catch (error) {
            showErrorToast("Error al abrir caja", error)
        }
    }

    const handleCloseShift = async () => {
        if (!selectedRegister?.current_shift_id) return
        try {
            const res = await api.closeShift(selectedRegister.current_shift_id, closeShiftData)
            if (res.difference === 0) {
                toast.success("Caja cerrada correctamente. ¡Arqueo perfecto!")
            } else if (res.difference > 0) {
                toast.warning(`Caja cerrada con sobrante de $${res.difference}`)
            } else {
                toast.error(`Caja cerrada con faltante de $${Math.abs(res.difference)}`)
            }
            setIsClosing(false)
            loadRegisters()
        } catch (error) {
            showErrorToast("Error al cerrar caja", error)
        }
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestión de Cajas</h1>
                    <p className="text-muted-foreground">Apertura, cierre y arqueo de turnos de caja.</p>
                </div>
                <Button variant="outline" onClick={loadRegisters} disabled={loading}><History className="mr-2 h-4 w-4" /> Historial de Turnos</Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {registers.map(reg => (
                    <Card key={reg.id} className={`${reg.status === 'open' ? 'border-green-500/50 bg-green-500/5' : 'border-slate-800'}`}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                            <CardTitle className="text-lg font-bold">{reg.name}</CardTitle>
                            <Landmark className={`h-5 w-5 ${reg.status === 'open' ? 'text-green-500' : 'text-slate-500'}`} />
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-sm text-muted-foreground">Estado</span>
                                    <Badge variant={reg.status === 'open' ? 'default' : 'secondary'} className={reg.status === 'open' ? 'bg-green-600' : ''}>
                                        {reg.status === 'open' ? 'ABIERTA' : 'CERRADA'}
                                    </Badge>
                                </div>

                                {reg.status === 'open' ? (
                                    <div className="space-y-2 py-2 border-y border-dashed border-slate-700">
                                        <div className="flex justify-between text-xs">
                                            <span>Abierta desde:</span>
                                            <span className="font-mono">{reg.opened_at ? new Date(reg.opened_at).toLocaleString() : "-"}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span>Monto Inicial:</span>
                                            <span className="font-bold text-green-500">${Number(reg.opening_balance).toLocaleString()}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-14 flex items-center justify-center text-sm text-slate-500 italic">
                                        Sin turno activo
                                    </div>
                                )}

                                <div className="pt-2">
                                    {reg.status === 'open' ? (
                                        <Button className="w-full bg-red-600 hover:bg-red-700" onClick={() => handlePrepareClose(reg)}>
                                            <Lock className="mr-2 h-4 w-4" /> Cerrar Caja / Arqueo
                                        </Button>
                                    ) : (
                                        <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={() => { setSelectedRegister(reg); setIsOpening(true); }}>
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
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-md">
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
                                    className="pl-9 h-12 text-xl font-bold"
                                    value={openShiftData.opening_balance}
                                    onChange={e => setOpenShiftData({ ...openShiftData, opening_balance: Number(e.target.value) })}
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setIsOpening(false)}>Cancelar</Button>
                        <Button className="bg-blue-600" onClick={handleOpenShift}>Confirmar Apertura</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Close Shift Dialog */}
            <Dialog open={isClosing} onOpenChange={setIsClosing}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Cierre de Caja y Arqueo</DialogTitle>
                        <DialogDescription>Contabilice el efectivo físico en caja y compárelo con el sistema.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-6 py-4">
                        <div className="bg-slate-900 p-4 rounded-lg border border-slate-800 space-y-3">
                            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider text-center">Resumen de Ventas del Turno</h4>
                            <div className="grid grid-cols-2 gap-4 text-center">
                                <div className="p-3 bg-slate-800/50 rounded-md border border-slate-700">
                                    <p className="text-xs text-slate-500 mb-1">Efectivo Sistema</p>
                                    <p className="text-xl font-black text-white">${Number(shiftSummary?.expected_balance || 0).toLocaleString()}</p>
                                </div>
                                <div className="p-3 bg-slate-800/50 rounded-md border border-slate-700">
                                    <p className="text-xs text-slate-500 mb-1">Diferencia</p>
                                    <p className={`text-xl font-black ${(closeShiftData.actual_balance - (shiftSummary?.expected_balance || 0)) === 0 ? 'text-green-500' : 'text-red-500'}`}>
                                        ${(closeShiftData.actual_balance - (shiftSummary?.expected_balance || 0)).toLocaleString()}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="actual_balance" className="text-lg font-bold">Efectivo Físico en Caja</Label>
                            <div className="relative">
                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-green-500" />
                                <Input
                                    id="actual_balance"
                                    type="number"
                                    className="pl-10 h-14 text-2xl font-black text-green-400 bg-slate-900 border-slate-700"
                                    value={closeShiftData.actual_balance}
                                    onChange={e => setCloseShiftData({ ...closeShiftData, actual_balance: Number(e.target.value) })}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 text-amber-500" />
                                Asegúrese de contar bien el dinero antes de confirmar.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="notes">Observaciones / Notas del Cierre</Label>
                            <Input
                                id="notes"
                                placeholder="Ej: Faltante de $10 por error en vuelto..."
                                value={closeShiftData.notes}
                                onChange={e => setCloseShiftData({ ...closeShiftData, notes: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setIsClosing(false)} className="border-slate-700">Cancelar</Button>
                        <Button className="bg-red-600 hover:bg-red-700 font-bold h-12 px-8" onClick={handleCloseShift}>
                            <CheckCircle2 className="mr-2 h-5 w-5" /> Confirmar Cierre de Caja
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

