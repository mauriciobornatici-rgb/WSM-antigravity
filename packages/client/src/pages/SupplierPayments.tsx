import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Receipt } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { showErrorToast } from "@/lib/errorHandling";
import type { PendingSupplierInvoiceResponse, BulkSupplierPaymentAllocation, InvoicePaymentLineInput, BulkSupplierPaymentInput } from "@/types/api";
import type { Supplier } from "@/types";

type PaymentLine = {
    id: string;
    method: InvoicePaymentLineInput["method"];
    amount: string;
};

const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentLine["method"]; label: string }> = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta debito" },
    { value: "credit_card", label: "Tarjeta credito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
    { value: "card", label: "Tarjeta" },
];

function createPaymentLine(defaultAmount = ""): PaymentLine {
    return {
        id: crypto.randomUUID(),
        method: "cash",
        amount: defaultAmount,
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

    function updatePaymentLine(lineId: string, patch: Partial<PaymentLine>) {
        setPaymentLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
    }

    const { mutate: registerBulk, isPending: isRegistering } = useMutation({
        mutationFn: async () => {
            if (!selectedSupplierId) throw new Error("No supplier selected");
            
            // Distribute payments top to bottom
            const allocations: BulkSupplierPaymentAllocation[] = [];
            const remainingPayments = paymentLines.map(p => ({ method: p.method, amount: Number(p.amount || 0) }));
            
            const selectedInvoiceObjects = supplierInvoices.filter((inv: PendingSupplierInvoiceResponse) => selectedInvoiceIds.has(inv.id));
            
            for (const inv of selectedInvoiceObjects) {
                let pending = Number(inv.pending_amount || 0);
                const invPayments: InvoicePaymentLineInput[] = [];
                
                for (const pay of remainingPayments) {
                    if (pending <= 0.01) break; // Float safety
                    if (pay.amount <= 0.01) continue;
                    
                    const take = Math.min(pending, pay.amount);
                    pay.amount -= take;
                    pending -= take;
                    
                    invPayments.push({ method: pay.method, amount: Number(take.toFixed(2)) });
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
            };
            if (paymentNotes.trim()) {
                payload.notes = paymentNotes.trim();
            }
            return api.registerBulkSupplierPayments(payload);
        },
        onSuccess: (data) => {
            toast.success("Pago registrado", {
                description: `Se pagaron ${formatMoney(data.total_paid)} a proveedor correctamente.`
            });
            queryClient.invalidateQueries({ queryKey: ["supplier-payments", "pending-invoices"] });
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
        totalToRegister <= 0 || 
        Math.abs(remainingToAssign) > 0.01 || 
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
                    <Card className="bg-slate-900/40 backdrop-blur border-slate-800">
                        <CardHeader className="pb-4">
                            <CardTitle className="text-lg font-semibold text-slate-200">
                                1. Seleccione el Proveedor
                            </CardTitle>
                            <CardDescription>
                                Seleccione un proveedor para visualizar sus facturas pendientes y saldo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {isLoading ? (
                                <div className="h-10 w-full bg-slate-800/50 animate-pulse rounded-md" />
                            ) : (
                                <Select 
                                    value={selectedSupplierId} 
                                    onValueChange={(val) => {
                                        setSelectedSupplierId(val);
                                        setSelectedInvoiceIds(new Set());
                                        setPaymentLines([createPaymentLine()]);
                                        setPaymentNotes("");
                                    }}
                                >
                                    <SelectTrigger className="w-full bg-slate-950 border-slate-800 text-slate-200 h-11 focus:ring-blue-500">
                                        <SelectValue placeholder="Seleccione un proveedor..." />
                                    </SelectTrigger>
                                    <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                                        {sortedSuppliers.length === 0 ? (
                                            <div className="py-6 text-center text-muted-foreground text-sm">
                                                No se encontraron proveedores.
                                            </div>
                                        ) : (
                                            sortedSuppliers.map((sup) => {
                                                const debt = suppliersWithDebtMap.get(sup.id) || 0;
                                                return (
                                                    <SelectItem key={sup.id} value={sup.id} className="focus:bg-blue-600/30">
                                                        {sup.name} (Saldo: {formatMoney(sup.account_balance)} {debt > 0 ? `/ Facturas: ${formatMoney(debt)}` : ""})
                                                    </SelectItem>
                                                );
                                            })
                                        )}
                                    </SelectContent>
                                </Select>
                            )}
                            {selectedSupplier && (
                                <div className="flex flex-col sm:flex-row gap-4 p-3.5 rounded-lg border border-slate-800 bg-slate-950/40 text-sm text-slate-400 mt-4">
                                    <div>
                                        <span className="text-xs uppercase tracking-wider text-slate-500 block">Proveedor</span>
                                        <span className="font-semibold text-slate-200 text-base">{selectedSupplier.name}</span>
                                    </div>
                                    <div className="sm:ml-auto text-sm sm:text-right">
                                        <span className="text-xs uppercase tracking-wider text-slate-500 block">Saldo en Cuenta Corriente</span>
                                        <span className="font-bold text-slate-200 text-base">{formatMoney(selectedSupplier.account_balance)}</span>
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
                            <Card className="bg-slate-900/40 backdrop-blur border-slate-800">
                                <CardHeader className="pb-4 flex flex-row items-center justify-between">
                                    <div>
                                        <CardTitle className="text-lg font-semibold text-slate-200">
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
                                            className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                        >
                                            {selectedInvoiceIds.size === supplierInvoices.length
                                                ? "Deseleccionar Todo"
                                                : "Seleccionar Todo"}
                                        </Button>
                                    )}
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="border-t border-slate-800 overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="border-slate-800 hover:bg-transparent">
                                                    <TableHead className="w-[50px] text-center">
                                                        <input 
                                                            type="checkbox"
                                                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                                                            checked={supplierInvoices.length > 0 && selectedInvoiceIds.size === supplierInvoices.length}
                                                            onChange={toggleAllInvoices}
                                                        />
                                                    </TableHead>
                                                    <TableHead>Comprobante</TableHead>
                                                    <TableHead>Fecha</TableHead>
                                                    <TableHead className="text-right">Total</TableHead>
                                                    <TableHead className="text-right">Pagado</TableHead>
                                                    <TableHead className="text-right">Pendiente</TableHead>
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
                                                            className={cn("cursor-pointer border-slate-800/50", selectedInvoiceIds.has(inv.id) && "bg-slate-800/30")}
                                                            onClick={() => toggleInvoiceSelection(inv.id)}
                                                        >
                                                            <TableCell className="text-center">
                                                                <input 
                                                                    type="checkbox"
                                                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                                                                    checked={selectedInvoiceIds.has(inv.id)}
                                                                    onChange={() => toggleInvoiceSelection(inv.id)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                            </TableCell>
                                                            <TableCell className="font-medium">
                                                                <div className="flex items-center gap-2 text-slate-300">
                                                                    <Receipt className="h-4 w-4 text-slate-500" />
                                                                    {formatInvoiceLabel(inv)}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-slate-400">{new Date(inv.issue_date || "").toLocaleDateString()}</TableCell>
                                                            <TableCell className="text-right text-slate-300">{formatMoney(inv.total_amount)}</TableCell>
                                                            <TableCell className="text-right text-emerald-500">{formatMoney(inv.paid_amount)}</TableCell>
                                                            <TableCell className="text-right text-orange-400 font-semibold">{formatMoney(inv.pending_amount)}</TableCell>
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
                            <Card className="bg-slate-900/40 backdrop-blur border-slate-800">
                                <CardHeader className="pb-4">
                                    <CardTitle className="text-lg font-semibold text-slate-200">
                                        3. Detalle del Pago
                                    </CardTitle>
                                    <CardDescription>
                                        Ingrese los montos y formas de pago.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-3">
                                        {paymentLines.map((line, idx) => (
                                            <div key={line.id} className="flex gap-2 items-end">
                                                <div className="flex-1 space-y-1.5">
                                                    {idx === 0 && <Label className="text-xs text-slate-400">Método</Label>}
                                                    <Select
                                                        value={line.method}
                                                        onValueChange={(val) => updatePaymentLine(line.id, { method: val as PaymentLine["method"] })}
                                                    >
                                                        <SelectTrigger className="bg-slate-950 border-slate-800 text-slate-200 h-10">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-slate-950 border-slate-800 text-slate-200">
                                                            {PAYMENT_METHOD_OPTIONS.map((opt) => (
                                                                <SelectItem key={opt.value} value={opt.value}>
                                                                    {opt.label}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="flex-1 space-y-1.5">
                                                    {idx === 0 && <Label className="text-xs text-slate-400">Monto</Label>}
                                                    <Input
                                                        type="number"
                                                        value={line.amount}
                                                        onChange={(e) => updatePaymentLine(line.id, { amount: e.target.value })}
                                                        placeholder="0.00"
                                                        className="bg-slate-950 border-slate-800 text-slate-200 h-10 text-right"
                                                    />
                                                </div>

                                                {paymentLines.length > 1 && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => setPaymentLines(prev => prev.filter(p => p.id !== line.id))}
                                                        className="text-rose-400 hover:text-rose-300 hover:bg-slate-800 h-10 w-10 shrink-0"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        ))}

                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setPaymentLines(prev => [...prev, createPaymentLine()])}
                                            className="w-full border-dashed border-slate-800 hover:bg-slate-800/50 text-slate-300 gap-1"
                                        >
                                            <Plus className="h-4 w-4" /> Agregar Método de Pago
                                        </Button>
                                    </div>

                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-slate-400">Notas u Observaciones</Label>
                                        <Textarea
                                            value={paymentNotes}
                                            onChange={(e) => setPaymentNotes(e.target.value)}
                                            placeholder="Detalle de cheques, números de transferencia, etc."
                                            className="bg-slate-950 border-slate-800 text-slate-200 min-h-[80px]"
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
        </div>
    );
}
