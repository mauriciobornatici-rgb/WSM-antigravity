import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Edit, RotateCcw, Trash2 } from "lucide-react"
import type { JournalEntry } from "@/types/accounting"

interface JournalEntriesTabProps {
    journalEntries: JournalEntry[]
    onEditEntry: (entry: JournalEntry) => void
    onReverseEntry: (id: string) => void
    onDeleteEntry: (id: string) => void
}

export function JournalEntriesTab({
    journalEntries,
    onEditEntry,
    onReverseEntry,
    onDeleteEntry,
}: JournalEntriesTabProps) {
    return (
        <Card className="border border-slate-100 shadow-sm">
            <CardHeader>
                <CardTitle>Libro Diario General (Partida Doble)</CardTitle>
                <CardDescription>Asientos contables ordenados de manera cronológica inversa.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-6">
                    {journalEntries.length === 0 ? (
                        <p className="text-center text-slate-400 py-8 text-sm">
                            No hay asientos contables registrados en este rango de fechas.
                        </p>
                    ) : (
                        journalEntries.map((entry) => (
                            <div
                                key={entry.id}
                                className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-50/30 dark:bg-slate-900/10 shadow-sm"
                            >
                                <div className="bg-slate-100/70 dark:bg-slate-900/60 px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center gap-3">
                                        <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                            Asiento #{entry.entry_number}
                                        </span>
                                        <span className="text-xs text-slate-500 font-semibold">
                                            {new Date(entry.date).toLocaleString("es-AR")}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-xs text-slate-400 italic">
                                            Ref: {entry.reference_type || "Manual"} ({entry.reference_id?.substring(0, 8) || "N/A"})
                                        </div>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                    <MoreHorizontal className="h-4 w-4" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                                <DropdownMenuItem onClick={() => onEditEntry(entry)}>
                                                    <Edit className="mr-2 h-4 w-4" /> Editar Asiento
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => onReverseEntry(entry.id)}>
                                                    <RotateCcw className="mr-2 h-4 w-4" /> Anular (Revertir)
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    className="text-red-600 focus:text-red-600"
                                                    onClick={() => onDeleteEntry(entry.id)}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" /> Eliminar Definitivo
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                                <div className="px-4 py-2 bg-white dark:bg-slate-950 font-medium text-sm border-b border-slate-100 dark:border-slate-900 text-slate-800 dark:text-slate-200">
                                    {entry.description}
                                </div>
                                <Table>
                                    <TableHeader className="bg-slate-50/50 dark:bg-slate-900/30">
                                        <TableRow>
                                            <TableHead className="w-1/4">Cuenta</TableHead>
                                            <TableHead className="w-1/2">Detalle / Notas</TableHead>
                                            <TableHead className="text-right w-32">Debe</TableHead>
                                            <TableHead className="text-right w-32">Haber</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {entry.lines.map((line) => (
                                            <TableRow key={line.id}>
                                                <TableCell className="font-semibold text-slate-800 dark:text-slate-200">
                                                    <span className="text-xs text-slate-400 mr-2">{line.account_code}</span>
                                                    {line.account_name}
                                                </TableCell>
                                                <TableCell className="text-slate-500 text-xs italic">
                                                    {line.notes || "-"}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-green-600">
                                                    {line.debit > 0 ? `$${line.debit.toFixed(2)}` : ""}
                                                </TableCell>
                                                <TableCell className="text-right font-bold text-red-500">
                                                    {line.credit > 0 ? `$${line.credit.toFixed(2)}` : ""}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
