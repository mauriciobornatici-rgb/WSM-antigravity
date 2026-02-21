import { AlertCircle, CheckCircle2, Clock, PackageCheck } from "lucide-react";
import { receptionStatusLabel, statusBadgeClass } from "./receptionStatus";
import type { ReceptionRecord, ReceptionsFilter } from "./types";

const tableHeadClass = "px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700";
const tableHeadRightClass = "px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-700";
const tableCellClass = "px-6 py-4 text-slate-800";
const tableCellStrongClass = "px-6 py-4 font-semibold text-slate-900";

type ReceptionsHistorySectionProps = {
    receptions: ReceptionRecord[];
    filter: ReceptionsFilter;
    approving: boolean;
    onFilterChange: (status: ReceptionsFilter) => void;
    onApproveReception: (id: string, receptionNumber: string) => void;
};

export function ReceptionsHistorySection({
    receptions,
    filter,
    approving,
    onFilterChange,
    onApproveReception,
}: ReceptionsHistorySectionProps) {
    return (
        <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-1">
                {(["all", "pending_qc", "approved", "rejected"] as const).map((status) => (
                    <button
                        key={status}
                        onClick={() => onFilterChange(status)}
                        className={`shrink-0 rounded px-4 py-2 text-sm font-medium transition ${
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
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px]">
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
                                                onClick={() => onApproveReception(reception.id, reception.reception_number)}
                                                disabled={approving}
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
                    </div>
                )}
            </div>
        </div>
    );
}
