import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import type { IncomeStatementData } from "@/types/accounting"

interface IncomeStatementTabProps {
    incomeStatement: IncomeStatementData | null
}

export function IncomeStatementTab({ incomeStatement }: IncomeStatementTabProps) {
    return (
        <Card className="border border-slate-100 shadow-sm">
            <CardHeader>
                <CardTitle>Estado de Resultados Impositivo (Pérdidas y Ganancias)</CardTitle>
                <CardDescription>Esquema devengado de rentabilidad basado en cuentas de ingresos y egresos del período.</CardDescription>
            </CardHeader>
            <CardContent>
                {incomeStatement ? (
                    <div className="space-y-6 max-w-3xl mx-auto">
                        {/* Revenues Section */}
                        <div className="bg-green-500/5 dark:bg-green-500/10 border border-green-500/20 rounded-lg p-5">
                            <h3 className="text-lg font-bold text-green-700 dark:text-green-400 mb-3 flex items-center justify-between">
                                <span>Ingresos Operativos</span>
                                <span>${incomeStatement.total_revenues.toFixed(2)}</span>
                            </h3>
                            <Table>
                                <TableBody>
                                    {incomeStatement.revenues.map((item) => (
                                        <TableRow key={item.code} className="hover:bg-transparent border-green-500/10">
                                            <TableCell className="text-sm font-semibold">{item.name}</TableCell>
                                            <TableCell className="text-right font-bold text-green-600">
                                                ${item.balance.toFixed(2)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Expenses Section */}
                        <div className="bg-red-500/5 dark:bg-red-500/10 border border-red-500/20 rounded-lg p-5">
                            <h3 className="text-lg font-bold text-red-700 dark:text-red-400 mb-3 flex items-center justify-between">
                                <span>Costos & Gastos Operativos</span>
                                <span>-${incomeStatement.total_expenses.toFixed(2)}</span>
                            </h3>
                            <Table>
                                <TableBody>
                                    {incomeStatement.expenses.map((item) => (
                                        <TableRow key={item.code} className="hover:bg-transparent border-red-500/10">
                                            <TableCell className="text-sm font-semibold">{item.name}</TableCell>
                                            <TableCell className="text-right font-bold text-red-500">
                                                -${item.balance.toFixed(2)}
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
                                    ? "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400"
                                    : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400"
                            }`}
                        >
                            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                                Resultado Neto del Ejercicio
                            </h4>
                            <div className="text-4xl font-extrabold mt-1">${incomeStatement.net_result.toFixed(2)}</div>
                            <p className="text-xs text-muted-foreground mt-2">
                                {incomeStatement.net_result >= 0
                                    ? "Utilidad neta positiva devengada"
                                    : "Pérdida neta acumulada en el período"}
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className="text-center text-slate-400 py-6">Calculando estructura contable...</p>
                )}
            </CardContent>
        </Card>
    )
}
