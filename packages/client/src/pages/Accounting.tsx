import { useState, useEffect, useCallback } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { api } from "@/services/api"
import type { Transaction } from "@/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DollarSign, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from "lucide-react"
import { showErrorToast } from "@/lib/errorHandling"

export default function AccountingPage() {
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const loadTransactions = useCallback(async () => {
        setIsLoading(true)
        setErrorMessage(null)
        try {
            const data = await api.getTransactions()
            setTransactions(data)
        } catch (error) {
            setErrorMessage("No se pudieron cargar los datos contables.")
            showErrorToast("Error al cargar contabilidad", error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadTransactions()
    }, [loadTransactions])

    // KPI Calculations
    const totalIncome = transactions
        .filter(t => t.type === 'sale')
        .reduce((acc, t) => acc + Number(t.amount), 0)

    const totalExpenses = transactions
        .filter(t => t.type === 'expense' || t.type === 'purchase')
        .reduce((acc, t) => acc + Number(t.amount), 0)

    const netProfit = totalIncome - totalExpenses

    // Dynamic Chart Data Calculation (Last 7 days)
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date()
        d.setDate(d.getDate() - (6 - i))
        return d
    })

    const chartData = last7Days.map(date => {
        const dateStr = date.toLocaleDateString()
        const dayName = date.toLocaleDateString("es-AR", { weekday: 'short' })

        const dayTransactions = transactions.filter(t => new Date(t.date).toLocaleDateString() === dateStr)

        const sales = dayTransactions
            .filter(t => t.type === 'sale')
            .reduce((acc, t) => acc + Number(t.amount), 0)

        const expenses = dayTransactions
            .filter(t => t.type === 'expense' || t.type === 'purchase')
            .reduce((acc, t) => acc + Number(t.amount), 0)

        return {
            name: dayName.charAt(0).toUpperCase() + dayName.slice(1), // Capitalize
            sales,
            expenses
        }
    })

    if (isLoading) {
        return <div className="p-8 text-center">Cargando datos contables...</div>
    }

    if (errorMessage) {
        return <div className="p-8 text-center text-muted-foreground">{errorMessage}</div>
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Contabilidad</h2>
                <p className="text-muted-foreground">Visión general del estado financiero.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Ingresos Totales</CardTitle>
                        <DollarSign className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-500">+${totalIncome.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground flex items-center mt-1">
                            <TrendingUp className="h-3 w-3 mr-1" /> del mes actual
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Gastos & Compras</CardTitle>
                        <DollarSign className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-500">-${totalExpenses.toFixed(2)}</div>
                        <p className="text-xs text-muted-foreground flex items-center mt-1">
                            <TrendingDown className="h-3 w-3 mr-1" /> operativos y stock
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Beneficio Neto</CardTitle>
                        <TrendingUp className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className={`text-2xl font-bold ${netProfit >= 0 ? 'text-primary' : 'text-red-500'}`}>
                            ${netProfit.toFixed(2)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Margen bruto calculado
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Main Chart */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Flujo de Caja (Semanal)</CardTitle>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <ResponsiveContainer width="100%" height={350}>
                            <BarChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: "#1f2937", border: "none" }}
                                    itemStyle={{ color: "#fff" }}
                                    cursor={{ fill: 'transparent' }}
                                />
                                <Bar dataKey="sales" name="Ventas" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="expenses" name="Gastos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Ledger / Recent Activity */}
                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Libro Diario</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {transactions.slice(0, 6).map((item) => (
                                <div key={item.id} className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
                                    <div className="flex items-center gap-3">
                                        <div className={`flex items-center justify-center p-2 rounded-full ${item.type === 'sale' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'}`}>
                                            {item.type === 'sale' ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                                        </div>
                                        <div className="grid gap-1">
                                            <p className="text-sm font-medium leading-none">{item.description}</p>
                                            <p className="text-xs text-muted-foreground">{new Date(item.date).toLocaleDateString()}</p>
                                        </div>
                                    </div>
                                    <div className={`font-medium ${item.type === 'sale' ? 'text-green-500' : 'text-red-500'}`}>
                                        {item.type === 'sale' ? '+' : '-'}${Number(item.amount).toFixed(2)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
