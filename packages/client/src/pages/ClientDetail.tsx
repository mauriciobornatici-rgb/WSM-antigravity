import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CreditCard, History, Mail, MapPin, Phone, ShieldCheck, User } from "lucide-react";
import { api } from "@/services/api";
import type { Client, Order } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ClientMovement = {
    id: string;
    date: string;
    type: "sale" | "credit_note";
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

function parseMovements(
    invoices: Awaited<ReturnType<typeof api.getInvoices>>,
    creditNotes: Awaited<ReturnType<typeof api.getCreditNotes>>,
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
        description: `Nota de crédito ${String(credit.number || credit.id || "-")}`,
        amount: Number(credit.amount || 0),
    }));

    return [...invoiceRows, ...creditRows].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}

export default function ClientDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [client, setClient] = useState<Client | null>(null);
    const [orders, setOrders] = useState<Order[]>([]);
    const [movements, setMovements] = useState<ClientMovement[]>([]);
    const [warranties, setWarranties] = useState<WarrantySummary[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void loadClientData();
    }, [id]);

    async function loadClientData() {
        if (!id) return;
        try {
            setLoading(true);
            const [clientResponse, ordersResponse, invoicesResponse, creditNotesResponse, warrantiesResponse] = await Promise.all([
                api.getClient(id),
                api.getOrders({ client_id: id }),
                api.getInvoices({ client_id: id }),
                api.getCreditNotes({ client_id: id }),
                api.getWarranties({ client_id: id }),
            ]);
            setClient(clientResponse);
            setOrders(ordersResponse);
            setMovements(parseMovements(invoicesResponse, creditNotesResponse));
            setWarranties(
                warrantiesResponse.map((warranty) => ({
                    id: String(warranty.id || crypto.randomUUID()),
                    created_at: String(warranty.created_at || new Date().toISOString()),
                    product_name: String(warranty.product_name || "-"),
                    issue_description: String(warranty.issue_description || "-"),
                    status: String(warranty.status || "-"),
                })),
            );
        } catch (error) {
            showErrorToast("Error al cargar datos del cliente", error);
        } finally {
            setLoading(false);
        }
    }

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
                    <Table>
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
                                            <Badge variant={movement.type === "credit_note" ? "secondary" : "outline"}>
                                                {movement.type === "credit_note" ? "Nota de crédito" : "Venta"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">${movement.amount.toLocaleString("es-AR")}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Pedidos recientes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>ID</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {orders.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                                            Sin pedidos.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    orders.map((order) => (
                                        <TableRow key={order.id}>
                                            <TableCell className="font-mono text-xs">{order.id}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{order.status}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right">${Number(order.total_amount || 0).toLocaleString("es-AR")}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShieldCheck className="h-5 w-5 text-indigo-500" />
                            Garantías
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
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
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
