import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PendingOrdersSection } from "@/components/receptions/PendingOrdersSection";
import { ReceptionForm } from "@/components/receptions/ReceptionForm";
import { ReceptionsHistorySection } from "@/components/receptions/ReceptionsHistorySection";
import { ReturnForm } from "@/components/receptions/ReturnForm";
import { SupplierReturnsSection } from "@/components/receptions/SupplierReturnsSection";
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
    const [prefilledOrderId, setPrefilledOrderId] = useState<string | undefined>(undefined);
    const [prefilledSupplierId, setPrefilledSupplierId] = useState<string | undefined>(undefined);

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

    const receptions = receptionsQuery.data ?? EMPTY_RECEPTIONS;
    const returns = supplierReturnsQuery.data ?? EMPTY_RETURNS;
    const pendingOrders = pendingOrdersQuery.data ?? EMPTY_PENDING_ORDERS;

    const activeQuery =
        activeTab === "history"
            ? receptionsQuery
            : activeTab === "returns"
                ? supplierReturnsQuery
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

    async function handleApproveReception(id: string, receptionNumber: string) {
        try {
            await approveReceptionMutation.mutateAsync(id);
            toast.success("Recepción aprobada", {
                description: `${receptionNumber} fue aprobada y el stock se actualizó.`,
            });
        } catch {
            // El manejo global de React Query ya informa el error.
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

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Mercadería entrante</h1>
                    <p className="mt-1 text-slate-600">Gestión de recepciones y devoluciones a proveedor.</p>
                </div>

                <button
                    onClick={() => {
                        if (activeTab === "returns") {
                            setIsReturnDialogOpen(true);
                            return;
                        }
                        setPrefilledOrderId(undefined);
                        setPrefilledSupplierId(undefined);
                        setIsCreateDialogOpen(true);
                    }}
                    className={`flex items-center gap-2 rounded-lg px-4 py-2 text-white transition ${
                        activeTab === "returns" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                >
                    {activeTab === "returns" ? <RotateCcw className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    {activeTab === "returns" ? "Nueva devolución" : "Nueva recepción"}
                </button>
            </div>

            <div className="flex border-b border-slate-200">
                <button
                    onClick={() => setActiveTab("pending")}
                    className={`px-6 py-3 text-sm font-medium ${
                        activeTab === "pending" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-600 hover:text-slate-800"
                    }`}
                >
                    Pedidos pendientes
                </button>
                <button
                    onClick={() => setActiveTab("history")}
                    className={`px-6 py-3 text-sm font-medium ${
                        activeTab === "history" ? "border-b-2 border-blue-600 text-blue-600" : "text-slate-600 hover:text-slate-800"
                    }`}
                >
                    Historial
                </button>
                <button
                    onClick={() => setActiveTab("returns")}
                    className={`px-6 py-3 text-sm font-medium ${
                        activeTab === "returns" ? "border-b-2 border-red-600 text-red-600" : "text-slate-600 hover:text-slate-800"
                    }`}
                >
                    Devoluciones
                </button>
            </div>

            {hasLoadError ? (
                <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 md:flex-row md:items-center md:justify-between">
                    <span>No pudimos cargar los datos de esta seccion. Reintenta para actualizar la vista.</span>
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
                    approving={approveReceptionMutation.isPending}
                    onFilterChange={setFilter}
                    onApproveReception={(id, receptionNumber) => {
                        void handleApproveReception(id, receptionNumber);
                    }}
                />
            ) : null}

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
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

            <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
                <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Nueva devolución a proveedor</DialogTitle>
                        <DialogDescription>Registra la salida de mercadería y su motivo.</DialogDescription>
                    </DialogHeader>
                    <ReturnForm onSubmit={handleCreateReturn} onCancel={() => setIsReturnDialogOpen(false)} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
