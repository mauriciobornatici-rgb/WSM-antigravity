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
import type { PendingInvoiceResponse, BulkPaymentAllocation, InvoicePaymentLineInput, BulkPaymentInput } from "@/types/api";

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

function formatInvoiceLabel(invoice: PendingInvoiceResponse): string {
    const type = String(invoice.invoice_type || "B");
    const pos = String(Number(invoice.point_of_sale || 1)).padStart(4, "0");
    const number = String(Number(invoice.invoice_number || 0)).padStart(8, "0");
    return `${type}-${pos}-${number}`;
}

export default function CollectionsPage() {
    const queryClient = useQueryClient();
    
    // 1. Fetch pending invoices
    const { data: pendingInvoices = [], isLoading } = useQuery<PendingInvoiceResponse[]>({
        queryKey: ["collections", "pending-invoices"],
        queryFn: () => api.getPendingInvoices(),
    });

    // 2. Derive unique clients from pending invoices
    const clientsWithDebt = useMemo(() => {
        const map = new Map<string, { id: string; name: string; debt: number }>();
        for (const inv of pendingInvoices) {
            const clientId = inv.client_id;
            if (!clientId) continue;
            if (!map.has(clientId)) {
                map.set(clientId, { id: clientId, name: inv.client_name || "Desconocido", debt: 0 });
            }
            const client = map.get(clientId)!;
            client.debt += Number(inv.pending_amount || 0);
        }
        return Array.from(map.values()).sort((a, b) => b.debt - a.debt); // Sort by highest debt
    }, [pendingInvoices]);

    // 3. State
    const [selectedClientId, setSelectedClientId] = useState<string>("");
    const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
    const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([createPaymentLine()]);
    const [paymentNotes, setPaymentNotes] = useState("");

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
            const remainingPayments = paymentLines.map(p => ({ method: p.method, amount: Number(p.amount || 0) }));
            
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
                    
                    invPayments.push({ method: pay.method, amount: Number(take.toFixed(2)) });
                }
                
                if (invPayments.length > 0) {
                    allocations.push({
                        invoiceId: inv.id,
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
        paymentLines.some(line => Number(line.amount || 0) <= 0) || 
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
                            <CardDescription>Clientes con saldo deudor pendiente.</CardDescription>
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
                                    {clientsWithDebt.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            <div className="flex items-center justify-between w-full pr-4">
                                                <span>{client.name}</span>
                                                <span className="text-muted-foreground tabular-nums ml-4">{formatMoney(client.debt)}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                    {clientsWithDebt.length === 0 && !isLoading && (
                                        <SelectItem value="empty" disabled>No hay clientes con deuda</SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                        </CardContent>
                    </Card>

                    {selectedClientId && (
                        <Card className="flex-1">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <div>
                                    <CardTitle className="text-lg">2. Facturas Pendientes</CardTitle>
                                    <CardDescription>
                                        Selecciona las facturas que se van a cobrar en esta operación.
                                    </CardDescription>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[50px] text-center">
                                                <input 
                                                    type="checkbox"
                                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                                                    checked={selectedInvoiceIds.size > 0 && selectedInvoiceIds.size === clientInvoices.length}
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
                                        {clientInvoices.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                    No se encontraron facturas pendientes.
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
                                                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
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
                                                    <TableCell>{new Date(inv.issue_date || "").toLocaleDateString()}</TableCell>
                                                    <TableCell className="text-right">{formatMoney(inv.total_amount)}</TableCell>
                                                    <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                                                        {formatMoney(inv.paid_amount)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold text-amber-600 dark:text-amber-500">
                                                        {formatMoney(inv.pending_amount)}
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
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
                                    <div key={line.id} className="grid gap-2 grid-cols-[1fr_auto]">
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
        </div>
    );
}
