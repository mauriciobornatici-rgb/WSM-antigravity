import { Link } from "react-router-dom"
import { CheckCircle2, Loader2, RefreshCw, Save, ShieldCheck, Store, Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { CompanySettings, TiendaNubeIntegrationStatus } from "@/types"

interface TiendanubeSettingsTabProps {
    company: CompanySettings
    setCompany: React.Dispatch<React.SetStateAction<CompanySettings | null>>
    onSaveCompany: () => Promise<void>
    saving: boolean
    integrationStatus: TiendaNubeIntegrationStatus | null
    integrationStatusLoading: boolean
    connectionActionLoading: boolean
    onRefreshIntegrationStatus: () => Promise<void>
    onEnsureWebhook: () => Promise<void>
    onDisconnect: () => Promise<void>
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001"

export function TiendanubeSettingsTab({
    company,
    setCompany,
    onSaveCompany,
    saving,
    integrationStatus,
    integrationStatusLoading,
    connectionActionLoading,
    onRefreshIntegrationStatus,
    onEnsureWebhook,
    onDisconnect,
}: TiendanubeSettingsTabProps) {
    const updateIntegration = (values: Partial<NonNullable<CompanySettings["integrations"]>>) => {
        setCompany((current) => current ? ({
            ...current,
            integrations: { ...(current.integrations || {}), ...values },
        }) : current)
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Conexión con Tiendanube</CardTitle>
                    <CardDescription>Este apartado conserva sólo credenciales, OAuth, ubicación de stock y webhooks. La operación diaria se realiza en Tienda online.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {integrationStatus?.connected && (
                        <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-5 w-5" />
                            <div><p className="font-semibold">Conexión activa</p><p className="text-sm">Store #{integrationStatus.storeId} · API {integrationStatus.apiVersion}</p></div>
                        </div>
                    )}
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2"><Label htmlFor="tn_client_id">Client ID (App ID)</Label><Input id="tn_client_id" name="tiendanube-client-id" autoComplete="off" spellCheck={false} data-lpignore="true" value={company.integrations?.tiendanube_client_id || ""} onChange={(event) => updateIntegration({ tiendanube_client_id: event.target.value })} placeholder="Client ID de la aplicación" /></div>
                        <div className="space-y-2"><Label htmlFor="tn_client_secret">Client Secret</Label><Input id="tn_client_secret" name="tiendanube-client-secret" type="password" autoComplete="new-password" spellCheck={false} data-lpignore="true" value={company.integrations?.tiendanube_client_secret || ""} onChange={(event) => updateIntegration({ tiendanube_client_secret: event.target.value })} placeholder={company.integrations?.tiendanube_client_secret_configured ? "Secret configurado; escribir para reemplazar" : "Client Secret"} /></div>
                        <div className="space-y-2"><Label htmlFor="tn_location_id">Location ID de stock</Label><Input id="tn_location_id" name="tiendanube-location-id" autoComplete="off" spellCheck={false} data-lpignore="true" value={company.integrations?.tiendanube_location_id || ""} onChange={(event) => updateIntegration({ tiendanube_location_id: event.target.value })} placeholder="Obligatorio si hay varias ubicaciones" /><p className="text-xs text-muted-foreground">Evita enviar stock al depósito incorrecto en tiendas multiubicación.</p></div>
                    </div>
                </CardContent>
                <CardFooter className="flex flex-wrap justify-end gap-2 border-t pt-4">
                    <Button variant="outline" onClick={() => void onSaveCompany()} disabled={saving}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar credenciales</Button>
                    <Button onClick={() => { window.location.href = `${API_BASE_URL}/api/integrations/tiendanube/authorize` }} disabled={!company.integrations?.tiendanube_client_id || (!company.integrations?.tiendanube_client_secret && !company.integrations?.tiendanube_client_secret_configured)}>Conectar por OAuth</Button>
                </CardFooter>
            </Card>

            <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Estado técnico</CardTitle><CardDescription>Valida token, versión, ubicación y el conjunto de webhooks operativos.</CardDescription></CardHeader>
                <CardContent aria-live="polite">
                    {integrationStatusLoading ? <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verificando…</p> : <div className="grid gap-3 text-sm sm:grid-cols-4"><p><span className="font-medium">Conexión:</span> {integrationStatus?.connected ? "Activa" : "Desconectada"}</p><p><span className="font-medium">API:</span> {integrationStatus?.apiVersion || "—"}</p><p><span className="font-medium">Webhooks:</span> {integrationStatus?.webhook.configured ? "Completos" : "Pendientes"}</p><p><span className="font-medium">Ubicación:</span> {integrationStatus?.stockLocation?.valid ? "Validada" : "Requiere revisión"}</p></div>}
                    {integrationStatus?.webhook.missingEvents?.length ? <p className="mt-3 text-xs text-amber-700">Faltan: {integrationStatus.webhook.missingEvents.join(", ")}</p> : null}
                    {integrationStatus?.stockLocation?.message ? <p className="mt-2 text-xs text-amber-700">{integrationStatus.stockLocation.message}</p> : null}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2 border-t pt-4">
                    <Button variant="outline" onClick={() => void onRefreshIntegrationStatus()} disabled={integrationStatusLoading || connectionActionLoading}><RefreshCw className="mr-2 h-4 w-4" />Verificar</Button>
                    {integrationStatus?.connected && !integrationStatus.webhook.configured && <Button variant="outline" onClick={() => void onEnsureWebhook()} disabled={connectionActionLoading}>Registrar webhooks</Button>}
                    {integrationStatus?.connected && <Button variant="destructive" onClick={() => void onDisconnect()} disabled={connectionActionLoading}><Unplug className="mr-2 h-4 w-4" />Desconectar</Button>}
                </CardFooter>
            </Card>

            <Card className="border-blue-500/30 bg-blue-500/5">
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex gap-3"><Store className="mt-1 h-5 w-5 text-blue-600" /><div><p className="font-semibold">La administración se trasladó a Tienda online</p><p className="text-sm text-muted-foreground">Catálogo paginado, altas y bajas, pedidos, destinatarios, tracking, clientes, errores y análisis.</p></div></div>
                    <Link to="/online-store"><Button>Ir a Tienda online</Button></Link>
                </CardContent>
            </Card>
        </div>
    )
}
