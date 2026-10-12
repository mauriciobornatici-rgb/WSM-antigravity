import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DollarSign, TrendingUp, TrendingDown } from "lucide-react"
import { formatMoney } from "@/lib/formatters"

interface AccountingSummaryCardsProps {
    totalIncome: number
    totalExpenses: number
    netProfit: number
}

export function AccountingSummaryCards({ totalIncome, totalExpenses, netProfit }: AccountingSummaryCardsProps) {
    return (
        <div className="grid gap-4 md:grid-cols-3">
            <Card className="border-border shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Cobros Realizados (Ventas)</CardTitle>
                    <DollarSign className="h-4 w-4 text-emerald-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                        +{formatMoney(totalIncome)}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center mt-1">
                        <TrendingUp className="h-3 w-3 mr-1 text-emerald-500" /> Entradas efectivas imputadas
                    </p>
                </CardContent>
            </Card>
            <Card className="border-border shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Pagos y Compras</CardTitle>
                    <DollarSign className="h-4 w-4 text-rose-500" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold font-mono text-rose-600 dark:text-rose-400">
                        -{formatMoney(totalExpenses)}
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center mt-1">
                        <TrendingDown className="h-3 w-3 mr-1 text-rose-500" /> Egresos de caja y stock
                    </p>
                </CardContent>
            </Card>
            <Card className="border-border shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Flujo Neto Percibido</CardTitle>
                    <TrendingUp className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                    <div className={`text-2xl font-bold font-mono ${netProfit >= 0 ? "text-primary" : "text-rose-500"}`}>
                        {formatMoney(netProfit)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                        Saldo en caja / disponible
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
