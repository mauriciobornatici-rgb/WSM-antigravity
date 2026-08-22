import { useCallback, useMemo, useRef, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowLeft,
    BarChart3,
    Camera,
    CheckCircle2,
    ClipboardCheck,
    History,
    MapPin,
    PackageCheck,
    Plus,
    RefreshCw,
    ScanLine,
    ShieldCheck,
    XCircle,
} from "lucide-react"
import { hasPermission, PERMISSIONS } from "@wsm/common"
import { toast } from "sonner"
import { api } from "@/services/api"
import { useAuth } from "@/context/AuthContext"
import { showErrorToast } from "@/lib/errorHandling"
import { playScanErrorBeep, playScanSuccessBeep } from "@/lib/scanAudio"
import {
    STOCK_AUDIT_CLASS_GUIDANCE,
    stockAccuracyLevel,
    stockAuditScopeLabel,
    stockAuditStatusLabel,
} from "@/lib/stockAuditUtils"
import type { StockAuditItem, StockAuditScope, StockAuditSession } from "@/types"
import { BarcodeScannerDialog } from "@/components/inventory/BarcodeScannerDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const dashboardKey = ["stock-audits", "dashboard"] as const
const ARGENTINA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
})

function formatDateTime(value?: string | null) {
    if (!value) return "-"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "-"
    return ARGENTINA_DATE_TIME_FORMATTER.format(date)
}

function statusBadgeClass(status: StockAuditSession["status"]) {
    if (status === "adjusted") return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    if (status === "completed") return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    if (status === "cancelled") return "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
    return "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
}

