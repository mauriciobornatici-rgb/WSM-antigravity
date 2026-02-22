import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CreditCard, History, Mail, MapPin, Phone, Plus, ShieldCheck, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Client, Order, Transaction } from "@/types";
import type { Invoice } from "@/types/api";
import { showErrorToast } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type ClientMovement = {
    id: string;
    date: string;
    type: "sale" | "credit_note" | "return" | "payment" | "adjustment";
    description: string;
    amount: number;
};

type WarrantySummary = {
    id: string;
    created_at: string;
    product_name: string;
    issue_description: string;
    status: string;
};

type ReturnSummary = {
    id: string;
    created_at: string;
    reason: string;
    status: string;
    total_amount: number;
};

type PaymentSummary = {
    id: string;
    date: string;
    type: string;
    description: string;
    amount: number;
    reference_id?: string;
};

type InvoiceSummary = {
    id: string;
    issue_date: string;
    invoice_type: string;
    point_of_sale: number;
    invoice_number: number;
    status: string;
    total_amount: number;
    payment_status?: "pending" | "partial" | "paid";
};

type CreditNoteSummary = {
    id: string;
    number: string;
    created_at: string;
    amount: number;
    status: string;
};

type PaymentLine = {
    id: string;
    method: "cash" | "transfer" | "credit_account" | "card" | "debit_card" | "credit_card" | "qr";
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

function readText(value: unknown, fallback = "-"): string {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readNumber(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function readDate(value: unknown): string {
    return typeof value === "string" && value.length > 0 ? value : new Date().toISOString();
}

function movementLabel(type: ClientMovement["type"]): string {
    switch (type) {
        case "sale":
            return "Venta";
        case "credit_note":
            return "Nota de credito";
        case "return":
            return "Devolucion";
        case "adjustment":
            return "Ajuste";
        default:
            return "Pago";
    }
}

function movementVariant(type: ClientMovement["type"]): "default" | "secondary" | "outline" | "destructive" {
    switch (type) {
        case "credit_note":
        case "return":
            return "secondary";
        case "adjustment":
            return "outline";
        case "payment":
            return "default";
        default:
            return "outline";
    }
}

function paymentTypeLabel(type: string): string {
    const normalized = String(type || "").toLowerCase();
    switch (normalized) {
        case "sale":
            return "Cobro";
        case "adjustment":
            return "Ajuste";
        case "refund":
            return "Reintegro";
        case "expense":
            return "Egreso";
        case "income":
            return "Ingreso";
        default:
            return normalized || "Movimiento";
    }
}

function orderStatusLabel(status: string): string {
    const normalized = String(status || "").toLowerCase();
    const labels: Record<string, string> = {
        pending: "Pendiente",
        picking: "En picking",
        packed: "Empaquetado",
        dispatched: "Despachado",
        delivered: "Entregado",
        completed: "Completado",
        cancelled: "Cancelado",
    };
    return labels[normalized] || normalized || "-";
}

function invoiceStatusLabel(status: string): string {
    const normalized = String(status || "").toLowerCase();
    const labels: Record<string, string> = {
        draft: "Borrador",
        issued: "Emitida",
        authorized: "Autorizada",
        rejected: "Rechazada",
        cancelled: "Anulada",
    };
    return labels[normalized] || normalized || "-";
}

function invoicePaymentStatusLabel(status: string | undefined): string {
    const normalized = String(status || "pending").toLowerCase();
    const labels: Record<string, string> = {
        pending: "Pendiente",
        partial: "Parcial",
        paid: "Pagada",
    };
    return labels[normalized] || normalized;
}

function formatInvoiceLabel(invoice: Pick<InvoiceSummary, "invoice_type" | "point_of_sale" | "invoice_number" | "id">): string {
    if (!invoice.invoice_number) return invoice.id;
    const type = String(invoice.invoice_type || "B");
    const pos = String(Number(invoice.point_of_sale || 1)).padStart(4, "0");
    const number = String(Number(invoice.invoice_number || 0)).padStart(8, "0");
    return `${type}-${pos}-${number}`;
}

function parseMovements(
    invoices: Awaited<ReturnType<typeof api.getInvoices>>,
    creditNotes: Awaited<ReturnType<typeof api.getCreditNotes>>,
    transactions: Transaction[],
): ClientMovement[] {
    const creditNoteIds = new Set(creditNotes.map((credit) => String(credit.id || "")));

    const invoiceRows: ClientMovement[] = invoices.map((invoice) => ({
        id: String(invoice.id),
        date: String(invoice.issue_date || invoice.created_at || new Date().toISOString()),
        type: "sale",
        description: `Factura ${String(invoice.invoice_number || invoice.id)}`,
        amount: Number(invoice.total_amount || 0),
    }));

    const creditRows: ClientMovement[] = creditNotes.map((credit) => ({
        id: String(credit.id || crypto.randomUUID()),
        date: String(credit.created_at || new Date().toISOString()),
        type: "credit_note",
        description: `Nota de credito ${String(credit.number || credit.id || "-")}`,
        amount: -Math.abs(Number(credit.amount || 0)),
    }));

    const transactionRows: ClientMovement[] = transactions.flatMap<ClientMovement>((tx) => {
        const txType = String(tx.type || "").toLowerCase();
        const txId = String(tx.id || crypto.randomUUID());
        const txDescription = readText(tx.description, `Movimiento ${paymentTypeLabel(txType)}`);
        const txAmount = readNumber(tx.amount);
        const txReferenceId = String(tx.reference_id || "");

        if (txType === "sale") {
            return [{
                id: txId,
                date: readDate(tx.date),
                type: "payment" as const,
                description: txDescription,
                amount: -Math.abs(txAmount),
            }];
        }

        if (txType === "adjustment") {
            if (txReferenceId && creditNoteIds.has(txReferenceId)) {
                return [];
            }
            return [{
                id: txId,
                date: readDate(tx.date),
                type: "adjustment" as const,
                description: txDescription,
                amount: txAmount,
            }];
        }

        return [{
            id: String(tx.id || crypto.randomUUID()),
            date: readDate(tx.date),
            type: "payment" as const,
            description: txDescription,
            amount: txAmount,
        }];
    });

    return [...invoiceRows, ...creditRows, ...transactionRows].sort(
        (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime(),
    );
}

export default function ClientDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [client, setClient] = useState<Client | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [movements, setMovements] = useState<ClientMovement[]>([]);
    const [warranties, setWarranties] = useState<WarrantySummary[]>([]);
    const [returns, setReturns] = useState<ReturnSummary[]>([]);
    const [payments, setPayments] = useState<PaymentSummary[]>([]);
    const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
    const [creditNotes, setCreditNotes] = useState<CreditNoteSummary[]>([]);
    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
    const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
    const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([createPaymentLine()]);
    const [paymentNotes, setPaymentNotes] = useState("");
    const [registeringPayment, setRegisteringPayment] = useState(false);
    const [loading, setLoading] = useState(true);

    const loadClientData = useCallback(async () => {
        if (!id) return;
        try {
            setLoading(true);
            const [
                clientResponse,
                ordersResponse,
                invoicesResponse,
                creditNotesResponse,
                warrantiesResponse,
                returnsResponse,
                transactionsResponse,
            ] = await Promise.all([
                api.getClient(id),
                api.getOrders({ client_id: id }),
                api.getInvoices({ client_id: id }),
                api.getCreditNotes({ client_id: id }),
                api.getWarranties({ client_id: id }),
                api.getClientReturns({ client_id: id }),
                api.getTransactions({ client_id: id }),
            ]);

            setClient(clientResponse);
            setOrders(ordersResponse);
            setMovements(parseMovements(invoicesResponse, creditNotesResponse, transactionsResponse));
            setInvoices(
                (invoicesResponse as Invoice[]).map((invoice) => ({
                    id: String(invoice.id || crypto.randomUUID()),
                    issue_date: String(invoice.issue_date || invoice.created_at || new Date().toISOString()),
                    invoice_type: String(invoice.invoice_type || "B"),
                    point_of_sale: Number(invoice.point_of_sale || 1),
                    invoice_number: Number(invoice.invoice_number || 0),
                    status: String(invoice.status || "issued"),
                    total_amount: Number(invoice.total_amount || 0),
                    payment_status: (invoice.payment_status as InvoiceSummary["payment_status"]) || "pending",
                })),
            );
            setCreditNotes(
                creditNotesResponse.map((note) => ({
                    id: String(note.id || crypto.randomUUID()),
                    number: String(note.number || note.id || "-"),
                    created_at: readDate(note.created_at),
                    amount: Math.abs(readNumber(note.amount)),
                    status: String(note.status || "issued"),
                })),
            );
            setWarranties(
                warrantiesResponse.map((warranty) => ({
                    id: String(warranty.id || crypto.randomUUID()),
                    created_at: String(warranty.created_at || new Date().toISOString()),
                    product_name: String(warranty.product_name || "-"),
                    issue_description: String(warranty.issue_description || "-"),
                    status: String(warranty.status || "-"),
                })),
            );
            setReturns(
                returnsResponse.map((row) => ({
                    id: String(row.id || crypto.randomUUID()),
                    created_at: readDate(row.created_at),
                    reason: readText(row.reason),
                    status: readText(row.status, "pending"),
                    total_amount: readNumber(row.total_amount),
                })),
            );
            setPayments(
                transactionsResponse.map((tx) => ({
                    id: String(tx.id || crypto.randomUUID()),
                    date: readDate(tx.date),
                    type: String(tx.type || ""),
                    description: readText(tx.description),
                    amount: readNumber(tx.amount),
                    ...(typeof tx.reference_id === "string" && tx.reference_id ? { reference_id: tx.reference_id } : {}),
                })),
            );
        } catch (error) {
            showErrorToast("Error al cargar datos del cliente", error);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        void loadClientData();
    }, [loadClientData]);

    const balancePercent = useMemo(() => {
        if (!client || client.credit_limit <= 0) return 0;
        return Math.min(100, (client.current_account_balance / client.credit_limit) * 100);
    }, [client]);

    const invoicePaidById = useMemo(() => {
        const map = new Map<string, number>();
        for (const tx of payments) {
            const type = String(tx.type || "").toLowerCase();
            if (type !== "sale") continue;
            const refId = String(tx.reference_id || "");
            if (!refId) continue;
            map.set(refId, (map.get(refId) || 0) + Number(tx.amount || 0));
        }
        return map;
    }, [payments]);

    const openInvoices = useMemo(() => {
        return invoices.filter((invoice) => {
            const paid = Number(invoicePaidById.get(invoice.id) || 0);
            return Number(invoice.total_amount || 0) - paid > 0.009;
        });
    }, [invoicePaidById, invoices]);

    const selectedInvoice = useMemo(() => {
        if (!selectedInvoiceId) return null;
        return invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null;
    }, [invoices, selectedInvoiceId]);

    const selectedInvoicePaid = useMemo(
        () => (selectedInvoice ? Number(invoicePaidById.get(selectedInvoice.id) || 0) : 0),
        [invoicePaidById, selectedInvoice],
    );

    const selectedInvoicePending = useMemo(() => {
        if (!selectedInvoice) return 0;
        return Math.max(0, Number(selectedInvoice.total_amount || 0) - selectedInvoicePaid);
    }, [selectedInvoice, selectedInvoicePaid]);

    const paymentLinesTotal = useMemo(
        () => paymentLines.reduce((sum, line) => sum + Number(line.amount || 0), 0),
        [paymentLines],
    );

    const accountTotals = useMemo(() => {
        const billed = invoices.reduce((sum, invoice) => sum + Number(invoice.total_amount || 0), 0);
        const credited = creditNotes.reduce((sum, note) => sum + Number(note.amount || 0), 0);
        const paid = payments
            .filter((tx) => String(tx.type || "").toLowerCase() === "sale")
            .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
        const balance = billed - credited - paid;
        return {
            billed,
            credited,
            paid,
            balance,
        };
    }, [creditNotes, invoices, payments]);

    function openPaymentDialog(invoiceId?: string) {
        const target = invoiceId || openInvoices[0]?.id || "";
        setSelectedInvoiceId(target);
        const targetPending = target
            ? Math.max(0, Number((invoices.find((invoice) => invoice.id === target)?.total_amount || 0) - Number(invoicePaidById.get(target) || 0)))
            : 0;
        const suggested = targetPending > 0 ? String(targetPending.toFixed(2)) : "";
        setPaymentLines([createPaymentLine(suggested)]);
        setPaymentNotes("");
        setPaymentDialogOpen(true);
    }

    function closePaymentDialog() {
        setPaymentDialogOpen(false);
        setSelectedInvoiceId("");
        setPaymentLines([createPaymentLine()]);
        setPaymentNotes("");
        setRegisteringPayment(false);
    }

    function updatePaymentLine(lineId: string, patch: Partial<PaymentLine>) {
        setPaymentLines((prev) => prev.map((line) => (line.id === lineId ? { ...line, ...patch } : line)));
    }

    async function submitPaymentRegistration() {
        if (!selectedInvoice) {
            toast.error("Selecciona una factura para registrar el cobro.");
            return;
        }
        if (selectedInvoicePending <= 0) {
            toast.info("La factura seleccionada ya esta saldada.");
            return;
        }

        const sanitized = paymentLines
            .map((line) => ({
                method: line.method,
                amount: Number(line.amount || 0),
            }))
            .filter((line) => Number.isFinite(line.amount) && line.amount > 0);

        if (sanitized.length === 0) {
            toast.error("Debes ingresar al menos una linea de pago valida.");
            return;
        }

        const totalToRegister = sanitized.reduce((sum, line) => sum + line.amount, 0);
        if (totalToRegister - selectedInvoicePending > 0.01) {
            toast.error("El cobro supera el saldo pendiente de la factura seleccionada.");
            return;
        }

        try {
            setRegisteringPayment(true);
            await api.registerInvoicePayment(selectedInvoice.id, {
                payments: sanitized,
                ...(paymentNotes.trim() ? { notes: paymentNotes.trim() } : {}),
            });
            toast.success("Cobro registrado", {
                description: `Se aplicaron $${totalToRegister.toLocaleString("es-AR")} a la factura.`,
            });
            closePaymentDialog();
            await loadClientData();
        } catch (error) {
            showErrorToast("No se pudo registrar el cobro", error);
        } finally {
            setRegisteringPayment(false);
        }
    }

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground">Cargando cliente...</div>;
    }

    if (!client) {
        return (
            <div className="space-y-4 p-8 text-center">
                <h2 className="text-xl font-bold text-red-600">Cliente no encontrado</h2>
                <Button onClick={() => navigate("/clients")} variant="outline">
                    Volver
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <Button variant="ghost" onClick={() => navigate("/clients")}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Volver
                </Button>
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{client.name}</h2>
                    <p className="text-muted-foreground">{client.tax_id}</p>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <User className="h-5 w-5 text-blue-500" />
                            Datos del cliente
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-3 md:grid-cols-2">
                        <div className="flex items-center gap-2 text-sm">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span>{client.email || "-"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            <span>{client.phone || "-"}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm md:col-span-2">
                            <MapPin className="h-4 w-4 text-muted-foreground" />
                            <span>{client.address || "-"}</span>
                        </div>
                    </CardContent>
                </Card>

                <Card className={cn(client.current_account_balance > client.credit_limit ? "border-red-500/40 bg-red-500/5" : "")}>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                                <CreditCard className="h-5 w-5 text-green-500" />
                                Cuenta corriente
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => openPaymentDialog()}
                                disabled={openInvoices.length === 0}
                            >
                                <Plus className="mr-1 h-4 w-4" />
                                Registrar cobro
                            </Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div>
                            <p className="text-sm text-muted-foreground">Saldo</p>
                            <p className={cn("text-3xl font-bold", client.current_account_balance > 0 ? "text-amber-500" : "text-emerald-500")}>
                                ${client.current_account_balance.toLocaleString("es-AR")}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Limite</p>
                            <p className="font-semibold">${client.credit_limit.toLocaleString("es-AR")}</p>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full bg-blue-600" style={{ width: `${balancePercent}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Facturado: ${accountTotals.billed.toLocaleString("es-AR")} | NC: ${accountTotals.credited.toLocaleString("es-AR")} | Cobrado: ${accountTotals.paid.toLocaleString("es-AR")}
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Facturado</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold">${accountTotals.billed.toLocaleString("es-AR")}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Notas de credito</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-amber-500">-${accountTotals.credited.toLocaleString("es-AR")}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Cobrado</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-emerald-500">-${accountTotals.paid.toLocaleString("es-AR")}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Saldo calculado</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className={cn("text-2xl font-bold", accountTotals.balance > 0 ? "text-amber-500" : "text-emerald-500")}>
                            ${accountTotals.balance.toLocaleString("es-AR")}
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <History className="h-5 w-5 text-purple-500" />
                        Resumen integral de cuenta
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table className="min-w-[720px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Descripcion</TableHead>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {movements.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                                            Sin movimientos.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    movements.map((movement) => (
                                        <TableRow key={movement.id}>
                                            <TableCell>{new Date(movement.date).toLocaleDateString("es-AR")}</TableCell>
                                            <TableCell>{movement.description}</TableCell>
                                            <TableCell>
                                                <Badge variant={movementVariant(movement.type)}>
                                                    {movementLabel(movement.type)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className={cn("text-right", movement.amount < 0 ? "text-emerald-500" : "text-amber-500")}>
                                                ${movement.amount.toLocaleString("es-AR")}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Compras / pedidos</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table className="min-w-[420px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>ID</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                        <TableHead>Factura</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {orders.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                                                Sin pedidos.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        orders.map((order) => (
                                            <TableRow key={order.id}>
                                                <TableCell className="font-mono text-xs">{order.id}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">{orderStatusLabel(order.status)}</Badge>
                                                </TableCell>
                                                <TableCell className="text-right">${Number(order.total_amount || 0).toLocaleString("es-AR")}</TableCell>
                                                <TableCell>
                                                    {order.invoice_id ? (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => navigate(`/invoices?invoice_id=${encodeURIComponent(String(order.invoice_id))}`)}
                                                        >
                                                            Ver
                                                        </Button>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-indigo-500" />
                            Garantias
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table className="min-w-[420px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Producto</TableHead>
                                        <TableHead>Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {warranties.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                                                Sin garantias.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        warranties.map((warranty) => (
                                            <TableRow key={warranty.id}>
                                                <TableCell>{new Date(warranty.created_at).toLocaleDateString("es-AR")}</TableCell>
                                                <TableCell>
                                                    <div>{warranty.product_name}</div>
                                                    <div className="text-xs text-muted-foreground">{warranty.issue_description}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">{warranty.status}</Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Facturas</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table className="min-w-[760px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Comprobante</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                        <TableHead className="text-right">Pagado</TableHead>
                                        <TableHead className="text-right">Pendiente</TableHead>
                                        <TableHead className="text-right">Accion</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {invoices.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                                                Sin facturas.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        invoices.map((invoice) => {
                                            const paid = Number(invoicePaidById.get(invoice.id) || 0);
                                            const pending = Math.max(0, Number(invoice.total_amount || 0) - paid);
                                            return (
                                                <TableRow key={invoice.id}>
                                                    <TableCell>{new Date(invoice.issue_date).toLocaleDateString("es-AR")}</TableCell>
                                                    <TableCell className="font-mono">{formatInvoiceLabel(invoice)}</TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col gap-1">
                                                            <Badge variant="outline">{invoiceStatusLabel(invoice.status)}</Badge>
                                                            <Badge variant={pending <= 0.009 ? "default" : "secondary"}>
                                                                {invoicePaymentStatusLabel(pending <= 0.009 ? "paid" : invoice.payment_status)}
                                                            </Badge>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right">${invoice.total_amount.toLocaleString("es-AR")}</TableCell>
                                                    <TableCell className="text-right text-emerald-500">${paid.toLocaleString("es-AR")}</TableCell>
                                                    <TableCell className="text-right font-semibold">${pending.toLocaleString("es-AR")}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={pending <= 0.009}
                                                            onClick={() => openPaymentDialog(invoice.id)}
                                                        >
                                                            Cobrar
                                                        </Button>
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

                <Card>
                    <CardHeader>
                        <CardTitle>Notas de credito</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table className="min-w-[560px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Comprobante</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {creditNotes.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                                                Sin notas de credito.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        creditNotes.map((note) => (
                                            <TableRow key={note.id}>
                                                <TableCell>{new Date(note.created_at).toLocaleDateString("es-AR")}</TableCell>
                                                <TableCell className="font-mono">{note.number}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">{note.status}</Badge>
                                                </TableCell>
                                                <TableCell className="text-right text-amber-500">-${note.amount.toLocaleString("es-AR")}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Devoluciones</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table className="min-w-[520px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Motivo</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {returns.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                                                Sin devoluciones.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        returns.map((row) => (
                                            <TableRow key={row.id}>
                                                <TableCell>{new Date(row.created_at).toLocaleDateString("es-AR")}</TableCell>
                                                <TableCell>{row.reason}</TableCell>
                                                <TableCell>
                                                    <Badge variant={row.status === "approved" ? "default" : "outline"}>
                                                        {row.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    ${row.total_amount.toLocaleString("es-AR")}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Pagos y ajustes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table className="min-w-[560px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Tipo</TableHead>
                                        <TableHead>Descripcion</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {payments.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                                                Sin pagos o ajustes.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        payments.map((tx) => {
                                            const txType = String(tx.type).toLowerCase();
                                            const isPayment = txType === "sale";
                                            return (
                                                <TableRow key={tx.id}>
                                                    <TableCell>{new Date(tx.date).toLocaleDateString("es-AR")}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={txType === "adjustment" ? "outline" : "default"}>
                                                            {paymentTypeLabel(tx.type)}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>{tx.description}</TableCell>
                                                    <TableCell className={cn("text-right", isPayment ? "text-emerald-500" : "")}>
                                                        {isPayment ? "-" : ""}${tx.amount.toLocaleString("es-AR")}
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
            </div>

            <Dialog open={paymentDialogOpen} onOpenChange={(open) => (open ? setPaymentDialogOpen(true) : closePaymentDialog())}>
                <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Registrar cobro de factura</DialogTitle>
                        <DialogDescription>
                            Registra pagos parciales o mixtos para impactar cuenta corriente y estado de pago.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="invoice-select">Factura</Label>
                            <Select
                                value={selectedInvoiceId}
                                onValueChange={(value) => {
                                    setSelectedInvoiceId(value);
                                    const pending = Math.max(
                                        0,
                                        Number((invoices.find((invoice) => invoice.id === value)?.total_amount || 0) - Number(invoicePaidById.get(value) || 0))
                                    );
                                    setPaymentLines([createPaymentLine(pending > 0 ? String(pending.toFixed(2)) : "")]);
                                }}
                            >
                                <SelectTrigger id="invoice-select">
                                    <SelectValue placeholder="Selecciona una factura pendiente" />
                                </SelectTrigger>
                                <SelectContent>
                                    {openInvoices.map((invoice) => {
                                        const paid = Number(invoicePaidById.get(invoice.id) || 0);
                                        const pending = Math.max(0, Number(invoice.total_amount || 0) - paid);
                                        return (
                                            <SelectItem key={invoice.id} value={invoice.id}>
                                                {formatInvoiceLabel(invoice)} | Pendiente ${pending.toLocaleString("es-AR")}
                                            </SelectItem>
                                        );
                                    })}
                                </SelectContent>
                            </Select>
                            {openInvoices.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No hay facturas pendientes para este cliente.</p>
                            ) : null}
                        </div>

                        {selectedInvoice ? (
                            <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
                                <div>
                                    <p className="text-muted-foreground">Total factura</p>
                                    <p className="font-semibold">${Number(selectedInvoice.total_amount || 0).toLocaleString("es-AR")}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Pagado</p>
                                    <p className="font-semibold text-emerald-500">${selectedInvoicePaid.toLocaleString("es-AR")}</p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">Pendiente</p>
                                    <p className="font-semibold text-amber-500">${selectedInvoicePending.toLocaleString("es-AR")}</p>
                                </div>
                            </div>
                        ) : null}

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>Lineas de pago</Label>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setPaymentLines((prev) => [...prev, createPaymentLine()])}
                                >
                                    <Plus className="mr-1 h-4 w-4" />
                                    Agregar linea
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {paymentLines.map((line) => (
                                    <div key={line.id} className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                                        <Select
                                            value={line.method}
                                            onValueChange={(value) => updatePaymentLine(line.id, { method: value as PaymentLine["method"] })}
                                        >
                                            <SelectTrigger>
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
                                        <Input
                                            type="number"
                                            min={0}
                                            step="0.01"
                                            value={line.amount}
                                            onChange={(event) => updatePaymentLine(line.id, { amount: event.target.value })}
                                            placeholder="Monto"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() =>
                                                setPaymentLines((prev) => (prev.length <= 1 ? prev : prev.filter((entry) => entry.id !== line.id)))
                                            }
                                            disabled={paymentLines.length <= 1}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="payment-notes">Observaciones</Label>
                            <Textarea
                                id="payment-notes"
                                value={paymentNotes}
                                onChange={(event) => setPaymentNotes(event.target.value)}
                                placeholder="Detalle opcional del cobro..."
                                rows={3}
                            />
                        </div>

                        <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
                            <div>
                                <p className="text-muted-foreground">Total a registrar</p>
                                <p className="font-semibold">${paymentLinesTotal.toLocaleString("es-AR")}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">Pendiente actual</p>
                                <p className="font-semibold">${selectedInvoicePending.toLocaleString("es-AR")}</p>
                            </div>
                            <div>
                                <p className="text-muted-foreground">Diferencia</p>
                                <p className={cn("font-semibold", paymentLinesTotal - selectedInvoicePending > 0.01 ? "text-red-500" : "text-emerald-500")}>
                                    ${(selectedInvoicePending - paymentLinesTotal).toLocaleString("es-AR")}
                                </p>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={closePaymentDialog}>
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void submitPaymentRegistration()}
                            disabled={registeringPayment || !selectedInvoiceId || openInvoices.length === 0}
                        >
                            {registeringPayment ? "Registrando..." : "Registrar cobro"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
