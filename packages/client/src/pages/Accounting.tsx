import { useState, useEffect, useCallback } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { api } from "@/services/api"
import type { Transaction } from "@/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { 
    DollarSign, 
    TrendingUp, 
    TrendingDown, 
    ArrowUpRight, 
    ArrowDownRight, 
    Download, 
    BookOpen, 
    FileSpreadsheet, 
    Layers, 
    PieChart, 
    Plus, 
    Trash, 
    Trash2,
    AlertTriangle,
    CheckCircle,
    MoreHorizontal,
    Edit,
    RotateCcw
} from "lucide-react"
import { showErrorToast } from "@/lib/errorHandling"
import { toast } from "sonner"

interface ChartAccount {
    code: string
    name: string
    type: "asset" | "liability" | "equity" | "revenue" | "expense"
    active: boolean
    total_debit: number
    total_credit: number
    balance: number
}

interface JournalEntry {
    id: string
    entry_number: number
    date: string
    description: string
    reference_type: string
    reference_id: string
    lines: Array<{
        id: string
        account_code: string
        account_name: string
        account_type: string
        debit: number
        credit: number
        notes: string
    }>
}

interface TrialBalanceItem {
    code: string
    name: string
    type: string
    initial_balance: number
    debit: number
    credit: number
    final_balance: number
}

interface IncomeStatementData {
    revenues: Array<{ code: string; name: string; balance: number }>
    expenses: Array<{ code: string; name: string; balance: number }>
    total_revenues: number
    total_expenses: number
    net_result: number
}

