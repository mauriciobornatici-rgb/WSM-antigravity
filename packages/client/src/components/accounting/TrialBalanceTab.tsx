import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { TrialBalanceItem } from "@/types/accounting"

interface TrialBalanceTabProps {
    trialBalance: TrialBalanceItem[]
}

export function TrialBalanceTab({ trialBalance }: TrialBalanceTabProps) {
    return (
        <Card className="border border-slate-100 shadow-sm">
            <CardHeader>
                <CardTitle>Balance de Sumas y Saldos (Trial Balance)</CardTitle>
                <CardDescription>Auditoría de consistencia de saldos para el período seleccionado.</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-slate-50">
                                <TableHead className="w-32">Código</TableHead>
                                <TableHead>Cuenta</TableHead>
                                <TableHead className="text-right w-44">Saldo Inicial</TableHead>
                                <TableHead className="text-right w-44 text-green-600">Débitos Período</TableHead>
                                <TableHead className="text-right w-44 text-red-500">Créditos Período</TableHead>
                                <TableHead className="text-right w-44">Saldo Final</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {trialBalance.map((item) => (
                                <TableRow key={item.code}>
                                    <TableCell className="font-mono text-xs text-slate-500">{item.code}</TableCell>
                                    <TableCell className="font-semibold text-slate-800 dark:text-slate-200">
                                        {item.name}
                                    </TableCell>
                                    <TableCell
                                        className={`text-right font-semibold ${
                                            item.initial_balance >= 0 ? "text-slate-600" : "text-red-500"
                                        }`}
                                    >
                                        ${item.initial_balance.toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-right font-semibold text-green-600">
                                        ${item.debit.toFixed(2)}
                                    </TableCell>
                                    <TableCell className="text-right font-semibold text-red-500">
                                        ${item.credit.toFixed(2)}
                                    </TableCell>
                                    <TableCell
                                        className={`text-right font-bold ${
                                            item.final_balance >= 0 ? "text-slate-900 dark:text-slate-100" : "text-red-500"
                                        }`}
                                    >
                                        ${item.final_balance.toFixed(2)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}
