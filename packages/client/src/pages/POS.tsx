import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Client, CompanySettings } from "@/types";
import type { CashRegister, CashShiftSummary, Invoice } from "@/types/api";
import { showErrorToast } from "@/lib/errorHandling";
import { DEFAULT_COMPANY_SETTINGS, fetchCompanySettingsSafe, getTaxRatePercentage } from "@/lib/companySettings";
import { CartPanelCard } from "@/components/pos/CartPanelCard";
import { CheckoutSuccessDialog } from "@/components/pos/CheckoutSuccessDialog";
import { PaymentDialog } from "@/components/pos/PaymentDialog";
import { ProductCatalogCard } from "@/components/pos/ProductCatalogCard";
import { QuickClientDialog } from "@/components/pos/QuickClientDialog";
import type { CartItem, InvoiceType, NewClientForm, PaymentSplit, POSProduct } from "@/components/pos/types";
import { Button } from "@/components/ui/button";

function roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function defaultPaymentSplit(amount = 0): PaymentSplit {
    return { id: crypto.randomUUID(), method: "cash", amount: roundMoney(amount) };
}

export default function POSPage() {
    const navigate = useNavigate();
    const [products, setProducts] = useState<POSProduct[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("all");
    const [selectedClientId, setSelectedClientId] = useState("");

    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
    const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>([defaultPaymentSplit(0)]);
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
            return (
                product.name.toLowerCase().includes(query)
                || product.sku.toLowerCase().includes(query)
                || (product.barcode ?? "").toLowerCase().includes(query)
            );
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

    function handleCatalogScan(rawValue: string) {
        const scannedValue = rawValue.trim().toLowerCase();
        if (!scannedValue) return;

        const product = products.find(
            (item) =>
                item.sku.toLowerCase() === scannedValue
                || (item.barcode ?? "").toLowerCase() === scannedValue,
        );

        if (!product) {
            toast.warning("Codigo no encontrado");
            return;
        }

        addToCart(product);
        setSearch("");
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

        const positiveSplits = paymentSplits
            .map((line) => ({
                method: line.method,
                amount: roundMoney(Number(line.amount || 0)),
            }))
            .filter((line) => line.amount > 0);

        if (positiveSplits.length === 0) {
            toast.error("Debes cargar al menos un monto de pago");
            return;
        }

        const assignedTotal = roundMoney(positiveSplits.reduce((sum, line) => sum + line.amount, 0));
        if (Math.abs(assignedTotal - grandTotal) > 0.01) {
            toast.error("La suma de medios de pago debe coincidir con el total");
            return;
        }

        if (positiveSplits.some((line) => line.method === "credit_account") && !selectedClientId) {
            toast.error("Cuenta corriente requiere cliente");
            return;
        }

        let primaryPaymentMethod = positiveSplits[0]?.method ?? "cash";
        let primaryAmount = positiveSplits[0]?.amount ?? 0;
        for (const line of positiveSplits) {
            if (line.amount > primaryAmount) {
                primaryAmount = line.amount;
                primaryPaymentMethod = line.method;
            }
        }

        try {
            setProcessing(true);
            setLastInvoice(null);

            const orderPayload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedClient?.name || "Consumidor final",
                payment_method: primaryPaymentMethod,
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
                        payment_method: primaryPaymentMethod,
                        payments: positiveSplits.map((line) => ({ method: line.method, amount: line.amount })),
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

            for (const line of positiveSplits) {
                await api.addShiftPayment(currentShift.id, {
                    order_id: order.id,
                    payment_method: line.method,
                    amount: line.amount,
                    type: "sale",
                });
            }

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
            setPaymentSplits([defaultPaymentSplit(0)]);
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
        <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2 sm:w-auto"
                    onClick={() => navigate("/")}
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver al menu principal
                </Button>
                <p className="text-sm text-muted-foreground">Terminal de venta</p>
            </div>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_380px]">
                <div className="space-y-4">
                    <ProductCatalogCard
                        loading={loading}
                        search={search}
                        onSearchChange={setSearch}
                        categoryFilter={categoryFilter}
                        onCategoryFilterChange={setCategoryFilter}
                        categories={categories}
                        filteredProducts={filteredProducts}
                        onAddToCart={addToCart}
                        onScanSubmit={handleCatalogScan}
                    />
                </div>

                <div className="space-y-4">
                    <CartPanelCard
                        clients={clients}
                        selectedClientId={selectedClientId}
                        onClientChange={setSelectedClientId}
                        onOpenClientDialog={() => setClientDialogOpen(true)}
                        selectedClient={selectedClient}
                        cart={cart}
                        onRemoveFromCart={removeFromCart}
                        onUpdateQuantity={updateQuantity}
                        subtotal={subtotal}
                        taxLabel={taxLabel}
                        taxAmount={taxAmount}
                        grandTotal={grandTotal}
                        onOpenPaymentDialog={() => {
                            setPaymentSplits((current) => {
                                const currentTotal = roundMoney(current.reduce((sum, line) => sum + Number(line.amount || 0), 0));
                                const shouldReset = current.length === 0 || Math.abs(currentTotal - grandTotal) > 0.01;
                                if (shouldReset) return [defaultPaymentSplit(grandTotal)];
                                return current;
                            });
                            setPaymentDialogOpen(true);
                        }}
                        currentShift={currentShift}
                        currentRegister={currentRegister}
                    />
                </div>
            </div>

            <PaymentDialog
                open={paymentDialogOpen}
                onOpenChange={setPaymentDialogOpen}
                paymentSplits={paymentSplits}
                onPaymentSplitsChange={setPaymentSplits}
                emitInvoice={emitInvoice}
                onEmitInvoiceChange={setEmitInvoice}
                invoiceType={invoiceType}
                onInvoiceTypeChange={setInvoiceType}
                grandTotal={grandTotal}
                processing={processing}
                onConfirm={() => {
                    void handleCheckout();
                }}
            />

            <QuickClientDialog
                open={clientDialogOpen}
                onOpenChange={setClientDialogOpen}
                newClient={newClient}
                onNewClientChange={(patch) => setNewClient((current) => ({ ...current, ...patch }))}
                creatingClient={creatingClient}
                onCreateClient={() => {
                    void createClient();
                }}
            />

            <CheckoutSuccessDialog
                open={successDialogOpen}
                onOpenChange={setSuccessDialogOpen}
                lastOrderId={lastOrderId}
                lastInvoice={lastInvoice}
                grandTotal={grandTotal}
            />
        </div>
    );
}
