import { Save, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SystemSettings } from "@/types"

interface SystemSettingsTabProps {
    system: SystemSettings
    setSystem: React.Dispatch<React.SetStateAction<SystemSettings | null>>
    onSave: () => Promise<void>
    saving: boolean
}

export function SystemSettingsTab({
    system,
    setSystem,
    onSave,
    saving
}: SystemSettingsTabProps) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Preferencias Regionales y Operativas</CardTitle>
                    <CardDescription>Configuraciones globales que afectan el comportamiento del sistema.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Moneda Principal</Label>
                            <Select
                                value={system.regional.currency}
                                onValueChange={(val) => setSystem({ ...system, regional: { ...system.regional, currency: val } })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ARS">Peso Argentino (ARS)</SelectItem>
                                    <SelectItem value="USD">Dólar (USD)</SelectItem>
                                </SelectContent>
                            </Select>
                            <p className="text-[0.8rem] text-muted-foreground">Cambiar la moneda base puede afectar los reportes históricos.</p>
                        </div>
                        <div className="space-y-2">
                            <Label>Zona Horaria</Label>
                            <Select
                                value={system.regional.timezone}
                                onValueChange={(val) => setSystem({ ...system, regional: { ...system.regional, timezone: val } })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="America/Asuncion">America/Asuncion (GMT-4)</SelectItem>
                                    <SelectItem value="America/Argentina/Buenos_Aires">Buenos Aires (GMT-3)</SelectItem>
                                    <SelectItem value="America/New_York">New York (EST)</SelectItem>
                                    <SelectItem value="UTC">UTC</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Impuesto por Defecto (%)</Label>
                            <Input
                                type="number"
                                value={system.operation.default_tax_rate}
                                onChange={(e) => setSystem({ ...system, operation: { ...system.operation, default_tax_rate: Number(e.target.value) } })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Alerta de Stock Bajo (Unidades)</Label>
                            <Input
                                type="number"
                                value={system.operation.stock_warning_threshold}
                                onChange={(e) => setSystem({ ...system, operation: { ...system.operation, stock_warning_threshold: Number(e.target.value) } })}
                            />
                        </div>
                    </div>
                </CardContent>
                <CardFooter>
                    <Button className="ml-auto" onClick={onSave} disabled={saving}>
                        {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</>}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    )
}
