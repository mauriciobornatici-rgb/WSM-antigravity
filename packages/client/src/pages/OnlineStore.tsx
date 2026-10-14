import { lazy, Suspense, useDeferredValue, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useSearchParams } from "react-router-dom"
import {
    AlertTriangle, BarChart3, Boxes, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
    CircleDollarSign, CloudDownload, ExternalLink, Loader2, PackageCheck, PackagePlus,
    RefreshCw, Search, Settings, ShoppingBag, Store, Truck, Users,
} from "lucide-react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { toast } from "sonner"
import { hasPermission, PERMISSIONS } from "@wsm/common"
import { api } from "@/services/api"
import { formatMoney } from "@/lib/formatters"
import { grossPrice, netFromGross } from "@/lib/pricing"
import { useAuth } from "@/context/AuthContext"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type {
    OnlineCatalogFamily, OnlineCustomer, OnlineFulfillment, OnlineOrder, OnlineProductDraft,
    OnlineStoreAnalytics, OnlineStoreOverview, OnlineSyncCenter, OnlineVisibility,
} from "@/types/onlineStore"

const PAGE_SIZE = 20
const ONLINE_STORE_TABS = new Set(["overview", "catalog", "orders", "fulfillments", "customers", "sync", "analytics", "connection"])
const TiendanubeConnectionTab = lazy(() => import("@/components/online-store/TiendanubeConnectionTab"))
const EMPTY_VARIANT = { sku: "", barcode: "", size: "", color: "", sale_price: 0, purchase_price: 0, stock_initial: 0, image_url: "" }
const DEFAULT_DRAFT: OnlineProductDraft = {
    name: "", description: "", brand: "", category: "", visibility: "hidden", publish: false,
    variants: [{ ...EMPTY_VARIANT }],
}

function money(value: unknown) {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(value || 0))
}

function localDate(value?: string | null) {
    if (!value) return "—"
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })
}

function asObject(value: unknown): Record<string, string | number | boolean | null | undefined> {
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, string | number | boolean | null | undefined>
    if (typeof value !== "string") return {}
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, string | number | boolean | null | undefined>
            : {}
    } catch {
        return {}
    }
}

function addressText(value: unknown, fallback?: string | null) {
    const address = asObject(value)
    const province = asObject(address.province)
    const country = asObject(address.country)
    return [address.address || address.street, address.number, address.floor, address.locality, address.city, province.name, address.zipcode, country.name]
        .filter(Boolean).join(", ") || fallback || "Sin dirección informada"
}

