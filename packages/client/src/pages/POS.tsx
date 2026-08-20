import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, History, Moon, PauseCircle, RefreshCw, Sun, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";
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
import { POSHistoryDialog } from "@/components/pos/POSHistoryDialog";
import { ParkedCartsDialog } from "@/components/pos/ParkedCartsDialog";
import type { InvoiceType, NewClientForm, PaymentSplit, POSProduct } from "@/components/pos/types";
import { Button } from "@/components/ui/button";
import { PrintableInvoiceArea } from "@/components/invoices/PrintableInvoiceArea";
import { PrintableThermalTicket } from "@/components/invoices/PrintableThermalTicket";
import { usePOSCart } from "@/hooks/usePOSCart";
import { usePOSHotkeys } from "@/hooks/usePOSHotkeys";
import { playScanErrorBeep } from "@/lib/scanAudio";
import {
    enqueueOfflineSale,
    getOfflineQueue,
    syncOfflineSales,
} from "@/lib/offlineSalesQueue";

function roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function defaultPaymentSplit(amount = 0): PaymentSplit {
    return { id: crypto.randomUUID(), method: "cash", amount: roundMoney(amount) };
}

export default function POSPage() {
    const navigate = useNavigate();
    const { theme, toggleTheme } = useTheme();
    const [products, setProducts] = useState<POSProduct[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const {
        cart,
        setCart,
        addToCart,
        updateQuantity,
        removeFromCart,
        subtotal,
        taxAmount,
        grandTotal,
        parkedCarts,
        parkCurrentCart,
        restoreParkedCart,
        deleteParkedCart,
    } = usePOSCart();
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
    const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
    const [parkedDialogOpen, setParkedDialogOpen] = useState(false);

    const [companySettings, setCompanySettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
    const [currentRegister, setCurrentRegister] = useState<CashRegister | null>(null);
    const [currentShift, setCurrentShift] = useState<CashShiftSummary | null>(null);
    const [activePrintLayout, setActivePrintLayout] = useState<"a4" | "thermal" | null>(null);
    const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

    const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
    const [offlineQueueCount, setOfflineQueueCount] = useState<number>(() => getOfflineQueue().length);
    const [syncingOffline, setSyncingOffline] = useState(false);

    const refreshOfflineCount = useCallback(() => {
        setOfflineQueueCount(getOfflineQueue().length);
    }, []);

    const handleSyncOffline = useCallback(async () => {
        const queue = getOfflineQueue();
        if (queue.length === 0) return;

        try {
            setSyncingOffline(true);
            const res = await syncOfflineSales({
                createOrder: api.createOrder,
                createInvoice: api.createInvoice,
                addShiftPayment: api.addShiftPayment,
            });

            refreshOfflineCount();
            if (res.synced > 0) {
                toast.success(`Sincronización completada: ${res.synced} venta(s) procesada(s).`);
            }
            if (res.failed > 0) {
                toast.error(`${res.failed} venta(s) no pudieron sincronizarse. Se reintentará luego.`);
            }
        } catch {
            toast.error("Error al sincronizar cola offline.");
        } finally {
            setSyncingOffline(false);
        }
    }, [refreshOfflineCount]);

    // Online/Offline network monitoring
    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            toast.success("Conexión restablecida.");
            void handleSyncOffline();
        };
        const handleOffline = () => {
            setIsOnline(false);
            toast.warning("Sin conexión. Las ventas se guardarán en la cola offline de contingencia.");
        };

        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        return () => {
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
        };
    }, [handleSyncOffline]);

    usePOSHotkeys({
        onSearchFocus: () => {
            const inputEl = document.querySelector<HTMLInputElement>("input[type='search'], input[placeholder*='Buscar']");
            inputEl?.focus();
        },
        onPaymentOpen: () => {
            if (cart.length > 0) {
                setPaymentDialogOpen(true);
            } else {
                toast.warning("El carrito está vacío");
            }
        },
        onEscape: () => {
            setSearch("");
            setPaymentDialogOpen(false);
            setClientDialogOpen(false);
            setHistoryDialogOpen(false);
            setParkedDialogOpen(false);
        },
        onToggleInvoice: () => {
            setEmitInvoice((prev) => {
                const next = !prev;
                toast.info(`Facturación fiscal AFIP: ${next ? "Activada" : "Desactivada"}`);
                return next;
            });
        },
        onClearCart: () => {
            if (cart.length > 0) {
                setCart([]);
                toast.info("Carrito vaciado");
            }
        },
        onOpenHistory: () => {
            setHistoryDialogOpen(true);
        },
    });

    const handlePrint = (layout: "a4" | "thermal", invoice: Invoice) => {
        setActivePrintLayout(layout);
        setSelectedInvoice(invoice);
        setTimeout(() => {
            window.print();
        }, 300);
    };

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

    const taxLabel = `IVA ${getTaxRatePercentage(companySettings)}%`;

    const categories = useMemo(() => {
        const values = new Set<string>();
        for (const product of products) {
            values.add(product.category || "Sin categoría");
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

    function handleCatalogScan(rawValue: string) {
        const scannedValue = rawValue.trim().toLowerCase();
        if (!scannedValue) return;

        const product = products.find(
            (item) =>
                item.sku.toLowerCase() === scannedValue
                || (item.barcode ?? "").toLowerCase() === scannedValue,
        );

        if (!product) {
            toast.warning("Código no encontrado");
            playScanErrorBeep();
            return;
        }

        addToCart(product);
        setSearch("");
    }

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

        const normalizedSplits = paymentSplits
            .map((line) => ({
                method: line.method,
                amount: roundMoney(Number(line.amount || 0)),
            }))
            .filter((line) => line.amount > 0);
        const amountsByMethod = new Map<PaymentSplit["method"], number>();
        for (const line of normalizedSplits) {
            amountsByMethod.set(line.method, roundMoney((amountsByMethod.get(line.method) || 0) + line.amount));
        }
        const positiveSplits = Array.from(amountsByMethod, ([method, amount]) => ({ method, amount }));

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

        // Cache previous state for potential rollback
        const previousProducts = [...products];
        const previousCart = [...cart];
        const previousClientId = selectedClientId;
        const previousEmitInvoice = emitInvoice;
        const previousPaymentSplits = [...paymentSplits];
        const checkoutIdempotencyKey = crypto.randomUUID();

        const soldByProduct = cart.reduce<Record<string, number>>((acc, item) => {
            acc[item.id] = (acc[item.id] || 0) + item.quantity;
            return acc;
        }, {});

        // 1. Apply UI changes optimistically (0ms latency experience)
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

        // Si estamos sin conexión directa a internet, encolamos inmediatamente en modo contingencia
        if (!navigator.onLine) {
            enqueueOfflineSale({
                idempotency_key: checkoutIdempotencyKey,
                customer_name: selectedClient?.name || "Consumidor final",
                ...(previousClientId ? { client_id: previousClientId } : {}),
                payment_method: primaryPaymentMethod,
                payments: positiveSplits.map((p) => ({ method: p.method, amount: p.amount })),
                items: previousCart.map((i) => ({
                    product_id: i.id,
                    name: i.name,
                    quantity: i.quantity,
                    sale_price: Number(i.sale_price),
                    vat_rate: i.vat_rate != null ? Number(i.vat_rate) : 21,
                })),
                emit_invoice: previousEmitInvoice,
                invoice_type: invoiceType,
                shift_id: currentShift.id,
            });
            refreshOfflineCount();
            toast.warning("Sin red: Venta guardada en la cola offline de contingencia.");
            return;
        }

        setSuccessDialogOpen(true);

        try {
            setProcessing(true);
            setLastInvoice(null);

            const orderPayload: Parameters<typeof api.createOrder>[0] = {
                idempotency_key: checkoutIdempotencyKey,
                customer_name: selectedClient?.name || "Consumidor final",
                payment_method: primaryPaymentMethod,
                items: previousCart.map((item) => ({
                    product_id: item.id,
                    quantity: item.quantity,
                })),
            };
            if (previousClientId) orderPayload.client_id = previousClientId;

            const order = await api.createOrder(orderPayload);
            setLastOrderId(order.id);

            if (previousEmitInvoice) {
                try {
                    const invoicePayload: Record<string, unknown> = {
                        order_id: order.id,
                        customer_name: selectedClient?.name || "Consumidor final",
                        invoice_type: invoiceType,
                        point_of_sale: 1,
                        payment_method: primaryPaymentMethod,
                        payments: positiveSplits.map((line) => ({ method: line.method, amount: line.amount })),
                        items: previousCart.map((item) => ({
                            product_id: item.id,
                            description: item.name,
                            quantity: item.quantity,
                            unit_price: item.sale_price,
                            vat_rate: item.vat_rate != null ? Number(item.vat_rate) : 21.00,
                        })),
                    };
                    if (previousClientId) invoicePayload.client_id = previousClientId;
                    const invoice = await api.createInvoice(invoicePayload);
                    setLastInvoice(invoice);
                } catch (invoiceError) {
                    showErrorToast("Venta guardada, pero falló la factura", invoiceError);
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

            toast.success("Venta registrada con éxito");
        } catch (error) {
            // Si el servidor falló por error de red o timeout, guardamos en cola offline
            const isNetworkError = !navigator.onLine || (error instanceof Error && (error.message.includes("fetch") || error.message.includes("network") || error.message.includes("timeout")));
            if (isNetworkError) {
                enqueueOfflineSale({
                    idempotency_key: checkoutIdempotencyKey,
                    customer_name: selectedClient?.name || "Consumidor final",
                    ...(previousClientId ? { client_id: previousClientId } : {}),
                    payment_method: primaryPaymentMethod,
                    payments: positiveSplits.map((p) => ({ method: p.method, amount: p.amount })),
                    items: previousCart.map((i) => ({
                        product_id: i.id,
                        name: i.name,
                        quantity: i.quantity,
                        sale_price: Number(i.sale_price),
                        vat_rate: i.vat_rate != null ? Number(i.vat_rate) : 21,
                    })),
                    emit_invoice: previousEmitInvoice,
                    invoice_type: invoiceType,
                    shift_id: currentShift.id,
                });
                refreshOfflineCount();
                setSuccessDialogOpen(false);
                toast.warning("Fallo de conexión: La venta quedó resguardada en cola offline.");
            } else {
                // Rollback state to prior values on non-network validation error
                setProducts(previousProducts);
                setCart(previousCart);
                setSelectedClientId(previousClientId);
                setEmitInvoice(previousEmitInvoice);
                setPaymentSplits(previousPaymentSplits);
                setSuccessDialogOpen(false);
                setPaymentDialogOpen(true);
                showErrorToast("Error al procesar la venta. El carrito ha sido restaurado.", error);
            }
        } finally {
            setProcessing(false);
        }
    }

    return (
        <div className="space-y-4">
            {/* Barra superior de control & estado */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-card/60 p-3 rounded-lg border">
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => navigate("/")}
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span className="hidden sm:inline">Volver</span>
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-blue-800/30 bg-blue-950/20 text-blue-400 hover:bg-blue-950/40 hover:text-blue-300"
                        onClick={() => setHistoryDialogOpen(true)}
                    >
                        <History className="h-4 w-4" />
                        <span>Historial</span>
                        <kbd className="hidden md:inline-block text-[9px] bg-muted/40 px-1 rounded font-mono">F3</kbd>
                    </Button>

                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={`gap-1.5 ${parkedCarts.length > 0 ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold" : ""}`}
                        onClick={() => setParkedDialogOpen(true)}
                        title="Ventas en espera"
                    >
                        <PauseCircle className="h-4 w-4" />
                        <span>En Espera ({parkedCarts.length})</span>
                    </Button>

                    {offlineQueueCount > 0 && (
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="gap-1.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                            onClick={() => void handleSyncOffline()}
                            disabled={syncingOffline}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncingOffline ? "animate-spin" : ""}`} />
                            <span>Sincronizar Offline ({offlineQueueCount})</span>
                        </Button>
                    )}

                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={toggleTheme}
                        title={theme === "dark" ? "Cambiar a Modo Día" : "Cambiar a Modo Noche"}
                    >
                        {theme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-indigo-500" />}
                    </Button>
                </div>

                <div className="flex items-center gap-3 text-xs">
                    {/* Indicador de red */}
                    <div className="flex items-center gap-1.5 font-medium">
                        {isOnline ? (
                            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                <Wifi className="h-3 w-3" /> Online
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
                                <WifiOff className="h-3 w-3" /> Modo Contingencia Offline
                            </span>
                        )}
                    </div>

                    {/* Atajos de ayuda */}
                    <div className="hidden lg:flex items-center gap-2 text-muted-foreground bg-muted/30 px-2.5 py-1 rounded border text-[11px] font-mono">
                        <span><kbd className="bg-background px-1 py-0.5 rounded border">F2</kbd> Buscar</span>
                        <span><kbd className="bg-background px-1 py-0.5 rounded border">F4</kbd> Cobrar</span>
                        <span><kbd className="bg-background px-1 py-0.5 rounded border">F8</kbd> AFIP</span>
                        <span><kbd className="bg-background px-1 py-0.5 rounded border">F9</kbd> Vaciar</span>
                        <span><kbd className="bg-background px-1 py-0.5 rounded border">Esc</kbd> Salir</span>
                    </div>
                </div>
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
                        onClearCart={() => setCart([])}
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
                clients={clients}
                selectedClientId={selectedClientId}
                onClientChange={setSelectedClientId}
                onOpenClientDialog={() => setClientDialogOpen(true)}
                selectedClient={selectedClient}
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
                companySettings={companySettings}
                onPrint={handlePrint}
            />

            <POSHistoryDialog
                open={historyDialogOpen}
                onOpenChange={setHistoryDialogOpen}
                onPrint={handlePrint}
            />

            <ParkedCartsDialog
                open={parkedDialogOpen}
                onOpenChange={setParkedDialogOpen}
                parkedCarts={parkedCarts}
                hasActiveCart={cart.length > 0}
                onParkCurrentCart={(label) => parkCurrentCart(label, selectedClientId || undefined)}
                onRestoreCart={(id) => {
                    const restored = restoreParkedCart(id);
                    if (restored?.clientId) {
                        setSelectedClientId(restored.clientId);
                    }
                }}
                onDeleteCart={deleteParkedCart}
            />

            {activePrintLayout === "a4" && selectedInvoice && (
                <PrintableInvoiceArea
                    invoice={selectedInvoice}
                    companyName={companySettings.identity.legal_name || companySettings.identity.brand_name || "Empresa"}
                    companyTaxId={companySettings.identity.tax_id || "No informado"}
                    companyAddress={`${companySettings.address.street} ${companySettings.address.number || ""}, ${companySettings.address.city}`}
                    taxRateLabel={`IVA (${Number(companySettings.operation.tax_rate * 100).toFixed(0)}%)`}
                    companySettings={companySettings}
                />
            )}

            {activePrintLayout === "thermal" && selectedInvoice && (
                <PrintableThermalTicket
                    invoice={selectedInvoice}
                    companyName={companySettings.identity.legal_name || companySettings.identity.brand_name || "Empresa"}
                    companyTaxId={companySettings.identity.tax_id || "No informado"}
                    companyAddress={`${companySettings.address.street} ${companySettings.address.number || ""}, ${companySettings.address.city}`}
                    companySettings={companySettings}
                />
            )}
        </div>
    );
}
