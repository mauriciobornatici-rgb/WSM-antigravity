import { formatMoney } from "@/lib/formatters";
import type { Client, Supplier } from "@/types";
import type { UnifiedMovement } from "./CurrentAccountsLedgerTable";
import { PrintPortal } from "@/components/common/PrintPortal";

interface CurrentAccountsPrintStatementProps {
    accountType: "client" | "supplier";
    selectedClient?: Client | undefined;
    selectedSupplier?: Supplier | undefined;
    summaryKPI: {
        totalBilled: number;
        totalPaid: number;
        totalCredits: number;
        currentBalance: number;
    };
    ledgerMovements: UnifiedMovement[];
}

export function CurrentAccountsPrintStatement({
    accountType,
    selectedClient,
    selectedSupplier,
    summaryKPI,
    ledgerMovements,
}: CurrentAccountsPrintStatementProps) {
    const isClient = accountType === "client";
    const entity = isClient ? selectedClient : selectedSupplier;
    if (!entity) return null;

    return (
        <PrintPortal>
            <div id="printable-client-document" className="hidden print:block p-8 bg-white text-black font-sans max-w-4xl mx-auto">
            {/* Header del Reporte */}
            <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4 mb-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-slate-900">SPORTS STORE S.A.</h1>
                    <p className="text-xs text-slate-600">Av. Siempre Viva 742, Córdoba, Argentina</p>
                    <p className="text-xs text-slate-600">CUIT: 30-71234567-9 | IVA Responsable Inscripto</p>
                </div>
                <div className="text-right">
                    <h2 className="text-lg font-bold text-slate-800 uppercase">
                        {isClient ? "Estado de Cuenta Corriente" : "Resumen de Cuenta Proveedor"}
                    </h2>
                    <p className="text-xs text-slate-500">Fecha de Emisión: {new Date().toLocaleDateString("es-AR")}</p>
                </div>
            </div>

            {/* Datos del Cliente / Proveedor */}
            <div className="bg-slate-50 border border-slate-200 rounded p-4 mb-6 grid grid-cols-2 gap-4 text-xs">
                <div>
                    <span className="font-bold text-slate-500 block uppercase">
                        {isClient ? "Datos del Cliente" : "Datos del Proveedor"}
                    </span>
                    <p className="text-sm font-black text-slate-900">{entity.name}</p>
                    <p className="text-slate-600">Identificación (CUIT/DNI): {entity.tax_id || "-"}</p>
                </div>
                <div className="text-right flex flex-col justify-between">
                    <div>
                        <span className="font-bold text-slate-500 block uppercase">Saldo al Día de la Fecha</span>
                        <p
                            className={`text-xl font-black ${
                                summaryKPI.currentBalance > 0 ? "text-amber-700" : "text-emerald-700"
                            }`}
                        >
                            {formatMoney(summaryKPI.currentBalance)}
                        </p>
                    </div>
                </div>
            </div>

            {/* Tabla de Movimientos */}
            <table className="w-full text-left text-xs border-collapse mb-8">
                <thead>
                    <tr className="border-b-2 border-slate-800 bg-slate-100">
                        <th className="py-2 px-1">Fecha</th>
                        <th className="py-2 px-1">Comprobante</th>
                        <th className="py-2 px-1">Concepto</th>
                        <th className="py-2 px-1 text-right">{isClient ? "Débito (+)" : "Débito (-)"}</th>
                        <th className="py-2 px-1 text-right">{isClient ? "Crédito (-)" : "Crédito (+)"}</th>
                        <th className="py-2 px-1 text-right font-bold">Saldo</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {ledgerMovements.map((mov) => (
                        <tr key={mov.id}>
                            <td className="py-1.5 px-1 font-mono">{new Date(mov.date).toLocaleDateString("es-AR")}</td>
                            <td className="py-1.5 px-1 font-mono font-bold">{mov.reference}</td>
                            <td className="py-1.5 px-1">{mov.description}</td>
                            <td className="py-1.5 px-1 text-right font-mono">
                                {mov.debit > 0 ? formatMoney(mov.debit) : "-"}
                            </td>
                            <td className="py-1.5 px-1 text-right font-mono">
                                {mov.credit > 0 ? formatMoney(mov.credit) : "-"}
                            </td>
                            <td className="py-1.5 px-1 text-right font-mono font-bold">
                                {formatMoney(mov.balanceAfter)}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Footer de Firma */}
            <div className="flex justify-between items-end border-t border-slate-300 pt-8 mt-12 text-xs text-slate-500">
                <div>
                    <p>Documento no válido como factura.</p>
                    <p>Sistema WSM SportsERP v1.0</p>
                </div>
                <div className="text-center w-48 border-t border-slate-400 pt-1">
                    <p className="font-semibold text-slate-700">Firma y Sello de Conformidad</p>
                </div>
            </div>
            </div>
        </PrintPortal>
    );
}
