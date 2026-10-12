import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/services/api";
import { showErrorToast } from "@/lib/errorHandling";
import { createClientUuid } from "@/lib/clientUuid";
import { formatMoney } from "@/lib/formatters";
import type {
    PendingInvoiceResponse,
    BulkPaymentAllocation,
    InvoicePaymentLineInput,
    BulkPaymentInput,
    CustomerCheck,
    FiscalSaleStatus,
} from "@/types/api";
import type { Client } from "@/types";
import {
    CollectionsFiscalSalesCard,
} from "@/components/collections/CollectionsFiscalSalesCard";
import {
    CollectionsChecksPortfolioCard,
} from "@/components/collections/CollectionsChecksPortfolioCard";
import {
    CollectionsPendingInvoicesCard,
} from "@/components/collections/CollectionsPendingInvoicesCard";
import {
    CollectionsPaymentFormCard,
} from "@/components/collections/CollectionsPaymentFormCard";
import type { PaymentLine, CheckPortfolioFilter } from "@/components/collections/types";

function createPaymentLine(defaultAmount = ""): PaymentLine {
    return {
        id: createClientUuid(),
        method: "cash",
        amount: defaultAmount,
        check: { issuer_name: "", bank_name: "", check_number: "", issue_date: "", due_date: "" },
    };
}

export default function CollectionsPage() {
    const queryClient = useQueryClient();

    // 1. Fetch data
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

    const { data: selectedCheck, isFetching: isLoadingCheck } = useQuery<CustomerCheck>({
        queryKey: ["collections", "checks", selectedCheckId],
        queryFn: () => api.getCustomerCheck(selectedCheckId!),
        enabled: Boolean(selectedCheckId),
    });

    // 4. Client's invoices
    const clientInvoices = useMemo(() => {
        if (!selectedClientId) return [];
        return pendingInvoices.filter((inv) => inv.client_id === selectedClientId);
    }, [selectedClientId, pendingInvoices]);

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
            newSet = new Set(clientInvoices.map((inv) => inv.id));
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
            const remainingPayments = paymentLines.map((p) => ({
                method: p.method,
                amount: Number(p.amount || 0),
                ...(p.method === "check"
                    ? {
                        check: {
                            ...p.check,
                            instrument_amount: Number(p.amount || 0),
                        },
                    }
                    : {}),
            }));

            const selectedInvoiceObjects = clientInvoices.filter((inv) => selectedInvoiceIds.has(inv.id));

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
                        ...(pay.check ? { check: pay.check } : {}),
                    });
                }

                if (invPayments.length > 0) {
                    allocations.push({
                        documentId: inv.id,
                        documentType: inv.document_type,
                        payments: invPayments,
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
                description: `Se aplicaron ${formatMoney(data.total_paid)} a cuenta corriente.`,
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
        },
    });

    const isSubmitDisabled =
        !selectedClientId ||
        selectedInvoiceIds.size === 0 ||
        paymentLines.some(
            (line) =>
                Number(line.amount || 0) <= 0 ||
                (line.method === "check" &&
                    (!line.check.issuer_name || !line.check.bank_name || !line.check.check_number || !line.check.due_date)),
        ) ||
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
                    <CollectionsPendingInvoicesCard
                        clients={clientsForCollection}
                        selectedClientId={selectedClientId}
                        onSelectClient={(val) => {
                            setSelectedClientId(val);
                            setSelectedInvoiceIds(new Set());
                            setPaymentLines([createPaymentLine()]);
                            setPaymentNotes("");
                        }}
                        isLoading={isLoading}
                        hasLoadError={Boolean(hasLoadError)}
                        clientInvoices={clientInvoices}
                        selectedInvoiceIds={selectedInvoiceIds}
                        onToggleInvoice={toggleInvoiceSelection}
                        onToggleAllInvoices={toggleAllInvoices}
                    />
                </div>

                {/* Panel Derecho: Pagos y Resumen */}
                <div className="md:col-span-4 flex flex-col gap-6">
                    <CollectionsPaymentFormCard
                        isActive={Boolean(selectedClientId && selectedInvoiceIds.size > 0)}
                        totalSelected={totalSelected}
                        totalToRegister={totalToRegister}
                        remainingToAssign={remainingToAssign}
                        paymentLines={paymentLines}
                        onUpdatePaymentLine={updatePaymentLine}
                        onRemovePaymentLine={(lineId) =>
                            setPaymentLines((prev) => (prev.length <= 1 ? prev : prev.filter((entry) => entry.id !== lineId)))
                        }
                        onAddPaymentLine={() =>
                            setPaymentLines((prev) => [
                                ...prev,
                                createPaymentLine(remainingToAssign > 0 ? String(remainingToAssign.toFixed(2)) : ""),
                            ])
                        }
                        paymentNotes={paymentNotes}
                        onPaymentNotesChange={setPaymentNotes}
                        isSubmitDisabled={isSubmitDisabled}
                        isRegistering={isRegistering}
                        onSubmit={() => registerBulk()}
                    />
                </div>
            </div>

            <CollectionsFiscalSalesCard
                fiscalSales={fiscalSales}
                page={fiscalPage}
                onPageChange={setFiscalPage}
            />

            <CollectionsChecksPortfolioCard
                checks={customerChecks}
                filter={checkFilter}
                onFilterChange={setCheckFilter}
                page={checkPage}
                onPageChange={setCheckPage}
                selectedCheckId={selectedCheckId}
                onSelectCheck={(check) => {
                    if (check) {
                        setSelectedCheckId(check.id);
                        setCheckStatus(check.status);
                        setCheckDeliveredTo(check.delivered_to || "");
                        setCheckNotes("");
                    } else {
                        setSelectedCheckId(null);
                    }
                }}
                selectedCheck={selectedCheck}
                isLoadingCheck={isLoadingCheck}
                checkStatus={checkStatus}
                onCheckStatusChange={setCheckStatus}
                checkDeliveredTo={checkDeliveredTo}
                onCheckDeliveredToChange={setCheckDeliveredTo}
                checkNotes={checkNotes}
                onCheckNotesChange={setCheckNotes}
                onSaveStatus={async () => {
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
                }}
            />
        </div>
    );
}
