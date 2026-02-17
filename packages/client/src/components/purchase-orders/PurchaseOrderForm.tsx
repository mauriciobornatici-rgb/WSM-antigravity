import { useEffect, useState, type FormEvent } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { api } from '@/services/api';
import { showErrorToast } from '@/lib/errorHandling';
import type { Product, Supplier } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
}

export function PurchaseOrderForm({ onSubmit, onCancel }: PurchaseOrderFormProps) {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    const [supplierId, setSupplierId] = useState('');
    const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
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
        return items.reduce((sum, item) => sum + item.quantity_ordered * item.unit_cost, 0);
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
                    <Label htmlFor="orderDate">Fecha de Orden *</Label>
                    <Input
                        id="orderDate"
                        type="date"
                        value={orderDate}
                        onChange={(e) => setOrderDate(e.target.value)}
                        required
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="expectedDelivery">Fecha de Entrega Esperada</Label>
                    <Input
                        id="expectedDelivery"
                        type="date"
                        value={expectedDeliveryDate}
                        onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                    />
                </div>
            </div>

            <div className="border-t pt-4">
                <h3 className="mb-4 text-lg font-semibold">Agregar Productos</h3>
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
                        <Label htmlFor="unitCost">Costo Unit.</Label>
                        <Input
                            id="unitCost"
                            type="number"
                            min="0"
                            step="0.01"
                            value={unitCost}
                            onChange={(e) => setUnitCost(e.target.value)}
                            placeholder="0.00"
                        />
                    </div>
                </div>
                <Button type="button" onClick={handleAddProduct} className="mt-3" variant="outline">
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar Producto
                </Button>
            </div>

            {items.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                    <table className="w-full">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Producto</th>
                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Cantidad</th>
                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Costo Unit.</th>
                                <th className="px-4 py-2 text-right text-sm font-medium text-gray-700">Subtotal</th>
                                <th className="px-4 py-2 text-center text-sm font-medium text-gray-700">Accion</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {items.map((item, index) => (
                                <tr key={`${item.product_id}-${index}`}>
                                    <td className="px-4 py-2 text-sm">{item.product_name}</td>
                                    <td className="px-4 py-2 text-right text-sm">{item.quantity_ordered}</td>
                                    <td className="px-4 py-2 text-right text-sm">${item.unit_cost.toFixed(2)}</td>
                                    <td className="px-4 py-2 text-right text-sm font-medium">
                                        ${(item.quantity_ordered * item.unit_cost).toFixed(2)}
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
                        <tfoot className="bg-gray-50 font-bold">
                            <tr>
                                <td colSpan={3} className="px-4 py-3 text-right">Total:</td>
                                <td className="px-4 py-3 text-right text-lg">${calculateTotal().toFixed(2)}</td>
                                <td />
                            </tr>
                        </tfoot>
                    </table>
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

            <div className="flex justify-end gap-3 border-t pt-4">
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={items.length === 0}>
                    Crear Orden de Compra
                </Button>
            </div>
        </form>
    );
}
