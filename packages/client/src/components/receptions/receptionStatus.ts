export function receptionStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        pending_qc: "Pendiente QC",
        approved: "Aprobada",
        partially_approved: "Aprobada parcial",
        rejected: "Rechazada",
    };
    return labels[status] ?? status;
}

export function returnStatusLabel(status: string): string {
    if (status === "draft") return "Borrador";
    if (status === "approved") return "Aprobada";
    return status;
}

export function statusBadgeClass(status: string): string {
    const map: Record<string, string> = {
        pending_qc: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
        approved: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
        partially_approved: "bg-sky-100 text-sky-800 ring-1 ring-sky-200",
        rejected: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
        draft: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    };
    return `rounded-full px-2 py-1 text-xs font-semibold ${map[status] ?? "bg-slate-100 text-slate-700 ring-1 ring-slate-200"}`;
}
