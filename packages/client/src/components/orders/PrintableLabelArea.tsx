import type { Order } from "@/types";

type PrintableLabelAreaProps = {
    order: Order | null;
};

export function PrintableLabelArea({ order }: PrintableLabelAreaProps) {
    if (!order) return null;

    return (
        <div id="printable-label" className="fixed inset-0 z-[9999] m-0 hidden bg-white p-6 text-black print:block font-sans">
            {/* Box container formatted exactly for 10x15cm thermal label standard */}
            <div className="border-4 border-black p-4 h-[calc(100vh-3rem)] flex flex-col justify-between text-sm">
                <div>
                    {/* Header */}
                    <div className="flex justify-between items-center border-b-2 border-black pb-2">
                        <span className="text-xs font-bold font-mono">SPORTS STORE ERP</span>
                        <span className="text-2xl font-black px-3 py-1 bg-black text-white rounded font-sans uppercase">
                            {order.shipping_method === "delivery" ? "ENVÍO" : "RETIRO"}
                        </span>
                    </div>

                    {/* Carrier tracking */}
                    <div className="mt-4 text-center border-b-2 border-black pb-4">
                        <p className="text-xs uppercase font-bold text-slate-500">Código de Seguimiento / Remito</p>
                        <p className="text-lg font-black font-mono mt-1">{order.tracking_number || `ORD-${order.id.slice(0, 8).toUpperCase()}`}</p>
                        <div className="h-10 w-48 mx-auto mt-2 bg-slate-200 flex items-center justify-center border border-dashed border-slate-400 text-xs font-mono text-slate-500">
                            |||||| |||| ||||| |||||||
                        </div>
                    </div>

                    {/* Shipping Address / Recipient */}
                    <div className="mt-4 space-y-2">
                        <div>
                            <span className="text-xs uppercase font-bold text-slate-500">Destinatario</span>
                            <p className="text-base font-bold">{order.recipient_name || order.client_name || order.customer_name || "Sin Nombre"}</p>
                            {order.recipient_dni && <p className="text-xs text-slate-700">DNI: {order.recipient_dni}</p>}
                        </div>

                        {order.shipping_method === "delivery" && (
                            <div>
                                <span className="text-xs uppercase font-bold text-slate-500">Dirección de Entrega</span>
                                <p className="text-base font-extrabold font-mono uppercase bg-slate-50 p-2 border border-slate-200 rounded">
                                    {order.shipping_address || "NO INFORMADA"}
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Sender & Instructions Footer */}
                <div className="border-t-2 border-black pt-2 mt-auto">
                    {order.delivery_notes && (
                        <div className="mb-2 bg-slate-100 p-2 rounded text-xs border border-slate-300">
                            <strong>Instrucciones:</strong> {order.delivery_notes}
                        </div>
                    )}
                    <div className="flex justify-between items-center text-[10px] text-slate-600">
                        <div>
                            <span className="font-bold">Remitente:</span> Sports Store S.A.
                            <br />
                            Av. Rivadavia 4999, CABA
                        </div>
                        <div className="text-right">
                            <span className="font-bold">Pedido:</span> {order.id.slice(0, 8).toUpperCase()}
                            <br />
                            Fecha: {new Date(order.created_at).toLocaleDateString("es-AR")}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
