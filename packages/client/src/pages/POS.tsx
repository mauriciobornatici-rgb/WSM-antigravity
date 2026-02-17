import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { api } from "@/services/api";
import type { Client, CompanySettings, Product } from "@/types";
import type { CashRegister, CashShiftSummary } from "@/types/api";
import { showErrorToast } from "@/lib/errorHandling";
import { DEFAULT_COMPANY_SETTINGS, fetchCompanySettingsSafe, getTaxRatePercentage } from "@/lib/companySettings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type POSProduct = Product & { stock: number };
type CartItem = POSProduct & { quantity: number };
type PaymentMethod = "cash" | "debit_card" | "qr" | "credit_account";

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
];

export default function POSPage() {
    const [products, setProducts] = useState<POSProduct[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [selectedClientId, setSelectedClientId] = useState("");
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(true);

    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
    const [emitInvoice, setEmitInvoice] = useState(false);
    const [companySettings, setCompanySettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);

    const [currentRegister, setCurrentRegister] = useState<CashRegister | null>(null);
    const [currentShift, setCurrentShift] = useState<CashShiftSummary | null>(null);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        void loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [clientsResponse, productsResponse, registersResponse, settingsResponse] = await Promise.all([
                api.getClients(),
                api.getProducts(),
                api.getCashRegisters(),
                fetchCompanySettingsSafe(),
            ]);
            setClients(clientsResponse);
            setCompanySettings(settingsResponse);
            setProducts(productsResponse.map((product) => ({ ...product, stock: Number(product.stock_current ?? 0) })));

            const primaryRegister = registersResponse[0] ?? null;
            setCurrentRegister(primaryRegister);
            if (primaryRegister) {
                const shift = await api.getOpenShift(primaryRegister.id);
                setCurrentShift(shift);
            } else {
                setCurrentShift(null);
            }
        } catch (error) {
            showErrorToast("Error al cargar POS", error);
        } finally {
            setLoading(false);
        }
    }

    const taxRate = companySettings.operation.tax_rate;
    const taxLabel = `IVA ${getTaxRatePercentage(companySettings)}%`;

    const filteredProducts = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return products;
        return products.filter((product) => {
            return product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query);
        });
    }, [products, search]);

    function addToCart(product: POSProduct) {
        if (product.stock <= 0) {
            toast.warning("Producto sin stock");
            return;
        }
        setCart((current) => {
            const found = current.find((item) => item.id === product.id);
            if (!found) return [...current, { ...product, quantity: 1 }];
            if (found.quantity >= product.stock) {
                toast.warning("No hay mas stock disponible");
                return current;
            }
            return current.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
        });
    }

    function updateQuantity(productId: string, delta: number) {
        setCart((current) =>
            current
                .map((item) => {
                    if (item.id !== productId) return item;
                    const nextQuantity = Math.max(0, item.quantity + delta);
                    if (nextQuantity > item.stock) {
                        toast.warning("No hay mas stock disponible");
                        return item;
                    }
                    return { ...item, quantity: nextQuantity };
                })
                .filter((item) => item.quantity > 0),
        );
    }

    function removeFromCart(productId: string) {
        setCart((current) => current.filter((item) => item.id !== productId));
    }

    const subtotal = cart.reduce((sum, item) => sum + Number(item.sale_price || 0) * item.quantity, 0);
    const taxAmount = subtotal * taxRate;
    const grandTotal = subtotal + taxAmount;

    async function handleCheckout() {
        if (cart.length === 0) {
            toast.warning("No hay productos en el carrito");
            return;
        }
        if (!currentShift) {
            toast.error("No hay caja abierta");
            return;
        }
        if (paymentMethod === "credit_account" && !selectedClientId) {
            toast.error("Cuenta corriente requiere cliente");
            return;
        }

        const selectedClient = clients.find((client) => client.id === selectedClientId);
        try {
            setProcessing(true);
            const orderPayload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedClient?.name || "Consumidor final",
                payment_method: paymentMethod,
                items: cart.map((item) => ({ product_id: item.id, quantity: item.quantity })),
            };
            if (selectedClientId) orderPayload.client_id = selectedClientId;

            const order = await api.createOrder(orderPayload);

            if (emitInvoice) {
                try {
                    const invoicePayload: Record<string, unknown> = {
                        order_id: order.id,
                        invoice_type: "B",
                        point_of_sale: 1,
                        items: cart.map((item) => ({
                            product_id: item.id,
                            description: item.name,
                            quantity: item.quantity,
                            unit_price: item.sale_price,
                            vat_rate: getTaxRatePercentage(companySettings),
                        })),
                    };
                    if (selectedClientId) invoicePayload.client_id = selectedClientId;
                    await api.createInvoice(invoicePayload);
                } catch (error) {
                    showErrorToast("La venta se guardo pero fallo la factura", error);
                }
            }

            await api.addShiftPayment(currentShift.id, {
                order_id: order.id,
                payment_method: paymentMethod,
                amount: grandTotal,
                type: "sale",
            });

            const soldByProduct = cart.reduce<Record<string, number>>((acc, item) => {
                acc[item.id] = (acc[item.id] || 0) + item.quantity;
                return acc;
            }, {});

            setProducts((current) =>
                current.map((product) => ({
                    ...product,
                    stock: Math.max(0, product.stock - (soldByProduct[product.id] || 0)),
                })),
            );
            setCart([]);
            setSelectedClientId("");
            setEmitInvoice(false);
            setPaymentDialogOpen(false);
            toast.success("Venta registrada");
        } catch (error) {
            showErrorToast("Error al procesar la venta", error);
        } finally {
            setProcessing(false);
        }
    }

    return (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5" />
                            Punto de venta
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar por nombre o SKU"
                                className="pl-8"
                            />
                        </div>
                        {loading ? (
                            <div className="py-8 text-center text-muted-foreground">Cargando productos...</div>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                                {filteredProducts.map((product) => (
                                    <button
                                        key={product.id}
                                        onClick={() => addToCart(product)}
                                        className="rounded-lg border p-3 text-left transition hover:bg-slate-50"
                                    >
                                        <div className="font-semibold">{product.name}</div>
                                        <div className="text-xs text-muted-foreground">{product.sku}</div>
                                        <div className="mt-2 flex items-center justify-between">
                                            <span className="font-bold">${Number(product.sale_price).toLocaleString("es-AR")}</span>
                                            <Badge variant={product.stock > 0 ? "outline" : "destructive"}>Stock: {product.stock}</Badge>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Carrito</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {cart.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Aun no agregaste productos.</p>
                        ) : (
                            cart.map((item) => (
                                <div key={item.id} className="rounded-md border p-2">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-medium">{item.name}</div>
                                            <div className="text-xs text-muted-foreground">${Number(item.sale_price).toLocaleString("es-AR")}</div>
                                        </div>
                                        <Button size="icon" variant="ghost" onClick={() => removeFromCart(item.id)}>
                                            <Trash2 className="h-4 w-4 text-red-500" />
                                        </Button>
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <Button size="sm" variant="outline" onClick={() => updateQuantity(item.id, -1)}>
                                            -
                                        </Button>
                                        <span className="w-8 text-center">{item.quantity}</span>
                                        <Button size="sm" variant="outline" onClick={() => updateQuantity(item.id, 1)}>
                                            <Plus className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            ))
                        )}

                        <div className="space-y-1 rounded-md border bg-slate-50 p-3 text-sm">
                            <div className="flex justify-between">
                                <span>Subtotal</span>
                                <span>${subtotal.toLocaleString("es-AR")}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>{taxLabel}</span>
                                <span>${taxAmount.toLocaleString("es-AR")}</span>
                            </div>
                            <div className="flex justify-between font-bold">
                                <span>Total</span>
                                <span>${grandTotal.toLocaleString("es-AR")}</span>
                            </div>
                        </div>

                        <Button className="w-full" onClick={() => setPaymentDialogOpen(true)} disabled={cart.length === 0}>
                            <CreditCard className="mr-2 h-4 w-4" />
                            Cobrar
                        </Button>

                        {!currentShift ? (
                            <p className="text-xs text-red-600">
                                Caja cerrada. Abrela en <Link to="/cash-management" className="underline">Gestion de caja</Link>.
                            </p>
                        ) : null}
                        {currentRegister ? <p className="text-xs text-muted-foreground">Caja activa: {currentRegister.name}</p> : null}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmar cobro</DialogTitle>
                        <DialogDescription>Define cliente, metodo de pago y opcion de factura.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label>Cliente</Label>
                            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Consumidor final" />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Metodo</Label>
                            <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {PAYMENT_METHODS.map((method) => (
                                        <SelectItem key={method.value} value={method.value}>
                                            {method.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={emitInvoice} onChange={(event) => setEmitInvoice(event.target.checked)} />
                            Emitir factura
                        </label>
                        <div className="rounded-md border bg-slate-50 p-3 text-right font-semibold">
                            Total: ${grandTotal.toLocaleString("es-AR")}
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void handleCheckout()} disabled={processing}>
                            {processing ? "Procesando..." : "Confirmar venta"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
