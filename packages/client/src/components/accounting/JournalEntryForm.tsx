import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle, AlertTriangle, Trash, Plus } from "lucide-react"
import type { ChartAccount } from "@/types/accounting"

interface JournalEntryFormProps {
    date: string
    onDateChange: (val: string) => void
    description: string
    onDescriptionChange: (val: string) => void
    lines: Array<{ account_code: string; debit: number; credit: number; notes: string }>
    chartAccounts: ChartAccount[]
    onUpdateLine: (idx: number, key: "account_code" | "debit" | "credit" | "notes", val: string | number) => void
    onAddLine: () => void
    onRemoveLine: (idx: number) => void
    totalDebit: number
    totalCredit: number
    isBalanced: boolean
    isSubmitting: boolean
    onSubmit: () => void
    submitLabel: string
    showCancel?: boolean
    onCancel?: () => void
}

export function JournalEntryForm({
    date,
    onDateChange,
    description,
    onDescriptionChange,
    lines,
    chartAccounts,
    onUpdateLine,
    onAddLine,
    onRemoveLine,
    totalDebit,
    totalCredit,
    isBalanced,
    isSubmitting,
    onSubmit,
    submitLabel,
    showCancel = false,
    onCancel,
}: JournalEntryFormProps) {
    return (
        <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-slate-500 uppercase">Fecha del Asiento</label>
                    <Input type="date" value={date} onChange={(e) => onDateChange(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Concepto / Glosa General</label>
                    <Input
                        placeholder="Ej: Ajuste de fin de mes, devengamiento de tasas..."
                        value={description}
                        onChange={(e) => onDescriptionChange(e.target.value)}
                    />
                </div>
            </div>

            <div className="space-y-3">
                <label className="text-xs font-bold text-slate-500 uppercase block">Partidas del Asiento</label>

                {lines.map((line, idx) => (
                    <div
                        key={idx}
                        className="flex flex-col gap-2 p-3 border rounded-lg sm:flex-row sm:items-center sm:gap-3 bg-slate-50/50"
                    >
                        <div className="w-full sm:w-1/3">
                            <Select
                                value={line.account_code}
                                onValueChange={(val) => onUpdateLine(idx, "account_code", val)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar Cuenta" />
                                </SelectTrigger>
                                <SelectContent>
                                    {chartAccounts.map((acc) => (
                                        <SelectItem key={acc.code} value={acc.code}>
                                            <span className="font-mono text-xs mr-2 text-slate-400">{acc.code}</span>
                                            {acc.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="w-full sm:w-40 flex items-center gap-1.5 bg-white dark:bg-slate-900 border rounded px-2 h-9">
                            <span className="text-slate-400 text-xs font-bold">$</span>
                            <input
                                type="number"
                                placeholder="Debe"
                                value={line.debit || ""}
                                onChange={(e) => onUpdateLine(idx, "debit", e.target.value)}
                                className="w-full text-right outline-none text-xs font-bold text-green-600 bg-transparent"
                            />
                        </div>

                        <div className="w-full sm:w-40 flex items-center gap-1.5 bg-white dark:bg-slate-900 border rounded px-2 h-9">
                            <span className="text-slate-400 text-xs font-bold">$</span>
                            <input
                                type="number"
                                placeholder="Haber"
                                value={line.credit || ""}
                                onChange={(e) => onUpdateLine(idx, "credit", e.target.value)}
                                className="w-full text-right outline-none text-xs font-bold text-red-500 bg-transparent"
                            />
                        </div>

                        <div className="w-full sm:flex-1">
                            <Input
                                placeholder="Detalle línea..."
                                value={line.notes}
                                onChange={(e) => onUpdateLine(idx, "notes", e.target.value)}
                                className="h-9 text-xs"
                            />
                        </div>

                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => onRemoveLine(idx)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50/50 shrink-0 self-end sm:self-center"
                        >
                            <Trash className="h-4 w-4" />
                        </Button>
                    </div>
                ))}

                <Button type="button" variant="outline" size="sm" onClick={onAddLine} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" /> Agregar Partida
                </Button>
            </div>

            <div
                className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg gap-3 ${
                    isBalanced
                        ? "bg-green-50 border-green-200 text-green-800"
                        : "bg-amber-50 border-amber-200 text-amber-800"
                }`}
            >
                <div className="flex items-center gap-2 text-sm font-semibold">
                    {isBalanced ? (
                        <>
                            <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                            <span>Asiento Balanceado Correctamente</span>
                        </>
                    ) : (
                        <>
                            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                            <span>Asiento Fuera de Balance (La suma del Debe y Haber debe ser igual y mayor a 0)</span>
                        </>
                    )}
                </div>
                <div className="flex items-center gap-5 text-sm font-mono font-bold">
                    <div>
                        Total Debe: <span className="text-green-600">${totalDebit.toFixed(2)}</span>
                    </div>
                    <div>
                        Total Haber: <span className="text-red-500">${totalCredit.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
                {showCancel && onCancel && (
                    <Button variant="outline" type="button" onClick={onCancel}>
                        Cancelar
                    </Button>
                )}
                <Button onClick={onSubmit} disabled={!isBalanced || isSubmitting} className="w-full sm:w-auto">
                    {isSubmitting ? "Guardando..." : submitLabel}
                </Button>
            </div>
        </div>
    )
}
