import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, ImagePlus, ScanLine, Trash2, Upload } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import type { Product } from "@/types";
import { api } from "@/services/api";
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

const MAX_PRODUCT_IMAGE_FILE_BYTES = 1_500_000;
const IMAGE_URL_PATTERN = /^https?:\/\/.+/i;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

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
    image_url: z
        .string()
        .trim()
        .max(2048, "La URL de imagen es demasiado larga")
        .refine((value) => value === "" || IMAGE_URL_PATTERN.test(value), "Debe ser una URL http(s) valida"),
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
    onSubmit: (data: ProductFormSubmitData) => void | Promise<void>;
    onCancel: () => void;
}

type ScanTarget = "barcode" | "location";
type BarcodeDetectorLike = {
    detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function canRenderProductImage(value: string): boolean {
    const sanitized = value.trim();
    if (!sanitized) return false;
    if (IMAGE_URL_PATTERN.test(sanitized)) return true;
    return IMAGE_DATA_URL_PATTERN.test(sanitized);
}

async function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string" && reader.result.trim()) {
                resolve(reader.result);
                return;
            }
            reject(new Error("No se pudo leer la imagen seleccionada."));
        };
        reader.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
        reader.readAsDataURL(file);
    });
}

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
    const [isUploadingImage, setIsUploadingImage] = useState(false);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detectorRef = useRef<BarcodeDetectorLike | null>(null);
    const rafRef = useRef<number | null>(null);
    const scannerSessionRef = useRef(0);

    const canRenderImage = useMemo(() => canRenderProductImage(imageValue), [imageValue]);
    const hasImageValue = imageValue.trim().length > 0;

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

    async function handleImageFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.currentTarget.value = "";
        if (!file) return;

        if (!IMAGE_MIME_TYPES.has(file.type)) {
            form.setError("image_url", { type: "manual", message: "Formato no soportado. Use PNG, JPG, WEBP o GIF." });
            return;
        }

        if (file.size > MAX_PRODUCT_IMAGE_FILE_BYTES) {
            form.setError("image_url", { type: "manual", message: "La imagen supera el limite de 1.5MB." });
            return;
        }

        try {
            setIsUploadingImage(true);
            form.clearErrors("image_url");
            const dataUrl = await readFileAsDataUrl(file);
            const response = await api.uploadProductImage(dataUrl);
            form.setValue("image_url", response.image_url, { shouldDirty: true, shouldValidate: true });
            toast.success("Imagen cargada correctamente");
        } catch (error) {
            const message = error instanceof Error ? error.message : "No se pudo cargar la imagen.";
            form.setError("image_url", { type: "manual", message });
            toast.error(message);
        } finally {
            setIsUploadingImage(false);
        }
    }

    async function handleSubmit(values: ProductFormSchema) {
        if (isUploadingImage) {
            form.setError("image_url", { type: "manual", message: "Espere a que finalice la carga de imagen." });
            return;
        }

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

        await onSubmit(payload);
    }

    return (
        <>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 pb-1">
                    <div className="rounded-lg border p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">Datos comerciales</p>
                            <p className="text-[11px] text-muted-foreground">Nombre, categoria y codigos</p>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
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

                        <div className="mt-3 grid gap-3 xl:grid-cols-2">
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
                                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                                                <Input
                                                    id="product-barcode-input"
                                                    placeholder="Escanee o ingrese codigo"
                                                    {...field}
                                                    onKeyDown={(event) => handleReaderKeyDown("barcode", event)}
                                                />
                                                <Button className="h-10 px-3" type="button" variant="outline" onClick={() => openScanner("barcode")}>
                                                    <Camera className="mr-2 h-4 w-4" />
                                                    Camara
                                                </Button>
                                                <Button
                                                    className="h-10 px-3"
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

                    <div className="rounded-lg border p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold">Imagen del producto</p>
                                <p className="text-[11px] text-muted-foreground">Visible en catalogo y POS</p>
                            </div>
                            <ImagePlus className="h-4 w-4 text-muted-foreground" />
                        </div>
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
                                    <span className="inline-flex h-10 items-center rounded-md border px-3 text-sm font-medium">
                                        <Upload className="mr-2 h-4 w-4" />
                                        {isUploadingImage ? "Subiendo..." : "Subir imagen"}
                                    </span>
                                </label>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-10 px-3"
                                    disabled={!hasImageValue}
                                    onClick={() => form.setValue("image_url", "", { shouldDirty: true, shouldValidate: true })}
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Quitar
                                </Button>
                                <span className="basis-full text-xs text-muted-foreground">La imagen se sube al servidor y se guarda como URL segura.</span>
                            </div>

                            <div className="overflow-hidden rounded-md border bg-muted/20 p-2">
                                <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-background/60">
                                    {canRenderImage ? (
                                        <img
                                            src={imageValue}
                                            alt="Preview del producto"
                                            className="h-full w-full rounded-md object-cover"
                                            onError={() => form.setValue("image_url", "", { shouldDirty: true, shouldValidate: true })}
                                        />
                                    ) : (
                                        <div className="text-center text-sm text-muted-foreground">
                                            <p>Sin imagen cargada</p>
                                            <p className="mt-1 text-xs">PNG, JPG, WEBP o GIF hasta 1.5MB</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-lg border p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold">Ubicacion y precios</p>
                            <p className="text-[11px] text-muted-foreground">Almacen y costos</p>
                        </div>
                        <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="location"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Ubicacion de almacen</FormLabel>
                                        <FormControl>
                                            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                                                <Input
                                                    id="product-location-input"
                                                    placeholder="Ej: A1-R02-F03-C01"
                                                    {...field}
                                                    onKeyDown={(event) => handleReaderKeyDown("location", event)}
                                                />
                                                <Button className="h-10 px-3" type="button" variant="outline" onClick={() => openScanner("location")}>
                                                    <Camera className="mr-2 h-4 w-4" />
                                                    Camara
                                                </Button>
                                                <Button
                                                    className="h-10 px-3"
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

                            <div className="grid gap-3 sm:grid-cols-2">
                                <FormField<ProductFormSchema>
                                    control={form.control}
                                    name="purchase_price"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Precio compra</FormLabel>
                                            <FormControl>
                                                <Input inputMode="decimal" type="number" min="0" step="0.01" {...field} />
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
                                                <Input inputMode="decimal" type="number" min="0" step="0.01" {...field} />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        {!isEditMode ? (
                            <div className="mt-3 grid gap-3 sm:max-w-xs">
                                <FormField<ProductFormSchema>
                                    control={form.control}
                                    name="stock_initial"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Stock inicial</FormLabel>
                                            <FormControl>
                                                <Input inputMode="numeric" type="number" min="0" step="1" {...field} />
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

                    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                        <Button type="button" variant="outline" onClick={onCancel}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isUploadingImage || form.formState.isSubmitting}>
                            {isEditMode ? "Guardar cambios" : "Crear producto"}
                        </Button>
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
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{scanTarget === "barcode" ? "Escanear codigo de barras" : "Escanear ubicacion"}</DialogTitle>
                        <DialogDescription>Enfoque el codigo con la camara o ingrese manualmente.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="overflow-hidden rounded-md border bg-black">
                            <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
                        </div>
                        <p className="text-xs text-muted-foreground">{scanStatus}</p>

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
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
