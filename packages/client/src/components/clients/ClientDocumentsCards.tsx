import { Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ClientMovement } from "./ClientMovementsCard";

export type InvoiceSummary = {
    id: string;
    issue_date: string;
    invoice_type: string;
    point_of_sale: number;
    invoice_number: number;
    status: string;
    total_amount: number;
    payment_status?: "pending" | "partial" | "paid";
};

export type CreditNoteSummary = {
    id: string;
    number: string;
    created_at: string;
    amount: number;
    status: string;
};

export type ReturnSummary = {
    id: string;
    created_at: string;
    reason: string;
    status: string;
    total_amount: number;
};

export type PaymentSummary = {
    id: string;
    date: string;
    type: string;
    description: string;
    amount: number;
    reference_id?: string;
};

interface ClientDocumentsCardsProps {
    invoices: InvoiceSummary[];
    invoicePaidById: Map<string, number>;
    creditNotes: CreditNoteSummary[];
    returns: ReturnSummary[];
    payments: PaymentSummary[];
    onPrintMovement: (movement: ClientMovement) => void;
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

const formatMoney = (value: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value || 0));
};

export function ClientDocumentsCards({
    invoices,
    invoicePaidById,
    creditNotes,
    returns,
    payments,
    onPrintMovement,
}: ClientDocumentsCardsProps) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Facturas</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="max-h-[380px] overflow-auto">
                        <Table className="min-w-[760px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Comprobante</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Pagado</TableHead>
                                    <TableHead className="text-right">Pendiente</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
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
                                                <TableCell className="text-right">{formatMoney(invoice.total_amount)}</TableCell>
                                                <TableCell className="text-right text-emerald-500">{formatMoney(paid)}</TableCell>
                                                <TableCell className="text-right font-semibold">{formatMoney(pending)}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() => onPrintMovement({
                                                            id: `inv-${invoice.id}`,
                                                            date: invoice.issue_date,
                                                            type: "sale",
                                                            description: `Factura ${formatInvoiceLabel(invoice)}`,
                                                            amount: Number(invoice.total_amount || 0),
                                                            document_id: invoice.id,
                                                        })}
                                                    >
                                                        <Printer className="mr-1 h-4 w-4" />
                                                        Imprimir
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
                    <div className="max-h-[380px] overflow-auto">
                        <Table className="min-w-[560px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Comprobante</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {creditNotes.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
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
                                            <TableCell className="text-right text-amber-500">-{formatMoney(note.amount)}</TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => onPrintMovement({
                                                        id: `cn-${note.id}`,
                                                        date: note.created_at,
                                                        type: "credit_note",
                                                        description: `Nota de credito ${note.number}`,
                                                        amount: -Math.abs(note.amount),
                                                        document_id: note.id,
                                                    })}
                                                >
                                                    <Printer className="mr-1 h-4 w-4" />
                                                    Imprimir
                                                </Button>
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
                                                {formatMoney(row.total_amount)}
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
                    <div className="max-h-[380px] overflow-auto">
                        <Table className="min-w-[560px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead>Descripcion</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {payments.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
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
                                                    {isPayment ? "-" : ""}{formatMoney(tx.amount)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {isPayment ? (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            onClick={() => onPrintMovement({
                                                                id: `pay-${tx.id}`,
                                                                date: tx.date,
                                                                type: "payment",
                                                                description: tx.description,
                                                                amount: -Math.abs(Number(tx.amount || 0)),
                                                                document_id: tx.id,
                                                                ...(tx.reference_id ? { related_invoice_id: tx.reference_id } : {}),
                                                            })}
                                                        >
                                                            <Printer className="mr-1 h-4 w-4" />
                                                            Imprimir
                                                        </Button>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
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
    );
}
