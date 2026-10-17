import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Plus, TrendingDown, Sparkles, MapPin, Move, Download, Tag, BarChart3, Layers3 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { convertToCSV, downloadCSV } from "@/lib/exportUtils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Supplier, InventoryItem, WarehouseLocation, ProductCatalogOption } from "@/types";
import type { PaginationMeta } from "@/types/api";
import { getErrorMessage, showErrorToast } from "@/lib/errorHandling";
import { fetchInventorySnapshot, invalidateInventorySnapshotCache, type ProductWithStock } from "@/lib/inventorySnapshot";
import { ProductForm, type ProductFormSubmitData } from "@/components/products/ProductForm";
import { TraceabilityPanel } from "@/components/products/TraceabilityPanel";
import { InventoryTable } from "@/components/products/InventoryTable";
import { PaginationControls } from "@/components/common/PaginationControls";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PrintableBarcodeLabelsDialog } from "@/components/receptions/PrintableBarcodeLabelsDialog";
import { InventorySummaryCards } from "@/components/inventory/InventorySummaryCards";
import { InventoryLocationsTab } from "@/components/inventory/InventoryLocationsTab";
import { InventoryReplenishmentTab } from "@/components/inventory/InventoryReplenishmentTab";
import { InventoryABCTab } from "@/components/inventory/InventoryABCTab";
import { InventoryTransferDialog } from "@/components/inventory/InventoryTransferDialog";
import { InventoryProcureDialog } from "@/components/inventory/InventoryProcureDialog";
import { analyzeInventoryABC } from "@/lib/inventoryAnalytics";
import { grossPrice } from "@/lib/pricing";
import { ProductCatalogMastersTab } from "@/components/inventory/ProductCatalogMastersTab";
import { ImportDialog } from "@/components/imports/ImportDialog";
import { useAuth } from "@/context/AuthContext";
import { hasPermission, PERMISSIONS } from "@wsm/common";

