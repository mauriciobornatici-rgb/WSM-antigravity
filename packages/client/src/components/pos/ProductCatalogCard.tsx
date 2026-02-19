import { Camera, Search, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import type { POSProduct } from "@/components/pos/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ProductCatalogCardProps = {
    loading: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    categoryFilter: string;
    onCategoryFilterChange: (value: string) => void;
    categories: string[];
    filteredProducts: POSProduct[];
    onAddToCart: (product: POSProduct) => void;
    onScanSubmit?: (value: string) => void;
};

function stockBadgeVariant(stock: number): "outline" | "secondary" | "destructive" {
    if (stock <= 0) return "destructive";
    if (stock <= 5) return "secondary";
    return "outline";
}

export function ProductCatalogCard({
    loading,
    search,
    onSearchChange,
    categoryFilter,
    onCategoryFilterChange,
    categories,
    filteredProducts,
    onAddToCart,
    onScanSubmit,
}: ProductCatalogCardProps) {
    const [scannerHintVisible, setScannerHintVisible] = useState(false);

    const categoryList = useMemo(
        () => categories.filter((category) => category !== "all"),
        [categories],
    );

    return (
        <Card className="overflow-hidden border-blue-900/30 bg-gradient-to-b from-blue-950/30 to-background">
            <CardHeader className="border-b border-blue-900/30">
                <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5 text-blue-500" />
                    Punto de venta
                </CardTitle>
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="Buscar por nombre, SKU o codigo"
                            className="pl-8"
                            onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                const value = event.currentTarget.value.trim();
                                if (!value) return;
                                onScanSubmit?.(value);
                            }}
                        />
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        className="gap-2"
                        onClick={() => {
                            setScannerHintVisible(true);
                            setTimeout(() => setScannerHintVisible(false), 1800);
                        }}
                    >
                        <Camera className="h-4 w-4" />
                        Escanear
                    </Button>
                </div>

                {scannerHintVisible ? (
                    <p className="text-xs text-muted-foreground">
                        Enfoque el campo de busqueda y use el lector o pegue el codigo del telefono, luego Enter.
                    </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant={categoryFilter === "all" ? "default" : "outline"}
                        onClick={() => onCategoryFilterChange("all")}
                    >
                        Todas
                    </Button>
                    {categoryList.map((category) => (
                        <Button
                            key={category}
                            type="button"
                            size="sm"
                            variant={categoryFilter === category ? "default" : "outline"}
                            onClick={() => onCategoryFilterChange(category)}
                        >
                            {category}
                        </Button>
                    ))}
                </div>
            </CardHeader>

            <CardContent className="p-4">
                {loading ? (
                    <div className="py-8 text-center text-muted-foreground">Cargando productos...</div>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {filteredProducts.map((product) => (
                            <button
                                key={product.id}
                                onClick={() => onAddToCart(product)}
                                className="group rounded-xl border border-blue-900/30 bg-card/80 text-left transition hover:border-blue-700/50 hover:bg-blue-950/20"
                            >
                                <div className="aspect-video overflow-hidden rounded-t-xl bg-muted/20">
                                    {product.image_url ? (
                                        <img
                                            src={product.image_url}
                                            alt={product.name}
                                            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                                        />
                                    ) : (
                                        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                                            Sin imagen
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2 p-3">
                                    <div className="font-semibold leading-tight">{product.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {product.sku}
                                        {product.barcode ? ` | ${product.barcode}` : ""}
                                    </div>
                                    <div className="text-xs text-muted-foreground">{product.location || "Sin ubicacion"}</div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-base font-bold">
                                            ${Number(product.sale_price).toLocaleString("es-AR")}
                                        </span>
                                        <Badge variant={stockBadgeVariant(product.stock)}>
                                            Stock: {product.stock}
                                        </Badge>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

