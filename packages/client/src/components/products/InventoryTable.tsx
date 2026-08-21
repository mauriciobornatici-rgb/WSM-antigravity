import { Box, Move, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductWithStock } from "@/lib/inventorySnapshot";
import { TableSkeleton } from "@/components/common/Skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/formatters";

type InventoryTableProps = {
    loading: boolean;
    products: ProductWithStock[];
    onEdit: (product: ProductWithStock) => void;
    onRelocate: (product: ProductWithStock) => void;
    onDelete: (product: ProductWithStock) => void;
};

export function InventoryTable({ loading, products, onEdit, onRelocate, onDelete }: InventoryTableProps) {
    if (loading) {
        return <TableSkeleton columns={9} rows={8} />;
    }

    return (
        <div className="overflow-hidden rounded-md border">
            <div className="overflow-x-auto">
                <Table className="min-w-[1180px]">
                <TableHeader>
                    <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Codigo</TableHead>
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
                            <TableCell colSpan={9} className="h-20 text-center text-muted-foreground">
                                No se encontraron productos.
                            </TableCell>
                        </TableRow>
                    ) : (
                        products.map((product) => (
                            <TableRow key={product.id}>
                                <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                                <TableCell className="font-mono text-xs">{product.barcode || "-"}</TableCell>
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        {product.image_url ? (
                                            <img
                                                src={product.image_url}
                                                alt={product.name}
                                                className="h-10 w-10 rounded-md object-cover"
                                            />
                                        ) : (
                                            <div className="h-10 w-10 rounded-md border bg-muted/40" />
                                        )}
                                        <div>
                                            <div className="font-medium">{product.name}</div>
                                            <div className="text-xs text-muted-foreground">{product.location || "Sin ubicacion"}</div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge variant="secondary">{product.category}</Badge>
                                </TableCell>
                                <TableCell className="text-right font-mono text-muted-foreground">
                                    {formatMoney(product.purchase_price)}
                                </TableCell>
                                <TableCell className="text-right font-semibold font-mono text-emerald-600 dark:text-emerald-400">
                                    {formatMoney(product.sale_price)}
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
                                    <div className="inline-flex items-center gap-1.5">
                                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onEdit(product)}>
                                            <Pencil className="h-3.5 w-3.5 text-blue-500" />
                                            Editar
                                        </Button>
                                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onRelocate(product)}>
                                            <Move className="h-3.5 w-3.5 text-indigo-500" />
                                            Reubicar
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-8 w-8"
                                            aria-label={`Eliminar ${product.name}`}
                                            title={`Eliminar ${product.name}`}
                                            onClick={() => onDelete(product)}
                                        >
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
        </div>
    );
}
