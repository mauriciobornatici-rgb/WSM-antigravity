import { RotateCcw } from "lucide-react";
import { returnStatusLabel, statusBadgeClass } from "./receptionStatus";
import type { SupplierReturnRecord } from "./types";

const tableHeadClass = "px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700";
const tableHeadRightClass = "px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700";
const tableCellClass = "px-6 py-4 text-slate-800";
const tableCellStrongClass = "px-6 py-4 font-semibold text-slate-900";

type SupplierReturnsSectionProps = {
    returns: SupplierReturnRecord[];
    approving: boolean;
    onApproveReturn: (id: string, returnNumber: string) => void;
};

export function SupplierReturnsSection({ returns, approving, onApproveReturn }: SupplierReturnsSectionProps) {
    return (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900">
            {returns.length === 0 ? (
                <div className="p-12 text-center">
                    <RotateCcw className="mx-auto mb-4 h-16 w-16 text-slate-300" />
                    <h3 className="mb-2 text-lg font-medium text-slate-900">No hay devoluciones</h3>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-slate-900">
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
                                            onClick={() => onApproveReturn(supplierReturn.id, supplierReturn.return_number)}
                                            disabled={approving}
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
                </div>
            )}
        </div>
    );
}
