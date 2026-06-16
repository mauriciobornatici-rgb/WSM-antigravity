import { Save, Loader2, Terminal } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { CompanySettings } from "@/types"
import { DEFAULT_COMPANY_SETTINGS } from "@/lib/companySettings"

interface BillingSettingsTabProps {
    company: CompanySettings
    setCompany: React.Dispatch<React.SetStateAction<CompanySettings | null>>
    onSave: () => Promise<void>
    saving: boolean
    onTestConnection: () => Promise<void>
    testingConnection: boolean
    connectionLogs: string[]
}

export function BillingSettingsTab({
    company,
    setCompany,
    onSave,
    saving,
    onTestConnection,
    testingConnection,
    connectionLogs
}: BillingSettingsTabProps) {
    const billing = company.billing || DEFAULT_COMPANY_SETTINGS.billing!

    const updateBillingField = (key: keyof typeof billing, value: string | number) => {
        setCompany({
            ...company,
            billing: {
                ...billing,
                [key]: value
            }
        })
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Configuración de Facturación Electrónica ARCA (AFIP)</CardTitle>
                    <CardDescription>Establezca los parámetros impositivos y sus credenciales de seguridad para la conexión WSAA/WSFE.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold">Datos Impositivos</h3>
                            
                            <div className="space-y-2">
                                <Label htmlFor="iva_condition">Condición ante el IVA</Label>
                                <Select
                                    value={billing.iva_condition || 'Responsable Inscripto'}
                                    onValueChange={(val) => updateBillingField('iva_condition', val)}
                                >
                                    <SelectTrigger id="iva_condition">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Responsable Inscripto">IVA Responsable Inscripto</SelectItem>
                                        <SelectItem value="Monotributista">Responsable Monotributo</SelectItem>
                                        <SelectItem value="Exento">IVA Exento</SelectItem>
                                        <SelectItem value="Consumidor Final">Consumidor Final</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="iibb">Ingresos Brutos (IIBB)</Label>
                                <Input 
                                    id="iibb"
                                    placeholder="Exento / Convenio Multilateral / 901-..." 
                                    value={billing.iibb || ''} 
                                    onChange={e => updateBillingField('iibb', e.target.value)} 
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="start_date">Inicio de Actividades</Label>
                                <Input 
                                    id="start_date"
                                    type="date" 
                                    value={billing.start_date || ''} 
                                    onChange={e => updateBillingField('start_date', e.target.value)} 
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="pos">Punto de Venta (AFIP)</Label>
                                <Input 
                                    id="pos"
                                    type="number" 
                                    min={1}
                                    value={billing.pos || 1} 
                                    onChange={e => updateBillingField('pos', Number(e.target.value) || 1)} 
                                />
                                <p className="text-xs text-muted-foreground">Debe coincidir con el Punto de Venta electrónico habilitado en el portal de AFIP.</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="afip_env">Entorno de Conexión</Label>
                                <Select
                                    value={billing.afip_env || 'homologacion'}
                                    onValueChange={(val: 'homologacion' | 'produccion') => updateBillingField('afip_env', val)}
                                >
                                    <SelectTrigger id="afip_env">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="homologacion">Homologación (Pruebas / Sandbox)</SelectItem>
                                        <SelectItem value="produccion">Producción (Válido Fiscalmente ⚠️)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold">Credenciales Digitales (WSAA)</h3>
                            
                            <div className="space-y-2">
                                <Label htmlFor="afip_crt">Certificado Digital AFIP (.crt)</Label>
                                <textarea
                                    id="afip_crt"
                                    rows={6}
                                    className="w-full font-mono text-[11px] p-3 border rounded-md bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring"
                                    placeholder="-----BEGIN CERTIFICATE-----\nMIIEuzCCA6OgAwIBAgIDAgEwMA0GCSqGSIb3DQEBCwUAMIGMMQswCQYDVQQGEwJBU...\n-----END CERTIFICATE-----"
                                    value={billing.afip_crt || ''}
                                    onChange={e => updateBillingField('afip_crt', e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">Certificado X.509 emitido por la Autoridad Certificante de AFIP.</p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="afip_key">Clave Privada (.key)</Label>
                                <textarea
                                    id="afip_key"
                                    rows={6}
                                    className="w-full font-mono text-[11px] p-3 border rounded-md bg-muted/30 focus:outline-none focus:ring-2 focus:ring-ring"
                                    placeholder="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6sJpYyD5XWnF3...\n-----END PRIVATE KEY-----"
                                    value={billing.afip_key || ''}
                                    onChange={e => updateBillingField('afip_key', e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">Clave privada correspondiente al certificado generado.</p>
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-6 space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h4 className="font-semibold flex items-center gap-2"><Terminal className="h-4 w-4 text-blue-500" /> Banco de Pruebas de Comunicación</h4>
                                <p className="text-xs text-muted-foreground">Simula la autenticación en el WSAA y la consulta de estado en el WSFE.</p>
                            </div>
                            <Button 
                                type="button" 
                                variant="outline" 
                                className="border-blue-500/30 text-blue-500 hover:bg-blue-500/10" 
                                onClick={onTestConnection}
                                disabled={testingConnection}
                            >
                                {testingConnection ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Conectando...</> : "Testear Conexión con ARCA"}
                            </Button>
                        </div>

                        {connectionLogs.length > 0 && (
                            <div className="bg-slate-950 text-slate-100 font-mono text-xs p-4 rounded-lg border border-slate-800 max-h-64 overflow-y-auto space-y-1 scrollbar-thin">
                                <div className="flex justify-between text-[10px] text-slate-400 border-b border-slate-800 pb-2 mb-2">
                                    <span>ARCA SOAP SIMULATOR CONSOLE</span>
                                    <span>STATUS: {testingConnection ? 'RUNNING' : 'DONE'}</span>
                                </div>
                                {connectionLogs.map((log, index) => {
                                    let color = "text-slate-300"
                                    if (log.includes("[ERROR]")) color = "text-red-400 font-bold"
                                    else if (log.includes("[WARN]")) color = "text-yellow-400"
                                    else if (log.includes("[OK]")) color = "text-green-400"
                                    else if (log.includes("[WSAA]") || log.includes("[WSFE]")) color = "text-blue-400"
                                    return (
                                        <div key={index} className={`leading-relaxed ${color}`}>
                                            {log}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-4 border-t pt-4">
                    <Button onClick={onSave} disabled={saving}>
                        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</>}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    )
}
