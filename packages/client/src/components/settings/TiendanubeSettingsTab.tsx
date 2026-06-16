import { Save, Loader2, RefreshCw, AlertCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CompanySettings, Product, FailedSync } from "@/types"

interface TiendanubeSettingsTabProps {
    company: CompanySettings
    setCompany: React.Dispatch<React.SetStateAction<CompanySettings | null>>
    onSaveCompany: () => Promise<void>
    saving: boolean
    onSyncTN: () => Promise<void>
    syncingTN: boolean
    onAutoLinkTN: () => Promise<void>
    autoLinkingTN: boolean
    tiendanubeProducts: Product[]
    tiendanubeLoading: boolean
    tiendanubeSaving: boolean
    onSaveTiendaNubeLinks: () => Promise<void>
    tiendanubeModifications: Record<string, {
        tiendanube_sync_enabled: boolean
        tiendanube_product_id: string
        tiendanube_variant_id: string
    }>
    setTiendanubeModifications: React.Dispatch<React.SetStateAction<Record<string, {
        tiendanube_sync_enabled: boolean
        tiendanube_product_id: string
        tiendanube_variant_id: string
    }>>>
    apiBaseUrl: string
    failedSyncs: FailedSync[]
    failedSyncsLoading: boolean
    processingSyncId: string | null
    processingAllSyncs: boolean
    onRetrySync: (id: string) => Promise<void>
    onRetryAllSyncs: () => Promise<void>
}

