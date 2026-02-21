import { useState, useEffect, useCallback } from "react"
import { api } from "@/services/api"
import type { CompanySettings, SystemSettings, User } from "@/types"
import type { AuditLogEntry, PaginationMeta, UserCreateInput, UserFormValues, UserUpdateInput } from "@/types/api"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, Users, Settings2, Save, Plus, Loader2, Pencil, Trash2, History, Eye } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { UserForm } from "@/components/users/UserForm"
import { toast } from "sonner"
import { useAuth } from "@/context/AuthContext"
import { safeJsonParse, showErrorToast } from "@/lib/errorHandling"
import { DEFAULT_COMPANY_SETTINGS, normalizeCompanySettings } from "@/lib/companySettings"
import { PaginationControls } from "@/components/common/PaginationControls"

const buildSystemSettings = (settings: CompanySettings): SystemSettings => ({
    regional: {
        currency: settings.operation.default_currency || 'ARS',
        timezone: 'America/Argentina/Buenos_Aires'
    },
    operation: {
        default_tax_rate: Number((settings.operation.tax_rate * 100).toFixed(2)),
        stock_warning_threshold: 5
    }
})

const AUDIT_PAGE_SIZE = 20

export default function SettingsPage() {
    const { user: currentUser } = useAuth()
    const [company, setCompany] = useState<CompanySettings | null>(null)
    const [system, setSystem] = useState<SystemSettings | null>(null)
    const [users, setUsers] = useState<User[]>([])
    const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([])
    const [auditPage, setAuditPage] = useState(1)
    const [auditPagination, setAuditPagination] = useState<PaginationMeta | null>(null)
    const [auditLoading, setAuditLoading] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // User Form State
    const [userFormOpen, setUserFormOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<User | undefined>(undefined)
    const [userLoading, setUserLoading] = useState(false)

    const loadData = useCallback(async () => {
        try {
            const [c, u] = await Promise.allSettled([
                api.getCompanySettings(),
                api.getUsers(),
            ])

            if (c.status === 'fulfilled') {
                const safeCompany = normalizeCompanySettings(c.value)
                setCompany(safeCompany)
                setSystem(buildSystemSettings(safeCompany))
            } else {
                setCompany(DEFAULT_COMPANY_SETTINGS)
                setSystem(buildSystemSettings(DEFAULT_COMPANY_SETTINGS))
            }
            if (u.status === 'fulfilled') setUsers(u.value)

            if (c.status === 'rejected') {
                showErrorToast("Error al cargar configuracion de empresa", c.reason)
            }
        } catch (error) {
            showErrorToast("Error critico al cargar configuraciones", error)
        } finally {
            setLoading(false)
        }
    }, [])

    const loadAuditLogs = useCallback(async (page: number) => {
        if (currentUser?.role !== 'admin') return

        setAuditLoading(true)
        try {
            const response = await api.getAuditLogsPage({
                page,
                limit: AUDIT_PAGE_SIZE
            })
            setAuditLogs(response.data)
            setAuditPagination(response.pagination ?? null)
        } catch (error) {
            showErrorToast("Error al cargar auditoria", error)
        } finally {
            setAuditLoading(false)
        }
    }, [currentUser?.role])

    useEffect(() => {
        void loadData()
    }, [loadData])

    useEffect(() => {
        if (currentUser?.role !== 'admin') return
        void loadAuditLogs(auditPage)
    }, [currentUser?.role, auditPage, loadAuditLogs])

    useEffect(() => {
        const totalPages = Math.max(1, Number(auditPagination?.totalPages || 1))
        if (auditPage > totalPages) {
            setAuditPage(totalPages)
        }
    }, [auditPage, auditPagination?.totalPages])

    const handleSaveCompany = async () => {
        if (!company) return
        setSaving(true)
        try {
            await api.updateCompanySettings(company)
            toast.success("Informacion de la empresa actualizada")
        } catch (error) {
            showErrorToast("Error al guardar", error)
        } finally {
            setSaving(false)
        }
    }

    const handleSaveSystem = async () => {
        if (!system || !company) return
        setSaving(true)
        try {
            const updatedCompany: CompanySettings = {
                ...company,
                operation: {
                    tax_rate: Math.min(1, Math.max(0, Number(system.operation.default_tax_rate || 0) / 100)),
                    default_currency: (system.regional.currency || 'ARS').toUpperCase()
                }
            }
            await api.updateCompanySettings(updatedCompany)
            setCompany(updatedCompany)
            toast.success("Configuración de sistema actualizada")
        } catch (error) {
            showErrorToast("Error al guardar configuracion de sistema", error)
        } finally {
            setSaving(false)
        }
    }

    // User Management Handlers
    const handleCreateUser = async (data: UserFormValues) => {
        setUserLoading(true)
        try {
            const payload: UserCreateInput = {
                name: data.name,
                email: data.email,
                password: data.password,
                role: data.role
            }
            await api.createUser(payload)
            toast.success("Usuario creado correctamente")
            setUserFormOpen(false)
            setEditingUser(undefined)
            // Reload users
            const updatedUsers = await api.getUsers()
            setUsers(updatedUsers)
        } catch (error) {
            showErrorToast("Error al crear usuario", error)
        } finally {
            setUserLoading(false)
        }
    }

    const handleUpdateUser = async (data: UserFormValues) => {
        if (!editingUser) return
        setUserLoading(true)
        try {
            const payload: UserUpdateInput = {
                name: data.name,
                email: data.email,
                role: data.role,
                status: data.status,
                ...(data.password ? { password: data.password } : {})
            }
            await api.updateUser(editingUser.id, payload)
            toast.success("Usuario actualizado correctamente")
            setUserFormOpen(false)
            setEditingUser(undefined)
            // Reload users
            const updatedUsers = await api.getUsers()
            setUsers(updatedUsers)
        } catch (error) {
            showErrorToast("Error al actualizar usuario", error)
        } finally {
            setUserLoading(false)
        }
    }

    const handleDeleteUser = async (id: string) => {
        if (!confirm("¿Está seguro de eliminar este usuario? Esta acción es irreversible.")) return
        try {
            await api.deleteUser(id)
            toast.success("Usuario eliminado")
            setUsers(users.filter(u => u.id !== id))
        } catch (error) {
            showErrorToast("Error al eliminar usuario", error)
        }
    }

    const openNewUserForm = () => {
        setEditingUser(undefined)
        setUserFormOpen(true)
    }

    const openEditUserForm = (user: User) => {
        setEditingUser(user)
        setUserFormOpen(true)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        )
    }

    if (!company || !system) {
        return (
            <div className="flex flex-col items-center justify-center h-screen space-y-4">
                <p className="text-muted-foreground">No se pudo cargar la configuración del sistema.</p>
                <Button onClick={loadData}>Reintentar</Button>
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Configuración</h1>
                    <p className="text-muted-foreground">Gestión de identidad, usuarios y preferencias del sistema.</p>
                </div>
            </div>

            <Tabs defaultValue="company" className="space-y-4">
                <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto p-1">
                    <TabsTrigger value="company" className="flex shrink-0 gap-2"><Building2 className="h-4 w-4" /> Empresa</TabsTrigger>
                    <TabsTrigger value="users" className="flex shrink-0 gap-2"><Users className="h-4 w-4" /> Usuarios</TabsTrigger>
                    <TabsTrigger value="system" className="flex shrink-0 gap-2"><Settings2 className="h-4 w-4" /> Sistema</TabsTrigger>
                    {currentUser?.role === 'admin' && (
                        <TabsTrigger value="audit" className="flex shrink-0 gap-2"><History className="h-4 w-4" /> Auditoría</TabsTrigger>
                    )}
                </TabsList>

                {/* --- COMPANY TAB --- */}
                <TabsContent value="company" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Identidad Comercial</CardTitle>
                            <CardDescription>Datos que aparecerán en facturas y documentos oficiales.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Nombre de Fantasía</Label>
                                    <Input value={company.identity.brand_name} onChange={e => setCompany({ ...company, identity: { ...company.identity, brand_name: e.target.value } })} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Razón Social</Label>
                                    <Input value={company.identity.legal_name} onChange={e => setCompany({ ...company, identity: { ...company.identity, legal_name: e.target.value } })} />
                                </div>
                                <div className="space-y-2">
                                    <Label>CUIT / DNI</Label>
                                    <Input value={company.identity.tax_id} onChange={e => setCompany({ ...company, identity: { ...company.identity, tax_id: e.target.value } })} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Logo URL</Label>
                                    <Input value={company.identity.logo_url} onChange={e => setCompany({ ...company, identity: { ...company.identity, logo_url: e.target.value } })} />
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
                                    <Input value={company.contact.phone} onChange={e => setCompany({ ...company, contact: { ...company.contact, phone: e.target.value } })} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Correo electronico</Label>
                                    <Input value={company.contact.email} onChange={e => setCompany({ ...company, contact: { ...company.contact, email: e.target.value } })} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Sitio web</Label>
                                    <Input value={company.contact.website} onChange={e => setCompany({ ...company, contact: { ...company.contact, website: e.target.value } })} />
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
                                <div className="space-y-2 md:col-span-4">
                                    <Label>Calle y Altura</Label>
                                    <Input value={`${company.address.street} ${company.address.number}`}
                                        onChange={e => {
                                            setCompany({ ...company, address: { ...company.address, street: e.target.value } })
                                        }}
                                    />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                    <Label>Ciudad</Label>
                                    <Input value={company.address.city} onChange={e => setCompany({ ...company, address: { ...company.address, city: e.target.value } })} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardFooter>
                            <Button className="ml-auto" onClick={handleSaveCompany} disabled={saving}>
                                {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</>}
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>

                {/* --- USERS TAB --- */}
                <TabsContent value="users" className="space-y-6">
                    <Card>
                        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle>Gestión de Usuarios</CardTitle>
                                <CardDescription>Administre roles y accesos al sistema.</CardDescription>
                            </div>
                            <Button className="w-full sm:w-auto" onClick={openNewUserForm}><Plus className="mr-2 h-4 w-4" /> Nuevo Usuario</Button>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <Table className="min-w-[820px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Nombre</TableHead>
                                        <TableHead>Correo electronico</TableHead>
                                        <TableHead>Rol</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead>Último Acceso</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {users.map((user) => (
                                        <TableRow key={user.id}>
                                            <TableCell className="font-medium">{user.name}</TableCell>
                                            <TableCell>{user.email}</TableCell>
                                            <TableCell className="capitalize">{user.role}</TableCell>
                                            <TableCell>
                                                <div className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${user.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}`}>
                                                    {user.status === 'active' ? 'Activo' : 'Inactivo'}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {user.last_login ? new Date(user.last_login).toLocaleString() : 'Nunca'}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="ghost" size="icon" onClick={() => openEditUserForm(user)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>

                                                    {currentUser?.id !== user.id && (
                                                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600 hover:bg-red-100" onClick={() => handleDeleteUser(user.id)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* --- AUDIT LOGS TAB --- */}
                {currentUser?.role === 'admin' && (
                    <TabsContent value="audit" className="space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Historial de Modificaciones</CardTitle>
                                <CardDescription>Registro completo de acciones realizadas por los usuarios en el sistema.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <Table className="min-w-[900px]">
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Fecha</TableHead>
                                            <TableHead>Usuario</TableHead>
                                            <TableHead>Acción</TableHead>
                                            <TableHead>Entidad</TableHead>
                                            <TableHead>IP</TableHead>
                                            <TableHead className="text-right">Detalles</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {auditLoading ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                    Cargando auditoria...
                                                </TableCell>
                                            </TableRow>
                                        ) : auditLogs.length === 0 ? (
                                            <TableRow>
                                                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                                    No hay registros de auditoría disponibles.
                                                </TableCell>
                                            </TableRow>
                                        ) : (
                                            auditLogs.map((log) => (
                                                <TableRow key={log.id}>
                                                    <TableCell className="text-sm">
                                                        {new Date(log.created_at).toLocaleString()}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{log.user_name || 'Sistema'}</span>
                                                            <span className="text-xs text-muted-foreground">{log.user_email || ''}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-semibold uppercase">
                                                            {log.action.replace(/_/g, ' ')}
                                                        </code>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col">
                                                            <span className="capitalize">{log.entity_type}</span>
                                                            <span className="text-[10px] font-mono text-muted-foreground">{log.entity_id}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">
                                                        {log.ip_address || '-'}
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <Dialog>
                                                            <DialogTrigger asChild>
                                                                <Button variant="ghost" size="icon">
                                                                    <Eye className="h-4 w-4" />
                                                                </Button>
                                                            </DialogTrigger>
                                                            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                                                                <DialogHeader>
                                                                    <DialogTitle>Detalles del Cambio</DialogTitle>
                                                                    <DialogDescription>
                                                                        Acción: {log.action} | Ejecutado por: {log.user_name || 'Sistema'}
                                                                    </DialogDescription>
                                                                </DialogHeader>
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                                                    <div className="space-y-2">
                                                                        <h4 className="text-sm font-semibold">Valores Anteriores</h4>
                                                                        <pre className="bg-muted p-3 rounded text-[10px] overflow-auto max-h-48 border">
                                                                            {log.old_values
                                                                                ? JSON.stringify(safeJsonParse(log.old_values), null, 2)
                                                                                : 'Ninguno'}
                                                                        </pre>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <h4 className="text-sm font-semibold text-green-600">Nuevos Valores</h4>
                                                                        <pre className="bg-green-50/50 dark:bg-green-950/20 p-3 rounded text-[10px] overflow-auto max-h-48 border border-green-200 dark:border-green-800">
                                                                            {log.new_values
                                                                                ? JSON.stringify(safeJsonParse(log.new_values), null, 2)
                                                                                : 'Ninguno'}
                                                                        </pre>
                                                                    </div>
                                                                </div>
                                                            </DialogContent>
                                                        </Dialog>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        )}
                                    </TableBody>
                                    </Table>
                                </div>
                                <PaginationControls
                                    page={Math.max(1, Number(auditPagination?.page || auditPage))}
                                    totalPages={Math.max(1, Number(auditPagination?.totalPages || 1))}
                                    totalCount={Number(auditPagination?.totalCount || auditLogs.length)}
                                    itemLabel="registro"
                                    isLoading={auditLoading}
                                    onPageChange={(nextPage) => setAuditPage(Math.max(1, nextPage))}
                                />
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                {/* --- SYSTEM TAB --- */}
                <TabsContent value="system" className="space-y-6">
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
                            <Button className="ml-auto" onClick={handleSaveSystem} disabled={saving}>
                                {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar Cambios</>}
                            </Button>
                        </CardFooter>
                    </Card>
                </TabsContent>
            </Tabs>

            <UserForm
                open={userFormOpen}
                onOpenChange={setUserFormOpen}
                onSubmit={editingUser ? handleUpdateUser : handleCreateUser}
                isLoading={userLoading}
                {...(editingUser ? { initialData: editingUser } : {})}
            />
        </div>
    )
}

