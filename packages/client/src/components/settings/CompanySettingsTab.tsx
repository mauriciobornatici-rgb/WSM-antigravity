import { Save, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { CompanySettings } from "@/types"

interface CompanySettingsTabProps {
    company: CompanySettings
    setCompany: React.Dispatch<React.SetStateAction<CompanySettings | null>>
    onSave: () => Promise<void>
    saving: boolean
}

export function CompanySettingsTab({ company, setCompany, onSave, saving }: CompanySettingsTabProps) {
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Identidad Comercial</CardTitle>
                    <CardDescription>Datos que aparecerán en facturas y documentos oficiales.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Nombre de Fantasía</Label>
                            <Input 
                                value={company.identity.brand_name} 
                                onChange={e => setCompany({ ...company, identity: { ...company.identity, brand_name: e.target.value } })} 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Razón Social</Label>
                            <Input 
                                value={company.identity.legal_name} 
                                onChange={e => setCompany({ ...company, identity: { ...company.identity, legal_name: e.target.value } })} 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>CUIT / DNI</Label>
                            <Input 
                                value={company.identity.tax_id} 
                                onChange={e => setCompany({ ...company, identity: { ...company.identity, tax_id: e.target.value } })} 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Logo URL</Label>
                            <Input 
                                value={company.identity.logo_url} 
                                onChange={e => setCompany({ ...company, identity: { ...company.identity, logo_url: e.target.value } })} 
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Contacto y Dirección</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <Label>Teléfono</Label>
                            <Input 
                                value={company.contact.phone} 
                                onChange={e => setCompany({ ...company, contact: { ...company.contact, phone: e.target.value } })} 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Correo electronico</Label>
                            <Input 
                                value={company.contact.email} 
                                onChange={e => setCompany({ ...company, contact: { ...company.contact, email: e.target.value } })} 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Sitio web</Label>
                            <Input 
                                value={company.contact.website} 
                                onChange={e => setCompany({ ...company, contact: { ...company.contact, website: e.target.value } })} 
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                        <div className="space-y-2 md:col-span-4">
                            <Label>Calle y Altura</Label>
                            <Input 
                                value={`${company.address.street} ${company.address.number}`}
                                onChange={e => {
                                    setCompany({ ...company, address: { ...company.address, street: e.target.value } })
                                }}
                            />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <Label>Ciudad</Label>
                            <Input 
                                value={company.address.city} 
                                onChange={e => setCompany({ ...company, address: { ...company.address, city: e.target.value } })} 
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardFooter>
                    <Button className="ml-auto" onClick={onSave} disabled={saving}>
                        {saving ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...
                            </>
                        ) : (
                            <>
                                <Save className="mr-2 h-4 w-4" /> Guardar Cambios
                            </>
                        )}
                    </Button>
                </CardFooter>
            </Card>
        </div>
    )
}
