import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Receipt, Landmark, History } from "lucide-react";
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
import type { PendingSupplierInvoiceResponse, BulkSupplierPaymentAllocation, SupplierSettlementLineInput, BulkSupplierPaymentInput, CustomerCheck, OutgoingCheck } from "@/types/api";
import type { Supplier } from "@/types";

type PaymentLine = {
    id: string;
    method: SupplierSettlementLineInput["method"];
    amount: string;
    check: {
        source_type: "own" | "third_party";
        source_customer_check_id: string;
        issuer_name: string;
        bank_name: string;
        check_number: string;
        issue_date: string;
        due_date: string;
    };
};

type OutgoingCheckFilter = "all" | "open" | "due_soon" | "overdue" | "cleared";
const LIST_PAGE_SIZE = 10;

const OUTGOING_STATUS_LABELS: Record<OutgoingCheck["status"], string> = {
    delivered: "Entregado",
    cleared: "Cobrado por banco",
    rejected: "Rechazado",
    cancelled: "Anulado",
};

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentLine["method"]; label: string }> = [
    { value: "cash", label: "Efectivo (caja del turno)" },
    { value: "treasury", label: "Efectivo Caja 2" },
    { value: "debit_card", label: "Tarjeta debito" },
    { value: "credit_card", label: "Tarjeta credito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
    { value: "card", label: "Tarjeta" },
    { value: "check", label: "Cheque" },
];

function createPaymentLine(defaultAmount = ""): PaymentLine {
    return {
        id: createClientUuid(),
        method: "cash",
        amount: defaultAmount,
        check: { source_type: "own", source_customer_check_id: "", issuer_name: "", bank_name: "", check_number: "", issue_date: "", due_date: "" },
    };
}

const formatMoney = (value: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value || 0));
};

function formatInvoiceLabel(invoice: PendingSupplierInvoiceResponse): string {
    return `Factura ${invoice.invoice_type}-${invoice.invoice_number}`;
}

