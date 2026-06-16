import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { api, type SupplierInvoiceResponse } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { 
    Wallet, 
    TrendingUp, 
    TrendingDown, 
    Printer, 
    ArrowLeftRight, 
    FileText,
    BadgeAlert
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Client, Supplier, Transaction } from "@/types";
import type { Invoice } from "@/types/api";
import { Label } from "@/components/ui/label";

type AccountType = "client" | "supplier";

type UnifiedMovement = {
    id: string;
    date: string;
    type: "invoice" | "payment" | "credit_note" | "return" | "adjustment";
    typeLabel: string;
    reference: string;
    description: string;
    debit: number;   // Aumenta saldo (Clientes) / Disminuye saldo (Proveedores)
    credit: number;  // Disminuye saldo (Clientes) / Aumenta saldo (Proveedores)
};

const formatMoney = (value: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value || 0));
};

export default function CurrentAccountsPage() {
    const [accountType, setAccountType] = useState<AccountType>("client");
    const [selectedClientId, setSelectedClientId] = useState<string>("");
    const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");

    // ==================== DATA FETCHING ====================
    // 1. Fetch Clients
    const { data: clients = [] } = useQuery<Client[]>({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    });

    // 2. Fetch Suppliers
    const { data: suppliers = [] } = useQuery<Supplier[]>({
        queryKey: queryKeys.suppliers.all,
        queryFn: () => api.getSuppliers(),
    });

    // 3. Fetch Client Specific Data (Enabled only when selectedClientId is set)
    const { data: clientInvoices = [] } = useQuery<Invoice[]>({
        queryKey: ["current-accounts", "client-invoices", selectedClientId],
        queryFn: () => api.getInvoices({ client_id: selectedClientId }),
        enabled: accountType === "client" && !!selectedClientId,
    });

    const { data: clientCreditNotes = [] } = useQuery({
        queryKey: ["current-accounts", "client-credit-notes", selectedClientId],
        queryFn: () => api.getCreditNotes({ client_id: selectedClientId }),
        enabled: accountType === "client" && !!selectedClientId,
    });

    const { data: clientTransactions = [] } = useQuery<Transaction[]>({
        queryKey: ["current-accounts", "client-transactions", selectedClientId],
        queryFn: () => api.getTransactions({ client_id: selectedClientId }),
        enabled: accountType === "client" && !!selectedClientId,
    });

    const { data: clientReturns = [] } = useQuery({
        queryKey: ["current-accounts", "client-returns", selectedClientId],
        queryFn: () => api.getClientReturns({ client_id: selectedClientId }),
        enabled: accountType === "client" && !!selectedClientId,
    });

    // 4. Fetch Supplier Specific Data (Enabled only when selectedSupplierId is set)
    const { data: supplierInvoices = [] } = useQuery({
        queryKey: ["current-accounts", "supplier-invoices", selectedSupplierId],
        queryFn: () => api.getSupplierInvoices({ supplier_id: selectedSupplierId }),
        enabled: accountType === "supplier" && !!selectedSupplierId,
    });

    const { data: supplierPayments = [] } = useQuery({
        queryKey: ["current-accounts", "supplier-payments", selectedSupplierId],
        queryFn: () => api.getSupplierPayments(selectedSupplierId),
        enabled: accountType === "supplier" && !!selectedSupplierId,
    });

    const { data: supplierReturns = [] } = useQuery({
        queryKey: ["current-accounts", "supplier-returns", selectedSupplierId],
        queryFn: () => api.getSupplierReturns({ supplier_id: selectedSupplierId }),
        enabled: accountType === "supplier" && !!selectedSupplierId,
    });

    const { data: supplierTransactions = [] } = useQuery<Transaction[]>({
        queryKey: ["current-accounts", "supplier-transactions", selectedSupplierId],
        queryFn: () => api.getTransactions({ supplier_id: selectedSupplierId }),
        enabled: accountType === "supplier" && !!selectedSupplierId,
    });

    // ==================== COMPUTATIONS ====================

    const selectedClient = useMemo(() => {
        return clients.find(c => c.id === selectedClientId) || null;
    }, [clients, selectedClientId]);

    const selectedSupplier = useMemo(() => {
        return suppliers.find(s => s.id === selectedSupplierId) || null;
    }, [suppliers, selectedSupplierId]);

    // Parse and unify movements for Client
    const clientMovements = useMemo<UnifiedMovement[]>(() => {
        if (!selectedClientId) return [];

        const creditNoteIds = new Set(clientCreditNotes.map(cn => String(cn.id || "")));

        const invoiceRows: UnifiedMovement[] = clientInvoices.map(inv => ({
            id: String(inv.id),
            date: String(inv.issue_date || inv.created_at || new Date().toISOString()),
            type: "invoice",
            typeLabel: "Factura Venta",
            reference: String(inv.invoice_number || inv.id),
            description: `Factura de Venta ${inv.invoice_type || "B"}-${inv.invoice_number || ""}`,
            debit: Number(inv.total_amount || 0),
            credit: 0
        }));

        const creditRows: UnifiedMovement[] = clientCreditNotes.map(cn => ({
            id: String(cn.id),
            date: String(cn.created_at || new Date().toISOString()),
            type: "credit_note",
            typeLabel: "Nota de Crédito",
            reference: String(cn.number || cn.id),
            description: `Nota de Crédito por Devolución/Ajuste`,
            debit: 0,
            credit: Math.abs(Number(cn.amount || 0))
        }));

        const returnRows: UnifiedMovement[] = clientReturns
            .filter(ret => ret.status === "approved" && !ret.credit_note_id) // Avoid duplicate credit note impact
            .map(ret => ({
                id: String(ret.id),
                date: String(ret.created_at || new Date().toISOString()),
                type: "return",
                typeLabel: "Devolución Cliente",
                reference: String(ret.return_number || ret.id),
                description: `Devolución de mercadería (${ret.reason || "Sin motivo"})`,
                debit: 0,
                credit: Number(ret.total_amount || 0)
            }));

        const transactionRows: UnifiedMovement[] = clientTransactions.flatMap((tx): UnifiedMovement[] => {
            const txType = String(tx.type || "").toLowerCase();
            const amount = Number(tx.amount || 0);
            const refId = String(tx.reference_id || "");

            // Skip if linked to a credit note to avoid double impact
            if (txType === "adjustment" && refId && creditNoteIds.has(refId)) {
                return [];
            }

            if (txType === "sale") {
                return [{
                    id: String(tx.id),
                    date: String(tx.date || new Date().toISOString()),
                    type: "payment" as const,
                    typeLabel: "Cobro (Recibo)",
                    reference: refId || String(tx.id),
                    description: tx.description || "Cobro registrado",
                    debit: 0,
                    credit: Math.abs(amount)
                }];
            }

            if (txType === "adjustment") {
                return [{
                    id: String(tx.id),
                    date: String(tx.date || new Date().toISOString()),
                    type: "adjustment" as const,
                    typeLabel: "Ajuste de Saldo",
                    reference: String(tx.id),
                    description: tx.description || "Ajuste manual de cuenta corriente",
                    debit: amount > 0 ? amount : 0,
                    credit: amount < 0 ? Math.abs(amount) : 0
                }];
            }

            return [];
        });

        // Combine and sort oldest to newest for cumulative calculations
        const combined = [...invoiceRows, ...creditRows, ...returnRows, ...transactionRows].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        return combined;
    }, [selectedClientId, clientInvoices, clientCreditNotes, clientReturns, clientTransactions]);

    // Parse and unify movements for Supplier
    const supplierMovements = useMemo<UnifiedMovement[]>(() => {
        if (!selectedSupplierId) return [];

        const paymentIds = new Set(supplierPayments.map(p => String(p.id || "")));

        const invoiceRows: UnifiedMovement[] = supplierInvoices.map(inv => ({
            id: String(inv.id),
            date: String(inv.issue_date || inv.created_at || new Date().toISOString()),
            type: "invoice",
            typeLabel: "Factura Compra",
            reference: String(inv.invoice_number || inv.id),
            description: `Factura de Proveedor ${inv.invoice_type || "A"}-${inv.invoice_number || ""}`,
            debit: 0,
            credit: Number(inv.total_amount || 0) // Increases what we owe
        }));

        const paymentRows: UnifiedMovement[] = supplierPayments.map(p => ({
            id: String(p.id),
            date: String(p.payment_date || new Date().toISOString()),
            type: "payment",
            typeLabel: "Pago Registrado",
            reference: String(p.reference_number || p.id),
            description: p.notes || "Pago a cuenta corriente",
            debit: Number(p.amount || 0), // Decreases what we owe
            credit: 0
        }));

        const returnRows: UnifiedMovement[] = supplierReturns.map(ret => ({
            id: String(ret.id),
            date: String(ret.created_at || new Date().toISOString()),
            type: "return",
            typeLabel: "Devolución a Proveedor",
            reference: String(ret.return_number || ret.id),
            description: `Devolución a proveedor (${ret.notes || "Sin notas"})`,
            debit: Number(ret.total_amount || 0), // Decreases what we owe
            credit: 0
        }));

        const transactionRows: UnifiedMovement[] = supplierTransactions.flatMap((tx): UnifiedMovement[] => {
            const txType = String(tx.type || "").toLowerCase();
            const amount = Number(tx.amount || 0);
            const refId = String(tx.reference_id || "");

            // Skip if already tracked as a supplier payment to avoid double count
            if (refId && paymentIds.has(refId)) {
                return [];
            }

            // Adjustments or expenses not covered by supplier payments table
            if (txType === "expense") {
                return [{
                    id: String(tx.id),
                    date: String(tx.date || new Date().toISOString()),
                    type: "payment" as const,
                    typeLabel: "Egreso / Transacción",
                    reference: refId || String(tx.id),
                    description: tx.description || "Pago / Gasto registrado",
                    debit: Math.abs(amount),
                    credit: 0
                }];
            }

            if (txType === "adjustment") {
                return [{
                    id: String(tx.id),
                    date: String(tx.date || new Date().toISOString()),
                    type: "adjustment" as const,
                    typeLabel: "Ajuste de Saldo",
                    reference: String(tx.id),
                    description: tx.description || "Ajuste manual de cuenta corriente",
                    debit: amount < 0 ? Math.abs(amount) : 0, // Debit decreases our liability
                    credit: amount > 0 ? amount : 0  // Credit increases our liability
                }];
            }

            return [];
        });

        // Combine and sort oldest to newest for cumulative calculations
        const combined = [...invoiceRows, ...paymentRows, ...returnRows, ...transactionRows].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        return combined;
    }, [selectedSupplierId, supplierInvoices, supplierPayments, supplierReturns, supplierTransactions]);

    // Calculate Running Balance (oldest to newest, then reverse for display)
    const ledgerMovements = useMemo(() => {
        const source = accountType === "client" ? clientMovements : supplierMovements;
        const calculated: Array<UnifiedMovement & { balanceAfter: number }> = [];
        let runningBalance = 0;

        for (const mov of source) {
            if (accountType === "client") {
                // Client: Debit (+), Credit (-)
                runningBalance = runningBalance + mov.debit - mov.credit;
            } else {
                // Supplier: Credit (+ what we owe), Debit (- what we paid)
                runningBalance = runningBalance + mov.credit - mov.debit;
            }
            calculated.push({
                ...mov,
                balanceAfter: runningBalance
            });
        }

        // Reverse to show most recent first
        return [...calculated].reverse();
    }, [accountType, clientMovements, supplierMovements]);

    // KPI Summary calculations
    const summaryKPI = useMemo(() => {
        const source = accountType === "client" ? clientMovements : supplierMovements;
        let totalBilled = 0;
        let totalPaid = 0;
        let totalCredits = 0;

        for (const mov of source) {
            if (mov.type === "invoice") {
                totalBilled += accountType === "client" ? mov.debit : mov.credit;
            } else if (mov.type === "payment") {
                totalPaid += accountType === "client" ? mov.credit : mov.debit;
            } else if (mov.type === "credit_note" || mov.type === "return") {
                totalCredits += accountType === "client" ? mov.credit : mov.debit;
            }
        }

        const currentBalance = accountType === "client" 
            ? (selectedClient?.current_account_balance ?? 0)
            : (selectedSupplier?.account_balance ?? 0);

        return {
            totalBilled,
            totalPaid,
            totalCredits,
            currentBalance
        };
    }, [accountType, clientMovements, supplierMovements, selectedClient, selectedSupplier]);

    // Filtered Invoices (Pending / Unpaid)
    const pendingDocuments = useMemo(() => {
        if (accountType === "client") {
            const paidMap = new Map<string, number>();
            for (const tx of clientTransactions) {
                if (String(tx.type).toLowerCase() === "sale" && tx.reference_id) {
                    paidMap.set(tx.reference_id, (paidMap.get(tx.reference_id) || 0) + Number(tx.amount || 0));
                }
            }

            return clientInvoices.map(inv => {
                const paid = paidMap.get(inv.id) || 0;
                const pending = Number(inv.total_amount || 0) - paid;
                return {
                    id: inv.id,
                    number: `${inv.invoice_type || "B"}-${inv.invoice_number || ""}`,
                    date: inv.issue_date || inv.created_at || "",
                    dueDate: inv.due_date || "",
                    total: Number(inv.total_amount || 0),
                    paid,
                    pending: Math.max(0, pending),
                    status: inv.status || "issued"
                };
            }).filter(d => d.pending > 0.01 && d.status !== "cancelled");
        } else {
            // For Suppliers
            const paidMap = new Map<string, number>();
            for (const p of supplierPayments) {
                if (p.supplier_invoice_id) {
                    paidMap.set(p.supplier_invoice_id, (paidMap.get(p.supplier_invoice_id) || 0) + Number(p.amount || 0));
                }
            }

            return supplierInvoices.map((inv: SupplierInvoiceResponse) => {
                const paid = paidMap.get(inv.id) || 0;
                const pending = Number(inv.total_amount || 0) - paid;
                return {
                    id: inv.id,
                    number: `${inv.invoice_type || "A"}-${inv.invoice_number || ""}`,
                    date: inv.issue_date || inv.created_at || "",
                    dueDate: inv.due_date || "",
                    total: Number(inv.total_amount || 0),
                    paid,
                    pending: Math.max(0, pending),
                    status: inv.status || "approved"
                };
            }).filter(d => d.pending > 0.01 && d.status !== "cancelled");
        }
    }, [accountType, clientInvoices, clientTransactions, supplierInvoices, supplierPayments]);

    // Handle Document Printing
    const handlePrintStatement = () => {
        window.print();
    };

    const isAccountSelected = accountType === "client" ? !!selectedClientId : !!selectedSupplierId;

    return (
        <>
            {/* Screen view content */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 print:hidden">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                            Cuentas Corrientes y Conciliación
                        </h1>
                        <p className="text-slate-400 mt-1">
                            Consulta el historial de movimientos de crédito/débito, facturas pendientes y saldos de clientes y proveedores.
                        </p>
                    </div>
                    {isAccountSelected && (
                        <Button 
                            onClick={handlePrintStatement}
                            className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                        >
                            <Printer className="h-4 w-4 mr-2" /> Imprimir Resumen
                        </Button>
                    )}
                </div>

                {/* Paso 1: Seleccionar Tipo de Cuenta y Entidad */}
                <Card className="bg-slate-900/40 backdrop-blur border-slate-800">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-lg font-semibold text-slate-200">
                            Filtros de Búsqueda
                        </CardTitle>
                        <CardDescription>
                            Seleccione el tipo de cuenta corriente y luego el cliente o proveedor para visualizar.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-slate-400 text-xs">Tipo de Cuenta</Label>
                            <Select 
                                value={accountType} 
                                onValueChange={(val: AccountType) => {
                                    setAccountType(val);
                                    setSelectedClientId("");
                                    setSelectedSupplierId("");
                                }}
                            >
                                <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                                    <SelectItem value="client" className="focus:bg-blue-600/30">Clientes (Ventas / Cuenta Corriente)</SelectItem>
                                    <SelectItem value="supplier" className="focus:bg-blue-600/30">Proveedores (Compras / Cuenta Corriente)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="md:col-span-2 space-y-1.5">
                            <Label className="text-slate-400 text-xs">
                                {accountType === "client" ? "Seleccione el Cliente" : "Seleccione el Proveedor"}
                            </Label>
                            {accountType === "client" ? (
                                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                                    <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                                        <SelectValue placeholder="Seleccione un cliente..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                                        {clients.length === 0 ? (
                                            <div className="py-2 text-center text-sm text-slate-500">No hay clientes registrados</div>
                                        ) : (
                                            clients.map(c => (
                                                <SelectItem key={c.id} value={c.id} className="focus:bg-blue-600/30">
                                                    {c.name} (Saldo: {formatMoney(c.current_account_balance)} | CUIT/DNI: {c.tax_id || "-"})
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                                    <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200">
                                        <SelectValue placeholder="Seleccione un proveedor..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                                        {suppliers.length === 0 ? (
                                            <div className="py-2 text-center text-sm text-slate-500">No hay proveedores registrados</div>
                                        ) : (
                                            suppliers.map(s => (
                                                <SelectItem key={s.id} value={s.id} className="focus:bg-blue-600/30">
                                                    {s.name} (Saldo: {formatMoney(s.account_balance)} | CUIT/DNI: {s.tax_id || "-"})
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {isAccountSelected ? (
                    <>
                        {/* KPI Cards */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <Card className="bg-slate-900/40 border-slate-800">
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                                        {accountType === "client" ? "Saldo Deudor" : "Saldo Acreedor"}
                                    </span>
                                    <Wallet className="h-4 w-4 text-blue-400" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-slate-100">
                                        {formatMoney(summaryKPI.currentBalance)}
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">Saldo neto de cuenta corriente</p>
                                </CardContent>
                            </Card>

                            <Card className="bg-slate-900/40 border-slate-800">
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Total Facturado</span>
                                    <TrendingUp className="h-4 w-4 text-indigo-400" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-slate-100">
                                        {formatMoney(summaryKPI.totalBilled)}
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">Suma histórica de comprobantes</p>
                                </CardContent>
                            </Card>

                            <Card className="bg-slate-900/40 border-slate-800">
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
                                        {accountType === "client" ? "Total Cobrado" : "Total Pagado"}
                                    </span>
                                    <TrendingDown className="h-4 w-4 text-emerald-400" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-slate-100">
                                        {formatMoney(summaryKPI.totalPaid)}
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">Suma histórica de transacciones</p>
                                </CardContent>
                            </Card>

                            <Card className="bg-slate-900/40 border-slate-800">
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Notas de Crédito / Dev</span>
                                    <ArrowLeftRight className="h-4 w-4 text-amber-400" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-slate-100">
                                        {formatMoney(summaryKPI.totalCredits)}
                                    </div>
                                    <p className="text-xs text-slate-400 mt-1">Ajustes a favor de cuenta corriente</p>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Tabs Container */}
                        <Tabs defaultValue="ledger" className="space-y-4">
                            <TabsList className="bg-slate-950 border border-slate-800 w-full justify-start p-1 h-auto overflow-x-auto gap-2">
                                <TabsTrigger value="ledger" className="flex items-center gap-2">
                                    <FileText className="h-4 w-4" /> Historial de Movimientos
                                </TabsTrigger>
                                <TabsTrigger value="pending" className="flex items-center gap-2">
                                    <BadgeAlert className="h-4 w-4 text-orange-400" /> Facturas Pendientes
                                </TabsTrigger>
                            </TabsList>

                            {/* TAB 1: Ledger / Historial Completo */}
                            <TabsContent value="ledger">
                                <Card className="bg-slate-900/40 border-slate-800">
                                    <CardHeader className="pb-4">
                                        <CardTitle className="text-base font-semibold text-slate-200">
                                            Libro Auxiliar de Cuenta Corriente
                                        </CardTitle>
                                        <CardDescription>
                                            Movimientos ordenados de forma cronológica reversa (más recientes primero).
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader className="border-slate-800">
                                                    <TableRow className="border-slate-800 hover:bg-transparent">
                                                        <TableHead>Fecha</TableHead>
                                                        <TableHead>Tipo Movimiento</TableHead>
                                                        <TableHead>Comprobante / Ref</TableHead>
                                                        <TableHead>Detalle / Descripción</TableHead>
                                                        <TableHead className="text-right">Débito</TableHead>
                                                        <TableHead className="text-right">Crédito</TableHead>
                                                        <TableHead className="text-right">Saldo Acumulado</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {ledgerMovements.length === 0 ? (
                                                        <TableRow>
                                                            <TableCell colSpan={7} className="text-center py-8 text-slate-500 text-sm">
                                                                No se encontraron movimientos registrados en la cuenta corriente.
                                                            </TableCell>
                                                        </TableRow>
                                                    ) : (
                                                        ledgerMovements.map((mov, index) => {
                                                            const isDebitPositive = mov.debit > 0;
                                                            const isCreditPositive = mov.credit > 0;
                                                            return (
                                                                <TableRow key={`${mov.id}-${index}`} className="border-slate-800/40 hover:bg-slate-800/10">
                                                                    <TableCell className="text-slate-300 text-sm">
                                                                        {new Date(mov.date).toLocaleDateString("es-AR")}
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        <Badge 
                                                                            variant="outline"
                                                                            className={cn(
                                                                                "font-medium",
                                                                                mov.type === "invoice" && "border-blue-500/30 text-blue-400 bg-blue-500/5",
                                                                                mov.type === "payment" && "border-emerald-500/30 text-emerald-400 bg-emerald-500/5",
                                                                                mov.type === "credit_note" && "border-purple-500/30 text-purple-400 bg-purple-500/5",
                                                                                mov.type === "return" && "border-amber-500/30 text-amber-400 bg-amber-500/5",
                                                                                mov.type === "adjustment" && "border-slate-500/30 text-slate-400 bg-slate-500/5"
                                                                            )}
                                                                        >
                                                                            {mov.typeLabel}
                                                                        </Badge>
                                                                    </TableCell>
                                                                    <TableCell className="font-mono text-xs text-slate-300">
                                                                        {mov.reference}
                                                                    </TableCell>
                                                                    <TableCell className="text-slate-400 text-sm max-w-[250px] truncate">
                                                                        {mov.description}
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-medium text-slate-300">
                                                                        {isDebitPositive ? formatMoney(mov.debit) : "-"}
                                                                    </TableCell>
                                                                    <TableCell className="text-right font-medium text-slate-300">
                                                                        {isCreditPositive ? formatMoney(mov.credit) : "-"}
                                                                    </TableCell>
                                                                    <TableCell className={cn(
                                                                        "text-right font-bold text-sm",
                                                                        mov.balanceAfter > 0.009 ? "text-orange-400" : mov.balanceAfter < -0.009 ? "text-emerald-400" : "text-slate-300"
                                                                    )}>
                                                                        {formatMoney(mov.balanceAfter)}
                                                                    </TableCell>
                                                                </TableRow>
                                                            );
                                                        })
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            {/* TAB 2: Facturas Pendientes */}
                            <TabsContent value="pending">
                                <Card className="bg-slate-900/40 border-slate-800">
                                    <CardHeader className="pb-4">
                                        <CardTitle className="text-base font-semibold text-slate-200">
                                            Comprobantes con Deuda Pendiente
                                        </CardTitle>
                                        <CardDescription>
                                            Lista de facturas que poseen un saldo remanente a cobrar o pagar.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="p-0">
                                        <div className="overflow-x-auto">
                                            <Table>
                                                <TableHeader className="border-slate-800">
                                                    <TableRow className="border-slate-800 hover:bg-transparent">
                                                        <TableHead>Fecha Emisión</TableHead>
                                                        <TableHead>Vencimiento</TableHead>
                                                        <TableHead>Nro Comprobante</TableHead>
                                                        <TableHead className="text-right">Monto Total</TableHead>
                                                        <TableHead className="text-right">Abonado</TableHead>
                                                        <TableHead className="text-right">Saldo Pendiente</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {pendingDocuments.length === 0 ? (
                                                        <TableRow>
                                                            <TableCell colSpan={6} className="text-center py-8 text-slate-500 text-sm">
                                                                No se encontraron comprobantes pendientes. ¡La cuenta está al día!
                                                            </TableCell>
                                                        </TableRow>
                                                    ) : (
                                                        pendingDocuments.map((doc, idx) => (
                                                            <TableRow key={`${doc.id}-${idx}`} className="border-slate-800/40 hover:bg-slate-800/10">
                                                                <TableCell className="text-slate-300 text-sm">
                                                                    {new Date(doc.date).toLocaleDateString("es-AR")}
                                                                </TableCell>
                                                                <TableCell className="text-slate-400 text-sm">
                                                                    {doc.dueDate ? new Date(doc.dueDate).toLocaleDateString("es-AR") : "Sin vencimiento"}
                                                                </TableCell>
                                                                <TableCell className="font-mono text-xs text-slate-200 font-bold">
                                                                    {doc.number}
                                                                </TableCell>
                                                                <TableCell className="text-right font-medium text-slate-300">{formatMoney(doc.total)}</TableCell>
                                                                <TableCell className="text-right font-medium text-emerald-500">{formatMoney(doc.paid)}</TableCell>
                                                                <TableCell className="text-right font-bold text-orange-400">{formatMoney(doc.pending)}</TableCell>
                                                            </TableRow>
                                                        ))
                                                    )}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                    </>
                ) : (
                    <Card className="bg-slate-900/40 border-slate-800 border-dashed py-12">
                        <CardContent className="flex flex-col items-center justify-center space-y-4">
                            <div className="h-12 w-12 rounded-full bg-slate-950 flex items-center justify-center border border-slate-800">
                                <Wallet className="h-6 w-6 text-slate-400" />
                            </div>
                            <div className="text-center space-y-1">
                                <h3 className="font-semibold text-slate-200">No hay cuenta seleccionada</h3>
                                <p className="text-slate-500 text-sm">Seleccione un cliente o proveedor en los filtros superiores para cargar el estado de cuenta.</p>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* PRINT COMPONENT */}
            <div id="printable-statement" className="hidden print:block p-8 bg-white text-black font-sans text-xs">
                {isAccountSelected && (
                    <div className="space-y-6">
                        {/* Header */}
                        <div className="flex justify-between items-start border-b border-black pb-4">
                            <div>
                                <h1 className="text-xl font-bold tracking-tight text-black">SportsERP</h1>
                                <p className="text-slate-500 text-[10px]">Sports Store S.A. | CUIT: 30-12345678-9</p>
                                <p className="text-slate-500 text-[10px]">Dirección: Av. de Mayo 123, Buenos Aires</p>
                            </div>
                            <div className="text-right">
                                <h2 className="text-base font-extrabold uppercase text-slate-800">Estado de Cuenta Corriente</h2>
                                <p className="text-[10px] text-slate-500 mt-1">Fecha Emisión: {new Date().toLocaleDateString("es-AR")}</p>
                            </div>
                        </div>

                        {/* Entity details */}
                        <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 border border-slate-200 rounded">
                            <div>
                                <h3 className="font-bold text-slate-800 text-[10px] uppercase tracking-wider">Detalles de la Entidad</h3>
                                <p className="text-sm font-bold text-black mt-1">
                                    {accountType === "client" ? selectedClient?.name : selectedSupplier?.name}
                                </p>
                                <p className="mt-0.5">CUIT/DNI: {accountType === "client" ? selectedClient?.tax_id || "-" : selectedSupplier?.tax_id || "-"}</p>
                                <p className="mt-0.5">Contacto: {accountType === "client" ? selectedClient?.phone || "-" : selectedSupplier?.contact_name || "-"}</p>
                                <p className="mt-0.5">Correo: {accountType === "client" ? selectedClient?.email || "-" : selectedSupplier?.email || "-"}</p>
                            </div>
                            <div className="text-right space-y-1">
                                <h3 className="font-bold text-slate-800 text-[10px] uppercase tracking-wider">Resumen de Saldos</h3>
                                <div className="flex justify-between text-[11px] pt-1">
                                    <span className="text-slate-600">Total Comprobantes:</span>
                                    <span className="font-semibold">{formatMoney(summaryKPI.totalBilled)}</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-slate-600">Total Pagos / Cobros:</span>
                                    <span className="font-semibold">{formatMoney(summaryKPI.totalPaid)}</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-slate-600">Notas de Crédito / Dev:</span>
                                    <span className="font-semibold">{formatMoney(summaryKPI.totalCredits)}</span>
                                </div>
                                <div className="flex justify-between text-xs pt-1 border-t border-slate-300 font-bold text-black">
                                    <span>Saldo Actual CC:</span>
                                    <span>{formatMoney(summaryKPI.currentBalance)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Movements table */}
                        <div className="space-y-2">
                            <h3 className="font-bold text-[10px] uppercase tracking-wider text-slate-800">Detalle de Movimientos</h3>
                            <table className="w-full border-collapse border border-slate-200">
                                <thead>
                                    <tr className="bg-slate-100 border-b border-slate-200 text-[10px]">
                                        <th className="border border-slate-200 p-1.5 text-left">Fecha</th>
                                        <th className="border border-slate-200 p-1.5 text-left">Tipo</th>
                                        <th className="border border-slate-200 p-1.5 text-left">Ref / Comp</th>
                                        <th className="border border-slate-200 p-1.5 text-left">Detalle</th>
                                        <th className="border border-slate-200 p-1.5 text-right">Débito</th>
                                        <th className="border border-slate-200 p-1.5 text-right">Crédito</th>
                                        <th className="border border-slate-200 p-1.5 text-right">Saldo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ledgerMovements.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="text-center py-4 border border-slate-200 text-slate-400">
                                                No hay movimientos registrados
                                            </td>
                                        </tr>
                                    ) : (
                                        ledgerMovements.map((mov, idx) => (
                                            <tr key={`${mov.id}-${idx}`} className="text-[10px]">
                                                <td className="border border-slate-200 p-1.5">{new Date(mov.date).toLocaleDateString("es-AR")}</td>
                                                <td className="border border-slate-200 p-1.5 font-semibold">{mov.typeLabel}</td>
                                                <td className="border border-slate-200 p-1.5 font-mono text-[9px]">{mov.reference}</td>
                                                <td className="border border-slate-200 p-1.5 text-slate-600 truncate max-w-[200px]">{mov.description}</td>
                                                <td className="border border-slate-200 p-1.5 text-right font-medium">{mov.debit > 0 ? formatMoney(mov.debit) : "-"}</td>
                                                <td className="border border-slate-200 p-1.5 text-right font-medium">{mov.credit > 0 ? formatMoney(mov.credit) : "-"}</td>
                                                <td className="border border-slate-200 p-1.5 text-right font-bold">{formatMoney(mov.balanceAfter)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer details */}
                        <div className="pt-8 border-t border-slate-200 text-center text-[9px] text-slate-500 flex justify-between">
                            <span>Documento generado de manera automática en WSM SportsERP.</span>
                            <span>Página 1 de 1</span>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
