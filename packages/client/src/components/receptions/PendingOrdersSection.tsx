import { ShoppingCart } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { PendingReceptionOrder } from "./types";

const tableHeadClass = "px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300";
const tableHeadRightClass = "px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300";
const tableCellClass = "px-6 py-4 text-slate-800 dark:text-slate-200";
const tableCellStrongClass = "px-6 py-4 font-semibold text-slate-900 dark:text-slate-100";

function calculateOrderProgress(order: PendingReceptionOrder): number {
    const items = order.items ?? [];
    const totalOrdered = items.reduce((sum, item) => sum + Number(item.quantity_ordered ?? item.quantity ?? 0), 0);
    const totalReceived = items.reduce((sum, item) => sum + Number(item.quantity_received ?? item.received_quantity ?? 0), 0);
    if (totalOrdered <= 0) return 0;
    return Math.round((totalReceived / totalOrdered) * 100);
}

type PendingOrdersSectionProps = {
    pendingOrders: PendingReceptionOrder[];
    onStartReception: (order: PendingReceptionOrder) => void;
};

export function PendingOrdersSection({ pendingOrders, onStartReception }: PendingOrdersSectionProps) {
    return (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 text-slate-900 dark:text-slate-100">
            {pendingOrders.length === 0 ? (
                <div className="p-12 text-center">
                    <ShoppingCart className="mx-auto mb-4 h-16 w-16 text-slate-300 dark:text-slate-700" />
                    <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">No hay pedidos pendientes</h3>
                    <p className="text-slate-600 dark:text-slate-400">Todos los pedidos aprobados fueron recepcionados.</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-slate-900 dark:text-slate-100">
                        <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
                            <tr>
                                <th className={tableHeadClass}>Orden</th>
                                <th className={tableHeadClass}>Proveedor</th>
                                <th className={tableHeadClass}>Fecha</th>
                                <th className={tableHeadClass}>Progreso</th>
                                <th className={tableHeadRightClass}>Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950/40">
                            {pendingOrders.map((order) => {
                                const progress = calculateOrderProgress(order);
                                return (
                                    <tr key={order.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-900/20">
                                        <td className={tableCellStrongClass}>{order.po_number ?? order.id}</td>
                                        <td className={tableCellClass}>{order.supplier_name ?? "-"}</td>
                                        <td className={tableCellClass}>
                                            {order.order_date ? new Date(order.order_date).toLocaleDateString("es-AR") : "-"}
                                        </td>
                                        <td className="w-48 px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <Progress value={progress} className="h-2" />
                                                <span className="text-xs font-medium">{progress}%</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                onClick={() => onStartReception(order)}
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
                </div>
            )}
        </div>
    );
}