export default function InventoryPage() {
    const PRODUCTS_PAGE_SIZE = 20;
    const { user } = useAuth();
    const canManageInventory = hasPermission(user?.role, PERMISSIONS.INVENTORY_MANAGE);
    const [products, setProducts] = useState<ProductWithStock[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
    const [warehouseLocations, setWarehouseLocations] = useState<WarehouseLocation[]>([]);
    const [catalogOptions, setCatalogOptions] = useState<ProductCatalogOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [productsPage, setProductsPage] = useState(1);
    const [productsPagination, setProductsPagination] = useState<PaginationMeta | null>(null);
    const [search, setSearch] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<ProductWithStock | null>(null);
    const [deletingProduct, setDeletingProduct] = useState<ProductWithStock | null>(null);

    // Replenishment states
    const [selectedReplenishItems, setSelectedReplenishItems] = useState<Record<string, { quantity: number; supplierId: string }>>({});
    const [procureDialogOpen, setProcureDialogOpen] = useState(false);
    const [isProcuring, setIsProcuring] = useState(false);
    const [isLabelsDialogOpen, setIsLabelsDialogOpen] = useState(false);

    // WMS Transfer states
    const [transferDialogOpen, setTransferDialogOpen] = useState(false);
    const [selectedTransferProduct, setSelectedTransferProduct] = useState("");
    const [transferFromLocation, setTransferFromLocation] = useState("");
    const [transferToLocation, setTransferToLocation] = useState("");
    const [transferQty, setTransferQty] = useState(1);
    const [isTransferring, setIsTransferring] = useState(false);
    const [locationSearch, setLocationSearch] = useState("");

    const loadData = useCallback(async (force = false) => {
        try {
            setLoading(true);
            setLoadError(null);
            const [snapshot, suppliersList, rawInventory, locations, masterOptions] = await Promise.all([
                fetchInventorySnapshot({
                    force,
                    page: productsPage,
                    limit: PRODUCTS_PAGE_SIZE,
                }),
                api.getSuppliers(),
                api.getInventory(),
                api.getWarehouseLocations(),
                api.getProductCatalogOptions({ include_inactive: true })
            ]);
            setProducts(snapshot.rows);
            setProductsPagination(snapshot.pagination ?? null);
            setSuppliers(suppliersList);
            setInventoryItems(rawInventory);
            setWarehouseLocations(locations);
            setCatalogOptions(masterOptions);
        } catch (error) {
            setLoadError(getErrorMessage(error, "No se pudo cargar el inventario."));
        } finally {
            setLoading(false);
        }
    }, [productsPage]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const criticalProducts = useMemo(() => {
        return products.filter((p) => Number(p.stock_current ?? 0) <= Number(p.stock_min ?? 0));
    }, [products]);

    const filteredProducts = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return products;
        return products.filter(
            (p) =>
                p.name.toLowerCase().includes(query) ||
                (p.sku && p.sku.toLowerCase().includes(query)) ||
                (p.barcode && p.barcode.toLowerCase().includes(query)) ||
                (p.category && p.category.toLowerCase().includes(query)) ||
                (p.location && p.location.toLowerCase().includes(query))
        );
    }, [products, search]);

    const groupedInventory = useMemo(() => {
        const map: Record<string, InventoryItem[]> = {};
        const query = locationSearch.toLowerCase().trim();
        for (const item of inventoryItems) {
            const loc = item.location || "Sin Ubicación";
            const matchesQuery = !query || 
                loc.toLowerCase().includes(query) ||
                ((item.sku || item.product?.sku) && String(item.sku || item.product?.sku).toLowerCase().includes(query)) ||
                ((item.product_name || item.product?.name) && String(item.product_name || item.product?.name).toLowerCase().includes(query));

            if (matchesQuery) {
                if (!map[loc]) map[loc] = [];
                map[loc].push(item);
            }
        }
        return map;
    }, [inventoryItems, locationSearch]);

    function toggleReplenishItem(productId: string, suggestedQty: number, supplierId = "") {
        setSelectedReplenishItems((current) => {
            const copy = { ...current };
            if (copy[productId]) {
                delete copy[productId];
            } else {
                copy[productId] = {
                    quantity: suggestedQty,
                    supplierId: supplierId || (suppliers[0]?.id ?? ""),
                };
            }
            return copy;
        });
    }

    function updateReplenishItemQty(productId: string, quantity: number) {
        setSelectedReplenishItems((current) => {
            if (!current[productId]) return current;
            return {
                ...current,
                [productId]: {
                    ...current[productId]!,
                    quantity: Math.max(1, quantity),
                },
            };
        });
    }

    function updateReplenishItemSupplier(productId: string, supplierId: string) {
        setSelectedReplenishItems((current) => {
            if (!current[productId]) return current;
            return {
                ...current,
                [productId]: {
                    ...current[productId]!,
                    supplierId,
                },
            };
        });
    }

    async function handleProcureSubmit() {
        const selectedItemsArray = Object.entries(selectedReplenishItems).map(([id, value]) => ({ id, ...value }));
        if (selectedItemsArray.length === 0) return;

        const itemsBySupplier: Record<string, typeof selectedItemsArray> = {};
        for (const item of selectedItemsArray) {
            if (!item.supplierId) {
                toast.error("Hay productos seleccionados sin un proveedor asignado.");
                return;
            }
            if (!itemsBySupplier[item.supplierId]) {
                itemsBySupplier[item.supplierId] = [];
            }
            itemsBySupplier[item.supplierId]!.push(item);
        }

        setIsProcuring(true);
        let createdCount = 0;
        try {
            for (const [supplierId, supplierItems] of Object.entries(itemsBySupplier)) {
                const poPayload = {
                    supplier_id: supplierId,
                    order_date: new Date().toISOString().slice(0, 10),
                    notes: "Orden de reposición automática de stock (WMS)",
                    items: supplierItems.map((item) => {
                        const prod = products.find((p) => p.id === item.id);
                        return {
                            product_id: item.id,
                            quantity_ordered: item.quantity,
                            unit_cost: Number(prod?.purchase_price || 0),
                        };
                    }),
                };
                await api.createPurchaseOrder(poPayload);
                createdCount++;
            }
            toast.success(`Se generaron con éxito ${createdCount} orden(es) de compra en estado Borrador.`);
            setSelectedReplenishItems({});
            setProcureDialogOpen(false);
        } catch (error) {
            showErrorToast("Error al generar las órdenes de compra", error);
        } finally {
            setIsProcuring(false);
        }
    }

    async function handleTransferStock() {
        if (!selectedTransferProduct || !transferFromLocation || !transferToLocation || transferQty <= 0) {
            toast.error("Por favor completa todos los campos del traslado.");
            return;
        }
        if (transferFromLocation === transferToLocation) {
            toast.error("La ubicación de destino debe ser diferente a la de origen.");
            return;
        }

        setIsTransferring(true);
        try {
            await api.transferStock({
                product_id: selectedTransferProduct,
                from_location: transferFromLocation,
                to_location: transferToLocation,
                quantity: transferQty,
            });
            toast.success(`Se trasladaron ${transferQty} u. correctamente a ${transferToLocation}`);
            setTransferDialogOpen(false);
            setSelectedTransferProduct("");
            setTransferFromLocation("");
            setTransferToLocation("");
            setTransferQty(1);
            invalidateInventorySnapshotCache();
            void loadData(true);
        } catch (error) {
            showErrorToast("Error al realizar el traslado interno", error);
        } finally {
            setIsTransferring(false);
        }
    }

    function startProductTransfer(product: ProductWithStock) {
        const sourceLocations = inventoryItems.filter(
            (item) => item.product_id === product.id && item.quantity - (item.reserved_quantity || 0) > 0,
        );

        if (sourceLocations.length === 0) {
            toast.error("Este producto no tiene stock disponible para reubicar.");
            return;
        }

        const preferredSource = sourceLocations.find((item) => item.location === product.location) ?? sourceLocations[0];
        if (!preferredSource) return;
        setSelectedTransferProduct(product.id);
        setTransferFromLocation(preferredSource.location);
        setTransferToLocation("");
        setTransferQty(1);
        setTransferDialogOpen(true);
    }

    async function handleSaveProduct(formData: ProductFormSubmitData) {
        try {
            if (editingProduct) {
                await api.updateProduct(editingProduct.id, formData);
                toast.success("Producto actualizado correctamente.");
            } else {
                await api.createProduct(formData);
                toast.success("Producto creado con éxito.");
            }
            setDialogOpen(false);
            setEditingProduct(null);
            invalidateInventorySnapshotCache();
            void loadData(true);
        } catch (error) {
            showErrorToast("Error al guardar el producto", error);
        }
    }

    async function handleDeleteProduct() {
        if (!deletingProduct) return;
        try {
            await api.deleteProduct(deletingProduct.id);
            toast.success("Producto eliminado del catálogo.");
            setDeletingProduct(null);
            invalidateInventorySnapshotCache();
            void loadData(true);
        } catch (error) {
            showErrorToast("No se pudo eliminar el producto", error);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Inventario WMS</h2>
                    <p className="text-muted-foreground">Catálogo de productos, alertas inteligentes de reposición y control físico de ubicaciones.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        onClick={() => {
                            if (filteredProducts.length === 0) {
                                toast.error("No hay productos para exportar");
                                return;
                            }
                            const abcMap = analyzeInventoryABC(filteredProducts.map(p => ({
                                id: p.id,
                                name: p.name,
                                cost_price: Number(p.purchase_price || 0),
                                sale_price: Number(p.sale_price || 0),
                                stock_current: Number(p.stock_current ?? p.stock_available ?? 0),
                            }))).items.reduce<Record<string, { abcClass: string; grossMarginPercent: number; markupPercent: number }>>((acc, item) => {
                                acc[item.id] = {
                                    abcClass: item.abcClass,
                                    grossMarginPercent: item.grossMarginPercent,
                                    markupPercent: item.markupPercent,
                                };
                                return acc;
                            }, {});

                            const csvData = filteredProducts.map(p => {
                                const metrics = abcMap[p.id] || { abcClass: "C", grossMarginPercent: 0, markupPercent: 0 };
                                // Margin is computed on net values; price and cost are exported as final (VAT-included) figures.
                                const netCost = Number(p.purchase_price || 0);
                                const netPrice = Number(p.sale_price || 0);
                                const cost = grossPrice(netCost, p.vat_rate);
                                const price = grossPrice(netPrice, p.vat_rate);
                                const marginAmount = netPrice - netCost;
                                return {
                                    id: p.id,
                                    name: p.name,
                                    sku: p.sku || "",
                                    barcode: p.barcode || "",
                                    category: p.category || "",
                                    price,
                                    cost,
                                    margin_amount: marginAmount,
                                    margin_percent: `${metrics.grossMarginPercent}%`,
                                    markup_percent: `${metrics.markupPercent}%`,
                                    abc_class: `Clase ${metrics.abcClass}`,
                                    stock: p.stock_current ?? p.stock_available ?? 0,
                                    min_stock: p.stock_min || 0,
                                    location: p.location || ""
                                };
                            });
                            const headers = [
                                { key: "sku" as const, label: "SKU" },
                                { key: "name" as const, label: "Producto" },
                                { key: "category" as const, label: "Categoría" },
                                { key: "abc_class" as const, label: "Clase ABC" },
                                { key: "price" as const, label: "Precio Venta (IVA incl.)" },
                                { key: "cost" as const, label: "Costo Compra (IVA incl.)" },
                                { key: "margin_amount" as const, label: "Margen Bruto $ (neto)" },
                                { key: "margin_percent" as const, label: "Margen %" },
                                { key: "markup_percent" as const, label: "Markup %" },
                                { key: "stock" as const, label: "Stock Actual" },
                                { key: "min_stock" as const, label: "Stock Mínimo" },
                                { key: "location" as const, label: "Ubicación" }
                            ];
                            const csv = convertToCSV(csvData, headers);
                            downloadCSV(`inventario_wsm_${new Date().toISOString().substring(0, 10)}.csv`, csv);
                            toast.success("Catálogo exportado a CSV exitosamente");
                        }}
                        className="w-full gap-2 sm:w-auto text-emerald-600 border-emerald-200 hover:bg-emerald-50/50"
                    >
                        <Download className="h-4 w-4" />
                        Exportar CSV
                    </Button>
                    {canManageInventory && (
                        <ImportDialog
                            entity="products"
                            onImported={() => {
                                invalidateInventorySnapshotCache();
                                return loadData(true);
                            }}
                        />
                    )}
                    <Button
                        variant="outline"
                        onClick={() => setIsLabelsDialogOpen(true)}
                        className="w-full gap-2 sm:w-auto text-blue-600 border-blue-200 hover:bg-blue-50/50 font-semibold"
                        title="Imprimir lote de etiquetas de códigos de barras EAN-13"
                    >
                        <Tag className="h-4 w-4" />
                        Imprimir Etiquetas
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => setTransferDialogOpen(true)}
                        className="w-full gap-2 sm:w-auto text-indigo-600 border-indigo-200 hover:bg-indigo-50/50"
                    >
                        <Move className="h-4 w-4" />
                        Traslado Interno (WMS)
                    </Button>
                    <Dialog
                        open={dialogOpen}
                        onOpenChange={(open) => {
                            setDialogOpen(open);
                            if (!open) setEditingProduct(null);
                        }}
                    >
                        <DialogTrigger asChild>
                            <Button
                                className="w-full gap-2 sm:w-auto"
                                onClick={() => {
                                    setEditingProduct(null);
                                    setDialogOpen(true);
                                }}
                            >
                                <Plus className="h-4 w-4" />
                                Nuevo producto
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="w-[96vw] max-h-[92vh] overflow-y-auto p-4 sm:max-w-3xl sm:p-6 lg:max-w-4xl xl:max-w-5xl">
                            <DialogHeader>
                                <DialogTitle>{editingProduct ? "Editar producto" : "Agregar producto"}</DialogTitle>
                                <DialogDescription>
                                    {editingProduct
                                        ? "Actualiza datos, atributos, precios, imagen y ubicación de referencia. Para mover stock físico usa Reubicar."
                                        : "Completa los datos para registrar un producto nuevo."}
                                </DialogDescription>
                            </DialogHeader>
                            <ProductForm
                                onSubmit={handleSaveProduct}
                                onCancel={() => setDialogOpen(false)}
                                {...(editingProduct ? { initialData: editingProduct } : {})}
                            />
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* KPI Summary Cards */}
            <InventorySummaryCards products={products} />

            <Tabs defaultValue="catalog" className="space-y-4">
                <TabsList className="h-auto justify-start gap-2 overflow-x-auto p-1 bg-muted/20 border">
                    <TabsTrigger value="catalog" className="gap-2 shrink-0">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Catálogo General
                    </TabsTrigger>
                    <TabsTrigger value="abc" className="gap-2 shrink-0">
                        <BarChart3 className="h-4 w-4 text-emerald-500" />
                        Rentabilidad & ABC (Pareto)
                    </TabsTrigger>
                    <TabsTrigger value="locations" className="gap-2 shrink-0">
                        <MapPin className="h-4 w-4 text-indigo-500" />
                        Góndolas & Almacén
                    </TabsTrigger>
                    <TabsTrigger value="masters" className="gap-2 shrink-0">
                        <Layers3 className="h-4 w-4 text-violet-500" />
                        Maestros de catálogo
                    </TabsTrigger>
                    <TabsTrigger value="replenish" className="gap-2 shrink-0">
                        <TrendingDown className="h-4 w-4 text-amber-500" />
                        Reabastecimiento Inteligente
                        {criticalProducts.length > 0 && (
                            <span className="ml-1 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-slate-900 animate-pulse">
                                {criticalProducts.length}
                            </span>
                        )}
                    </TabsTrigger>
                    <TabsTrigger value="traceability" className="gap-2 shrink-0">
                        <Activity className="h-4 w-4 text-emerald-500" />
                        Trazabilidad
                    </TabsTrigger>
                </TabsList>

                {/* Catalog tab */}
                <TabsContent value="catalog" className="space-y-4">
                    <Card>
                        <CardContent className="pt-6">
                            {loadError ? (
                                <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <p className="text-sm text-amber-800">{loadError}</p>
                                        <Button variant="outline" size="sm" onClick={() => void loadData(true)}>
                                            Reintentar
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                            <div className="mb-4">
                                <Input
                                    placeholder="Buscar por nombre, SKU, código, categoría o ubicación..."
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    className="w-full sm:max-w-md"
                                />
                            </div>

                            <InventoryTable
                                loading={loading}
                                products={filteredProducts}
                                onEdit={(product) => {
                                    setEditingProduct(product);
                                    setDialogOpen(true);
                                }}
                                onRelocate={startProductTransfer}
                                onDelete={(product) => setDeletingProduct(product)}
                            />
                            <PaginationControls
                                page={Math.max(1, Number(productsPagination?.page || productsPage))}
                                totalPages={Math.max(1, Number(productsPagination?.totalPages || 1))}
                                totalCount={Number(productsPagination?.totalCount || products.length)}
                                itemLabel="producto"
                                isLoading={loading}
                                onPageChange={(nextPage) => setProductsPage(Math.max(1, nextPage))}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* ABC & Profitability Tab */}
                <TabsContent value="abc" className="space-y-4">
                    <InventoryABCTab products={products} />
                </TabsContent>

                {/* WMS Locations Tab */}
                <TabsContent value="locations" className="space-y-4">
                    <InventoryLocationsTab
                        groupedInventory={groupedInventory}
                        locationSearch={locationSearch}
                        onLocationSearchChange={setLocationSearch}
                        warehouseLocations={warehouseLocations}
                        onLocationsChanged={() => void loadData(true)}
                        onStartTransfer={(productId, location) => {
                            setSelectedTransferProduct(productId);
                            setTransferFromLocation(location);
                            setTransferQty(1);
                            setTransferDialogOpen(true);
                        }}
                    />
                </TabsContent>

                <TabsContent value="masters" className="space-y-4">
                    <ProductCatalogMastersTab
                        options={catalogOptions}
                        onOptionsChanged={() => void loadData(true)}
                    />
                </TabsContent>

                {/* Replenish tab */}
                <TabsContent value="replenish" className="space-y-4">
                    <InventoryReplenishmentTab
                        criticalProducts={criticalProducts}
                        suppliers={suppliers}
                        selectedReplenishItems={selectedReplenishItems}
                        onToggleItem={toggleReplenishItem}
                        onUpdateQty={updateReplenishItemQty}
                        onUpdateSupplier={updateReplenishItemSupplier}
                        onOpenProcureDialog={() => setProcureDialogOpen(true)}
                    />
                </TabsContent>

                <TabsContent value="traceability" className="space-y-4">
                    <TraceabilityPanel />
                </TabsContent>
            </Tabs>

            {/* WMS Transfer Dialog */}
            <InventoryTransferDialog
                open={transferDialogOpen}
                onOpenChange={setTransferDialogOpen}
                products={products}
                inventoryItems={inventoryItems}
                warehouseLocations={warehouseLocations}
                selectedProductId={selectedTransferProduct}
                onSelectProduct={setSelectedTransferProduct}
                fromLocation={transferFromLocation}
                onFromLocationChange={setTransferFromLocation}
                toLocation={transferToLocation}
                onToLocationChange={setTransferToLocation}
                transferQty={transferQty}
                onTransferQtyChange={setTransferQty}
                isTransferring={isTransferring}
                onSubmitTransfer={() => void handleTransferStock()}
            />

            {/* Replenish review dialog */}
            <InventoryProcureDialog
                open={procureDialogOpen}
                onOpenChange={setProcureDialogOpen}
                selectedReplenishItems={selectedReplenishItems}
                products={products}
                suppliers={suppliers}
                isProcuring={isProcuring}
                onSubmitProcure={() => void handleProcureSubmit()}
            />

            {/* Product deletion dialog */}
            <Dialog open={Boolean(deletingProduct)} onOpenChange={(open) => !open && setDeletingProduct(null)}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Eliminar Producto</DialogTitle>
                        <DialogDescription>
                            ¿Estás seguro de que deseas eliminar &ldquo;{deletingProduct?.name}&rdquo;? Esta acción no se puede deshacer.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t pt-3">
                        <Button variant="outline" onClick={() => setDeletingProduct(null)}>
                            Cancelar
                        </Button>
                        <Button variant="destructive" onClick={() => void handleDeleteProduct()}>
                            Eliminar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Printable Barcode Labels Dialog */}
            <PrintableBarcodeLabelsDialog
                open={isLabelsDialogOpen}
                onOpenChange={setIsLabelsDialogOpen}
                reception={{
                    id: "inventory-batch",
                    reception_number: "CATÁLOGO WMS",
                    supplier_name: "Stock General",
                    status: "approved",
                    items: filteredProducts.map((p) => ({
                        product_name: p.name,
                        sku: p.sku,
                        barcode: p.barcode || p.sku,
                        size: p.size,
                        color: p.color,
                        category: p.category,
                        location: p.location || "Depósito Central",
                        sale_price: p.sale_price,
                        vat_rate: p.vat_rate,
                        quantity_received: p.stock_current ?? 1,
                    })),
                }}
            />
        </div>
    );
}