export function TiendanubeSettingsTab({
    company,
    setCompany,
    onSaveCompany,
    saving,
    onSyncTN,
    syncingTN,
    onAutoLinkTN,
    autoLinkingTN,
    tiendanubeProducts,
    tiendanubeLoading,
    tiendanubeSaving,
    onSaveTiendaNubeLinks,
    tiendanubeModifications,
    setTiendanubeModifications,
    apiBaseUrl,
    failedSyncs,
    failedSyncsLoading,
    processingSyncId,
    processingAllSyncs,
    onRetrySync,
    onRetryAllSyncs
}: TiendanubeSettingsTabProps) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Configuración de Tienda Nube</CardTitle>
                    <CardDescription>Para conectar tu tienda de forma segura, ingresa las credenciales de tu Aplicación de Tienda Nube y presiona 'Conectar'.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {company.integrations?.tiendanube_access_token && company.integrations?.tiendanube_store_id ? (
                        <div className="p-4 bg-green-50 text-green-700 rounded-md border border-green-200 flex items-center">
                            <div className="mr-3">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div>
                                <p className="font-semibold">¡Conectado exitosamente con Tienda Nube!</p>
                                <p className="text-sm">Store ID: {company.integrations.tiendanube_store_id}</p>
                            </div>
                        </div>
                    ) : null}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label htmlFor="tn_client_id">Client ID (App ID)</Label>
                            <Input
                                id="tn_client_id"
                                placeholder="Ingresa el Client ID"
                                value={company.integrations?.tiendanube_client_id || ''}
                                onChange={e => setCompany({
                                    ...company,
                                    integrations: {
                                        ...(company.integrations || {}),
                                        tiendanube_client_id: e.target.value
                                    }
                                })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tn_client_secret">Client Secret</Label>
                            <Input
                                id="tn_client_secret"
                                type="password"
                                placeholder="Ingresa tu Client Secret"
                                value={company.integrations?.tiendanube_client_secret || ''}
                                onChange={e => setCompany({
                                    ...company,
                                    integrations: {
                                        ...(company.integrations || {}),
                                        tiendanube_client_secret: e.target.value
                                    }
                                })}
                            />
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-between gap-4 border-t pt-4">
                    <p className="text-sm text-muted-foreground flex-1">
                        Asegúrate de guardar las credenciales antes de Conectar.
                    </p>
                    <Button variant="outline" onClick={onSaveCompany} disabled={saving}>
                        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Credenciales</>}
                    </Button>
                    {company.integrations?.tiendanube_access_token && (
                        <Button 
                            variant="outline"
                            onClick={onSyncTN}
                            disabled={syncingTN}
                            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                        >
                            {syncingTN ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sincronizando...</> : <><RefreshCw className="mr-2 h-4 w-4" /> Sincronizar Órdenes (Respaldo)</>}
                        </Button>
                    )}
                    <Button 
                        onClick={() => {
                            window.location.href = `${apiBaseUrl}/api/integrations/tiendanube/authorize`;
                        }} 
                        disabled={!company.integrations?.tiendanube_client_id || !company.integrations?.tiendanube_client_secret}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                        Conectar con Tienda Nube
                    </Button>
                </CardFooter>
            </Card>

            <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle>Gestor de Vinculación (Catálogo)</CardTitle>
                        <CardDescription>Administra qué productos locales se sincronizan y asocia sus IDs en Tienda Nube.</CardDescription>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                        {company.integrations?.tiendanube_access_token && (
                            <Button 
                                variant="outline" 
                                onClick={onAutoLinkTN} 
                                disabled={autoLinkingTN || tiendanubeLoading || tiendanubeSaving}
                                className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800 font-medium"
                            >
                                {autoLinkingTN ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Vinculando...</> : <><RefreshCw className="mr-2 h-4 w-4" /> Auto-vincular por SKU</>}
                            </Button>
                        )}
                        <Button onClick={onSaveTiendaNubeLinks} disabled={tiendanubeSaving || autoLinkingTN}>
                            {tiendanubeSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Vinculación</>}
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto rounded-md border">
                        <Table className="min-w-[800px]">
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>Producto</TableHead>
                                    <TableHead>Stock Actual</TableHead>
                                    <TableHead className="text-center">Sincronizar</TableHead>
                                    <TableHead>TN Product ID</TableHead>
                                    <TableHead>TN Variant ID</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {tiendanubeLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                            Cargando productos...
                                        </TableCell>
                                    </TableRow>
                                ) : tiendanubeProducts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                            No hay productos registrados en el sistema.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    tiendanubeProducts.map((p) => {
                                        const mods = tiendanubeModifications[p.id] || {
                                            tiendanube_sync_enabled: Boolean(p.tiendanube_sync_enabled),
                                            tiendanube_product_id: p.tiendanube_product_id || '',
                                            tiendanube_variant_id: p.tiendanube_variant_id || ''
                                        }
                                        return (
                                            <TableRow key={p.id}>
                                                <TableCell>
                                                    <div className="flex flex-col">
                                                        <span className="font-medium">{p.name}</span>
                                                        <span className="text-xs text-muted-foreground">SKU: {p.sku}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell>{p.stock_current ?? 0}</TableCell>
                                                <TableCell className="text-center">
                                                    <div className="flex justify-center">
                                                        <Switch
                                                            checked={mods.tiendanube_sync_enabled}
                                                            onChange={(e) => {
                                                                setTiendanubeModifications({
                                                                    ...tiendanubeModifications,
                                                                    [p.id]: {
                                                                        ...mods,
                                                                        tiendanube_sync_enabled: (e.target as HTMLInputElement).checked
                                                                    }
                                                                })
                                                            }}
                                                        />
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        placeholder="12345678"
                                                        value={mods.tiendanube_product_id}
                                                        onChange={(e) => {
                                                            setTiendanubeModifications({
                                                                ...tiendanubeModifications,
                                                                [p.id]: {
                                                                    ...mods,
                                                                    tiendanube_product_id: e.target.value
                                                                }
                                                            })
                                                        }}
                                                        className="h-8 max-w-[150px]"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        placeholder="Opcional"
                                                        value={mods.tiendanube_variant_id}
                                                        onChange={(e) => {
                                                            setTiendanubeModifications({
                                                                ...tiendanubeModifications,
                                                                [p.id]: {
                                                                    ...mods,
                                                                    tiendanube_variant_id: e.target.value
                                                                }
                                                            })
                                                        }}
                                                        className="h-8 max-w-[150px]"
                                                    />
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <CardTitle className="text-red-500 flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" /> Cola de Sincronizaciones Fallidas
                        </CardTitle>
                        <CardDescription>
                            Registro de productos que presentaron errores al actualizar el stock en Tienda Nube.
                        </CardDescription>
                    </div>
                    {failedSyncs.length > 0 && (
                        <Button
                            variant="outline"
                            onClick={onRetryAllSyncs}
                            disabled={processingAllSyncs || failedSyncsLoading}
                            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                        >
                            {processingAllSyncs ? (
                                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Procesando...</>
                            ) : (
                                <><RefreshCw className="mr-2 h-4 w-4" /> Reintentar Todos</>
                            )}
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto rounded-md border">
                        <Table className="min-w-[800px]">
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>Producto</TableHead>
                                    <TableHead>Stock Pendiente</TableHead>
                                    <TableHead>Intentos</TableHead>
                                    <TableHead>Último Error</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead className="text-right">Acción</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {failedSyncsLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                                            Cargando cola de reintentos...
                                        </TableCell>
                                    </TableRow>
                                ) : failedSyncs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                            No hay sincronizaciones fallidas registradas. ¡Todo sincronizado!
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    failedSyncs.map((sync) => (
                                        <TableRow key={sync.id}>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{sync.product_name}</span>
                                                    <span className="text-xs text-muted-foreground">SKU: {sync.product_sku}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-bold">{sync.stock}</TableCell>
                                            <TableCell>
                                                <span className={`px-2 py-1 text-xs rounded-full ${sync.attempts >= sync.max_attempts ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                    {sync.attempts} / {sync.max_attempts}
                                                </span>
                                            </TableCell>
                                            <TableCell className="max-w-[250px] truncate" title={sync.last_error || ''}>
                                                <span className="text-xs text-red-600 font-mono block truncate">
                                                    {sync.last_error || 'Error desconocido'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                                {sync.last_attempt_at ? new Date(sync.last_attempt_at).toLocaleString('es-AR') : new Date(sync.created_at).toLocaleString('es-AR')}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => onRetrySync(sync.id)}
                                                    disabled={processingSyncId === sync.id || processingAllSyncs}
                                                    className="h-8 text-indigo-600 hover:text-indigo-900 hover:bg-indigo-50"
                                                >
                                                    {processingSyncId === sync.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <RefreshCw className="h-4 w-4" />
                                                    )}
                                                    <span className="ml-1">Reintentar</span>
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
