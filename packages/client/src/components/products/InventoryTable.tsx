import { Box, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductWithStock } from "@/lib/inventorySnapshot";
import { TableSkeleton } from "@/components/common/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type InventoryTableProps = {
    loading: boolean;
    products: ProductWithStock[];
    onEdit: (product: ProductWithStock) => void;
    onDelete: (product: ProductWithStock) => void;
};

export function InventoryTable({ loading, products, onEdit, onDelete }: InventoryTableProps) {
    if (loading) {
        return <TableSkeleton columns={8} rows={8} />;
    }

    return (
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
                    {products.length === 0 ? (
                        <TableRow>
                            <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                                No se encontraron productos.
                            </TableCell>
                        </TableRow>
                    ) : (
                        products.map((product) => (
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
                                        <Button size="sm" variant="ghost" onClick={() => onEdit(product)}>
                                            <Pencil className="h-4 w-4 text-blue-500" />
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => onDelete(product)}>
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
    );
}
