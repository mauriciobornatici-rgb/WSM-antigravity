import { useState, useEffect } from "react"
import { api } from "@/services/api"
import type { Supplier, SupplierPayment, PurchaseOrder, Transaction } from "@/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, Search, Truck, Phone, Mail, MapPin, Star, CreditCard, DollarSign, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { SupplierPaymentForm } from "@/components/suppliers/SupplierPaymentForm"
import { showErrorToast } from "@/lib/errorHandling"
import type { SupplierPaymentCreateInput, SupplierUpsertInput } from "@/types/api"

export default function SuppliersPage() {
    const [suppliers, setSuppliers] = useState<Supplier[]>([])
    const [searchQuery, setSearchQuery] = useState("")
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
    const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null)
    const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null)
    const [newSupplier, setNewSupplier] = useState({
        name: "",
        tax_id: "",
        contact_name: "",
        email: "",
        phone: "",
        address: "",
        category: "General",
        account_balance: 0
    })

    useEffect(() => {
        loadSuppliers()
    }, [])

    const loadSuppliers = async () => {
        try {
            const data = await api.getSuppliers()
            setSuppliers(data)
        } catch (error) {
            showErrorToast("Error al cargar proveedores", error)
        }
    }

    const handleCreateSupplier = async () => {
        if (!newSupplier.name || !newSupplier.tax_id) return

        try {
            const payload: SupplierUpsertInput = {
                name: newSupplier.name,
                tax_id: newSupplier.tax_id,
                contact_name: newSupplier.contact_name,
                email: newSupplier.email,
                phone: newSupplier.phone,
                address: newSupplier.address
            }
            await api.createSupplier(payload)
            toast.success("Proveedor agregado exitosamente")
            setIsAddDialogOpen(false)
            setNewSupplier({ name: "", tax_id: "", contact_name: "", email: "", phone: "", address: "", category: "General", account_balance: 0 })
            await loadSuppliers()
        } catch (error) {
            showErrorToast("Error al crear proveedor", error)
        }
    }

    const handleUpdateSupplier = async (data: SupplierUpsertInput) => {
        if (!editingSupplier) return
        try {
            await api.updateSupplier(editingSupplier.id, data)
            toast.success("Proveedor actualizado", { description: `${data.name} ha sido actualizado correctamente.` })
            setEditingSupplier(null)
            await loadSuppliers()
        } catch (error) {
            showErrorToast("Error al actualizar proveedor", error)
        }
    }

    const handleDeleteSupplier = async () => {
        if (!deletingSupplier) return
        try {
            await api.deleteSupplier(deletingSupplier.id)
            toast.success("Proveedor eliminado", { description: `${deletingSupplier.name} ha sido eliminado correctamente.` })
            setDeletingSupplier(null)
            await loadSuppliers()
        } catch (error) {
            showErrorToast("Error al eliminar proveedor", error)
        }
    }

    const filteredSuppliers = suppliers.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.tax_id.includes(searchQuery) ||
        s.category.toLowerCase().includes(searchQuery.toLowerCase())
    )


    const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
    const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([])
    const [supplierOrders, setSupplierOrders] = useState<PurchaseOrder[]>([])
    const [supplierTransactions, setSupplierTransactions] = useState<Transaction[]>([])
    const [showPaymentForm, setShowPaymentForm] = useState(false)
    const [loadingDetails, setLoadingDetails] = useState(false)

    const loadSupplierDetails = async (supplierId: string) => {
        setLoadingDetails(true)
        try {
            const [payments, orders, transactions] = await Promise.all([
                api.getSupplierPayments(supplierId),
                api.getPurchaseOrders({ supplier_id: supplierId }),
                api.getTransactions({ supplier_id: supplierId })
            ])
            setSupplierPayments(payments)
            setSupplierOrders(orders)
            setSupplierTransactions(transactions)
        } catch (error) {
            showErrorToast("Error al cargar detalles", error)
        } finally {
            setLoadingDetails(false)
        }
    }

    const handleRegisterPayment = async (data: SupplierPaymentCreateInput) => {
        try {
            await api.createSupplierPayment(data)
            toast.success('Pago registrado', { description: 'El pago ha sido registrado exitosamente' })
            setShowPaymentForm(false)
            // Reload supplier details and refresh suppliers list
            if (selectedSupplier) {
                await loadSupplierDetails(selectedSupplier.id)
            }
            await loadSuppliers()
        } catch (error) {
            showErrorToast("Error al registrar pago", error)
            throw error
        }
    }
    // Load extra details when a supplier is selected
    useEffect(() => {
        if (selectedSupplier) {
            loadSupplierDetails(selectedSupplier.id)
        }
    }, [selectedSupplier])


    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Proveedores</h1>
                    <p className="text-muted-foreground">Gestión de proveedores y socios comerciales.</p>
                </div>
                {/* Add Dialog Trigger... same as before */}
                <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-blue-600 hover:bg-blue-700">
                            <Plus className="mr-2 h-4 w-4" /> Nuevo Proveedor
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>Agregar Nuevo Proveedor</DialogTitle>
                            <DialogDescription>
                                Complete la información del nuevo proveedor.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Nombre / Razón Social *</Label>
                                    <Input value={newSupplier.name} onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })} placeholder="Ej: Nike Dist" />
                                </div>
                                <div className="space-y-2">
                                    <Label>RUC / Tax ID *</Label>
                                    <Input value={newSupplier.tax_id} onChange={e => setNewSupplier({ ...newSupplier, tax_id: e.target.value })} placeholder="80012345-1" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Contacto</Label>
                                    <Input value={newSupplier.contact_name} onChange={e => setNewSupplier({ ...newSupplier, contact_name: e.target.value })} placeholder="Nombre de contacto" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Categoría</Label>
                                    <Input value={newSupplier.category} onChange={e => setNewSupplier({ ...newSupplier, category: e.target.value })} placeholder="Ej: Calzado, Logística" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Email</Label>
                                    <Input value={newSupplier.email} onChange={e => setNewSupplier({ ...newSupplier, email: e.target.value })} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Teléfono</Label>
                                    <Input value={newSupplier.phone} onChange={e => setNewSupplier({ ...newSupplier, phone: e.target.value })} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Dirección</Label>
                                <Input value={newSupplier.address} onChange={e => setNewSupplier({ ...newSupplier, address: e.target.value })} />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button onClick={handleCreateSupplier} disabled={!newSupplier.name || !newSupplier.tax_id}>Guardar Proveedor</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Supplier Details Dialog */}
            <Dialog open={!!selectedSupplier} onOpenChange={(open) => !open && setSelectedSupplier(null)}>
                <DialogContent className="sm:max-w-[800px]">
                    <DialogHeader>
                        <DialogTitle>{selectedSupplier?.name}</DialogTitle>
                        <DialogDescription>{selectedSupplier?.tax_id} - {selectedSupplier?.category}</DialogDescription>
                    </DialogHeader>

                    {selectedSupplier && (
                        <div className="py-4">
                            <Tabs defaultValue="account">
                                <TabsList className="grid w-full grid-cols-3">
                                    <TabsTrigger value="account">Cuenta Corriente</TabsTrigger>
                                    <TabsTrigger value="orders">Historial Compras</TabsTrigger>
                                    <TabsTrigger value="info">Información</TabsTrigger>
                                </TabsList>

                                <TabsContent value="account" className="space-y-4 pt-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <Card>
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm font-medium text-muted-foreground">Saldo Pendiente</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="text-2xl font-bold flex items-center gap-2">
                                                    <DollarSign className="h-5 w-5 text-green-600" />
                                                    ${(selectedSupplier.account_balance || 0).toLocaleString()}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">A favor del proveedor</p>
                                            </CardContent>
                                        </Card>
                                        <Card>
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm font-medium text-muted-foreground">Pagos Realizados</CardTitle>
                                            </CardHeader>
                                            <CardContent>
                                                <div className="text-2xl font-bold flex items-center gap-2">
                                                    <CreditCard className="h-5 w-5 text-blue-600" />
                                                    ${supplierPayments.reduce((acc, p) => acc + Number(p.amount), 0).toLocaleString()}
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-1">{supplierPayments.length} transacciones</p>
                                            </CardContent>
                                        </Card>
                                    </div>

                                    <div className="mt-6 border rounded-lg">
                                        <div className="flex justify-between items-center p-4 border-b">
                                            <h4 className="text-sm font-semibold">Movimientos de Cuenta (Libro Mayor)</h4>
                                            <Button onClick={() => setShowPaymentForm(true)} size="sm">
                                                <Plus className="h-4 w-4 mr-2" />
                                                Registrar Pago
                                            </Button>
                                        </div>
                                        {loadingDetails ? (
                                            <div className="p-8 flex justify-center">
                                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                                            </div>
                                        ) : supplierTransactions.length > 0 ? (
                                            <Table>
                                                <TableHeader>
                                                    <TableRow>
                                                        <TableHead>Fecha</TableHead>
                                                        <TableHead>Descripción</TableHead>
                                                        <TableHead className="text-right">Haber (Deuda)</TableHead>
                                                        <TableHead className="text-right">Debe (Pago)</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {supplierTransactions.map(t => (
                                                        <TableRow key={t.id}>
                                                            <TableCell>{new Date(t.date).toLocaleDateString()} {new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                                                            <TableCell>
                                                                <div className="font-medium text-xs">{t.description}</div>
                                                                {t.reference_id && <div className="text-[10px] text-muted-foreground font-mono">{t.reference_id}</div>}
                                                            </TableCell>
                                                            <TableCell className="text-right text-red-600 font-medium">
                                                                {t.type === 'purchase' ? `$${Number(t.amount).toLocaleString()}` : '-'}
                                                            </TableCell>
                                                            <TableCell className="text-right text-green-600 font-medium">
                                                                {t.type === 'expense' ? `$${Number(t.amount).toLocaleString()}` : '-'}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        ) : (
                                            <div className="p-8 text-center text-muted-foreground">
                                                <CreditCard className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                                <p>No hay movimientos registrados en la cuenta</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Payment Form Dialog */}
                                    <Dialog open={showPaymentForm} onOpenChange={setShowPaymentForm}>
                                        <DialogContent className="max-w-2xl">
                                            <DialogHeader>
                                                <DialogTitle>Registrar Pago a Proveedor</DialogTitle>
                                                <DialogDescription>
                                                    Completa los datos del pago realizado a {selectedSupplier.name}
                                                </DialogDescription>
                                            </DialogHeader>
                                            <SupplierPaymentForm
                                                supplier={selectedSupplier}
                                                onSubmit={handleRegisterPayment}
                                                onCancel={() => setShowPaymentForm(false)}
                                            />
                                        </DialogContent>
                                    </Dialog>
                                </TabsContent>

                                <TabsContent value="orders" className="space-y-4 pt-4">
                                    <div className="border rounded-md">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>ID Orden</TableHead>
                                                    <TableHead>Fecha</TableHead>
                                                    <TableHead>Monto</TableHead>
                                                    <TableHead>Estado</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {supplierOrders.map(o => (
                                                    <TableRow key={o.id}>
                                                        <TableCell className="font-mono">{o.id}</TableCell>
                                                        <TableCell>{new Date(o.order_date || o.date || Date.now()).toLocaleDateString()}</TableCell>
                                                        <TableCell>${o.total_amount.toLocaleString()}</TableCell>
                                                        <TableCell>
                                                            <Badge variant={o.status === 'completed' || o.status === 'received' ? 'default' : 'outline'}>{o.status}</Badge>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                                {supplierOrders.length === 0 && (
                                                    <TableRow><TableCell colSpan={4} className="text-center h-16">No hay órdenes registradas</TableCell></TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </TabsContent>

                                <TabsContent value="info" className="space-y-4 pt-4">
                                    <div className="grid grid-cols-2 gap-4 text-sm">
                                        <div className="space-y-1">
                                            <Label className="text-muted-foreground">Razón Social</Label>
                                            <p>{selectedSupplier.name}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-muted-foreground">RUC / Tax ID</Label>
                                            <p>{selectedSupplier.tax_id}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-muted-foreground">Dirección</Label>
                                            <p>{selectedSupplier.address}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-muted-foreground">Contacto</Label>
                                            <p>{selectedSupplier.contact_name}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-muted-foreground">Teléfono</Label>
                                            <p>{selectedSupplier.phone}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-muted-foreground">Email</Label>
                                            <p>{selectedSupplier.email}</p>
                                        </div>
                                    </div>
                                </TabsContent>
                            </Tabs>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Card>
                <CardHeader>
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por nombre, RUC o categoría..."
                            className="pl-8"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredSuppliers.map(supplier => (
                            <Card key={supplier.id} className="overflow-hidden hover:shadow-md transition-shadow">
                                <CardHeader className="pb-3 bg-slate-50 dark:bg-slate-900 border-b">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                {supplier.name}
                                                {supplier.active && <Badge variant="secondary" className="bg-green-100 text-green-700 text-[10px] h-5">Activo</Badge>}
                                            </CardTitle>
                                            <CardDescription className="font-mono text-xs mt-1">{supplier.tax_id}</CardDescription>
                                        </div>
                                        <div className="flex items-center bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full text-xs font-bold">
                                            <Star className="h-3 w-3 mr-1 fill-current" /> {supplier.rating}
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="pt-4 space-y-3 text-sm">
                                    <div className="flex items-center text-muted-foreground">
                                        <MapPin className="h-4 w-4 mr-2 shrink-0" />
                                        <span className="truncate">{supplier.address}</span>
                                    </div>
                                    <div className="flex items-center text-muted-foreground">
                                        <Truck className="h-4 w-4 mr-2 shrink-0" />
                                        <span>{supplier.category}</span>
                                    </div>
                                    <div className="flex items-center text-muted-foreground">
                                        <DollarSign className="h-4 w-4 mr-2 shrink-0 text-green-600" />
                                        <span className="font-medium">Saldo: ${(supplier.account_balance || 0).toLocaleString()}</span>
                                    </div>
                                    <div className="pt-2 flex gap-2">
                                        <Button variant="outline" size="sm" className="h-8" onClick={() => setEditingSupplier(supplier)}>
                                            <Pencil className="h-3 w-3" />
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-8 text-red-400 hover:text-red-300 hover:bg-red-950" onClick={() => setDeletingSupplier(supplier)}>
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                        <Button variant="outline" size="sm" className="h-8 flex-1" onClick={() => setSelectedSupplier(supplier)}>
                                            <CreditCard className="h-3 w-3 mr-2" /> Ver Cuenta
                                        </Button>
                                    </div>
                                    <div className="flex gap-2">
                                        {supplier.email && (
                                            <Button variant="ghost" size="sm" className="h-8 flex-1 text-xs" asChild>
                                                <a href={`mailto:${supplier.email}`}><Mail className="h-3 w-3 mr-2" /> Email</a>
                                            </Button>
                                        )}
                                        {supplier.phone && (
                                            <Button variant="ghost" size="sm" className="h-8 flex-1 text-xs" asChild>
                                                <a href={`tel:${supplier.phone}`}><Phone className="h-3 w-3 mr-2" /> Llamar</a>
                                            </Button>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </CardContent>
                <CardFooter className="bg-slate-50 dark:bg-slate-900 border-t py-4 text-xs text-muted-foreground">
                    Mostrando {filteredSuppliers.length} proveedores
                </CardFooter>
            </Card>



            {/* Edit Supplier Dialog */}
            {editingSupplier && (
                <EditSupplierDialog
                    supplier={editingSupplier}
                    open={!!editingSupplier}
                    onOpenChange={(open: boolean) => !open && setEditingSupplier(null)}
                    onSubmit={handleUpdateSupplier}
                />
            )}

            {/* Delete Supplier Dialog */}
            {deletingSupplier && (
                <DeleteSupplierDialog
                    supplier={deletingSupplier}
                    open={!!deletingSupplier}
                    onOpenChange={(open: boolean) => !open && setDeletingSupplier(null)}
                    onConfirm={handleDeleteSupplier}
                />
            )}
        </div>
    )
}

function EditSupplierDialog({ supplier, open, onOpenChange, onSubmit }: { supplier: Supplier, open: boolean, onOpenChange: (open: boolean) => void, onSubmit: (data: SupplierUpsertInput) => Promise<void> }) {
    const [formData, setFormData] = useState({
        name: supplier.name,
        tax_id: supplier.tax_id,
        contact_name: supplier.contact_name || "",
        email: supplier.email || "",
        phone: supplier.phone || "",
        address: supplier.address || ""
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        onSubmit(formData)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Editar Proveedor</DialogTitle>
                    <DialogDescription>
                        Actualice los datos del proveedor {supplier.name}.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Nombre / Razón Social *</Label>
                            <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                        </div>
                        <div className="space-y-2">
                            <Label>RUC / Tax ID *</Label>
                            <Input value={formData.tax_id} onChange={e => setFormData({ ...formData, tax_id: e.target.value })} required />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Contacto</Label>
                            <Input value={formData.contact_name} onChange={e => setFormData({ ...formData, contact_name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Teléfono</Label>
                            <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Dirección</Label>
                            <Input value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                        </div>
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

function DeleteSupplierDialog({ supplier, open, onOpenChange, onConfirm }: { supplier: Supplier, open: boolean, onOpenChange: (open: boolean) => void, onConfirm: () => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="text-red-400">¿Eliminar Proveedor?</DialogTitle>
                    <DialogDescription>
                        Esta acción eliminará permanentemente al proveedor <strong>{supplier.name}</strong>.
                        {supplier.account_balance > 0 && (
                            <span className="block mt-2 text-yellow-400">
                                ⚠️ Este proveedor tiene un saldo pendiente de ${supplier.account_balance.toLocaleString()}
                            </span>
                        )}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
                    <Button variant="destructive" onClick={onConfirm} className="bg-red-600 hover:bg-red-500">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Eliminar Proveedor
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