function StatusPill({ value }: { value: string | null | undefined }) {
    const normalized = String(value || "sin estado").toLowerCase()
    const positive = ["synced", "paid", "delivered", "visible", "completed", "processed"].includes(normalized)
    const attention = ["error", "failed", "cancelled", "conflict", "voided"].includes(normalized)
    const labels: Record<string, string> = {
        synced: "Sincronizado", local_only: "Borrador local", pending: "Pendiente", error: "Error",
        conflict: "Conflicto", visible: "Visible", unlisted: "Sólo con enlace", hidden: "Oculto",
        paid: "Pagado", unpaid: "No pagado", pending_payment: "Pago pendiente", unpacked: "Sin preparar",
        packed: "Preparado", dispatched: "Despachado", delivered: "Entregado", processed: "Procesado",
    }
    return (
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${positive
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : attention ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
            {labels[normalized] || normalized.replaceAll("_", " ")}
        </span>
    )
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
    if (totalPages <= 1) return null
    return (
        <div className="flex items-center justify-end gap-2 pt-4">
            <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
            <Button variant="outline" size="icon" aria-label="Página anterior" disabled={page <= 1} onClick={() => onChange(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Página siguiente" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
                <ChevronRight className="h-4 w-4" />
            </Button>
        </div>
    )
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof Store; title: string; detail: string }) {
    return (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center">
            <Icon className="h-9 w-9 text-muted-foreground" />
            <div><p className="font-semibold">{title}</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">{detail}</p></div>
        </div>
    )
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
    return (
        <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="pl-9" />
        </div>
    )
}

function ProductDialog({ open, connected, saving, onClose, onSave }: {
    open: boolean; connected: boolean; saving: boolean; onClose: () => void; onSave: (draft: OnlineProductDraft) => void
}) {
    const [draft, setDraft] = useState<OnlineProductDraft>(DEFAULT_DRAFT)
    const close = () => { setDraft(DEFAULT_DRAFT); onClose() }
    const setVariant = (index: number, key: keyof OnlineProductDraft["variants"][number], value: string | number) => {
        setDraft((current) => ({
            ...current,
            variants: current.variants.map((variant, variantIndex) => variantIndex === index ? { ...variant, [key]: value } : variant),
        }))
    }
    const valid = draft.name.trim() && draft.variants.every((variant) => variant.sku.trim() && Number(variant.sale_price) >= 0)

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
            <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                <DialogHeader><DialogTitle>Nuevo producto para Tienda online</DialogTitle><DialogDescription>Creá la familia comercial y al menos una variante con SKU propio.</DialogDescription></DialogHeader>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2"><Label htmlFor="online-name">Nombre de la familia</Label><Input id="online-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Ej. Camiseta titular 2026" /></div>
                    <div className="space-y-2"><Label htmlFor="online-brand">Marca</Label><Input id="online-brand" value={draft.brand || ""} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} /></div>
                    <div className="space-y-2"><Label htmlFor="online-category">Categoría</Label><Input id="online-category" value={draft.category || ""} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></div>
                    <div className="space-y-2 sm:col-span-2"><Label htmlFor="online-description">Descripción</Label><textarea id="online-description" className="min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
                    <div className="space-y-2"><Label htmlFor="online-visibility">Visibilidad</Label><select id="online-visibility" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as OnlineVisibility })}><option value="hidden">Oculto (recomendado al crear)</option><option value="unlisted">Sólo con enlace</option><option value="visible">Visible</option></select></div>
                </div>
                <div className="space-y-3">
                    <div className="flex items-center justify-between"><div><h3 className="font-semibold">Variantes / SKU</h3><p className="text-xs text-muted-foreground">Cada talle y color conserva stock y precio propios.</p></div><Button type="button" variant="outline" size="sm" onClick={() => setDraft((current) => ({ ...current, variants: [...current.variants, { ...EMPTY_VARIANT }] }))}><PackagePlus className="mr-2 h-4 w-4" />Agregar variante</Button></div>
                    {draft.variants.map((variant, index) => (
                        <fieldset key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-7">
                            <legend className="sr-only">Variante {index + 1}</legend>
                            <div className="space-y-1 sm:col-span-2"><Label htmlFor={`online-variant-${index}-sku`}>SKU *</Label><Input id={`online-variant-${index}-sku`} value={variant.sku} onChange={(e) => setVariant(index, "sku", e.target.value)} /></div>
                            <div className="space-y-1"><Label htmlFor={`online-variant-${index}-size`}>Talle</Label><Input id={`online-variant-${index}-size`} value={variant.size || ""} onChange={(e) => setVariant(index, "size", e.target.value)} /></div>
                            <div className="space-y-1"><Label htmlFor={`online-variant-${index}-color`}>Color</Label><Input id={`online-variant-${index}-color`} value={variant.color || ""} onChange={(e) => setVariant(index, "color", e.target.value)} /></div>
                            <div className="space-y-1"><Label htmlFor={`online-variant-${index}-sale-price`}>Precio de venta final (IVA incl.)</Label><Input id={`online-variant-${index}-sale-price`} type="number" min="0" value={variant.sale_price} onChange={(e) => setVariant(index, "sale_price", Number(e.target.value))} /><p className="text-xs text-muted-foreground">Neto: {formatMoney(netFromGross(variant.sale_price))}</p></div>
                            <div className="space-y-1"><Label htmlFor={`online-variant-${index}-purchase-price`}>Costo neto (s/IVA)</Label><Input id={`online-variant-${index}-purchase-price`} type="number" min="0" value={variant.purchase_price} onChange={(e) => setVariant(index, "purchase_price", Number(e.target.value))} /><p className="text-xs text-muted-foreground">Final c/IVA: {formatMoney(grossPrice(variant.purchase_price))}</p></div>
                            <div className="space-y-1"><Label htmlFor={`online-variant-${index}-stock`}>Stock inicial</Label><Input id={`online-variant-${index}-stock`} type="number" min="0" step="1" value={variant.stock_initial} onChange={(e) => setVariant(index, "stock_initial", Number(e.target.value))} /></div>
                            {draft.variants.length > 1 && <Button type="button" variant="ghost" size="sm" className="sm:col-span-7 justify-self-end text-red-600" onClick={() => setDraft((current) => ({ ...current, variants: current.variants.filter((_, variantIndex) => variantIndex !== index) }))}>Quitar variante</Button>}
                        </fieldset>
                    ))}
                </div>
                <label htmlFor="online-publish" aria-label="Publicar en Tiendanube al guardar" className={`flex items-start gap-3 rounded-lg border p-3 ${connected ? "cursor-pointer" : "opacity-60"}`}><input type="checkbox" id="online-publish" className="mt-1" checked={draft.publish} disabled={!connected} onChange={(e) => setDraft({ ...draft, publish: e.target.checked })} /><span><span className="block text-sm font-medium">Publicar en Tiendanube al guardar</span><span className="block text-xs text-muted-foreground">Si queda desmarcado se conserva como borrador local. {connected ? "" : "Conectá la tienda para habilitar la publicación."}</span></span></label>
                <DialogFooter><Button variant="outline" onClick={close}>Cancelar</Button><Button disabled={!valid || saving} onClick={() => onSave({ ...draft, variants: draft.variants.map((variant) => ({ ...variant, sale_price: netFromGross(variant.sale_price) })) })}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar producto</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function FulfillmentDialog({ fulfillment, saving, onClose, onSave }: {
    fulfillment: OnlineFulfillment | null; saving: boolean; onClose: () => void;
    onSave: (value: { status?: string; tracking_code?: string; tracking_url?: string; notify_customer: boolean }) => void
}) {
    const tracking = asObject(fulfillment?.tracking_info)
    const [status, setStatus] = useState(fulfillment?.status || "PACKED")
    const [code, setCode] = useState(String(tracking.code || fulfillment?.tracking_number || ""))
    const [url, setUrl] = useState(String(tracking.url || ""))
    if (!fulfillment) return null
    return (
        <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
            <DialogContent>
                <DialogHeader><DialogTitle>Actualizar envío #{fulfillment.number || fulfillment.external_number || fulfillment.external_order_id}</DialogTitle><DialogDescription>Registrá el estado operativo y los datos de seguimiento del paquete.</DialogDescription></DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2"><Label htmlFor="fulfillment-status">Estado</Label><select id="fulfillment-status" className="h-10 w-full rounded-md border bg-background px-3" value={status} onChange={(e) => setStatus(e.target.value)}><option value="UNPACKED">Sin preparar</option><option value="PACKED">Preparado</option><option value="DISPATCHED">Despachado</option><option value="READY_FOR_PICKUP">Listo para retirar</option><option value="DELIVERED">Entregado</option></select></div>
                    <div className="space-y-2"><Label htmlFor="tracking-code">Código de seguimiento</Label><Input id="tracking-code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
                    <div className="space-y-2"><Label htmlFor="tracking-url">URL de seguimiento</Label><Input id="tracking-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></div>
                    <p className="text-xs text-muted-foreground">El cambio se envía a Tiendanube y se notifica al comprador. La transición debe respetar el flujo permitido por el tipo de entrega.</p>
                </div>
                <DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={saving} onClick={() => onSave({ status, ...(code ? { tracking_code: code } : {}), ...(url ? { tracking_url: url } : {}), notify_customer: true })}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Actualizar</Button></DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function MetricCard({ title, value, detail, icon: Icon }: { title: string; value: string | number; detail: string; icon: typeof Store }) {
    return <Card><CardContent className="flex items-start justify-between p-5"><div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div><div className="rounded-lg bg-blue-500/10 p-2.5 text-blue-600"><Icon className="h-5 w-5" /></div></CardContent></Card>
}

function OverviewTab({ overview }: { overview: OnlineStoreOverview | undefined }) {
    return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard title="Ventas últimos 30 días" value={money(overview?.revenue30d)} detail={`${overview?.orders?.orders || 0} pedidos históricos`} icon={CircleDollarSign} /><MetricCard title="Catálogo" value={overview?.catalog?.families || 0} detail={`${overview?.catalog?.visible || 0} visibles · ${overview?.catalog?.synced || 0} sincronizados`} icon={Boxes} /><MetricCard title="A preparar" value={overview?.orders?.awaiting_fulfillment || 0} detail={`${overview?.orders?.paid || 0} pedidos pagados`} icon={PackageCheck} /><MetricCard title="Requieren atención" value={(Number(overview?.catalog?.attention || 0) + Number(overview?.synchronization?.failed_stock || 0) + Number(overview?.synchronization?.pending_events || 0))} detail="Catálogo, stock y eventos" icon={AlertTriangle} /></div><Card><CardHeader><CardTitle>Flujo operativo recomendado</CardTitle><CardDescription>Una vista corta para que el equipo no tenga que trabajar desde Configuración.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-4">{[["1", "Catálogo", "Crear o importar familias y variantes"], ["2", "Pedidos", "Validar pago, comprador y domicilio"], ["3", "Envíos", "Preparar, despachar y registrar tracking"], ["4", "Análisis", "Revisar ventas, productos y clientes"]].map(([step, title, detail]) => <div key={step} className="rounded-lg border p-4"><span className="text-xs font-bold text-blue-600">PASO {step}</span><p className="mt-2 font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div>)}</CardContent></Card></div>
}

