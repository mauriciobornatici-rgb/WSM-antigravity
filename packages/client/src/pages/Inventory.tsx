import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, TrendingDown, ShieldAlert, Sparkles, RefreshCw, MapPin, Move, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Supplier, InventoryItem } from "@/types";
import type { PaginationMeta } from "@/types/api";
import { getErrorMessage, showErrorToast } from "@/lib/errorHandling";
import { fetchInventorySnapshot, invalidateInventorySnapshotCache, type ProductWithStock } from "@/lib/inventorySnapshot";
import { ProductForm, type ProductFormSubmitData } from "@/components/products/ProductForm";
import { InventoryTable } from "@/components/products/InventoryTable";
import { PaginationControls } from "@/components/common/PaginationControls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function InventoryPage() {
    const navigate = useNavigate();
    const PRODUCTS_PAGE_SIZE = 20;
    const [products, setProducts] = useState<ProductWithStock[]>([]);
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
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
            const [snapshot, suppliersList, rawInventory] = await Promise.all([
                fetchInventorySnapshot({
                    force,
                    page: productsPage,
                    limit: PRODUCTS_PAGE_SIZE,
                }),
                api.getSuppliers(),
                api.getInventory()
            ]);
            setProducts(snapshot.rows);
            setProductsPagination(snapshot.pagination ?? null);
            setSuppliers(suppliersList);
            setInventoryItems(rawInventory);
        } catch (error) {
            setLoadError(getErrorMessage(error, "No se pudo cargar el inventario."));
        } finally {
            setLoading(false);
        }
    }, [productsPage]);

    const criticalProducts = useMemo(() => {
        return products.filter((p) => Number(p.stock_current ?? 0) <= Number(p.stock_min ?? 0));
    }, [products]);

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
                    ...current[productId],
                    quantity: Math.max(1, Number(quantity || 1)),
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
                    ...current[productId],
                    supplierId,
                },
            };
        });
    }

    async function handleProcureSubmit() {
        try {
            setIsProcuring(true);
            const selectedItemsArray = Object.entries(selectedReplenishItems)
                .map(([id, value]) => ({ id, ...value }));

            if (selectedItemsArray.length === 0) {
                toast.error("Selecciona al menos un artículo para reabastecer.");
                return;
            }

            const itemsBySupplier: Record<string, typeof selectedItemsArray> = {};
            for (const item of selectedItemsArray) {
                if (!item.supplierId) {
                    toast.error("Por favor, selecciona un proveedor para cada producto tildado.");
                    return;
                }
                if (!itemsBySupplier[item.supplierId]) {
                    itemsBySupplier[item.supplierId] = [];
                }
                itemsBySupplier[item.supplierId]!.push(item);
            }

            for (const [supplierId, supplierItems] of Object.entries(itemsBySupplier)) {
                const supplier = suppliers.find((s) => s.id === supplierId);
                const itemsPayload = supplierItems.map((item) => {
                    const prod = products.find((p) => p.id === item.id);
                    return {
                        product_id: item.id,
                        quantity_ordered: item.quantity,
                        unit_cost: Number(prod?.purchase_price || 0),
                    };
                });

                await api.createPurchaseOrder({
                    supplier_id: supplierId as string,
                    order_date: new Date().toISOString().substring(0, 10),
                    items: itemsPayload,
                    notes: `Reposición automatizada de stock crítico`,
                });
                
                toast.success(`Orden de compra borrador creada para ${supplier?.name || supplierId}`);
            }

            setSelectedReplenishItems({});
            setProcureDialogOpen(false);
            invalidateInventorySnapshotCache();
            void loadData(true);
            
            toast.info("Redirigiendo al panel de Compras...");
            setTimeout(() => {
                navigate("/purchase-orders");
            }, 1000);
        } catch (error) {
            showErrorToast("Error al generar órdenes de compra", error);
        } finally {
            setIsProcuring(false);
        }
    }

    // WMS Locations grouping & searching
    const groupedInventory = useMemo(() => {
        const groups: Record<string, typeof inventoryItems> = {};
        for (const item of inventoryItems) {
            const loc = String(item.location || "General").trim();
            // Apply search filter if active
            const pName = String((item as any).product_name || "").toLowerCase();
            const pSku = String((item as any).sku || "").toLowerCase();
            const pLoc = loc.toLowerCase();
            const q = locationSearch.toLowerCase();
            
            if (q && !pName.includes(q) && !pSku.includes(q) && !pLoc.includes(q)) {
                continue;
            }

            if (!groups[loc]) groups[loc] = [];
            groups[loc].push(item);
        }
        return groups;
    }, [inventoryItems, locationSearch]);

    // Active locations list for transfer target selector
    const activeLocations = useMemo(() => {
        const set = new Set<string>();
        for (const item of inventoryItems) {
            if (item.location) set.add(item.location);
        }
        set.add("General");
        return Array.from(set).sort();
    }, [inventoryItems]);

    // Sources and max stock limits for selected product transfer
    const transferSourceLocations = useMemo(() => {
        if (!selectedTransferProduct) return [];
        return inventoryItems.filter(item => item.product_id === selectedTransferProduct);
    }, [selectedTransferProduct, inventoryItems]);

    const maxTransferQty = useMemo(() => {
        if (!selectedTransferProduct || !transferFromLocation) return 0;
        const source = inventoryItems.find(
            item => item.product_id === selectedTransferProduct && item.location === transferFromLocation
        );
        return source ? Math.max(0, source.quantity - (source.reserved_quantity || 0)) : 0;
    }, [selectedTransferProduct, transferFromLocation, inventoryItems]);

    async function handleTransferStock() {
        if (!selectedTransferProduct || !transferFromLocation || !transferToLocation) {
            toast.error("Por favor, completa todos los campos del traslado de stock.");
            return;
        }
        if (transferQty <= 0 || transferQty > maxTransferQty) {
            toast.error(`Cantidad inválida. Máximo disponible en ${transferFromLocation}: ${maxTransferQty}`);
            return;
        }

        try {
            setIsTransferring(true);
            await api.transferStock({
                product_id: selectedTransferProduct,
                from_location: transferFromLocation,
                to_location: transferToLocation,
                quantity: transferQty
            });

            toast.success("¡Stock reubicado con éxito!");
            setTransferDialogOpen(false);
            setSelectedTransferProduct("");
            setTransferFromLocation("");
            setTransferToLocation("");
            setTransferQty(1);

            invalidateInventorySnapshotCache();
            void loadData(true);
        } catch (error) {
            showErrorToast("Error al reubicar stock", error);
        } finally {
            setIsTransferring(false);
        }
    }

    useEffect(() => {
        void loadData();
    }, [loadData]);

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
                                    {editingProduct ? "Actualiza la información del producto seleccionado." : "Completa los datos para registrar un producto nuevo."}
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

            <Tabs defaultValue="catalog" className="space-y-4">
                <TabsList className="h-auto justify-start gap-2 overflow-x-auto p-1 bg-muted/20 border">
                    <TabsTrigger value="catalog" className="gap-2 shrink-0">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Catálogo General
                    </TabsTrigger>
                    <TabsTrigger value="locations" className="gap-2 shrink-0">
                        <MapPin className="h-4 w-4 text-indigo-500" />
                        Góndolas & Almacén
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
                                    placeholder="Buscar por nombre, SKU, codigo, categoria o ubicacion..."
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

                {/* WMS Locations Tab */}
                <TabsContent value="locations" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-indigo-600 flex items-center gap-2">
                                <MapPin className="h-5 w-5" /> Ubicaciones de Almacén (Góndolas)
                            </CardTitle>
                            <CardDescription>Mercadería clasificada físicamente en el depósito. Permite reubicar stock al instante.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center gap-2 max-w-sm">
                                <Search className="h-4 w-4 text-slate-400 shrink-0" />
                                <Input 
                                    placeholder="Filtrar por estante o producto..."
                                    value={locationSearch}
                                    onChange={e => setLocationSearch(e.target.value)}
                                    className="h-9 text-xs"
                                />
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                                {Object.entries(groupedInventory).length === 0 ? (
                                    <div className="col-span-full py-8 text-center text-slate-400 text-sm border border-dashed rounded-lg">
                                        No se encontraron ubicaciones para la búsqueda actual.
                                    </div>
                                ) : (
                                    Object.entries(groupedInventory).map(([locName, items]) => (
                                        <Card key={locName} className="border border-slate-100 shadow-sm overflow-hidden bg-slate-50/10">
                                            <CardHeader className="bg-slate-100/50 dark:bg-slate-900/40 px-4 py-3 flex flex-row items-center justify-between border-b">
                                                <CardTitle className="text-sm font-bold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                                                    <MapPin className="h-4 w-4 text-indigo-500" />
                                                    {locName}
                                                </CardTitle>
                                                <span className="bg-indigo-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                                    {items.length} SKUs
                                                </span>
                                            </CardHeader>
                                            <CardContent className="p-0">
                                                <Table>
                                                    <TableHeader className="bg-slate-50/30">
                                                        <TableRow>
                                                            <TableHead className="px-3 py-2 text-xs">SKU / Producto</TableHead>
                                                            <TableHead className="text-right px-3 py-2 text-xs w-40">Estado del Stock</TableHead>
                                                            <TableHead className="w-12 px-3 py-2"></TableHead>
                                                        </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                        {items.map(item => (
                                                            <TableRow key={item.id} className="hover:bg-transparent border-b border-slate-100 dark:border-slate-800/40">
                                                                <TableCell className="px-3 py-2 text-xs">
                                                                    <div className="font-bold text-slate-700 dark:text-slate-300">{(item as any).sku}</div>
                                                                    <div className="text-[10px] text-slate-400 truncate max-w-[150px]">{(item as any).product_name}</div>
                                                                </TableCell>
                                                                <TableCell className="px-3 py-2 text-xs">
                                                                    <div className="space-y-1 text-right ml-auto max-w-[150px]">
                                                                        <div className="flex items-center justify-between gap-2">
                                                                            <span className="text-slate-400 text-[10px]">Físico:</span>
                                                                            <span className="font-semibold text-slate-700 dark:text-slate-300">{item.quantity} u</span>
                                                                        </div>
                                                                        {Number(item.reserved_quantity || 0) > 0 && (
                                                                            <div className="flex items-center justify-between gap-2">
                                                                                <span className="text-amber-500 text-[10px] font-medium flex items-center gap-0.5">
                                                                                    <span className="h-1 w-1 rounded-full bg-amber-500 animate-pulse"></span>
                                                                                    Reservado:
                                                                                </span>
                                                                                <span className="font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px]">{item.reserved_quantity} u</span>
                                                                            </div>
                                                                        )}
                                                                        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-slate-100 dark:border-slate-800">
                                                                            <span className="text-slate-400 text-[10px]">Disponible:</span>
                                                                            <span className={`font-bold ${item.quantity - (item.reserved_quantity || 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                                                                {item.quantity - (item.reserved_quantity || 0)} u
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                </TableCell>
                                                                <TableCell className="px-3 py-2 text-right">
                                                                    <Button 
                                                                        variant="ghost" 
                                                                        size="icon" 
                                                                        className="h-7 w-7 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                                                                        onClick={() => {
                                                                            setSelectedTransferProduct(item.product_id);
                                                                            setTransferFromLocation(item.location);
                                                                            setTransferQty(1);
                                                                            setTransferDialogOpen(true);
                                                                        }}
                                                                        title="Reubicar este stock"
                                                                    >
                                                                        <Move className="h-3.5 w-3.5" />
                                                                    </Button>
                                                                </TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </CardContent>
                                        </Card>
                                    ))
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Replenish tab */}
                <TabsContent value="replenish" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle className="text-amber-500 flex items-center gap-2">
                                        <ShieldAlert className="h-5 w-5" /> Alertas Críticas & Reposición
                                    </CardTitle>
                                    <CardDescription>
                                        Productos con existencias por debajo del límite mínimo. Selecciona proveedor y cantidades para reabastecer de inmediato.
                                    </CardDescription>
                                </div>
                                {Object.keys(selectedReplenishItems).length > 0 && (
                                    <Button 
                                        className="w-full gap-2 sm:w-auto"
                                        onClick={() => setProcureDialogOpen(true)}
                                    >
                                        <RefreshCw className="h-4 w-4 animate-spin-slow" />
                                        Generar Órdenes ({Object.keys(selectedReplenishItems).length})
                                    </Button>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {criticalProducts.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
                                    <p className="text-emerald-600 dark:text-emerald-400 font-semibold text-lg">
                                        ¡Excelente! Todos los productos están con stock óptimo.
                                    </p>
                                    <p className="text-muted-foreground text-sm mt-1">
                                        Ningún artículo de catálogo está por debajo del stock mínimo.
                                    </p>
                                </div>
                            ) : (
                                <div className="rounded-md border overflow-hidden">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead className="w-10"></TableHead>
                                                <TableHead>SKU</TableHead>
                                                <TableHead>Producto</TableHead>
                                                <TableHead className="text-center">Stock Actual</TableHead>
                                                <TableHead className="text-center">Stock Mínimo</TableHead>
                                                <TableHead className="w-40 text-center">Cantidad a Pedir</TableHead>
                                                <TableHead className="w-60">Proveedor Reposición</TableHead>
                                                <TableHead className="text-right">Costo Estimado</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {criticalProducts.map((p) => {
                                                const checked = Boolean(selectedReplenishItems[p.id]);
                                                const suggested = Math.max(1, Number(p.stock_min || 0) * 2 - Number(p.stock_current || 0));
                                                const itemValue = selectedReplenishItems[p.id] || { quantity: suggested, supplierId: (p as any).supplier_id || "" };
                                                const itemCost = Number(p.purchase_price || 0) * itemValue.quantity;
                                                return (
                                                    <TableRow key={p.id} className={checked ? "bg-slate-50 dark:bg-slate-900/30" : ""}>
                                                        <TableCell className="text-center">
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => toggleReplenishItem(p.id, suggested, (p as any).supplier_id || "")}
                                                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-mono text-xs font-bold">{p.sku}</TableCell>
                                                        <TableCell className="font-semibold text-slate-800 dark:text-slate-200">{p.name}</TableCell>
                                                        <TableCell className="text-center font-bold text-red-500">{p.stock_current}</TableCell>
                                                        <TableCell className="text-center text-slate-400">{p.stock_min}</TableCell>
                                                        <TableCell className="text-center">
                                                            <Input
                                                                type="number"
                                                                disabled={!checked}
                                                                value={itemValue.quantity}
                                                                onChange={(e) => updateReplenishItemQty(p.id, Number(e.target.value))}
                                                                className="h-8 w-24 text-center font-bold text-slate-800 dark:text-slate-200 mx-auto"
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            <Select
                                                                disabled={!checked}
                                                                value={itemValue.supplierId}
                                                                onValueChange={(val) => updateReplenishItemSupplier(p.id, val)}
                                                            >
                                                                <SelectTrigger className="h-8 text-xs">
                                                                    <SelectValue placeholder="Proveedor..." />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {suppliers.map((s) => (
                                                                        <SelectItem key={s.id} value={s.id} className="text-xs">
                                                                            {s.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-slate-700 dark:text-slate-300">
                                                            ${itemCost.toLocaleString("es-AR")}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* WMS Transfer Dialog */}
            <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Move className="h-5 w-5 text-indigo-500" />
                            Traslado Interno de Stock
                        </DialogTitle>
                        <DialogDescription>
                            Reubica stock de un producto entre ubicaciones/estanterías físicas del depósito de forma segura.
                        </DialogDescription>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-2">
                        {/* Product Selector */}
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[10px] uppercase font-bold text-slate-500">Seleccionar Producto</label>
                            <Select 
                                value={selectedTransferProduct}
                                onValueChange={(val) => {
                                    setSelectedTransferProduct(val);
                                    setTransferFromLocation("");
                                    setTransferQty(1);
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecciona un producto..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {products.map(p => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.sku} - {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {selectedTransferProduct && (
                            <>
                                {/* From Location Selector */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-[10px] uppercase font-bold text-slate-500">Ubicación Origen</label>
                                    <Select 
                                        value={transferFromLocation}
                                        onValueChange={setTransferFromLocation}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecciona estante origen..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                             {transferSourceLocations.map(src => {
                                                 const avail = src.quantity - (src.reserved_quantity || 0);
                                                 return (
                                                     <SelectItem key={src.location} value={src.location}>
                                                         {src.location} (Disponible: {avail} u | Físico: {src.quantity} u)
                                                     </SelectItem>
                                                 );
                                             })}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Target Location Selector */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-[10px] uppercase font-bold text-slate-500">Ubicación Destino</label>
                                    <Input 
                                        placeholder="Escribe la ubicación destino (Ej: Góndola B-3)..."
                                        value={transferToLocation}
                                        onChange={e => setTransferToLocation(e.target.value)}
                                        list="active-wms-locations"
                                    />
                                    <datalist id="active-wms-locations">
                                        {activeLocations.map(loc => (
                                            <option key={loc} value={loc} />
                                        ))}
                                    </datalist>
                                </div>

                                {/* Transfer Quantity */}
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                        <label className="text-[10px] uppercase font-bold text-slate-500">Cantidad a Trasladar</label>
                                        {transferFromLocation && (
                                            <span className="text-[10px] text-slate-400 font-semibold">Máximo disponible: {maxTransferQty} u</span>
                                        )}
                                    </div>
                                    <Input 
                                        type="number"
                                        min={1}
                                        max={maxTransferQty || 1}
                                        value={transferQty || ""}
                                        onChange={e => setTransferQty(Math.min(maxTransferQty, Math.max(1, Number(e.target.value))))}
                                    />
                                </div>
                            </>
                        )}
                    </div>

                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end border-t pt-3">
                        <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button 
                            onClick={handleTransferStock}
                            disabled={isTransferring || !selectedTransferProduct || !transferFromLocation || !transferToLocation || transferQty <= 0}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        >
                            {isTransferring ? "Procesando traslado..." : "Confirmar Traslado"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Replenish review dialog */}
            <Dialog open={procureDialogOpen} onOpenChange={setProcureDialogOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Revisar órdenes de reposición a generar</DialogTitle>
                        <DialogDescription>
                            Se generarán órdenes de compra (PO) en estado Borrador agrupadas automáticamente por proveedor.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="py-2 space-y-4">
                        <div className="max-h-[300px] overflow-y-auto space-y-4 pr-1">
                            {(() => {
                                const selectedItemsArray = Object.entries(selectedReplenishItems)
                                    .map(([id, value]) => ({ id, ...value }));
                                const itemsBySupplier: Record<string, typeof selectedItemsArray> = {};
                                for (const item of selectedItemsArray) {
                                    if (!itemsBySupplier[item.supplierId]) {
                                        itemsBySupplier[item.supplierId] = [];
                                    }
                                    itemsBySupplier[item.supplierId]!.push(item);
                                }

                                return Object.entries(itemsBySupplier).map(([supplierId, supplierItems]) => {
                                    const supplier = suppliers.find((s) => s.id === supplierId);
                                    const poTotal = supplierItems.reduce((acc, item) => {
                                        const prod = products.find((p) => p.id === item.id);
                                        return acc + Number(prod?.purchase_price || 0) * item.quantity;
                                    }, 0);

                                    return (
                                        <div key={supplierId} className="border-b pb-2 last:border-0 last:pb-0">
                                            <strong className="block text-sm text-primary mb-1">{supplier?.name || supplierId}</strong>
                                            <div className="pl-2 space-y-1">
                                                {supplierItems.map((item) => {
                                                    const prod = products.find((p) => p.id === item.id);
                                                    return (
                                                        <div key={item.id} className="flex justify-between text-muted-foreground">
                                                            <span>{prod?.sku} - {prod?.name}</span>
                                                            <span>Cant: {item.quantity} x ${Number(prod?.purchase_price || 0).toLocaleString("es-AR")}</span>
                                                        </div>
                                                    );
                                                })}
                                                <div className="text-right font-bold text-slate-800 dark:text-slate-200 mt-1 border-t pt-1 border-dashed">
                                                    Subtotal PO: ${poTotal.toLocaleString("es-AR")}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>
                    </div>

                    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setProcureDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void handleProcureSubmit()} disabled={isProcuring}>
                            {isProcuring ? "Creando Órdenes..." : "Confirmar Órdenes"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Product deletion dialog */}
            <Dialog open={Boolean(deletingProduct)} onOpenChange={(open) => !open && setDeletingProduct(null)}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Eliminar producto</DialogTitle>
                        <DialogDescription>
                            Esta acción eliminará el producto <strong>{deletingProduct?.name}</strong>.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setDeletingProduct(null)}>
                            Cancelar
                        </Button>
                        <Button variant="destructive" onClick={() => void handleDeleteProduct()}>
                            Eliminar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
