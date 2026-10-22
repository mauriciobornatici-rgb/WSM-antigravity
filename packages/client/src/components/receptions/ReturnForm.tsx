import { useEffect, useState, type FormEvent } from 'react';
import { Trash2, Save, Search } from 'lucide-react';
import { api } from '@/services/api';
import { showErrorToast } from '@/lib/errorHandling';
import { formatMoney } from '@/lib/formatters';
import { grossLineTotal } from '@/lib/pricing';
import { toast } from 'sonner';
import type { Product, Supplier } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ReceptionPicker } from '@/components/receptions/ReceptionPicker';
import { receptionIdToSend } from '@/lib/receptionChoice';
import { returnItemCost, useReturnCosts } from '@/components/returns/useReturnCosts';
import { ReturnCostField } from '@/components/returns/ReturnCostField';

interface ReturnFormProps {
    onCancel: () => void;
    onSubmit: (data: Parameters<typeof api.createReturn>[0]) => Promise<void>;
}

interface ReturnItem {
    product_id: string;
    product_name: string;
    sku: string;
    quantity: number;
    // Typed by purchasing (ADR-028); undefined or empty: the last invoiced cost applies.
    cost_input?: string;
    reason: string;
}

export const ReturnForm = ({ onCancel, onSubmit }: ReturnFormProps) => {
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [selectedSupplierId, setSelectedSupplierId] = useState('');
    const [receptionId, setReceptionId] = useState('');
    const [items, setItems] = useState<ReturnItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const returnCosts = useReturnCosts(selectedSupplierId, receptionId, items.map((item) => item.product_id));
    const { canSetCost, costs } = returnCosts;
    // What the supplier takes it back at: typed by purchasing, or the last invoiced cost (ADR-028).
    const costOf = (item: ReturnItem) => returnItemCost(item, canSetCost, costs);
    const costsMissing = items.some((item) => costOf(item) == null);

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

        const stockAvailable = Number(product.stock_current || 0);
        if (stockAvailable <= 0) {
            toast.error(`No hay stock disponible en el almacén para el producto ${product.name}. No se puede realizar la devolución.`);
            return;
        }

        if (items.some((item) => item.product_id === productId)) {
            toast.warning('El producto ya se encuentra en la lista.');
            return;
        }

        setItems((prev) => [
            ...prev,
            {
                product_id: product.id,
                product_name: product.name,
                sku: product.sku,
                quantity: 1,
                reason: '',
            },
        ]);
    };

    const handleRemoveItem = (index: number) => {
        setItems((prev) => prev.filter((_, idx) => idx !== index));
    };

    const handleUpdateItem = <K extends keyof ReturnItem>(index: number, field: K, value: ReturnItem[K]) => {
        if (field === 'quantity') {
            const item = items[index];
            if (item) {
                const product = products.find((p) => p.id === item.product_id);
                const stockAvailable = Number(product?.stock_current || 0);
                const inputQty = Number(value);
                if (inputQty > stockAvailable) {
                    toast.error(`Stock insuficiente. Solo hay ${stockAvailable} unidades disponibles de este producto.`);
                    value = stockAvailable as ReturnItem[K];
                }
            }
        }
        setItems((prev) => prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)));
    };

    // ADR-028: purchasing may type another cost; clearing it (or undefined) uses the suggested one.
    const handleCostChange = (index: number, costInput: string | undefined) => {
        setItems((prev) => prev.map((item, idx) => {
            if (idx !== index) return item;
            const next = { ...item };
            if (costInput === undefined) delete next.cost_input;
            else next.cost_input = costInput;
            return next;
        }));
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!selectedSupplierId) {
            showErrorToast('Elegí un proveedor', new Error('El proveedor es obligatorio.'));
            return;
        }
        if (items.length === 0) {
            showErrorToast('Agregá productos', new Error('Agregá al menos un producto para devolver.'));
            return;
        }

        if (!receptionId) {
            showErrorToast('Elegí el remito', new Error('Elegí el remito con el que llegó la mercadería, o «Sin remito» si el proveedor ya la facturó.'));
            return;
        }
        const invalid = items.find((item) => !Number.isInteger(item.quantity) || item.quantity < 1);
        if (invalid) {
            showErrorToast('Cantidad inválida', new Error(`Revisá ${invalid.product_name}: se devuelven unidades enteras, al menos 1.`));
            return;
        }
        if (costsMissing || returnCosts.failed) {
            showErrorToast('Falta el costo', new Error('Todavía no está el costo de todos los productos: esperá a que se calcule o reintentá.'));
            return;
        }
        const reception = receptionIdToSend(receptionId);
        const payload: Parameters<typeof api.createReturn>[0] = {
            supplier_id: selectedSupplierId,
            ...(reception ? { reception_id: reception } : {}),
            items: items.map((item) => ({
                product_id: item.product_id,
                quantity: item.quantity,
                reason: item.reason,
                ...(canSetCost && item.cost_input !== undefined && item.cost_input.trim() !== ''
                    ? { unit_cost: Number(item.cost_input) }
                    : {}),
            })),
            ...(notes ? { notes } : {}),
        };

        setIsSubmitting(true);
        try {
            await onSubmit(payload);
        } finally {
            setIsSubmitting(false);
        }
    };

    // The cost is net (supplier invoice); what is shown is the final one (ADR-015).
    const vatRateOfItem = (item: ReturnItem) => products.find((p) => p.id === item.product_id)?.vat_rate;
    const totalAmount = items.reduce((sum, item) => sum + grossLineTotal(item.quantity, costOf(item) ?? 0, vatRateOfItem(item)), 0);

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="supplier">Proveedor</Label>
                    <Select value={selectedSupplierId} onValueChange={(value) => { setSelectedSupplierId(value); setReceptionId(''); }}>
                        <SelectTrigger id="supplier">
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
                <ReceptionPicker
                    id="return-reception"
                    supplierId={selectedSupplierId}
                    value={receptionId}
                    onChange={setReceptionId}
                />
                <div className="space-y-2 lg:col-span-2">
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
                            <div className="col-span-2 text-right">Costo Unit. neto</div>
                            <div className="col-span-2">Motivo</div>
                            <div className="col-span-1" />
                        </div>
                        {items.map((item, index) => (
                            <div key={`${item.product_id}-${index}`} className="grid grid-cols-1 items-center gap-2 rounded border bg-white p-2 dark:bg-slate-800 sm:grid-cols-12">
                                <div className="sm:col-span-5">
                                    <div className="text-sm font-medium">{item.product_name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        SKU: {item.sku} | Stock Disponible: <span className="font-bold text-slate-700 dark:text-slate-200">{products.find(p => p.id === item.product_id)?.stock_current || 0} u</span>
                                    </div>
                                </div>
                                <div className="sm:col-span-2">
                                    <Label htmlFor={`return-form-quantity-${index}`} className="mb-1 text-xs sm:hidden">Cantidad</Label>
                                    <Input
                                        id={`return-form-quantity-${index}`}
                                        type="number"
                                        min="1"
                                        step="1"
                                        inputMode="numeric"
                                        aria-label={`Cantidad de ${item.product_name}`}
                                        value={item.quantity}
                                        onChange={(e) => handleUpdateItem(index, 'quantity', Math.trunc(Number(e.target.value)) || 0)}
                                        className="h-11 text-center lg:h-9"
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <Label htmlFor={`return-form-cost-${index}`} className="mb-1 text-xs sm:hidden">Costo unitario neto</Label>
                                    <ReturnCostField
                                        id={`return-form-cost-${index}`}
                                        productName={item.product_name}
                                        costInput={item.cost_input}
                                        suggested={costs.get(item.product_id)}
                                        cost={costOf(item)}
                                        vatRate={vatRateOfItem(item)}
                                        canSetCost={canSetCost}
                                        waitingForReception={returnCosts.waitingForReception}
                                        loading={returnCosts.loading}
                                        failed={returnCosts.failed}
                                        onRetry={returnCosts.retry}
                                        onChange={(costInput) => handleCostChange(index, costInput)}
                                    />
                                </div>
                                <div className="sm:col-span-2">
                                    <Label htmlFor={`return-form-reason-${index}`} className="mb-1 text-xs sm:hidden">Motivo</Label>
                                    <Input
                                        id={`return-form-reason-${index}`}
                                        aria-label={`Motivo de ${item.product_name}`}
                                        value={item.reason}
                                        onChange={(e) => handleUpdateItem(index, 'reason', e.target.value)}
                                        placeholder="Motivo..."
                                        className="h-11 lg:h-9"
                                    />
                                </div>
                                <div className="flex justify-end sm:col-span-1 sm:text-right">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        type="button"
                                        aria-label={`Quitar ${item.product_name}`}
                                        onClick={() => handleRemoveItem(index)}
                                        className="h-11 w-11 text-red-500 hover:bg-red-50 hover:text-red-700"
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
                        <span className="text-sm font-medium">Total estimado de la devolución (IVA incl.):</span>
                        <span className="text-xl font-bold text-slate-900 dark:text-white" aria-live="polite">
                            {costsMissing ? 'Calculando…' : formatMoney(totalAmount)}
                        </span>
                    </div>
                )}
            </div>

            <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={isSubmitting || items.length === 0} className="bg-red-600 text-white hover:bg-red-700">
                    <Save className="mr-2 h-4 w-4" />
                    {isSubmitting ? 'Guardando...' : 'Confirmar devolución'}
                </Button>
            </div>
        </form>
    );
};
