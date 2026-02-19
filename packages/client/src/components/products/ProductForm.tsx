import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, ScanLine, Upload } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import * as z from "zod";
import type { Product } from "@/types";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const productSchema = z.object({
    sku: z.string().trim().min(2, "SKU requerido"),
    barcode: z.string().trim().max(100, "Codigo demasiado largo").optional().or(z.literal("")),
    name: z.string().trim().min(2, "Nombre requerido"),
    category: z.string().trim().min(2, "Categoria requerida"),
    location: z.string().trim().optional().or(z.literal("")),
    purchase_price: z
        .string()
        .trim()
        .refine((value) => value !== "" && !Number.isNaN(Number(value)) && Number(value) >= 0, "Debe ser un numero valido"),
    sale_price: z
        .string()
        .trim()
        .refine((value) => value !== "" && !Number.isNaN(Number(value)) && Number(value) >= 0, "Debe ser un numero valido"),
    stock_initial: z
        .string()
        .trim()
        .refine((value) => value !== "" && Number.isInteger(Number(value)) && Number(value) >= 0, "Stock invalido"),
    image_url: z.string().trim().optional().or(z.literal("")),
});

type ProductFormSchema = z.infer<typeof productSchema>;

export type ProductFormSubmitData = {
    sku: string;
    barcode?: string | null;
    name: string;
    category: string;
    location?: string;
    purchase_price: number;
    sale_price: number;
    stock_initial?: number;
    image_url?: string;
};

interface ProductFormProps {
    initialData?: Product;
    onSubmit: (data: ProductFormSubmitData) => void;
    onCancel: () => void;
}

