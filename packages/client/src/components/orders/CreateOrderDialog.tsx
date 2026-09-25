import { useState, useEffect, useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, CheckCircle2, Calculator, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { createClientUuid } from "@/lib/clientUuid"
import { QuickClientDialog } from "@/components/pos/QuickClientDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ArgentinaDateInput } from "@/components/common/ArgentinaDateInput"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Client, Product } from "@/types"
import type { ShippingMethod, CreateOrderItem, NewClientForm } from "@/types/orders"

interface CreateOrderDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    clients: Client[]
    products: Product[]
    currentUser: { id: string; name: string } | null
}

const PAYMENT_METHODS = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta debito" },
    { value: "credit_card", label: "Tarjeta credito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
]

const CONSUMIDOR_FINAL_VALUE = "__consumidor_final__"

type CreatePaymentLine = { id: string; method: string; amount: string }

function newPaymentLine(method = "cash", amount = ""): CreatePaymentLine {
    return { id: createClientUuid(), method, amount }
}

export function CreateOrderDialog({ open, onOpenChange, clients, products, currentUser }: CreateOrderDialogProps) {
    const queryClient = useQueryClient()

    // Form states
    const [createClientId, setCreateClientId] = useState("")
    const [createCounterName, setCreateCounterName] = useState("")
    const [createPaymentLines, setCreatePaymentLines] = useState<CreatePaymentLine[]>([newPaymentLine()])
    const [createShippingMethod, setCreateShippingMethod] = useState<ShippingMethod>("pickup")
    const [createEstimatedDelivery, setCreateEstimatedDelivery] = useState("")
    const [createShippingAddress, setCreateShippingAddress] = useState("")
    const [createRecipientName, setCreateRecipientName] = useState("")
    const [createRecipientDni, setCreateRecipientDni] = useState("")
    const [createNotes, setCreateNotes] = useState("")
    const [createItems, setCreateItems] = useState<CreateOrderItem[]>([])
    const [productSearch, setProductSearch] = useState("")

    // Quick client dialog states
    const [clientDialogOpen, setClientDialogOpen] = useState(false)
    const [creatingClient, setCreatingClient] = useState(false)
    const [newClient, setNewClient] = useState<NewClientForm>({
        name: "",
        tax_id: "",
        email: "",
        phone: "",
        address: "",
        credit_limit: 0,
    })

    const createOrderMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createOrder>[0]) => api.createOrder(payload),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.orders.all }),
                queryClient.invalidateQueries({ queryKey: queryKeys.products.all }),
            ])
        },
    })

    const selectedCreateClient = useMemo(
        () => clients.find((client) => client.id === createClientId) ?? null,
        [clients, createClientId]
    )

    const productById = useMemo(() => {
        return new Map(products.map((product) => [product.id, product]))
    }, [products])

    const createProductsSearchResults = useMemo(() => {
        const query = productSearch.trim().toLowerCase()
        if (!query) return []
        return products
            .filter((product) => {
                return (
                    product.name.toLowerCase().includes(query) ||
                    product.sku.toLowerCase().includes(query) ||
                    (product.barcode ?? "").toLowerCase().includes(query)
                )
            })
            .slice(0, 30)
    }, [products, productSearch])

    const createOrderTotal = useMemo(() => {
        return createItems.reduce((sum, item) => {
            const product = productById.get(item.product_id)
            return sum + Number(item.quantity || 0) * Number(product?.sale_price || 0)
        }, 0)
    }, [createItems, productById])

    const totalItemsCount = createItems.length
    const totalUnitsCount = useMemo(() => {
        return createItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    }, [createItems])

    const paymentsTotal = useMemo(() => {
        return Math.round(createPaymentLines.reduce((sum, line) => sum + Number(line.amount || 0), 0) * 100) / 100
    }, [createPaymentLines])

    const remainingToAssign = useMemo(() => {
        return Math.round((createOrderTotal - paymentsTotal) * 100) / 100
    }, [createOrderTotal, paymentsTotal])

    const hasItems = totalItemsCount > 0
    const isPaymentBalanced = hasItems && Math.abs(remainingToAssign) <= 0.01 && createPaymentLines.length > 0 && createPaymentLines.every((l) => Number(l.amount || 0) > 0)
    const canSubmit = hasItems && isPaymentBalanced && !createOrderMutation.isPending

    function assignRemainingToLastLine() {
        if (remainingToAssign <= 0 || createPaymentLines.length === 0) return
        setCreatePaymentLines((current) => {
            if (current.length === 0) return current
            const lastIndex = current.length - 1
            const lastLine = current[lastIndex]
            if (!lastLine) return current
            const currentAmount = Number(lastLine.amount || 0)
            const newAmount = Math.round((currentAmount + remainingToAssign) * 100) / 100
            return current.map((line, idx) => (idx === lastIndex ? { ...line, amount: String(newAmount) } : line))
        })
    }

    function assignTotalToSingleLine() {
        if (createOrderTotal <= 0) return
        const method = createPaymentLines[0]?.method || "cash"
        setCreatePaymentLines([newPaymentLine(method, String(createOrderTotal))])
    }

    useEffect(() => {
        if (!open) return
        setCreateCounterName(currentUser?.name || "")
    }, [open, currentUser?.name])

    function resetCreateForm() {
        setCreateClientId("")
        setCreateCounterName(currentUser?.name || "")
        setCreatePaymentLines([newPaymentLine()])
        setCreateShippingMethod("pickup")
        setCreateEstimatedDelivery("")
        setCreateShippingAddress("")
        setCreateRecipientName("")
        setCreateRecipientDni("")
        setCreateNotes("")
        setCreateItems([])
        setProductSearch("")
    }

    function handleOpenChange(nextOpen: boolean) {
        onOpenChange(nextOpen)
        if (!nextOpen) resetCreateForm()
    }

    function addProductToCreateOrder(productId: string) {
        setCreateItems((current) => {
            const existing = current.find((item) => item.product_id === productId)
            if (existing) {
                return current.map((item) =>
                    item.product_id === productId ? { ...item, quantity: item.quantity + 1 } : item
                )
            }
            return [...current, { product_id: productId, quantity: 1 }]
        })
    }

    function updateCreateItemQuantity(productId: string, quantity: number) {
        const safeQuantity = Math.max(1, Number(quantity || 1))
        setCreateItems((current) =>
            current.map((item) => (item.product_id === productId ? { ...item, quantity: safeQuantity } : item))
        )
    }

    function removeCreateItem(productId: string) {
        setCreateItems((current) => current.filter((item) => item.product_id !== productId))
    }

    function updatePaymentLine(id: string, patch: Partial<CreatePaymentLine>) {
        setCreatePaymentLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line))
    }

    async function createQuickClient() {
        if (!newClient.name || !newClient.tax_id) {
            toast.error("Nombre y CUIT/DNI son obligatorios")
            return
        }

        try {
            setCreatingClient(true)
            const created = await api.createClient({
                name: newClient.name,
                tax_id: newClient.tax_id,
                email: newClient.email,
                phone: newClient.phone,
                address: newClient.address,
                credit_limit: Number(newClient.credit_limit || 0),
            })
            queryClient.setQueryData<Client[]>(queryKeys.clients.all, (current) =>
                current ? [created, ...current] : [created]
            )
            setCreateClientId(created.id)
            setClientDialogOpen(false)
            setNewClient({
                name: "",
                tax_id: "",
                email: "",
                phone: "",
                address: "",
                credit_limit: 0,
            })
            toast.success("Cliente creado")
        } catch {
            // El manejo global de httpClient ya informa el error.
        } finally {
            setCreatingClient(false)
        }
    }

    async function createOrder() {
        if (createItems.length === 0) {
            toast.error("Agrega al menos un producto al pedido")
            return
        }
        if (createPaymentLines.some((line) => line.method === "credit_account") && !createClientId) {
            toast.error("Cuenta corriente requiere cliente")
            return
        }
        if (!createEstimatedDelivery) {
            toast.error("Debes indicar la fecha de entrega o retiro")
            return
        }
        if (!createRecipientName) {
            toast.error("Debes registrar quien retira o recibe")
            return
        }
        if (createShippingMethod === "delivery" && !createShippingAddress) {
            toast.error("Completa la direccion para envio")
            return
        }

        const invalidItem = createItems.find((item) => {
            const product = productById.get(item.product_id)
            if (!product) return true
            const available = Number(product.stock_current ?? 0)
            return available <= 0 || Number(item.quantity || 0) > available
        })
        if (invalidItem) {
            const product = productById.get(invalidItem.product_id)
            const available = Number(product?.stock_current ?? 0)
            toast.error(`Stock insuficiente para ${product?.name || invalidItem.product_id}. Disponible: ${available}`)
            return
        }

        if (!isPaymentBalanced) {
            if (remainingToAssign > 0) {
                toast.error(`Falta asignar $${remainingToAssign.toLocaleString("es-AR")} en medios de pago`)
            } else if (remainingToAssign < 0) {
                toast.error(`Los medios de pago superan el total del pedido por $${Math.abs(remainingToAssign).toLocaleString("es-AR")}`)
            } else {
                toast.error("Revisa los importes de los medios de pago")
            }
            return
        }

        try {
            const payload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedCreateClient?.name || "Consumidor final",
                counter_name: createCounterName || currentUser?.name || "",
                payment_method: createPaymentLines[0]?.method || "cash",
                payments: createPaymentLines.map((line) => ({ method: line.method, amount: Number(line.amount) })),
                total_amount: createOrderTotal,
                shipping_method: createShippingMethod,
                estimated_delivery: createEstimatedDelivery,
                shipping_address: createShippingMethod === "delivery" ? createShippingAddress : "",
                recipient_name: createRecipientName,
                recipient_dni: createRecipientDni,
                notes: createNotes,
                items: createItems.map((item) => {
                    const product = productById.get(item.product_id)
                    return {
                        product_id: item.product_id,
                        quantity: Number(item.quantity || 1),
                        unit_price: Number(product?.sale_price || 0),
                        vat_rate: Number(product?.vat_rate ?? 21.00),
                    }
                }),
            }
            if (createClientId) payload.client_id = createClientId
            if (currentUser?.id) payload.counter_user_id = currentUser.id

            await createOrderMutation.mutateAsync(payload)
            toast.success("Pedido creado")
            handleOpenChange(false)
        } catch {
            // El manejo global de React Query ya informa el error.
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Crear pedido</DialogTitle>
                        <DialogDescription>
                            Registra cliente, productos y trazabilidad logistica del pedido.
                        </DialogDescription>
                    </DialogHeader>
                    <form
                        className="space-y-4"
                        onSubmit={(event) => {
                            event.preventDefault()
                            void createOrder()
                        }}
                    >
                        <div className="space-y-3 rounded-md border p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <Label>Cliente</Label>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full sm:w-auto"
                                    onClick={() => setClientDialogOpen(true)}
                                >
                                    Nuevo cliente
                                </Button>
                            </div>
                            <Select
                                value={createClientId || CONSUMIDOR_FINAL_VALUE}
                                onValueChange={(value) => setCreateClientId(value === CONSUMIDOR_FINAL_VALUE ? "" : value)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={CONSUMIDOR_FINAL_VALUE}>Consumidor final</SelectItem>
                                    {clients.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {selectedCreateClient ? (
                                <div className="rounded-md border bg-muted/20 p-2 text-xs">
                                    <div>{selectedCreateClient.name}</div>
                                    <div className="text-muted-foreground">{selectedCreateClient.tax_id}</div>
                                </div>
                            ) : (
                                <p className="text-xs text-muted-foreground">Se registrara como consumidor final.</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label>Nombre mostrador</Label>
                            <Input
                                value={createCounterName}
                                onChange={(event) => setCreateCounterName(event.target.value)}
                                placeholder="Se completa segun usuario logueado"
                            />
                        </div>

                        <div className="space-y-3 rounded-md border p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-2">
                                    <Label className="text-sm font-semibold">Productos del pedido</Label>
                                    {hasItems ? (
                                        <Badge variant="outline" className="text-xs font-normal">
                                            {totalItemsCount} {totalItemsCount === 1 ? "ítem" : "ítems"} ({totalUnitsCount} u.)
                                        </Badge>
                                    ) : null}
                                </div>
                                {hasItems ? (
                                    <div className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
                                        <Calculator className="h-4 w-4" />
                                        <span className="text-xs uppercase tracking-wide opacity-80">Suma total:</span>
                                        <span className="text-base font-bold">${createOrderTotal.toLocaleString("es-AR")}</span>
                                    </div>
                                ) : null}
                            </div>
                            <Input
                                value={productSearch}
                                onChange={(event) => setProductSearch(event.target.value)}
                                placeholder="Buscar por nombre, SKU o codigo de barras"
                            />
                            {productSearch.trim().length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    Escribe para buscar rapido y agregar productos.
                                </p>
                            ) : null}
                            {productSearch.trim().length > 0 ? (
                                <div className="max-h-52 overflow-y-auto rounded-md border">
                                    {createProductsSearchResults.length === 0 ? (
                                        <p className="px-3 py-2 text-sm text-muted-foreground">
                                            Sin coincidencias para la busqueda.
                                        </p>
                                    ) : (
                                        createProductsSearchResults.map((product) => {
                                            const alreadyAdded = createItems.some((item) => item.product_id === product.id)
                                            return (
                                                <button
                                                    key={product.id}
                                                    type="button"
                                                    className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left hover:bg-muted/30"
                                                    onClick={() => addProductToCreateOrder(product.id)}
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block truncate text-sm font-medium">
                                                            {product.sku} - {product.name}
                                                        </span>
                                                        <span className="block text-xs text-muted-foreground">
                                                            Stock: {Number(product.stock_current ?? 0)}
                                                            {alreadyAdded ? " | Ya agregado" : ""}
                                                        </span>
                                                    </span>
                                                    <Plus className="h-4 w-4 shrink-0" />
                                                </button>
                                            )
                                        })
                                    )}
                                </div>
                            ) : null}

                            {createItems.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Aun no agregaste productos.</p>
                            ) : (
                                <div className="space-y-2">
                                    {createItems.map((item) => {
                                        const product = productById.get(item.product_id)
                                        const availableStock = Number(product?.stock_current ?? 0)
                                        const isOutOfStock = availableStock <= 0
                                        const isInsufficient = !isOutOfStock && Number(item.quantity || 0) > availableStock
                                        return (
                                            <div
                                                key={item.product_id}
                                                className={`grid gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1fr)_120px_130px_auto] transition-colors ${
                                                    isOutOfStock
                                                        ? "border-red-500/80 bg-red-50/60 dark:bg-red-950/30 dark:border-red-700/80"
                                                        : isInsufficient
                                                        ? "border-amber-500/80 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-700/80"
                                                        : ""
                                                }`}
                                            >
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium">
                                                        {product ? `${product.sku} - ${product.name}` : item.product_id}
                                                    </p>
                                                    {isOutOfStock ? (
                                                        <span className="inline-flex items-center gap-1 rounded bg-red-100 dark:bg-red-900/50 px-1.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300">
                                                            <AlertCircle className="h-3 w-3 shrink-0" />
                                                            Stock: 0 (Sin stock disponible - Requiere confirmación en almacén)
                                                        </span>
                                                    ) : isInsufficient ? (
                                                        <span className="inline-flex items-center gap-1 rounded bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                                                            <AlertCircle className="h-3 w-3 shrink-0" />
                                                            Stock insuficiente (Disponible: {availableStock}, Solicitado: {item.quantity})
                                                        </span>
                                                    ) : (
                                                        <p className="text-xs text-muted-foreground">
                                                            Stock disponible: {availableStock}
                                                        </p>
                                                    )}
                                                </div>
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    value={item.quantity}
                                                    onChange={(event) =>
                                                        updateCreateItemQuantity(item.product_id, Number(event.target.value))
                                                    }
                                                />
                                                <div className="flex items-center text-sm font-semibold">
                                                    $
                                                    {(
                                                        Number(product?.sale_price || 0) * Number(item.quantity || 0)
                                                    ).toLocaleString("es-AR")}
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    className="w-full md:w-auto"
                                                    onClick={() => removeCreateItem(item.product_id)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-red-500" />
                                                </Button>
                                            </div>
                                        )
                                    })}

                                    {/* Resumen inferior de suma total de productos */}
                                    <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2.5">
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Calculator className="h-4 w-4 text-primary shrink-0" />
                                            <span>
                                                Total acumulado ({totalUnitsCount} {totalUnitsCount === 1 ? "unidad" : "unidades"} en {totalItemsCount} {totalItemsCount === 1 ? "producto" : "productos"}):
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs uppercase font-medium text-muted-foreground">Suma pedido:</span>
                                            <span className="text-lg font-bold text-foreground">
                                                ${createOrderTotal.toLocaleString("es-AR")}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Medios de pago */}
                        <div className="space-y-3 rounded-md border p-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <Label className="text-sm font-semibold">Medios de pago</Label>
                                    {hasItems ? (
                                        <span className="text-xs text-muted-foreground">
                                            (Total a cubrir: <strong>${createOrderTotal.toLocaleString("es-AR")}</strong>)
                                        </span>
                                    ) : null}
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setCreatePaymentLines((current) => [...current, newPaymentLine("transfer")])}
                                >
                                    <Plus className="mr-1 h-3.5 w-3.5" /> Agregar medio
                                </Button>
                            </div>

                            <div className="space-y-2">
                                {createPaymentLines.map((line) => (
                                    <div key={line.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]">
                                        <Select value={line.method} onValueChange={(method) => updatePaymentLine(line.id, { method })}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {PAYMENT_METHODS.map((method) => (
                                                    <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            type="number"
                                            min="0.01"
                                            step="0.01"
                                            value={line.amount}
                                            onChange={(event) => updatePaymentLine(line.id, { amount: event.target.value })}
                                            placeholder="Importe"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            disabled={createPaymentLines.length === 1}
                                            onClick={() => setCreatePaymentLines((current) => current.filter((item) => item.id !== line.id))}
                                        >
                                            <Trash2 className="h-4 w-4 text-red-500" />
                                        </Button>
                                    </div>
                                ))}
                            </div>

                            {/* Indicador dinámico de balance de pagos */}
                            <div className="space-y-2 pt-1">
                                {hasItems ? (
                                    remainingToAssign > 0.005 ? (
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/60 p-3 text-sm">
                                            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-medium">
                                                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                                                <span>
                                                    Falta asignar: <strong className="text-base font-bold text-amber-700 dark:text-amber-300">${remainingToAssign.toLocaleString("es-AR")}</strong>
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 text-xs border-amber-400 bg-white/80 dark:bg-amber-900/40 hover:bg-amber-100 dark:hover:bg-amber-900/70"
                                                    onClick={assignRemainingToLastLine}
                                                >
                                                    Asignar resto a última línea
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 text-xs border-amber-400 bg-white/80 dark:bg-amber-900/40 hover:bg-amber-100 dark:hover:bg-amber-900/70"
                                                    onClick={assignTotalToSingleLine}
                                                >
                                                    Asignar total al primero
                                                </Button>
                                            </div>
                                        </div>
                                    ) : remainingToAssign < -0.005 ? (
                                        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive font-medium">
                                            <AlertCircle className="h-4 w-4 shrink-0" />
                                            <span>
                                                El monto asignado supera el total del pedido por <strong>${Math.abs(remainingToAssign).toLocaleString("es-AR")}</strong>
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-700/60 p-3 text-sm text-emerald-900 dark:text-emerald-200 font-medium">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                                <span>
                                                    Monto completamente asignado (<strong>$0</strong> pendiente). Total: ${paymentsTotal.toLocaleString("es-AR")}
                                                </span>
                                            </div>
                                            <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-emerald-100/50 dark:bg-emerald-900/30 text-xs">
                                                Listo para crear
                                            </Badge>
                                        </div>
                                    )
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        Agrega productos arriba para calcular el total a pagar y habilitar los pagos.
                                    </p>
                                )}

                                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                                    <span>Total asignado: <strong>${paymentsTotal.toLocaleString("es-AR")}</strong> de ${createOrderTotal.toLocaleString("es-AR")}</span>
                                    {hasItems && Math.abs(remainingToAssign) > 0.01 ? (
                                        <Button
                                            type="button"
                                            variant="link"
                                            size="sm"
                                            className="h-auto p-0 text-xs text-primary"
                                            onClick={assignTotalToSingleLine}
                                        >
                                            Asignar total a un solo medio
                                        </Button>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Metodo logistico</Label>
                                <Select
                                    value={createShippingMethod}
                                    onValueChange={(value) => setCreateShippingMethod(value as ShippingMethod)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="pickup">Retiro en local</SelectItem>
                                        <SelectItem value="delivery">Envio</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Fecha estimada entrega/retiro</Label>
                                <ArgentinaDateInput
                                    value={createEstimatedDelivery}
                                    onChange={setCreateEstimatedDelivery}
                                    ariaLabel="Fecha estimada de entrega o retiro"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Nombre de quien retira/recibe</Label>
                                <Input
                                    value={createRecipientName}
                                    onChange={(event) => setCreateRecipientName(event.target.value)}
                                    placeholder="Nombre completo"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>DNI de quien retira/recibe</Label>
                                <Input
                                    value={createRecipientDni}
                                    onChange={(event) => setCreateRecipientDni(event.target.value)}
                                    placeholder="Opcional"
                                />
                            </div>
                            {createShippingMethod === "delivery" ? (
                                <div className="space-y-2 sm:col-span-2">
                                    <Label>Direccion de entrega</Label>
                                    <Input
                                        value={createShippingAddress}
                                        onChange={(event) => setCreateShippingAddress(event.target.value)}
                                        placeholder="Calle, numero, localidad"
                                    />
                                </div>
                            ) : null}
                            <div className="space-y-2 sm:col-span-2">
                                <Label>Observaciones</Label>
                                <Textarea
                                    value={createNotes}
                                    onChange={(event) => setCreateNotes(event.target.value)}
                                    placeholder="Notas internas, instrucciones, referencia de remito, etc."
                                />
                            </div>
                        </div>

                        <div className="rounded-md border bg-muted/20 p-3 text-right text-sm">
                            Total pedido: <strong>${createOrderTotal.toLocaleString("es-AR")}</strong>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 border-t pt-3">
                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end w-full">
                                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                                    Cancelar
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={!canSubmit}
                                    title={
                                        !hasItems
                                            ? "Debes agregar al menos un producto"
                                            : !isPaymentBalanced
                                            ? remainingToAssign > 0
                                                ? `Falta asignar $${remainingToAssign.toLocaleString("es-AR")} en medios de pago`
                                                : `El monto asignado supera el total por $${Math.abs(remainingToAssign).toLocaleString("es-AR")}`
                                            : undefined
                                    }
                                >
                                    {createOrderMutation.isPending ? "Creando..." : "Crear"}
                                </Button>
                            </div>
                            {!canSubmit && hasItems && !createOrderMutation.isPending ? (
                                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium text-right">
                                    {remainingToAssign > 0
                                        ? `* Falta asignar $${remainingToAssign.toLocaleString("es-AR")} en medios de pago para poder crear el pedido`
                                        : remainingToAssign < 0
                                        ? `* El importe asignado excede el total del pedido por $${Math.abs(remainingToAssign).toLocaleString("es-AR")}`
                                        : createPaymentLines.some((l) => Number(l.amount || 0) <= 0)
                                        ? "* Todos los medios de pago deben tener un importe mayor a cero"
                                        : ""}
                                </p>
                            ) : null}
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            <QuickClientDialog
                open={clientDialogOpen}
                onOpenChange={setClientDialogOpen}
                newClient={newClient}
                onNewClientChange={(patch) => setNewClient((current) => ({ ...current, ...patch }))}
                creatingClient={creatingClient}
                onCreateClient={() => {
                    void createQuickClient()
                }}
            />
        </>
    )
}
