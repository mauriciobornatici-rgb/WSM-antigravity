import type { Order } from "@/types";

type PrintableManifestAreaProps = {
    orders: Order[];
    driver: string;
    plate: string;
    carrier: string;
    notes?: string;
};

export function PrintableManifestArea({ orders, driver, plate, carrier, notes }: PrintableManifestAreaProps) {
    if (!orders || orders.length === 0) return null;

    // Calculate total bultos (sum of quantities across all orders)
    const totalBultos = orders.reduce((sum, order) => {
        return sum + (order.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0);
    }, 0);

    // Calculate total commercial value of all orders that require cash collection on delivery
    const totalToCollect = orders.reduce((sum, order) => {
        const needsCollection = order.payment_method === "credit_account" || order.payment_status === "pending";
        return sum + (needsCollection ? Number(order.total_amount || 0) : 0);
    }, 0);

    return (
        <div id="printable-manifest" className="fixed inset-0 z-[9999] m-0 hidden bg-white p-8 text-black print:block font-sans">
            {/* Header */}
            <div className="flex justify-between border-b-2 border-black pb-4">
                <div>
                    <h1 className="text-xl font-black tracking-wider">SPORTS STORE</h1>
                    <p className="text-xs text-slate-500">Gestión de Stock & Despachos</p>
                </div>
                <div className="text-right">
                    <h2 className="text-lg font-black text-slate-900">HOJA DE RUTA DE REPARTO</h2>
                    <p className="text-xs text-slate-500">Fecha Despacho: {new Date().toLocaleDateString("es-AR")}</p>
                    <p className="text-xs text-slate-500">Total Pedidos: <span className="font-bold">{orders.length}</span></p>
                </div>
            </div>

            {/* Logistics details */}
            <div className="mt-4 grid grid-cols-4 gap-4 text-xs border border-black p-3 bg-slate-50 rounded-sm">
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Chofer Responsable</span>
                    <span className="font-bold text-sm">{driver || "-"}</span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Patente Vehículo</span>
                    <span className="font-bold text-sm">{plate || "-"}</span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Empresa Logística</span>
                    <span className="font-bold text-sm uppercase">{carrier || "-"}</span>
                </div>
                <div>
                    <span className="text-[10px] uppercase font-bold text-slate-500 block">Hora Despacho</span>
                    <span className="font-bold text-sm">{new Date().toLocaleTimeString("es-AR", { hour: '2-digit', minute: '2-digit' })} hs</span>
                </div>
            </div>

            {/* List of Orders */}
            <div className="mt-6">
                <table className="w-full text-xs text-left border-collapse border border-slate-300">
                    <thead>
                        <tr className="border-b border-slate-400 bg-slate-100 font-bold text-[11px] uppercase">
                            <th className="py-2 px-3 border border-slate-300">Orden ID</th>
                            <th className="py-2 px-3 border border-slate-300">Destinatario / Cliente</th>
                            <th className="py-2 px-3 border border-slate-300">Dirección de Entrega</th>
                            <th className="py-2 px-3 border border-slate-300 text-center">Bultos</th>
                            <th className="py-2 px-3 border border-slate-300 text-right">Cobrar ($)</th>
                            <th className="py-2 px-3 border border-slate-300 text-center w-28">Firma Recepción</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map((order) => {
                            const bultos = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
                            
                            // Check if order needs cash collection on delivery
                            const needsCollection = order.payment_method === "credit_account" || order.payment_status === "pending";
                            const collectionAmount = needsCollection ? order.total_amount : 0;

                            return (
                                <tr key={order.id} className="border-b border-slate-300">
                                    <td className="py-2 px-3 border border-slate-300 font-mono font-bold">{order.id.slice(0, 8).toUpperCase()}</td>
                                    <td className="py-2 px-3 border border-slate-300">
                                        <div className="font-bold">{order.recipient_name || order.client_name || order.customer_name}</div>
                                        {order.recipient_dni && <div className="text-[10px] text-slate-500">DNI: {order.recipient_dni}</div>}
                                    </td>
                                    <td className="py-2 px-3 border border-slate-300 uppercase font-mono text-[10px]">
                                        {order.shipping_address || "Retiro en Local (Sin dirección)"}
                                    </td>
                                    <td className="py-2 px-3 border border-slate-300 text-center font-bold">{bultos}</td>
                                    <td className="py-2 px-3 border border-slate-300 text-right font-mono font-bold">
                                        {collectionAmount > 0 ? `$${Number(collectionAmount).toLocaleString("es-AR")}` : "-"}
                                    </td>
                                    <td className="py-2 px-3 border border-slate-300 text-center text-slate-300 font-mono">
                                        ________________
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Notes / Special Instructions */}
            {notes && (
                <div className="mt-4 rounded border border-slate-300 p-2 bg-slate-50 text-[11px]">
                    <strong>Instrucciones especiales para la Hoja de Ruta:</strong>
                    <p className="text-slate-700 mt-1">{notes}</p>
                </div>
            )}

            {/* Summary metrics */}
            <div className="mt-6 flex justify-end">
                <div className="w-80 border-2 border-black p-3 rounded-sm space-y-1 text-xs font-mono font-bold">
                    <div className="flex justify-between">
                        <span>TOTAL ÓRDENES:</span>
                        <span>{orders.length}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>TOTAL BULTOS:</span>
                        <span>{totalBultos}</span>
                    </div>
                    <div className="flex justify-between text-sm border-t border-dashed border-slate-400 pt-1 mt-1 font-black">
                        <span>TOTAL A COBRAR:</span>
                        <span>${Number(totalToCollect).toLocaleString("es-AR")}</span>
                    </div>
                </div>
            </div>

            {/* Signature Area */}
            <div className="mt-16 grid grid-cols-2 gap-12 text-xs text-center">
                <div className="border-t border-black pt-2 mt-8">
                    <p className="font-bold uppercase tracking-wider">Firma Despachante de Depósito</p>
                    <p className="text-slate-400 mt-1">Aclaración & DNI</p>
                </div>
                <div className="border-t border-black pt-2 mt-8">
                    <p className="font-bold uppercase tracking-wider">Firma Chofer Responsable</p>
                    <p className="text-slate-400 mt-1">Aclaración & DNI</p>
                </div>
            </div>
        </div>
    );
}
