import { useState } from "react";
import { QualityCheckDialog, type QualityCheckItemInput } from "@/components/receptions/QualityCheckDialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Download } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { QualityCheckCreateInput } from "@/types/api";
import { queryKeys } from "@/lib/queryKeys";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PendingOrdersSection } from "@/components/receptions/PendingOrdersSection";
import { ReceptionForm } from "@/components/receptions/ReceptionForm";
import { ReceptionsHistorySection } from "@/components/receptions/ReceptionsHistorySection";
import { ReturnForm } from "@/components/receptions/ReturnForm";
import { SupplierReturnsSection } from "@/components/receptions/SupplierReturnsSection";
import { SupplierInvoiceForm, type SupplierInvoicePayload } from "@/components/suppliers/SupplierInvoiceForm";
import type {
    PendingReceptionOrder,
    ReceptionRecord,
    ReceptionsFilter,
    ReceptionsTab,
    SupplierReturnRecord,
} from "@/components/receptions/types";

type SupplierReturnRaw = Awaited<ReturnType<typeof api.getReturns>>[number];

const EMPTY_RECEPTIONS: ReceptionRecord[] = [];
const EMPTY_RETURNS: SupplierReturnRecord[] = [];
const EMPTY_PENDING_ORDERS: PendingReceptionOrder[] = [];

function readText(value: unknown, fallback = "-"): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readIsoDate(value: unknown): string {
    const candidate = typeof value === "string" && value.length > 0 ? value : new Date().toISOString();
    return candidate;
}

function toSupplierReturnRecord(row: SupplierReturnRaw): SupplierReturnRecord {
    return {
        id: readText(row.id, ""),
        return_number: readText(row.return_number),
        supplier_name: readText(row.supplier_name),
        created_at: readIsoDate(row.created_at),
        status: readText(row.status, "draft"),
    };
}

