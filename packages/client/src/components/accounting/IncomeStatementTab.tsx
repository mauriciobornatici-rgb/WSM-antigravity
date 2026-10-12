import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { formatMoney } from "@/lib/formatters"
import type { IncomeStatementData } from "@/types/accounting"

interface IncomeStatementTabProps {
    incomeStatement: IncomeStatementData | null
}

export function IncomeStatementTab({ incomeStatement }: IncomeStatementTabProps) {
    return (
        <Card className="border-border shadow-sm">
            <CardHeader>
                <CardTitle>Estado de Resultados Impositivo (Pérdidas y Ganancias)</CardTitle>
                <CardDescription>Esquema devengado de rentabilidad basado en cuentas de ingresos y egresos del período.</CardDescription>
            </CardHeader>
            <CardContent>
                {incomeStatement ? (
                    <div className="space-y-6 max-w-3xl mx-auto">
                        {/* Revenues Section */}
                        <div className="bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-5">
                            <h3 className="text-lg font-bold text-emerald-700 dark:text-emerald-400 mb-3 flex items-center justify-between">
                                <span>Ingresos Operativos</span>
                                <span className="font-mono">+{formatMoney(incomeStatement.total_revenues)}</span>
                            </h3>
                            <Table>
                                <TableBody>
                                    {incomeStatement.revenues.map((item) => (
                                        <TableRow key={item.code} className="hover:bg-transparent border-emerald-500/10">
                                            <TableCell className="text-sm font-semibold text-foreground">{item.name}</TableCell>
                                            <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                                +{formatMoney(item.balance)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Expenses Section */}
                        <div className="bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 rounded-lg p-5">
                            <h3 className="text-lg font-bold text-rose-700 dark:text-rose-400 mb-3 flex items-center justify-between">
                                <span>Costos & Gastos Operativos</span>
                                <span className="font-mono">-{formatMoney(incomeStatement.total_expenses)}</span>
                            </h3>
                            <Table>
                                <TableBody>
                                    {incomeStatement.expenses.map((item) => (
                                        <TableRow key={item.code} className="hover:bg-transparent border-rose-500/10">
                                            <TableCell className="text-sm font-semibold text-foreground">{item.name}</TableCell>
                                            <TableCell className="text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                                                -{formatMoney(item.balance)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Final Profit */}
                        <div
                            className={`rounded-lg p-5 border text-center ${
                                incomeStatement.net_result >= 0
                                    ? "bg-primary/10 border-primary/30 text-primary"
                                    : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400"
                            }`}
                        >
                            <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                                Resultado Neto del Ejercicio
                            </h4>
                            <div className="text-4xl font-extrabold font-mono mt-1">{formatMoney(incomeStatement.net_result)}</div>
                            <p className="text-xs text-muted-foreground mt-2">
                                {incomeStatement.net_result >= 0
                                    ? "Utilidad neta positiva devengada"
                                    : "Pérdida neta acumulada en el período"}
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className="text-center text-muted-foreground py-6">Calculando estructura contable...</p>
                )}
            </CardContent>
        </Card>
    )
}
