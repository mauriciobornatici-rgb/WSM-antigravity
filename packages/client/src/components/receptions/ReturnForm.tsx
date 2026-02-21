import { useEffect, useState, type FormEvent } from 'react';
import { Trash2, Save, Search } from 'lucide-react';
import { api } from '@/services/api';
import { showErrorToast } from '@/lib/errorHandling';
import type { Product, Supplier } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ReturnFormProps {
    onCancel: () => void;
    onSubmit: (data: Parameters<typeof api.createReturn>[0]) => Promise<void>;
}

interface ReturnItem {
    product_id: string;
    product_name: string;
    sku: string;
    quantity: number;
    unit_cost: number;
    reason: string;
}

export const ReturnForm = ({ onCancel, onSubmit }: ReturnFormProps) => {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedSupplierId, setSelectedSupplierId] = useState('');
    const [items, setItems] = useState<ReturnItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        void loadSuppliers();
    }, []);

    useEffect(() => {
        if (selectedSupplierId) {
            void loadProducts(selectedSupplierId);
        } else {
            setProducts([]);
        }
    }, [selectedSupplierId]);

    const loadSuppliers = async () => {
        try {
            const data = await api.getSuppliers();
            setSuppliers(data);
        } catch (error) {
            showErrorToast('Error al cargar proveedores', error);
        }
    };

    const loadProducts = async (supplierId: string) => {
        try {
            setLoading(true);
            const data = await api.getProducts({ supplier_id: supplierId });
            setProducts(data);
        } catch (error) {
            showErrorToast('Error al cargar productos del proveedor', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAddItem = (productId: string) => {
        const product = products.find((p) => p.id === productId);
        if (!product) return;

        setItems((prev) => [
            ...prev,
            {
                product_id: product.id,
                product_name: product.name,
                sku: product.sku,
                quantity: 1,
                unit_cost: product.purchase_price || 0,
                reason: '',
            },
        ]);
    };

    const handleRemoveItem = (index: number) => {
        setItems((prev) => prev.filter((_, idx) => idx !== index));
    };

    const handleUpdateItem = <K extends keyof ReturnItem>(index: number, field: K, value: ReturnItem[K]) => {
        setItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)));
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!selectedSupplierId) {
            showErrorToast('Seleccione un proveedor', new Error('Proveedor requerido'));
            return;
        }
        if (items.length === 0) {
            showErrorToast('Agregue productos', new Error('Agregue al menos un producto a devolver'));
            return;
        }

        const payload: Parameters<typeof api.createReturn>[0] = {
            supplier_id: selectedSupplierId,
            items,
            ...(notes ? { notes } : {}),
        };

        setIsSubmitting(true);
        try {
            await onSubmit(payload);
        } finally {
            setIsSubmitting(false);
        }
    };

    const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0);

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="supplier">Proveedor</Label>
                    <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Seleccionar proveedor..." />
                        </SelectTrigger>
                        <SelectContent>
                            {suppliers.map((supplier) => (
                                <SelectItem key={supplier.id} value={supplier.id}>
                                    {supplier.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        Solo se mostrarán los productos que se hayan recibido previamente de este proveedor.
                    </p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="notes">Notas / Motivo General</Label>
                    <Input
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Ej: Devolución por mercadería defectuosa"
                    />
                </div>
            </div>

            <div className="rounded-lg border bg-slate-50 p-4 dark:bg-slate-900">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold">Productos a Devolver</h3>
                    <div className="flex w-full gap-2 sm:w-auto">
                        <Select onValueChange={handleAddItem} disabled={!selectedSupplierId || loading}>
                            <SelectTrigger className="w-full sm:w-[250px]">
                                <SelectValue placeholder="Agregar producto a la lista..." />
                            </SelectTrigger>
                            <SelectContent>
                                {products.map((product) => (
                                    <SelectItem key={product.id} value={product.id}>
                                        {product.sku} - {product.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {items.length === 0 ? (
                    <div className="rounded-lg border-2 border-dashed py-8 text-center text-muted-foreground">
                        <Search className="mx-auto mb-2 h-8 w-8 opacity-50" />
                        <p>Seleccione un producto para agregarlo a la devolución</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-semibold text-muted-foreground sm:grid">
                            <div className="col-span-5">Producto</div>
                            <div className="col-span-2 text-center">Cantidad</div>
                            <div className="col-span-2 text-right">Costo Unit.</div>
                            <div className="col-span-2">Motivo</div>
                            <div className="col-span-1" />
                        </div>
                        {items.map((item, index) => (
                            <div key={`${item.product_id}-${index}`} className="grid grid-cols-1 items-center gap-2 rounded border bg-white p-2 dark:bg-slate-800 sm:grid-cols-12">
                                <div className="sm:col-span-5">
                                    <div className="text-sm font-medium">{item.product_name}</div>
                                    <div className="text-xs text-muted-foreground">{item.sku}</div>
                                </div>
                                <div className="sm:col-span-2">
                                    <Label className="mb-1 text-xs sm:hidden">Cantidad</Label>
                                    <Input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        value={item.quantity}
                                        onChange={(e) => handleUpdateItem(index, 'quantity', Number.parseFloat(e.target.value) || 0)}
                                        className="h-8 text-center"
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <Label className="mb-1 text-xs sm:hidden">Costo unitario</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={item.unit_cost}
                                        onChange={(e) => handleUpdateItem(index, 'unit_cost', Number.parseFloat(e.target.value) || 0)}
                                        className="h-8 text-right"
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <Label className="mb-1 text-xs sm:hidden">Motivo</Label>
                                    <Input
                                        value={item.reason}
                                        onChange={(e) => handleUpdateItem(index, 'reason', e.target.value)}
                                        placeholder="Motivo..."
                                        className="h-8"
                                    />
                                </div>
                                <div className="flex justify-end sm:col-span-1 sm:text-right">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        onClick={() => handleRemoveItem(index)}
                                        className="h-8 w-8 text-red-500 hover:bg-red-50 hover:text-red-700"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {items.length > 0 && (
                    <div className="mt-4 flex items-center justify-end gap-4 border-t pt-4">
                        <span className="text-sm font-medium">Total Estimado de Devolución:</span>
                        <span className="text-xl font-bold text-slate-900 dark:text-white">${totalAmount.toLocaleString()}</span>
                    </div>
                )}
            </div>

            <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={isSubmitting || items.length === 0} className="bg-red-600 text-white hover:bg-red-700">
                    <Save className="mr-2 h-4 w-4" />
                    {isSubmitting ? 'Guardando...' : 'Confirmar devolucion'}
                </Button>
            </div>
        </form>
    );
};
