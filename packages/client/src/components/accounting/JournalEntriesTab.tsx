import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Edit, RotateCcw, Trash2 } from "lucide-react"
import { formatMoney } from "@/lib/formatters"
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
        <Card className="border-border shadow-sm">
            <CardHeader>
                <CardTitle>Libro Diario General (Partida Doble)</CardTitle>
                <CardDescription>Asientos contables ordenados de manera cronológica inversa.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-6">
                    {journalEntries.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8 text-sm">
                            No hay asientos contables registrados en este rango de fechas.
                        </p>
                    ) : (
                        journalEntries.map((entry) => (
                            <div
                                key={entry.id}
                                className="border border-border rounded-lg overflow-hidden bg-card shadow-sm"
                            >
                                <div className="bg-muted/40 px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-border">
                                    <div className="flex items-center gap-3">
                                        <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                                            Asiento #{entry.entry_number}
                                        </span>
                                        <span className="text-xs text-muted-foreground font-semibold">
                                            {new Date(entry.date).toLocaleString("es-AR")}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-xs text-muted-foreground italic">
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
                                                    className="text-destructive focus:text-destructive"
                                                    onClick={() => onDeleteEntry(entry.id)}
                                                >
                                                    <Trash2 className="mr-2 h-4 w-4" /> Eliminar Definitivo
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                                <div className="px-4 py-2 bg-card font-medium text-sm border-b border-border text-foreground">
                                    {entry.description}
                                </div>
                                <div className="overflow-x-auto">
                                    <Table className="min-w-[650px]">
                                        <TableHeader className="bg-muted/20">
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
                                                    <TableCell className="font-semibold text-foreground">
                                                        <span className="text-xs text-muted-foreground mr-2 font-mono">{line.account_code}</span>
                                                        {line.account_name}
                                                    </TableCell>
                                                    <TableCell className="text-muted-foreground text-xs italic">
                                                        {line.notes || "-"}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                        {line.debit > 0 ? formatMoney(line.debit) : ""}
                                                    </TableCell>
                                                    <TableCell className="text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                                                        {line.credit > 0 ? formatMoney(line.credit) : ""}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
