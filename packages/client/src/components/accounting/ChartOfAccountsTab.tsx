import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Plus, MoreHorizontal, Edit, Trash2 } from "lucide-react"
import { formatMoney } from "@/lib/formatters"
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
        <Card className="border-border shadow-sm">
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
                <div className="rounded-md border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                        <Table className="min-w-[800px]">
                            <TableHeader>
                                <TableRow className="bg-muted/40">
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
                                            <TableCell className="font-mono text-xs font-bold text-foreground">
                                                {account.code}
                                            </TableCell>
                                            <TableCell className="font-semibold text-foreground">
                                                {account.name}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                <span
                                                    className={`px-2 py-0.5 rounded-full font-semibold border ${
                                                        account.type === "asset"
                                                            ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20"
                                                            : account.type === "liability"
                                                            ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20"
                                                            : account.type === "equity"
                                                            ? "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20"
                                                            : account.type === "revenue"
                                                            ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20"
                                                            : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                                                    }`}
                                                >
                                                    {typeLabelMap[account.type] || account.type}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right font-medium font-mono text-muted-foreground">
                                                {formatMoney(account.total_debit)}
                                            </TableCell>
                                            <TableCell className="text-right font-medium font-mono text-muted-foreground">
                                                {formatMoney(account.total_credit)}
                                            </TableCell>
                                            <TableCell className="text-right font-bold font-mono text-foreground">
                                                {formatMoney(account.balance)}
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
                                                            onClick={() => onDeleteAccount(account.code)}
                                                            className="text-destructive focus:text-destructive"
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
                </div>
            </CardContent>
        </Card>
    )
}