function CatalogTab({ rows, loading, connected, canManage, page, totalPages, search, onSearch, onPage, onNew, onPublish, onArchive, onImport, busyId, importing }: {
    rows: OnlineCatalogFamily[]; loading: boolean; connected: boolean; canManage: boolean; page: number; totalPages: number; search: string;
    onSearch: (value: string) => void; onPage: (value: number) => void; onNew: () => void; onPublish: (id: string) => void;
    onArchive: (id: string) => void; onImport: () => void; busyId?: string | null; importing: boolean
}) {
    return <Card><CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between"><div><CardTitle>Catálogo y variantes</CardTitle><CardDescription>Búsqueda paginada por nombre, marca, categoría o SKU. El stock se toma del WMS local.</CardDescription></div><div className="flex flex-wrap gap-2">{canManage && <Button variant="outline" disabled={!connected || importing} onClick={onImport}>{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-2 h-4 w-4" />}Importar de Tiendanube</Button>}{canManage && <Button onClick={onNew}><PackagePlus className="mr-2 h-4 w-4" />Nuevo producto</Button>}</div></CardHeader><CardContent><SearchField value={search} onChange={onSearch} placeholder="Buscar nombre, marca, categoría o SKU…" /><div className="mt-4 overflow-x-auto rounded-md border"><Table className="min-w-[980px]"><TableHeader><TableRow><TableHead>Producto</TableHead><TableHead>Variantes</TableHead><TableHead>Stock</TableHead><TableHead>Visibilidad</TableHead><TableHead>Sincronización</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={6} className="h-40 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={6}><EmptyState icon={Boxes} title="Todavía no hay productos en la Tienda online" detail="Creá una familia con sus talles/colores o conectá Tiendanube e importá el catálogo existente." /></TableCell></TableRow> : rows.map((family) => <TableRow key={family.id} className="align-top"><TableCell><p className="font-semibold">{family.name}</p><p className="text-xs text-muted-foreground">{[family.brand, family.category].filter(Boolean).join(" · ") || "Sin marca/categoría"}</p>{family.remote_product_id && <p className="mt-1 text-[11px] text-muted-foreground">TN #{family.remote_product_id}</p>}</TableCell><TableCell><details><summary className="cursor-pointer list-none text-sm font-medium"><span className="inline-flex items-center gap-1">{family.variants.length} SKU <ChevronDown className="h-3.5 w-3.5" /></span></summary><div className="mt-2 space-y-1">{family.variants.map((variant) => <p key={variant.id} className="text-xs"><span className="font-mono">{variant.sku}</span> · {[variant.size, variant.color].filter(Boolean).join("/") || "Única"} · {money(grossPrice(variant.sale_price))} · {variant.stock} u.</p>)}</div></details></TableCell><TableCell className={family.total_stock <= 0 ? "font-bold text-red-600" : "font-semibold"}>{family.total_stock}</TableCell><TableCell><StatusPill value={family.visibility} /></TableCell><TableCell><StatusPill value={family.sync_status} />{family.last_error && <p className="mt-1 max-w-48 truncate text-xs text-red-600" title={family.last_error}>{family.last_error}</p>}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-2">{canManage && <Button size="sm" variant="outline" disabled={!connected || busyId === family.id} onClick={() => onPublish(family.id)}>{busyId === family.id && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{family.remote_product_id ? "Sincronizar" : "Publicar"}</Button>}{canManage && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => onArchive(family.id)}>Dar de baja</Button>}</div></TableCell></TableRow>)}</TableBody></Table></div><Pagination page={page} totalPages={totalPages} onChange={onPage} /></CardContent></Card>
}

