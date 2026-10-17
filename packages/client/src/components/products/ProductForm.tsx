import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, ImagePlus, ScanLine, Trash2, Upload } from "lucide-react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";
import { createProductSchema, hasPermission, PERMISSIONS } from "@wsm/common";
import type { Product, ProductCatalogOption } from "@/types";
import { api } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { formatMoney } from "@/lib/formatters";
import { VAT_RATE_OPTIONS, formatVatRate, grossPrice, netForTypedFinalPrice, netFromGross, vatRateOf } from "@/lib/pricing";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CatalogOptionSelect } from "@/components/products/CatalogOptionSelect";

const MAX_PRODUCT_IMAGE_FILE_BYTES = 1_500_000;
const IMAGE_URL_PATTERN = /^https?:\/\/.+/i;
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i;

// The two cost-policy checkboxes (ADR-027) live in their own state, not in the text fields.
const productSchema = createProductSchema.omit({ auto_update_cost: true, auto_update_price: true }).extend({
    purchase_price: z.union([z.string(), z.number()]).transform(v => String(v)),
    sale_price: z.union([z.string(), z.number()]).transform(v => String(v)),
    stock_initial: z.union([z.string(), z.number()]).transform(v => String(v)),
}).refine(
    // Opening stock is valued at cost (the server refuses it without one).
    (values) => !(Number(values.stock_initial || 0) > 0) || Number(values.purchase_price || 0) > 0,
    { message: "Para cargar stock inicial indicá el precio de compra", path: ["purchase_price"] }
);

type ProductFormSchema = z.infer<typeof productSchema>;
const productFormResolver = zodResolver(productSchema) as Resolver<ProductFormSchema>;

export type ProductFormSubmitData = {
    sku: string;
    barcode?: string | null;
    name: string;
    category: string;
    subcategory?: string | null;
    category_option_id?: string | null;
    subcategory_option_id?: string | null;
    brand_option_id?: string | null;
    size_option_id?: string | null;
    color_option_id?: string | null;
    family_name?: string | null;
    brand?: string | null;
    size?: string | null;
    color?: string | null;
    location?: string;
    purchase_price: number;
    sale_price: number;
    vat_rate: number;
    stock_initial?: number;
    image_url?: string;
    tiendanube_safety_stock?: number | null;
    auto_update_cost: boolean;
    auto_update_price: boolean;
};

// The cost the product is valued at (ADR-027): purchase_price, or cost_price while it is empty.
function productCost(product?: Product): number {
    const purchase = Number(product?.purchase_price || 0);
    return purchase > 0 ? purchase : Number(product?.cost_price || 0);
}

const flagOn = (value: boolean | number | undefined) => value === undefined || value === null || Boolean(Number(value));

/** Same rule as the server: the final price moves with the cost, rounded to the cent. */
function repricedFinal(currentFinal: number, oldCost: number, newCost: number): number | null {
    if (!(oldCost > 0) || !(currentFinal > 0) || !(newCost > 0)) return null;
    return Math.round((currentFinal * newCost / oldCost + Number.EPSILON) * 100) / 100;
}

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

function PolicyOption({ id, checked, disabled, onChange, label, hint }: {
    id: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
    label: string;
    hint: string;
}) {
    return (
        <div className="flex min-h-11 items-start gap-3 rounded-lg border p-3">
            <input
                id={id}
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
                aria-describedby={`${id}-hint`}
            />
            <div>
                <label htmlFor={id} className="block cursor-pointer text-sm font-medium">{label}</label>
                <p id={`${id}-hint`} className="text-xs text-muted-foreground" aria-live="polite">{hint}</p>
            </div>
        </div>
    );
}