export default function ReceptionsPage() {
    const queryClient = useQueryClient();

    const [filter, setFilter] = useState<ReceptionsFilter>("all");
    const [activeTab, setActiveTab] = useState<ReceptionsTab>("pending");

    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
    const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
    const [prefilledOrderId, setPrefilledOrderId] = useState<string | undefined>(undefined);
    const [prefilledSupplierId, setPrefilledSupplierId] = useState<string | undefined>(undefined);
    const [isQcDialogOpen, setIsQcDialogOpen] = useState(false);
    const [selectedQcReception, setSelectedQcReception] = useState<ReceptionRecord | null>(null);
    const [isQcSubmitting, setIsQcSubmitting] = useState(false);

    const pendingOrdersQuery = useQuery({
        queryKey: queryKeys.purchaseOrders.pendingReception,
        queryFn: async () => {
            const orders = await api.getPurchaseOrders();
            return orders.filter((order) => order.status === "sent" || order.status === "partial");
        },
        enabled: activeTab === "pending",
    });

    const receptionsQuery = useQuery({
        queryKey: queryKeys.receptions.byFilter(filter),
        queryFn: () => api.getReceptions(filter !== "all" ? { status: filter } : undefined),
        enabled: activeTab === "history",
    });

    const supplierReturnsQuery = useQuery({
        queryKey: queryKeys.supplierReturns.all,
        queryFn: async () => {
            const rows = await api.getReturns();
            return rows.map(toSupplierReturnRecord);
        },
        enabled: activeTab === "returns",
    });

    const supplierInvoicesQuery = useQuery({
        queryKey: ["supplier-invoices"],
        queryFn: () => api.getSupplierInvoices(),
        enabled: activeTab === "invoices",
    });

    const suppliersQuery = useQuery({
        queryKey: queryKeys.suppliers.all,
        queryFn: () => api.getSuppliers(),
        enabled: activeTab === "invoices",
    });

    const createReceptionMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createReception>[0]) => api.createReception(payload),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.receptions.all }),
                queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all }),
            ]);
        },
    });

    const createReturnMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createReturn>[0]) => api.createReturn(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.supplierReturns.all });
        },
    });

    const approveReceptionMutation = useMutation({
        mutationFn: (receptionId: string) => api.approveReception(receptionId),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.receptions.all }),
                queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all }),
            ]);
        },
    });

    const approveReturnMutation = useMutation({
        mutationFn: (returnId: string) => api.approveReturn(returnId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.supplierReturns.all });
        },
    });

    const createInvoiceMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createSupplierInvoice>[0]) => api.createSupplierInvoice(payload),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] }),
                queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all }),
            ]);
        },
    });

    const receptions = receptionsQuery.data ?? EMPTY_RECEPTIONS;
    const returns = supplierReturnsQuery.data ?? EMPTY_RETURNS;
    const pendingOrders = pendingOrdersQuery.data ?? EMPTY_PENDING_ORDERS;

    const activeQuery =
        activeTab === "history"
            ? receptionsQuery
            : activeTab === "returns"
                ? supplierReturnsQuery
                : activeTab === "invoices"
                    ? supplierInvoicesQuery
                    : pendingOrdersQuery;
    const loading = activeQuery.isLoading;
    const hasLoadError = activeQuery.isError;

    function retryActiveQuery() {
        if (activeTab === "history") {
            void receptionsQuery.refetch();
            return;
        }
        if (activeTab === "returns") {
            void supplierReturnsQuery.refetch();
            return;
        }
        if (activeTab === "invoices") {
            void supplierInvoicesQuery.refetch();
            return;
        }
        void pendingOrdersQuery.refetch();
    }

    async function handleCreateReception(data: Parameters<typeof api.createReception>[0]) {
        try {
            await createReceptionMutation.mutateAsync(data);
            toast.success("Recepción registrada correctamente");
            setIsCreateDialogOpen(false);
            setPrefilledOrderId(undefined);
            setPrefilledSupplierId(undefined);
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    async function handleCreateReturn(data: Parameters<typeof api.createReturn>[0]) {
        try {
            await createReturnMutation.mutateAsync(data);
            toast.success("Devolución registrada en borrador");
            setIsReturnDialogOpen(false);
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    async function handleQcSubmit(qcItems: QualityCheckItemInput[], qcNotes: string) {
        if (!selectedQcReception) return;
        setIsQcSubmitting(true);
        try {
            for (const item of qcItems) {
                let result: "pass" | "fail" | "conditional" = "pass";
                if (item.quantityFailed === item.quantityReceived) {
                    result = "fail";
                } else if (item.quantityFailed > 0) {
                    result = "conditional";
                }

                const payload: QualityCheckCreateInput = {
                    reception_id: selectedQcReception.id,
                    product_id: item.productId,
                    result,
                    quantity_checked: item.quantityReceived,
                    quantity_passed: item.quantityPassed,
                    quantity_failed: item.quantityFailed,
                    action_taken: "approve",
                };

                if (item.defectDescription) {
                    payload.defect_description = item.defectDescription;
                }
                if (qcNotes) {
                    payload.notes = qcNotes;
                }

                await api.createQualityCheck(payload);
            }

            await approveReceptionMutation.mutateAsync(selectedQcReception.id);

            toast.success("Control de calidad y remito procesados con éxito", {
                description: `${selectedQcReception.reception_number} fue aprobado y el stock se actualizó.`,
            });
            setIsQcDialogOpen(false);
            setSelectedQcReception(null);
        } catch {
            // El ruteo de errores de react-query ya informa al usuario.
        } finally {
            setIsQcSubmitting(false);
        }
    }

    async function handleApproveReturn(id: string, returnNumber: string) {
        try {
            await approveReturnMutation.mutateAsync(id);
            toast.success("Devolución aprobada", {
                description: `${returnNumber} fue procesada correctamente.`,
            });
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    async function handleCreateSupplierInvoice(data: SupplierInvoicePayload) {
        try {
            await createInvoiceMutation.mutateAsync(data);
            toast.success("Factura registrada correctamente", {
                description: "Se actualizó el saldo del proveedor y el Libro IVA Compras contable.",
            });
            setIsInvoiceDialogOpen(false);
            await queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] });
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    const handleExportLibroIVACompras = async () => {
        try {
            const records = await api.getIVACompras();
            if (records.length === 0) {
                toast.warning("No hay comprobantes de compra aprobados para exportar.");
                return;
            }

            const headers = ["Fecha", "Tipo Comprobante", "Numero", "CUIT Proveedor", "Proveedor/Razon Social", "Neto Gravado", "IVA Credito Fiscal", "Total"];
            const rows = records.map((r) => [
                new Date(r.date).toLocaleDateString("es-AR"),
                r.type,
                r.number,
                r.tax_id,
                `"${r.supplier_name.replace(/"/g, '""')}"`,
                Number(r.subtotal).toFixed(2),
                Number(r.iva).toFixed(2),
                Number(r.total).toFixed(2)
            ]);

            const csvContent =
                "\uFEFF" +
                [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n");

            const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `libro_iva_compras_${new Date().toISOString().split("T")[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast.success("Libro IVA Compras exportado con éxito");
        } catch {
            toast.error("Error al exportar Libro IVA Compras");
        }
    };

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Mercadería entrante</h1>
                    <p className="mt-1 text-slate-600">Gestión de recepciones, devoluciones y facturas de compra.</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row w-full sm:w-auto">
                    <button
                        onClick={handleExportLibroIVACompras}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 px-4 py-2 hover:bg-slate-200 transition sm:w-auto font-medium"
                    >
                        <Download className="h-5 w-5" />
                        Exportar Libro IVA
                    </button>
                    <button
                        onClick={() => {
                            if (activeTab === "returns") {
                                setIsReturnDialogOpen(true);
                                return;
                            }
                            if (activeTab === "invoices") {
                                setIsInvoiceDialogOpen(true);
                                return;
                            }
                            setPrefilledOrderId(undefined);
                            setPrefilledSupplierId(undefined);
                            setIsCreateDialogOpen(true);
                        }}
                        className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-white transition sm:w-auto ${
                            activeTab === "returns" ? "bg-red-600 hover:bg-red-700" :
                            activeTab === "invoices" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-blue-600 hover:bg-blue-700"
                        }`}
                    >
                        {activeTab === "returns" ? <RotateCcw className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                        {activeTab === "returns" ? "Nueva devolucion" :
                         activeTab === "invoices" ? "Nueva factura" : "Nueva recepción"}
                    </button>
                </div>
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
                <button
                    onClick={() => setActiveTab("pending")}
                    className={`shrink-0 px-6 py-3 text-sm font-medium ${
                        activeTab === "pending" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-600 hover:text-slate-800"
                    }`}
                >
                    Pedidos pendientes
                </button>
                <button
                    onClick={() => setActiveTab("history")}
                    className={`shrink-0 px-6 py-3 text-sm font-medium ${
                        activeTab === "history" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-600 hover:text-slate-800"
                    }`}
                >
                    Historial (Remitos)
                </button>
                <button
                    onClick={() => setActiveTab("invoices")}
                    className={`shrink-0 px-6 py-3 text-sm font-medium ${
                        activeTab === "invoices" ? "border-b-2 border-emerald-600 text-emerald-600" : "text-slate-600 hover:text-slate-800"
                    }`}
                >
                    Facturas de Compra
                </button>
                <button
                    onClick={() => setActiveTab("returns")}
                    className={`shrink-0 px-6 py-3 text-sm font-medium ${
                        activeTab === "returns" ? "border-b-2 border-red-600 text-red-600" : "text-slate-600 hover:text-slate-800"
                    }`}
                >
                    Devoluciones
                </button>
            </div>

            {hasLoadError ? (
                <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 md:flex-row md:items-center md:justify-between">
                    <span>No pudimos cargar los datos de esta sección. Reintenta para actualizar la vista.</span>
                    <button
                        type="button"
                        onClick={retryActiveQuery}
                        className="rounded border border-red-300 px-3 py-1 font-medium text-red-700 transition hover:bg-red-100"
                    >
                        Reintentar
                    </button>
                </div>
            ) : null}

            {loading ? (
                <div className="flex h-48 items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                </div>
            ) : null}

            {!loading && activeTab === "pending" ? (
                <PendingOrdersSection
                    pendingOrders={pendingOrders}
                    onStartReception={(order) => {
                        setPrefilledOrderId(order.id);
                        setPrefilledSupplierId(order.supplier_id);
                        setIsCreateDialogOpen(true);
                    }}
                />
            ) : null}

            {!loading && activeTab === "returns" ? (
                <SupplierReturnsSection
                    returns={returns}
                    approving={approveReturnMutation.isPending}
                    onApproveReturn={(id, returnNumber) => {
                        void handleApproveReturn(id, returnNumber);
                    }}
                />
            ) : null}

            {!loading && activeTab === "history" ? (
                <ReceptionsHistorySection
                    receptions={receptions}
                    filter={filter}
                    approving={approveReceptionMutation.isPending || isQcSubmitting}
                    onFilterChange={setFilter}
                    onApproveReception={(reception) => {
                        setSelectedQcReception(reception);
                        setIsQcDialogOpen(true);
                    }}
                />
            ) : null}

            {!loading && activeTab === "invoices" ? (
                <div className="border rounded-md bg-white dark:bg-slate-950">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-900">
                                <tr>
                                    <th className="px-6 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">Tipo / Nro</th>
                                    <th className="px-6 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">Fecha Emisión</th>
                                    <th className="px-6 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">Proveedor</th>
                                    <th className="px-6 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">Vínculos</th>
                                    <th className="px-6 py-3 text-right font-semibold text-slate-500 dark:text-slate-400">Neto</th>
                                    <th className="px-6 py-3 text-right font-semibold text-slate-500 dark:text-slate-400">IVA</th>
                                    <th className="px-6 py-3 text-right font-semibold text-slate-500 dark:text-slate-400">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                {(supplierInvoicesQuery.data || []).map((inv) => (
                                    <tr key={inv.id} className="hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors">
                                        <td className="px-6 py-4 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                            Factura {inv.invoice_type} <span className="text-slate-500 font-normal">#{inv.invoice_number}</span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                            {new Date(inv.issue_date).toLocaleDateString("es-AR")}
                                        </td>
                                        <td className="px-6 py-4 text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                            <div className="font-semibold text-slate-900 dark:text-slate-100">{inv.supplier_name}</div>
                                            <div className="text-xs text-slate-500 font-mono">{inv.supplier_tax_id}</div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                            <div className="flex flex-col gap-0.5 text-xs text-slate-600 dark:text-slate-400">
                                                {inv.reception_number && <span>Remito: {inv.reception_number}</span>}
                                                {inv.po_number && <span className="text-[10px] font-mono text-slate-500">OC: {inv.po_number}</span>}
                                                {!inv.reception_number && !inv.po_number && <span className="text-slate-400 italic">Directa</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right text-slate-900 dark:text-slate-100 font-mono whitespace-nowrap">
                                            ${Number(inv.net_amount).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-6 py-4 text-right text-slate-900 dark:text-slate-100 font-mono whitespace-nowrap">
                                            ${Number(inv.vat_amount).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-6 py-4 text-right text-slate-900 dark:text-slate-100 font-bold text-emerald-600 dark:text-emerald-400 font-mono whitespace-nowrap">
                                            ${Number(inv.total_amount).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                    </tr>
                                ))}
                                {(supplierInvoicesQuery.data || []).length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                                            No hay facturas de proveedor registradas.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : null}

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Registrar ingreso de mercadería</DialogTitle>
                        <DialogDescription>Confirma cantidades recibidas y estado de cada ítem.</DialogDescription>
                    </DialogHeader>
                    <ReceptionForm
                        onSubmit={handleCreateReception}
                        onCancel={() => setIsCreateDialogOpen(false)}
                        {...(prefilledOrderId ? { initialOrderId: prefilledOrderId } : {})}
                        {...(prefilledSupplierId ? { initialSupplierId: prefilledSupplierId } : {})}
                    />
                </DialogContent>
            </Dialog>

            <Dialog open={isInvoiceDialogOpen} onOpenChange={setIsInvoiceDialogOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Cargar Factura de Proveedor</DialogTitle>
                        <DialogDescription>Registra el comprobante impositivo de compra y actualiza la deuda del proveedor.</DialogDescription>
                    </DialogHeader>
                    <SupplierInvoiceForm
                        suppliers={suppliersQuery.data ?? []}
                        onSubmit={handleCreateSupplierInvoice}
                        onCancel={() => setIsInvoiceDialogOpen(false)}
                    />
                </DialogContent>
            </Dialog>

            <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Nueva devolución a proveedor</DialogTitle>
                        <DialogDescription>Registra la salida de mercadería y su motivo.</DialogDescription>
                    </DialogHeader>
                    <ReturnForm onSubmit={handleCreateReturn} onCancel={() => setIsReturnDialogOpen(false)} />
                </DialogContent>
            </Dialog>

            <QualityCheckDialog
                key={selectedQcReception?.id || "none"}
                reception={selectedQcReception}
                open={isQcDialogOpen}
                onClose={() => {
                    setIsQcDialogOpen(false);
                    setSelectedQcReception(null);
                }}
                onSubmit={handleQcSubmit}
                submitting={isQcSubmitting}
            />
        </div>
    );
}