function OrdersTab({ rows, loading, search, onSearch, page, totalPages, onPage }: { rows: OnlineOrder[]; loading: boolean; search: string; onSearch: (value: string) => void; page: number; totalPages: number; onPage: (page: number) => void }) {
    return <Card><CardHeader><CardTitle>Pedidos y compradores</CardTitle><CardDescription>Quién compró, cómo pagó, qué pidió y dónde debe entregarse.</CardDescription></CardHeader><CardContent><SearchField value={search} onChange={onSearch} placeholder="Buscar pedido, cliente, email o teléfono…" /><div className="mt-4 overflow-x-auto rounded-md border"><Table className="min-w-[1120px]"><TableHeader><TableRow><TableHead>Pedido</TableHead><TableHead>Comprador</TableHead><TableHead>Entrega</TableHead><TableHead>Ítems</TableHead><TableHead>Pago</TableHead><TableHead>Envío</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={7} className="h-40 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={7}><EmptyState icon={ShoppingBag} title="No hay pedidos importados" detail="Conectá la tienda y ejecutá Sincronizar pedidos desde el Centro de sincronización." /></TableCell></TableRow> : rows.map((order) => <TableRow key={order.id} className="align-top"><TableCell><p className="font-semibold">#{order.external_number || order.external_id}</p><p className="text-xs text-muted-foreground">{localDate(order.created_at)}</p></TableCell><TableCell><p className="font-medium">{order.customer_name || "Cliente Tiendanube"}</p><p className="text-xs text-muted-foreground">{order.contact_email || "Sin email"}</p><p className="text-xs text-muted-foreground">{order.contact_phone || "Sin teléfono"}{order.contact_identification ? ` · DNI ${order.contact_identification}` : ""}</p></TableCell><TableCell className="max-w-72 whitespace-normal text-sm">{addressText(order.shipping_address_json, order.shipping_address)}{order.tracking_number && <p className="mt-1 font-mono text-xs">Tracking: {order.tracking_number}</p>}</TableCell><TableCell>{order.item_units} u. / {order.item_lines} líneas</TableCell><TableCell><StatusPill value={order.remote_payment_status} /><p className="mt-1 text-xs text-muted-foreground">{order.gateway_name || "—"}</p></TableCell><TableCell><StatusPill value={order.remote_shipping_status} /><p className="mt-1 text-xs text-muted-foreground">{order.fulfillment_count} paquete(s)</p></TableCell><TableCell className="text-right font-bold">{money(order.total_amount)}</TableCell></TableRow>)}</TableBody></Table></div><Pagination page={page} totalPages={totalPages} onChange={onPage} /></CardContent></Card>
}

