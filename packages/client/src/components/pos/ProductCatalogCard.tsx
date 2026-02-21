import { Camera, Search, ShoppingCart } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { POSProduct } from "@/components/pos/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    const [scanDialogOpen, setScanDialogOpen] = useState(false);
    const [scanStatus, setScanStatus] = useState("Esperando lectura...");
    const [manualScanValue, setManualScanValue] = useState("");

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detectorRef = useRef<{ detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } | null>(null);
    const rafRef = useRef<number | null>(null);
    const scannerSessionRef = useRef(0);

    const categoryList = useMemo(
        () => categories.filter((category) => category !== "all"),
        [categories],
    );

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
                    <CardTitle className="flex items-center gap-2">
                        <ShoppingCart className="h-5 w-5 text-blue-500" />
                        Punto de venta
                    </CardTitle>
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
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
                            onClick={() => onCategoryFilterChange("all")}
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
                                onClick={() => onCategoryFilterChange(category)}
                            >
                                {category}
                            </Button>
                        ))}
                    </div>
                </CardHeader>

                <CardContent className="p-4 sm:p-5">
                    {loading ? (
                        <div className="py-8 text-center text-muted-foreground">Cargando productos...</div>
                    ) : filteredProducts.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-blue-900/40 bg-blue-950/10 px-4 py-10 text-center">
                            <p className="text-sm font-medium">No encontramos productos para ese filtro.</p>
                            <p className="mt-1 text-xs text-muted-foreground">Proba con otra categoria o cambia el termino de busqueda.</p>
                        </div>
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                            {filteredProducts.map((product) => (
                                <button
                                    key={product.id}
                                    onClick={() => onAddToCart(product)}
                                    className="group flex h-full flex-col rounded-xl border border-blue-900/30 bg-card/80 text-left transition hover:border-blue-700/50 hover:bg-blue-950/20"
                                >
                                    <div className="aspect-video overflow-hidden rounded-t-xl bg-muted/20">
                                        {product.image_url ? (
                                            <img
                                                src={product.image_url}
                                                alt={product.name}
                                                className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                                            />
                                        ) : (
                                            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                                                Sin imagen
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-1 flex-col space-y-2 p-3">
                                        <div className="font-semibold leading-tight">{product.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {product.sku}
                                            {product.barcode ? ` | ${product.barcode}` : ""}
                                        </div>
                                        <div className="text-xs text-muted-foreground">{product.location || "Sin ubicacion"}</div>
                                        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
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
                                placeholder="Fallback manual"
                                value={manualScanValue}
                                onChange={(event) => setManualScanValue(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                        applyScanValue(manualScanValue);
                                    }
                                }}
                            />
                            <Button type="button" variant="outline" onClick={() => applyScanValue(manualScanValue)}>
                                Aplicar
                            </Button>
                            <Button type="button" variant="outline" onClick={closeScannerDialog}>
                                Cerrar
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
