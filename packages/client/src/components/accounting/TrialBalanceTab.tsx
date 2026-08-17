import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatMoney } from "@/lib/formatters"
import type { TrialBalanceItem } from "@/types/accounting"

interface TrialBalanceTabProps {
    trialBalance: TrialBalanceItem[]
}

export function TrialBalanceTab({ trialBalance }: TrialBalanceTabProps) {
    return (
        <Card className="border-border shadow-sm">
            <CardHeader>
                <CardTitle>Balance de Sumas y Saldos (Trial Balance)</CardTitle>
                <CardDescription>Auditoría de consistencia de saldos para el período seleccionado.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                        <Table className="min-w-[800px]">
                            <TableHeader>
                                <TableRow className="bg-muted/40">
                                    <TableHead className="w-32">Código</TableHead>
                                    <TableHead>Cuenta</TableHead>
                                    <TableHead className="text-right w-44">Saldo Inicial</TableHead>
                                    <TableHead className="text-right w-44 text-emerald-600 dark:text-emerald-400">Débitos Período</TableHead>
                                    <TableHead className="text-right w-44 text-rose-600 dark:text-rose-400">Créditos Período</TableHead>
                                    <TableHead className="text-right w-44">Saldo Final</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {trialBalance.map((item) => (
                                    <TableRow key={item.code}>
                                        <TableCell className="font-mono text-xs text-muted-foreground">{item.code}</TableCell>
                                        <TableCell className="font-semibold text-foreground">
                                            {item.name}
                                        </TableCell>
                                        <TableCell
                                            className={`text-right font-mono font-semibold ${
                                                item.initial_balance >= 0 ? "text-muted-foreground" : "text-rose-600 dark:text-rose-400"
                                            }`}
                                        >
                                            {formatMoney(item.initial_balance)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                            {formatMoney(item.debit)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                                            {formatMoney(item.credit)}
                                        </TableCell>
                                        <TableCell
                                            className={`text-right font-mono font-bold ${
                                                item.final_balance >= 0 ? "text-foreground" : "text-rose-600 dark:text-rose-400"
                                            }`}
                                        >
                                            {formatMoney(item.final_balance)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
