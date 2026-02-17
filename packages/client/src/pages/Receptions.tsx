import { useEffect, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    Clock,
    PackageCheck,
    Plus,
    RotateCcw,
    ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { PurchaseOrder } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ReceptionForm } from "@/components/receptions/ReceptionForm";
import { ReturnForm } from "@/components/receptions/ReturnForm";

type ReceptionRecord = Awaited<ReturnType<typeof api.getReceptions>>[number];
type SupplierReturnRaw = Awaited<ReturnType<typeof api.getReturns>>[number];

type SupplierReturnRecord = {
    id: string;
    return_number: string;
    supplier_name: string;
    created_at: string;
    status: string;
};

type ReceptionsFilter = "all" | "pending_qc" | "approved" | "rejected";
type ReceptionsTab = "pending" | "history" | "returns";

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

function receptionStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        pending_qc: "Pendiente QC",
        approved: "Aprobada",
        partially_approved: "Aprobada parcial",
        rejected: "Rechazada",
    };
    return labels[status] ?? status;
}

function returnStatusLabel(status: string): string {
    if (status === "draft") return "Borrador";
    if (status === "approved") return "Aprobada";
    return status;
}

function statusBadgeClass(status: string): string {
    const map: Record<string, string> = {
        pending_qc: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
        approved: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
        partially_approved: "bg-sky-100 text-sky-800 ring-1 ring-sky-200",
        rejected: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
        draft: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    };
    return `rounded-full px-2 py-1 text-xs font-semibold ${map[status] ?? "bg-slate-100 text-slate-700 ring-1 ring-slate-200"}`;
}

function calculateOrderProgress(order: PurchaseOrder): number {
    const items = order.items ?? [];
    const totalOrdered = items.reduce((sum, item) => sum + Number(item.quantity_ordered ?? item.quantity ?? 0), 0);
    const totalReceived = items.reduce((sum, item) => sum + Number(item.quantity_received ?? item.received_quantity ?? 0), 0);
    if (totalOrdered <= 0) return 0;
    return Math.round((totalReceived / totalOrdered) * 100);
}

const tableHeadClass = "px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700";
const tableHeadRightClass = "px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700";
const tableCellClass = "px-6 py-4 text-slate-800";
const tableCellStrongClass = "px-6 py-4 font-semibold text-slate-900";

