import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { api, type SupplierInvoiceResponse } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
    Printer, 
    ArrowLeftRight, 
    FileText,
    BadgeAlert
} from "lucide-react";
import type { Client, Supplier, Transaction } from "@/types";
import type { Invoice } from "@/types/api";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/formatters";
import { CurrentAccountsSummaryCards } from "@/components/currentAccounts/CurrentAccountsSummaryCards";
import { CurrentAccountsLedgerTable, type UnifiedMovement } from "@/components/currentAccounts/CurrentAccountsLedgerTable";
import { CurrentAccountsPendingDocsTable, type PendingDoc } from "@/components/currentAccounts/CurrentAccountsPendingDocsTable";
import { CurrentAccountsPrintStatement } from "@/components/currentAccounts/CurrentAccountsPrintStatement";

type AccountType = "client" | "supplier";

export default function CurrentAccountsPage() {
    const [accountType, setAccountType] = useState<AccountType>("client");
    const [selectedClientId, setSelectedClientId] = useState<string>("");
    const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");

    // ==================== DATA FETCHING ====================
    const { data: clients = [] } = useQuery<Client[]>({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    });

    const { data: suppliers = [] } = useQuery<Supplier[]>({
        queryKey: queryKeys.suppliers.all,
        queryFn: () => api.getSuppliers(),
    });

    // Client Specific Data
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

    // Supplier Specific Data
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

    const selectedClient = useMemo(() => {
        return clients.find(c => c.id === selectedClientId);
    }, [clients, selectedClientId]);

    const selectedSupplier = useMemo(() => {
        return suppliers.find(s => s.id === selectedSupplierId);
    }, [suppliers, selectedSupplierId]);

    // ==================== UNIFIED MOVEMENTS ENGINE ====================
    const clientMovements = useMemo<UnifiedMovement[]>(() => {
        if (!selectedClientId) return [];

        const invoiceRows: UnifiedMovement[] = clientInvoices
            .filter(inv => inv.status !== "cancelled")
            .map(inv => ({
                id: inv.id,
                date: inv.issue_date || inv.created_at || new Date().toISOString(),
                type: "invoice" as const,
                typeLabel: `Factura ${inv.invoice_type || "B"}`,
                reference: `${inv.invoice_type || "B"}-${String(inv.invoice_number || "").padStart(8, "0")}`,
                description: `Venta Facturada / Comprobante Electrónico`,
                debit: Number(inv.total_amount || 0),
                credit: 0,
                balanceAfter: 0
            }));

        const paymentRows: UnifiedMovement[] = clientTransactions
            .filter(tx => String(tx.type).toLowerCase() === "sale" && Number(tx.amount || 0) > 0)
            .map(tx => ({
                id: String(tx.id),
                date: String(tx.date || new Date().toISOString()),
                type: "payment" as const,
                typeLabel: "Cobranza / Pago",
                reference: tx.reference_id ? `REC-${tx.reference_id.substring(0, 8)}` : `TX-${String(tx.id).substring(0, 8)}`,
                description: tx.description || "Pago recibido en cuenta corriente",
                debit: 0,
                credit: Number(tx.amount || 0),
                balanceAfter: 0
            }));

        const creditNoteRows: UnifiedMovement[] = clientCreditNotes
            .filter((cn) => cn.status !== "cancelled")
            .map((cn) => ({
                id: String(cn.id || ""),
                date: String(cn.issue_date || cn.created_at || new Date().toISOString()),
                type: "credit_note" as const,
                typeLabel: `Nota de Crédito ${cn.credit_note_type || "B"}`,
                reference: `NC-${String(cn.credit_note_number || "").padStart(8, "0")}`,
                description: String(cn.reason || "Nota de crédito por devolución o ajuste"),
                debit: 0,
                credit: Number(cn.total_amount || 0),
                balanceAfter: 0
            }));

        const returnRows: UnifiedMovement[] = clientReturns
            .filter((ret) => ret.status === "approved")
            .map((ret) => ({
                id: String(ret.id || ""),
                date: String(ret.return_date || ret.created_at || new Date().toISOString()),
                type: "return" as const,
                typeLabel: "Devolución Mercadería",
                reference: `DEV-${String(ret.return_number || String(ret.id || "").substring(0, 8))}`,
                description: `Devolución de cliente: ${String(ret.reason || "Mercadería recibida")}`,
                debit: 0,
                credit: Number(ret.refund_amount || 0),
                balanceAfter: 0
            }));

        return [...invoiceRows, ...paymentRows, ...creditNoteRows, ...returnRows].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
    }, [selectedClientId, clientInvoices, clientTransactions, clientCreditNotes, clientReturns]);

    const supplierMovements = useMemo<UnifiedMovement[]>(() => {
        if (!selectedSupplierId) return [];

        const invoiceRows: UnifiedMovement[] = supplierInvoices
            .filter((inv: { status?: string }) => inv.status !== "cancelled")
            .map((inv: SupplierInvoiceResponse) => ({
                id: inv.id,
                date: inv.issue_date || inv.created_at || new Date().toISOString(),
                type: "invoice" as const,
                typeLabel: `Factura Proveedor ${inv.invoice_type || "A"}`,
                reference: `${inv.invoice_type || "A"}-${inv.invoice_number}`,
                description: `Compra Facturada - Proveedor: ${inv.supplier_name}`,
                debit: 0,
                credit: Number(inv.total_amount || 0),
                balanceAfter: 0
            }));

        const paymentRows: UnifiedMovement[] = supplierPayments.map((pay: { id: string; payment_date?: string; created_at?: string; receipt_number?: string; payment_method?: string; amount?: number; notes?: string }) => ({
            id: pay.id,
            date: pay.payment_date || pay.created_at || new Date().toISOString(),
            type: "payment" as const,
            typeLabel: "Orden de Pago",
            reference: pay.receipt_number ? `OP-${pay.receipt_number}` : `OP-${pay.id.substring(0, 8)}`,
            description: `Pago emitido vía ${pay.payment_method || "transferencia"}. ${pay.notes || ""}`,
            debit: Number(pay.amount || 0),
            credit: 0,
            balanceAfter: 0
        }));

        const returnRows: UnifiedMovement[] = supplierReturns
            .filter((ret) => ret.status === "approved" || ret.status === "completed")
            .map((ret) => ({
                id: String(ret.id || ""),
                date: String(ret.return_date || ret.created_at || new Date().toISOString()),
                type: "return" as const,
                typeLabel: "Devolución Proveedor",
                reference: `DEV-${String(ret.return_number || String(ret.id || "").substring(0, 8))}`,
                description: `Devolución de mercadería a proveedor: ${String(ret.notes || "")}`,
                debit: Number(ret.total_credit_amount || 0),
                credit: 0,
                balanceAfter: 0
            }));

        const transactionRows: UnifiedMovement[] = supplierTransactions
            .filter(tx => String(tx.type).toLowerCase() === "expense" && Number(tx.amount || 0) > 0)
            .map(tx => ({
                id: String(tx.id),
                date: String(tx.date || new Date().toISOString()),
                type: "payment" as const,
                typeLabel: "Pago / Egreso",
                reference: tx.reference_id ? `OP-${tx.reference_id.substring(0, 8)}` : `TX-${String(tx.id).substring(0, 8)}`,
                description: tx.description || "Egreso registrado a proveedor",
                debit: Number(tx.amount || 0),
                credit: 0,
                balanceAfter: 0
            }));

        return [...invoiceRows, ...paymentRows, ...returnRows, ...transactionRows].sort(
            (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );
    }, [selectedSupplierId, supplierInvoices, supplierPayments, supplierReturns, supplierTransactions]);

    // Calculate Running Balance
    const ledgerMovements = useMemo<UnifiedMovement[]>(() => {
        const source = accountType === "client" ? clientMovements : supplierMovements;
        const calculated: UnifiedMovement[] = [];
        let runningBalance = 0;

        for (const mov of source) {
            if (accountType === "client") {
                runningBalance = runningBalance + mov.debit - mov.credit;
            } else {
                runningBalance = runningBalance + mov.credit - mov.debit;
            }
            calculated.push({
                ...mov,
                balanceAfter: runningBalance
            });
        }

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

    const [currentTimestamp] = useState(() => Date.now());

    // Filtered Invoices (Pending / Unpaid)
    const pendingDocuments = useMemo<PendingDoc[]>(() => {
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
                const isOverdue = Boolean(inv.due_date && new Date(inv.due_date).getTime() < currentTimestamp);
                return {
                    id: inv.id,
                    number: `${inv.invoice_type || "B"}-${inv.invoice_number || ""}`,
                    date: inv.issue_date || inv.created_at || "",
                    dueDate: inv.due_date || "",
                    total: Number(inv.total_amount || 0),
                    paid,
                    pending: Math.max(0, pending),
                    status: inv.status || "issued",
                    isOverdue
                };
            }).filter(d => d.pending > 0.01 && d.status !== "cancelled");
        } else {
            const paidMap = new Map<string, number>();
            for (const p of supplierPayments) {
                if (p.supplier_invoice_id) {
                    paidMap.set(p.supplier_invoice_id, (paidMap.get(p.supplier_invoice_id) || 0) + Number(p.amount || 0));
                }
            }

            return supplierInvoices.map((inv: SupplierInvoiceResponse) => {
                const paid = paidMap.get(inv.id) || 0;
                const pending = Number(inv.total_amount || 0) - paid;
                const isOverdue = Boolean(inv.due_date && new Date(inv.due_date).getTime() < currentTimestamp);
                return {
                    id: inv.id,
                    number: `${inv.invoice_type || "A"}-${inv.invoice_number || ""}`,
                    date: inv.issue_date || inv.created_at || "",
                    dueDate: inv.due_date || "",
                    total: Number(inv.total_amount || 0),
                    paid,
                    pending: Math.max(0, pending),
                    status: inv.status || "approved",
                    isOverdue
                };
            }).filter((d: { pending: number; status: string }) => d.pending > 0.01 && d.status !== "cancelled");
        }
    }, [accountType, clientInvoices, clientTransactions, currentTimestamp, supplierInvoices, supplierPayments]);

    const isAccountSelected = accountType === "client" ? !!selectedClientId : !!selectedSupplierId;

    return (
        <>
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 print:hidden">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                            Cuentas Corrientes y Conciliación
                        </h1>
                        <p className="text-muted-foreground mt-1">
                            Consulta el historial de movimientos de crédito/débito, facturas pendientes y saldos de clientes y proveedores.
                        </p>
                    </div>
                    {isAccountSelected && (
                        <Button 
                            onClick={() => window.print()}
                            variant="outline"
                            className="gap-2"
                        >
                            <Printer className="h-4 w-4" /> Imprimir Resumen
                        </Button>
                    )}
                </div>

                {/* Filtros de Búsqueda */}
                <Card className="border-border shadow-sm">
                    <CardHeader className="pb-4">
                        <CardTitle className="text-lg font-semibold text-foreground">
                            Filtros de Búsqueda
                        </CardTitle>
                        <CardDescription>
                            Seleccione el tipo de cuenta corriente y luego el cliente o proveedor para visualizar.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <Label className="text-muted-foreground text-xs">Tipo de Cuenta</Label>
                            <Select 
                                value={accountType} 
                                onValueChange={(val: AccountType) => {
                                    setAccountType(val);
                                    setSelectedClientId("");
                                    setSelectedSupplierId("");
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="client">Clientes (Ventas / Cta Cte)</SelectItem>
                                    <SelectItem value="supplier">Proveedores (Compras / Cta Cte)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="md:col-span-2 space-y-1.5">
                            <Label className="text-muted-foreground text-xs">
                                {accountType === "client" ? "Seleccione el Cliente" : "Seleccione el Proveedor"}
                            </Label>
                            {accountType === "client" ? (
                                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione un cliente..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {clients.length === 0 ? (
                                            <div className="py-2 text-center text-sm text-muted-foreground">No hay clientes registrados</div>
                                        ) : (
                                            clients.map(c => (
                                                <SelectItem key={c.id} value={c.id}>
                                                    {c.name} (Saldo: {formatMoney(c.current_account_balance)} | CUIT/DNI: {c.tax_id || "-"})
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccione un proveedor..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {suppliers.length === 0 ? (
                                            <div className="py-2 text-center text-sm text-muted-foreground">No hay proveedores registrados</div>
                                        ) : (
                                            suppliers.map(s => (
                                                <SelectItem key={s.id} value={s.id}>
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
                    <div className="space-y-6">
                        {/* KPI Summary Cards */}
                        <CurrentAccountsSummaryCards
                            accountType={accountType}
                            summaryKPI={summaryKPI}
                            selectedClient={selectedClient}
                            selectedSupplier={selectedSupplier}
                        />

                        {/* Pestañas de Detalle */}
                        <Tabs defaultValue="ledger" className="space-y-4">
                            <TabsList className="bg-muted/20 border">
                                <TabsTrigger value="ledger" className="gap-2">
                                    <ArrowLeftRight className="h-4 w-4 text-blue-500" />
                                    Libro Mayor de Movimientos ({ledgerMovements.length})
                                </TabsTrigger>
                                <TabsTrigger value="pending" className="gap-2">
                                    <FileText className="h-4 w-4 text-amber-500" />
                                    Facturas Pendientes ({pendingDocuments.length})
                                    {pendingDocuments.length > 0 && (
                                        <span className="ml-1 rounded-full bg-amber-500 text-slate-900 font-bold px-1.5 py-0.2 text-[10px]">
                                            {pendingDocuments.length}
                                        </span>
                                    )}
                                </TabsTrigger>
                            </TabsList>

                            {/* Tab Libro Mayor */}
                            <TabsContent value="ledger" className="space-y-4">
                                <Card className="border-border">
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2">
                                            <ArrowLeftRight className="h-5 w-5 text-blue-500" />
                                            Historial Cronológico de Movimientos
                                        </CardTitle>
                                        <CardDescription>
                                            Detalle de facturación, notas de crédito, pagos recibidos/emitidos y evolución del saldo.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <CurrentAccountsLedgerTable
                                            accountType={accountType}
                                            ledgerMovements={ledgerMovements}
                                        />
                                    </CardContent>
                                </Card>
                            </TabsContent>

                            {/* Tab Facturas Pendientes */}
                            <TabsContent value="pending" className="space-y-4">
                                <Card className="border-border">
                                    <CardHeader>
                                        <CardTitle className="text-base flex items-center gap-2 text-amber-500">
                                            <BadgeAlert className="h-5 w-5" />
                                            Comprobantes con Saldo Pendiente
                                        </CardTitle>
                                        <CardDescription>
                                            Facturas emitidas o recibidas que aún no se encuentran totalmente canceladas.
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <CurrentAccountsPendingDocsTable
                                            pendingDocuments={pendingDocuments}
                                        />
                                    </CardContent>
                                </Card>
                            </TabsContent>
                        </Tabs>
                    </div>
                ) : (
                    <div className="py-16 text-center border-2 border-dashed border-border rounded-xl bg-muted/10">
                        <ArrowLeftRight className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-30" />
                        <h3 className="text-lg font-bold text-foreground">Ninguna cuenta seleccionada</h3>
                        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                            Elija un cliente o proveedor en el selector superior para consultar su estado financiero y movimientos.
                        </p>
                    </div>
                )}
            </div>

            {/* Printable Statement for A4 format */}
            <CurrentAccountsPrintStatement
                accountType={accountType}
                selectedClient={selectedClient}
                selectedSupplier={selectedSupplier}
                summaryKPI={summaryKPI}
                ledgerMovements={ledgerMovements}
            />
        </>
    );
}