type ScanTarget = "barcode" | "location";
type BarcodeDetectorLike = {
    detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

export function ProductForm({ initialData, onSubmit, onCancel }: ProductFormProps) {
    const form = useForm<ProductFormSchema>({
        resolver: zodResolver(productSchema),
        defaultValues: {
            sku: initialData?.sku ?? "",
            barcode: initialData?.barcode ?? "",
            name: initialData?.name ?? "",
            category: initialData?.category ?? "",
            location: initialData?.location ?? "",
            purchase_price: String(initialData?.purchase_price ?? 0),
            sale_price: String(initialData?.sale_price ?? 0),
            stock_initial: "0",
            image_url: initialData?.image_url ?? "",
        },
    });

    const isEditMode = Boolean(initialData);
    const imageValue = useWatch({ control: form.control, name: "image_url" }) ?? "";

    const [scanDialogOpen, setScanDialogOpen] = useState(false);
    const [scanTarget, setScanTarget] = useState<ScanTarget>("barcode");
    const [scanStatus, setScanStatus] = useState("Esperando lectura...");
    const [manualScanValue, setManualScanValue] = useState("");
    const [barcodeReaderMode, setBarcodeReaderMode] = useState(false);
    const [locationReaderMode, setLocationReaderMode] = useState(false);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detectorRef = useRef<BarcodeDetectorLike | null>(null);
    const rafRef = useRef<number | null>(null);
    const scannerSessionRef = useRef(0);

    const canRenderImage = useMemo(() => {
        if (!imageValue) return false;
        if (imageValue.startsWith("data:image/")) return true;
        return /^https?:\/\//i.test(imageValue);
    }, [imageValue]);

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
        form.setValue(scanTarget, sanitized, { shouldDirty: true, shouldValidate: true });
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
                BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
            }).BarcodeDetector;

            if (!detectorConstructor) {
                setScanStatus("Sin BarcodeDetector. Use ingreso manual o lector optico.");
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

    function openScanner(target: ScanTarget) {
        setScanTarget(target);
        setScanStatus("Esperando lectura...");
        setManualScanValue("");
        setScanDialogOpen(true);

        scannerSessionRef.current += 1;
        const sessionId = scannerSessionRef.current;

        // Ensure dialog/video are mounted before starting stream.
        window.setTimeout(() => {
            void startCameraAndDetection(sessionId);
        }, 0);
    }

    function handleManualScanApply() {
        applyScanValue(manualScanValue);
    }

    function handleReaderModeToggle(target: ScanTarget) {
        if (target === "barcode") {
            const next = !barcodeReaderMode;
            setBarcodeReaderMode(next);
            if (next) document.getElementById("product-barcode-input")?.focus();
            return;
        }

        const next = !locationReaderMode;
        setLocationReaderMode(next);
        if (next) document.getElementById("product-location-input")?.focus();
    }

    function handleReaderKeyDown(target: ScanTarget, event: KeyboardEvent<HTMLInputElement>) {
        if (event.key !== "Enter") return;
        if (target === "barcode" && !barcodeReaderMode) return;
        if (target === "location" && !locationReaderMode) return;
        const value = event.currentTarget.value.trim();
        if (!value) return;
        form.setValue(target, value, { shouldDirty: true, shouldValidate: true });
    }

    function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) return;
        if (file.size > 1_500_000) return;

        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            if (!result) return;
            form.setValue("image_url", result, { shouldDirty: true, shouldValidate: true });
        };
        reader.readAsDataURL(file);
    }

    function handleSubmit(values: ProductFormSchema) {
        const payload: ProductFormSubmitData = {
            sku: values.sku.trim(),
            barcode: values.barcode?.trim() ? values.barcode.trim() : null,
            name: values.name.trim(),
            category: values.category.trim(),
            purchase_price: Number(values.purchase_price),
            sale_price: Number(values.sale_price),
            image_url: values.image_url?.trim() || "",
        };

        const location = values.location?.trim() || "";
        if (location) payload.location = location;
        if (!isEditMode) payload.stock_initial = Number(values.stock_initial || "0");

        onSubmit(payload);
    }

    return (
        <>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                    <div className="rounded-lg border p-3">
                        <p className="text-sm font-semibold">Datos comerciales</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nombre</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ej: Zapatilla Running Pro" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="category"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Categoria</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Calzado, Ropa, Accesorios" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="sku"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>SKU interno</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ej: NK-732" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="barcode"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Codigo de barras</FormLabel>
                                        <FormControl>
                                            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                                                <Input
                                                    id="product-barcode-input"
                                                    placeholder="Escanee o ingrese codigo"
                                                    {...field}
                                                    onKeyDown={(event) => handleReaderKeyDown("barcode", event)}
                                                />
                                                <Button type="button" variant="outline" onClick={() => openScanner("barcode")}>
                                                    <Camera className="mr-2 h-4 w-4" />
                                                    Camara
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant={barcodeReaderMode ? "default" : "outline"}
                                                    onClick={() => handleReaderModeToggle("barcode")}
                                                >
                                                    <ScanLine className="mr-2 h-4 w-4" />
                                                    Lector
                                                </Button>
                                            </div>
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground">
                                            {barcodeReaderMode
                                                ? "Modo lector activo: enfoque el input y dispare con Enter."
                                                : "Puede capturarlo con telefono o lapiz optico."}
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>

                    <div className="rounded-lg border p-3">
                        <p className="text-sm font-semibold">Imagen del producto</p>
                        <div className="mt-3 grid gap-3">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="image_url"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>URL de imagen (o carga local)</FormLabel>
                                        <FormControl>
                                            <Input placeholder="https://..." {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex flex-wrap items-center gap-2">
                                <label className="inline-flex cursor-pointer items-center">
                                    <input type="file" accept="image/*" className="hidden" onChange={handleImageFileChange} />
                                    <span className="inline-flex items-center rounded-md border px-3 py-2 text-sm">
                                        <Upload className="mr-2 h-4 w-4" />
                                        Subir imagen
                                    </span>
                                </label>
                                <span className="text-xs text-muted-foreground">Se guarda como URL o data URL ligera.</span>
                            </div>

                            <div className="rounded-md border bg-muted/20 p-2">
                                {canRenderImage ? (
                                    <img
                                        src={imageValue}
                                        alt="Preview del producto"
                                        className="h-40 w-full rounded-md object-cover"
                                        onError={() => form.setValue("image_url", "", { shouldDirty: true, shouldValidate: true })}
                                    />
                                ) : (
                                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                                        Sin imagen cargada
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-lg border p-3">
                        <p className="text-sm font-semibold">Ubicacion y precios</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="location"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Ubicacion de almacen</FormLabel>
                                        <FormControl>
                                            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                                                <Input
                                                    id="product-location-input"
                                                    placeholder="Ej: A1-R02-F03-C01"
                                                    {...field}
                                                    onKeyDown={(event) => handleReaderKeyDown("location", event)}
                                                />
                                                <Button type="button" variant="outline" onClick={() => openScanner("location")}>
                                                    <Camera className="mr-2 h-4 w-4" />
                                                    Camara
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant={locationReaderMode ? "default" : "outline"}
                                                    onClick={() => handleReaderModeToggle("location")}
                                                >
                                                    <ScanLine className="mr-2 h-4 w-4" />
                                                    Lector
                                                </Button>
                                            </div>
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground">
                                            {locationReaderMode ? "Modo lector de ubicacion activo." : "Tambien puede cargarla manualmente."}
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid gap-3 md:grid-cols-2">
                                <FormField<ProductFormSchema>
                                    control={form.control}
                                    name="purchase_price"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Precio compra</FormLabel>
                                            <FormControl>
                                                <Input type="number" min="0" step="0.01" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField<ProductFormSchema>
                                    control={form.control}
                                    name="sale_price"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Precio venta</FormLabel>
                                            <FormControl>
                                                <Input type="number" min="0" step="0.01" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        {!isEditMode ? (
                            <div className="mt-3 grid gap-3 md:max-w-xs">
                                <FormField<ProductFormSchema>
                                    control={form.control}
                                    name="stock_initial"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Stock inicial</FormLabel>
                                            <FormControl>
                                                <Input type="number" min="0" step="1" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        ) : (
                            <p className="mt-3 text-xs text-muted-foreground">
                                El stock de productos existentes se gestiona desde recepciones o movimientos de inventario.
                            </p>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <Button type="button" variant="outline" onClick={onCancel}>
                            Cancelar
                        </Button>
                        <Button type="submit">{isEditMode ? "Guardar cambios" : "Crear producto"}</Button>
                    </div>
                </form>
            </Form>

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
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{scanTarget === "barcode" ? "Escanear codigo de barras" : "Escanear ubicacion"}</DialogTitle>
                        <DialogDescription>Enfoque el codigo con la camara o ingrese manualmente.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="overflow-hidden rounded-md border bg-black">
                            <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
                        </div>
                        <p className="text-xs text-muted-foreground">{scanStatus}</p>

                        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                            <Input
                                placeholder="Fallback manual"
                                value={manualScanValue}
                                onChange={(event) => setManualScanValue(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") handleManualScanApply();
                                }}
                            />
                            <Button type="button" variant="outline" onClick={handleManualScanApply}>
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

