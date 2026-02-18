import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Search, ShoppingCart, Trash2, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Client, CompanySettings, Product } from "@/types";
import type { CashRegister, CashShiftSummary, Invoice } from "@/types/api";
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
type PaymentMethod = "cash" | "debit_card" | "credit_card" | "qr" | "transfer" | "credit_account";
type InvoiceType = "A" | "B";

type NewClientForm = {
    name: string;
    tax_id: string;
    email: string;
    phone: string;
    address: string;
    credit_limit: number;
};

const PAYMENT_METHODS: Array<{ value: PaymentMethod; label: string }> = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta debito" },
    { value: "credit_card", label: "Tarjeta credito" },
    { value: "qr", label: "QR" },
    { value: "transfer", label: "Transferencia" },
    { value: "credit_account", label: "Cuenta corriente" },
];

const INVOICE_TYPES: Array<{ value: InvoiceType; label: string }> = [
    { value: "B", label: "Factura B" },
    { value: "A", label: "Factura A" },
];

export default function POSPage() {
    const [products, setProducts] = useState<POSProduct[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [selectedClientId, setSelectedClientId] = useState("");

    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
    const [emitInvoice, setEmitInvoice] = useState(false);
    const [invoiceType, setInvoiceType] = useState<InvoiceType>("B");
    const [processing, setProcessing] = useState(false);

    const [clientDialogOpen, setClientDialogOpen] = useState(false);
    const [creatingClient, setCreatingClient] = useState(false);
    const [newClient, setNewClient] = useState<NewClientForm>({
        name: "",
        tax_id: "",
        email: "",
        phone: "",
        address: "",
        credit_limit: 0,
    });

    const [successDialogOpen, setSuccessDialogOpen] = useState(false);
    const [lastOrderId, setLastOrderId] = useState<string | null>(null);
    const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);

    const [companySettings, setCompanySettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
    const [currentRegister, setCurrentRegister] = useState<CashRegister | null>(null);
    const [currentShift, setCurrentShift] = useState<CashShiftSummary | null>(null);

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

    const taxRate = Number(companySettings.operation.tax_rate || 0);
    const taxLabel = `IVA ${getTaxRatePercentage(companySettings)}%`;

    const categories = useMemo(() => {
        const values = new Set<string>();
        for (const product of products) {
            values.add(product.category || "Sin categoria");
        }
        return ["all", ...Array.from(values)];
    }, [products]);

    const filteredProducts = useMemo(() => {
        const query = search.trim().toLowerCase();
        return products.filter((product) => {
            const byCategory = categoryFilter === "all" || product.category === categoryFilter;
            if (!byCategory) return false;
            if (!query) return true;
            return product.name.toLowerCase().includes(query) || product.sku.toLowerCase().includes(query);
        });
    }, [products, search, categoryFilter]);

    const selectedClient = useMemo(
        () => clients.find((client) => client.id === selectedClientId) ?? null,
        [clients, selectedClientId],
    );

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

    async function createClient() {
        if (!newClient.name || !newClient.tax_id) {
            toast.error("Nombre y CUIT/DNI son obligatorios");
            return;
        }

        try {
            setCreatingClient(true);
            const created = await api.createClient({
                name: newClient.name,
                tax_id: newClient.tax_id,
                email: newClient.email,
                phone: newClient.phone,
                address: newClient.address,
                credit_limit: Number(newClient.credit_limit || 0),
            });
            setClients((current) => [created, ...current]);
            setSelectedClientId(created.id);
            setClientDialogOpen(false);
            setNewClient({
                name: "",
                tax_id: "",
                email: "",
                phone: "",
                address: "",
                credit_limit: 0,
            });
            toast.success("Cliente creado");
        } catch (error) {
            showErrorToast("Error al crear cliente", error);
        } finally {
            setCreatingClient(false);
        }
    }

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

        try {
            setProcessing(true);
            setLastInvoice(null);

            const orderPayload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedClient?.name || "Consumidor final",
                payment_method: paymentMethod,
                items: cart.map((item) => ({
                    product_id: item.id,
                    quantity: item.quantity,
                })),
            };
            if (selectedClientId) orderPayload.client_id = selectedClientId;

            const order = await api.createOrder(orderPayload);
            setLastOrderId(order.id);

            if (emitInvoice) {
                try {
                    const invoicePayload: Record<string, unknown> = {
                        order_id: order.id,
                        customer_name: selectedClient?.name || "Consumidor final",
                        invoice_type: invoiceType,
                        point_of_sale: 1,
                        payment_method: paymentMethod,
                        payments: [{ method: paymentMethod, amount: grandTotal }],
                        items: cart.map((item) => ({
                            product_id: item.id,
                            description: item.name,
                            quantity: item.quantity,
                            unit_price: item.sale_price,
                            vat_rate: getTaxRatePercentage(companySettings),
                        })),
                    };
                    if (selectedClientId) invoicePayload.client_id = selectedClientId;
                    const invoice = await api.createInvoice(invoicePayload);
                    setLastInvoice(invoice);
                } catch (invoiceError) {
                    showErrorToast("Venta guardada, pero fallo la factura", invoiceError);
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
            setSuccessDialogOpen(true);
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
                        <div className="grid gap-2 md:grid-cols-[1fr_220px]">
                            <div className="relative">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o SKU" className="pl-8" />
                            </div>
                            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas las categorias</SelectItem>
                                    {categories.filter((category) => category !== "all").map((category) => (
                                        <SelectItem key={category} value={category}>
                                            {category}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
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
                    <CardHeader className="space-y-3">
                        <CardTitle>Carrito</CardTitle>
                        <div className="space-y-2">
                            <Label>Cliente</Label>
                            <div className="flex gap-2">
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
                                <Button variant="outline" size="icon" onClick={() => setClientDialogOpen(true)} title="Crear cliente">
                                    <UserPlus className="h-4 w-4" />
                                </Button>
                            </div>
                            {selectedClient ? (
                                <div className="rounded-md border bg-slate-50 p-2 text-xs">
                                    <div>{selectedClient.name}</div>
                                    <div className="text-muted-foreground">{selectedClient.tax_id}</div>
                                </div>
                            ) : null}
                        </div>
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
                                Caja cerrada. Abrela en{" "}
                                <Link to="/cash-management" className="underline">
                                    Gestion de caja
                                </Link>
                                .
                            </p>
                        ) : null}
                        {currentRegister ? (
                            <p className="text-xs text-muted-foreground">
                                Caja activa: {currentRegister.name}
                            </p>
                        ) : null}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmar cobro</DialogTitle>
                        <DialogDescription>Define forma de pago y opcion de factura.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
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

                        {emitInvoice ? (
                            <div className="space-y-2">
                                <Label>Tipo de factura</Label>
                                <Select value={invoiceType} onValueChange={(value) => setInvoiceType(value as InvoiceType)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {INVOICE_TYPES.map((type) => (
                                            <SelectItem key={type.value} value={type.value}>
                                                {type.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        ) : null}

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

            <Dialog open={clientDialogOpen} onOpenChange={setClientDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Crear cliente rapido</DialogTitle>
                        <DialogDescription>Alta minima para operar en POS.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Input placeholder="Nombre" value={newClient.name} onChange={(event) => setNewClient((current) => ({ ...current, name: event.target.value }))} />
                        <Input placeholder="CUIT / DNI" value={newClient.tax_id} onChange={(event) => setNewClient((current) => ({ ...current, tax_id: event.target.value }))} />
                        <Input placeholder="Email" value={newClient.email} onChange={(event) => setNewClient((current) => ({ ...current, email: event.target.value }))} />
                        <Input placeholder="Telefono" value={newClient.phone} onChange={(event) => setNewClient((current) => ({ ...current, phone: event.target.value }))} />
                        <Input placeholder="Direccion" value={newClient.address} onChange={(event) => setNewClient((current) => ({ ...current, address: event.target.value }))} />
                        <Input type="number" placeholder="Limite credito" value={newClient.credit_limit} onChange={(event) => setNewClient((current) => ({ ...current, credit_limit: Number(event.target.value) || 0 }))} />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setClientDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void createClient()} disabled={creatingClient}>
                            {creatingClient ? "Guardando..." : "Crear cliente"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Venta registrada</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 text-sm">
                        <p>Orden: <strong>{lastOrderId || "-"}</strong></p>
                        <p>Factura: <strong>{lastInvoice?.invoice_number ? String(lastInvoice.invoice_number) : "No emitida"}</strong></p>
                        <p>Total: <strong>${grandTotal.toLocaleString("es-AR")}</strong></p>
                    </div>
                    <div className="flex justify-end">
                        <Button onClick={() => setSuccessDialogOpen(false)}>Cerrar</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
