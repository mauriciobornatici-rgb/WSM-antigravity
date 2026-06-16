import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"
import { showErrorToast } from "@/lib/errorHandling"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { QueryErrorBanner, QueryLoadingState } from "./QueryStates"
import { mapWarrantyRows, warrantyStatusLabel } from "./helpers"
import type { WarrantyRow } from "@/types/returns"
import type { Client, Product } from "@/types"

const EMPTY_WARRANTIES: WarrantyRow[] = []
const EMPTY_CLIENTS: Client[] = []
const EMPTY_PRODUCTS: Product[] = []

export function WarrantiesTab() {
    const queryClient = useQueryClient()

    const [createOpen, setCreateOpen] = useState(false)
    const [clientId, setClientId] = useState("")
    const [productId, setProductId] = useState("")
    const [issueDescription, setIssueDescription] = useState("")

    const warrantiesQuery = useQuery({
        queryKey: queryKeys.warranties.all,
        queryFn: async () => mapWarrantyRows(await api.getWarranties()),
    })

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    })

    const productsQuery = useQuery({
        queryKey: queryKeys.products.all,
        queryFn: () => api.getProducts(),
    })

    const createWarrantyMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createWarranty>[0]) => api.createWarranty(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.warranties.all })
        },
    })

    const updateWarrantyStatusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: Parameters<typeof api.updateWarrantyStatus>[1]["status"] }) =>
            api.updateWarrantyStatus(id, { status }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.warranties.all })
        },
    })

    const warranties = warrantiesQuery.data ?? EMPTY_WARRANTIES
    const clients = clientsQuery.data ?? EMPTY_CLIENTS
    const products = productsQuery.data ?? EMPTY_PRODUCTS

    const loading = warrantiesQuery.isLoading || clientsQuery.isLoading || productsQuery.isLoading
    const hasLoadError = warrantiesQuery.isError || clientsQuery.isError || productsQuery.isError

    async function handleCreateWarranty() {
        if (!productId || !issueDescription) {
            toast.error("Completá producto y descripción")
            return
        }

        try {
            await createWarrantyMutation.mutateAsync({
                product_id: productId,
                issue_description: issueDescription,
                ...(clientId ? { client_id: clientId } : { customer_name: "Consumidor final" }),
            })
            toast.success("Garantía registrada")
            setCreateOpen(false)
            setClientId("")
            setProductId("")
            setIssueDescription("")
        } catch (error) {
            showErrorToast("No se pudo registrar la garantía", error)
        }
    }

    async function handleUpdateWarrantyStatus(
        id: string,
        status: Parameters<typeof api.updateWarrantyStatus>[1]["status"]
    ) {
        try {
            await updateWarrantyStatusMutation.mutateAsync({ id, status })
            toast.success("Estado actualizado")
        } catch (error) {
            showErrorToast("No se pudo actualizar la garantía", error)
        }
    }

    function retry() {
        void Promise.all([warrantiesQuery.refetch(), clientsQuery.refetch(), productsQuery.refetch()])
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Reclamos de garantía</CardTitle>
                <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva garantía
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                {hasLoadError ? <QueryErrorBanner onRetry={retry} /> : null}
                {loading ? <QueryLoadingState /> : null}

                {!loading ? (
                    <div className="overflow-x-auto">
                        <Table className="min-w-[760px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Producto</TableHead>
                                    <TableHead>Problema</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {warranties.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                                            Sin garantías.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    warranties.map((warranty) => (
                                        <TableRow key={warranty.id}>
                                            <TableCell>{new Date(warranty.created_at).toLocaleDateString("es-AR")}</TableCell>
                                            <TableCell>{warranty.client_name}</TableCell>
                                            <TableCell>{warranty.product_name}</TableCell>
                                            <TableCell>{warranty.issue_description}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{warrantyStatusLabel(warranty.status)}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Select
                                                    disabled={updateWarrantyStatusMutation.isPending}
                                                    onValueChange={(value) =>
                                                        void handleUpdateWarrantyStatus(
                                                            warranty.id,
                                                            value as Parameters<typeof api.updateWarrantyStatus>[1]["status"]
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger className="ml-auto w-40">
                                                        <SelectValue placeholder="Cambiar estado" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="initiated">Iniciada</SelectItem>
                                                        <SelectItem value="received">Recibida</SelectItem>
                                                        <SelectItem value="in_progress">En proceso</SelectItem>
                                                        <SelectItem value="resolved">Resuelta</SelectItem>
                                                        <SelectItem value="rejected">Rechazada</SelectItem>
                                                        <SelectItem value="closed">Cerrada</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                ) : null}
            </CardContent>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Nueva garantía</DialogTitle>
                        <DialogDescription>Registrá el reclamo del cliente.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label>Cliente (opcional)</Label>
                            <Select value={clientId} onValueChange={setClientId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Consumidor final" />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Producto</Label>
                            <Select value={productId} onValueChange={setProductId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar" />
                                </SelectTrigger>
                                <SelectContent>
                                    {products.map((product) => (
                                        <SelectItem key={product.id} value={product.id}>
                                            {product.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Descripción</Label>
                            <Input value={issueDescription} onChange={(event) => setIssueDescription(event.target.value)} />
                        </div>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void handleCreateWarranty()} disabled={createWarrantyMutation.isPending}>
                            Guardar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
