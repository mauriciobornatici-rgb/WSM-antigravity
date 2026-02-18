import { Search, ShoppingCart } from "lucide-react";
import type { POSProduct } from "@/components/pos/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ProductCatalogCardProps = {
    loading: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    categoryFilter: string;
    onCategoryFilterChange: (value: string) => void;
    categories: string[];
    filteredProducts: POSProduct[];
    onAddToCart: (product: POSProduct) => void;
};

export function ProductCatalogCard({
    loading,
    search,
    onSearchChange,
    categoryFilter,
    onCategoryFilterChange,
    categories,
    filteredProducts,
    onAddToCart,
}: ProductCatalogCardProps) {
    return (
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
                        <Input
                            value={search}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="Buscar por nombre o SKU"
                            className="pl-8"
                        />
                    </div>
                    <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas las categorías</SelectItem>
                            {categories
                                .filter((category) => category !== "all")
                                .map((category) => (
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
                                onClick={() => onAddToCart(product)}
                                className="rounded-lg border p-3 text-left transition hover:bg-slate-50"
                            >
                                <div className="font-semibold">{product.name}</div>
                                <div className="text-xs text-muted-foreground">{product.sku}</div>
                                <div className="mt-2 flex items-center justify-between">
                                    <span className="font-bold">${Number(product.sale_price).toLocaleString("es-AR")}</span>
                                    <Badge variant={product.stock > 0 ? "outline" : "destructive"}>
                                        Stock: {product.stock}
                                    </Badge>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
