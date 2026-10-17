import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertCircle, Package, Plus, Trash2 } from "lucide-react";
import { api } from "@/services/api";
import type { Product, PurchaseOrder, Supplier } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { formatMoney } from "@/lib/formatters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArgentinaDateInput } from "@/components/common/ArgentinaDateInput";
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

// A small purchase without a purchase order (ADR-027, D2): the lines and their cost are typed here.
const NO_ORDER = "none";

interface ManualItem {
    product_id: string;
    product_name: string;
    sku: string;
    quantity_received: string;
    unit_cost: string;
}

function toReceptionItem(item: PurchaseOrderItem): ReceptionItem {
    const quantityOrdered = Number(item.quantity_ordered ?? item.quantity ?? 0);
    const quantityPreviouslyReceived = Number(item.quantity_received ?? item.received_quantity ?? 0);
    const quantityPendingQc = Number(item.quantity_pending_qc ?? 0);
    const pendingToReceive = Math.max(0, quantityOrdered - quantityPreviouslyReceived - quantityPendingQc);

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
    const withoutOrder = purchaseOrderId === NO_ORDER;
    const [products, setProducts] = useState<Product[]>([]);
    const [productSearch, setProductSearch] = useState("");
    const [manualItems, setManualItems] = useState<ManualItem[]>([]);

    useEffect(() => {
        void loadSuppliers();
    }, []);

    useEffect(() => {
        if (!withoutOrder || products.length > 0) return;
        api.getProducts()
            .then((response) => setProducts(response))
            .catch((error) => showErrorToast("Error al cargar productos", error));
    }, [withoutOrder, products.length]);

    const productMatches = useMemo(() => {
        const query = productSearch.trim().toLowerCase();
        if (!query) return [];
        return products
            .filter((product) => !manualItems.some((item) => item.product_id === product.id))
            .filter((product) => [product.name, product.sku, product.barcode].some((value) => String(value || "").toLowerCase().includes(query)))
            .slice(0, 8);
    }, [productSearch, products, manualItems]);

    function addManualItem(product: Product) {
        const cost = Number(product.purchase_price || 0) > 0 ? Number(product.purchase_price) : Number(product.cost_price || 0);
        setManualItems((current) => [...current, {
            product_id: product.id,
            product_name: product.name,
            sku: product.sku,
            quantity_received: "1",
            unit_cost: cost > 0 ? String(cost) : "",
        }]);
        setProductSearch("");
    }

    function updateManualItem(index: number, patch: Partial<ManualItem>) {
        setManualItems((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)));
    }

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
        if (!purchaseOrderId || purchaseOrderId === NO_ORDER) {
            setItems([]);
            return;
        }
        setManualItems([]);
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
            showErrorToast("Datos incompletos", new Error("Elegí el proveedor y la orden de compra (o «Sin orden de compra»)."));
            return;
        }

        if (withoutOrder) {
            if (manualItems.length === 0) {
                showErrorToast("Sin productos", new Error("Agregá los productos que llegaron."));
                return;
            }
            const invalid = manualItems.find((item) => {
                const quantity = Number(item.quantity_received);
                return !Number.isInteger(quantity) || quantity <= 0 || !(Number(item.unit_cost) > 0);
            });
            if (invalid) {
                showErrorToast("Datos incompletos", new Error(`Revisá ${invalid.product_name}: la cantidad tiene que ser un número entero y el costo, mayor a 0.`));
                return;
            }
            setSubmitting(true);
            try {
                await onSubmit({
                    supplier_id: supplierId,
                    items: manualItems.map((item) => ({
                        product_id: item.product_id,
                        quantity_received: Number(item.quantity_received),
                        unit_cost: Math.round(Number(item.unit_cost) * 100) / 100,
                    })),
                    ...(remitoNumber ? { remito_number: remitoNumber } : {}),
                    ...(notes ? { notes } : {}),
                });
            } finally {
                setSubmitting(false);
            }
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
                            <SelectValue placeholder={supplierId ? "Elegí la OC o «Sin orden de compra»" : "Selecciona proveedor primero"} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_ORDER}>Sin orden de compra (compra chica)</SelectItem>
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

            {withoutOrder && (
                <section className="space-y-3" aria-labelledby="manual-items-title">
                    <h3 id="manual-items-title" className="flex items-center gap-2 font-semibold">
                        <Package className="h-5 w-5 text-blue-600" />
                        Productos recibidos
                    </h3>
                    <p className="text-xs text-muted-foreground">
                        Cargá el costo neto (sin IVA) de cada producto, como figura en el remito o en la lista del proveedor.
                        Si después la factura trae otro importe, la diferencia corrige el costo.
                    </p>
                    <div className="space-y-2">
                        <Label htmlFor="manual-product-search">Buscar producto</Label>
                        <Input
                            id="manual-product-search"
                            value={productSearch}
                            onChange={(event) => setProductSearch(event.target.value)}
                            placeholder="Nombre, SKU o código de barras"
                            autoComplete="off"
                        />
                        {productMatches.length > 0 ? (
                            <ul className="divide-y rounded-md border" aria-label="Productos encontrados">
                                {productMatches.map((product) => (
                                    <li key={product.id}>
                                        <button
                                            type="button"
                                            className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60"
                                            onClick={() => addManualItem(product)}
                                        >
                                            <span>
                                                {product.name}
                                                <span className="ml-2 text-xs text-muted-foreground">{product.sku}</span>
                                            </span>
                                            <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : productSearch.trim() ? (
                            <p className="text-xs text-muted-foreground" aria-live="polite">No hay productos con ese texto.</p>
                        ) : null}
                    </div>
                    {manualItems.length > 0 ? (
                        <div className="overflow-x-auto rounded-lg border">
                            <table className="w-full min-w-[620px] text-sm">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="px-3 py-2 text-left font-semibold">Producto</th>
                                        <th className="px-3 py-2 text-center font-semibold">Cantidad</th>
                                        <th className="px-3 py-2 text-center font-semibold">Costo neto unitario</th>
                                        <th className="px-3 py-2 text-right font-semibold">Subtotal neto</th>
                                        <th className="px-3 py-2"><span className="sr-only">Quitar</span></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {manualItems.map((item, index) => (
                                        <tr key={item.product_id}>
                                            <td className="px-3 py-2">
                                                <div className="font-medium">{item.product_name}</div>
                                                <div className="text-xs text-muted-foreground">{item.sku}</div>
                                            </td>
                                            <td className="px-3 py-2">
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    step="1"
                                                    inputMode="numeric"
                                                    aria-label={`Cantidad de ${item.product_name}`}
                                                    className="mx-auto h-9 w-24 text-center"
                                                    value={item.quantity_received}
                                                    onChange={(event) => updateManualItem(index, { quantity_received: event.target.value })}
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    inputMode="decimal"
                                                    aria-label={`Costo neto unitario de ${item.product_name}`}
                                                    className="mx-auto h-9 w-32 text-center"
                                                    value={item.unit_cost}
                                                    onChange={(event) => updateManualItem(index, { unit_cost: event.target.value })}
                                                />
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono">
                                                {formatMoney((Number(item.quantity_received) || 0) * (Number(item.unit_cost) || 0))}
                                            </td>
                                            <td className="px-3 py-2 text-right">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-11 w-11"
                                                    aria-label={`Quitar ${item.product_name}`}
                                                    onClick={() => setManualItems((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                                                >
                                                    <Trash2 className="h-4 w-4 text-red-500" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </section>
            )}

            {items.length > 0 && (
                <div className="space-y-3">
                    <h3 className="flex items-center gap-2 font-semibold text-slate-900">
                        <Package className="h-5 w-5 text-blue-600" />
                        Productos de la orden
                    </h3>

                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[980px] text-sm">
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
                                                className="mx-auto h-8 w-24 bg-white text-center text-slate-950 placeholder:text-slate-500 [color-scheme:light]"
                                                value={item.quantity_received}
                                                onChange={(event) => {
                                                    const value = Number.parseFloat(event.target.value) || 0;
                                                    updateItem(index, { quantity_received: value });
                                                }}
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <Input
                                                className="h-8 bg-white text-xs text-slate-950 placeholder:text-slate-500 [color-scheme:light]"
                                                value={item.batch_number}
                                                onChange={(event) => updateItem(index, { batch_number: event.target.value })}
                                                placeholder="Lote"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <ArgentinaDateInput
                                                className="[&_input]:h-8 [&_input]:bg-white [&_input]:text-xs [&_input]:text-slate-950 [&_input]:placeholder:text-slate-500"
                                                value={item.expiration_date}
                                                onChange={(value) => updateItem(index, { expiration_date: value })}
                                                ariaLabel={`Vencimiento de ${item.product_name || "producto"}`}
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

            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
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