function FulfillmentsTab({ rows, loading, search, onSearch, page, totalPages, onPage, canDispatch, onEdit, onSync, syncing }: { rows: OnlineFulfillment[]; loading: boolean; search: string; onSearch: (value: string) => void; page: number; totalPages: number; onPage: (page: number) => void; canDispatch: boolean; onEdit: (row: OnlineFulfillment) => void; onSync: () => void; syncing: boolean }) {
    return <Card><CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Envíos y seguimiento</CardTitle><CardDescription>Un pedido puede tener varios paquetes; cada uno mantiene destinatario, domicilio, estado y tracking.</CardDescription></div>{canDispatch && <Button variant="outline" disabled={syncing} onClick={onSync}>{syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Actualizar envíos</Button>}</CardHeader><CardContent><SearchField value={search} onChange={onSearch} placeholder="Buscar envío, pedido, cliente o tracking…" /><div className="mt-4 overflow-x-auto rounded-md border"><Table className="min-w-[1050px]"><TableHeader><TableRow><TableHead>Envío</TableHead><TableHead>Destinatario</TableHead><TableHead>Destino</TableHead><TableHead>Estado</TableHead><TableHead>Seguimiento</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={6} className="h-40 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={6}><EmptyState icon={Truck} title="No hay paquetes sincronizados" detail="Importá pedidos y presioná “Actualizar envíos”. Tiendanube informará cada fulfillment por separado." /></TableCell></TableRow> : rows.map((row) => { const recipient = asObject(row.recipient); const tracking = asObject(row.tracking_info); return <TableRow key={row.id} className="align-top"><TableCell><p className="font-semibold">#{row.number || row.external_number || row.external_order_id}</p><p className="text-xs text-muted-foreground">{row.id}</p></TableCell><TableCell><p className="font-medium">{String(recipient.name || row.customer_name || "—")}</p><p className="text-xs text-muted-foreground">{String(recipient.phone || row.contact_phone || "Sin teléfono")}</p><p className="text-xs text-muted-foreground">{String(recipient.email || row.contact_email || "Sin email")}</p></TableCell><TableCell className="max-w-72 whitespace-normal text-sm">{addressText(row.destination, row.local_shipping_address)}</TableCell><TableCell><StatusPill value={row.status} /></TableCell><TableCell><p className="font-mono text-sm">{String(tracking.code || row.tracking_number || "Sin código")}</p>{tracking.url && <a className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline" href={String(tracking.url)} target="_blank" rel="noreferrer">Abrir seguimiento <ExternalLink className="h-3 w-3" /></a>}</TableCell><TableCell className="text-right">{canDispatch && <Button size="sm" variant="outline" onClick={() => onEdit(row)}>Actualizar</Button>}</TableCell></TableRow> })}</TableBody></Table></div><Pagination page={page} totalPages={totalPages} onChange={onPage} /></CardContent></Card>
}

function CustomersTab({ rows, loading, search, onSearch, page, totalPages, onPage }: { rows: OnlineCustomer[]; loading: boolean; search: string; onSearch: (value: string) => void; page: number; totalPages: number; onPage: (page: number) => void }) {
    return <Card><CardHeader><CardTitle>Clientes de Tiendanube</CardTitle><CardDescription>Datos de contacto, recurrencia y facturación acumulada del canal.</CardDescription></CardHeader><CardContent><SearchField value={search} onChange={onSearch} placeholder="Buscar nombre, email, teléfono o documento…" /><div className="mt-4 overflow-x-auto rounded-md border"><Table className="min-w-[850px]"><TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead>Contacto</TableHead><TableHead>Documento</TableHead><TableHead>Pedidos</TableHead><TableHead>Facturación</TableHead><TableHead>Última actualización</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={6} className="h-40 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></TableCell></TableRow> : rows.length === 0 ? <TableRow><TableCell colSpan={6}><EmptyState icon={Users} title="No hay clientes sincronizados" detail="Los clientes se incorporan automáticamente junto con cada pedido, respetando los scopes autorizados por Tiendanube." /></TableCell></TableRow> : rows.map((customer) => <TableRow key={customer.external_id}><TableCell><p className="font-semibold">{customer.name}</p><p className="text-xs text-muted-foreground">TN #{customer.external_id}</p></TableCell><TableCell><p>{customer.email || "Sin email"}</p><p className="text-xs text-muted-foreground">{customer.phone || "Sin teléfono"}</p></TableCell><TableCell>{customer.identification || "—"}</TableCell><TableCell>{customer.actual_orders_count}</TableCell><TableCell className="font-semibold">{money(customer.actual_total_spent)}</TableCell><TableCell>{localDate(customer.last_synced_at)}</TableCell></TableRow>)}</TableBody></Table></div><Pagination page={page} totalPages={totalPages} onChange={onPage} /></CardContent></Card>
}

function AnalyticsTab({ data }: { data: OnlineStoreAnalytics | undefined }) {
    return <div className="grid gap-5 xl:grid-cols-3"><Card className="xl:col-span-2"><CardHeader><CardTitle>Ventas del canal · 90 días</CardTitle><CardDescription>Facturación y cantidad de pedidos importados desde Tiendanube.</CardDescription></CardHeader><CardContent className="h-80">{data?.daily?.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.daily}><defs><linearGradient id="onlineRevenue" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2563eb" stopOpacity={0.35}/><stop offset="95%" stopColor="#2563eb" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" opacity={0.2}/><XAxis dataKey="date" tickFormatter={(value) => new Date(`${value}T00:00:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}/><YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`}/><Tooltip formatter={(value) => money(value)}/><Area type="monotone" dataKey="revenue" stroke="#2563eb" fill="url(#onlineRevenue)" strokeWidth={2}/></AreaChart></ResponsiveContainer> : <EmptyState icon={BarChart3} title="Todavía no hay ventas para graficar" detail="El análisis se completa automáticamente al importar pedidos." />}</CardContent></Card><Card><CardHeader><CardTitle>Estados de pago</CardTitle></CardHeader><CardContent className="space-y-3">{data?.paymentStates?.length ? data.paymentStates.map((state) => <div key={state.state} className="flex items-center justify-between rounded-md border p-3"><StatusPill value={state.state} /><span className="font-bold">{state.total}</span></div>) : <p className="text-sm text-muted-foreground">Sin datos.</p>}</CardContent></Card><Card><CardHeader><CardTitle>Productos más vendidos</CardTitle></CardHeader><CardContent className="space-y-3">{data?.topProducts?.map((product, index) => <div key={product.sku} className="flex items-start justify-between gap-3"><div><p className="font-medium">{index + 1}. {product.name}</p><p className="text-xs text-muted-foreground">{product.sku} · {[product.size, product.color].filter(Boolean).join("/") || "Única"}</p></div><div className="text-right"><p className="font-bold">{product.units} u.</p><p className="text-xs text-muted-foreground">{money(product.revenue)}</p></div></div>) || <p className="text-sm text-muted-foreground">Sin datos.</p>}</CardContent></Card><Card className="xl:col-span-2"><CardHeader><CardTitle>Clientes con mayor facturación</CardTitle></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2">{data?.topCustomers?.map((customer, index) => <div key={customer.external_id} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-medium">{index + 1}. {customer.name}</p><p className="text-xs text-muted-foreground">{customer.email || "Sin email"} · {customer.orders} pedidos</p></div><p className="font-bold">{money(customer.revenue)}</p></div>) || <p className="text-sm text-muted-foreground">Sin datos.</p>}</div></CardContent></Card></div>
}

