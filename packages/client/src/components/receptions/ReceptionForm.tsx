import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Package } from "lucide-react";
import { api } from "@/services/api";
import type { PurchaseOrder, Supplier } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ReceptionFormProps {
    onSubmit: (data: Parameters<typeof api.createReception>[0]) => Promise<void>;
    onCancel: () => void;
    initialOrderId?: string;
    initialSupplierId?: string;
}

type PurchaseOrderItem = NonNullable<PurchaseOrder["items"]>[number];

interface ReceptionItem {
    product_id: string;
    po_item_id: string;
    product_name: string;
    sku: string;
    quantity_ordered: number;
    quantity_previously_received: number;
    quantity_received: number;
    unit_cost: number;
    batch_number: string;
    expiration_date: string;
    rejected: boolean;
    notes: string;
}

function toReceptionItem(item: PurchaseOrderItem): ReceptionItem {
    const quantityOrdered = Number(item.quantity_ordered ?? item.quantity ?? 0);
    const quantityPreviouslyReceived = Number(item.quantity_received ?? item.received_quantity ?? 0);
    const pendingToReceive = Math.max(0, quantityOrdered - quantityPreviouslyReceived);

    return {
        product_id: item.product_id,
        po_item_id: item.id ?? item.product_id,
        product_name: item.product_name ?? item.name ?? "Producto",
        sku: item.sku ?? "-",
        quantity_ordered: quantityOrdered,
        quantity_previously_received: quantityPreviouslyReceived,
        quantity_received: pendingToReceive,
        unit_cost: Number(item.unit_cost ?? 0),
        batch_number: "",
        expiration_date: "",
        rejected: false,
        notes: "",
    };
}

