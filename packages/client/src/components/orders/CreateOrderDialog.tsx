import { useState, useEffect, useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { QuickClientDialog } from "@/components/pos/QuickClientDialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
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

export function CreateOrderDialog({ open, onOpenChange, clients, products, currentUser }: CreateOrderDialogProps) {
    const queryClient = useQueryClient()

    // Form states
    const [createClientId, setCreateClientId] = useState("")
    const [createCounterName, setCreateCounterName] = useState("")
    const [createPaymentMethod, setCreatePaymentMethod] = useState("cash")
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

    useEffect(() => {
        if (!open) return
        setCreateCounterName(currentUser?.name || "")
    }, [open, currentUser?.name])

    function resetCreateForm() {
        setCreateClientId("")
        setCreateCounterName(currentUser?.name || "")
        setCreatePaymentMethod("cash")
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
        if (createPaymentMethod === "credit_account" && !createClientId) {
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

        try {
            const payload: Parameters<typeof api.createOrder>[0] = {
                customer_name: selectedCreateClient?.name || "Consumidor final",
                counter_name: createCounterName || currentUser?.name || "",
                payment_method: createPaymentMethod,
                shipping_method: createShippingMethod,
                estimated_delivery: createEstimatedDelivery,
                shipping_address: createShippingMethod === "delivery" ? createShippingAddress : "",
                recipient_name: createRecipientName,
                recipient_dni: createRecipientDni,
                notes: createNotes,
                items: createItems.map((item) => ({
                    product_id: item.product_id,
                    quantity: Number(item.quantity || 1),
                })),
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
                            <Label>Productos del pedido</Label>
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
                                        return (
                                            <div
                                                key={item.product_id}
                                                className="grid gap-2 rounded-md border p-2 md:grid-cols-[minmax(0,1fr)_120px_130px_auto]"
                                            >
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium">
                                                        {product ? `${product.sku} - ${product.name}` : item.product_id}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Stock disponible: {Number(product?.stock_current ?? 0)}
                                                    </p>
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
                                </div>
                            )}
                        </div>

                        <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Metodo de pago</Label>
                                <Select value={createPaymentMethod} onValueChange={setCreatePaymentMethod}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PAYMENT_METHODS.map((method) => (
                                            <SelectItem key={method.value} value={method.value}>
                                                {method.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
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
                                <Input
                                    type="date"
                                    value={createEstimatedDelivery}
                                    onChange={(event) => setCreateEstimatedDelivery(event.target.value)}
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
                        <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" disabled={createOrderMutation.isPending}>
                                {createOrderMutation.isPending ? "Creando..." : "Crear"}
                            </Button>
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
