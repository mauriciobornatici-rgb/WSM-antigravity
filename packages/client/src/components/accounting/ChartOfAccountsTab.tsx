import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Plus, MoreHorizontal, Edit, Trash2 } from "lucide-react"
import type { ChartAccount } from "@/types/accounting"

interface ChartOfAccountsTabProps {
    chartAccounts: ChartAccount[]
    onNewAccount: () => void
    onEditAccount: (account: ChartAccount) => void
    onDeleteAccount: (code: string) => void
}

export function ChartOfAccountsTab({
    chartAccounts,
    onNewAccount,
    onEditAccount,
    onDeleteAccount,
}: ChartOfAccountsTabProps) {
    const typeLabelMap: Record<string, string> = {
        asset: "Activo",
        liability: "Pasivo",
        equity: "Patrimonio Neto",
        revenue: "Ingreso / Ganancia",
        expense: "Egreso / Pérdida",
    }

    return (
        <Card className="border border-slate-100 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Plan de Cuentas Contable</CardTitle>
                    <CardDescription>Catálogo de cuentas configuradas en WSM SportsERP con saldos consolidados acumulados.</CardDescription>
                </div>
                <Button onClick={onNewAccount} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Nueva Cuenta
                </Button>
            </CardHeader>
            <CardContent>
                <div className="rounded-md border overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-slate-50">
                                <TableHead className="w-40">Código Cuenta</TableHead>
                                <TableHead>Denominación de Cuenta</TableHead>
                                <TableHead className="w-40">Tipo</TableHead>
                                <TableHead className="text-right w-40">Total Débitos</TableHead>
                                <TableHead className="text-right w-40">Total Créditos</TableHead>
                                <TableHead className="text-right w-40">Saldo Actual</TableHead>
                                <TableHead className="w-16 text-center">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {chartAccounts.map((account) => {
                                return (
                                    <TableRow key={account.code}>
                                        <TableCell className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                                            {account.code}
                                        </TableCell>
                                        <TableCell className="font-semibold text-slate-800 dark:text-slate-200">
                                            {account.name}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            <span
                                                className={`px-2 py-0.5 rounded-full font-semibold ${
                                                    account.type === "asset"
                                                        ? "bg-green-100 text-green-800"
                                                        : account.type === "liability"
                                                        ? "bg-red-100 text-red-800"
                                                        : account.type === "equity"
                                                        ? "bg-purple-100 text-purple-800"
                                                        : account.type === "revenue"
                                                        ? "bg-blue-100 text-blue-800"
                                                        : "bg-amber-100 text-amber-800"
                                                }`}
                                            >
                                                {typeLabelMap[account.type] || account.type}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-medium text-slate-600">
                                            ${account.total_debit.toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-right font-medium text-slate-600">
                                            ${account.total_credit.toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-slate-900 dark:text-slate-100">
                                            ${account.balance.toFixed(2)}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => onEditAccount(account)}>
                                                        <Edit className="mr-2 h-4 w-4" /> Editar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-red-600 focus:text-red-600"
                                                        onClick={() => onDeleteAccount(account.code)}
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    )
}