export default function SupplierPaymentsPage() {
    const queryClient = useQueryClient();

    // 3. State
    const [selectedSupplierId, setSelectedSupplierId] = useState<string>("");
    const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
    const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([createPaymentLine()]);
    const [paymentNotes, setPaymentNotes] = useState("");
    // One key per payment attempt, kept across retries until the payment is confirmed (ADR-015).
    const [paymentKey, setPaymentKey] = useState(() => createClientUuid());
    const [outgoingFilter, setOutgoingFilter] = useState<OutgoingCheckFilter>("all");
    const [outgoingPage, setOutgoingPage] = useState(1);
    const [selectedOutgoingCheckId, setSelectedOutgoingCheckId] = useState<string | null>(null);
    const [outgoingStatus, setOutgoingStatus] = useState<OutgoingCheck["status"]>("delivered");
    const [outgoingNotes, setOutgoingNotes] = useState("");
    
    // 1. Fetch pending invoices
    const { data: pendingInvoices = [], isLoading: isLoadingInvoices } = useQuery<PendingSupplierInvoiceResponse[]>({
        queryKey: ["supplier-payments", "pending-invoices"],
        queryFn: () => api.getPendingSupplierInvoices(),
    });

    // 2. Fetch all suppliers
    const { data: suppliers = [], isLoading: isLoadingSuppliers } = useQuery<Supplier[]>({
        queryKey: ["suppliers"],
        queryFn: () => api.getSuppliers(),
    });
    const { data: customerChecks = [] } = useQuery<CustomerCheck[]>({
        queryKey: ["collections", "checks"],
        queryFn: () => api.getCustomerChecks(),
    });
    const { data: outgoingChecks = [] } = useQuery<OutgoingCheck[]>({
        queryKey: ["supplier-payments", "outgoing-checks"],
        queryFn: () => api.getOutgoingChecks(),
    });
    const { data: selectedOutgoingCheck, isFetching: isLoadingOutgoingCheck } = useQuery<OutgoingCheck>({
        queryKey: ["supplier-payments", "outgoing-checks", selectedOutgoingCheckId],
        queryFn: () => api.getOutgoingCheck(selectedOutgoingCheckId!),
        enabled: Boolean(selectedOutgoingCheckId),
    });

    const availableThirdPartyChecks = useMemo(
        () => customerChecks.filter((check) => check.status === "received"),
        [customerChecks]
    );

    const filteredOutgoingChecks = useMemo(() => {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
        const dueSoonLimit = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, "0")}-${String(limit.getDate()).padStart(2, "0")}`;
        const isOpen = (status: OutgoingCheck["status"]) => status === "delivered";
        return outgoingChecks.filter((check) => {
            const dueDate = String(check.due_date || "").slice(0, 10);
            if (outgoingFilter === "open") return isOpen(check.status);
            if (outgoingFilter === "cleared") return check.status === "cleared";
            if (outgoingFilter === "overdue") return isOpen(check.status) && dueDate < today;
            if (outgoingFilter === "due_soon") return isOpen(check.status) && dueDate >= today && dueDate <= dueSoonLimit;
            return true;
        });
    }, [outgoingChecks, outgoingFilter]);
    const outgoingTotalPages = Math.max(1, Math.ceil(filteredOutgoingChecks.length / LIST_PAGE_SIZE));
    const safeOutgoingPage = Math.min(outgoingPage, outgoingTotalPages);
    const visibleOutgoingChecks = filteredOutgoingChecks.slice((safeOutgoingPage - 1) * LIST_PAGE_SIZE, safeOutgoingPage * LIST_PAGE_SIZE);

    const isLoading = isLoadingInvoices || isLoadingSuppliers;

    const suppliersWithDebtMap = useMemo(() => {
        const map = new Map<string, number>();
        for (const inv of pendingInvoices) {
            const supplierId = inv.supplier_id;
            if (!supplierId) continue;
            map.set(supplierId, (map.get(supplierId) || 0) + Number(inv.pending_amount || 0));
        }
        return map;
    }, [pendingInvoices]);

    const sortedSuppliers = useMemo(() => {
        return [...suppliers].sort((a, b) => {
            const debtA = suppliersWithDebtMap.get(a.id) || 0;
            const debtB = suppliersWithDebtMap.get(b.id) || 0;
            if (debtA > 0 && debtB === 0) return -1;
            if (debtB > 0 && debtA === 0) return 1;
            if (debtA > 0 && debtB > 0) return debtB - debtA;
            return a.name.localeCompare(b.name);
        });
    }, [suppliers, suppliersWithDebtMap]);

    const selectedSupplier = useMemo(() => {
        return suppliers.find(s => s.id === selectedSupplierId);
    }, [suppliers, selectedSupplierId]);


    // 4. Supplier's invoices
    const supplierInvoices = useMemo(() => {
        if (!selectedSupplierId) return [];
        return pendingInvoices.filter(inv => inv.supplier_id === selectedSupplierId);
    }, [selectedSupplierId, pendingInvoices]);

    // 5. Calculate totals
    const totalSelected = useMemo(() => {
        let total = 0;
        for (const inv of supplierInvoices) {
            if (selectedInvoiceIds.has(inv.id)) {
                total += Number(inv.pending_amount || 0);
            }
        }
        return total;
    }, [supplierInvoices, selectedInvoiceIds]);

    const totalToRegister = useMemo(() => {
        return paymentLines.reduce((sum, line) => sum + Number(line.amount || 0), 0);
    }, [paymentLines]);

    const remainingToAssign = totalSelected - totalToRegister;

    // The server answers 409 when a key is reused with different content: any edit after a failed
    // attempt starts a new attempt. Never while a submit is in flight (a retry must keep its key).
    function renewPaymentKey() {
        if (!isRegistering) setPaymentKey(createClientUuid());
    }

    // Handle selection and suggest remaining amount
    const toggleInvoiceSelection = (invoiceId: string) => {
        renewPaymentKey();
        const newSet = new Set(selectedInvoiceIds);
        if (newSet.has(invoiceId)) {
            newSet.delete(invoiceId);
        } else {
            newSet.add(invoiceId);
        }
        setSelectedInvoiceIds(newSet);
        
        // Suggest total if this is the first payment line and it's empty
        let newTotal = 0;
        for (const inv of supplierInvoices) {
            if (newSet.has(inv.id)) {
                newTotal += Number(inv.pending_amount || 0);
            }
        }
        if (newSet.size > 0 && paymentLines.length === 1 && paymentLines[0] && !paymentLines[0].amount) {
            setPaymentLines([{ ...paymentLines[0], amount: String(newTotal.toFixed(2)) }]);
        }
    };

    const toggleAllInvoices = () => {
        renewPaymentKey();
        let newSet: Set<string>;
        if (selectedInvoiceIds.size === supplierInvoices.length) {
            newSet = new Set();
        } else {
            newSet = new Set(supplierInvoices.map(inv => inv.id));
        }
        setSelectedInvoiceIds(newSet);
        
        // Suggest total if this is the first payment line and it's empty
        let newTotal = 0;
        for (const inv of supplierInvoices) {
            if (newSet.has(inv.id)) {
                newTotal += Number(inv.pending_amount || 0);
            }
        }
        if (newSet.size > 0 && paymentLines.length === 1 && paymentLines[0] && !paymentLines[0].amount) {
            setPaymentLines([{ ...paymentLines[0], amount: String(newTotal.toFixed(2)) }]);
        }
    };

    // Cash leaves an open register (ADR-014): with more than one open, the user picks which.
    const paysCash = paymentLines.some((line) => line.method === "cash" && Number(line.amount || 0) > 0);
    const registersQuery = useQuery({
        queryKey: ["cash-registers", "for-supplier-payment"],
        queryFn: () => api.getCashRegisters(),
        enabled: paysCash,
        meta: { silentError: true },
    });
    const openRegisters = (registersQuery.data ?? []).filter((register) => register.status === "open");
    const [cashRegisterId, setCashRegisterId] = useState("");
    const needsRegisterChoice = paysCash && openRegisters.length > 1;

    // Caja 2 (ADR-015) cannot go negative: warn and block when its lines exceed the balance.
    const paysTreasury = paymentLines.some((line) => line.method === "treasury");
    const treasuryTotal = paymentLines
        .filter((line) => line.method === "treasury")
        .reduce((sum, line) => sum + Number(line.amount || 0), 0);
    const treasuryQuery = useQuery({
        queryKey: ["treasury", "for-supplier-payment"],
        queryFn: () => api.getTreasury(),
        enabled: paysTreasury,
        meta: { silentError: true },
    });
    const treasuryBalance = treasuryQuery.data?.balance;
    const treasuryShort = paysTreasury && treasuryBalance !== undefined && treasuryTotal > treasuryBalance + 0.005;

    function updatePaymentLine(lineId: string, patch: Partial<PaymentLine>) {
        renewPaymentKey();
        setPaymentLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
    }

    const { mutate: registerBulk, isPending: isRegistering } = useMutation({
        mutationFn: async () => {
            if (!selectedSupplierId) throw new Error("No supplier selected");
            
            // Distribute payments top to bottom
            const allocations: BulkSupplierPaymentAllocation[] = [];
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
            
            const selectedInvoiceObjects = supplierInvoices.filter((inv: PendingSupplierInvoiceResponse) => selectedInvoiceIds.has(inv.id));
            
            for (const inv of selectedInvoiceObjects) {
                let pending = Number(inv.pending_amount || 0);
                const invPayments: SupplierSettlementLineInput[] = [];
                
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
                        invoiceId: inv.id,
                        payments: invPayments
                    });
                }
            }

            const payload: BulkSupplierPaymentInput = {
                supplierId: selectedSupplierId,
                allocations,
                idempotency_key: paymentKey,
            };
            if (paymentNotes.trim()) {
                payload.notes = paymentNotes.trim();
            }
            if (needsRegisterChoice && !cashRegisterId) {
                throw new Error("Elegí de qué caja sale el efectivo");
            }
            if (paysCash && cashRegisterId) {
                payload.cash_register_id = cashRegisterId;
            }
            return api.registerBulkSupplierPayments(payload);
        },
        onSuccess: (data) => {
            setPaymentKey(createClientUuid());
            toast.success("Pago registrado", {
                description: `Se pagaron ${formatMoney(data.total_paid)} a proveedor correctamente.`
            });
            queryClient.invalidateQueries({ queryKey: ["supplier-payments", "pending-invoices"] });
            queryClient.invalidateQueries({ queryKey: ["supplier-payments", "outgoing-checks"] });
            queryClient.invalidateQueries({ queryKey: ["collections", "checks"] });
            setSelectedInvoiceIds(new Set());
            setPaymentLines([createPaymentLine()]);
            setPaymentNotes("");
        },
        onError: (error) => {
            showErrorToast("Error al registrar pago", error);
        }
    });

    const isSubmitDisabled = 
        !selectedSupplierId || 
        selectedInvoiceIds.size === 0 || 
        paymentLines.some((line) => Number(line.amount || 0) <= 0 || (line.method === "check" && (
            line.check.source_type === "third_party"
                ? !line.check.source_customer_check_id
                : (!line.check.issuer_name || !line.check.bank_name || !line.check.check_number || !line.check.due_date)
        ))) ||
        totalToRegister <= 0 || 
        Math.abs(remainingToAssign) > 0.01 ||
        treasuryShort ||
        isRegistering;

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                        Pagos a Proveedores en Cuenta Corriente
                    </h1>
                    <p className="text-slate-400 mt-1">
                        Saldar deudas de compra mediante pagos masivos e imputación directa.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Paso 1: Seleccionar Proveedor */}
                <div className="lg:col-span-3">
                    <Card>
                        <CardHeader className="pb-4">
                            <CardTitle className="text-lg font-semibold">
                                1. Seleccione el Proveedor
                            </CardTitle>
                            <CardDescription>
                                Seleccione un proveedor para visualizar sus facturas pendientes y saldo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isLoading ? (
                                <div className="h-10 w-full bg-muted animate-pulse rounded-md" />
                            ) : (
                                <Select 
                                    value={selectedSupplierId} 
                                    onValueChange={(val) => {
                                        renewPaymentKey();
                                        setSelectedSupplierId(val);
                                        setSelectedInvoiceIds(new Set());
                                        setPaymentLines([createPaymentLine()]);
                                        setPaymentNotes("");
                                    }}
                                >
                                    <SelectTrigger className="w-full bg-background border-input text-foreground h-11 focus:ring-blue-500">
                                        <SelectValue placeholder="Buscar o seleccionar proveedor..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-popover border-border text-popover-foreground">
                                        {sortedSuppliers.length === 0 ? (
                                            <div className="py-6 text-center text-muted-foreground text-sm">
                                                No se encontraron proveedores.
                                            </div>
                                        ) : (
                                            sortedSuppliers.map((sup) => {
                                                const debt = suppliersWithDebtMap.get(sup.id) || 0;
                                                return (
                                                    <SelectItem key={sup.id} value={sup.id}>
                                                        {sup.name} (Saldo: {formatMoney(sup.account_balance)} {debt > 0 ? `/ Facturas: ${formatMoney(debt)}` : ""})
                                                    </SelectItem>
                                                );
                                            })
                                        )}
                                    </SelectContent>
                                </Select>
                            )}
                            {selectedSupplier && (
                                <div className="flex flex-col sm:flex-row gap-4 p-3.5 rounded-lg border border-border bg-muted/40 text-sm text-muted-foreground mt-4">
                                    <div>
                                        <span className="text-xs uppercase tracking-wider text-muted-foreground block">Proveedor</span>
                                        <span className="font-semibold text-foreground text-base">{selectedSupplier.name}</span>
                                    </div>
                                    <div className="sm:ml-auto text-sm sm:text-right">
                                        <span className="text-xs uppercase tracking-wider text-muted-foreground block">Saldo en Cuenta Corriente</span>
                                        <span className="font-bold text-foreground font-mono text-base">{formatMoney(selectedSupplier.account_balance)}</span>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {selectedSupplierId && (
                    <>
                        {/* Paso 2: Seleccionar Facturas */}
                        <div className="lg:col-span-2 space-y-6">
                            <Card>
                                <CardHeader className="pb-4 flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle className="text-lg font-semibold">
                                            2. Seleccione las Facturas a Pagar
                                        </CardTitle>
                                        <CardDescription>
                                            Seleccione los comprobantes que desea saldar.
                                        </CardDescription>
                                    </div>
                                    {supplierInvoices.length > 0 && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={toggleAllInvoices}
                                            className="text-primary hover:bg-muted"
                                        >
                                            {selectedInvoiceIds.size === supplierInvoices.length
                                                ? "Deseleccionar Todo"
                                                : "Seleccionar Todo"}
                                        </Button>
                                    )}
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="border-t border-border overflow-x-auto">
                                        <Table className="min-w-[650px]">
                                            <TableHeader>
                                                <TableRow className="border-border hover:bg-transparent">
                                                    <TableHead className="w-[50px] text-center">
                                                        <input 
                                                            type="checkbox"
                                                            className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                                                            checked={supplierInvoices.length > 0 && selectedInvoiceIds.size === supplierInvoices.length}
                                                            onChange={toggleAllInvoices}
                                                        />
                                                    </TableHead>
                                                    <TableHead>Comprobante</TableHead>
                                                    <TableHead>Fecha</TableHead>
                                                    <TableHead className="text-right">Total</TableHead>
                                                    <TableHead className="text-right">Pagado</TableHead>
                                                    <TableHead className="text-right font-bold text-amber-600 dark:text-amber-400">Pendiente</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {supplierInvoices.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                            No se encontraron facturas pendientes.
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    supplierInvoices.map((inv) => (
                                                        <TableRow 
                                                            key={inv.id} 
                                                            className={cn("cursor-pointer border-border", selectedInvoiceIds.has(inv.id) && "bg-muted/50")}
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
                                                                <div className="flex items-center gap-2 text-foreground">
                                                                    <Receipt className="h-4 w-4 text-muted-foreground" />
                                                                    {formatInvoiceLabel(inv)}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-muted-foreground">{new Date(inv.issue_date || "").toLocaleDateString()}</TableCell>
                                                            <TableCell className="text-right font-mono text-foreground">{formatMoney(inv.total_amount)}</TableCell>
                                                            <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">{formatMoney(inv.paid_amount)}</TableCell>
                                                            <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400 font-semibold">{formatMoney(inv.pending_amount)}</TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Paso 3: Registrar Pago */}
                        <div className="space-y-6">
                            <Card>
                                <CardHeader className="pb-4">
                                    <CardTitle className="text-lg font-semibold">
                                        3. Detalle del Pago
                                    </CardTitle>
                                    <CardDescription>
                                        Ingrese los montos y formas de pago.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-3">
                                        {paymentLines.map((line, idx) => (
                                            <div key={line.id} className="space-y-3 rounded-lg border p-3">
                                                <div className="flex gap-2 items-end">
                                                    <div className="flex-1 space-y-1.5">
                                                        {idx === 0 && <Label className="text-xs text-muted-foreground">Método</Label>}
                                                        <Select
                                                            value={line.method}
                                                            onValueChange={(val) => updatePaymentLine(line.id, { method: val as PaymentLine["method"] })}
                                                        >
                                                            <SelectTrigger className="bg-background border-input text-foreground h-10"><SelectValue /></SelectTrigger>
                                                            <SelectContent className="bg-popover border-border text-popover-foreground">
                                                                {PAYMENT_METHOD_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    <div className="flex-1 space-y-1.5">
                                                        {idx === 0 && <Label className="text-xs text-muted-foreground">Monto</Label>}
                                                        <Input type="number" value={line.amount} onChange={(e) => updatePaymentLine(line.id, { amount: e.target.value })} placeholder="0.00" className="h-10 bg-background text-right font-mono" />
                                                    </div>
                                                    {paymentLines.length > 1 && (
                                                        <Button variant="ghost" size="icon" aria-label="Eliminar medio de pago" onClick={() => { renewPaymentKey(); setPaymentLines(prev => prev.filter(p => p.id !== line.id)); }} className="h-10 w-10 shrink-0 text-destructive hover:bg-destructive/10">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>

                                                {line.method === "check" ? (
                                                    <div className="space-y-3 rounded-md bg-muted/40 p-3">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs">Origen del cheque</Label>
                                                            <Select value={line.check.source_type} onValueChange={(value) => updatePaymentLine(line.id, { check: { ...line.check, source_type: value as "own" | "third_party", source_customer_check_id: "" } })}>
                                                                <SelectTrigger><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="own">Cheque propio</SelectItem>
                                                                    <SelectItem value="third_party">Cheque de terceros en cartera</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>

                                                        {line.check.source_type === "third_party" ? (
                                                            <div className="space-y-1.5">
                                                                <Label className="text-xs">Cheque disponible para endosar</Label>
                                                                <Select value={line.check.source_customer_check_id} onValueChange={(value) => {
                                                                    const selected = availableThirdPartyChecks.find((check) => check.id === value);
                                                                    if (!selected) return;
                                                                    updatePaymentLine(line.id, {
                                                                        amount: String(Number(selected.amount).toFixed(2)),
                                                                        check: {
                                                                            source_type: "third_party",
                                                                            source_customer_check_id: selected.id,
                                                                            issuer_name: selected.issuer_name,
                                                                            bank_name: selected.bank_name,
                                                                            check_number: selected.check_number,
                                                                            issue_date: String(selected.issue_date || "").slice(0, 10),
                                                                            due_date: String(selected.due_date || "").slice(0, 10),
                                                                        }
                                                                    });
                                                                }}>
                                                                    <SelectTrigger><SelectValue placeholder="Seleccionar cheque recibido" /></SelectTrigger>
                                                                    <SelectContent>
                                                                        {availableThirdPartyChecks.map((check) => (
                                                                            <SelectItem key={check.id} value={check.id}>{check.bank_name} · Nº {check.check_number} · {formatMoney(check.amount)}</SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                                <p className="text-xs text-muted-foreground">Se utilizará por su importe total y quedará marcado como endosado al proveedor.</p>
                                                            </div>
                                                        ) : (
                                                            <div className="grid gap-3 sm:grid-cols-2">
                                                                <div className="space-y-1"><Label className="text-xs">Titular / librador</Label><Input value={line.check.issuer_name} onChange={(event) => updatePaymentLine(line.id, { check: { ...line.check, issuer_name: event.target.value } })} /></div>
                                                                <div className="space-y-1"><Label className="text-xs">Banco</Label><Input value={line.check.bank_name} onChange={(event) => updatePaymentLine(line.id, { check: { ...line.check, bank_name: event.target.value } })} /></div>
                                                                <div className="space-y-1 sm:col-span-2"><Label className="text-xs">Número de cheque</Label><Input value={line.check.check_number} onChange={(event) => updatePaymentLine(line.id, { check: { ...line.check, check_number: event.target.value } })} /></div>
                                                                <div className="space-y-1"><Label className="text-xs">Fecha de emisión</Label><ArgentinaDateInput value={line.check.issue_date} onChange={(value) => updatePaymentLine(line.id, { check: { ...line.check, issue_date: value } })} ariaLabel="Fecha de emisión del cheque propio" /></div>
                                                                <div className="space-y-1"><Label className="text-xs">Fecha de cobro / vencimiento</Label><ArgentinaDateInput value={line.check.due_date} onChange={(value) => updatePaymentLine(line.id, { check: { ...line.check, due_date: value } })} ariaLabel="Fecha de cobro del cheque propio" required /></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => { renewPaymentKey(); setPaymentLines(prev => [...prev, createPaymentLine()]); }}
                                            className="w-full border-dashed border-slate-800 hover:bg-slate-800/50 text-slate-300 gap-1"
                                        >
                                            <Plus className="h-4 w-4" /> Agregar Método de Pago
                                        </Button>
                                    </div>

                                    {paysCash ? (
                                        <p className="text-xs text-muted-foreground">
                                            El efectivo sale de la caja abierta y se descuenta de su arqueo.
                                        </p>
                                    ) : null}
                                    {paysTreasury && treasuryBalance !== undefined ? (
                                        <p className="text-sm font-medium">Saldo Caja 2: {formatMoney(treasuryBalance)}</p>
                                    ) : null}
                                    {treasuryShort ? (
                                        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm font-medium text-destructive">
                                            El pago con Caja 2 ({formatMoney(treasuryTotal)}) supera su saldo ({formatMoney(treasuryBalance ?? 0)}).
                                        </p>
                                    ) : null}
                                    {needsRegisterChoice ? (
                                        <div className="space-y-1.5">
                                            <Label htmlFor="bulk-payment-register" className="text-xs text-slate-400">Caja de la que sale el efectivo</Label>
                                            <Select value={cashRegisterId} onValueChange={(value) => { renewPaymentKey(); setCashRegisterId(value); }}>
                                                <SelectTrigger id="bulk-payment-register">
                                                    <SelectValue placeholder="Elegí la caja" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {openRegisters.map((register) => (
                                                        <SelectItem key={register.id} value={register.id}>{register.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : null}

                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-slate-400">Notas u Observaciones</Label>
                                        <Textarea
                                            value={paymentNotes}
                                            onChange={(e) => { renewPaymentKey(); setPaymentNotes(e.target.value); }}
                                            placeholder="Detalle de cheques, números de transferencia, etc."
                                            className="bg-background border-input text-foreground min-h-[80px]"
                                        />
                                    </div>

                                    <div className="border-t border-slate-800 pt-4 space-y-2.5">
                                        <div className="flex justify-between text-sm text-slate-400">
                                            <span>Deuda Seleccionada:</span>
                                            <span className="font-semibold text-slate-300">{formatMoney(totalSelected)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm text-slate-400">
                                            <span>Monto a Registrar:</span>
                                            <span className="font-semibold text-slate-300">{formatMoney(totalToRegister)}</span>
                                        </div>
                                        
                                        {remainingToAssign > 0.01 ? (
                                            <div className="flex justify-between text-sm text-orange-400 bg-orange-500/10 p-2.5 rounded border border-orange-500/20">
                                                <span>Faltante por Imputar:</span>
                                                <span className="font-bold">{formatMoney(remainingToAssign)}</span>
                                            </div>
                                        ) : remainingToAssign < -0.01 ? (
                                            <div className="flex justify-between text-sm text-rose-400 bg-rose-500/10 p-2.5 rounded border border-rose-500/20">
                                                <span>Excedente (Monto de más):</span>
                                                <span className="font-bold">{formatMoney(Math.abs(remainingToAssign))}</span>
                                            </div>
                                        ) : totalSelected > 0 ? (
                                            <div className="flex justify-between text-sm text-emerald-400 bg-emerald-500/10 p-2.5 rounded border border-emerald-500/20">
                                                <span>Distribución Exacta:</span>
                                                <span className="font-bold">¡Listo para registrar!</span>
                                            </div>
                                        ) : null}
                                    </div>
                                </CardContent>
                                <CardFooter className="pb-6">
                                    <Button
                                        onClick={() => registerBulk()}
                                        disabled={isSubmitDisabled}
                                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold h-11 disabled:opacity-40"
                                    >
                                        {isRegistering ? "Procesando pago..." : "Registrar Pago"}
                                    </Button>
                                </CardFooter>
                            </Card>
                        </div>
                    </>
                )}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg"><Landmark className="h-5 w-5" /> Cheques entregados a proveedores</CardTitle>
                    <CardDescription>Control de cheques propios y de terceros desde la entrega hasta su cobro, rechazo o anulación.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-end">
                        <div className="space-y-1.5">
                            <Label>Estado de cartera</Label>
                            <Select value={outgoingFilter} onValueChange={(value) => { setOutgoingFilter(value as OutgoingCheckFilter); setOutgoingPage(1); }}>
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
                        <p className="text-sm text-muted-foreground">{filteredOutgoingChecks.length} cheque{filteredOutgoingChecks.length === 1 ? "" : "s"} en la vista seleccionada.</p>
                    </div>
                    <Table className="min-w-[900px]">
                        <TableHeader><TableRow>
                            <TableHead>Cheque</TableHead><TableHead>Origen</TableHead><TableHead>Proveedor</TableHead><TableHead>Vencimiento</TableHead><TableHead className="text-right">Importe</TableHead><TableHead>Estado</TableHead><TableHead>Acción</TableHead>
                        </TableRow></TableHeader>
                        <TableBody>
                            {visibleOutgoingChecks.length === 0 ? (
                                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No hay cheques emitidos para este filtro.</TableCell></TableRow>
                            ) : visibleOutgoingChecks.map((check) => (
                                <TableRow key={check.id}>
                                    <TableCell><p className="font-medium">{check.bank_name}</p><p className="font-mono text-xs text-muted-foreground">Nº {check.check_number}</p></TableCell>
                                    <TableCell><Badge variant={check.source_type === "own" ? "default" : "secondary"}>{check.source_type === "own" ? "Propio" : "De terceros"}</Badge></TableCell>
                                    <TableCell>{check.supplier_name || "—"}</TableCell>
                                    <TableCell>{new Date(`${String(check.due_date).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR")}</TableCell>
                                    <TableCell className="text-right font-mono font-semibold">{formatMoney(check.amount)}</TableCell>
                                    <TableCell>{OUTGOING_STATUS_LABELS[check.status]}</TableCell>
                                    <TableCell><Button type="button" variant="outline" size="sm" onClick={() => { setSelectedOutgoingCheckId(check.id); setOutgoingStatus(check.status); setOutgoingNotes(""); }}><History className="mr-1 h-4 w-4" /> Ver seguimiento</Button></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <PaginationControls page={safeOutgoingPage} totalPages={outgoingTotalPages} totalCount={filteredOutgoingChecks.length} itemLabel="cheque" onPageChange={setOutgoingPage} />
                </CardContent>
            </Card>

            <Dialog open={Boolean(selectedOutgoingCheckId)} onOpenChange={(open) => { if (!open) setSelectedOutgoingCheckId(null); }}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Seguimiento del cheque entregado</DialogTitle>
                        <DialogDescription>{selectedOutgoingCheck ? `${selectedOutgoingCheck.bank_name} · Nº ${selectedOutgoingCheck.check_number} · ${formatMoney(selectedOutgoingCheck.amount)}` : "Cargando instrumento..."}</DialogDescription>
                    </DialogHeader>
                    {isLoadingOutgoingCheck && !selectedOutgoingCheck ? <p className="py-8 text-center text-sm text-muted-foreground">Cargando trazabilidad...</p> : selectedOutgoingCheck ? (
                        <div className="space-y-5">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2"><Label>Nuevo estado</Label><Select value={outgoingStatus} onValueChange={(value) => setOutgoingStatus(value as OutgoingCheck["status"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(OUTGOING_STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                                <div className="space-y-2 sm:col-span-2"><Label htmlFor="outgoing-check-notes">Nota del movimiento</Label><Textarea id="outgoing-check-notes" value={outgoingNotes} onChange={(event) => setOutgoingNotes(event.target.value)} placeholder="Constancia bancaria, motivo del rechazo, etc." /></div>
                            </div>
                            <div><h3 className="mb-2 text-sm font-semibold">Facturas imputadas</h3>{selectedOutgoingCheck.allocations?.length ? <div className="max-h-40 space-y-2 overflow-y-auto">{selectedOutgoingCheck.allocations.map((allocation) => <div key={allocation.id} className="flex justify-between rounded-md border p-2 text-sm"><span>Factura {allocation.invoice_type || ""}-{allocation.invoice_number || ""}</span><span className="font-mono font-medium">{formatMoney(allocation.amount)}</span></div>)}</div> : <p className="text-sm text-muted-foreground">Sin facturas vinculadas.</p>}</div>
                            <div><h3 className="mb-2 text-sm font-semibold">Historial</h3><div className="max-h-48 space-y-2 overflow-y-auto">{selectedOutgoingCheck.events?.map((event) => <div key={event.id} className="rounded-md border-l-2 border-primary bg-muted/40 px-3 py-2 text-sm"><div className="flex justify-between gap-3"><span className="font-medium">{OUTGOING_STATUS_LABELS[event.status]}</span><span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString("es-AR")}</span></div>{event.notes ? <p className="mt-1 text-muted-foreground">{event.notes}</p> : null}</div>)}</div></div>
                        </div>
                    ) : null}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setSelectedOutgoingCheckId(null)}>Cerrar</Button>
                        <Button type="button" disabled={!selectedOutgoingCheck} onClick={async () => {
                            if (!selectedOutgoingCheckId) return;
                            try {
                                const updated = await api.updateOutgoingCheckStatus(selectedOutgoingCheckId, { status: outgoingStatus, notes: outgoingNotes.trim() });
                                toast.success("Seguimiento del cheque actualizado");
                                queryClient.setQueryData(["supplier-payments", "outgoing-checks", selectedOutgoingCheckId], updated);
                                await queryClient.invalidateQueries({ queryKey: ["supplier-payments", "outgoing-checks"] });
                                setOutgoingNotes("");
                            } catch (error) { showErrorToast("No se pudo actualizar el cheque", error); }
                        }}>Guardar movimiento</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
