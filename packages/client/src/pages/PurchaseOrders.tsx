import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Eye, Package, Plus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { PurchaseOrder } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PurchaseOrderForm } from "@/components/purchase-orders/PurchaseOrderForm";
import { PurchaseOrderDetails } from "@/components/purchase-orders/PurchaseOrderDetails";

type OrderStatus = PurchaseOrder["status"];
type OrderFilter = "all" | "draft" | "sent" | "partial" | "received";

function statusLabel(status: OrderStatus): string {
    const labels: Record<OrderStatus, string> = {
        draft: "Borrador",
        sent: "Enviada",
        partial: "Parcial",
        received: "Recibida",
        cancelled: "Cancelada",
        ordered: "Ordenada",
        completed: "Completada",
    };
    return labels[status] ?? status;
}

function statusBadgeClass(status: OrderStatus): string {
    const styles: Record<OrderStatus, string> = {
        draft: "bg-slate-100 text-slate-700",
        sent: "bg-blue-100 text-blue-700",
        partial: "bg-amber-100 text-amber-700",
        received: "bg-emerald-100 text-emerald-700",
        cancelled: "bg-red-100 text-red-700",
        ordered: "bg-blue-100 text-blue-700",
        completed: "bg-emerald-100 text-emerald-700",
    };
    return `rounded-full px-2 py-1 text-xs font-medium ${styles[status]}`;
}

function statusIcon(status: OrderStatus) {
    switch (status) {
        case "received":
        case "completed":
            return <CheckCircle2 className="h-5 w-5 text-green-600" />;
        case "partial":
            return <Clock className="h-5 w-5 text-amber-600" />;
        case "cancelled":
            return <XCircle className="h-5 w-5 text-red-600" />;
        default:
            return <Clock className="h-5 w-5 text-slate-400" />;
    }
}

export default function PurchaseOrdersPage() {
    const [orders, setOrders] = useState<PurchaseOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<OrderFilter>("all");
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

    useEffect(() => {
        void loadOrders();
    }, [filter]);

    async function loadOrders() {
        try {
            setLoading(true);
            const filters = filter !== "all" ? { status: filter } : undefined;
            const response = await api.getPurchaseOrders(filters);
            setOrders(response);
        } catch (error) {
            showErrorToast("Error al cargar ordenes de compra", error);
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateOrder(data: Parameters<typeof api.createPurchaseOrder>[0]) {
        try {
            await api.createPurchaseOrder(data);
            toast.success("Orden de compra creada");
            setIsCreateDialogOpen(false);
            await loadOrders();
        } catch (error) {
            showErrorToast("Error al crear la orden", error);
            throw error;
        }
    }

    async function handleApprove(orderId: string) {
        try {
            await api.updatePurchaseOrderStatus(orderId, "sent");
            toast.success("Orden aprobada y enviada");
            await loadOrders();
        } catch (error) {
            showErrorToast("Error al aprobar la orden", error);
        }
    }

    const totalValue = orders.reduce((sum, order) => sum + Number(order.total_amount ?? 0), 0);
    const pendingCount = orders.filter((order) => order.status === "sent" || order.status === "partial").length;
    const receivedCount = orders.filter((order) => order.status === "received" || order.status === "completed").length;

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Ordenes de compra</h1>
                    <p className="mt-1 text-slate-600">Gestiona compras y seguimiento de recepcion.</p>
                </div>
                <button
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
                >
                    <Plus className="h-5 w-5" />
                    Nueva orden
                </button>
            </div>

            <div className="flex gap-2">
                {(["all", "draft", "sent", "partial", "received"] as const).map((statusFilter) => (
                    <button
                        key={statusFilter}
                        onClick={() => setFilter(statusFilter)}
                        className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                            filter === statusFilter ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                    >
                        {statusFilter === "all" ? "Todas" : statusLabel(statusFilter)}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600">Total ordenes</p>
                            <p className="text-2xl font-bold text-slate-900">{orders.length}</p>
                        </div>
                        <Package className="h-8 w-8 text-blue-600" />
                    </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600">Pendientes</p>
                            <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
                        </div>
                        <Clock className="h-8 w-8 text-amber-600" />
                    </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600">Recibidas</p>
                            <p className="text-2xl font-bold text-emerald-600">{receivedCount}</p>
                        </div>
                        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                    </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-slate-600">Valor total</p>
                            <p className="text-2xl font-bold text-slate-900">${totalValue.toLocaleString("es-AR")}</p>
                        </div>
                        <Package className="h-8 w-8 text-slate-400" />
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                {loading ? (
                    <div className="flex h-48 items-center justify-center">
                        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
                    </div>
                ) : orders.length === 0 ? (
                    <div className="p-12 text-center">
                        <Package className="mx-auto mb-4 h-16 w-16 text-slate-300" />
                        <h3 className="mb-2 text-lg font-medium text-slate-900">No hay ordenes para mostrar</h3>
                        <p className="text-slate-600">
                            {filter === "all" ? "Crea la primera orden de compra para comenzar." : `No hay ordenes en estado ${statusLabel(filter)}.`}
                        </p>
                    </div>
                ) : (
                    <table className="w-full">
                        <thead className="border-b border-slate-200 bg-slate-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Numero OC</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Proveedor</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Fecha</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Entrega</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Estado</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Total</th>
                                <th className="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Items</th>
                                <th className="px-6 py-3 text-right text-xs font-medium uppercase text-slate-500">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {orders.map((order) => (
                                <tr key={order.id} className="transition hover:bg-slate-50">
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            {statusIcon(order.status)}
                                            <span className="font-medium text-slate-900">{order.po_number ?? order.id}</span>
                                        </div>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-slate-700">{order.supplier_name ?? "-"}</td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">
                                        {order.order_date ? new Date(order.order_date).toLocaleDateString("es-AR") : "-"}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">
                                        {order.expected_delivery_date ? new Date(order.expected_delivery_date).toLocaleDateString("es-AR") : "-"}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <span className={statusBadgeClass(order.status)}>{statusLabel(order.status)}</span>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 font-medium text-slate-900">
                                        ${Number(order.total_amount ?? 0).toLocaleString("es-AR")}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-600">{order.items?.length ?? 0}</td>
                                    <td className="space-x-2 whitespace-nowrap px-6 py-4 text-right">
                                        {order.status === "draft" ? (
                                            <button
                                                onClick={() => void handleApprove(order.id)}
                                                className="rounded bg-green-50 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-green-700 transition hover:bg-green-100"
                                            >
                                                Aprobar
                                            </button>
                                        ) : null}
                                        <button
                                            onClick={() => setSelectedOrderId(order.id)}
                                            className="inline-block align-middle text-blue-600 transition hover:text-blue-800"
                                            title="Ver detalles"
                                        >
                                            <Eye className="h-5 w-5" />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Nueva orden de compra</DialogTitle>
                        <DialogDescription>Completa los datos para crear una nueva orden.</DialogDescription>
                    </DialogHeader>
                    <PurchaseOrderForm onSubmit={handleCreateOrder} onCancel={() => setIsCreateDialogOpen(false)} />
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(selectedOrderId)} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
                <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            Detalles de orden: {orders.find((order) => order.id === selectedOrderId)?.po_number ?? selectedOrderId ?? "-"}
                        </DialogTitle>
                    </DialogHeader>
                    {selectedOrderId ? <PurchaseOrderDetails orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} /> : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}
