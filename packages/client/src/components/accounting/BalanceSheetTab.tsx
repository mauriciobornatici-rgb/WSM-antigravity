import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { Scale, Download, CheckCircle, AlertTriangle } from "lucide-react"
import type { BalanceSheetResponse } from "@/services/api"

interface BalanceSheetTabProps {
    balanceSheet: BalanceSheetResponse | null
    onExportCSV: () => void
}

export function BalanceSheetTab({ balanceSheet, onExportCSV }: BalanceSheetTabProps) {
    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
                <div>
                    <h3 className="text-xl font-bold tracking-tight text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <Scale className="h-5 w-5 text-cyan-500" />
                        Balance General / Estado de Situación Patrimonial
                    </h3>
                    <p className="text-xs text-muted-foreground">Estructurado según Resolución Técnica Nº 9 (FACPCE) para la República Argentina.</p>
                </div>
                <Button onClick={onExportCSV} variant="outline" size="sm" className="gap-2 self-start sm:self-center">
                    <Download className="h-4 w-4 text-cyan-500" />
                    Exportar Balance (CSV)
                </Button>
            </div>

            {balanceSheet ? (
                <div className="space-y-6">
                    {/* Equation Verification Banner */}
                    <div
                        className={`p-4 border rounded-xl shadow-sm transition-all duration-300 ${
                            balanceSheet.totals.discrepancy < 0.011
                                ? "bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/20 text-emerald-800 dark:text-emerald-400"
                                : "bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/20 text-amber-800 dark:text-amber-400 animate-pulse"
                        }`}
                    >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div
                                    className={`p-2 rounded-full ${
                                        balanceSheet.totals.discrepancy < 0.011
                                            ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                                            : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                    }`}
                                >
                                    {balanceSheet.totals.discrepancy < 0.011 ? (
                                        <CheckCircle className="h-6 w-6" />
                                    ) : (
                                        <AlertTriangle className="h-6 w-6" />
                                    )}
                                </div>
                                <div>
                                    <p className="text-xs uppercase font-extrabold tracking-wider text-slate-400">
                                        Identidad Contable de Partida Doble
                                    </p>
                                    <h4 className="text-lg font-bold">
                                        {balanceSheet.totals.discrepancy < 0.011
                                            ? "Ecuación Patrimonial Equilibrada"
                                            : "Desbalance Detectado en Libros"}
                                    </h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        {balanceSheet.totals.discrepancy < 0.011
                                            ? "El total de Activos coincide exactamente con la suma de Pasivos y Patrimonio Neto."
                                            : "Existe una discrepancia contable que requiere ajustes de asientos de diario."}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 sm:gap-6 font-mono bg-slate-900/5 dark:bg-slate-950/40 p-3 rounded-lg border border-slate-200/50 dark:border-slate-800/50">
                                <div className="text-right">
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Activo (A)</span>
                                    <span className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                                        ${balanceSheet.totals.total_assets.toFixed(2)}
                                    </span>
                                </div>
                                <div className="text-slate-400 font-bold text-lg">=</div>
                                <div className="text-right">
                                    <span className="block text-[10px] text-slate-400 uppercase font-bold">Pasivo + P.N. (P+PN)</span>
                                    <span className="text-base font-extrabold text-slate-800 dark:text-slate-100">
                                        ${balanceSheet.totals.total_liabilities_and_equity.toFixed(2)}
                                    </span>
                                </div>
                                {balanceSheet.totals.discrepancy > 0.01 && (
                                    <>
                                        <div className="text-slate-400 font-bold text-lg">|</div>
                                        <div className="text-right">
                                            <span className="block text-[10px] text-red-500 uppercase font-bold">
                                                Diferencia
                                            </span>
                                            <span className="text-base font-extrabold text-red-500">
                                                ${balanceSheet.totals.discrepancy.toFixed(2)}
                                            </span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Dual-column structure */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* COLUMN 1: ACTIVO */}
                        <div className="space-y-6">
                            {/* ACTIVO HEADER */}
                            <div className="bg-gradient-to-r from-emerald-600 to-teal-700 dark:from-emerald-950/80 dark:to-teal-950/80 text-white rounded-xl p-5 shadow-sm border border-emerald-500/20">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-200 dark:text-emerald-400">
                                            Rubro Patrimonial 1
                                        </span>
                                        <h4 className="text-xl font-extrabold tracking-tight">ACTIVO</h4>
                                        <p className="text-xs text-emerald-100/70 mt-0.5">Recursos económicos de la organización</p>
                                    </div>
                                    <div className="text-right">
                                        <span className="block text-xs font-bold text-emerald-200">TOTAL ACTIVO</span>
                                        <span className="text-3xl font-extrabold">${balanceSheet.totals.total_assets.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>

                            {/* ACTIVO CORRIENTE */}
                            <Card className="border border-slate-200 shadow-sm bg-white dark:bg-slate-950/20">
                                <CardHeader className="py-4 border-b bg-slate-50/50 dark:bg-slate-900/10 flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                            1.1 ACTIVO CORRIENTE
                                        </CardTitle>
                                        <CardDescription className="text-[11px]">
                                            Bienes y derechos realizables en un plazo menor a 12 meses
                                        </CardDescription>
                                    </div>
                                    <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                                        $
                                        {balanceSheet.assets.corriente
                                            .reduce((acc, item) => acc + item.balance, 0)
                                            .toFixed(2)}
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {balanceSheet.assets.corriente.length === 0 ? (
                                        <p className="text-xs text-center text-slate-400 py-6 italic">
                                            No hay cuentas corrientes registradas con saldo.
                                        </p>
                                    ) : (
                                        <Table>
                                            <TableBody>
                                                {balanceSheet.assets.corriente.map((item) => (
                                                    <TableRow
                                                        key={item.code}
                                                        className="hover:bg-slate-50/40 dark:hover:bg-slate-900/10 border-slate-100 dark:border-slate-900"
                                                    >
                                                        <TableCell className="py-2.5 font-semibold text-xs text-slate-800 dark:text-slate-200">
                                                            <span className="font-mono text-[10px] text-slate-400 mr-2">
                                                                {item.code}
                                                            </span>
                                                            {item.name}
                                                        </TableCell>
                                                        <TableCell className="py-2.5 text-right font-bold text-xs text-slate-900 dark:text-slate-100">
                                                            ${item.balance.toFixed(2)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>

                            {/* ACTIVO NO CORRIENTE */}
                            <Card className="border border-slate-200 shadow-sm bg-white dark:bg-slate-950/20">
                                <CardHeader className="py-4 border-b bg-slate-50/50 dark:bg-slate-900/10 flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                            1.2 ACTIVO NO CORRIENTE
                                        </CardTitle>
                                        <CardDescription className="text-[11px]">
                                            Bienes de uso y derechos a realizarse a más de 12 meses
                                        </CardDescription>
                                    </div>
                                    <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                                        $
                                        {balanceSheet.assets.no_corriente
                                            .reduce((acc, item) => acc + item.balance, 0)
                                            .toFixed(2)}
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {balanceSheet.assets.no_corriente.length === 0 ? (
                                        <p className="text-xs text-center text-slate-400 py-6 italic">
                                            No hay cuentas no corrientes registradas con saldo.
                                        </p>
                                    ) : (
                                        <Table>
                                            <TableBody>
                                                {balanceSheet.assets.no_corriente.map((item) => (
                                                    <TableRow
                                                        key={item.code}
                                                        className="hover:bg-slate-50/40 dark:hover:bg-slate-900/10 border-slate-100 dark:border-slate-900"
                                                    >
                                                        <TableCell className="py-2.5 font-semibold text-xs text-slate-800 dark:text-slate-200">
                                                            <span className="font-mono text-[10px] text-slate-400 mr-2">
                                                                {item.code}
                                                            </span>
                                                            {item.name}
                                                        </TableCell>
                                                        <TableCell className="py-2.5 text-right font-bold text-xs text-slate-900 dark:text-slate-100">
                                                            ${item.balance.toFixed(2)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        {/* COLUMN 2: PASIVO & PATRIMONIO NETO */}
                        <div className="space-y-6">
                            {/* PASIVO & PN HEADER */}
                            <div className="bg-gradient-to-r from-slate-700 to-indigo-850 dark:from-slate-900 dark:to-indigo-950 text-white rounded-xl p-5 shadow-sm border border-indigo-500/20">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-200 dark:text-indigo-400">
                                            Rubros Patrimoniales 2 y 3
                                        </span>
                                        <h4 className="text-xl font-extrabold tracking-tight">PASIVO + P. NETO</h4>
                                        <p className="text-xs text-indigo-100/70 mt-0.5">
                                            Financiación externa (deudas) e interna (capital y reservas)
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <span className="block text-xs font-bold text-indigo-200">TOTAL PASIVO + P.N.</span>
                                        <span className="text-3xl font-extrabold">
                                            ${balanceSheet.totals.total_liabilities_and_equity.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* PASIVO CORRIENTE */}
                            <Card className="border border-slate-200 shadow-sm bg-white dark:bg-slate-950/20">
                                <CardHeader className="py-4 border-b bg-slate-50/50 dark:bg-slate-900/10 flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                            2.1 PASIVO CORRIENTE
                                        </CardTitle>
                                        <CardDescription className="text-[11px]">
                                            Obligaciones exigibles dentro de los próximos 12 meses
                                        </CardDescription>
                                    </div>
                                    <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                                        $
                                        {balanceSheet.liabilities.corriente
                                            .reduce((acc, item) => acc + item.balance, 0)
                                            .toFixed(2)}
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {balanceSheet.liabilities.corriente.length === 0 ? (
                                        <p className="text-xs text-center text-slate-400 py-6 italic">
                                            No hay pasivos corrientes registrados con saldo.
                                        </p>
                                    ) : (
                                        <Table>
                                            <TableBody>
                                                {balanceSheet.liabilities.corriente.map((item) => (
                                                    <TableRow
                                                        key={item.code}
                                                        className="hover:bg-slate-50/40 dark:hover:bg-slate-900/10 border-slate-100 dark:border-slate-900"
                                                    >
                                                        <TableCell className="py-2.5 font-semibold text-xs text-slate-800 dark:text-slate-200">
                                                            <span className="font-mono text-[10px] text-slate-400 mr-2">
                                                                {item.code}
                                                            </span>
                                                            {item.name}
                                                        </TableCell>
                                                        <TableCell className="py-2.5 text-right font-bold text-xs text-slate-900 dark:text-slate-100">
                                                            ${item.balance.toFixed(2)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>

                            {/* PASIVO NO CORRIENTE */}
                            <Card className="border border-slate-200 shadow-sm bg-white dark:bg-slate-950/20">
                                <CardHeader className="py-4 border-b bg-slate-50/50 dark:bg-slate-900/10 flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                            2.2 PASIVO NO CORRIENTE
                                        </CardTitle>
                                        <CardDescription className="text-[11px]">
                                            Obligaciones exigibles a plazos mayores de 12 meses
                                        </CardDescription>
                                    </div>
                                    <div className="font-bold text-sm text-slate-800 dark:text-slate-100">
                                        $
                                        {balanceSheet.liabilities.no_corriente
                                            .reduce((acc, item) => acc + item.balance, 0)
                                            .toFixed(2)}
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {balanceSheet.liabilities.no_corriente.length === 0 ? (
                                        <p className="text-xs text-center text-slate-400 py-6 italic">
                                            No hay pasivos no corrientes registrados con saldo.
                                        </p>
                                    ) : (
                                        <Table>
                                            <TableBody>
                                                {balanceSheet.liabilities.no_corriente.map((item) => (
                                                    <TableRow
                                                        key={item.code}
                                                        className="hover:bg-slate-50/40 dark:hover:bg-slate-900/10 border-slate-100 dark:border-slate-900"
                                                    >
                                                        <TableCell className="py-2.5 font-semibold text-xs text-slate-800 dark:text-slate-200">
                                                            <span className="font-mono text-[10px] text-slate-400 mr-2">
                                                                {item.code}
                                                            </span>
                                                            {item.name}
                                                        </TableCell>
                                                        <TableCell className="py-2.5 text-right font-bold text-xs text-slate-900 dark:text-slate-100">
                                                            ${item.balance.toFixed(2)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>

                            {/* PATRIMONIO NETO */}
                            <Card className="border border-indigo-200 dark:border-indigo-900 shadow-sm bg-indigo-50/5 dark:bg-indigo-950/5">
                                <CardHeader className="py-4 border-b border-indigo-100 dark:border-indigo-900 flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle className="text-sm font-bold text-indigo-950 dark:text-indigo-200">
                                            3.0 PATRIMONIO NETO (S/ RT 9)
                                        </CardTitle>
                                        <CardDescription className="text-[11px]">
                                            Participación de los propietarios e integración del Resultado Neto
                                        </CardDescription>
                                    </div>
                                    <div className="font-bold text-sm text-indigo-600 dark:text-indigo-400">
                                        ${balanceSheet.totals.total_equity.toFixed(2)}
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    {balanceSheet.equity.items.length === 0 ? (
                                        <p className="text-xs text-center text-slate-400 py-6 italic">
                                            No hay cuentas del patrimonio neto registradas.
                                        </p>
                                    ) : (
                                        <Table>
                                            <TableBody>
                                                {balanceSheet.equity.items.map((item) => {
                                                    const isVirtualResult = item.code === "3.1.02.99"
                                                    return (
                                                        <TableRow
                                                            key={item.code}
                                                            className={`hover:bg-slate-50/40 dark:hover:bg-slate-900/10 border-slate-100 dark:border-slate-900 ${
                                                                isVirtualResult
                                                                    ? "bg-amber-500/5 dark:bg-amber-500/10 border-l-4 border-l-amber-500"
                                                                    : ""
                                                            }`}
                                                        >
                                                            <TableCell
                                                                className={`py-2.5 text-xs text-slate-800 dark:text-slate-200 ${
                                                                    isVirtualResult
                                                                        ? "font-bold text-amber-700 dark:text-amber-400"
                                                                        : "font-semibold"
                                                                }`}
                                                            >
                                                                <span className="font-mono text-[10px] text-slate-400 mr-2">
                                                                    {item.code}
                                                                </span>
                                                                {item.name}
                                                                {isVirtualResult && (
                                                                    <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-800 dark:text-amber-300 uppercase tracking-widest font-extrabold font-sans">
                                                                        Desde Estado Resultados
                                                                    </span>
                                                                )}
                                                            </TableCell>
                                                            <TableCell
                                                                className={`py-2.5 text-right font-bold text-xs ${
                                                                    isVirtualResult
                                                                        ? item.balance >= 0
                                                                            ? "text-green-600"
                                                                            : "text-red-500"
                                                                        : "text-slate-900 dark:text-slate-100"
                                                                }`}
                                                            >
                                                                ${item.balance.toFixed(2)}
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
                                    )}
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            ) : (
                <p className="text-center text-slate-400 py-6">Calculando balance general...</p>
            )}
        </div>
    )
}
