import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CreditCard, History, Mail, MapPin, Phone, ShieldCheck, User } from "lucide-react";
import { api } from "@/services/api";
import type { Client, Order, Transaction } from "@/types";
import type { Invoice } from "@/types/api";
import { showErrorToast } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type GenericRow = Record<string, unknown>;

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
};

type InvoiceSummary = {
    id: string;
    issue_date: string;
    invoice_type: string;
    point_of_sale: number;
    invoice_number: number;
    status: string;
    total_amount: number;
};

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
    clientReturns: GenericRow[],
    transactions: Transaction[],
): ClientMovement[] {
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

    const returnRows: ClientMovement[] = clientReturns.map((row) => ({
        id: String(row.id || crypto.randomUUID()),
        date: readDate(row.created_at),
        type: "return",
        description: `Devolucion ${String(row.id || "-")}`,
        amount: -Math.abs(readNumber(row.total_amount)),
    }));

    const transactionRows: ClientMovement[] = transactions.map((tx) => {
        const txType = String(tx.type || "").toLowerCase();
        return {
            id: String(tx.id || crypto.randomUUID()),
            date: readDate(tx.date),
            type: txType === "adjustment" ? "adjustment" : "payment",
            description: readText(tx.description, `Movimiento ${paymentTypeLabel(txType)}`),
            amount: Number(tx.amount || 0),
        };
    });

    return [...invoiceRows, ...creditRows, ...returnRows, ...transactionRows].sort(
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
            setMovements(parseMovements(invoicesResponse, creditNotesResponse, returnsResponse, transactionsResponse));
            setInvoices(
                (invoicesResponse as Invoice[]).map((invoice) => ({
                    id: String(invoice.id || crypto.randomUUID()),
                    issue_date: String(invoice.issue_date || invoice.created_at || new Date().toISOString()),
                    invoice_type: String(invoice.invoice_type || "B"),
                    point_of_sale: Number(invoice.point_of_sale || 1),
                    invoice_number: Number(invoice.invoice_number || 0),
                    status: String(invoice.status || "issued"),
                    total_amount: Number(invoice.total_amount || 0),
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
                        <CardTitle className="flex items-center gap-2">
                            <CreditCard className="h-5 w-5 text-green-500" />
                            Cuenta corriente
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
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <History className="h-5 w-5 text-purple-500" />
                        Movimientos
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
                                            <TableCell className={cn("text-right", movement.amount < 0 ? "text-amber-600" : "")}>
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
                            <Table className="min-w-[620px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>Comprobante</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Monto</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {invoices.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                                                Sin facturas.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        invoices.map((invoice) => (
                                            <TableRow key={invoice.id}>
                                                <TableCell>{new Date(invoice.issue_date).toLocaleDateString("es-AR")}</TableCell>
                                                <TableCell className="font-mono">{formatInvoiceLabel(invoice)}</TableCell>
                                                <TableCell>
                                                    <Badge variant="outline">{invoiceStatusLabel(invoice.status)}</Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    ${invoice.total_amount.toLocaleString("es-AR")}
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
                                        payments.map((tx) => (
                                            <TableRow key={tx.id}>
                                                <TableCell>{new Date(tx.date).toLocaleDateString("es-AR")}</TableCell>
                                                <TableCell>
                                                    <Badge variant={String(tx.type).toLowerCase() === "adjustment" ? "outline" : "default"}>
                                                        {paymentTypeLabel(tx.type)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>{tx.description}</TableCell>
                                                <TableCell className="text-right">${tx.amount.toLocaleString("es-AR")}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