function SyncTab({ data, connected, canManage, syncingOrders, onSyncOrders, onRetryAll }: { data: OnlineSyncCenter | undefined; connected: boolean; canManage: boolean; syncingOrders: boolean; onSyncOrders: () => void; onRetryAll: () => void }) {
    return <div className="space-y-5"><Card><CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Centro de sincronización</CardTitle><CardDescription>Procesos manuales, webhooks y errores recuperables en un solo lugar.</CardDescription></div><div className="flex gap-2">{canManage && <Button disabled={!connected || syncingOrders} onClick={onSyncOrders}>{syncingOrders ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Sincronizar pedidos</Button>}{canManage && Boolean(data?.failedStock?.length) && <Button variant="outline" onClick={onRetryAll}>Reintentar stock</Button>}</div></CardHeader></Card><div className="grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle>Últimos procesos</CardTitle></CardHeader><CardContent className="space-y-2">{data?.runs?.length ? data.runs.map((run) => <div key={run.id} className="flex items-center justify-between rounded-md border p-3"><div><p className="font-medium">{run.operation.replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{localDate(run.created_at)}</p></div><StatusPill value={run.status} /></div>) : <p className="text-sm text-muted-foreground">No hay ejecuciones registradas.</p>}</CardContent></Card><Card><CardHeader><CardTitle>Eventos recientes</CardTitle></CardHeader><CardContent className="max-h-96 space-y-2 overflow-y-auto">{data?.events?.length ? data.events.map((event) => <div key={event.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate font-medium">{event.event}</p><p className="truncate text-xs text-muted-foreground">Recurso {event.resource_id} · {localDate(event.created_at)}</p></div><StatusPill value={event.status} /></div>) : <p className="text-sm text-muted-foreground">No hay eventos registrados.</p>}</CardContent></Card></div>{Boolean(data?.failedStock?.length) && <Card><CardHeader><CardTitle className="text-red-600">Stock pendiente de sincronizar</CardTitle></CardHeader><CardContent className="space-y-2">{data?.failedStock.map((failure) => <div key={failure.id} className="rounded-md border border-red-500/30 p-3"><div className="flex items-center justify-between"><p className="font-medium">{String(failure.product_name || "Producto")}</p><StatusPill value={failure.status} /></div><p className="mt-1 text-xs text-red-600">{String(failure.last_error || "Error sin detalle")}</p></div>)}</CardContent></Card>}</div>
}

