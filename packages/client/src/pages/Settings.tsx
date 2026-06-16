import { useState, useEffect, useCallback } from "react"
import { api } from "@/services/api"
import type { CompanySettings, SystemSettings, User, Product, FailedSync } from "@/types"
import type { AuditLogEntry, PaginationMeta, UserCreateInput, UserFormValues, UserUpdateInput } from "@/types/api"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Building2, Users, Settings2, Loader2, History, ReceiptText, Store } from "lucide-react"
import { UserForm } from "@/components/users/UserForm"
import { toast } from "sonner"
import { useAuth } from "@/context/AuthContext"
import { showErrorToast } from "@/lib/errorHandling"
import { DEFAULT_COMPANY_SETTINGS, normalizeCompanySettings } from "@/lib/companySettings"

// Extracted Tab Components
import { CompanySettingsTab } from "@/components/settings/CompanySettingsTab"
import { BillingSettingsTab } from "@/components/settings/BillingSettingsTab"
import { UsersManagementTab } from "@/components/settings/UsersManagementTab"
import { AuditLogTab } from "@/components/settings/AuditLogTab"
import { SystemSettingsTab } from "@/components/settings/SystemSettingsTab"
import { TiendanubeSettingsTab } from "@/components/settings/TiendanubeSettingsTab"

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
const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001"

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
    const [testingConnection, setTestingConnection] = useState(false)
    const [connectionLogs, setConnectionLogs] = useState<string[]>([])

    // Tienda Nube State
    const [tiendanubeProducts, setTiendanubeProducts] = useState<Product[]>([])
    const [tiendanubeLoading, setTiendanubeLoading] = useState(false)
    const [tiendanubeSaving, setTiendanubeSaving] = useState(false)
    const [tiendanubeModifications, setTiendanubeModifications] = useState<Record<string, {
        tiendanube_sync_enabled: boolean
        tiendanube_product_id: string
        tiendanube_variant_id: string
    }>>({})
    const [syncingTN, setSyncingTN] = useState(false)
    const [autoLinkingTN, setAutoLinkingTN] = useState(false)

    // Failed Syncs State
    const [failedSyncs, setFailedSyncs] = useState<FailedSync[]>([])
    const [failedSyncsLoading, setFailedSyncsLoading] = useState(false)
    const [processingSyncId, setProcessingSyncId] = useState<string | null>(null)
    const [processingAllSyncs, setProcessingAllSyncs] = useState(false)

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

    const loadTiendanubeProducts = useCallback(async () => {
        setTiendanubeLoading(true)
        try {
            const response = await api.inventory.getProducts()
            setTiendanubeProducts(response)
        } catch (error) {
            showErrorToast("Error al cargar productos para Tienda Nube", error)
        } finally {
            setTiendanubeLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadTiendanubeProducts()
    }, [loadTiendanubeProducts])

    const handleSaveTiendaNubeLinks = async () => {
        const modifiedProducts = Object.entries(tiendanubeModifications).map(([id, mods]) => ({
            id,
            tiendanube_sync_enabled: mods.tiendanube_sync_enabled,
            tiendanube_product_id: mods.tiendanube_product_id,
            tiendanube_variant_id: mods.tiendanube_variant_id
        }))

        if (modifiedProducts.length === 0) {
            toast.info("No hay cambios para guardar.")
            return
        }

        setTiendanubeSaving(true)
        try {
            await api.inventory.bulkUpdateTiendaNube(modifiedProducts)
            toast.success("Vinculación de productos actualizada")
            setTiendanubeModifications({})
            await loadTiendanubeProducts()
        } catch (error) {
            showErrorToast("Error al guardar vinculación de productos", error)
        } finally {
            setTiendanubeSaving(false)
        }
    }

    const handleTestConnection = async () => {
        if (!company || !company.billing) {
            toast.error("Guarde o complete los datos antes de probar la conexión")
            return
        }

        setTestingConnection(true)
        setConnectionLogs(["[SYS] Inicializando módulo de comunicación...", "[SYS] Cargando parámetros temporales de la pantalla..."])

        try {
            const result = await api.testAfipConnection(company.billing!)
            
            const currentLogs: string[] = []
            for (let i = 0; i < result.logs.length; i++) {
                await new Promise(resolve => setTimeout(resolve, 300))
                const logLine = result.logs[i]
                if (logLine) {
                    currentLogs.push(logLine)
                    setConnectionLogs([...currentLogs])
                }
            }

            if (result.success) {
                toast.success("¡Prueba de conexión con AFIP Exitosa!")
            } else {
                toast.error("La prueba de conexión con AFIP falló.")
            }
        } catch (error) {
            setConnectionLogs(prev => [...prev, `[CRITICAL ERROR] Error de red o comunicación: ${String(error)}`])
            toast.error("Error al testear la conexión.")
        } finally {
            setTestingConnection(false)
        }
    }

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

    const handleSyncTN = async () => {
        setSyncingTN(true)
        try {
            const res = await api.syncTiendanubeOrders()
            toast.success(`Sincronización manual completada. Se importaron ${res.syncedCount} pedidos faltantes.`)
        } catch (error) {
            showErrorToast("Error al sincronizar con Tienda Nube", error)
        } finally {
            setSyncingTN(false)
        }
    }

    const handleAutoLinkTN = async () => {
        setAutoLinkingTN(true)
        try {
            const res = await api.autoLinkTiendanubeCatalog()
            toast.success(`Vinculación completada con éxito. Variantes leídas de Tienda Nube: ${res.totalVariantsFound}. Enlazadas localmente: ${res.linkedCount}.`)
            await loadTiendanubeProducts()
        } catch (error) {
            showErrorToast("Error al auto-vincular catálogo", error)
        } finally {
            setAutoLinkingTN(false)
        }
    }

    const loadFailedSyncs = useCallback(async () => {
        setFailedSyncsLoading(true)
        try {
            const res = await api.getFailedSyncs()
            setFailedSyncs(res)
        } catch (error) {
            showErrorToast("Error al cargar cola de reintentos", error)
        } finally {
            setFailedSyncsLoading(false)
        }
    }, [])

    const handleRetrySync = async (id: string) => {
        setProcessingSyncId(id)
        try {
            await api.retryFailedSync(id)
            toast.success("Sincronización reintentada con éxito")
            await loadFailedSyncs()
        } catch (error) {
            showErrorToast("Error al reintentar sincronización", error)
        } finally {
            setProcessingSyncId(null)
        }
    }

    const handleRetryAllSyncs = async () => {
        setProcessingAllSyncs(true)
        try {
            await api.retryAllFailedSyncs()
            toast.success("Cola de reintentos ejecutada")
            await loadFailedSyncs()
        } catch (error) {
            showErrorToast("Error al procesar la cola de reintentos", error)
        } finally {
            setProcessingAllSyncs(false)
        }
    }

    useEffect(() => {
        void loadFailedSyncs()
    }, [loadFailedSyncs])

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
                    <TabsTrigger value="billing" className="flex shrink-0 gap-2"><ReceiptText className="h-4 w-4" /> Facturación</TabsTrigger>
                    {currentUser?.role === 'admin' && (
                        <TabsTrigger value="audit" className="flex shrink-0 gap-2"><History className="h-4 w-4" /> Auditoría</TabsTrigger>
                    )}
                    <TabsTrigger value="tiendanube" className="flex shrink-0 gap-2"><Store className="h-4 w-4" /> Tienda Nube</TabsTrigger>
                </TabsList>

                <TabsContent value="company">
                    <CompanySettingsTab
                        company={company}
                        setCompany={setCompany}
                        onSave={handleSaveCompany}
                        saving={saving}
                    />
                </TabsContent>

                <TabsContent value="billing">
                    <BillingSettingsTab
                        company={company}
                        setCompany={setCompany}
                        onSave={handleSaveCompany}
                        saving={saving}
                        onTestConnection={handleTestConnection}
                        testingConnection={testingConnection}
                        connectionLogs={connectionLogs}
                    />
                </TabsContent>

                <TabsContent value="users">
                    <UsersManagementTab
                        users={users}
                        currentUser={currentUser}
                        onOpenNewUserForm={openNewUserForm}
                        onOpenEditUserForm={openEditUserForm}
                        onDeleteUser={handleDeleteUser}
                    />
                </TabsContent>

                {currentUser?.role === 'admin' && (
                    <TabsContent value="audit">
                        <AuditLogTab
                            auditLogs={auditLogs}
                            auditLoading={auditLoading}
                            auditPagination={auditPagination}
                            auditPage={auditPage}
                            onPageChange={(nextPage) => setAuditPage(Math.max(1, nextPage))}
                        />
                    </TabsContent>
                )}

                <TabsContent value="system">
                    <SystemSettingsTab
                        system={system}
                        setSystem={setSystem}
                        onSave={handleSaveSystem}
                        saving={saving}
                    />
                </TabsContent>

                <TabsContent value="tiendanube">
                    <TiendanubeSettingsTab
                        company={company}
                        setCompany={setCompany}
                        onSaveCompany={handleSaveCompany}
                        saving={saving}
                        onSyncTN={handleSyncTN}
                        syncingTN={syncingTN}
                        onAutoLinkTN={handleAutoLinkTN}
                        autoLinkingTN={autoLinkingTN}
                        tiendanubeProducts={tiendanubeProducts}
                        tiendanubeLoading={tiendanubeLoading}
                        tiendanubeSaving={tiendanubeSaving}
                        onSaveTiendaNubeLinks={handleSaveTiendaNubeLinks}
                        tiendanubeModifications={tiendanubeModifications}
                        setTiendanubeModifications={setTiendanubeModifications}
                        apiBaseUrl={API_BASE_URL}
                        failedSyncs={failedSyncs}
                        failedSyncsLoading={failedSyncsLoading}
                        processingSyncId={processingSyncId}
                        processingAllSyncs={processingAllSyncs}
                        onRetrySync={handleRetrySync}
                        onRetryAllSyncs={handleRetryAllSyncs}
                    />
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
