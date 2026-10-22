import { BadgeAlert, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/formatters";

export interface PendingDoc {
    id: string;
    number: string;
    date: string;
    dueDate: string;
    total: number;
    paid: number;
    // ADR-029: supplier credit notes against the document (they lower what is owed too).
    credited?: number;
    pending: number;
    status: string;
    isOverdue?: boolean;
}

interface CurrentAccountsPendingDocsTableProps {
    pendingDocuments: PendingDoc[];
}

export function CurrentAccountsPendingDocsTable({ pendingDocuments }: CurrentAccountsPendingDocsTableProps) {
    return (
        <div className="rounded-md border border-border overflow-x-auto">
            <Table className="min-w-[760px]">
                <TableHeader className="bg-muted/40">
                    <TableRow>
                        <TableHead className="w-32">Comprobante</TableHead>
                        <TableHead className="w-28">Emisión</TableHead>
                        <TableHead className="w-28">Vencimiento</TableHead>
                        <TableHead className="text-right w-32">Total</TableHead>
                        <TableHead className="text-right w-32">Cancelado</TableHead>
                        <TableHead className="text-right w-32 font-bold text-amber-600 dark:text-amber-400">
                            Pendiente
                        </TableHead>
                        <TableHead className="w-40 text-center">Progreso Pago</TableHead>
                        <TableHead className="w-28 text-center">Estado</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {pendingDocuments.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                                <div className="flex flex-col items-center justify-center gap-1">
                                    <CheckCircle2 className="h-6 w-6 text-emerald-500 mb-1" />
                                    <span>¡Excelente! No hay comprobantes ni ventas pendientes para esta cuenta.</span>
                                </div>
                            </TableCell>
                        </TableRow>
                    ) : (
                        pendingDocuments.map((doc) => {
                            const credited = doc.credited ?? 0;
                            const pctPaid = doc.total > 0 ? Math.min(100, Math.round(((doc.paid + credited) / doc.total) * 100)) : 0;
                            const isOverdue = Boolean(doc.isOverdue);

                            return (
                                <TableRow key={doc.id} className="hover:bg-muted/30">
                                    <TableCell className="font-mono text-xs font-bold text-foreground">
                                        {doc.number}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                        {doc.date ? new Date(doc.date).toLocaleDateString("es-AR") : "-"}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">
                                        {doc.dueDate ? (
                                            <span
                                                className={
                                                    isOverdue
                                                        ? "text-red-500 font-bold flex items-center gap-1"
                                                        : "text-muted-foreground"
                                                }
                                            >
                                                {isOverdue && <BadgeAlert className="h-3 w-3 inline" />}
                                                {new Date(doc.dueDate).toLocaleDateString("es-AR")}
                                            </span>
                                        ) : (
                                            "-"
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs font-semibold text-foreground">
                                        {formatMoney(doc.total)}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                                        {formatMoney(doc.paid)}
                                        {credited > 0 ? (
                                            <span className="block text-[10px] font-normal text-muted-foreground">
                                                + {formatMoney(credited)} en notas de crédito
                                            </span>
                                        ) : null}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs font-bold text-amber-500">
                                        {formatMoney(doc.pending)}
                                    </TableCell>
                                    <TableCell className="px-4">
                                        <div className="flex items-center gap-2">
                                            <Progress value={pctPaid} className="h-2 flex-1" />
                                            <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                                                {pctPaid}%
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Badge
                                            variant="outline"
                                            className={`text-[10px] uppercase font-bold ${
                                                isOverdue
                                                    ? "bg-red-500/10 text-red-500 border-red-500/30"
                                                    : "bg-amber-500/10 text-amber-500 border-amber-500/30"
                                            }`}
                                        >
                                            {isOverdue ? "Vencida" : "Abierta"}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    )}
                </TableBody>
            </Table>
        </div>
    );
}