export default function StockControlPage() {
    const { user } = useAuth()
    const queryClient = useQueryClient()
    const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null)
    const [createOpen, setCreateOpen] = useState(false)
    const [locationCode, setLocationCode] = useState("")
    const [abcClass, setAbcClass] = useState<StockAuditScope>("A")
    const [notes, setNotes] = useState("")
    const [verifiedLocation, setVerifiedLocation] = useState(false)
    const [locationScan, setLocationScan] = useState("")
    const [productCode, setProductCode] = useState("")
    const [countedQuantity, setCountedQuantity] = useState("")
    const [countNotes, setCountNotes] = useState("")
    const [scannerTarget, setScannerTarget] = useState<"location" | "product" | null>(null)
    const quantityInputRef = useRef<HTMLInputElement | null>(null)

    const canAdjust = hasPermission(user?.role, PERMISSIONS.INVENTORY_ADJUST)

    const dashboardQuery = useQuery({
        queryKey: dashboardKey,
        queryFn: () => api.getStockAuditDashboard(),
    })
    const locationsQuery = useQuery({
        queryKey: ["warehouse-locations"],
        queryFn: () => api.getWarehouseLocations(),
    })
    const auditQuery = useQuery({
        queryKey: ["stock-audits", selectedAuditId],
        queryFn: () => api.getStockAudit(selectedAuditId as string),
        enabled: Boolean(selectedAuditId),
    })

    const updateAuditCache = useCallback((audit: StockAuditSession) => {
        queryClient.setQueryData(["stock-audits", audit.id], audit)
        void queryClient.invalidateQueries({ queryKey: dashboardKey })
    }, [queryClient])

    const createMutation = useMutation({
        mutationFn: () => api.createStockAudit({
            location_code: locationCode,
            abc_class: abcClass,
            notes: notes.trim() || null,
        }),
        onSuccess: (audit) => {
            setCreateOpen(false)
            setSelectedAuditId(audit.id)
            setVerifiedLocation(false)
            setLocationScan("")
            updateAuditCache(audit)
            toast.success("Conteo iniciado", { description: `${audit.audit_number} · ${audit.location_code}` })
        },
        onError: (error) => showErrorToast("No se pudo iniciar el conteo", error),
    })

    const countMutation = useMutation({
        mutationFn: ({ code, quantity, itemNotes }: { code: string; quantity: number; itemNotes?: string }) =>
            api.countStockAuditItem(selectedAuditId as string, { code, quantity, notes: itemNotes?.trim() || null }),
        onSuccess: (audit) => {
            updateAuditCache(audit)
            setProductCode("")
            setCountedQuantity("")
            setCountNotes("")
            playScanSuccessBeep()
            toast.success("Cantidad registrada", { description: "El resultado seguirá oculto hasta cerrar el conteo." })
        },
        onError: (error) => {
            playScanErrorBeep()
            showErrorToast("No se pudo registrar la cantidad", error)
        },
    })

    const actionMutation = useMutation({
        mutationFn: ({ action, id }: { action: "complete" | "cancel" | "adjust"; id: string }) => {
            if (action === "complete") return api.completeStockAudit(id)
            if (action === "cancel") return api.cancelStockAudit(id)
            return api.applyStockAuditAdjustments(id)
        },
        onSuccess: (audit, variables) => {
            updateAuditCache(audit)
            const messages = {
                complete: "Conteo cerrado: ya puedes revisar las diferencias.",
                cancel: "Conteo cancelado sin modificar existencias.",
                adjust: "Diferencias aplicadas y movimientos de stock registrados.",
            }
            toast.success(messages[variables.action])
        },
        onError: (error) => showErrorToast("No se pudo completar la operación", error),
    })

    const audit = auditQuery.data
    const pendingItems = useMemo(
        () => audit?.items?.filter((item) => item.counted_quantity == null) ?? [],
        [audit?.items],
    )
    const countedItems = useMemo(
        () => audit?.items?.filter((item) => item.counted_quantity != null) ?? [],
        [audit?.items],
    )
    const progress = audit?.total_items ? Math.round((audit.counted_items / audit.total_items) * 100) : 0

    function openCreateDialog() {
        const firstLocation = locationsQuery.data?.find((location) => location.active && Number(location.total_quantity || 0) > 0)
            || locationsQuery.data?.find((location) => location.active)
        setLocationCode(firstLocation?.code || "")
        setAbcClass("A")
        setNotes("")
        setCreateOpen(true)
    }

    function selectAudit(id: string) {
        setSelectedAuditId(id)
        setVerifiedLocation(false)
        setLocationScan("")
        setProductCode("")
        setCountedQuantity("")
    }

    const verifyLocation = useCallback((rawValue: string) => {
        if (!audit) return
        const scanned = rawValue.trim().toLocaleUpperCase("es-AR")
        const expected = audit.location_code.trim().toLocaleUpperCase("es-AR")
        if (scanned !== expected) {
            playScanErrorBeep()
            toast.error("Ubicación incorrecta", { description: `Debes estar en ${audit.location_code}.` })
            return
        }
        setVerifiedLocation(true)
        setLocationScan(rawValue.trim())
        playScanSuccessBeep()
        toast.success("Ubicación verificada")
    }, [audit])

    function submitLocation(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        verifyLocation(locationScan)
    }

    function submitCount(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const code = productCode.trim()
        if (!code) return
        if (countedQuantity === "") {
            quantityInputRef.current?.focus()
            return
        }
        countMutation.mutate({ code, quantity: Number(countedQuantity), itemNotes: countNotes })
    }

    function declareZero(item: StockAuditItem) {
        if (!window.confirm(`¿Confirmas que ${item.sku} tiene existencia física 0 en ${audit?.location_code}?`)) return
        countMutation.mutate({ code: item.barcode || item.sku, quantity: 0 })
    }

    const handleScannerDetection = useCallback((value: string) => {
        if (scannerTarget === "location") {
            setLocationScan(value)
            verifyLocation(value)
        } else {
            setProductCode(value)
            window.setTimeout(() => quantityInputRef.current?.focus(), 0)
        }
        setScannerTarget(null)
    }, [scannerTarget, verifyLocation])

    const handleScannerOpenChange = useCallback((open: boolean) => {
        if (!open) setScannerTarget(null)
    }, [])

    if (selectedAuditId) {
        return (
            <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setSelectedAuditId(null)}>
                        <ArrowLeft className="mr-2 h-4 w-4" />Volver al control
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void auditQuery.refetch()} disabled={auditQuery.isFetching}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${auditQuery.isFetching ? "animate-spin" : ""}`} />Actualizar
                    </Button>
                </div>

                {auditQuery.isLoading ? (
                    <Card><CardContent className="p-8 text-center text-muted-foreground">Cargando conteo...</CardContent></Card>
                ) : !audit ? (
                    <Card><CardContent className="p-8 text-center text-destructive">No se encontró la auditoría.</CardContent></Card>
                ) : (
                    <>
                        <Card className="overflow-hidden border-blue-200 dark:border-blue-900">
                            <CardHeader className="space-y-3 bg-blue-50/70 p-4 dark:bg-blue-950/20 sm:p-6">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <CardTitle className="text-xl sm:text-2xl">{audit.audit_number}</CardTitle>
                                        <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                                            <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{audit.location_name || audit.location_code}</span>
                                            <span className="font-mono">{audit.location_code}</span>
                                        </CardDescription>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Badge variant="outline" className={statusBadgeClass(audit.status)}>{stockAuditStatusLabel(audit.status)}</Badge>
                                        <Badge variant="secondary">{stockAuditScopeLabel(audit.abc_class)}</Badge>
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex justify-between text-xs"><span>Progreso</span><strong>{audit.counted_items}/{audit.total_items} · {progress}%</strong></div>
                                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                                        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
                                    </div>
                                </div>
                            </CardHeader>
                        </Card>

                        {audit.status === "in_progress" && !verifiedLocation ? (
                            <Card className="border-amber-300 dark:border-amber-800">
                                <CardHeader className="p-4 sm:p-6">
                                    <CardTitle className="flex items-center gap-2 text-lg"><MapPin className="h-5 w-5 text-amber-600" />1. Verifica la ubicación</CardTitle>
                                    <CardDescription>Escanea la etiqueta física. El conteo se habilita sólo si coincide con <strong>{audit.location_code}</strong>.</CardDescription>
                                </CardHeader>
                                <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                                    <form onSubmit={submitLocation} className="flex flex-col gap-2 sm:flex-row">
                                        <Input
                                            value={locationScan}
                                            onChange={(event) => setLocationScan(event.target.value)}
                                            placeholder="Escanea o escribe la ubicación"
                                            className="h-12 font-mono text-base"
                                            autoFocus
                                            autoComplete="off"
                                        />
                                        <Button type="button" variant="outline" className="h-12" onClick={() => setScannerTarget("location")}>
                                            <Camera className="mr-2 h-5 w-5" />Cámara
                                        </Button>
                                        <Button type="submit" className="h-12">Verificar</Button>
                                    </form>
                                </CardContent>
                            </Card>
                        ) : null}

                        {audit.status === "in_progress" && verifiedLocation ? (
                            <Card className="border-emerald-300 dark:border-emerald-900">
                                <CardHeader className="p-4 sm:p-6">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                            <CardTitle className="flex items-center gap-2 text-lg"><ScanLine className="h-5 w-5 text-emerald-600" />2. Escanea y cuenta</CardTitle>
                                            <CardDescription>Conteo ciego: la cantidad del sistema se revelará recién al cerrar.</CardDescription>
                                        </div>
                                        <Badge className="bg-emerald-600"><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{audit.location_code}</Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
                                    <form onSubmit={submitCount} className="grid gap-3 rounded-xl border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="audit-product-code">SKU / código de barras</Label>
                                            <div className="flex gap-2">
                                                <Input
                                                    id="audit-product-code"
                                                    value={productCode}
                                                    onChange={(event) => setProductCode(event.target.value)}
                                                    placeholder="Escanea el producto"
                                                    className="h-12 font-mono"
                                                    autoComplete="off"
                                                />
                                                <Button type="button" size="icon" variant="outline" className="h-12 w-12 shrink-0" onClick={() => setScannerTarget("product")} aria-label="Escanear producto con cámara">
                                                    <Camera className="h-5 w-5" />
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="audit-counted-quantity">Cantidad física</Label>
                                            <Input
                                                ref={quantityInputRef}
                                                id="audit-counted-quantity"
                                                type="number"
                                                min="0"
                                                step="1"
                                                inputMode="numeric"
                                                value={countedQuantity}
                                                onChange={(event) => setCountedQuantity(event.target.value)}
                                                placeholder="0"
                                                className="h-12 text-lg font-bold"
                                            />
                                        </div>
                                        <div className="flex items-end">
                                            <Button type="submit" className="h-12 w-full" disabled={countMutation.isPending || !productCode.trim()}>
                                                {countMutation.isPending ? "Guardando..." : "Registrar"}
                                            </Button>
                                        </div>
                                        <div className="space-y-1.5 sm:col-span-3">
                                            <Label htmlFor="audit-count-notes">Observación opcional</Label>
                                            <Input id="audit-count-notes" value={countNotes} onChange={(event) => setCountNotes(event.target.value)} placeholder="Caja abierta, producto dañado, etc." />
                                        </div>
                                    </form>
                                </CardContent>
                            </Card>
                        ) : null}

                        <Card>
                            <CardHeader className="p-4 sm:p-6">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                        <CardTitle className="text-lg">Productos del conteo</CardTitle>
                                        <CardDescription>
                                            {audit.status === "in_progress" ? `${pendingItems.length} pendientes · ${countedItems.length} registrados` : "Comparación final contra la existencia teórica al iniciar"}
                                        </CardDescription>
                                    </div>
                                    {audit.status === "in_progress" && verifiedLocation && pendingItems.length === 0 ? (
                                        <Button onClick={() => actionMutation.mutate({ action: "complete", id: audit.id })} disabled={actionMutation.isPending}>
                                            <PackageCheck className="mr-2 h-4 w-4" />Cerrar conteo
                                        </Button>
                                    ) : null}
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="max-h-[34rem] divide-y overflow-y-auto">
                                    {(audit.items || []).map((item) => {
                                        const isCounted = item.counted_quantity != null
                                        const variance = item.variance ?? 0
                                        return (
                                            <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="font-semibold">{item.product_name}</span>
                                                        <Badge variant="outline" className="text-[10px]">{item.abc_class}</Badge>
                                                        {item.is_unexpected ? <Badge variant="destructive" className="text-[10px]">No previsto</Badge> : null}
                                                    </div>
                                                    <p className="mt-1 font-mono text-xs text-muted-foreground">{item.sku}{item.barcode ? ` · ${item.barcode}` : ""}</p>
                                                    {item.count_attempts > 1 ? <p className="mt-1 text-xs text-amber-600">Recontado {item.count_attempts} veces</p> : null}
                                                </div>
                                                {audit.status === "in_progress" ? (
                                                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                                                        <Badge variant={isCounted ? "secondary" : "outline"}>{isCounted ? `Contado: ${item.counted_quantity}` : "Pendiente"}</Badge>
                                                        {!isCounted && verifiedLocation ? (
                                                            <Button size="sm" variant="outline" onClick={() => declareZero(item)} disabled={countMutation.isPending}>Declarar 0</Button>
                                                        ) : null}
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-3 gap-2 text-center text-xs sm:min-w-72">
                                                        <div className="rounded-lg bg-muted p-2"><span className="block text-muted-foreground">Sistema</span><strong className="text-base">{item.expected_quantity}</strong></div>
                                                        <div className="rounded-lg bg-muted p-2"><span className="block text-muted-foreground">Físico</span><strong className="text-base">{item.counted_quantity}</strong></div>
                                                        <div className={`rounded-lg p-2 ${variance === 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"}`}>
                                                            <span className="block">Diferencia</span><strong className="text-base">{variance > 0 ? "+" : ""}{variance}</strong>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </CardContent>
                        </Card>

                        {audit.status !== "in_progress" && audit.status !== "cancelled" ? (
                            <Card className="border-indigo-200 dark:border-indigo-900">
                                <CardHeader className="p-4 sm:p-6">
                                    <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="h-5 w-5 text-indigo-600" />Resultado y conciliación</CardTitle>
                                    <CardDescription>La exactitud mide SKU sin diferencia sobre el total contado.</CardDescription>
                                </CardHeader>
                                <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-3 sm:p-6 sm:pt-0">
                                    <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Exactitud</p><p className="mt-1 text-2xl font-bold">{audit.accuracy_percent ?? 0}%</p></div>
                                    <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">SKU exactos</p><p className="mt-1 text-2xl font-bold">{audit.exact_items ?? 0}/{audit.counted_items}</p></div>
                                    <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Diferencia absoluta</p><p className="mt-1 text-2xl font-bold">{audit.variance_units ?? 0} u.</p></div>
                                    {audit.status === "completed" ? (
                                        <div className="sm:col-span-3">
                                            {canAdjust ? (
                                                <Button className="w-full" onClick={() => {
                                                    if (window.confirm("¿Aplicar todas las diferencias al stock? Esta acción generará movimientos trazables.")) {
                                                        actionMutation.mutate({ action: "adjust", id: audit.id })
                                                    }
                                                }} disabled={actionMutation.isPending}>
                                                    <ShieldCheck className="mr-2 h-4 w-4" />Aprobar y ajustar existencias
                                                </Button>
                                            ) : (
                                                <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">El conteo espera aprobación de administración o gerencia.</p>
                                            )}
                                        </div>
                                    ) : null}
                                </CardContent>
                            </Card>
                        ) : null}

                        {audit.status === "in_progress" ? (
                            <div className="flex justify-end">
                                <Button variant="ghost" className="text-destructive" onClick={() => {
                                    if (window.confirm("¿Cancelar este conteo? No se modificará el stock.")) actionMutation.mutate({ action: "cancel", id: audit.id })
                                }} disabled={actionMutation.isPending}>
                                    <XCircle className="mr-2 h-4 w-4" />Cancelar conteo
                                </Button>
                            </div>
                        ) : null}
                    </>
                )}

                <BarcodeScannerDialog
                    open={scannerTarget != null}
                    onOpenChange={handleScannerOpenChange}
                    title={scannerTarget === "location" ? "Escanear ubicación" : "Escanear producto"}
                    description={scannerTarget === "location" ? "Lee el QR o código de la posición física." : "Lee el código de barras del producto."}
                    onDetected={handleScannerDetection}
                />
            </div>
        )
    }

    const dashboard = dashboardQuery.data
    const accuracyLevel = stockAccuracyLevel(dashboard?.summary.accuracy_percent ?? 0)
    const accuracyClass = accuracyLevel === "excellent"
        ? "text-emerald-600"
        : accuracyLevel === "warning"
            ? "text-amber-600"
            : accuracyLevel === "critical"
                ? "text-red-600"
                : "text-muted-foreground"

    return (
        <div className="mx-auto w-full max-w-6xl space-y-5 p-3 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl"><ClipboardCheck className="h-7 w-7 text-blue-600" />Control de stock</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Conteos cíclicos móviles, fidelidad ABC y conciliación trazable.</p>
                </div>
                <Button onClick={openCreateDialog} disabled={locationsQuery.isLoading} className="h-11">
                    <Plus className="mr-2 h-4 w-4" />Nueva auditoría
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Fidelidad histórica</p><p className={`mt-1 text-2xl font-bold ${accuracyClass}`}>{dashboard?.summary.accuracy_percent ?? 0}%</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Conteos activos</p><p className="mt-1 text-2xl font-bold text-blue-600">{dashboard?.summary.active_audits ?? 0}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">SKU auditados</p><p className="mt-1 text-2xl font-bold">{dashboard?.summary.counted_items ?? 0}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Diferencias</p><p className="mt-1 text-2xl font-bold text-amber-600">{dashboard?.summary.variance_units ?? 0} u.</p></CardContent></Card>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
                {(["A", "B", "C"] as const).map((scope) => {
                    const metric = dashboard?.by_class.find((item) => item.abc_class === scope)
                    const guide = STOCK_AUDIT_CLASS_GUIDANCE[scope]
                    return (
                        <Card key={scope} className={scope === "A" ? "border-red-200 dark:border-red-900" : scope === "B" ? "border-amber-200 dark:border-amber-900" : "border-blue-200 dark:border-blue-900"}>
                            <CardHeader className="p-4 pb-2">
                                <div className="flex items-center justify-between"><CardTitle className="text-base">{guide.label}</CardTitle><Badge variant="outline">{guide.cadence}</Badge></div>
                                <CardDescription>{guide.description}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex items-end justify-between p-4 pt-2">
                                <div><p className="text-xs text-muted-foreground">Fidelidad</p><p className="text-xl font-bold">{metric?.accuracy_percent ?? 0}%</p></div>
                                <div className="text-right text-xs text-muted-foreground">{metric?.counted_items ?? 0} SKU<br />{metric?.variance_units ?? 0} u. diferencia</div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            <Card>
                <CardHeader className="p-4 sm:p-6">
                    <CardTitle className="flex items-center gap-2 text-lg"><History className="h-5 w-5" />Auditorías recientes</CardTitle>
                    <CardDescription>Máximo 50 registros; la lista se desplaza sin alargar indefinidamente la pantalla.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    {dashboardQuery.isLoading ? (
                        <p className="p-8 text-center text-muted-foreground">Cargando historial...</p>
                    ) : !dashboard?.sessions.length ? (
                        <div className="p-8 text-center">
                            <BarChart3 className="mx-auto h-10 w-10 text-muted-foreground/50" />
                            <p className="mt-3 font-medium">Todavía no hay auditorías</p>
                            <p className="text-sm text-muted-foreground">Inicia el primer conteo por ubicación y clase ABC.</p>
                        </div>
                    ) : (
                        <div className="max-h-[38rem] divide-y overflow-y-auto">
                            {dashboard.sessions.map((session) => (
                                <button
                                    key={session.id}
                                    type="button"
                                    onClick={() => selectAudit(session.id)}
                                    className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold">{session.audit_number}</span>
                                            <Badge variant="outline" className={statusBadgeClass(session.status)}>{stockAuditStatusLabel(session.status)}</Badge>
                                            <Badge variant="secondary">{stockAuditScopeLabel(session.abc_class)}</Badge>
                                        </div>
                                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{session.location_name || session.location_code}</span>
                                            <span>{formatDateTime(session.started_at)}</span>
                                            <span>{session.created_by_name || "Sin operador"}</span>
                                        </p>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                                        <div className="text-right text-xs text-muted-foreground">
                                            <strong className="block text-base text-foreground">{session.counted_items}/{session.total_items}</strong>
                                            SKU contados
                                        </div>
                                        {session.status !== "in_progress" ? (
                                            <div className="text-right text-xs text-muted-foreground"><strong className="block text-base text-foreground">{session.accuracy_percent ?? 0}%</strong>fidelidad</div>
                                        ) : null}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/10">
                <CardContent className="flex gap-3 p-4 text-sm">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                    <p><strong>Criterio recomendado:</strong> A semanal, B mensual y C trimestral. La frecuencia es orientativa; puedes iniciar cualquier clase cuando exista una diferencia, recepción crítica o cambio de ubicación.</p>
                </CardContent>
            </Card>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="w-[95vw] max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Nueva auditoría de stock</DialogTitle>
                        <DialogDescription>La foto del stock se toma al iniciar y las cantidades permanecerán ocultas durante el conteo.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label>Ubicación</Label>
                            <Select value={locationCode} onValueChange={setLocationCode}>
                                <SelectTrigger><SelectValue placeholder="Selecciona una ubicación" /></SelectTrigger>
                                <SelectContent>
                                    {locationsQuery.data?.filter((location) => location.active).map((location) => (
                                        <SelectItem key={location.id} value={location.code} disabled={Number(location.total_quantity || 0) <= 0}>
                                            {location.code} · {location.name} · {Number(location.total_quantity || 0)} u.
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Alcance ABC</Label>
                            <Select value={abcClass} onValueChange={(value) => setAbcClass(value as StockAuditScope)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="A">Clase A · prioridad semanal</SelectItem>
                                    <SelectItem value="B">Clase B · prioridad mensual</SelectItem>
                                    <SelectItem value="C">Clase C · prioridad trimestral</SelectItem>
                                    <SelectItem value="ALL">Todas las clases</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="audit-notes">Motivo / observaciones</Label>
                            <Input id="audit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Conteo semanal, control por diferencia, etc." />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                        <Button onClick={() => createMutation.mutate()} disabled={!locationCode || createMutation.isPending}>
                            {createMutation.isPending ? "Iniciando..." : "Iniciar conteo ciego"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
