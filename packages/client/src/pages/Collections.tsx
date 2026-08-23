import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Receipt, Users, Landmark, History } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArgentinaDateInput } from "@/components/common/ArgentinaDateInput";
import { PaginationControls } from "@/components/common/PaginationControls";
import { cn } from "@/lib/utils";
import { showErrorToast } from "@/lib/errorHandling";
import { createClientUuid } from "@/lib/clientUuid";
import type { PendingInvoiceResponse, BulkPaymentAllocation, InvoicePaymentLineInput, BulkPaymentInput, CustomerCheck, FiscalSaleStatus } from "@/types/api";
import type { Client } from "@/types";

type PaymentLine = {
    id: string;
    method: InvoicePaymentLineInput["method"];
    amount: string;
    check: {
        issuer_name: string;
        bank_name: string;
        check_number: string;
        issue_date: string;
        due_date: string;
    };
};

type CheckPortfolioFilter = "all" | "open" | "due_soon" | "overdue" | "cleared";
const LIST_PAGE_SIZE = 10;

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentLine["method"]; label: string }> = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta debito" },
    { value: "credit_card", label: "Tarjeta credito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
    { value: "card", label: "Tarjeta" },
    { value: "check", label: "Cheque" },
];

const CHECK_STATUS_LABELS: Record<CustomerCheck["status"], string> = {
    received: "Recibido",
    deposited: "Depositado",
    cleared: "Cobrado",
    endorsed: "Entregado / endosado",
    rejected: "Rechazado",
    cancelled: "Anulado",
};

function createPaymentLine(defaultAmount = ""): PaymentLine {
    return {
        id: createClientUuid(),
        method: "cash",
        amount: defaultAmount,
        check: { issuer_name: "", bank_name: "", check_number: "", issue_date: "", due_date: "" },
    };
}

import { formatMoney } from "@/lib/formatters";

function formatInvoiceLabel(invoice: PendingInvoiceResponse): string {
    if (invoice.document_type === "order") return `Venta ${String(invoice.order_id || invoice.id).slice(0, 8).toUpperCase()}`;
    const type = String(invoice.invoice_type || "B");
    const pos = String(Number(invoice.point_of_sale || 1)).padStart(4, "0");
    const number = String(Number(invoice.invoice_number || 0)).padStart(8, "0");
    return `${type}-${pos}-${number}`;
}

