import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/formatters";

export interface UnifiedMovement {
    id: string;
    date: string;
    type: "invoice" | "payment" | "credit_note" | "return" | "adjustment";
    typeLabel: string;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balanceAfter: number;
}

interface CurrentAccountsLedgerTableProps {
    accountType: "client" | "supplier";
    ledgerMovements: UnifiedMovement[];
}

export function CurrentAccountsLedgerTable({
    accountType,
    ledgerMovements,
}: CurrentAccountsLedgerTableProps) {
    const isClient = accountType === "client";

    return (
        <div className="rounded-md border border-border overflow-x-auto">
            <Table className="min-w-[760px]">
                <TableHeader className="bg-muted/40">
                    <TableRow>
                        <TableHead className="w-28">Fecha</TableHead>
                        <TableHead className="w-36">Tipo</TableHead>
                        <TableHead className="w-32">Comprobante</TableHead>
                        <TableHead>Concepto / Detalle</TableHead>
                        <TableHead className="text-right w-32">
                            {isClient ? "Débito (+)" : "Débito (-)"}
                        </TableHead>
                        <TableHead className="text-right w-32">
                            {isClient ? "Crédito (-)" : "Crédito (+)"}
                        </TableHead>
                        <TableHead className="text-right w-36 font-bold">Saldo</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {ledgerMovements.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                No se registran movimientos para esta cuenta corriente.
                            </TableCell>
                        </TableRow>
                    ) : (
                        ledgerMovements.map((mov) => {
                            const badgeColor =
                                mov.type === "invoice"
                                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                                    : mov.type === "payment"
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                    : mov.type === "credit_note" || mov.type === "return"
                                    ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
                                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";

                            return (
                                <TableRow key={mov.id} className="hover:bg-muted/30">
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                        {new Date(mov.date).toLocaleDateString("es-AR")}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className={`font-medium text-[11px] ${badgeColor}`}>
                                            {mov.typeLabel}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="font-mono text-xs font-semibold text-foreground">
                                        {mov.reference}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground max-w-[250px] truncate">
                                        {mov.description}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs font-semibold text-foreground">
                                        {mov.debit > 0 ? formatMoney(mov.debit) : "-"}
                                    </TableCell>
                                    <TableCell className="text-right font-mono text-xs font-semibold text-foreground">
                                        {mov.credit > 0 ? formatMoney(mov.credit) : "-"}
                                    </TableCell>
                                    <TableCell
                                        className={`text-right font-mono text-xs font-bold ${
                                            mov.balanceAfter > 0
                                                ? isClient
                                                    ? "text-amber-500"
                                                    : "text-rose-500"
                                                : "text-emerald-500"
                                        }`}
                                    >
                                        {formatMoney(mov.balanceAfter)}
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
