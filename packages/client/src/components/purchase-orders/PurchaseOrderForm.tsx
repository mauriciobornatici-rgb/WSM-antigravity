import { useEffect, useState, type FormEvent } from 'react';
import { todayInArgentina } from '@/lib/argentinaDate';
import { Trash2, Plus } from 'lucide-react';
import { api } from '@/services/api';
import { showErrorToast } from '@/lib/errorHandling';
import { formatMoney } from '@/lib/formatters';
import { grossLineTotal, grossPrice } from '@/lib/pricing';
import type { Product, Supplier } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArgentinaDateInput } from '@/components/common/ArgentinaDateInput';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface PurchaseOrderFormProps {
    onSubmit: (data: Parameters<typeof api.createPurchaseOrder>[0]) => Promise<void>;
    onCancel: () => void;
}

interface OrderItem {
    product_id: string;
    product_name: string;
    quantity_ordered: number;
    unit_cost: number;
    vat_rate?: number | undefined;
}

export function PurchaseOrderForm({ onSubmit, onCancel }: PurchaseOrderFormProps) {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    const [supplierId, setSupplierId] = useState('');
    const [orderDate, setOrderDate] = useState(() => todayInArgentina());
    const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
    const [notes, setNotes] = useState('');
    const [items, setItems] = useState<OrderItem[]>([]);

    const [selectedProduct, setSelectedProduct] = useState('');
    const [quantity, setQuantity] = useState('');
    const [unitCost, setUnitCost] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [suppliersData, productsData] = await Promise.all([
                api.getSuppliers(),
                api.getProducts(),
            ]);
            setSuppliers(suppliersData);
            setProducts(productsData);
        } catch (error) {
            showErrorToast('Error al cargar datos', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAddProduct = () => {
        if (!selectedProduct || !quantity || !unitCost) {
            showErrorToast('Faltan datos', new Error('Completa todos los campos del producto'));
            return;
        }

        const product = products.find((p) => p.id === selectedProduct);
        if (!product) return;

        const newItem: OrderItem = {
            product_id: selectedProduct,
            product_name: product.name,
            quantity_ordered: Number.parseFloat(quantity),
            unit_cost: Number.parseFloat(unitCost),
            vat_rate: product.vat_rate,
        };

        setItems((prev) => [...prev, newItem]);
        setSelectedProduct('');
        setQuantity('');
        setUnitCost('');
    };

    const handleRemoveProduct = (index: number) => {
        setItems((prev) => prev.filter((_, i) => i !== index));
    };

    const calculateTotal = () => {
        return items.reduce((sum, item) => sum + grossLineTotal(item.quantity_ordered, item.unit_cost, item.vat_rate), 0);
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!supplierId) {
            showErrorToast('Proveedor requerido', new Error('Selecciona un proveedor'));
            return;
        }

        if (items.length === 0) {
            showErrorToast('Agrega productos', new Error('Debes agregar al menos un producto'));
            return;
        }

        const data: Parameters<typeof api.createPurchaseOrder>[0] = {
            supplier_id: supplierId,
            order_date: orderDate,
            items: items.map((item) => ({
                product_id: item.product_id,
                quantity_ordered: item.quantity_ordered,
                unit_cost: item.unit_cost,
            })),
            ...(expectedDeliveryDate ? { expected_delivery_date: expectedDeliveryDate } : {}),
            ...(notes ? { notes } : {}),
        };

        await onSubmit(data);
    };

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
                            <SelectValue placeholder="Selecciona un proveedor" />
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
                    <Label htmlFor="orderDate">Fecha de orden *</Label>
                    <ArgentinaDateInput
                        id="orderDate"
                        value={orderDate}
                        onChange={setOrderDate}
                        ariaLabel="Fecha de orden"
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="expectedDelivery">Fecha de entrega esperada</Label>
                    <ArgentinaDateInput
                        id="expectedDelivery"
                        value={expectedDeliveryDate}
                        onChange={setExpectedDeliveryDate}
                        ariaLabel="Fecha de entrega esperada"
                    />
                </div>
            </div>

            <div className="border-t pt-4">
                <h3 className="mb-4 text-lg font-semibold">Agregar productos</h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="md:col-span-2">
                        <Label htmlFor="product">Producto</Label>
                        <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                            <SelectTrigger id="product">
                                <SelectValue placeholder="Selecciona producto" />
                            </SelectTrigger>
                            <SelectContent>
                                {products.map((product) => (
                                    <SelectItem key={product.id} value={product.id}>
                                        {product.name} - {product.sku}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="quantity">Cantidad</Label>
                        <Input
                            id="quantity"
                            type="number"
                            min="1"
                            step="1"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            placeholder="0"
                        />
                    </div>
                    <div>
                        <Label htmlFor="unitCost">Costo Unit. neto (s/IVA)</Label>
                        <Input
                            id="unitCost"
                            type="number"
                            min="0"
                            step="0.01"
                            value={unitCost}
                            onChange={(e) => setUnitCost(e.target.value)}
                            placeholder="0.00"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                            Final c/IVA: {formatMoney(grossPrice(unitCost, products.find((p) => p.id === selectedProduct)?.vat_rate))}
                        </p>
                    </div>
                </div>
                <Button type="button" onClick={handleAddProduct} className="mt-3 w-full sm:w-auto" variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar producto
                </Button>
            </div>

            {items.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px]">
                        <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-700 dark:text-gray-200">Producto</th>
                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-200">Cantidad</th>
                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-200">Costo Unit. neto</th>
                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-200">Costo final (c/IVA)</th>
                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700 dark:text-gray-200">Subtotal (IVA incl.)</th>
                                <th className="px-4 py-2 text-center text-sm font-medium text-gray-700 dark:text-gray-200">Accion</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {items.map((item, index) => (
                                <tr key={`${item.product_id}-${index}`}>
                                    <td className="px-4 py-2 text-sm">{item.product_name}</td>
                                    <td className="px-4 py-2 text-right text-sm">{item.quantity_ordered}</td>
                                    <td className="px-4 py-2 text-right text-sm">{formatMoney(item.unit_cost)}</td>
                                    <td className="px-4 py-2 text-right text-sm">{formatMoney(grossPrice(item.unit_cost, item.vat_rate))}</td>
                                    <td className="px-4 py-2 text-right text-sm font-medium">
                                        {formatMoney(grossLineTotal(item.quantity_ordered, item.unit_cost, item.vat_rate))}
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleRemoveProduct(index)}
                                        >
                                            <Trash2 className="h-4 w-4 text-red-500" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-gray-50 font-bold dark:bg-slate-800">
                            <tr>
                                <td colSpan={4} className="px-4 py-3 text-right">Total (IVA incl.):</td>
                                <td className="px-4 py-3 text-right text-lg">{formatMoney(calculateTotal())}</td>
                                <td />
                            </tr>
                        </tfoot>
                        </table>
                    </div>
                </div>
            )}

            <div className="space-y-2">
                <Label htmlFor="notes">Notas</Label>
                <textarea
                    id="notes"
                    className="min-h-[80px] w-full resize-none rounded-md border px-3 py-2"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notas adicionales sobre la orden..."
                />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={items.length === 0}>
                    Crear orden de compra
                </Button>
            </div>
        </form>
    );
}