export default function CollectionsPage() {
    const queryClient = useQueryClient();
    
    // 1. Fetch pending invoices
    const { data: pendingInvoices = [], isLoading: isLoadingInvoices, isError: pendingInvoicesError } = useQuery<PendingInvoiceResponse[]>({
        queryKey: ["collections", "pending-invoices"],
        queryFn: () => api.getPendingInvoices(),
    });
    const { data: clients = [], isLoading: isLoadingClients, isError: clientsError } = useQuery<Client[]>({
        queryKey: ["collections", "clients"],
        queryFn: () => api.getClients(),
    });
    const { data: customerChecks = [] } = useQuery<CustomerCheck[]>({
        queryKey: ["collections", "checks"],
        queryFn: () => api.getCustomerChecks(),
    });
    const { data: fiscalSales = [] } = useQuery<FiscalSaleStatus[]>({
        queryKey: ["collections", "fiscal-status"],
        queryFn: () => api.getFiscalSalesStatus(),
    });

    // 2. Keep every registered client visible and enrich it with collectible invoiced debt.
    const clientsForCollection = useMemo(() => {
        const debtByClient = new Map<string, number>();
        for (const inv of pendingInvoices) {
            const clientId = inv.client_id;
            if (!clientId) continue;
            debtByClient.set(clientId, (debtByClient.get(clientId) || 0) + Number(inv.pending_amount || 0));
        }
        return clients
            .map((client) => ({ id: client.id, name: client.name, debt: debtByClient.get(client.id) || 0 }))
            .sort((a, b) => b.debt - a.debt || a.name.localeCompare(b.name, "es-AR"));
    }, [clients, pendingInvoices]);

    const isLoading = isLoadingInvoices || isLoadingClients;
    const hasLoadError = pendingInvoicesError || clientsError;

    // 3. State
    const [selectedClientId, setSelectedClientId] = useState<string>("");
    const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
    const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([createPaymentLine()]);
    const [paymentNotes, setPaymentNotes] = useState("");
    const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null);
    const [checkStatus, setCheckStatus] = useState<CustomerCheck["status"]>("received");
    const [checkDeliveredTo, setCheckDeliveredTo] = useState("");
    const [checkNotes, setCheckNotes] = useState("");
    const [checkFilter, setCheckFilter] = useState<CheckPortfolioFilter>("all");
    const [checkPage, setCheckPage] = useState(1);
    const [fiscalPage, setFiscalPage] = useState(1);

    const filteredChecks = useMemo(() => {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
        const dueSoonLimit = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, "0")}-${String(limit.getDate()).padStart(2, "0")}`;
        const isOpen = (status: CustomerCheck["status"]) => ["received", "deposited"].includes(status);

        return customerChecks.filter((check) => {
            const dueDate = String(check.due_date || "").slice(0, 10);
            if (checkFilter === "open") return isOpen(check.status);
            if (checkFilter === "cleared") return check.status === "cleared";
            if (checkFilter === "overdue") return isOpen(check.status) && dueDate < today;
            if (checkFilter === "due_soon") return isOpen(check.status) && dueDate >= today && dueDate <= dueSoonLimit;
            return true;
        });
    }, [customerChecks, checkFilter]);

    const checkTotalPages = Math.max(1, Math.ceil(filteredChecks.length / LIST_PAGE_SIZE));
    const safeCheckPage = Math.min(checkPage, checkTotalPages);
    const visibleChecks = filteredChecks.slice((safeCheckPage - 1) * LIST_PAGE_SIZE, safeCheckPage * LIST_PAGE_SIZE);
    const fiscalTotalPages = Math.max(1, Math.ceil(fiscalSales.length / LIST_PAGE_SIZE));
    const safeFiscalPage = Math.min(fiscalPage, fiscalTotalPages);
    const visibleFiscalSales = fiscalSales.slice((safeFiscalPage - 1) * LIST_PAGE_SIZE, safeFiscalPage * LIST_PAGE_SIZE);

    const { data: selectedCheck, isFetching: isLoadingCheck } = useQuery<CustomerCheck>({
        queryKey: ["collections", "checks", selectedCheckId],
        queryFn: () => api.getCustomerCheck(selectedCheckId!),
        enabled: Boolean(selectedCheckId),
    });

    // 4. Client's invoices
    const clientInvoices = useMemo(() => {
        if (!selectedClientId) return [];
        return pendingInvoices.filter(inv => inv.client_id === selectedClientId);
    }, [selectedClientId, pendingInvoices]);

    // State resets are handled in onValueChange of Select

    // 5. Calculate totals
    const totalSelected = useMemo(() => {
        let total = 0;
        for (const inv of clientInvoices) {
            if (selectedInvoiceIds.has(inv.id)) {
                total += Number(inv.pending_amount || 0);
            }
        }
        return total;
    }, [clientInvoices, selectedInvoiceIds]);

    const totalToRegister = useMemo(() => {
        return paymentLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    }, [paymentLines]);

    const remainingToAssign = totalSelected - totalToRegister;

    // Handle selection and suggest remaining amount
    const toggleInvoiceSelection = (invoiceId: string) => {
        const newSet = new Set(selectedInvoiceIds);
        if (newSet.has(invoiceId)) {
            newSet.delete(invoiceId);
        } else {
            newSet.add(invoiceId);
        }
        setSelectedInvoiceIds(newSet);
        
        // Suggest total if this is the first payment line and it's empty
        let newTotal = 0;
        for (const inv of clientInvoices) {
            if (newSet.has(inv.id)) {
                newTotal += Number(inv.pending_amount || 0);
            }
        }
        if (newSet.size > 0 && paymentLines.length === 1 && paymentLines[0] && !paymentLines[0].amount) {
            setPaymentLines([{ ...paymentLines[0], amount: String(newTotal.toFixed(2)) }]);
        }
    };

    const toggleAllInvoices = () => {
        let newSet: Set<string>;
        if (selectedInvoiceIds.size === clientInvoices.length) {
            newSet = new Set();
        } else {
            newSet = new Set(clientInvoices.map(inv => inv.id));
        }
        setSelectedInvoiceIds(newSet);
        
        // Suggest total if this is the first payment line and it's empty
        let newTotal = 0;
        for (const inv of clientInvoices) {
            if (newSet.has(inv.id)) {
                newTotal += Number(inv.pending_amount || 0);
            }
        }
        if (newSet.size > 0 && paymentLines.length === 1 && paymentLines[0] && !paymentLines[0].amount) {
            setPaymentLines([{ ...paymentLines[0], amount: String(newTotal.toFixed(2)) }]);
        }
    };

    function updatePaymentLine(lineId: string, patch: Partial<PaymentLine>) {
        setPaymentLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
    }

    const { mutate: registerBulk, isPending: isRegistering } = useMutation({
        mutationFn: async () => {
            if (!selectedClientId) throw new Error("No client selected");
            
            // Distribute payments top to bottom
            const allocations: BulkPaymentAllocation[] = [];
            const remainingPayments = paymentLines.map(p => ({
                method: p.method,
                amount: Number(p.amount || 0),
                ...(p.method === "check" ? {
                    check: {
                        ...p.check,
                        instrument_amount: Number(p.amount || 0),
                    }
                } : {})
            }));
            
            const selectedInvoiceObjects = clientInvoices.filter(inv => selectedInvoiceIds.has(inv.id));
            
            for (const inv of selectedInvoiceObjects) {
                let pending = Number(inv.pending_amount || 0);
                const invPayments: InvoicePaymentLineInput[] = [];
                
                for (const pay of remainingPayments) {
                    if (pending <= 0.01) break; // Float safety
                    if (pay.amount <= 0.01) continue;
                    
                    const take = Math.min(pending, pay.amount);
                    pay.amount -= take;
                    pending -= take;
                    
                    invPayments.push({
                        method: pay.method,
                        amount: Number(take.toFixed(2)),
                        ...(pay.check ? { check: pay.check } : {})
                    });
                }
                
                if (invPayments.length > 0) {
                    allocations.push({
                        documentId: inv.id,
                        documentType: inv.document_type,
                        payments: invPayments
                    });
                }
            }

            const payload: BulkPaymentInput = {
                clientId: selectedClientId,
                allocations,
            };
            if (paymentNotes.trim()) {
                payload.notes = paymentNotes.trim();
            }
            return api.registerBulkInvoicePayments(payload);
        },
        onSuccess: (data) => {
            toast.success("Cobro registrado", {
                description: `Se aplicaron ${formatMoney(data.total_paid)} a cuenta corriente.`
            });
            queryClient.invalidateQueries({ queryKey: ["collections", "pending-invoices"] });
            queryClient.invalidateQueries({ queryKey: ["collections", "fiscal-status"] });
            queryClient.invalidateQueries({ queryKey: ["collections", "clients"] });
            queryClient.invalidateQueries({ queryKey: ["collections", "checks"] });
            setSelectedInvoiceIds(new Set());
            setPaymentLines([createPaymentLine()]);
            setPaymentNotes("");
        },
        onError: (error) => {
            showErrorToast("Error al registrar cobranza", error);
        }
    });

    const isSubmitDisabled = 
        !selectedClientId || 
        selectedInvoiceIds.size === 0 || 
        paymentLines.some(line => Number(line.amount || 0) <= 0 || (line.method === "check" && (!line.check.issuer_name || !line.check.bank_name || !line.check.check_number || !line.check.due_date))) ||
        totalToRegister <= 0 || 
        totalToRegister - totalSelected > 0.01 || 
        isRegistering;

    return (
        <div className="flex h-full flex-col gap-4 p-4 md:gap-6 md:p-6 lg:p-8 max-w-7xl mx-auto">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Workbench de Cobranzas</h1>
                    <p className="text-muted-foreground">
                        Gestiona cobranzas en cuenta corriente de forma ágil y masiva.
                    </p>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-12">
                {/* Panel Izquierdo: Selección y Facturas */}
                <div className="md:col-span-8 flex flex-col gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">1. Seleccionar Cliente</CardTitle>
                            <CardDescription>Clientes registrados, priorizando quienes tienen ventas a cuenta corriente pendientes.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Select value={selectedClientId} onValueChange={(val) => {
                                setSelectedClientId(val);
                                setSelectedInvoiceIds(new Set());
                                setPaymentLines([createPaymentLine()]);
                                setPaymentNotes("");
                            }}>
                                <SelectTrigger className="w-full sm:max-w-md">
                                    <SelectValue placeholder={isLoading ? "Cargando..." : "Selecciona un cliente"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {clientsForCollection.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            <div className="flex items-center justify-between w-full pr-4">
                                                <span>{client.name}</span>
                                                <span className="text-muted-foreground tabular-nums ml-4">
                                                    {client.debt > 0 ? formatMoney(client.debt) : "Sin deuda pendiente"}
                                                </span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                    {clientsForCollection.length === 0 && !isLoading && (
                                        <SelectItem value="empty" disabled>No hay clientes registrados</SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                            {hasLoadError ? (
                                <p className="mt-2 text-sm text-destructive">No se pudieron cargar clientes o facturas. Reintenta en unos segundos.</p>
                            ) : null}
                        </CardContent>
                    </Card>

                    {selectedClientId ? (
                        <Card className="flex-1">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <div>
                                    <CardTitle className="text-lg">2. Comprobantes pendientes</CardTitle>
                                    <CardDescription>
                                        Incluye ventas a cuenta corriente aunque todavía no tengan factura o CAE.
                                    </CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="overflow-x-auto">
                                    <Table className="min-w-[680px]">
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-[50px] text-center">
                                                    <input 
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                                                        checked={selectedInvoiceIds.size > 0 && selectedInvoiceIds.size === clientInvoices.length}
                                                        onChange={toggleAllInvoices}
                                                    />
                                                </TableHead>
                                                <TableHead>Comprobante</TableHead>
                                                <TableHead>Estado fiscal</TableHead>
                                                <TableHead>Fecha</TableHead>
                                                <TableHead className="text-right">Total</TableHead>
                                                <TableHead className="text-right">Pagado</TableHead>
                                                <TableHead className="text-right font-bold text-amber-600 dark:text-amber-400">Pendiente</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {clientInvoices.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                        No hay ventas a cuenta corriente con saldo pendiente para este cliente.
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                clientInvoices.map((inv) => (
                                                    <TableRow 
                                                        key={inv.id} 
                                                        className={cn("cursor-pointer", selectedInvoiceIds.has(inv.id) && "bg-muted/50")}
                                                        onClick={() => toggleInvoiceSelection(inv.id)}
                                                    >
                                                        <TableCell className="text-center">
                                                            <input 
                                                                type="checkbox"
                                                                className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                                                                checked={selectedInvoiceIds.has(inv.id)}
                                                                onChange={() => toggleInvoiceSelection(inv.id)}
                                                                onClick={(e) => e.stopPropagation()}
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-medium">
                                                            <div className="flex items-center gap-2">
                                                                <Receipt className="h-4 w-4 text-muted-foreground" />
                                                                {formatInvoiceLabel(inv)}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            {inv.fiscal_status === "authorized" ? <Badge className="bg-emerald-600">Con CAE</Badge> : inv.fiscal_status === "pending_cae" ? <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">Sin CAE</Badge> : <Badge variant="secondary">Sin facturar</Badge>}
                                                        </TableCell>
                                                        <TableCell>{new Date(inv.issue_date || "").toLocaleDateString()}</TableCell>
                                                        <TableCell className="text-right font-mono">{formatMoney(inv.total_amount)}</TableCell>
                                                        <TableCell className="text-right font-mono">{formatMoney(inv.paid_amount)}</TableCell>
                                                        <TableCell className="text-right font-bold font-mono text-amber-600 dark:text-amber-400">
                                                            {formatMoney(Number(inv.total_amount) - Number(inv.paid_amount))}
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="flex-1 flex flex-col items-center justify-center p-12 text-center border-dashed">
                            <div className="rounded-full bg-primary/10 p-4 mb-3">
                                <Users className="h-8 w-8 text-primary" />
                            </div>
                            <h3 className="font-semibold text-lg">Selecciona un cliente</h3>
                            <p className="text-sm text-muted-foreground max-w-sm mt-1">
                                Elige un cliente para cargar sus ventas pendientes y armar el cobro.
                            </p>
                        </Card>
                    )}
                </div>

                {/* Panel Derecho: Pagos y Resumen */}
                <div className="md:col-span-4 flex flex-col gap-6">
                    <Card className={cn("transition-opacity", (!selectedClientId || selectedInvoiceIds.size === 0) ? "opacity-50 pointer-events-none" : "opacity-100")}>
                        <CardHeader>
                            <CardTitle className="text-lg">3. Métodos de Pago</CardTitle>
                            <CardDescription>
                                Asigna los métodos de pago para cubrir <span className="font-semibold text-foreground">{formatMoney(totalSelected)}</span>.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-3">
                                {paymentLines.map((line) => (
                                    <div key={line.id} className="space-y-2 rounded-md border p-2">
                                      <div className="grid gap-2 grid-cols-[1fr_auto]">
                                        <Select
                                            value={line.method}
                                            onValueChange={(value) => updatePaymentLine(line.id, { method: value as PaymentLine["method"] })}
                                        >
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {PAYMENT_METHOD_OPTIONS.map((option) => (
                                                    <SelectItem key={option.value} value={option.value}>
                                                        {option.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <div className="flex items-center gap-1">
                                            <Input
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                value={line.amount}
                                                onChange={(event) => updatePaymentLine(line.id, { amount: event.target.value })}
                                                placeholder="0.00"
                                                className="w-24 text-right"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                                onClick={() =>
                                                    setPaymentLines((prev) => (prev.length <= 1 ? prev : prev.filter((entry) => entry.id !== line.id)))
                                                }
                                                disabled={paymentLines.length <= 1}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                      </div>
                                      {line.method === "check" ? (
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <Input value={line.check.issuer_name} onChange={(event) => updatePaymentLine(line.id, { check: { ...line.check, issuer_name: event.target.value } })} placeholder="Librador / titular" />
                                            <Input value={line.check.bank_name} onChange={(event) => updatePaymentLine(line.id, { check: { ...line.check, bank_name: event.target.value } })} placeholder="Banco" />
                                            <Input value={line.check.check_number} onChange={(event) => updatePaymentLine(line.id, { check: { ...line.check, check_number: event.target.value } })} placeholder="Número de cheque" />
                                            <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Fecha de emisión</Label>
                                                    <ArgentinaDateInput
                                                        value={line.check.issue_date}
                                                        onChange={(value) => updatePaymentLine(line.id, { check: { ...line.check, issue_date: value } })}
                                                        ariaLabel="Fecha de emisión del cheque"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">Fecha de cobro / vencimiento</Label>
                                                    <ArgentinaDateInput
                                                        value={line.check.due_date}
                                                        onChange={(value) => updatePaymentLine(line.id, { check: { ...line.check, due_date: value } })}
                                                        ariaLabel="Fecha de cobro o vencimiento del cheque"
                                                        required
                                                    />
                                                </div>
                                            </div>
                                            <p className="text-[11px] text-muted-foreground sm:col-span-2">Formato argentino: dd/mm/aaaa. El cheque ingresará automáticamente a cartera.</p>
                                        </div>
                                      ) : null}
                                    </div>
                                ))}
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="w-full border-dashed"
                                    onClick={() => {
                                        setPaymentLines((prev) => [...prev, createPaymentLine(remainingToAssign > 0 ? String(remainingToAssign.toFixed(2)) : "")])
                                    }}
                                >
                                    <Plus className="mr-1 h-4 w-4" />
                                    Agregar línea
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="notes">Observaciones (Opcional)</Label>
                                <Textarea 
                                    id="notes" 
                                    placeholder="Detalle de transferencia, cheque, etc." 
                                    className="resize-none"
                                    value={paymentNotes}
                                    onChange={(e) => setPaymentNotes(e.target.value)}
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="flex-col gap-4 bg-muted/50 p-4 border-t">
                            <div className="w-full space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total seleccionado:</span>
                                    <span className="font-semibold">{formatMoney(totalSelected)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total asignado:</span>
                                    <span className="font-semibold">{formatMoney(totalToRegister)}</span>
                                </div>
                                <div className="flex justify-between pt-2 border-t">
                                    <span className="text-muted-foreground">Restante:</span>
                                    <span className={cn("font-bold", remainingToAssign < -0.01 ? "text-red-500" : (remainingToAssign > 0.01 ? "text-amber-500" : "text-emerald-500"))}>
                                        {formatMoney(Math.abs(remainingToAssign))} {remainingToAssign < -0.01 && "(Excede)"}
                                    </span>
                                </div>
                            </div>
                            <Button 
                                className="w-full" 
                                size="lg" 
                                disabled={isSubmitDisabled}
                                onClick={() => registerBulk()}
                            >
                                {isRegistering ? "Procesando..." : "Registrar Cobranza"}
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            </div>

            <Card className="order-last">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><Receipt className="h-5 w-5" /> Control fiscal de ventas</CardTitle>
                    <CardDescription>Todas las ventas asociadas a clientes, separando la deuda financiera del estado de facturación y CAE.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table className="min-w-[900px]">
                            <TableHeader><TableRow>
                                <TableHead>Venta</TableHead><TableHead>Cliente</TableHead><TableHead>Fecha</TableHead><TableHead>Factura</TableHead><TableHead>Estado fiscal</TableHead><TableHead className="text-right">Total venta</TableHead>
                            </TableRow></TableHeader>
                            <TableBody>
                                {fiscalSales.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No hay ventas vinculadas a clientes para controlar.</TableCell></TableRow>
                                ) : visibleFiscalSales.map((sale) => (
                                    <TableRow key={sale.order_id}>
                                        <TableCell className="font-mono text-xs">{sale.order_id.slice(0, 8).toUpperCase()}</TableCell>
                                        <TableCell><p className="font-medium">{sale.client_name}</p><p className="text-xs text-muted-foreground">{sale.client_tax_id || "Sin CUIT/DNI"}</p></TableCell>
                                        <TableCell>{new Date(sale.sale_date).toLocaleDateString("es-AR")}</TableCell>
                                        <TableCell>{sale.invoice_id ? `${sale.invoice_type}-${String(sale.point_of_sale || 0).padStart(4, "0")}-${String(sale.invoice_number || 0).padStart(8, "0")}` : "—"}</TableCell>
                                        <TableCell>
                                            {sale.fiscal_status === "authorized" ? <Badge className="bg-emerald-600">CAE autorizado</Badge> : sale.fiscal_status === "pending_cae" ? <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">Factura sin CAE</Badge> : <Badge variant="secondary">Pendiente de facturar</Badge>}
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-semibold">{formatMoney(sale.order_total)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <PaginationControls
                        page={safeFiscalPage}
                        totalPages={fiscalTotalPages}
                        totalCount={fiscalSales.length}
                        itemLabel="venta"
                        onPageChange={setFiscalPage}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><Landmark className="h-5 w-5" /> Cartera de cheques</CardTitle>
                    <CardDescription>Seguimiento desde la recepción hasta el depósito, endoso, acreditación o rechazo.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-end">
                        <div className="space-y-1.5">
                            <Label>Estado de cartera</Label>
                            <Select value={checkFilter} onValueChange={(value) => { setCheckFilter(value as CheckPortfolioFilter); setCheckPage(1); }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos</SelectItem>
                                    <SelectItem value="open">Pendientes de cobro</SelectItem>
                                    <SelectItem value="due_soon">Vencen en 7 días</SelectItem>
                                    <SelectItem value="overdue">Vencidos sin cobrar</SelectItem>
                                    <SelectItem value="cleared">Cobrados</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {filteredChecks.length} cheque{filteredChecks.length === 1 ? "" : "s"} en la vista seleccionada.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <Table className="min-w-[900px]">
                            <TableHeader><TableRow>
                                <TableHead>Cheque</TableHead><TableHead>Librador / cliente</TableHead><TableHead>Vencimiento</TableHead><TableHead className="text-right">Importe</TableHead><TableHead>Estado</TableHead><TableHead>Acción</TableHead>
                            </TableRow></TableHeader>
                            <TableBody>
                                {visibleChecks.length === 0 ? <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No hay cheques para este filtro.</TableCell></TableRow> : visibleChecks.map((check) => (
                                    <TableRow key={check.id}>
                                        <TableCell><p className="font-medium">{check.bank_name}</p><p className="font-mono text-xs text-muted-foreground">Nº {check.check_number}</p></TableCell>
                                        <TableCell><p>{check.issuer_name}</p><p className="text-xs text-muted-foreground">{check.client_name || "Sin cliente vinculado"}</p></TableCell>
                                        <TableCell>{new Date(`${String(check.due_date).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR")}</TableCell>
                                        <TableCell className="text-right font-mono font-semibold">{formatMoney(check.amount)}</TableCell>
                                        <TableCell>{CHECK_STATUS_LABELS[check.status]}</TableCell>
                                        <TableCell>
                                            <Button type="button" variant="outline" size="sm" onClick={() => {
                                                setSelectedCheckId(check.id);
                                                setCheckStatus(check.status);
                                                setCheckDeliveredTo(check.delivered_to || "");
                                                setCheckNotes("");
                                            }}>
                                                <History className="mr-1 h-4 w-4" /> Ver seguimiento
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <PaginationControls
                        page={safeCheckPage}
                        totalPages={checkTotalPages}
                        totalCount={filteredChecks.length}
                        itemLabel="cheque"
                        onPageChange={setCheckPage}
                    />
                </CardContent>
            </Card>

            <Dialog open={Boolean(selectedCheckId)} onOpenChange={(open) => { if (!open) setSelectedCheckId(null); }}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Seguimiento del cheque</DialogTitle>
                        <DialogDescription>
                            {selectedCheck ? `${selectedCheck.bank_name} · Nº ${selectedCheck.check_number} · ${formatMoney(selectedCheck.amount)}` : "Cargando instrumento..."}
                        </DialogDescription>
                    </DialogHeader>

                    {isLoadingCheck && !selectedCheck ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">Cargando trazabilidad...</p>
                    ) : selectedCheck ? (
                        <div className="space-y-5">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Nuevo estado</Label>
                                    <Select value={checkStatus} onValueChange={(value) => setCheckStatus(value as CustomerCheck["status"])}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(CHECK_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="check-delivered-to">Entregado a</Label>
                                    <Input id="check-delivered-to" value={checkDeliveredTo} onChange={(event) => setCheckDeliveredTo(event.target.value)} placeholder="Persona, proveedor o banco" />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="check-status-notes">Nota del movimiento</Label>
                                    <Textarea id="check-status-notes" value={checkNotes} onChange={(event) => setCheckNotes(event.target.value)} placeholder="Constancia, número de depósito, motivo de rechazo, etc." />
                                </div>
                            </div>

                            <div>
                                <h3 className="mb-2 text-sm font-semibold">Aplicación del cheque</h3>
                                {selectedCheck.allocations?.length ? (
                                    <div className="space-y-2">
                                        {selectedCheck.allocations.map((allocation) => (
                                            <div key={allocation.id} className="flex justify-between rounded-md border p-2 text-sm">
                                                <span>Factura {allocation.invoice_type || ""} {allocation.point_of_sale != null ? String(allocation.point_of_sale).padStart(4, "0") : ""}-{allocation.invoice_number != null ? String(allocation.invoice_number).padStart(8, "0") : ""}</span>
                                                <span className="font-mono font-medium">{formatMoney(allocation.amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : <p className="text-sm text-muted-foreground">Sin facturas vinculadas.</p>}
                            </div>

                            <div>
                                <h3 className="mb-2 text-sm font-semibold">Historial</h3>
                                <div className="max-h-48 space-y-2 overflow-y-auto">
                                    {selectedCheck.events?.map((event) => (
                                        <div key={event.id} className="rounded-md border-l-2 border-primary bg-muted/40 px-3 py-2 text-sm">
                                            <div className="flex justify-between gap-3">
                                                <span className="font-medium">{CHECK_STATUS_LABELS[event.status]}</span>
                                                <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString("es-AR")}</span>
                                            </div>
                                            {event.notes ? <p className="mt-1 text-muted-foreground">{event.notes}</p> : null}
                                            {event.performed_by_name ? <p className="mt-1 text-xs text-muted-foreground">Por {event.performed_by_name}</p> : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setSelectedCheckId(null)}>Cerrar</Button>
                        <Button type="button" disabled={!selectedCheck || (checkStatus === "endorsed" && !checkDeliveredTo.trim())} onClick={async () => {
                            if (!selectedCheckId) return;
                            try {
                                const updated = await api.updateCustomerCheckStatus(selectedCheckId, {
                                    status: checkStatus,
                                    notes: checkNotes.trim(),
                                    delivered_to: checkDeliveredTo.trim(),
                                });
                                toast.success("Seguimiento del cheque actualizado");
                                queryClient.setQueryData(["collections", "checks", selectedCheckId], updated);
                                await queryClient.invalidateQueries({ queryKey: ["collections", "checks"] });
                                setCheckNotes("");
                            } catch (error) {
                                showErrorToast("No se pudo actualizar el cheque", error);
                            }
                        }}>Guardar movimiento</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