export default function OnlineStorePage() {
    const { user } = useAuth()
    const queryClient = useQueryClient()
    const [searchParams, setSearchParams] = useSearchParams()
    const canManage = hasPermission(user?.role, PERMISSIONS.ONLINE_STORE_MANAGE)
    const canDispatch = hasPermission(user?.role, PERMISSIONS.ORDERS_DISPATCH)
    const canConfigure = hasPermission(user?.role, PERMISSIONS.INTEGRATIONS_MANAGE)
    const requestedTab = searchParams.get("tab") || "overview"
    const activeTab = ONLINE_STORE_TABS.has(requestedTab) && (requestedTab !== "connection" || canConfigure) ? requestedTab : "overview"
    const setActiveTab = (tab: string) => {
        const nextParams = new URLSearchParams(searchParams)
        if (tab === "overview") nextParams.delete("tab")
        else nextParams.set("tab", tab)
        setSearchParams(nextParams, { replace: true })
    }
    const [catalogSearch, setCatalogSearch] = useState("")
    const [ordersSearch, setOrdersSearch] = useState("")
    const [customersSearch, setCustomersSearch] = useState("")
    const [fulfillmentSearch, setFulfillmentSearch] = useState("")
    const deferredCatalogSearch = useDeferredValue(catalogSearch)
    const deferredOrdersSearch = useDeferredValue(ordersSearch)
    const deferredCustomersSearch = useDeferredValue(customersSearch)
    const deferredFulfillmentSearch = useDeferredValue(fulfillmentSearch)
    const [catalogPage, setCatalogPage] = useState(1)
    const [ordersPage, setOrdersPage] = useState(1)
    const [customersPage, setCustomersPage] = useState(1)
    const [fulfillmentPage, setFulfillmentPage] = useState(1)
    const [productDialogOpen, setProductDialogOpen] = useState(false)
    const [selectedFulfillment, setSelectedFulfillment] = useState<OnlineFulfillment | null>(null)
    const [busyProductId, setBusyProductId] = useState<string | null>(null)

    const overviewQuery = useQuery({ queryKey: ["online-store", "overview"], queryFn: api.getOnlineStoreOverview })
    const statusQuery = useQuery({ queryKey: ["tiendanube-status"], queryFn: api.getTiendanubeStatus })
    const catalogQuery = useQuery({ queryKey: ["online-store", "catalog", catalogPage, deferredCatalogSearch], queryFn: () => api.getOnlineCatalog({ page: catalogPage, limit: PAGE_SIZE, ...(deferredCatalogSearch ? { q: deferredCatalogSearch } : {}) }), enabled: activeTab === "catalog" })
    const ordersQuery = useQuery({ queryKey: ["online-store", "orders", ordersPage, deferredOrdersSearch], queryFn: () => api.getOnlineOrders({ page: ordersPage, limit: PAGE_SIZE, ...(deferredOrdersSearch ? { q: deferredOrdersSearch } : {}) }), enabled: activeTab === "orders" })
    const customersQuery = useQuery({ queryKey: ["online-store", "customers", customersPage, deferredCustomersSearch], queryFn: () => api.getOnlineCustomers({ page: customersPage, limit: PAGE_SIZE, ...(deferredCustomersSearch ? { q: deferredCustomersSearch } : {}) }), enabled: activeTab === "customers" })
    const fulfillmentQuery = useQuery({ queryKey: ["online-store", "fulfillments", fulfillmentPage, deferredFulfillmentSearch], queryFn: () => api.getOnlineFulfillments({ page: fulfillmentPage, limit: PAGE_SIZE, ...(deferredFulfillmentSearch ? { q: deferredFulfillmentSearch } : {}) }), enabled: activeTab === "fulfillments" })
    const analyticsQuery = useQuery({ queryKey: ["online-store", "analytics"], queryFn: api.getOnlineStoreAnalytics, enabled: activeTab === "analytics" })
    const syncQuery = useQuery({ queryKey: ["online-store", "sync-center"], queryFn: api.getOnlineSyncCenter, enabled: activeTab === "sync" })
    const connected = Boolean(statusQuery.data?.connected || overviewQuery.data?.connected)

    const invalidateOnlineStore = async () => {
        await queryClient.invalidateQueries({ queryKey: ["online-store"] })
    }
    const createMutation = useMutation({ mutationFn: api.createOnlineProduct, onSuccess: async () => { toast.success("Producto creado"); setProductDialogOpen(false); await invalidateOnlineStore() } })
    const publishMutation = useMutation({ mutationFn: api.publishOnlineProduct, onSuccess: async () => { toast.success("Producto sincronizado con Tiendanube"); await invalidateOnlineStore() }, onSettled: () => setBusyProductId(null) })
    const archiveMutation = useMutation({ mutationFn: api.archiveOnlineProduct, onSuccess: async () => { toast.success("Producto dado de baja"); await invalidateOnlineStore() } })
    const importMutation = useMutation({ mutationFn: () => api.importOnlineCatalog(), onSuccess: async (result) => { toast.success(`Importación terminada: ${result.succeeded}/${result.processed} productos`); await invalidateOnlineStore() } })
    const syncOrdersMutation = useMutation({ mutationFn: api.syncTiendanubeOrders, onSuccess: async (result) => { toast.success(`${result.syncedCount} pedidos nuevos; ${result.skippedCount} ya existentes`); await invalidateOnlineStore() } })
    const syncFulfillmentsMutation = useMutation({ mutationFn: api.syncOnlineFulfillments, onSuccess: async (result) => { toast.success(`${result.synced} paquetes actualizados`); await invalidateOnlineStore() } })
    const fulfillmentMutation = useMutation({ mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.updateOnlineFulfillment>[1] }) => api.updateOnlineFulfillment(id, data), onSuccess: async () => { toast.success("Envío actualizado y notificado"); setSelectedFulfillment(null); await invalidateOnlineStore() } })
    const retryAllMutation = useMutation({ mutationFn: api.retryAllFailedSyncs, onSuccess: async () => { toast.success("Cola de stock reprocesada"); await invalidateOnlineStore() } })

    const catalogTotalPages = Math.max(1, catalogQuery.data?.pagination?.totalPages || 1)
    const ordersTotalPages = Math.max(1, ordersQuery.data?.pagination?.totalPages || 1)
    const customersTotalPages = Math.max(1, customersQuery.data?.pagination?.totalPages || 1)
    const fulfillmentTotalPages = Math.max(1, fulfillmentQuery.data?.pagination?.totalPages || 1)
    const connectionAttention = !statusQuery.isLoading && !connected
    const tabCounts = useMemo(() => ({
        catalog: Number(overviewQuery.data?.catalog?.families || 0),
        orders: Number(overviewQuery.data?.orders?.orders || 0),
        fulfillments: Number(overviewQuery.data?.orders?.awaiting_fulfillment || 0),
    }), [overviewQuery.data])

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-2"><Store className="h-7 w-7 text-blue-600" /><h1 className="text-3xl font-bold tracking-tight">Tienda online</h1></div><p className="mt-1 text-muted-foreground">Operación integral de Tiendanube: catálogo, ventas, clientes, envíos y rendimiento.</p></div><div className="flex flex-wrap gap-2"><Link to="/inventory"><Button variant="outline"><Boxes className="mr-2 h-4 w-4" />Abrir inventario WMS</Button></Link>{canConfigure && <Button variant="outline" onClick={() => setActiveTab("connection")}><Settings className="mr-2 h-4 w-4" />Configurar conexión</Button>}</div></div>
            {connectionAttention && <div className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><p className="font-semibold">Tiendanube todavía no está conectada</p><p className="text-sm text-muted-foreground">Podés crear borradores y organizar variantes. Para importar, publicar y recibir pedidos, completá OAuth en la pestaña Configuración de este módulo.</p></div></div>{canConfigure && <Button size="sm" onClick={() => setActiveTab("connection")}>Conectar ahora</Button>}</div>}
            {connected && <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><span className="font-medium">Tienda conectada</span><span className="text-muted-foreground">· API {statusQuery.data?.apiVersion || "2025-03"} · Store #{statusQuery.data?.storeId}</span></div>}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5"><TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto p-1"><TabsTrigger value="overview">Resumen</TabsTrigger><TabsTrigger value="catalog">Catálogo {tabCounts.catalog ? `(${tabCounts.catalog})` : ""}</TabsTrigger><TabsTrigger value="orders">Pedidos {tabCounts.orders ? `(${tabCounts.orders})` : ""}</TabsTrigger><TabsTrigger value="fulfillments">Envíos {tabCounts.fulfillments ? `(${tabCounts.fulfillments})` : ""}</TabsTrigger><TabsTrigger value="customers">Clientes</TabsTrigger><TabsTrigger value="sync">Sincronización</TabsTrigger><TabsTrigger value="analytics">Análisis</TabsTrigger>{canConfigure && <TabsTrigger value="connection"><Settings className="mr-2 h-4 w-4" />Configuración</TabsTrigger>}</TabsList>
                <TabsContent value="overview"><OverviewTab overview={overviewQuery.data} /></TabsContent>
                <TabsContent value="catalog"><CatalogTab rows={catalogQuery.data?.data || []} loading={catalogQuery.isLoading} connected={connected} canManage={canManage} page={catalogPage} totalPages={catalogTotalPages} search={catalogSearch} onSearch={(value) => { setCatalogSearch(value); setCatalogPage(1) }} onPage={setCatalogPage} onNew={() => setProductDialogOpen(true)} busyId={busyProductId} importing={importMutation.isPending} onPublish={(id) => { setBusyProductId(id); publishMutation.mutate(id) }} onArchive={(id) => { if (confirm("¿Dar de baja este producto? Si está publicado quedará oculto en Tiendanube y sus SKU locales pasarán a inactivos.")) archiveMutation.mutate(id) }} onImport={() => importMutation.mutate()} /></TabsContent>
                <TabsContent value="orders"><OrdersTab rows={ordersQuery.data?.data || []} loading={ordersQuery.isLoading} search={ordersSearch} onSearch={(value) => { setOrdersSearch(value); setOrdersPage(1) }} page={ordersPage} totalPages={ordersTotalPages} onPage={setOrdersPage} /></TabsContent>
                <TabsContent value="fulfillments"><FulfillmentsTab rows={fulfillmentQuery.data?.data || []} loading={fulfillmentQuery.isLoading} search={fulfillmentSearch} onSearch={(value) => { setFulfillmentSearch(value); setFulfillmentPage(1) }} page={fulfillmentPage} totalPages={fulfillmentTotalPages} onPage={setFulfillmentPage} canDispatch={canDispatch} onEdit={setSelectedFulfillment} onSync={() => syncFulfillmentsMutation.mutate()} syncing={syncFulfillmentsMutation.isPending} /></TabsContent>
                <TabsContent value="customers"><CustomersTab rows={customersQuery.data?.data || []} loading={customersQuery.isLoading} search={customersSearch} onSearch={(value) => { setCustomersSearch(value); setCustomersPage(1) }} page={customersPage} totalPages={customersTotalPages} onPage={setCustomersPage} /></TabsContent>
                <TabsContent value="sync"><SyncTab data={syncQuery.data} connected={connected} canManage={canManage} syncingOrders={syncOrdersMutation.isPending} onSyncOrders={() => syncOrdersMutation.mutate()} onRetryAll={() => retryAllMutation.mutate()} /></TabsContent>
                <TabsContent value="analytics"><AnalyticsTab data={analyticsQuery.data} /></TabsContent>
                {canConfigure && <TabsContent value="connection"><Suspense fallback={<Card><CardContent className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /><span className="sr-only">Cargando configuración de Tiendanube</span></CardContent></Card>}><TiendanubeConnectionTab /></Suspense></TabsContent>}
            </Tabs>
            <ProductDialog open={productDialogOpen} connected={connected} saving={createMutation.isPending} onClose={() => setProductDialogOpen(false)} onSave={(draft) => createMutation.mutate(draft)} />
            <FulfillmentDialog key={selectedFulfillment?.id || "closed"} fulfillment={selectedFulfillment} saving={fulfillmentMutation.isPending} onClose={() => setSelectedFulfillment(null)} onSave={(data) => { if (selectedFulfillment) fulfillmentMutation.mutate({ id: selectedFulfillment.id, data }) }} />
        </div>
    )
}