export default function ReceptionsPage() {
    const [receptions, setReceptions] = useState<ReceptionRecord[]>([]);
    const [returns, setReturns] = useState<SupplierReturnRecord[]>([]);
    const [pendingOrders, setPendingOrders] = useState<PurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);

    const [filter, setFilter] = useState<ReceptionsFilter>("all");
    const [activeTab, setActiveTab] = useState<ReceptionsTab>("pending");

    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);
    const [prefilledOrderId, setPrefilledOrderId] = useState<string | undefined>(undefined);
    const [prefilledSupplierId, setPrefilledSupplierId] = useState<string | undefined>(undefined);

    useEffect(() => {
        void loadData();
    }, [filter, activeTab]);

    async function loadData() {
        try {
            setLoading(true);

            if (activeTab === "history") {
                const filters = filter !== "all" ? { status: filter } : undefined;
                const response = await api.getReceptions(filters);
                setReceptions(response);
                return;
            }

            if (activeTab === "returns") {
                const response = await api.getReturns();
                setReturns(response.map(toSupplierReturnRecord));
                return;
            }

            const orders = await api.getPurchaseOrders();
            setPendingOrders(orders.filter((order) => order.status === "sent" || order.status === "partial"));
        } catch (error) {
            showErrorToast("Error al cargar datos de recepciones", error);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateReception(data: Parameters<typeof api.createReception>[0]) {
        try {
            await api.createReception(data);
            toast.success("Recepcion registrada correctamente");
            setIsCreateDialogOpen(false);
            setPrefilledOrderId(undefined);
            setPrefilledSupplierId(undefined);
            await loadData();
        } catch (error) {
            showErrorToast("Error al registrar recepcion", error);
        }
    }

    async function handleCreateReturn(data: Parameters<typeof api.createReturn>[0]) {
        try {
            await api.createReturn(data);
            toast.success("Devolucion registrada en borrador");
            setIsReturnDialogOpen(false);
            await loadData();
        } catch (error) {
            showErrorToast("Error al registrar devolucion", error);
        }
    }

    async function handleApproveReception(id: string, receptionNumber: string) {
        try {
            await api.approveReception(id);
            toast.success("Recepcion aprobada", {
                description: `${receptionNumber} fue aprobada y el stock se actualizo.`,
            });
            await loadData();
        } catch (error) {
            showErrorToast("Error al aprobar recepcion", error);
        }
    }

    async function handleApproveReturn(id: string, returnNumber: string) {
        try {
            await api.approveReturn(id);
            toast.success("Devolucion aprobada", {
                description: `${returnNumber} fue procesada correctamente.`,
            });
            await loadData();
        } catch (error) {
            showErrorToast("Error al aprobar devolucion", error);
        }
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Mercaderia entrante</h1>
                    <p className="mt-1 text-slate-600">Gestion de recepciones y devoluciones a proveedor.</p>
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
                    {activeTab === "returns" ? "Nueva devolucion" : "Nueva recepcion"}
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

            {loading ? (
                <div className="flex h-48 items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                </div>
            ) : null}

            {!loading && activeTab === "pending" ? (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900">
                    {pendingOrders.length === 0 ? (
                        <div className="p-12 text-center">
                            <ShoppingCart className="mx-auto mb-4 h-16 w-16 text-slate-300" />
                            <h3 className="mb-2 text-lg font-medium text-slate-900">No hay pedidos pendientes</h3>
                            <p className="text-slate-600">Todos los pedidos aprobados fueron recepcionados.</p>
                        </div>
                    ) : (
                        <table className="w-full text-slate-900">
                            <thead className="border-b border-slate-200 bg-slate-50">
                                <tr>
                                    <th className={tableHeadClass}>Orden</th>
                                    <th className={tableHeadClass}>Proveedor</th>
                                    <th className={tableHeadClass}>Fecha</th>
                                    <th className={tableHeadClass}>Progreso</th>
                                    <th className={tableHeadRightClass}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 text-slate-800">
                                {pendingOrders.map((order) => {
                                    const progress = calculateOrderProgress(order);
                                    return (
                                        <tr key={order.id} className="hover:bg-slate-50">
                                            <td className={tableCellStrongClass}>{order.po_number ?? order.id}</td>
                                            <td className={tableCellClass}>{order.supplier_name ?? "-"}</td>
                                            <td className={tableCellClass}>{order.order_date ? new Date(order.order_date).toLocaleDateString("es-AR") : "-"}</td>
                                            <td className="w-48 px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Progress value={progress} className="h-2" />
                                                    <span className="text-xs font-medium">{progress}%</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    onClick={() => {
                                                        setPrefilledOrderId(order.id);
                                                        setPrefilledSupplierId(order.supplier_id);
                                                        setIsCreateDialogOpen(true);
                                                    }}
                                                    className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-green-700"
                                                >
                                                    Comenzar recepcion
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            ) : null}

            {!loading && activeTab === "returns" ? (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900">
                    {returns.length === 0 ? (
                        <div className="p-12 text-center">
                            <RotateCcw className="mx-auto mb-4 h-16 w-16 text-slate-300" />
                            <h3 className="mb-2 text-lg font-medium text-slate-900">No hay devoluciones</h3>
                        </div>
                    ) : (
                        <table className="w-full text-slate-900">
                            <thead className="border-b border-slate-200 bg-slate-50">
                                <tr>
                                    <th className={tableHeadClass}>Referencia</th>
                                    <th className={tableHeadClass}>Proveedor</th>
                                    <th className={tableHeadClass}>Fecha</th>
                                    <th className={tableHeadClass}>Estado</th>
                                    <th className={tableHeadRightClass}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 text-slate-800">
                                {returns.map((supplierReturn) => (
                                    <tr key={supplierReturn.id} className="hover:bg-slate-50">
                                        <td className={tableCellStrongClass}>{supplierReturn.return_number}</td>
                                        <td className={tableCellClass}>{supplierReturn.supplier_name}</td>
                                        <td className={tableCellClass}>{new Date(supplierReturn.created_at).toLocaleDateString("es-AR")}</td>
                                        <td className={tableCellClass}>
                                            <span className={statusBadgeClass(supplierReturn.status)}>{returnStatusLabel(supplierReturn.status)}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {supplierReturn.status === "draft" ? (
                                                <button
                                                    onClick={() => void handleApproveReturn(supplierReturn.id, supplierReturn.return_number)}
                                                    className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-red-700"
                                                >
                                                    Aprobar salida
                                                </button>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            ) : null}

            {!loading && activeTab === "history" ? (
                <div className="space-y-4">
                    <div className="flex gap-2">
                        {(["all", "pending_qc", "approved", "rejected"] as const).map((status) => (
                            <button
                                key={status}
                                onClick={() => setFilter(status)}
                                className={`rounded px-4 py-2 text-sm font-medium transition ${
                                    filter === status ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                }`}
                            >
                                {status === "all" ? "Todas" : receptionStatusLabel(status)}
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                        <div className="rounded-lg border bg-white p-4 text-slate-900">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-600">Total</p>
                                    <p className="text-2xl font-bold">{receptions.length}</p>
                                </div>
                                <PackageCheck className="h-8 w-8 text-blue-600" />
                            </div>
                        </div>
                        <div className="rounded-lg border bg-white p-4 text-slate-900">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-600">Pendiente QC</p>
                                    <p className="text-2xl font-bold text-amber-600">{receptions.filter((item) => item.status === "pending_qc").length}</p>
                                </div>
                                <Clock className="h-8 w-8 text-amber-600" />
                            </div>
                        </div>
                        <div className="rounded-lg border bg-white p-4 text-slate-900">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-600">Aprobadas</p>
                                    <p className="text-2xl font-bold text-green-600">{receptions.filter((item) => item.status === "approved").length}</p>
                                </div>
                                <CheckCircle2 className="h-8 w-8 text-green-600" />
                            </div>
                        </div>
                        <div className="rounded-lg border bg-white p-4 text-slate-900">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-600">Rechazadas</p>
                                    <p className="text-2xl font-bold text-red-600">{receptions.filter((item) => item.status === "rejected").length}</p>
                                </div>
                                <AlertCircle className="h-8 w-8 text-red-600" />
                            </div>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900">
                        {receptions.length === 0 ? (
                            <div className="p-12 text-center text-slate-600">No hay recepciones.</div>
                        ) : (
                            <table className="w-full">
                                <thead className="border-b border-slate-200 bg-slate-50">
                                    <tr>
                                        <th className={tableHeadClass}>Numero</th>
                                        <th className={tableHeadClass}>Proveedor</th>
                                        <th className={tableHeadClass}>OC</th>
                                        <th className={tableHeadClass}>Fecha</th>
                                        <th className={tableHeadClass}>Estado</th>
                                        <th className={tableHeadRightClass}>Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 text-slate-800">
                                    {receptions.map((reception) => (
                                        <tr key={reception.id} className="hover:bg-slate-50">
                                            <td className={tableCellStrongClass}>{reception.reception_number}</td>
                                            <td className={tableCellClass}>{reception.supplier_name}</td>
                                            <td className={tableCellClass}>{reception.po_number ?? "-"}</td>
                                            <td className={tableCellClass}>
                                                {reception.reception_date ? new Date(reception.reception_date).toLocaleString("es-AR") : "-"}
                                            </td>
                                            <td className={tableCellClass}>
                                                <span className={statusBadgeClass(reception.status)}>{receptionStatusLabel(reception.status)}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {reception.status === "pending_qc" ? (
                                                    <button
                                                        onClick={() => void handleApproveReception(reception.id, reception.reception_number)}
                                                        className="rounded bg-green-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-green-700"
                                                    >
                                                        Aprobar
                                                    </button>
                                                ) : null}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            ) : null}

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Registrar ingreso de mercaderia</DialogTitle>
                        <DialogDescription>Confirma cantidades recibidas y estado de cada item.</DialogDescription>
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
                        <DialogTitle>Nueva devolucion a proveedor</DialogTitle>
                        <DialogDescription>Registra la salida de mercaderia y su motivo.</DialogDescription>
                    </DialogHeader>
                    <ReturnForm onSubmit={handleCreateReturn} onCancel={() => setIsReturnDialogOpen(false)} />
                </DialogContent>
            </Dialog>
        </div>
    );
}
