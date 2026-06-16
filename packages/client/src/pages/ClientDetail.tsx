import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/services/api";
import type { Client, Order, Transaction } from "@/types";
import type { Invoice } from "@/types/api";
import { showErrorToast } from "@/lib/errorHandling";

// Extracted Subcomponents
import { ClientHeaderCard } from "@/components/clients/ClientHeaderCard";
import { ClientTotalsCards } from "@/components/clients/ClientTotalsCards";
import { ClientMovementsCard } from "@/components/clients/ClientMovementsCard";
import type { ClientMovement } from "@/components/clients/ClientMovementsCard";
import { ClientOrdersAndWarrantiesCards } from "@/components/clients/ClientOrdersAndWarrantiesCards";
import type { WarrantySummary } from "@/components/clients/ClientOrdersAndWarrantiesCards";
import { ClientDocumentsCards } from "@/components/clients/ClientDocumentsCards";
import type { InvoiceSummary, CreditNoteSummary, ReturnSummary, PaymentSummary } from "@/components/clients/ClientDocumentsCards";
import { ClientPaymentDialog } from "@/components/clients/ClientPaymentDialog";

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


function movementPrintTitle(movement: ClientMovement): string {
    if (movement.type === "sale") return "Comprobante de factura";
    if (movement.type === "credit_note") return "Comprobante de nota de credito";
    if (movement.type === "payment") return "Recibo de pago";
    return "Comprobante";
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
        document_id: String(invoice.id),
    }));

    const creditRows: ClientMovement[] = creditNotes.map((credit) => ({
        id: String(credit.id || crypto.randomUUID()),
        date: String(credit.created_at || new Date().toISOString()),
        type: "credit_note",
        description: `Nota de credito ${String(credit.number || credit.id || "-")}`,
        amount: -Math.abs(Number(credit.amount || 0)),
        document_id: String(credit.id || ""),
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
                document_id: txId,
                ...(txReferenceId ? { related_invoice_id: txReferenceId } : {}),
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
                document_id: txId,
            }];
        }

        return [{
            id: String(tx.id || crypto.randomUUID()),
            date: readDate(tx.date),
            type: "payment" as const,
            description: txDescription,
            amount: txAmount,
            document_id: String(tx.id || ""),
            ...(txReferenceId ? { related_invoice_id: txReferenceId } : {}),
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
    const [printMovement, setPrintMovement] = useState<ClientMovement | null>(null);
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

    function printMovementVoucher(movement: ClientMovement) {
        setPrintMovement(movement);
        window.setTimeout(() => {
            window.print();
        }, 120);
    }

    if (loading) {
        return <div className="p-8 text-center text-muted-foreground">Cargando cliente...</div>;
    }

    if (!client) {
        return (
            <div className="space-y-4 p-8 text-center">
                <h2 className="text-xl font-bold text-red-600">Cliente no encontrado</h2>
                <button onClick={() => navigate("/clients")} className="px-4 py-2 border rounded-md hover:bg-slate-50">
                    Volver
                </button>
            </div>
        );
    }

    return (
        <>
        <div className="space-y-6 print:hidden">
            <ClientHeaderCard
                client={client}
                accountTotals={accountTotals}
                openInvoices={openInvoices}
                onOpenPaymentDialog={() => setPaymentDialogOpen(true)}
                onBack={() => navigate("/clients")}
            />

            <ClientTotalsCards accountTotals={accountTotals} />

            <ClientMovementsCard
                movements={movements}
                onPrint={printMovementVoucher}
            />

            <ClientOrdersAndWarrantiesCards
                orders={orders}
                warranties={warranties}
                onViewInvoice={(invoiceId) => navigate(`/invoices?invoice_id=${encodeURIComponent(invoiceId)}`)}
            />

            <ClientDocumentsCards
                invoices={invoices}
                invoicePaidById={invoicePaidById}
                creditNotes={creditNotes}
                returns={returns}
                payments={payments}
                onPrintMovement={printMovementVoucher}
            />

            <ClientPaymentDialog
                open={paymentDialogOpen}
                onOpenChange={setPaymentDialogOpen}
                openInvoices={openInvoices}
                invoices={invoices}
                invoicePaidById={invoicePaidById}
                onSuccess={loadClientData}
            />
        </div>

        <div id="printable-client-document" className="hidden print:block">
            {printMovement ? (
                <div className="mx-auto max-w-[800px] p-8 text-black">
                    <div className="mb-6 border-b border-black pb-4">
                        <h1 className="text-2xl font-bold">{movementPrintTitle(printMovement)}</h1>
                        <p className="text-sm">Emitido: {new Date(printMovement.date).toLocaleDateString("es-AR")}</p>
                    </div>

                    <div className="mb-6 grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <p className="font-semibold">Cliente</p>
                            <p>{client.name}</p>
                            <p>CUIT/DNI: {client.tax_id || "-"}</p>
                            <p>Telefono: {client.phone || "-"}</p>
                        </div>
                        <div>
                            <p className="font-semibold">Referencia</p>
                            <p>ID mov.: {printMovement.id}</p>
                            <p>Documento: {printMovement.document_id || "-"}</p>
                            <p>Factura ref.: {printMovement.related_invoice_id || "-"}</p>
                        </div>
                    </div>

                    <div className="rounded border border-black p-4">
                        <p className="mb-2 text-sm font-semibold">Detalle</p>
                        <p className="mb-4 text-sm">{printMovement.description}</p>
                        <div className="flex items-center justify-between border-t border-black pt-3">
                            <span className="text-sm font-semibold">Importe</span>
                            <span className="text-lg font-bold">{formatMoney(printMovement.amount)}</span>
                        </div>
                    </div>

                    <div className="mt-8 text-xs">
                        <p>Este comprobante fue generado por WSM SportsERP.</p>
                    </div>
                </div>
            ) : null}
        </div>
        </>
    );
}
