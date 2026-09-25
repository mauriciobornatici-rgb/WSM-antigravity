import {
    Camera,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Grid3X3,
    Layers,
    List,
    Maximize2,
    Plus,
    Search,
    ShoppingCart,
} from "lucide-react";
import { Fragment, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CartItem, POSProduct } from "@/components/pos/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type CatalogView = "grid" | "list";

type CatalogItem = {
    id: string;
    name: string;
    brand: string | null;
    category: string;
    imageUrl: string | null;
    variants: POSProduct[];
    stock: number;
    minPrice: number;
    maxPrice: number;
};

const CATALOG_VIEW_STORAGE_KEY = "wsm-pos-catalog-view:v1";
const CATALOG_PAGE_SIZE: Record<CatalogView, number> = {
    grid: 60,
    list: 100,
};

function getInitialCatalogView(): CatalogView {
    try {
        return window.localStorage.getItem(CATALOG_VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
    } catch {
        return "grid";
    }
}

function productVariantLabel(product: POSProduct) {
    return [product.size ? `Talle ${product.size}` : "", product.color || ""]
        .filter(Boolean)
        .join(" · ") || "Sin variante";
}

function groupCatalogProducts(products: POSProduct[]): CatalogItem[] {
    const grouped = new Map<string, POSProduct[]>();
    for (const product of products) {
        const key = product.family_id ? `family:${product.family_id}` : `product:${product.id}`;
        const variants = grouped.get(key);
        if (variants) variants.push(product);
        else grouped.set(key, [product]);
    }

    return Array.from(grouped.entries()).map(([id, variants]) => {
        const first = variants[0];
        if (!first) throw new Error("Catalog group without variants");
        const prices = variants.map((variant) => Number(variant.sale_price || 0));
        return {
            id,
            name: first.family_name || first.name,
            brand: first.brand || null,
            category: first.category || "Sin categoria",
            imageUrl: first.family_image_url || variants.find((variant) => variant.image_url)?.image_url || null,
            variants,
            stock: variants.reduce((total, variant) => total + Number(variant.stock || 0), 0),
            minPrice: Math.min(...prices),
            maxPrice: Math.max(...prices),
        };
    }).sort((first, second) => first.name.localeCompare(second.name, "es", { sensitivity: "base" }));
}

function formatCatalogPrice(item: CatalogItem) {
    const minimum = `$${item.minPrice.toLocaleString("es-AR")}`;
    if (item.minPrice === item.maxPrice) return minimum;
    return `${minimum} - $${item.maxPrice.toLocaleString("es-AR")}`;
}

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
    cart?: CartItem[];
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
    cart,
}: ProductCatalogCardProps) {
    const [scannerHintVisible, setScannerHintVisible] = useState(false);
    const [scanDialogOpen, setScanDialogOpen] = useState(false);
    const [scanStatus, setScanStatus] = useState("Esperando lectura...");
    const [manualScanValue, setManualScanValue] = useState("");
    const [catalogView, setCatalogView] = useState<CatalogView>(getInitialCatalogView);
    const [catalogPage, setCatalogPage] = useState(1);
    const [selectedCatalogItem, setSelectedCatalogItem] = useState<CatalogItem | null>(null);
    const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(() => new Set());

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detectorRef = useRef<{ detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } | null>(null);
    const rafRef = useRef<number | null>(null);
    const scannerSessionRef = useRef(0);

    const categoryList = useMemo(
        () => categories.filter((category) => category !== "all"),
        [categories],
    );
    const catalogItems = useMemo(() => groupCatalogProducts(filteredProducts), [filteredProducts]);
    const groupedVariantCount = filteredProducts.length - catalogItems.length;
    const totalItemsLabel = groupedVariantCount > 0
        ? `${catalogItems.length} productos · ${filteredProducts.length} variantes`
        : `${catalogItems.length} producto${catalogItems.length === 1 ? "" : "s"}`;

    const cartQuantityMap = useMemo(() => {
        const map = new Map<string, number>();
        for (const item of cart || []) {
            map.set(item.id, (map.get(item.id) || 0) + Number(item.quantity || 0));
        }
        return map;
    }, [cart]);

    const pageSize = CATALOG_PAGE_SIZE[catalogView];
    const totalPages = Math.max(1, Math.ceil(catalogItems.length / pageSize));
    const currentPage = Math.min(catalogPage, totalPages);
    const firstVisibleIndex = (currentPage - 1) * pageSize;
    const visibleCatalogItems = catalogItems.slice(firstVisibleIndex, firstVisibleIndex + pageSize);
    const visibleRangeLabel = catalogItems.length === 0
        ? "Sin resultados"
        : `Mostrando ${firstVisibleIndex + 1}-${Math.min(firstVisibleIndex + pageSize, catalogItems.length)} de ${catalogItems.length}`;

    function changeCatalogView(view: CatalogView) {
        setCatalogView(view);
        setCatalogPage(1);
        try {
            window.localStorage.setItem(CATALOG_VIEW_STORAGE_KEY, view);
        } catch {
            // The preference is optional when browser storage is unavailable.
        }
    }

    function toggleExpandItem(itemId: string) {
        setExpandedItemIds((prev) => {
            const next = new Set(prev);
            if (next.has(itemId)) {
                next.delete(itemId);
            } else {
                next.add(itemId);
            }
            return next;
        });
    }

    function selectCatalogItem(item: CatalogItem) {
        if (item.variants.length === 1) {
            const product = item.variants[0];
            if (product) {
                onAddToCart(product);
                toast.success(`${product.name} agregado al carrito`, { duration: 1500 });
            }
            return;
        }
        if (catalogView === "list") {
            toggleExpandItem(item.id);
        } else {
            setSelectedCatalogItem(item);
        }
    }

    function stopScannerResources() {
        if (rafRef.current != null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        detectorRef.current = null;
        if (streamRef.current) {
            for (const track of streamRef.current.getTracks()) {
                track.stop();
            }
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }

    function closeScannerDialog() {
        scannerSessionRef.current += 1;
        stopScannerResources();
        setScanDialogOpen(false);
    }

    function applyScanValue(value: string) {
        const sanitized = value.trim();
        if (!sanitized) return;
        onSearchChange(sanitized);
        onScanSubmit?.(sanitized);
        closeScannerDialog();
    }

    async function startCameraAndDetection(sessionId: number) {
        if (!navigator.mediaDevices?.getUserMedia) {
            setScanStatus("Camara no disponible en este navegador.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: "environment" },
            });

            if (sessionId !== scannerSessionRef.current) {
                for (const track of stream.getTracks()) track.stop();
                return;
            }

            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play().catch(() => undefined);
            }

            const detectorConstructor = (globalThis as unknown as {
                BarcodeDetector?: new (options?: { formats?: string[] }) => {
                    detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
                };
            }).BarcodeDetector;

            if (!detectorConstructor) {
                setScanStatus("Sin BarcodeDetector. Use ingreso manual.");
                return;
            }

            detectorRef.current = new detectorConstructor({
                formats: ["ean_13", "ean_8", "code_128", "qr_code"],
            });
            setScanStatus("Camara activa. Enfoque el codigo.");

            const detectLoop = async () => {
                if (sessionId !== scannerSessionRef.current) return;
                if (!detectorRef.current || !videoRef.current) return;

                try {
                    if (videoRef.current.readyState >= 2) {
                        const detected = await detectorRef.current.detect(videoRef.current);
                        const value = String(detected[0]?.rawValue ?? "").trim();
                        if (value) {
                            applyScanValue(value);
                            return;
                        }
                    }
                } catch {
                    // Keep loop alive.
                }

                rafRef.current = requestAnimationFrame(() => {
                    void detectLoop();
                });
            };

            void detectLoop();
        } catch {
            setScanStatus("No se pudo abrir la camara. Revise permisos.");
        }
    }

    function openScannerDialog() {
        setScannerHintVisible(true);
        setTimeout(() => setScannerHintVisible(false), 1800);
        setScanStatus("Esperando lectura...");
        setManualScanValue("");
        setScanDialogOpen(true);

        scannerSessionRef.current += 1;
        const sessionId = scannerSessionRef.current;
        window.setTimeout(() => {
            void startCameraAndDetection(sessionId);
        }, 0);
    }

    return (
        <>
            <Card className="overflow-hidden border-blue-900/30 bg-gradient-to-b from-blue-950/30 to-background">
                <CardHeader className="space-y-4 border-b border-blue-900/30">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5 text-blue-500" />
                            Punto de venta
                        </CardTitle>
                        <Badge variant="outline" className="w-fit">
                            {totalItemsLabel}
                        </Badge>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={search}
                                onChange={(event) => {
                                    setCatalogPage(1);
                                    onSearchChange(event.target.value);
                                }}
                                placeholder="Buscar por nombre, SKU, codigo, marca, talle o color"
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
                            className="w-full gap-2 md:w-auto"
                            onClick={openScannerDialog}
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

                    <div className="flex gap-2 overflow-x-auto pb-1">
                        <Button
                            type="button"
                            size="sm"
                            className="shrink-0"
                            variant={categoryFilter === "all" ? "default" : "outline"}
                            onClick={() => {
                                setCatalogPage(1);
                                onCategoryFilterChange("all");
                            }}
                        >
                            Todas
                        </Button>
                        {categoryList.map((category) => (
                            <Button
                                key={category}
                                type="button"
                                size="sm"
                                className="shrink-0"
                                variant={categoryFilter === category ? "default" : "outline"}
                                onClick={() => {
                                    setCatalogPage(1);
                                    onCategoryFilterChange(category);
                                }}
                            >
                                {category}
                            </Button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-blue-900/20 pt-3">
                        <p className="text-xs text-muted-foreground">{visibleRangeLabel}</p>
                        <div className="inline-flex rounded-md border bg-background/70 p-0.5" role="group" aria-label="Vista del catalogo">
                            <Button
                                type="button"
                                size="sm"
                                variant={catalogView === "grid" ? "secondary" : "ghost"}
                                className="h-8 gap-1.5 px-2.5"
                                aria-pressed={catalogView === "grid"}
                                onClick={() => changeCatalogView("grid")}
                            >
                                <Grid3X3 className="h-3.5 w-3.5" />
                                Tarjetas
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={catalogView === "list" ? "secondary" : "ghost"}
                                className="h-8 gap-1.5 px-2.5"
                                aria-pressed={catalogView === "list"}
                                onClick={() => changeCatalogView("list")}
                            >
                                <List className="h-3.5 w-3.5" />
                                Lista
                            </Button>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-3 sm:p-4">
                    {loading ? (
                        <div className="py-8 text-center text-muted-foreground">Cargando productos...</div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-blue-900/40 bg-blue-950/10 px-4 py-10 text-center">
                            <p className="text-sm font-medium">No encontramos productos para ese filtro.</p>
                            <p className="mt-1 text-xs text-muted-foreground">Proba con otra categoria o cambia el termino de busqueda.</p>
                        </div>
                    ) : catalogView === "grid" ? (
                        <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                            {visibleCatalogItems.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => selectCatalogItem(item)}
                                    disabled={item.stock <= 0}
                                    className={`group flex h-full flex-col rounded-xl border border-blue-900/30 bg-card/80 text-left transition hover:border-blue-700/50 hover:bg-blue-950/20 ${
                                        item.stock <= 0 ? "cursor-not-allowed opacity-60 hover:border-blue-900/30 hover:bg-card/80" : ""
                                    }`}
                                >
                                    <div className="h-28 overflow-hidden rounded-t-xl bg-muted/20 sm:h-32 xl:h-36">
                                        {item.imageUrl ? (
                                            <img
                                                src={item.imageUrl}
                                                alt={item.name}
                                                className="h-full w-full object-contain transition duration-200 group-hover:scale-[1.03]"
                                            />
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                                                Sin imagen
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-1 flex-col space-y-1.5 p-2.5">
                                        <div className="line-clamp-2 text-sm font-semibold leading-tight">{item.name}</div>
                                        <div className="truncate text-[11px] text-muted-foreground">
                                            {item.variants.length > 1
                                                ? `${item.variants.length} variantes · ${item.brand || item.category}`
                                                : item.variants[0]?.sku}
                                        </div>
                                        <div className="truncate text-[11px] text-muted-foreground">
                                            {item.variants.length > 1
                                                ? item.variants.map(productVariantLabel).join(" | ")
                                                : item.variants[0]?.location || "Sin ubicacion"}
                                        </div>
                                        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                                            <span className="text-sm font-bold sm:text-base">
                                                {formatCatalogPrice(item)}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                {(() => {
                                                    const totalInCart = item.variants.reduce((sum, v) => sum + (cartQuantityMap.get(v.id) || 0), 0);
                                                    return totalInCart > 0 ? (
                                                        <Badge className="bg-blue-600 text-white font-bold text-[10px] h-5 py-0 px-1.5 gap-0.5">
                                                            <ShoppingCart className="h-2.5 w-2.5" /> {totalInCart}
                                                        </Badge>
                                                    ) : null;
                                                })()}
                                                <Badge variant={stockBadgeVariant(item.stock)}>
                                                    Stock: {item.stock}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="max-h-[62vh] overflow-auto rounded-md border border-blue-900/30">
                            <Table className="min-w-[900px]">
                                <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
                                    <TableRow>
                                        <TableHead>Producto</TableHead>
                                        <TableHead>Variante</TableHead>
                                        <TableHead>SKU / Codigo</TableHead>
                                        <TableHead>Ubicacion</TableHead>
                                        <TableHead className="text-right">Stock</TableHead>
                                        <TableHead className="text-right">Precio</TableHead>
                                        <TableHead className="w-28 text-right">Accion</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {visibleCatalogItems.map((item) => {
                                        const onlyVariant = item.variants.length === 1 ? item.variants[0] : null;
                                        const hasVariants = item.variants.length > 1;
                                        const isExpanded = expandedItemIds.has(item.id);
                                        const totalInCart = item.variants.reduce((sum, v) => sum + (cartQuantityMap.get(v.id) || 0), 0);

                                        return (
                                            <Fragment key={item.id}>
                                                <TableRow
                                                    className={cn(
                                                        "transition-colors",
                                                        item.stock <= 0 ? "opacity-60" : "",
                                                        isExpanded ? "bg-muted/40 border-b-0" : "",
                                                        hasVariants ? "cursor-pointer hover:bg-muted/30" : ""
                                                    )}
                                                    onClick={() => {
                                                        if (hasVariants) toggleExpandItem(item.id);
                                                    }}
                                                >
                                                    <TableCell>
                                                        <div className="flex min-w-52 items-center gap-2.5">
                                                            {hasVariants ? (
                                                                <button
                                                                    type="button"
                                                                    aria-label={isExpanded ? "Plegar opciones" : "Desplegar opciones"}
                                                                    className="h-6 w-6 shrink-0 flex items-center justify-center rounded hover:bg-muted text-muted-foreground transition-transform"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        toggleExpandItem(item.id);
                                                                    }}
                                                                >
                                                                    {isExpanded ? <ChevronDown className="h-4 w-4 text-blue-600" /> : <ChevronRight className="h-4 w-4" />}
                                                                </button>
                                                            ) : (
                                                                <div className="w-6 shrink-0" />
                                                            )}
                                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/20">
                                                                {item.imageUrl ? (
                                                                    <img src={item.imageUrl} alt="" className="h-full w-full object-contain" />
                                                                ) : (
                                                                    <span className="text-[9px] text-muted-foreground">Sin imagen</span>
                                                                )}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <div className="truncate text-sm font-semibold flex items-center gap-1.5" title={item.name}>
                                                                    <span>{item.name}</span>
                                                                    {totalInCart > 0 ? (
                                                                        <Badge className="bg-blue-600 text-white text-[10px] h-4 py-0 px-1.5 gap-0.5 font-bold">
                                                                            <ShoppingCart className="h-2.5 w-2.5" /> {totalInCart}
                                                                        </Badge>
                                                                    ) : null}
                                                                </div>
                                                                <div className="truncate text-xs text-muted-foreground">{item.brand || item.category}</div>
                                                            </div>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-xs font-medium">
                                                        {hasVariants ? (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleExpandItem(item.id);
                                                                }}
                                                                className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                                                            >
                                                                <span>{item.variants.length} opciones</span>
                                                                {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                                            </button>
                                                        ) : onlyVariant ? (
                                                            productVariantLabel(onlyVariant)
                                                        ) : "-"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-mono text-xs">{onlyVariant?.sku || "Varios SKU"}</div>
                                                        <div className="font-mono text-[11px] text-muted-foreground">{onlyVariant?.barcode || (onlyVariant ? "Sin codigo" : "Elegir variante")}</div>
                                                    </TableCell>
                                                    <TableCell className="text-xs">{onlyVariant?.location || (onlyVariant ? "Sin ubicacion" : "Varias")}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Badge variant={stockBadgeVariant(item.stock)}>{item.stock}</Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold">
                                                        {formatCatalogPrice(item)}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        {hasVariants ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant={isExpanded ? "secondary" : "default"}
                                                                className="h-8 gap-1.5 text-xs font-semibold"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleExpandItem(item.id);
                                                                }}
                                                            >
                                                                {isExpanded ? (
                                                                    <>
                                                                        <ChevronUp className="h-3.5 w-3.5" />
                                                                        Plegar
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <Layers className="h-3.5 w-3.5" />
                                                                        Elegir
                                                                    </>
                                                                )}
                                                            </Button>
                                                        ) : (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                className="h-8 gap-1.5"
                                                                disabled={item.stock <= 0}
                                                                aria-label={`Agregar ${item.name}`}
                                                                onClick={() => {
                                                                    if (onlyVariant) {
                                                                        onAddToCart(onlyVariant);
                                                                        toast.success(`${onlyVariant.name} agregado al carrito`, { duration: 1500 });
                                                                    }
                                                                }}
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                                Agregar
                                                            </Button>
                                                        )}
                                                    </TableCell>
                                                </TableRow>

                                                {/* Sub-fila expandida para las variantes (Opción B: inline accordion) */}
                                                {hasVariants && isExpanded ? (
                                                    <TableRow className="bg-muted/20 hover:bg-muted/25 border-t-0 border-b-2 border-blue-500/30">
                                                        <TableCell colSpan={7} className="p-0">
                                                            <div className="p-3 pl-10 sm:pl-12 pr-4 space-y-2 bg-gradient-to-b from-blue-500/5 to-transparent">
                                                                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground pb-1.5 border-b border-border/40">
                                                                    <span className="flex items-center gap-1.5 text-foreground font-semibold">
                                                                        <Layers className="h-3.5 w-3.5 text-blue-600" /> Variedades disponibles de {item.name}:
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setSelectedCatalogItem(item)}
                                                                        className="text-blue-600 dark:text-blue-400 hover:underline text-xs flex items-center gap-1 font-medium"
                                                                    >
                                                                        <Maximize2 className="h-3 w-3" /> Ver en ventana detallada
                                                                    </button>
                                                                </div>

                                                                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                                                                    {item.variants.map((variant) => {
                                                                        const inCart = cartQuantityMap.get(variant.id) || 0;
                                                                        const outOfStock = Number(variant.stock || 0) <= 0;
                                                                        return (
                                                                            <div
                                                                                key={variant.id}
                                                                                className={cn(
                                                                                    "flex items-center justify-between p-2.5 rounded-lg border text-xs transition-all shadow-sm",
                                                                                    inCart > 0
                                                                                        ? "bg-blue-500/10 border-blue-500/40"
                                                                                        : outOfStock
                                                                                            ? "bg-muted/40 border-border/60 opacity-60"
                                                                                            : "bg-background border-border hover:border-blue-500/40"
                                                                                )}
                                                                            >
                                                                                <div className="space-y-0.5 min-w-0 pr-2">
                                                                                    <div className="font-bold text-foreground truncate">
                                                                                        {productVariantLabel(variant)}
                                                                                    </div>
                                                                                    <div className="font-mono text-[10px] text-muted-foreground truncate">
                                                                                        SKU: {variant.sku}
                                                                                    </div>
                                                                                    <div className="flex items-center gap-2 pt-0.5">
                                                                                        <Badge
                                                                                            variant={stockBadgeVariant(variant.stock)}
                                                                                            className="text-[10px] py-0 px-1.5 h-4"
                                                                                        >
                                                                                            Stock: {variant.stock}
                                                                                        </Badge>
                                                                                        <span className="font-bold text-foreground">
                                                                                            ${Number(variant.sale_price).toLocaleString("es-AR")}
                                                                                        </span>
                                                                                    </div>
                                                                                </div>

                                                                                <div className="flex flex-col items-end gap-1 shrink-0">
                                                                                    {inCart > 0 ? (
                                                                                        <Badge className="bg-blue-600 text-white font-bold text-[10px] py-0 px-1.5 h-4 gap-0.5">
                                                                                            <ShoppingCart className="h-2.5 w-2.5" /> {inCart}
                                                                                        </Badge>
                                                                                    ) : null}
                                                                                    <Button
                                                                                        type="button"
                                                                                        size="sm"
                                                                                        disabled={outOfStock}
                                                                                        className={cn(
                                                                                            "h-7 px-2.5 text-xs font-semibold gap-1",
                                                                                            inCart > 0 ? "bg-blue-600 hover:bg-blue-700 text-white" : ""
                                                                                        )}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            onAddToCart(variant);
                                                                                            toast.success(`${productVariantLabel(variant)} agregada al carrito`, { duration: 1500 });
                                                                                        }}
                                                                                    >
                                                                                        <Plus className="h-3 w-3" />
                                                                                        {inCart > 0 ? "Sumar" : "Agregar"}
                                                                                    </Button>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ) : null}
                                            </Fragment>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    {!loading && catalogItems.length > pageSize ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                            <p className="text-xs text-muted-foreground">Pagina {currentPage} de {totalPages}</p>
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={currentPage <= 1}
                                    onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}
                                >
                                    <ChevronLeft className="mr-1 h-4 w-4" />
                                    Anterior
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={currentPage >= totalPages}
                                    onClick={() => setCatalogPage((page) => Math.min(totalPages, page + 1))}
                                >
                                    Siguiente
                                    <ChevronRight className="ml-1 h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            {/* Modal Persistente de Variantes (Opción A) */}
            <Dialog
                open={selectedCatalogItem != null}
                onOpenChange={(open) => {
                    if (!open) setSelectedCatalogItem(null);
                }}
            >
                <DialogContent className="w-[95vw] max-h-[88vh] overflow-y-auto sm:max-w-3xl flex flex-col justify-between">
                    <DialogHeader>
                        <div className="flex items-center justify-between pr-6 flex-wrap gap-2">
                            <DialogTitle className="text-lg sm:text-xl font-bold">
                                Elegir variante · {selectedCatalogItem?.name}
                            </DialogTitle>
                            {selectedCatalogItem ? (() => {
                                const totalInCart = selectedCatalogItem.variants.reduce((sum, v) => sum + (cartQuantityMap.get(v.id) || 0), 0);
                                return totalInCart > 0 ? (
                                    <Badge className="bg-blue-600 text-white text-xs gap-1.5 py-1 px-2.5 font-semibold">
                                        <ShoppingCart className="h-3.5 w-3.5" /> {totalInCart} {totalInCart === 1 ? "unidad en carrito" : "unidades en carrito"}
                                    </Badge>
                                ) : null;
                            })() : null}
                        </div>
                        <DialogDescription>
                            Selecciona el talle y color exactos. Puedes agregar múltiples variedades sin que esta ventana se cierre.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="overflow-x-auto rounded-md border my-3">
                        <Table className="min-w-[640px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Variante</TableHead>
                                    <TableHead>SKU / Codigo</TableHead>
                                    <TableHead>Ubicacion</TableHead>
                                    <TableHead className="text-right">Stock</TableHead>
                                    <TableHead className="text-center">En Carrito</TableHead>
                                    <TableHead className="text-right">Precio</TableHead>
                                    <TableHead className="text-right">Accion</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {(selectedCatalogItem?.variants ?? []).map((variant) => {
                                    const inCart = cartQuantityMap.get(variant.id) || 0;
                                    const outOfStock = Number(variant.stock || 0) <= 0;
                                    return (
                                        <TableRow
                                            key={variant.id}
                                            className={cn(
                                                outOfStock ? "opacity-60" : "",
                                                inCart > 0 ? "bg-blue-500/5 dark:bg-blue-950/20" : ""
                                            )}
                                        >
                                            <TableCell className="font-semibold text-sm">
                                                {productVariantLabel(variant)}
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-mono text-xs">{variant.sku}</div>
                                                <div className="font-mono text-[11px] text-muted-foreground">{variant.barcode || "Sin codigo"}</div>
                                            </TableCell>
                                            <TableCell className="text-xs">{variant.location || "Sin ubicacion"}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant={stockBadgeVariant(variant.stock)}>{variant.stock}</Badge>
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {inCart > 0 ? (
                                                    <Badge className="bg-blue-600 text-white font-bold text-xs gap-1 py-0.5 px-2">
                                                        <ShoppingCart className="h-3 w-3" /> {inCart}
                                                    </Badge>
                                                ) : (
                                                    <span className="text-muted-foreground text-xs">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">
                                                ${Number(variant.sale_price).toLocaleString("es-AR")}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    disabled={outOfStock}
                                                    className={cn(
                                                        "h-8 gap-1.5 font-semibold text-xs",
                                                        inCart > 0 ? "bg-blue-600 hover:bg-blue-700 text-white" : ""
                                                    )}
                                                    onClick={() => {
                                                        onAddToCart(variant);
                                                        toast.success(`${productVariantLabel(variant)} agregada (+1)`, { duration: 1500 });
                                                    }}
                                                >
                                                    <Plus className="h-3.5 w-3.5" />
                                                    {inCart > 0 ? "Sumar (+1)" : "Agregar"}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Dialog Footer con botón explícito de cierre */}
                    <div className="flex items-center justify-between border-t pt-3 mt-2 flex-wrap gap-2">
                        <p className="text-xs text-muted-foreground">
                            Presiona <strong>Listo</strong> cuando hayas terminado de elegir las variantes.
                        </p>
                        <Button
                            type="button"
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold gap-2 px-5"
                            onClick={() => setSelectedCatalogItem(null)}
                        >
                            <Check className="h-4 w-4" />
                            Listo / Volver al catálogo
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog
                open={scanDialogOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        closeScannerDialog();
                        return;
                    }
                    setScanDialogOpen(true);
                }}
            >
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Escanear producto</DialogTitle>
                        <DialogDescription>Enfoque el codigo con camara o ingrese manualmente.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="overflow-hidden rounded-md border bg-black">
                            <video ref={videoRef} className="h-56 w-full object-cover sm:h-64" muted playsInline />
                        </div>
                        <p className="text-xs text-muted-foreground">{scanStatus}</p>

                        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                            <Input
                                placeholder="Ingreso manual"
                                value={manualScanValue}
                                onChange={(event) => setManualScanValue(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        applyScanValue(manualScanValue);
                                    }
                                }}
                            />
                            <Button type="button" variant="outline" className="w-full md:w-auto" onClick={() => applyScanValue(manualScanValue)}>
                                Aplicar
                            </Button>
                            <Button type="button" variant="outline" className="w-full md:w-auto" onClick={closeScannerDialog}>
                                Cerrar
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
