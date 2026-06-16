import { useState, useEffect, useCallback } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { api, type BalanceSheetResponse } from "@/services/api"
import type { QueryParams } from "@/types/api"
import type { Transaction } from "@/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { 
    Download, 
    BookOpen, 
    FileSpreadsheet, 
    Layers, 
    PieChart, 
    Plus, 
    ArrowUpRight, 
    ArrowDownRight, 
    Scale
} from "lucide-react"
import { showErrorToast } from "@/lib/errorHandling"
import { toast } from "sonner"

// Types
import type { ChartAccount, JournalEntry, TrialBalanceItem, IncomeStatementData } from "@/types/accounting"

// Extracted Components
import { AccountingSummaryCards } from "@/components/accounting/AccountingSummaryCards"
import { ChartOfAccountsTab } from "@/components/accounting/ChartOfAccountsTab"
import { JournalEntriesTab } from "@/components/accounting/JournalEntriesTab"
import { TrialBalanceTab } from "@/components/accounting/TrialBalanceTab"
import { IncomeStatementTab } from "@/components/accounting/IncomeStatementTab"
import { BalanceSheetTab } from "@/components/accounting/BalanceSheetTab"
import { JournalEntryFormDialog } from "@/components/accounting/JournalEntryFormDialog"
import { AccountFormDialog } from "@/components/accounting/AccountFormDialog"
import { JournalEntryForm } from "@/components/accounting/JournalEntryForm"

