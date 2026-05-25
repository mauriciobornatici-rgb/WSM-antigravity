import type { Order } from "@/types";

type PrintableOrderAreaProps = {
    order: Order | null;
};

export function PrintableOrderArea({ order }: PrintableOrderAreaProps) {
    if (!order) return null;

    return (
        <div id="printable-order" className="fixed inset-0 z-[9999] m-0 hidden bg-white p-8 text-black print:block font-sans">
            {/* Header */}
            <div className="flex justify-between border-b pb-4">
                <div>
                    <h1 className="text-xl font-bold tracking-wider">SPORTS STORE</h1>
                    <p className="text-xs text-slate-500">Gestión de Stock & Despachos</p>
                </div>
                <div className="text-right">
                    <h2 className="text-base font-bold text-slate-800">REMITO DE PREPARACIÓN</h2>
                    <p className="text-xs text-slate-500">Orden ID: <span className="font-mono">{order.id}</span></p>
                    <p className="text-xs text-slate-500">Fecha: {new Date(order.created_at).toLocaleDateString("es-AR")}</p>
                </div>
            </div>

            {/* General Info Grid */}
            <div className="mt-6 grid grid-cols-2 gap-4 text-xs border-b pb-4">
                <div>
                    <h3 className="font-bold uppercase tracking-wider text-slate-600 mb-1">Datos del Cliente</h3>
                    <p><strong>Nombre:</strong> {order.client_name || order.customer_name || "Consumidor Final"}</p>
                    <p><strong>Cajero:</strong> {order.counter_name || "Sistema"}</p>
                </div>
                <div>
                    <h3 className="font-bold uppercase tracking-wider text-slate-600 mb-1">Logística de Despacho</h3>
                    <p><strong>Método:</strong> {order.shipping_method === "delivery" ? "Envío a Domicilio" : "Retiro en Local"}</p>
                    <p><strong>Entregar a:</strong> {order.recipient_name || "-"} (DNI: {order.recipient_dni || "-"})</p>
                    {order.shipping_method === "delivery" && (
                        <p><strong>Dirección:</strong> {order.shipping_address || "-"}</p>
                    )}
                    {order.estimated_delivery && (
                        <p><strong>Fecha Estimada:</strong> {new Date(order.estimated_delivery).toLocaleDateString("es-AR")}</p>
                    )}
                </div>
            </div>

            {/* Items Table */}
            <div className="mt-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">Artículos a Preparar (Picking)</h3>
                <table className="w-full text-xs text-left border-collapse">
                    <thead>
                        <tr className="border-b bg-slate-100 font-bold">
                            <th className="py-2 px-3">Ubicación</th>
                            <th className="py-2 px-3">SKU</th>
                            <th className="py-2 px-3">Producto</th>
                            <th className="py-2 px-3 text-right">Cant. Solicitada</th>
                            <th className="py-2 px-3 text-right">Cant. Controlada</th>
                            <th className="py-2 px-3 text-center">Verificado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(order.items || []).map((item, index) => (
                            <tr key={`${item.id}-${index}`} className="border-b">
                                <td className="py-2 px-3 font-mono font-bold bg-slate-50">{item.location || "Sin Ubicación"}</td>
                                <td className="py-2 px-3 font-mono">{item.sku}</td>
                                <td className="py-2 px-3">{item.product_name}</td>
                                <td className="py-2 px-3 text-right font-bold">{item.quantity}</td>
                                <td className="py-2 px-3 text-right font-mono">{item.picked_quantity || 0}</td>
                                <td className="py-2 px-3 text-center text-slate-300 font-mono">[   ]</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Notes */}
            {order.notes && (
                <div className="mt-6 rounded-md border p-3 bg-slate-50 text-xs">
                    <strong className="block mb-1">Observaciones / Instrucciones Especiales:</strong>
                    <p className="text-slate-700">{order.notes}</p>
                </div>
            )}

            {/* Signatures */}
            <div className="mt-12 grid grid-cols-2 gap-8 text-xs text-center">
                <div className="border-t pt-2 mt-8">
                    <p className="font-bold">Firma Operario de Depósito (Picking)</p>
                    <p className="text-slate-400 mt-1">Aclaración & DNI</p>
                </div>
                <div className="border-t pt-2 mt-8">
                    <p className="font-bold">Firma Receptor (Cliente / Transporte)</p>
                    <p className="text-slate-400 mt-1">Aclaración & DNI</p>
                </div>
            </div>
        </div>
    );
}
