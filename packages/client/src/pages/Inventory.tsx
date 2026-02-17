import { useEffect, useMemo, useState } from "react";
import { Box, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Order, Product } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
import { cn } from "@/lib/utils";
import { ProductForm } from "@/components/products/ProductForm";
import { TableSkeleton } from "@/components/common/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ProductWithStock = Product & {
    stock_available: number;
    stock_immobilized: number;
};

function computeImmobilizedStock(productId: string, orders: Order[]): number {
    return orders
        .filter((order) => order.status === "pending" || order.status === "picking")
        .flatMap((order) => order.items)
        .filter((item) => item.product_id === productId)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

export default function InventoryPage() {
    const [products, setProducts] = useState<ProductWithStock[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<ProductWithStock | null>(null);
    const [deletingProduct, setDeletingProduct] = useState<ProductWithStock | null>(null);

    useEffect(() => {
        void loadData();
    }, []);

    async function loadData() {
        try {
            setLoading(true);
            const [productsResponse, ordersResponse] = await Promise.all([api.getProducts(), api.getOrders()]);
            const merged = productsResponse.map((product) => ({
                ...product,
                stock_available: Number(product.stock_current ?? 0),
                stock_immobilized: computeImmobilizedStock(product.id, ordersResponse),
            }));
            setProducts(merged);
        } catch (error) {
            showErrorToast("Error al cargar inventario", error);
        } finally {
            setLoading(false);
        }
    }

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
            setDialogOpen(false);
            setEditingProduct(null);
            await loadData();
        } catch (error) {
            showErrorToast(editingProduct ? "Error al actualizar producto" : "Error al crear producto", error);
        }
    }

    async function handleDeleteProduct() {
        if (!deletingProduct) return;
        try {
            await api.deleteProduct(deletingProduct.id);
            toast.success("Producto eliminado");
            setDeletingProduct(null);
            await loadData();
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
                    <div className="mb-4">
                        <Input
                            placeholder="Buscar por nombre, SKU, categoria o ubicacion..."
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="max-w-md"
                        />
                    </div>

                    {loading ? (
                        <TableSkeleton columns={8} rows={8} />
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>SKU</TableHead>
                                        <TableHead>Producto</TableHead>
                                        <TableHead>Categoria</TableHead>
                                        <TableHead className="text-right">Costo</TableHead>
                                        <TableHead className="text-right">Venta</TableHead>
                                        <TableHead className="text-right">Disponible</TableHead>
                                        <TableHead className="text-right">Inmovilizado</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredProducts.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                                                No se encontraron productos.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredProducts.map((product) => (
                                            <TableRow key={product.id}>
                                                <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                                                <TableCell>
                                                    <div className="font-medium">{product.name}</div>
                                                    <div className="text-xs text-muted-foreground">{product.location || "Sin ubicacion"}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary">{product.category}</Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    ${Number(product.purchase_price || 0).toLocaleString("es-AR")}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold text-emerald-600">
                                                    ${Number(product.sale_price || 0).toLocaleString("es-AR")}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="inline-flex items-center gap-2">
                                                        <span
                                                            className={cn(
                                                                "h-2 w-2 rounded-full",
                                                                product.stock_available > 0 ? "bg-emerald-500" : "bg-red-500",
                                                            )}
                                                        />
                                                        <span className="font-semibold">{product.stock_available}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right text-amber-600">
                                                    <span className="inline-flex items-center gap-1">
                                                        {product.stock_immobilized > 0 ? <Box className="h-3 w-3" /> : null}
                                                        {product.stock_immobilized}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="inline-flex gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => {
                                                                setEditingProduct(product);
                                                                setDialogOpen(true);
                                                            }}
                                                        >
                                                            <Pencil className="h-4 w-4 text-blue-500" />
                                                        </Button>
                                                        <Button size="sm" variant="ghost" onClick={() => setDeletingProduct(product)}>
                                                            <Trash2 className="h-4 w-4 text-red-500" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
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
