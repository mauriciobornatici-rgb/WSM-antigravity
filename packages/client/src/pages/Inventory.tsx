import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Product } from "@/types";
import { getErrorMessage, showErrorToast } from "@/lib/errorHandling";
import { fetchInventorySnapshot, invalidateInventorySnapshotCache, type ProductWithStock } from "@/lib/inventorySnapshot";
import { ProductForm } from "@/components/products/ProductForm";
import { InventoryTable } from "@/components/products/InventoryTable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function InventoryPage() {
    const [products, setProducts] = useState<ProductWithStock[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<ProductWithStock | null>(null);
    const [deletingProduct, setDeletingProduct] = useState<ProductWithStock | null>(null);

    const loadData = useCallback(async (force = false) => {
        try {
            setLoading(true);
            setLoadError(null);
            const snapshot = await fetchInventorySnapshot(force);
            setProducts(snapshot);
        } catch (error) {
            setLoadError(getErrorMessage(error, "No se pudo cargar el inventario."));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const filteredProducts = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return products;
        return products.filter((product) => {
            const byName = product.name.toLowerCase().includes(query);
            const bySku = product.sku.toLowerCase().includes(query);
            const byCategory = product.category.toLowerCase().includes(query);
            const byLocation = (product.location ?? "").toLowerCase().includes(query);
            return byName || bySku || byCategory || byLocation;
        });
    }, [products, search]);

    async function handleSaveProduct(formData: Omit<Product, "id" | "created_at" | "description" | "image_url">) {
        try {
            if (editingProduct) {
                await api.updateProduct(editingProduct.id, {
                    ...formData,
                    description: editingProduct.description || "",
                    image_url: editingProduct.image_url || "",
                });
                toast.success("Producto actualizado");
            } else {
                await api.createProduct({
                    ...formData,
                    description: "",
                    image_url: "",
                });
                toast.success("Producto creado");
            }
            invalidateInventorySnapshotCache();
            setDialogOpen(false);
            setEditingProduct(null);
            await loadData(true);
        } catch (error) {
            showErrorToast(editingProduct ? "Error al actualizar producto" : "Error al crear producto", error);
        }
    }

    async function handleDeleteProduct() {
        if (!deletingProduct) return;
        try {
            await api.deleteProduct(deletingProduct.id);
            toast.success("Producto eliminado");
            invalidateInventorySnapshotCache();
            setDeletingProduct(null);
            await loadData(true);
        } catch (error) {
            showErrorToast("Error al eliminar producto", error);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Inventario</h2>
                    <p className="text-muted-foreground">Gestion de productos, stock disponible y stock comprometido.</p>
                </div>
                <Dialog
                    open={dialogOpen}
                    onOpenChange={(open) => {
                        setDialogOpen(open);
                        if (!open) setEditingProduct(null);
                    }}
                >
                    <DialogTrigger asChild>
                        <Button
                            className="gap-2"
                            onClick={() => {
                                setEditingProduct(null);
                                setDialogOpen(true);
                            }}
                        >
                            <Plus className="h-4 w-4" />
                            Nuevo producto
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{editingProduct ? "Editar producto" : "Agregar producto"}</DialogTitle>
                            <DialogDescription>
                                {editingProduct ? "Actualiza la informacion del producto seleccionado." : "Completa los datos para registrar un producto nuevo."}
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

            <Card>
                <CardHeader>
                    <CardTitle>Catalogo</CardTitle>
                    <CardDescription>{products.length} productos registrados.</CardDescription>
                </CardHeader>
                <CardContent>
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
                            placeholder="Buscar por nombre, SKU, categoria o ubicacion..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="max-w-md"
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
                </CardContent>
            </Card>

            <Dialog open={Boolean(deletingProduct)} onOpenChange={(open) => !open && setDeletingProduct(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Eliminar producto</DialogTitle>
                        <DialogDescription>
                            Esta accion eliminara el producto <strong>{deletingProduct?.name}</strong>.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2">
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
