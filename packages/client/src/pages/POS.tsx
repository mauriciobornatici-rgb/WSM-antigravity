import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { POSHeader } from "@/components/pos/POSHeader";
import { toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";
import { api } from "@/services/api";
import { isApiError } from "@/services/httpClient";
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
import { PrintableInvoiceArea } from "@/components/invoices/PrintableInvoiceArea";
import { PrintableThermalTicket } from "@/components/invoices/PrintableThermalTicket";
import { usePOSCart } from "@/hooks/usePOSCart";
import { usePOSHotkeys } from "@/hooks/usePOSHotkeys";
import { playScanErrorBeep } from "@/lib/scanAudio";
import { createClientUuid } from "@/lib/clientUuid";
import {
    enqueueOfflineSale,
    getOfflineQueue,
    syncOfflineSales,
} from "@/lib/offlineSalesQueue";

function roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function defaultPaymentSplit(amount = 0): PaymentSplit {
    return { id: createClientUuid(), method: "cash", amount: roundMoney(amount) };
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
    const [paymentSplits, setPaymentSplits] = useState<PaymentSplit[]>(() => [defaultPaymentSplit(0)]);
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
                toast.info(`Emisión de comprobante: ${next ? "Activada" : "Desactivada"}`);
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
                || (product.family_name ?? "").toLowerCase().includes(query)
                || product.sku.toLowerCase().includes(query)
                || (product.barcode ?? "").toLowerCase().includes(query)
                || (product.brand ?? "").toLowerCase().includes(query)
                || (product.size ?? "").toLowerCase().includes(query)
                || (product.color ?? "").toLowerCase().includes(query)
                || (product.location ?? "").toLowerCase().includes(query)
            );
        }).sort((first, second) => (
            first.name.localeCompare(second.name, "es", { sensitivity: "base" })
            || (first.size ?? "").localeCompare(second.size ?? "", "es", { numeric: true, sensitivity: "base" })
            || (first.color ?? "").localeCompare(second.color ?? "", "es", { sensitivity: "base" })
            || first.sku.localeCompare(second.sku, "es", { numeric: true, sensitivity: "base" })
        ));
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
        const checkoutIdempotencyKey = createClientUuid();
        let orderCommitted = false;

        const contingencySale = {
            idempotency_key: checkoutIdempotencyKey,
            customer_name: selectedClient?.name || "Consumidor final",
            ...(previousClientId ? { client_id: previousClientId } : {}),
            payment_method: primaryPaymentMethod,
            payments: positiveSplits.map((payment) => ({ method: payment.method, amount: payment.amount })),
            items: previousCart.map((item) => ({
                product_id: item.id,
                name: item.name,
                quantity: item.quantity,
                sale_price: Number(item.sale_price),
                vat_rate: item.vat_rate != null ? Number(item.vat_rate) : 21,
            })),
            emit_invoice: previousEmitInvoice,
            invoice_type: invoiceType,
            shift_id: currentShift.id,
        };

        const restoreCheckout = () => {
            setProducts(previousProducts);
            setCart(previousCart);
            setSelectedClientId(previousClientId);
            setEmitInvoice(previousEmitInvoice);
            setPaymentSplits(previousPaymentSplits);
            setSuccessDialogOpen(false);
            setPaymentDialogOpen(true);
        };

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
            try {
                enqueueOfflineSale(contingencySale);
                refreshOfflineCount();
                toast.warning("Sin red: Venta guardada en la cola offline de contingencia.");
            } catch (storageError) {
                restoreCheckout();
                showErrorToast("No se pudo resguardar la venta; el carrito fue restaurado.", storageError);
            }
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
                payments: positiveSplits.map((line) => ({ method: line.method, amount: line.amount })),
                items: previousCart.map((item) => ({
                    product_id: item.id,
                    quantity: item.quantity,
                })),
            };
            if (previousClientId) orderPayload.client_id = previousClientId;

            const order = await api.createOrder(orderPayload);
            orderCommitted = true;
            setLastOrderId(order.id);

            if (previousEmitInvoice) {
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
            // Una respuesta de red puede perderse después del commit. Si alguna etapa ya
            // fue confirmada, reintentamos todo con la misma clave idempotente.
            const errorMessage = error instanceof Error ? error.message.toLowerCase() : "";
            const isNetworkError = !navigator.onLine || ["fetch", "network", "timeout"].some((term) => errorMessage.includes(term));
            const isUncertainServerFailure = isApiError(error) && error.status >= 500;
            if (isNetworkError || isUncertainServerFailure || orderCommitted) {
                try {
                    enqueueOfflineSale(contingencySale);
                    refreshOfflineCount();
                    setSuccessDialogOpen(false);
                    toast.warning("Checkout incompleto: quedó resguardado para reintento seguro.");
                } catch (storageError) {
                    if (!orderCommitted) restoreCheckout();
                    showErrorToast(
                        orderCommitted
                            ? "La venta fue creada, pero no pudo guardarse el reintento. Revísala en el historial."
                            : "No se pudo resguardar la venta; el carrito fue restaurado.",
                        storageError,
                    );
                }
            } else {
                // Rollback state to prior values on non-network validation error
                restoreCheckout();
                showErrorToast("Error al procesar la venta. El carrito ha sido restaurado.", error);
            }
        } finally {
            setProcessing(false);
        }
    }

    return (
        <div className="space-y-4">
            <POSHeader
                onBack={() => navigate("/")}
                onOpenHistory={() => setHistoryDialogOpen(true)}
                parkedCartsCount={parkedCarts.length}
                onOpenParkedCarts={() => setParkedDialogOpen(true)}
                offlineQueueCount={offlineQueueCount}
                syncingOffline={syncingOffline}
                onSyncOffline={() => void handleSyncOffline()}
                theme={theme}
                onToggleTheme={toggleTheme}
                isOnline={isOnline}
            />


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