export function ReceptionForm({
    onSubmit,
    onCancel,
    initialOrderId,
    initialSupplierId,
}: ReceptionFormProps) {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
    const [items, setItems] = useState<ReceptionItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");
    const [purchaseOrderId, setPurchaseOrderId] = useState(initialOrderId ?? "");
    const [remitoNumber, setRemitoNumber] = useState("");
    const [notes, setNotes] = useState("");

    useEffect(() => {
        void loadSuppliers();
    }, []);

    useEffect(() => {
        if (!supplierId) {
            setPurchaseOrders([]);
            if (!initialOrderId) setPurchaseOrderId("");
            setItems([]);
            return;
        }
        void loadPurchaseOrders(supplierId);
    }, [supplierId, initialOrderId]);

    useEffect(() => {
        if (!purchaseOrderId) {
            setItems([]);
            return;
        }
        void loadPurchaseOrderItems(purchaseOrderId);
    }, [purchaseOrderId]);

    async function loadSuppliers() {
        try {
            const response = await api.getSuppliers();
            setSuppliers(response);
        } catch (error) {
            showErrorToast("Error al cargar proveedores", error);
        } finally {
            setLoading(false);
        }
    }

    async function loadPurchaseOrders(selectedSupplierId: string) {
        try {
            const response = await api.getPurchaseOrders({ supplier_id: selectedSupplierId });
            const available = response.filter((order) => order.status === "sent" || order.status === "partial");
            setPurchaseOrders(available);
        } catch (error) {
            showErrorToast("Error al cargar ordenes de compra", error);
        }
    }

    async function loadPurchaseOrderItems(orderId: string) {
        try {
            const order = await api.getPurchaseOrder(orderId);
            const orderItems = order.items ?? [];
            setItems(orderItems.map(toReceptionItem));
        } catch (error) {
            showErrorToast("Error al cargar items de la orden", error);
            setItems([]);
        }
    }

    function updateItem(index: number, patch: Partial<ReceptionItem>) {
        setItems((prev) => prev.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)));
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (!supplierId || !purchaseOrderId) {
            showErrorToast("Datos incompletos", new Error("Selecciona proveedor y orden de compra"));
            return;
        }

        const itemsToSubmit = items.filter((item) => item.quantity_received > 0);
        if (itemsToSubmit.length === 0) {
            showErrorToast("Sin productos", new Error("Debes informar cantidades recibidas"));
            return;
        }

        const payload: Parameters<typeof api.createReception>[0] = {
            supplier_id: supplierId,
            purchase_order_id: purchaseOrderId,
            items: itemsToSubmit.map((item) => ({
                product_id: item.product_id,
                po_item_id: item.po_item_id,
                quantity_expected: item.quantity_ordered,
                quantity_received: item.quantity_received,
                unit_cost: item.unit_cost,
                status: item.rejected ? "rejected" : "approved",
                ...(item.batch_number ? { batch_number: item.batch_number } : {}),
                ...(item.expiration_date ? { expiration_date: item.expiration_date } : {}),
                ...(item.notes ? { notes: item.notes } : {}),
            })),
            ...(remitoNumber ? { remito_number: remitoNumber } : {}),
            ...(notes ? { notes } : {}),
        };

        setSubmitting(true);
        try {
            await onSubmit(payload);
        } finally {
            setSubmitting(false);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-8">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="supplier">Proveedor *</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                        <SelectTrigger id="supplier">
                            <SelectValue placeholder="Selecciona proveedor" />
                        </SelectTrigger>
                        <SelectContent>
                            {suppliers.map((supplier) => (
                                <SelectItem key={supplier.id} value={supplier.id}>
                                    {supplier.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="order">Orden de compra *</Label>
                    <Select value={purchaseOrderId} onValueChange={setPurchaseOrderId} disabled={!supplierId}>
                        <SelectTrigger id="order">
                            <SelectValue placeholder={supplierId ? "Selecciona OC" : "Selecciona proveedor primero"} />
                        </SelectTrigger>
                        <SelectContent>
                            {purchaseOrders.map((order) => (
                                <SelectItem key={order.id} value={order.id}>
                                    {order.po_number ?? order.id} - {order.order_date ? new Date(order.order_date).toLocaleDateString("es-AR") : "-"}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="remito">Numero de remito</Label>
                    <Input
                        id="remito"
                        value={remitoNumber}
                        onChange={(event) => setRemitoNumber(event.target.value)}
                        placeholder="Ej: 0001-00012345"
                    />
                </div>
            </div>

            {items.length > 0 && (
                <div className="space-y-3">
                    <h3 className="flex items-center gap-2 font-semibold text-slate-900">
                        <Package className="h-5 w-5 text-blue-600" />
                        Productos de la orden
                    </h3>

                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100">
                                <tr>
                                    <th className="px-4 py-2 text-left font-semibold">Producto</th>
                                    <th className="px-4 py-2 text-center font-semibold">Pedido</th>
                                    <th className="px-4 py-2 text-center font-semibold">Recibido</th>
                                    <th className="px-4 py-2 text-center font-semibold">A recibir</th>
                                    <th className="px-4 py-2 text-center font-semibold">Lote</th>
                                    <th className="px-4 py-2 text-center font-semibold">Vencimiento</th>
                                    <th className="px-4 py-2 text-center font-semibold">Problema</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {items.map((item, index) => (
                                    <tr key={`${item.po_item_id}-${index}`}>
                                        <td className="px-4 py-3">
                                            <div className="font-medium">{item.product_name}</div>
                                            <div className="text-xs text-slate-500">{item.sku}</div>
                                            {(item.rejected || item.notes) && (
                                                <Input
                                                    className="mt-2 h-7 text-xs"
                                                    value={item.notes}
                                                    onChange={(event) => updateItem(index, { notes: event.target.value })}
                                                    placeholder="Detalle del problema..."
                                                />
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center">{item.quantity_ordered}</td>
                                        <td className="px-4 py-3 text-center">{item.quantity_previously_received}</td>
                                        <td className="px-4 py-3">
                                            <Input
                                                type="number"
                                                min="0"
                                                className="mx-auto h-8 w-24 text-center"
                                                value={item.quantity_received}
                                                onChange={(event) => {
                                                    const value = Number.parseFloat(event.target.value) || 0;
                                                    updateItem(index, { quantity_received: value });
                                                }}
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <Input
                                                className="h-8 text-xs"
                                                value={item.batch_number}
                                                onChange={(event) => updateItem(index, { batch_number: event.target.value })}
                                                placeholder="Lote"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <Input
                                                type="date"
                                                className="h-8 text-xs"
                                                value={item.expiration_date}
                                                onChange={(event) => updateItem(index, { expiration_date: event.target.value })}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <button
                                                type="button"
                                                onClick={() => updateItem(index, { rejected: !item.rejected })}
                                                className={`rounded p-1 transition-colors ${
                                                    item.rejected ? "bg-red-100 text-red-600 hover:bg-red-200" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                                                }`}
                                                title={item.rejected ? "Marcar como conforme" : "Marcar como rechazado"}
                                            >
                                                <AlertCircle className="h-5 w-5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                <Label htmlFor="notes">Notas de recepcion</Label>
                <textarea
                    id="notes"
                    className="min-h-[80px] w-full resize-none rounded-md border px-3 py-2 text-sm"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Observaciones generales..."
                />
            </div>

            <div className="flex justify-end gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancelar
                </Button>
                <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={submitting}>
                    {submitting ? "Guardando..." : "Registrar recepcion"}
                </Button>
            </div>
        </form>
    );
}