export default function AccountingPage() {
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [chartAccounts, setChartAccounts] = useState<ChartAccount[]>([])
    const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
    const [trialBalance, setTrialBalance] = useState<TrialBalanceItem[]>([])
    const [incomeStatement, setIncomeStatement] = useState<IncomeStatementData | null>(null)
    
    const [isLoading, setIsLoading] = useState(true)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    // Default dates (last 30 days)
    const [startDate, setStartDate] = useState<string>(() => {
        const d = new Date()
        d.setDate(d.getDate() - 30)
        return d.toISOString().split("T")[0] || ""
    })
    const [endDate, setEndDate] = useState<string>(() => {
        return new Date().toISOString().split("T")[0] || ""
    })

    // Manual journal entry state
    const [manualDate, setManualDate] = useState<string>(() => {
        return new Date().toISOString().split("T")[0] || ""
    })
    const [manualDesc, setManualDesc] = useState("")
    const [manualLines, setManualLines] = useState<Array<{ account_code: string; debit: number; credit: number; notes: string }>>([
        { account_code: "", debit: 0, credit: 0, notes: "" },
        { account_code: "", debit: 0, credit: 0, notes: "" }
    ])
    const [isSubmittingManual, setIsSubmittingManual] = useState(false)

    // Modals state
    const [isAccountModalOpen, setIsAccountModalOpen] = useState(false)
    const [accountForm, setAccountForm] = useState<{code: string, name: string, type: string, active: boolean, isEdit: boolean}>({
        code: "", name: "", type: "asset", active: true, isEdit: false
    })

    const [isEditEntryModalOpen, setIsEditEntryModalOpen] = useState(false)
    const [editEntryId, setEditEntryId] = useState<string | null>(null)

    const loadData = useCallback(async () => {
        setIsLoading(true)
        setErrorMessage(null)
        try {
            const filters: any = {}
            if (startDate) filters.start_date = startDate
            if (endDate) filters.end_date = endDate

            const [
                txData, 
                accountsData, 
                journalData, 
                balanceData, 
                incomeData
            ] = await Promise.all([
                api.getTransactions(filters),
                api.getChartOfAccounts(),
                api.getJournalEntries(filters),
                api.getTrialBalance(filters),
                api.getIncomeStatement(filters)
            ])

            setTransactions(txData)
            setChartAccounts(accountsData)
            setJournalEntries(journalData)
            setTrialBalance(balanceData)
            setIncomeStatement(incomeData)
        } catch (error) {
            setErrorMessage("No se pudieron cargar los datos contables avanzados.")
            showErrorToast("Error al cargar contabilidad", error)
        } finally {
            setIsLoading(false)
        }
    }, [startDate, endDate])

    useEffect(() => {
        void loadData()
    }, [loadData])

    // Cash flow KPIs
    const totalIncome = transactions
        .filter(t => t.type === 'sale')
        .reduce((acc, t) => acc + Number(t.amount), 0)

    const totalExpenses = transactions
        .filter(t => t.type === 'expense' || t.type === 'purchase')
        .reduce((acc, t) => acc + Number(t.amount), 0)

    const netProfit = totalIncome - totalExpenses

    // Chart daily grouping (capped to 31 days)
    const getDaysArray = (startStr: string, endStr: string) => {
        const arr = [];
        const fallbackStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] || "";
        const fallbackEnd = new Date().toISOString().split('T')[0] || "";
        const start = new Date(startStr || fallbackStart);
        const end = new Date(endStr || fallbackEnd);
        
        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        const adjustedStart = new Date(start);
        if (diffDays > 31) {
            adjustedStart.setDate(end.getDate() - 30);
        }

        for (let dt = new Date(adjustedStart); dt <= end; dt.setDate(dt.getDate() + 1)) {
            arr.push(new Date(dt));
        }
        return arr;
    };

    const activeDays = getDaysArray(startDate, endDate);
    const chartData = activeDays.map(date => {
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
            name: dayName.charAt(0).toUpperCase() + dayName.slice(1) + " " + date.getDate(),
            sales,
            expenses
        }
    })

    // Manual Entry Sum Checks
    const totalManualDebit = manualLines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0)
    const totalManualCredit = manualLines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0)
    const isManualBalanced = Math.abs(totalManualDebit - totalManualCredit) < 0.0101 && totalManualDebit > 0

    function handleAddManualLine() {
        setManualLines([...manualLines, { account_code: "", debit: 0, credit: 0, notes: "" }])
    }

    function handleRemoveManualLine(index: number) {
        if (manualLines.length <= 2) {
            toast.warning("Un asiento contable requiere al menos dos líneas.")
            return
        }
        setManualLines(manualLines.filter((_, i) => i !== index))
    }

    function handleUpdateManualLine(index: number, key: string, value: any) {
        setManualLines(manualLines.map((line, i) => {
            if (i !== index) return line
            const updated = { ...line, [key]: value }
            if (key === 'debit' && Number(value) > 0) {
                updated.credit = 0
            } else if (key === 'credit' && Number(value) > 0) {
                updated.debit = 0
            }
            return updated
        }))
    }

    async function handleSaveManualEntry() {
        if (!manualDesc.trim()) {
            toast.error("Por favor, ingresa una descripción para el asiento.")
            return
        }
        if (!isManualBalanced) {
            toast.error("El asiento no está balanceado. Las sumas del Debe y Haber deben coincidir y ser mayores a cero.")
            return
        }
        const invalidLines = manualLines.some(line => !line.account_code)
        if (invalidLines) {
            toast.error("Por favor, selecciona una cuenta para todas las líneas contables.")
            return
        }

        try {
            setIsSubmittingManual(true)
            const payload = {
                date: manualDate,
                description: manualDesc,
                lines: manualLines.map(line => ({
                    account_code: line.account_code,
                    debit: Number(line.debit) || 0,
                    credit: Number(line.credit) || 0,
                    notes: line.notes || null
                }))
            }
            await api.createManualJournalEntry(payload)
            toast.success("Asiento manual registrado con éxito!")
            setManualDesc("")
            setManualLines([
                { account_code: "", debit: 0, credit: 0, notes: "" },
                { account_code: "", debit: 0, credit: 0, notes: "" }
            ])
            void loadData()
        } catch (error) {
            showErrorToast("Error al guardar asiento manual", error)
        } finally {
            setIsSubmittingManual(false)
        }
    }

    function exportLedgerCSV() {
        if (journalEntries.length === 0) {
            toast.warning("No hay asientos contables para exportar.");
            return;
        }

        const headers = ["Nro Asiento", "Fecha", "Concepto / Detalle", "Código Cuenta", "Nombre Cuenta", "Debe", "Haber", "Notas Partida"];
        const rows: any[] = [];

        for (const entry of journalEntries) {
            for (let i = 0; i < entry.lines.length; i++) {
                const line = entry.lines[i]!;
                rows.push([
                    entry.entry_number,
                    new Date(entry.date).toLocaleDateString("es-AR"),
                    i === 0 ? `"${entry.description.replace(/"/g, '""')}"` : "",
                    line.account_code,
                    line.account_name,
                    line.debit || "",
                    line.credit || "",
                    `"${(line.notes || "").replace(/"/g, '""')}"`
                ]);
            }
        }

        const csvContent =
            "\uFEFF" +
            [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `libro_diario_sports_erp_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("¡Libro Diario exportado con éxito para la contadora!");
    }

    async function handleSaveAccount() {
        if (!accountForm.code || !accountForm.name || !accountForm.type) {
            toast.error("Por favor completa los campos obligatorios.")
            return
        }
        try {
            if (accountForm.isEdit) {
                await api.updateAccount(accountForm.code, { name: accountForm.name, active: accountForm.active })
                toast.success("Cuenta actualizada correctamente.")
            } else {
                await api.createAccount({
                    code: accountForm.code,
                    name: accountForm.name,
                    type: accountForm.type,
                    active: accountForm.active
                })
                toast.success("Cuenta creada correctamente.")
            }
            setIsAccountModalOpen(false)
            void loadData()
        } catch (error) {
            showErrorToast("Error al guardar cuenta", error)
        }
    }

    async function handleDeleteAccount(code: string) {
        if (!confirm("¿Estás seguro de eliminar esta cuenta?")) return
        try {
            await api.deleteAccount(code)
            toast.success("Cuenta eliminada correctamente.")
            void loadData()
        } catch (error) {
            showErrorToast("Error al eliminar cuenta", error)
        }
    }

    async function handleReverseJournalEntry(id: string) {
        if (!confirm("¿Estás seguro de anular (revertir) este asiento? Esto creará un contra-asiento.")) return
        try {
            await api.reverseJournalEntry(id)
            toast.success("Asiento anulado correctamente.")
            void loadData()
        } catch (error) {
            showErrorToast("Error al anular asiento", error)
        }
    }

    async function handleDeleteJournalEntry(id: string) {
        if (!confirm("¿Estás seguro de ELIMINAR físicamente este asiento? Esta acción es irreversible.")) return
        try {
            await api.deleteJournalEntry(id)
            toast.success("Asiento eliminado correctamente.")
            void loadData()
        } catch (error) {
            showErrorToast("Error al eliminar asiento", error)
        }
    }

    async function handleUpdateJournalEntry() {
        if (!manualDesc.trim() || !isManualBalanced) {
            toast.error("El asiento debe tener descripción y estar balanceado.")
            return
        }
        if (!editEntryId) return

        try {
            setIsSubmittingManual(true)
            const payload = {
                date: manualDate,
                description: manualDesc,
                lines: manualLines.map(line => ({
                    account_code: line.account_code,
                    debit: Number(line.debit) || 0,
                    credit: Number(line.credit) || 0,
                    notes: line.notes || null
                }))
            }
            await api.updateJournalEntry(editEntryId, payload)
            toast.success("Asiento actualizado con éxito!")
            setIsEditEntryModalOpen(false)
            setEditEntryId(null)
            void loadData()
        } catch (error) {
            showErrorToast("Error al actualizar asiento", error)
        } finally {
            setIsSubmittingManual(false)
        }
    }

    function openEditEntryModal(entry: JournalEntry) {
        setEditEntryId(entry.id)
        setManualDate(entry.date.split("T")[0] || "")
        setManualDesc(entry.description)
        setManualLines(entry.lines.map(l => ({
            account_code: l.account_code,
            debit: Number(l.debit),
            credit: Number(l.credit),
            notes: l.notes || ""
        })))
        setIsEditEntryModalOpen(true)
    }

    function resetManualForm() {
        setManualDate(new Date().toISOString().split("T")[0] || "")
        setManualDesc("")
        setManualLines([
            { account_code: "", debit: 0, credit: 0, notes: "" },
            { account_code: "", debit: 0, credit: 0, notes: "" }
        ])
        setEditEntryId(null)
    }

    if (isLoading && transactions.length === 0) {
        return <div className="p-8 text-center text-lg font-medium text-slate-500">Cargando motor contable y saldos en caliente...</div>
    }

    if (errorMessage) {
        return <div className="p-8 text-center text-red-500">{errorMessage}</div>
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Contabilidad e Impuestos 🧾👩‍💻</h2>
                    <p className="text-muted-foreground">Motor de partida doble, balances fiscales, libro diario y reportes exportables.</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={exportLedgerCSV} variant="outline" className="w-full gap-2 sm:w-auto">
                        <Download className="h-4 w-4" />
                        Exportar Diario (CSV)
                    </Button>
                </div>
            </div>

            {/* Date period picker */}
            <Card className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 shadow-sm">
                <CardContent className="p-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Auditar Período Fiscal:</span>
                    <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                        <div className="flex flex-col gap-1 w-full sm:w-36">
                            <label className="text-[10px] uppercase font-bold text-slate-500">Desde</label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="h-9 px-3 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent text-sm w-full outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex flex-col gap-1 w-full sm:w-36">
                            <label className="text-[10px] uppercase font-bold text-slate-500">Hasta</label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="h-9 px-3 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent text-sm w-full outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div className="flex items-end h-full pt-4 w-full sm:w-auto">
                            <Button 
                                type="button" 
                                variant="outline" 
                                size="sm" 
                                className="w-full sm:w-auto"
                                onClick={() => {
                                    const prevMonth = new Date();
                                    prevMonth.setDate(prevMonth.getDate() - 30);
                                    setStartDate(prevMonth.toISOString().split('T')[0] || "");
                                    setEndDate(new Date().toISOString().split('T')[0] || "");
                                }}
                            >
                                Últimos 30 días
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Tabs defaultValue="dashboard" className="space-y-4">
                <TabsList className="h-auto flex-wrap justify-start gap-2 p-1 bg-muted/20 border">
                    <TabsTrigger value="dashboard" className="gap-2 shrink-0">
                        <PieChart className="h-4 w-4 text-emerald-500" />
                        Flujo de Caja
                    </TabsTrigger>
                    <TabsTrigger value="journal" className="gap-2 shrink-0">
                        <BookOpen className="h-4 w-4 text-blue-500" />
                        Libro Diario
                    </TabsTrigger>
                    <TabsTrigger value="chartOfAccounts" className="gap-2 shrink-0">
                        <Layers className="h-4 w-4 text-amber-500" />
                        Plan de Cuentas
                    </TabsTrigger>
                    <TabsTrigger value="trialBalance" className="gap-2 shrink-0">
                        <FileSpreadsheet className="h-4 w-4 text-indigo-500" />
                        Sumas y Saldos
                    </TabsTrigger>
                    <TabsTrigger value="incomeStatement" className="gap-2 shrink-0">
                        <TrendingUp className="h-4 w-4 text-rose-500" />
                        Estado de Resultados
                    </TabsTrigger>
                    <TabsTrigger value="manualEntry" className="gap-2 shrink-0 bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20">
                        <Plus className="h-4 w-4" />
                        Asiento Manual
                    </TabsTrigger>
                </TabsList>

                {/* Dashboard / Cash Flow Tab */}
                <TabsContent value="dashboard" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-3">
                        <Card className="border border-slate-100 shadow-sm bg-white dark:bg-slate-900/50">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Cobros Realizados (Ventas)</CardTitle>
                                <DollarSign className="h-4 w-4 text-green-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-green-600 dark:text-green-400">+${totalIncome.toFixed(2)}</div>
                                <p className="text-xs text-muted-foreground flex items-center mt-1">
                                    <TrendingUp className="h-3 w-3 mr-1 text-green-500" /> Entradas efectivas imputadas
                                </p>
                            </CardContent>
                        </Card>
                        <Card className="border border-slate-100 shadow-sm bg-white dark:bg-slate-900/50">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Pagos y Compras</CardTitle>
                                <DollarSign className="h-4 w-4 text-red-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold text-red-600 dark:text-red-400">-${totalExpenses.toFixed(2)}</div>
                                <p className="text-xs text-muted-foreground flex items-center mt-1">
                                    <TrendingDown className="h-3 w-3 mr-1 text-red-500" /> Egresos de caja y stock
                                </p>
                            </CardContent>
                        </Card>
                        <Card className="border border-slate-100 shadow-sm bg-white dark:bg-slate-900/50">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">Flujo Neto Percibido</CardTitle>
                                <TrendingUp className="h-4 w-4 text-primary" />
                            </CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${netProfit >= 0 ? 'text-primary' : 'text-rose-500'}`}>
                                    ${netProfit.toFixed(2)}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Saldo en caja / disponible
                                </p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-4 md:grid-cols-7">
                        <Card className="col-span-4 border border-slate-100 shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-lg">Flujo de Caja Diario</CardTitle>
                                <CardDescription>Movimientos financieros acumulados en el rango seleccionado.</CardDescription>
                            </CardHeader>
                            <CardContent className="pl-2">
                                <ResponsiveContainer width="100%" height={350}>
                                    <BarChart data={chartData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                        <XAxis dataKey="name" stroke="#888888" fontSize={11} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#888888" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: "#1e293b", border: "none", borderRadius: "6px" }}
                                            itemStyle={{ color: "#fff" }}
                                            cursor={{ fill: 'transparent' }}
                                        />
                                        <Bar dataKey="sales" name="Ingresos" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="expenses" name="Egresos" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                        <Card className="col-span-3 border border-slate-100 shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-lg">Últimas Transacciones</CardTitle>
                                <CardDescription>Historial de caja reciente.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
                                    {transactions.slice(0, 10).map((item) => (
                                        <div key={item.id} className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 last:border-0 last:pb-0">
                                            <div className="flex items-center gap-3">
                                                <div className={`flex items-center justify-center p-2 rounded-full ${item.type === 'sale' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'}`}>
                                                    {item.type === 'sale' ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                                                </div>
                                                <div className="grid gap-0.5">
                                                    <p className="text-xs font-semibold leading-tight text-slate-800 dark:text-slate-200">{item.description}</p>
                                                    <p className="text-[10px] text-slate-400">{new Date(item.date).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            <div className={`text-xs font-bold ${item.type === 'sale' ? 'text-green-600' : 'text-red-600'}`}>
                                                {item.type === 'sale' ? '+' : '-'}${Number(item.amount).toFixed(2)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* Libro Diario Tab */}
                <TabsContent value="journal" className="space-y-4">
                    <Card className="border border-slate-100 shadow-sm">
                        <CardHeader>
                            <CardTitle>Libro Diario General (Partida Doble)</CardTitle>
                            <CardDescription>Asientos contables ordenados de manera cronológica inversa.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-6">
                                {journalEntries.length === 0 ? (
                                    <p className="text-center text-slate-400 py-8 text-sm">No hay asientos contables registrados en este rango de fechas.</p>
                                ) : (
                                    journalEntries.map((entry) => (
                                        <div key={entry.id} className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-slate-50/30 dark:bg-slate-900/10 shadow-sm">
                                            <div className="bg-slate-100/70 dark:bg-slate-900/60 px-4 py-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800">
                                                <div className="flex items-center gap-3">
                                                    <span className="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                                        Asiento #{entry.entry_number}
                                                    </span>
                                                    <span className="text-xs text-slate-500 font-semibold">
                                                        {new Date(entry.date).toLocaleString("es-AR")}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="text-xs text-slate-400 italic">
                                                        Ref: {entry.reference_type || 'Manual'} ({entry.reference_id?.substring(0, 8) || 'N/A'})
                                                    </div>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => openEditEntryModal(entry)}>
                                                                <Edit className="mr-2 h-4 w-4" /> Editar Asiento
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => handleReverseJournalEntry(entry.id)}>
                                                                <RotateCcw className="mr-2 h-4 w-4" /> Anular (Revertir)
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => handleDeleteJournalEntry(entry.id)}>
                                                                <Trash2 className="mr-2 h-4 w-4" /> Eliminar Definitivo
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                            </div>
                                            <div className="px-4 py-2 bg-white dark:bg-slate-950 font-medium text-sm border-b border-slate-100 dark:border-slate-900 text-slate-800 dark:text-slate-200">
                                                {entry.description}
                                            </div>
                                            <Table>
                                                <TableHeader className="bg-slate-50/50 dark:bg-slate-900/30">
                                                    <TableRow>
                                                        <TableHead className="w-1/4">Cuenta</TableHead>
                                                        <TableHead className="w-1/2">Detalle / Notas</TableHead>
                                                        <TableHead className="text-right w-32">Debe</TableHead>
                                                        <TableHead className="text-right w-32">Haber</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {entry.lines.map((line) => (
                                                        <TableRow key={line.id}>
                                                            <TableCell className="font-semibold text-slate-800 dark:text-slate-200">
                                                                <span className="text-xs text-slate-400 mr-2">{line.account_code}</span>
                                                                {line.account_name}
                                                            </TableCell>
                                                            <TableCell className="text-slate-500 text-xs italic">{line.notes || "-"}</TableCell>
                                                            <TableCell className="text-right font-bold text-green-600">
                                                                {line.debit > 0 ? `$${line.debit.toFixed(2)}` : ""}
                                                            </TableCell>
                                                            <TableCell className="text-right font-bold text-red-500">
                                                                {line.credit > 0 ? `$${line.credit.toFixed(2)}` : ""}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Dialog open={isEditEntryModalOpen} onOpenChange={(open) => {
                        setIsEditEntryModalOpen(open)
                        if (!open) resetManualForm()
                    }}>
                        <DialogContent className="max-w-4xl">
                            <DialogHeader>
                                <DialogTitle>Editar Asiento Contable</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-6 max-w-4xl py-4 max-h-[70vh] overflow-y-auto">
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Fecha del Asiento</label>
                                        <Input 
                                            type="date" 
                                            value={manualDate} 
                                            onChange={e => setManualDate(e.target.value)} 
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Concepto / Glosa General</label>
                                        <Input 
                                            placeholder="Ej: Ajuste de fin de mes..." 
                                            value={manualDesc} 
                                            onChange={e => setManualDesc(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase block">Partidas del Asiento</label>
                                    
                                    {manualLines.map((line, idx) => (
                                        <div key={idx} className="flex flex-col gap-2 p-3 border rounded-lg sm:flex-row sm:items-center sm:gap-3 bg-slate-50/50">
                                            <div className="w-full sm:w-1/3">
                                                <Select 
                                                    value={line.account_code} 
                                                    onValueChange={val => handleUpdateManualLine(idx, 'account_code', val)}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Seleccionar Cuenta" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {chartAccounts.map(acc => (
                                                            <SelectItem key={acc.code} value={acc.code}>
                                                                <span className="font-mono text-xs mr-2 text-slate-400">{acc.code}</span>
                                                                {acc.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="w-full sm:w-40 flex items-center gap-1.5 bg-white dark:bg-slate-900 border rounded px-2 h-9">
                                                <span className="text-slate-400 text-xs font-bold">$</span>
                                                <input 
                                                    type="number" 
                                                    placeholder="Debe" 
                                                    value={line.debit || ""} 
                                                    onChange={e => handleUpdateManualLine(idx, 'debit', e.target.value)} 
                                                    className="w-full text-right outline-none text-xs font-bold text-green-600 bg-transparent"
                                                />
                                            </div>

                                            <div className="w-full sm:w-40 flex items-center gap-1.5 bg-white dark:bg-slate-900 border rounded px-2 h-9">
                                                <span className="text-slate-400 text-xs font-bold">$</span>
                                                <input 
                                                    type="number" 
                                                    placeholder="Haber" 
                                                    value={line.credit || ""} 
                                                    onChange={e => handleUpdateManualLine(idx, 'credit', e.target.value)} 
                                                    className="w-full text-right outline-none text-xs font-bold text-red-500 bg-transparent"
                                                />
                                            </div>

                                            <div className="w-full sm:flex-1">
                                                <Input 
                                                    placeholder="Detalle línea..." 
                                                    value={line.notes} 
                                                    onChange={e => handleUpdateManualLine(idx, 'notes', e.target.value)}
                                                    className="h-9 text-xs"
                                                />
                                            </div>

                                            <Button 
                                                type="button" 
                                                variant="ghost" 
                                                size="icon" 
                                                onClick={() => handleRemoveManualLine(idx)}
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50/50 shrink-0 self-end sm:self-center"
                                            >
                                                <Trash className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}

                                    <Button 
                                        type="button" 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={handleAddManualLine}
                                        className="gap-1.5"
                                    >
                                        <Plus className="h-3.5 w-3.5" /> Agregar Partida
                                    </Button>
                                </div>

                                <div className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg gap-3 ${
                                    isManualBalanced 
                                        ? 'bg-green-50 border-green-200 text-green-800' 
                                        : 'bg-amber-50 border-amber-200 text-amber-800'
                                }`}>
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        {isManualBalanced ? (
                                            <>
                                                <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                                                <span>Asiento Balanceado Correctamente</span>
                                            </>
                                        ) : (
                                            <>
                                                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                                                <span>Asiento Fuera de Balance</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-5 text-sm font-mono font-bold">
                                        <div>Total Debe: <span className="text-green-600">${totalManualDebit.toFixed(2)}</span></div>
                                        <div>Total Haber: <span className="text-red-500">${totalManualCredit.toFixed(2)}</span></div>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setIsEditEntryModalOpen(false)}>Cancelar</Button>
                                <Button 
                                    onClick={handleUpdateJournalEntry} 
                                    disabled={!isManualBalanced || isSubmittingManual}
                                >
                                    {isSubmittingManual ? "Guardando..." : "Actualizar Asiento"}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </TabsContent>

                {/* Plan de Cuentas Tab */}
                <TabsContent value="chartOfAccounts" className="space-y-4">
                    <Card className="border border-slate-100 shadow-sm">
                        <CardHeader className="flex flex-row items-center justify-between">
                            <div>
                                <CardTitle>Plan de Cuentas Contable</CardTitle>
                                <CardDescription>Catálogo de cuentas configuradas en WSM SportsERP con saldos consolidados acumulados.</CardDescription>
                            </div>
                            <Button onClick={() => {
                                setAccountForm({ code: "", name: "", type: "asset", active: true, isEdit: false })
                                setIsAccountModalOpen(true)
                            }} className="gap-2">
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
                                            const typeLabelMap: Record<string, string> = {
                                                asset: "Activo",
                                                liability: "Pasivo",
                                                equity: "Patrimonio Neto",
                                                revenue: "Ingreso / Ganancia",
                                                expense: "Egreso / Pérdida"
                                            };
                                            return (
                                                <TableRow key={account.code}>
                                                    <TableCell className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">{account.code}</TableCell>
                                                    <TableCell className="font-semibold text-slate-800 dark:text-slate-200">{account.name}</TableCell>
                                                    <TableCell className="text-xs">
                                                        <span className={`px-2 py-0.5 rounded-full font-semibold ${
                                                            account.type === 'asset' ? 'bg-green-100 text-green-800' :
                                                            account.type === 'liability' ? 'bg-red-100 text-red-800' :
                                                            account.type === 'equity' ? 'bg-purple-100 text-purple-800' :
                                                            account.type === 'revenue' ? 'bg-blue-100 text-blue-800' :
                                                            'bg-amber-100 text-amber-800'
                                                        }`}>
                                                            {typeLabelMap[account.type] || account.type}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right font-medium text-slate-600">${account.total_debit.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-medium text-slate-600">${account.total_credit.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right font-bold text-slate-900 dark:text-slate-100">${account.balance.toFixed(2)}</TableCell>
                                                    <TableCell className="text-center">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" className="h-8 w-8 p-0">
                                                                    <MoreHorizontal className="h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end">
                                                                <DropdownMenuItem onClick={() => {
                                                                    setAccountForm({
                                                                        code: account.code,
                                                                        name: account.name,
                                                                        type: account.type,
                                                                        active: account.active,
                                                                        isEdit: true
                                                                    })
                                                                    setIsAccountModalOpen(true)
                                                                }}>
                                                                    <Edit className="mr-2 h-4 w-4" /> Editar
                                                                </DropdownMenuItem>
                                                                <DropdownMenuItem className="text-red-600 focus:text-red-600" onClick={() => handleDeleteAccount(account.code)}>
                                                                    <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                                                                </DropdownMenuItem>
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <Dialog open={isAccountModalOpen} onOpenChange={setIsAccountModalOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{accountForm.isEdit ? "Editar Cuenta Contable" : "Nueva Cuenta Contable"}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Código</label>
                                <Input 
                                    placeholder="Ej: 1.1.01" 
                                    value={accountForm.code} 
                                    onChange={e => setAccountForm({ ...accountForm, code: e.target.value })}
                                    disabled={accountForm.isEdit}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Nombre de la Cuenta</label>
                                <Input 
                                    placeholder="Ej: Caja General" 
                                    value={accountForm.name} 
                                    onChange={e => setAccountForm({ ...accountForm, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Tipo</label>
                                <Select 
                                    value={accountForm.type} 
                                    onValueChange={val => setAccountForm({ ...accountForm, type: val })}
                                    disabled={accountForm.isEdit}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="asset">Activo</SelectItem>
                                        <SelectItem value="liability">Pasivo</SelectItem>
                                        <SelectItem value="equity">Patrimonio Neto</SelectItem>
                                        <SelectItem value="revenue">Ingreso / Ganancia</SelectItem>
                                        <SelectItem value="expense">Egreso / Pérdida</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center gap-2 pt-2">
                                <input 
                                    type="checkbox" 
                                    id="accountActive"
                                    checked={accountForm.active} 
                                    onChange={e => setAccountForm({ ...accountForm, active: e.target.checked })}
                                    className="h-4 w-4"
                                />
                                <label htmlFor="accountActive" className="text-sm">Cuenta Activa</label>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsAccountModalOpen(false)}>Cancelar</Button>
                            <Button onClick={handleSaveAccount}>Guardar Cuenta</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                {/* Balance de Sumas y Saldos Tab */}
                <TabsContent value="trialBalance" className="space-y-4">
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
                                                <TableCell className="font-semibold text-slate-800 dark:text-slate-200">{item.name}</TableCell>
                                                <TableCell className={`text-right font-semibold ${item.initial_balance >= 0 ? 'text-slate-600' : 'text-red-500'}`}>
                                                    ${item.initial_balance.toFixed(2)}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold text-green-600">${item.debit.toFixed(2)}</TableCell>
                                                <TableCell className="text-right font-semibold text-red-500">${item.credit.toFixed(2)}</TableCell>
                                                <TableCell className={`text-right font-bold ${item.final_balance >= 0 ? 'text-slate-900 dark:text-slate-100' : 'text-red-500'}`}>
                                                    ${item.final_balance.toFixed(2)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Estado de Resultados Tab */}
                <TabsContent value="incomeStatement" className="space-y-4">
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
                                                {incomeStatement.revenues.map(item => (
                                                    <TableRow key={item.code} className="hover:bg-transparent border-green-500/10">
                                                        <TableCell className="text-sm font-semibold">{item.name}</TableCell>
                                                        <TableCell className="text-right font-bold text-green-600">${item.balance.toFixed(2)}</TableCell>
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
                                                {incomeStatement.expenses.map(item => (
                                                    <TableRow key={item.code} className="hover:bg-transparent border-red-500/10">
                                                        <TableCell className="text-sm font-semibold">{item.name}</TableCell>
                                                        <TableCell className="text-right font-bold text-red-500">-${item.balance.toFixed(2)}</TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {/* Final Profit */}
                                    <div className={`rounded-lg p-5 border text-center ${
                                        incomeStatement.net_result >= 0 
                                            ? 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400' 
                                            : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400'
                                    }`}>
                                        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500">Resultado Neto del Ejercicio</h4>
                                        <div className="text-4xl font-extrabold mt-1">
                                            ${incomeStatement.net_result.toFixed(2)}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-2">
                                            {incomeStatement.net_result >= 0 ? "Utilidad neta positiva devengada" : "Pérdida neta acumulada en el período"}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-center text-slate-400 py-6">Calculando estructura contable...</p>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Asiento Manual Tab */}
                <TabsContent value="manualEntry" className="space-y-4">
                    <Card className="border border-slate-100 shadow-sm">
                        <CardHeader>
                            <CardTitle>Carga de Asiento Manual</CardTitle>
                            <CardDescription>Carga ajustes fiscales, devengamientos o reclasificaciones con balanceo dinámico.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-6 max-w-4xl">
                                <div className="grid gap-4 sm:grid-cols-3">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Fecha del Asiento</label>
                                        <Input 
                                            type="date" 
                                            value={manualDate} 
                                            onChange={e => setManualDate(e.target.value)} 
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Concepto / Glosa General</label>
                                        <Input 
                                            placeholder="Ej: Ajuste de fin de mes, devengamiento de tasas..." 
                                            value={manualDesc} 
                                            onChange={e => setManualDesc(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase block">Partidas del Asiento</label>
                                    
                                    {manualLines.map((line, idx) => (
                                        <div key={idx} className="flex flex-col gap-2 p-3 border rounded-lg sm:flex-row sm:items-center sm:gap-3 bg-slate-50/50">
                                            <div className="w-full sm:w-1/3">
                                                <Select 
                                                    value={line.account_code} 
                                                    onValueChange={val => handleUpdateManualLine(idx, 'account_code', val)}
                                                >
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Seleccionar Cuenta" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {chartAccounts.map(acc => (
                                                            <SelectItem key={acc.code} value={acc.code}>
                                                                <span className="font-mono text-xs mr-2 text-slate-400">{acc.code}</span>
                                                                {acc.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                            <div className="w-full sm:w-40 flex items-center gap-1.5 bg-white dark:bg-slate-900 border rounded px-2 h-9">
                                                <span className="text-slate-400 text-xs font-bold">$</span>
                                                <input 
                                                    type="number" 
                                                    placeholder="Debe" 
                                                    value={line.debit || ""} 
                                                    onChange={e => handleUpdateManualLine(idx, 'debit', e.target.value)} 
                                                    className="w-full text-right outline-none text-xs font-bold text-green-600 bg-transparent"
                                                />
                                            </div>

                                            <div className="w-full sm:w-40 flex items-center gap-1.5 bg-white dark:bg-slate-900 border rounded px-2 h-9">
                                                <span className="text-slate-400 text-xs font-bold">$</span>
                                                <input 
                                                    type="number" 
                                                    placeholder="Haber" 
                                                    value={line.credit || ""} 
                                                    onChange={e => handleUpdateManualLine(idx, 'credit', e.target.value)} 
                                                    className="w-full text-right outline-none text-xs font-bold text-red-500 bg-transparent"
                                                />
                                            </div>

                                            <div className="w-full sm:flex-1">
                                                <Input 
                                                    placeholder="Detalle línea..." 
                                                    value={line.notes} 
                                                    onChange={e => handleUpdateManualLine(idx, 'notes', e.target.value)}
                                                    className="h-9 text-xs"
                                                />
                                            </div>

                                            <Button 
                                                type="button" 
                                                variant="ghost" 
                                                size="icon" 
                                                onClick={() => handleRemoveManualLine(idx)}
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50/50 shrink-0 self-end sm:self-center"
                                            >
                                                <Trash className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}

                                    <Button 
                                        type="button" 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={handleAddManualLine}
                                        className="gap-1.5"
                                    >
                                        <Plus className="h-3.5 w-3.5" /> Agregar Partida
                                    </Button>
                                </div>

                                {/* Sums & balance banner */}
                                <div className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 border rounded-lg gap-3 ${
                                    isManualBalanced 
                                        ? 'bg-green-50 border-green-200 text-green-800' 
                                        : 'bg-amber-50 border-amber-200 text-amber-800'
                                }`}>
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        {isManualBalanced ? (
                                            <>
                                                <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                                                <span>Asiento Balanceado Correctamente</span>
                                            </>
                                        ) : (
                                            <>
                                                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                                                <span>Asiento Fuera de Balance (La suma del Debe y Haber debe ser igual y mayor a 0)</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-5 text-sm font-mono font-bold">
                                        <div>Total Debe: <span className="text-green-600">${totalManualDebit.toFixed(2)}</span></div>
                                        <div>Total Haber: <span className="text-red-500">${totalManualCredit.toFixed(2)}</span></div>
                                    </div>
                                </div>

                                <div className="flex justify-end pt-2">
                                    <Button 
                                        onClick={handleSaveManualEntry} 
                                        disabled={!isManualBalanced || isSubmittingManual}
                                        className="w-full sm:w-auto"
                                    >
                                        {isSubmittingManual ? "Guardando..." : "Confirmar y Registrar Asiento"}
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
