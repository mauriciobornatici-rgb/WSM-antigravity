import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Order } from "@/types";

export type WarrantySummary = {
    id: string;
    created_at: string;
    product_name: string;
    issue_description: string;
    status: string;
};

interface ClientOrdersAndWarrantiesCardsProps {
    orders: Order[];
    warranties: WarrantySummary[];
    onViewInvoice: (invoiceId: string) => void;
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

const formatMoney = (value: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value || 0));
};

export function ClientOrdersAndWarrantiesCards({
    orders,
    warranties,
    onViewInvoice,
}: ClientOrdersAndWarrantiesCardsProps) {
    return (
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
                                            <TableCell className="text-right">{formatMoney(Number(order.total_amount || 0))}</TableCell>
                                            <TableCell>
                                                {order.invoice_id ? (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => onViewInvoice(String(order.invoice_id))}
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
        </div>
    );
}