export default function AccountingPage() {
    const [transactions, setTransactions] = useState<Transaction[]>([])
    const [chartAccounts, setChartAccounts] = useState<ChartAccount[]>([])
    const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([])
    const [trialBalance, setTrialBalance] = useState<TrialBalanceItem[]>([])
    const [incomeStatement, setIncomeStatement] = useState<IncomeStatementData | null>(null)
    const [balanceSheet, setBalanceSheet] = useState<BalanceSheetResponse | null>(null)
    
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
            const filters: QueryParams = {}
            if (startDate) filters.start_date = startDate
            if (endDate) filters.end_date = endDate

            const [
                txData, 
                accountsData, 
                journalData, 
                balanceData, 
                incomeData,
                balanceSheetData
            ] = await Promise.all([
                api.getTransactions(filters),
                api.getChartOfAccounts(),
                api.getJournalEntries(filters),
                api.getTrialBalance(filters),
                api.getIncomeStatement(filters),
                api.getBalanceSheet(filters)
            ])

            setTransactions(txData)
            setChartAccounts(accountsData)
            setJournalEntries(journalData)
            setTrialBalance(balanceData)
            setIncomeStatement(incomeData)
            setBalanceSheet(balanceSheetData)
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

    function handleUpdateManualLine(index: number, key: "account_code" | "debit" | "credit" | "notes", value: string | number) {
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
        const rows: Array<Array<string | number>> = [];

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

    function exportBalanceSheetCSV() {
        if (!balanceSheet) {
            toast.warning("No hay datos de balance para exportar.");
            return;
        }

        const headers = ["Categoría / Cuenta", "Código", "Saldo ($)"];
        const rows: Array<Array<string | number>> = [];

        // Activo Corriente
        rows.push(["ACTIVO CORRIENTE", "", ""]);
        for (const item of balanceSheet.assets.corriente) {
            rows.push([item.name, item.code, item.balance]);
        }
        rows.push(["Total Activo Corriente", "", balanceSheet.assets.corriente.reduce((acc, item) => acc + item.balance, 0)]);
        rows.push(["", "", ""]);

        // Activo No Corriente
        rows.push(["ACTIVO NO CORRIENTE", "", ""]);
        for (const item of balanceSheet.assets.no_corriente) {
            rows.push([item.name, item.code, item.balance]);
        }
        rows.push(["Total Activo No Corriente", "", balanceSheet.assets.no_corriente.reduce((acc, item) => acc + item.balance, 0)]);
        rows.push(["TOTAL ACTIVO", "", balanceSheet.totals.total_assets]);
        rows.push(["", "", ""]);

        // Pasivo Corriente
        rows.push(["PASIVO CORRIENTE", "", ""]);
        for (const item of balanceSheet.liabilities.corriente) {
            rows.push([item.name, item.code, item.balance]);
        }
        rows.push(["Total Pasivo Corriente", "", balanceSheet.liabilities.corriente.reduce((acc, item) => acc + item.balance, 0)]);
        rows.push(["", "", ""]);

        // Pasivo No Corriente
        rows.push(["PASIVO NO CORRIENTE", "", ""]);
        for (const item of balanceSheet.liabilities.no_corriente) {
            rows.push([item.name, item.code, item.balance]);
        }
        rows.push(["Total Pasivo No Corriente", "", balanceSheet.liabilities.no_corriente.reduce((acc, item) => acc + item.balance, 0)]);
        rows.push(["TOTAL PASIVO", "", balanceSheet.totals.total_liabilities]);
        rows.push(["", "", ""]);

        // Patrimonio Neto
        rows.push(["PATRIMONIO NETO", "", ""]);
        for (const item of balanceSheet.equity.items) {
            rows.push([item.name, item.code, item.balance]);
        }
        rows.push(["TOTAL PATRIMONIO NETO", "", balanceSheet.totals.total_equity]);
        rows.push(["", "", ""]);

        rows.push(["TOTAL PASIVO + PATRIMONIO NETO", "", balanceSheet.totals.total_liabilities_and_equity]);
        rows.push(["Diferencia de Balance", "", balanceSheet.totals.discrepancy]);

        const csvContent =
            "\uFEFF" +
            [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");

        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `balance_general_sports_erp_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("¡Balance General (RT 9) exportado con éxito!");
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
                    type: accountForm.type as "asset" | "liability" | "equity" | "revenue" | "expense",
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
                        <Scale className="h-4 w-4 text-rose-500" />
                        Estado de Resultados
                    </TabsTrigger>
                    <TabsTrigger value="balanceSheet" className="gap-2 shrink-0">
                        <Scale className="h-4 w-4 text-cyan-500" />
                        Balance General
                    </TabsTrigger>
                    <TabsTrigger value="manualEntry" className="gap-2 shrink-0 bg-primary/5 hover:bg-primary/10 text-primary border border-primary/20">
                        <Plus className="h-4 w-4" />
                        Asiento Manual
                    </TabsTrigger>
                </TabsList>

                {/* Dashboard / Cash Flow Tab */}
                <TabsContent value="dashboard" className="space-y-4">
                    <AccountingSummaryCards
                        totalIncome={totalIncome}
                        totalExpenses={totalExpenses}
                        netProfit={netProfit}
                    />

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
                    <JournalEntriesTab
                        journalEntries={journalEntries}
                        onEditEntry={openEditEntryModal}
                        onReverseEntry={handleReverseJournalEntry}
                        onDeleteEntry={handleDeleteJournalEntry}
                    />

                    <JournalEntryFormDialog
                        isOpen={isEditEntryModalOpen}
                        onOpenChange={(open) => {
                            setIsEditEntryModalOpen(open)
                            if (!open) resetManualForm()
                        }}
                        date={manualDate}
                        onDateChange={setManualDate}
                        description={manualDesc}
                        onDescriptionChange={setManualDesc}
                        lines={manualLines}
                        chartAccounts={chartAccounts}
                        onUpdateLine={handleUpdateManualLine}
                        onAddLine={handleAddManualLine}
                        onRemoveLine={handleRemoveManualLine}
                        totalDebit={totalManualDebit}
                        totalCredit={totalManualCredit}
                        isBalanced={isManualBalanced}
                        isSubmitting={isSubmittingManual}
                        onSubmit={handleUpdateJournalEntry}
                    />
                </TabsContent>

                {/* Plan de Cuentas Tab */}
                <TabsContent value="chartOfAccounts" className="space-y-4">
                    <ChartOfAccountsTab
                        chartAccounts={chartAccounts}
                        onNewAccount={() => {
                            setAccountForm({ code: "", name: "", type: "asset", active: true, isEdit: false })
                            setIsAccountModalOpen(true)
                        }}
                        onEditAccount={(account) => {
                            setAccountForm({
                                code: account.code,
                                name: account.name,
                                type: account.type,
                                active: account.active,
                                isEdit: true
                            })
                            setIsAccountModalOpen(true)
                        }}
                        onDeleteAccount={handleDeleteAccount}
                    />

                    <AccountFormDialog
                        isOpen={isAccountModalOpen}
                        onOpenChange={setIsAccountModalOpen}
                        form={accountForm}
                        onChange={setAccountForm}
                        onSave={handleSaveAccount}
                    />
                </TabsContent>

                {/* Balance de Sumas y Saldos Tab */}
                <TabsContent value="trialBalance" className="space-y-4">
                    <TrialBalanceTab trialBalance={trialBalance} />
                </TabsContent>

                {/* Estado de Resultados Tab */}
                <TabsContent value="incomeStatement" className="space-y-4">
                    <IncomeStatementTab incomeStatement={incomeStatement} />
                </TabsContent>

                {/* Balance General Tab */}
                <TabsContent value="balanceSheet" className="space-y-4">
                    <BalanceSheetTab
                        balanceSheet={balanceSheet}
                        onExportCSV={exportBalanceSheetCSV}
                    />
                </TabsContent>

                {/* Asiento Manual Tab */}
                <TabsContent value="manualEntry" className="space-y-4">
                    <Card className="border border-slate-100 shadow-sm">
                        <CardHeader>
                            <CardTitle>Carga de Asiento Manual</CardTitle>
                            <CardDescription>Carga ajustes fiscales, devengamientos o reclasificaciones con balanceo dinámico.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <JournalEntryForm
                                date={manualDate}
                                onDateChange={setManualDate}
                                description={manualDesc}
                                onDescriptionChange={setManualDesc}
                                lines={manualLines}
                                chartAccounts={chartAccounts}
                                onUpdateLine={handleUpdateManualLine}
                                onAddLine={handleAddManualLine}
                                onRemoveLine={handleRemoveManualLine}
                                totalDebit={totalManualDebit}
                                totalCredit={totalManualCredit}
                                isBalanced={isManualBalanced}
                                isSubmitting={isSubmittingManual}
                                onSubmit={handleSaveManualEntry}
                                submitLabel="Confirmar y Registrar Asiento"
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