export function ProductForm({ initialData, onSubmit, onCancel }: ProductFormProps) {
    const form = useForm<ProductFormSchema>({
        resolver: productFormResolver,
        defaultValues: {
            sku: initialData?.sku ?? "",
            barcode: initialData?.barcode ?? "",
            name: initialData?.name ?? "",
            category: initialData?.category ?? "",
            subcategory: initialData?.subcategory ?? "",
            category_option_id: initialData?.category_option_id ?? null,
            subcategory_option_id: initialData?.subcategory_option_id ?? null,
            brand_option_id: initialData?.brand_option_id ?? null,
            size_option_id: initialData?.size_option_id ?? null,
            color_option_id: initialData?.color_option_id ?? null,
            family_name: initialData?.family_name ?? "",
            brand: initialData?.brand ?? "",
            size: initialData?.size ?? "",
            color: initialData?.color ?? "",
            location: initialData?.location ?? "",
            purchase_price: String(productCost(initialData)),
            // The sale price is typed as the final (VAT-included) one and stored net (ADR-015).
            sale_price: String(grossPrice(initialData?.sale_price ?? 0, initialData?.vat_rate)),
            stock_initial: "0",
            image_url: initialData?.image_url ?? "",
            tiendanube_safety_stock: initialData?.tiendanube_safety_stock ?? null,
        },
    });

    const isEditMode = Boolean(initialData);
    const { user } = useAuth();
    // D5 (ADR-027): a new cost on an existing product revalues its stock: manager or admin only.
    const canEditCost = !isEditMode || hasPermission(user?.role, PERMISSIONS.PRODUCTS_COST_EDIT);
    const [autoUpdateCost, setAutoUpdateCost] = useState(flagOn(initialData?.auto_update_cost));
    const [autoUpdatePrice, setAutoUpdatePrice] = useState(flagOn(initialData?.auto_update_price));
    // The chosen rate drives every net/final calculation; the typed final price is kept when it changes.
    const [vatRateValue, setVatRateValue] = useState(String(vatRateOf(initialData?.vat_rate)));
    const vatRate = vatRateOf(vatRateValue);
    const purchaseWatch = useWatch({ control: form.control, name: "purchase_price" });
    const saleFinalWatch = useWatch({ control: form.control, name: "sale_price" });
    const saleNet = netFromGross(saleFinalWatch, vatRate);
    const saleVat = Math.round((Number(saleFinalWatch || 0) - saleNet) * 100) / 100;
    // A new cost with the price untouched: the price follows it when the product says so (D1).
    const initialCost = productCost(initialData);
    const initialFinal = grossPrice(initialData?.sale_price ?? 0, vatRate);
    const costChanged = isEditMode && Math.round(Number(purchaseWatch || 0) * 100) !== Math.round(initialCost * 100);
    const priceUntouched = Number(saleFinalWatch) === initialFinal;
    const followingFinal = costChanged && autoUpdatePrice && priceUntouched
        ? repricedFinal(initialFinal, initialCost, Number(purchaseWatch || 0))
        : null;
    const imageValue = useWatch({ control: form.control, name: "image_url" }) ?? "";

    const [scanDialogOpen, setScanDialogOpen] = useState(false);
    const [scanTarget, setScanTarget] = useState<ScanTarget>("barcode");
    const [scanStatus, setScanStatus] = useState("Esperando lectura...");
    const [manualScanValue, setManualScanValue] = useState("");
    const [barcodeReaderMode, setBarcodeReaderMode] = useState(false);
    const [locationReaderMode, setLocationReaderMode] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);
    const [catalogOptions, setCatalogOptions] = useState<ProductCatalogOption[]>([]);

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const detectorRef = useRef<BarcodeDetectorLike | null>(null);
    const rafRef = useRef<number | null>(null);
    const scannerSessionRef = useRef(0);

    const canRenderImage = useMemo(() => canRenderProductImage(imageValue), [imageValue]);
    const hasImageValue = imageValue.trim().length > 0;
    const selectedGroupId = useWatch({ control: form.control, name: "category_option_id" }) ?? null;

    useEffect(() => {
        let active = true;
        api.getProductCatalogOptions({ include_inactive: true })
            .then((options) => {
                if (active) setCatalogOptions(options);
            })
            .catch(() => {
                if (active) toast.error("No se pudieron cargar los maestros del catálogo");
            });
        return () => {
            active = false;
        };
    }, []);

    function addCatalogOption(option: ProductCatalogOption) {
        setCatalogOptions((current) => current.some((item) => item.id === option.id) ? current : [...current, option]);
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
        form.setValue(scanTarget, sanitized, { shouldDirty: true, shouldValidate: true });
        closeScannerDialog();
    }

    async function startCameraAndDetection(sessionId: number) {
        if (!navigator.mediaDevices?.getUserMedia) {
            setScanStatus("Cámara no disponible en este navegador.");
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
            setScanStatus("Cámara activa. Enfocá el código.");

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
            setScanStatus("No se pudo abrir la cámara. Revisá los permisos del navegador.");
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
            setImagePreviewError(null);
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
            category: (values.category ?? "").trim(),
            subcategory: values.subcategory?.trim() || null,
            category_option_id: values.category_option_id || null,
            subcategory_option_id: values.subcategory_option_id || null,
            brand_option_id: values.brand_option_id || null,
            size_option_id: values.size_option_id || null,
            color_option_id: values.color_option_id || null,
            family_name: values.family_name?.trim() || null,
            brand: values.brand?.trim() || null,
            size: values.size?.trim() || null,
            color: values.color?.trim() || null,
            purchase_price: Number(values.purchase_price),
            sale_price: netForTypedFinalPrice(values.sale_price, initialData?.sale_price, vatRate),
            vat_rate: vatRate,
            image_url: values.image_url?.trim() || "",
            tiendanube_safety_stock: values.tiendanube_safety_stock ?? null,
            auto_update_cost: autoUpdateCost,
            auto_update_price: autoUpdatePrice,
        };

        const location = values.location?.trim() || "";
        if (location) payload.location = location;
        if (!isEditMode) payload.stock_initial = Number(values.stock_initial || "0");

        await onSubmit(payload);
    }

    return (
        <>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5 pb-1">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
                        <div className="rounded-xl border p-4 sm:p-5">
                        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <p className="text-sm font-semibold">Datos comerciales</p>
                            <p className="text-[11px] text-muted-foreground">Nombre, categoría y códigos</p>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Nombre</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ej: Zapatilla Running Pro" {...field} value={field.value ?? ""} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="category_option_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Grupo / categoría</FormLabel>
                                        <FormControl>
                                            <CatalogOptionSelect
                                                type="group"
                                                value={typeof field.value === "string" ? field.value : null}
                                                options={catalogOptions}
                                                placeholder="Seleccionar grupo"
                                                onCreated={addCatalogOption}
                                                onValueChange={(value) => {
                                                    form.setValue("category_option_id", value, { shouldDirty: true, shouldValidate: true });
                                                    form.setValue("subcategory_option_id", null, { shouldDirty: true });
                                                }}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="mt-3">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="subcategory_option_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Subgrupo <span className="text-xs font-normal text-muted-foreground">(opcional)</span></FormLabel>
                                        <FormControl>
                                            <CatalogOptionSelect
                                                type="subgroup"
                                                value={typeof field.value === "string" ? field.value : null}
                                                parentId={selectedGroupId}
                                                options={catalogOptions}
                                                placeholder={selectedGroupId ? "Seleccionar subgrupo" : "Primero elegí un grupo"}
                                                onCreated={addCatalogOption}
                                                onValueChange={(value) => form.setValue("subcategory_option_id", value, { shouldDirty: true, shouldValidate: true })}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="mt-3">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="family_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Familia o modelo <span className="text-xs font-normal text-muted-foreground">(opcional)</span></FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="Ej: Remera Essential"
                                                {...field}
                                                value={field.value ?? ""}
                                            />
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground">
                                            Repite esta familia para agrupar sus talles y colores. Si cargas una variante y lo dejas vacío, se usará el nombre del producto.
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                            {([
                                ["brand_option_id", "brand", "Marca", "Seleccionar marca"],
                                ["size_option_id", "size", "Talle", "Seleccionar talle"],
                                ["color_option_id", "color", "Color", "Seleccionar color"],
                            ] as const).map(([name, type, label, placeholder]) => (
                                <FormField<ProductFormSchema>
                                    key={name}
                                    control={form.control}
                                    name={name}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{label} <span className="text-xs font-normal text-muted-foreground">(opcional)</span></FormLabel>
                                            <FormControl>
                                                <CatalogOptionSelect
                                                    type={type}
                                                    value={typeof field.value === "string" ? field.value : null}
                                                    options={catalogOptions}
                                                    placeholder={placeholder}
                                                    onCreated={addCatalogOption}
                                                    onValueChange={(value) => form.setValue(name, value, { shouldDirty: true, shouldValidate: true })}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            ))}
                        </div>

                        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="sku"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>SKU interno</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Ej: NK-732" {...field} value={field.value ?? ""} />
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
                                        <FormLabel>Código de barras</FormLabel>
                                        <FormControl>
                                            <div className="space-y-2">
                                                <Input
                                                    id="product-barcode-input"
                                                    placeholder="Escaneá o escribí el código"
                                                    {...field}
                                                    value={field.value ?? ""}
                                                    onKeyDown={(event) => handleReaderKeyDown("barcode", event)}
                                                />
                                                <div className="grid gap-2 md:grid-cols-2">
                                                    <Button className="h-10 w-full px-3" type="button" variant="outline" onClick={() => openScanner("barcode")}>
                                                        <Camera className="mr-2 h-4 w-4" />
                                                        Cámara
                                                    </Button>
                                                    <Button
                                                        className="h-10 w-full px-3"
                                                        type="button"
                                                        variant={barcodeReaderMode ? "default" : "outline"}
                                                        onClick={() => handleReaderModeToggle("barcode")}
                                                    >
                                                        <ScanLine className="mr-2 h-4 w-4" />
                                                        Lector
                                                    </Button>
                                                </div>
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

                        <div className="rounded-xl border p-4 sm:p-5">
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
                                            <Input placeholder="https://..." {...field} value={field.value ?? ""} />
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

                            <div className="overflow-hidden rounded-lg border bg-muted/20 p-2">
                                <div className="flex min-h-[120px] max-h-[150px] items-center justify-center rounded-md bg-background/60 md:min-h-[180px] md:max-h-[220px]">
                                    {canRenderImage ? (
                                        <img
                                            src={imageValue}
                                            alt="Preview del producto"
                                            className="h-full w-full rounded-md object-contain p-2"
                                            onLoad={() => setImagePreviewError(null)}
                                            onError={() => setImagePreviewError("La imagen se subió, pero el navegador no pudo mostrarla. Reintente o revise la URL.")}
                                        />
                                    ) : (
                                        <div className="text-center text-sm text-muted-foreground">
                                            <p>Sin imagen cargada</p>
                                            <p className="mt-1 text-xs">PNG, JPG, WEBP o GIF hasta 1.5MB</p>
                                        </div>
                                    )}
                                </div>
                                {imagePreviewError ? <p className="mt-2 text-xs text-destructive">{imagePreviewError}</p> : null}
                            </div>
                        </div>
                    </div>
                    </div>

                    <div className="rounded-xl border p-4 sm:p-5">
                        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <p className="text-sm font-semibold">Ubicación y precios</p>
                            <p className="text-[11px] text-muted-foreground">Almacén y costos</p>
                        </div>
                        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="location"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Ubicación de referencia</FormLabel>
                                        <FormControl>
                                            <div className="space-y-2">
                                                <Input
                                                    id="product-location-input"
                                                    placeholder="Ej: A1-R02-F03-C01"
                                                    {...field}
                                                    value={field.value ?? ""}
                                                    onKeyDown={(event) => handleReaderKeyDown("location", event)}
                                                />
                                                <div className="grid gap-2 md:grid-cols-2">
                                                    <Button className="h-10 w-full px-3" type="button" variant="outline" onClick={() => openScanner("location")}>
                                                        <Camera className="mr-2 h-4 w-4" />
                                                        Cámara
                                                    </Button>
                                                    <Button
                                                        className="h-10 w-full px-3"
                                                        type="button"
                                                        variant={locationReaderMode ? "default" : "outline"}
                                                        onClick={() => handleReaderModeToggle("location")}
                                                    >
                                                        <ScanLine className="mr-2 h-4 w-4" />
                                                        Lector
                                                    </Button>
                                                </div>
                                            </div>
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground">
                                            {locationReaderMode
                                                ? "Modo lector de ubicación activo."
                                                : isEditMode
                                                  ? "Este dato identifica la ubicación preferida; usá Reubicar para mover existencias físicas."
                                                  : "También se puede cargar a mano."}
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="space-y-2 md:max-w-xs">
                                <Label htmlFor="product-vat-rate">Alícuota de IVA</Label>
                                <Select value={vatRateValue} onValueChange={setVatRateValue}>
                                    <SelectTrigger id="product-vat-rate" aria-label="Alícuota de IVA">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {VAT_RATE_OPTIONS.map((rate) => (
                                            <SelectItem key={rate} value={String(rate)}>
                                                {formatVatRate(rate)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                                <FormField<ProductFormSchema>
                                    control={form.control}
                                    name="purchase_price"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Precio compra neto (s/IVA)</FormLabel>
                                            <FormControl>
                                                <Input inputMode="decimal" type="number" min="0" step="0.01" {...field} value={field.value ?? ""} disabled={!canEditCost} />
                                            </FormControl>
                                            <FormDescription className="text-xs" aria-live="polite">
                                                Final c/IVA: {formatMoney(grossPrice(purchaseWatch, vatRate))}
                                                {!canEditCost
                                                    ? " · Solo un gerente o un administrador puede cambiar el costo."
                                                    : isEditMode ? " · Si cambiás el costo y hay stock, se revalúa ese stock con un asiento." : ""}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField<ProductFormSchema>
                                    control={form.control}
                                    name="sale_price"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Precio de venta final (IVA incl.)</FormLabel>
                                            <FormControl>
                                                <Input inputMode="decimal" type="number" min="0" step="0.01" {...field} value={field.value ?? ""} />
                                            </FormControl>
                                            <FormDescription className="text-xs" aria-live="polite">
                                                {followingFinal != null
                                                    ? `Con el costo nuevo, el precio final pasa a ${formatMoney(followingFinal)} (mantiene el margen). Si querés otro, escribilo.`
                                                    : `Precio final con IVA; se guarda el neto. Neto: ${formatMoney(saleNet)} · IVA ${vatRate}%: ${formatMoney(saleVat)}`}
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>

                        <fieldset className="mt-4 grid gap-2 md:grid-cols-2">
                            <legend className="mb-1 text-sm font-medium">Cuando cambia el costo de compra</legend>
                            <PolicyOption
                                id="product-auto-update-cost"
                                checked={autoUpdateCost}
                                disabled={!canEditCost}
                                onChange={setAutoUpdateCost}
                                label="Actualizar el costo con cada compra"
                                hint={autoUpdateCost
                                    ? "El costo pasa a ser el de la última compra y el stock se revalúa."
                                    : "El costo queda fijo; la diferencia con lo que se paga va a resultados."}
                            />
                            <PolicyOption
                                id="product-auto-update-price"
                                checked={autoUpdatePrice}
                                onChange={setAutoUpdatePrice}
                                label="Ajustar el precio de venta al costo"
                                hint={autoUpdatePrice
                                    ? "Si el costo cambia, el precio final se recalcula manteniendo el margen."
                                    : "El precio de venta queda como lo cargaste aunque cambie el costo."}
                            />
                        </fieldset>

                        <div className="mt-3 grid gap-3 md:max-w-xs">
                            <FormField<ProductFormSchema>
                                control={form.control}
                                name="tiendanube_safety_stock"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Stock de seguridad en la tienda online <span className="text-xs font-normal text-muted-foreground">(opcional)</span></FormLabel>
                                        <FormControl>
                                            <Input
                                                inputMode="numeric"
                                                type="number"
                                                min="0"
                                                step="1"
                                                placeholder="Usa el valor general"
                                                name={field.name}
                                                ref={field.ref}
                                                onBlur={field.onBlur}
                                                value={field.value ?? ""}
                                                onChange={(event) => field.onChange(event.target.value === "" ? null : event.target.value)}
                                            />
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            Solo aplica si la política de stock de seguridad está activa. Vacío = usa el valor general.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
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
                                                <Input inputMode="numeric" type="number" min="0" step="1" {...field} value={field.value ?? ""} />
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
                        <DialogTitle>{scanTarget === "barcode" ? "Escanear código de barras" : "Escanear ubicación"}</DialogTitle>
                        <DialogDescription>Enfocá el código con la cámara o escribilo a mano.</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="overflow-hidden rounded-md border bg-black">
                            <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
                        </div>
                        <p className="text-xs text-muted-foreground">{scanStatus}</p>

                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
                            <Input
                                placeholder="Ingreso manual"
                                value={manualScanValue}
                                onChange={(event) => setManualScanValue(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") handleManualScanApply();
                                }}
                            />
                            <Button type="button" variant="outline" className="w-full md:w-auto" onClick={handleManualScanApply}>
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
