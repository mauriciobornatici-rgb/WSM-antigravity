import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, KeyRound, Loader2, RefreshCw, Save, ShieldCheck, Unplug } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import { showErrorToast } from "@/lib/errorHandling"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { TiendaNubeIntegrationConfig } from "@/types"

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001"

function ConnectionForm({ config }: { config: TiendaNubeIntegrationConfig }) {
    const queryClient = useQueryClient()
    const [clientId, setClientId] = useState(config.clientId)
    const [clientSecret, setClientSecret] = useState("")
    const [locationId, setLocationId] = useState(config.locationId)
    const statusQuery = useQuery({ queryKey: ["tiendanube-status"], queryFn: api.getTiendanubeStatus })
    const hasUnsavedChanges = clientId.trim() !== config.clientId
        || locationId.trim() !== config.locationId
        || Boolean(clientSecret.trim())
    const canStartOAuth = Boolean(config.clientId && config.clientSecretConfigured && !hasUnsavedChanges)

    const refreshIntegration = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["tiendanube-status"] }),
            queryClient.invalidateQueries({ queryKey: ["online-store"] }),
        ])
    }

    const saveMutation = useMutation({
        mutationFn: () => api.updateTiendanubeConfig({
            clientId: clientId.trim(),
            locationId: locationId.trim(),
            ...(clientSecret.trim() ? { clientSecret: clientSecret.trim() } : {}),
        }),
        onSuccess: async (updated) => {
            queryClient.setQueryData(["tiendanube-config"], updated)
            toast.success("Configuración de Tiendanube guardada")
            await refreshIntegration()
        },
        onError: (error) => showErrorToast("No se pudo guardar la configuración de Tiendanube", error),
    })
    const webhookMutation = useMutation({
        mutationFn: api.ensureTiendanubeWebhook,
        onSuccess: async (result) => {
            if (result.configured) toast.success(result.created ? "Webhooks registrados" : "Los webhooks ya estaban registrados")
            else toast.warning("Configurá TIENDANUBE_WEBHOOK_URL con una URL HTTPS pública")
            await refreshIntegration()
        },
        onError: (error) => showErrorToast("No se pudieron registrar los webhooks", error),
    })
    const disconnectMutation = useMutation({
        mutationFn: api.disconnectTiendanube,
        onSuccess: async () => {
            toast.success("Tiendanube fue desconectada")
            await refreshIntegration()
        },
        onError: (error) => showErrorToast("No se pudo desconectar Tiendanube", error),
    })
    const status = statusQuery.data
    const connectionActionPending = webhookMutation.isPending || disconnectMutation.isPending

    return (
        <div className="space-y-5">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Conexión y credenciales</CardTitle>
                    <CardDescription>Administrá OAuth y la ubicación que recibirá las actualizaciones de stock. Estos datos sólo están disponibles para administradores.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {status?.connected && (
                        <div className="flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-5 w-5 shrink-0" />
                            <div><p className="font-semibold">Conexión activa</p><p className="text-sm">Store #{status.storeId} · API {status.apiVersion}</p></div>
                        </div>
                    )}
                    <div className="grid gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="tn-client-id">Client ID (App ID)</Label>
                            <Input id="tn-client-id" name="tiendanube-client-id" autoComplete="off" spellCheck={false} data-lpignore="true" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Client ID de la aplicación" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tn-client-secret">Client Secret</Label>
                            <Input id="tn-client-secret" name="tiendanube-client-secret" type="password" autoComplete="new-password" spellCheck={false} data-lpignore="true" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder={config.clientSecretConfigured ? "Secret configurado; escribir para reemplazar" : "Client Secret"} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="tn-location-id">Location ID de stock</Label>
                            <Input id="tn-location-id" name="tiendanube-location-id" autoComplete="off" spellCheck={false} data-lpignore="true" value={locationId} onChange={(event) => setLocationId(event.target.value)} placeholder="Obligatorio si hay varias ubicaciones" />
                            <p className="text-xs text-muted-foreground">Evita enviar stock al depósito incorrecto en tiendas multiubicación.</p>
                        </div>
                    </div>
                    {hasUnsavedChanges && <p className="text-xs text-amber-700 dark:text-amber-300">Guardá los cambios antes de iniciar OAuth para que Tiendanube utilice las credenciales correctas.</p>}
                </CardContent>
                <CardFooter className="flex flex-wrap justify-end gap-2 border-t pt-4">
                    <Button variant="outline" onClick={() => saveMutation.mutate()} disabled={!hasUnsavedChanges || saveMutation.isPending}>
                        {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar credenciales
                    </Button>
                    <Button onClick={() => window.location.assign(`${API_BASE_URL}/api/integrations/tiendanube/authorize`)} disabled={!canStartOAuth}>Conectar por OAuth</Button>
                </CardFooter>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Estado técnico</CardTitle>
                    <CardDescription>Valida token, versión, ubicación y el conjunto de webhooks necesarios para catálogo, pedidos y clientes.</CardDescription>
                </CardHeader>
                <CardContent aria-live="polite">
                    {statusQuery.isLoading ? (
                        <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verificando…</p>
                    ) : statusQuery.isError ? (
                        <p className="text-sm text-red-600">No fue posible consultar el estado técnico.</p>
                    ) : (
                        <div className="grid gap-3 text-sm sm:grid-cols-4">
                            <p><span className="font-medium">Conexión:</span> {status?.connected ? "Activa" : "Desconectada"}</p>
                            <p><span className="font-medium">API:</span> {status?.apiVersion || "—"}</p>
                            <p><span className="font-medium">Webhooks:</span> {status?.webhook.configured ? "Completos" : "Pendientes"}</p>
                            <p><span className="font-medium">Ubicación:</span> {status?.stockLocation?.valid ? "Validada" : "Requiere revisión"}</p>
                        </div>
                    )}
                    {status?.webhook.missingEvents?.length ? <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Faltan: {status.webhook.missingEvents.join(", ")}</p> : null}
                    {status?.stockLocation?.message ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{status.stockLocation.message}</p> : null}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2 border-t pt-4">
                    <Button variant="outline" onClick={() => void statusQuery.refetch()} disabled={statusQuery.isFetching || connectionActionPending}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${statusQuery.isFetching ? "animate-spin" : ""}`} />Verificar
                    </Button>
                    {status?.connected && !status.webhook.configured && <Button variant="outline" onClick={() => webhookMutation.mutate()} disabled={connectionActionPending}>Registrar webhooks</Button>}
                    {status?.connected && <Button variant="destructive" onClick={() => { if (window.confirm("¿Desconectar Tiendanube y eliminar los webhooks registrados?")) disconnectMutation.mutate() }} disabled={connectionActionPending}><Unplug className="mr-2 h-4 w-4" />Desconectar</Button>}
                </CardFooter>
            </Card>
        </div>
    )
}

export default function TiendanubeConnectionTab() {
    const configQuery = useQuery({ queryKey: ["tiendanube-config"], queryFn: api.getTiendanubeConfig })

    if (configQuery.isLoading) {
        return <Card><CardContent className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-600" /><span className="sr-only">Cargando configuración de Tiendanube</span></CardContent></Card>
    }
    if (configQuery.isError || !configQuery.data) {
        return <Card><CardHeader><CardTitle>No se pudo cargar la configuración</CardTitle><CardDescription>Revisá la conexión con el servidor e intentá nuevamente.</CardDescription></CardHeader><CardFooter><Button variant="outline" onClick={() => void configQuery.refetch()}>Reintentar</Button></CardFooter></Card>
    }

    const config = configQuery.data
    return <ConnectionForm key={`${config.clientId}:${config.locationId}:${config.clientSecretConfigured}`} config={config} />
}
