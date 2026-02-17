import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "../ui/form"
import { Input } from "@/components/ui/input"
import type { Product } from "@/types"

const productSchema = z.object({
    sku: z.string().min(3, "SKU must be at least 3 characters"),
    name: z.string().min(2, "Name must be at least 2 characters"),
    category: z.string().min(2, "Category is required"),
    location_sector: z.string().optional(),
    location_rack: z.string().optional(),
    location_row: z.string().optional(),
    location_col: z.string().optional(),
    purchase_price: z.string().refine((val) => !isNaN(Number(val)) && Number(val) >= 0, "Must be a valid positive number"),
    sale_price: z.string().refine((val) => !isNaN(Number(val)) && Number(val) >= 0, "Must be a valid positive number"),
    stock: z.string().refine((val) => !isNaN(Number(val)) && Number(val) >= 0, "Must be a valid positive number"),
})

type ProductFormSchema = z.infer<typeof productSchema>

type ProductData = Omit<Product, "id" | "created_at" | "description" | "image_url">

interface ProductFormProps {
    initialData?: Product
    onSubmit: (data: ProductData) => void
    onCancel: () => void
}

export function ProductForm({ initialData, onSubmit, onCancel }: ProductFormProps) {
    // Parse location string into parts if it exists
    const locationParts = initialData?.location?.split('-') || []

    const form = useForm<ProductFormSchema>({
        resolver: zodResolver(productSchema),
        defaultValues: {
            sku: initialData?.sku || "",
            name: initialData?.name || "",
            category: initialData?.category || "",
            location_sector: locationParts[0] || "",
            location_rack: locationParts[1] || "",
            location_row: locationParts[2] || "",
            location_col: locationParts[3] || "",
            purchase_price: initialData?.purchase_price?.toString() || "0",
            sale_price: initialData?.sale_price?.toString() || "0",
            stock: "0",
        },
    })

    const handleSubmit = (values: ProductFormSchema) => {
        // Join non-empty location parts with '-'
        const locationParts = [values.location_sector, values.location_rack, values.location_row, values.location_col].filter(Boolean)
        const locationString = locationParts.length > 0 ? locationParts.join('-') : undefined

        const payload: ProductData = {
            sku: values.sku,
            name: values.name,
            category: values.category,
            purchase_price: parseFloat(values.purchase_price),
            sale_price: parseFloat(values.sale_price),
        }

        if (locationString) {
            payload.location = locationString
        }

        onSubmit(payload)
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField<ProductFormSchema>
                    control={form.control}
                    name="sku"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>SKU</FormLabel>
                            <FormControl>
                                <Input placeholder="PROD-001" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField<ProductFormSchema>
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Nombre del Producto</FormLabel>
                            <FormControl>
                                <Input placeholder="Ej: Zapatillas Running" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid grid-cols-2 gap-4">
                    <FormField<ProductFormSchema>
                        control={form.control}
                        name="category"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Categoría</FormLabel>
                                <FormControl>
                                    <Input placeholder="Calzado, Ropa..." {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField<ProductFormSchema>
                        control={form.control}
                        name="stock"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Stock Inicial</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="space-y-4 rounded-lg border p-4 bg-slate-900/50">
                    <FormLabel className="text-base">Ubicación (Opcional)</FormLabel>
                    <div className="grid grid-cols-4 gap-2">
                        <FormField<ProductFormSchema>
                            control={form.control}
                            name="location_sector"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Sector</FormLabel>
                                    <FormControl>
                                        <Input placeholder="A1" className="bg-background" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<ProductFormSchema>
                            control={form.control}
                            name="location_rack"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Rack</FormLabel>
                                    <FormControl>
                                        <Input placeholder="01" className="bg-background" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<ProductFormSchema>
                            control={form.control}
                            name="location_row"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Fila</FormLabel>
                                    <FormControl>
                                        <Input placeholder="01" className="bg-background" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField<ProductFormSchema>
                            control={form.control}
                            name="location_col"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs">Columna</FormLabel>
                                    <FormControl>
                                        <Input placeholder="01" className="bg-background" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField<ProductFormSchema>
                        control={form.control}
                        name="purchase_price"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Precio Compra</FormLabel>
                                <FormControl>
                                    <Input type="number" step="0.01" {...field} />
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
                                <FormLabel>Precio Venta</FormLabel>
                                <FormControl>
                                    <Input type="number" step="0.01" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Cancelar
                    </Button>
                    <Button type="submit">Guardar Producto</Button>
                </div>
            </form>
        </Form>
    )
}
