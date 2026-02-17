import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { api } from "@/services/api"
import type { Client } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Plus, Search, Phone, Mail, Building, Users, Pencil, Trash2, type LucideIcon } from "lucide-react"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { showErrorToast } from "@/lib/errorHandling"
import type { ClientUpsertInput } from "@/types/api"

export default function ClientsPage() {
    const navigate = useNavigate()
    const [clients, setClients] = useState<Client[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingClient, setEditingClient] = useState<Client | null>(null)
    const [deletingClient, setDeletingClient] = useState<Client | null>(null)

    useEffect(() => {
        loadClients()
    }, [])

    const loadClients = async () => {
        setLoading(true)
        try {
            const data = await api.getClients()
            setClients(data)
        } catch (error) {
            showErrorToast("Error al cargar clientes", error)
        } finally {
            setLoading(false)
        }
    }

    const filteredClients = clients.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.tax_id.includes(search) ||
        c.email?.toLowerCase().includes(search.toLowerCase())
    )

    const handleCreateClient = async (data: ClientFormValues) => {
        try {
            const payload: ClientUpsertInput = {
                name: data.name,
                email: data.email,
                phone: data.phone,
                tax_id: data.tax_id,
                address: data.address,
                credit_limit: data.credit_limit
            }
            await api.createClient(payload)
            await loadClients()
            setIsCreateOpen(false)
            toast.success("Cliente Registrado", { description: `${data.name} ha sido agregado correctamente.` })
        } catch (error) {
            showErrorToast("Error al crear cliente", error)
        }
    }

    const handleUpdateClient = async (data: ClientFormValues) => {
        if (!editingClient) return
        try {
            const payload: ClientUpsertInput = {
                name: data.name,
                email: data.email,
                phone: data.phone,
                tax_id: data.tax_id,
                address: data.address,
                credit_limit: data.credit_limit
            }
            await api.updateClient(editingClient.id, payload)
            await loadClients()
            setEditingClient(null)
            toast.success("Cliente Actualizado", { description: `${data.name} ha sido actualizado correctamente.` })
        } catch (error) {
            showErrorToast("Error al actualizar cliente", error)
        }
    }

    const handleDeleteClient = async () => {
        if (!deletingClient) return
        try {
            await api.deleteClient(deletingClient.id)
            await loadClients()
            setDeletingClient(null)
            toast.success("Cliente Eliminado", { description: `${deletingClient.name} ha sido eliminado correctamente.` })
        } catch (error) {
            showErrorToast("Error al eliminar cliente", error)
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Clientes</h2>
                    <p className="text-muted-foreground">Gestión de cartera de clientes y cuentas corrientes.</p>
                </div>
                <CreateClientDialog
                    open={isCreateOpen}
                    onOpenChange={setIsCreateOpen}
                    onSubmit={handleCreateClient}
                />
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <StatusCard
                    title="Total Clientes"
                    count={clients.length}
                    icon={Users}
                    description="Registrados"
                />
                <StatusCard
                    title="Cuentas Activas"
                    count={clients.filter(c => c.current_account_balance > 0).length}
                    icon={Building}
                    description="Con saldo deudor"
                    color="text-orange-500"
                />
                <StatusCard
                    title="Cartera Total"
                    count={new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG' }).format(clients.reduce((acc, c) => acc + c.current_account_balance, 0))}
                    icon={Building}
                    description="Deuda total exigible"
                    color="text-green-500"
                    isCurrency
                />
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Directorio</CardTitle>
                    <CardDescription>Lista completa de clientes registrados.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center py-4">
                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar por nombre, RUC o email..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-8"
                            />
                        </div>
                    </div>

                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Contacto</TableHead>
                                    <TableHead>RUC / ID</TableHead>
                                    <TableHead className="text-right">Saldo Cta Cte</TableHead>
                                    <TableHead className="text-right">Límite Crédito</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">Cargando clientes...</TableCell>
                                    </TableRow>
                                ) : filteredClients.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">No se encontraron clientes.</TableCell>
                                    </TableRow>
                                ) : (
                                    filteredClients.map((client) => (
                                        <TableRow key={client.id}>
                                            <TableCell className="font-medium">
                                                <div className="flex items-center gap-2">
                                                    <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-blue-400 font-bold">
                                                        {client.name.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <div>{client.name}</div>
                                                        <div className="text-xs text-muted-foreground">{client.address}</div>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-sm flex flex-col gap-1">
                                                    <div className="flex items-center gap-1 text-muted-foreground">
                                                        <Mail className="h-3 w-3" /> {client.email}
                                                    </div>
                                                    <div className="flex items-center gap-1 text-muted-foreground">
                                                        <Phone className="h-3 w-3" /> {client.phone}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-mono">{client.tax_id}</TableCell>
                                            <TableCell className="text-right">
                                                <Badge variant={client.current_account_balance > 0 ? "secondary" : "outline"} className={cn(
                                                    "font-mono",
                                                    client.current_account_balance > client.credit_limit ? "bg-red-900 text-red-200" : ""
                                                )}>
                                                    {new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG' }).format(client.current_account_balance)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-mono text-muted-foreground">
                                                {new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG' }).format(client.credit_limit)}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button size="sm" variant="ghost" onClick={() => setEditingClient(client)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 hover:bg-red-950" onClick={() => setDeletingClient(client)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                    <Button size="sm" variant="ghost" onClick={() => navigate(`/clients/${client.id}`)}>Ver Detalles</Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Edit Dialog */}
            {editingClient && (
                <EditClientDialog
                    client={editingClient}
                    open={!!editingClient}
                    onOpenChange={(open) => !open && setEditingClient(null)}
                    onSubmit={handleUpdateClient}
                />
            )}

            {/* Delete Confirmation Dialog */}
            {deletingClient && (
                <DeleteClientDialog
                    client={deletingClient}
                    open={!!deletingClient}
                    onOpenChange={(open) => !open && setDeletingClient(null)}
                    onConfirm={handleDeleteClient}
                />
            )}
        </div>
    )
}

interface ClientFormValues {
    name: string
    email: string
    phone: string
    tax_id: string
    address: string
    credit_limit: number
}

function StatusCard({ title, count, icon: Icon, description, color, isCurrency }: { title: string, count: number | string, icon: LucideIcon, description: string, color?: string, isCurrency?: boolean }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className={cn("h-4 w-4", color || "text-blue-500")} />
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold">
                    {isCurrency && typeof count === 'number'
                        ? new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG' }).format(count)
                        : count}
                </div>
                <p className="text-xs text-muted-foreground">{description}</p>
            </CardContent>
        </Card>
    )
}

function CreateClientDialog({ open, onOpenChange, onSubmit }: { open: boolean, onOpenChange: (open: boolean) => void, onSubmit: (data: ClientFormValues) => Promise<void> }) {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        phone: "",
        tax_id: "",
        address: "",
        credit_limit: "5000000"
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const data = {
            ...formData,
            credit_limit: parseFloat(formData.credit_limit)
        }
        onSubmit(data)
        setFormData({ name: "", email: "", phone: "", tax_id: "", address: "", credit_limit: "5000000" })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button className="gap-2">
                    <Plus className="h-4 w-4" /> Nuevo Cliente
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Registrar Nuevo Cliente</DialogTitle>
                    <DialogDescription>
                        Complete los datos fiscales y de contacto del cliente.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="name" className="text-right">Nombre</Label>
                        <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="col-span-3" required />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="tax_id" className="text-right">RUC / CI</Label>
                        <Input id="tax_id" value={formData.tax_id} onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })} className="col-span-3" required />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="email" className="text-right">Email</Label>
                        <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="phone" className="text-right">Teléfono</Label>
                        <Input id="phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="address" className="text-right">Dirección</Label>
                        <Input id="address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="limit" className="text-right">Línea Crédito</Label>
                        <Input id="limit" type="number" value={formData.credit_limit} onChange={(e) => setFormData({ ...formData, credit_limit: e.target.value })} className="col-span-3" />
                    </div>
                    <Button type="submit" className="ml-auto bg-blue-600 hover:bg-blue-500">Registrar Cliente</Button>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function EditClientDialog({ client, open, onOpenChange, onSubmit }: { client: Client, open: boolean, onOpenChange: (open: boolean) => void, onSubmit: (data: ClientFormValues) => Promise<void> }) {
    const [formData, setFormData] = useState({
        name: client.name,
        email: client.email || "",
        phone: client.phone || "",
        tax_id: client.tax_id,
        address: client.address || "",
        credit_limit: client.credit_limit.toString()
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const data = {
            ...formData,
            credit_limit: parseFloat(formData.credit_limit)
        }
        onSubmit(data)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Editar Cliente</DialogTitle>
                    <DialogDescription>
                        Actualice los datos del cliente {client.name}.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-name" className="text-right">Nombre</Label>
                        <Input id="edit-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="col-span-3" required />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-tax_id" className="text-right">RUC / CI</Label>
                        <Input id="edit-tax_id" value={formData.tax_id} onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })} className="col-span-3" required />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-email" className="text-right">Email</Label>
                        <Input id="edit-email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-phone" className="text-right">Teléfono</Label>
                        <Input id="edit-phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-address" className="text-right">Dirección</Label>
                        <Input id="edit-address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="col-span-3" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="edit-limit" className="text-right">Línea Crédito</Label>
                        <Input id="edit-limit" type="number" value={formData.credit_limit} onChange={(e) => setFormData({ ...formData, credit_limit: e.target.value })} className="col-span-3" />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                        <Button type="submit" className="bg-blue-600 hover:bg-blue-500">Guardar Cambios</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function DeleteClientDialog({ client, open, onOpenChange, onConfirm }: { client: Client, open: boolean, onOpenChange: (open: boolean) => void, onConfirm: () => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="text-red-400">¿Eliminar Cliente?</DialogTitle>
                    <DialogDescription>
                        Esta acción eliminará permanentemente al cliente <strong>{client.name}</strong>.
                        {client.current_account_balance > 0 && (
                            <span className="block mt-2 text-yellow-400">
                                ⚠️ Este cliente tiene un saldo pendiente de {new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG' }).format(client.current_account_balance)}
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button variant="destructive" onClick={onConfirm} className="bg-red-600 hover:bg-red-500">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Eliminar Cliente
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
