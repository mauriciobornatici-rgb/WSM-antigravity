import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { showErrorToast } from "@/lib/errorHandling";
import type { Client, Product } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type WarrantyRow = {
    id: string;
    created_at: string;
    client_name: string;
    product_name: string;
    issue_description: string;
    status: string;
};

type ClientReturnRow = {
    id: string;
    created_at: string;
    client_name: string;
    reason: string;
    status: string;
    total_amount: number;
};

type CreditNoteRow = {
    id: string;
    number: string;
    created_at: string;
    client_name: string;
    amount: number;
    status: string;
};

type GenericRow = Record<string, unknown>;

const EMPTY_CLIENTS: Client[] = [];
const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_WARRANTIES: WarrantyRow[] = [];
const EMPTY_CLIENT_RETURNS: ClientReturnRow[] = [];
const EMPTY_CREDIT_NOTES: CreditNoteRow[] = [];

function readText(value: unknown, fallback = "-"): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNumber(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function readIsoDate(value: unknown): string {
    return typeof value === "string" && value.length > 0 ? value : new Date().toISOString();
}

function mapWarrantyRows(rows: GenericRow[]): WarrantyRow[] {
    return rows.map((row) => ({
        id: readText(row.id, crypto.randomUUID()),
        created_at: readIsoDate(row.created_at),
        client_name: readText(row.client_name),
        product_name: readText(row.product_name),
        issue_description: readText(row.issue_description),
        status: readText(row.status, "initiated"),
    }));
}

function mapClientReturnRows(rows: GenericRow[]): ClientReturnRow[] {
    return rows.map((row) => ({
        id: readText(row.id, crypto.randomUUID()),
        created_at: readIsoDate(row.created_at),
        client_name: readText(row.client_name),
        reason: readText(row.reason),
        status: readText(row.status, "draft"),
        total_amount: readNumber(row.total_amount),
    }));
}

function mapCreditNoteRows(rows: GenericRow[]): CreditNoteRow[] {
    return rows.map((row) => ({
        id: readText(row.id, crypto.randomUUID()),
        number: readText(row.number, "-"),
        created_at: readIsoDate(row.created_at),
        client_name: readText(row.client_name),
        amount: readNumber(row.amount),
        status: readText(row.status, "issued"),
    }));
}

function QueryErrorBanner({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 md:flex-row md:items-center md:justify-between">
            <span>No pudimos cargar esta sección. Reintentá para actualizar la vista.</span>
            <button
                type="button"
                onClick={onRetry}
                className="rounded border border-red-300 px-3 py-1 font-medium text-red-700 transition hover:bg-red-100"
            >
                Reintentar
            </button>
        </div>
    );
}

function QueryLoadingState() {
    return (
        <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
    );
}

export default function ReturnsAndWarrantiesPage() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Devoluciones y garantías</h2>
                <p className="text-muted-foreground">Gestión de reclamos, devoluciones y notas de crédito.</p>
            </div>

            <Tabs defaultValue="warranties" className="space-y-4">
                <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto p-1">
                    <TabsTrigger value="warranties" className="shrink-0 gap-2">
                        <ShieldCheck className="h-4 w-4" />
                        Garantías
                    </TabsTrigger>
                    <TabsTrigger value="returns" className="shrink-0 gap-2">
                        <RotateCcw className="h-4 w-4" />
                        Devoluciones
                    </TabsTrigger>
                    <TabsTrigger value="credits" className="shrink-0 gap-2">
                        <FileText className="h-4 w-4" />
                        Notas de crédito
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="warranties">
                    <WarrantiesTab />
                </TabsContent>
                <TabsContent value="returns">
                    <ReturnsTab />
                </TabsContent>
                <TabsContent value="credits">
                    <CreditNotesTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function WarrantiesTab() {
    const queryClient = useQueryClient();

    const [createOpen, setCreateOpen] = useState(false);
    const [clientId, setClientId] = useState("");
    const [productId, setProductId] = useState("");
    const [issueDescription, setIssueDescription] = useState("");

    const warrantiesQuery = useQuery({
        queryKey: queryKeys.warranties.all,
        queryFn: async () => mapWarrantyRows(await api.getWarranties()),
    });

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    });

    const productsQuery = useQuery({
        queryKey: queryKeys.products.all,
        queryFn: () => api.getProducts(),
    });

    const createWarrantyMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createWarranty>[0]) => api.createWarranty(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.warranties.all });
        },
    });

    const updateWarrantyStatusMutation = useMutation({
        mutationFn: ({ id, status }: { id: string; status: Parameters<typeof api.updateWarrantyStatus>[1]["status"] }) =>
            api.updateWarrantyStatus(id, { status }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.warranties.all });
        },
    });

    const warranties = warrantiesQuery.data ?? EMPTY_WARRANTIES;
    const clients = clientsQuery.data ?? EMPTY_CLIENTS;
    const products = productsQuery.data ?? EMPTY_PRODUCTS;

    const loading = warrantiesQuery.isLoading || clientsQuery.isLoading || productsQuery.isLoading;
    const hasLoadError = warrantiesQuery.isError || clientsQuery.isError || productsQuery.isError;

    async function handleCreateWarranty() {
        if (!productId || !issueDescription) {
            toast.error("Completá producto y descripción");
            return;
        }

        try {
            await createWarrantyMutation.mutateAsync({
                product_id: productId,
                issue_description: issueDescription,
                ...(clientId ? { client_id: clientId } : { customer_name: "Consumidor final" }),
            });
            toast.success("Garantía registrada");
            setCreateOpen(false);
            setClientId("");
            setProductId("");
            setIssueDescription("");
        } catch (error) {
            showErrorToast("No se pudo registrar la garantía", error);
        }
    }

    async function handleUpdateWarrantyStatus(
        id: string,
        status: Parameters<typeof api.updateWarrantyStatus>[1]["status"],
    ) {
        try {
            await updateWarrantyStatusMutation.mutateAsync({ id, status });
            toast.success("Estado actualizado");
        } catch (error) {
            showErrorToast("No se pudo actualizar la garantía", error);
        }
    }

    function retry() {
        void Promise.all([warrantiesQuery.refetch(), clientsQuery.refetch(), productsQuery.refetch()]);
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
                                            <Badge variant="outline">{warranty.status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Select
                                                disabled={updateWarrantyStatusMutation.isPending}
                                                onValueChange={(value) =>
                                                    void handleUpdateWarrantyStatus(
                                                        warranty.id,
                                                        value as Parameters<typeof api.updateWarrantyStatus>[1]["status"],
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
    );
}

function ReturnsTab() {
    const queryClient = useQueryClient();

    const [createOpen, setCreateOpen] = useState(false);
    const [clientId, setClientId] = useState("");
    const [productId, setProductId] = useState("");
    const [quantity, setQuantity] = useState(1);
    const [reason, setReason] = useState("");

    const returnsQuery = useQuery({
        queryKey: queryKeys.clientReturns.all,
        queryFn: async () => mapClientReturnRows(await api.getClientReturns()),
    });

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    });

    const productsQuery = useQuery({
        queryKey: queryKeys.products.all,
        queryFn: () => api.getProducts(),
    });

    const createReturnMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createClientReturn>[0]) => api.createClientReturn(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.clientReturns.all });
        },
    });

    const approveReturnMutation = useMutation({
        mutationFn: (id: string) => api.approveClientReturn(id),
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.clientReturns.all }),
                queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all }),
            ]);
        },
    });

    const returns = returnsQuery.data ?? EMPTY_CLIENT_RETURNS;
    const clients = clientsQuery.data ?? EMPTY_CLIENTS;
    const products = productsQuery.data ?? EMPTY_PRODUCTS;

    const loading = returnsQuery.isLoading || clientsQuery.isLoading || productsQuery.isLoading;
    const hasLoadError = returnsQuery.isError || clientsQuery.isError || productsQuery.isError;

    async function handleCreateReturn() {
        if (!productId || quantity <= 0) {
            toast.error("Completa producto y cantidad");
            return;
        }
        try {
            const selectedClient = clients.find((client) => client.id === clientId);
            const selectedProduct = products.find((product) => product.id === productId);
            const unitPrice = Number(selectedProduct?.sale_price || 0);
            const payload: Parameters<typeof api.createClientReturn>[0] = {
                customer_name: selectedClient?.name || "Consumidor final",
                reason,
                items: [{ product_id: productId, quantity, condition_status: "sellable", unit_price: unitPrice }],
            };
            if (clientId) payload.client_id = clientId;

            await createReturnMutation.mutateAsync(payload);
            toast.success("Devolución registrada");
            setCreateOpen(false);
            setClientId("");
            setProductId("");
            setQuantity(1);
            setReason("");
        } catch (error) {
            showErrorToast("No se pudo registrar la devolución", error);
        }
    }

    async function handleApproveReturn(id: string) {
        try {
            await approveReturnMutation.mutateAsync(id);
            toast.success("Devolución aprobada");
        } catch (error) {
            showErrorToast("No se pudo aprobar la devolución", error);
        }
    }

    function retry() {
        void Promise.all([returnsQuery.refetch(), clientsQuery.refetch(), productsQuery.refetch()]);
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Devoluciones de clientes</CardTitle>
                <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva devolución
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
                                <TableHead>Motivo</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Monto</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {returns.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                                        Sin devoluciones.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                returns.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell>{new Date(row.created_at).toLocaleDateString("es-AR")}</TableCell>
                                        <TableCell>{row.client_name}</TableCell>
                                        <TableCell>{row.reason}</TableCell>
                                        <TableCell>
                                            <Badge variant={row.status === "approved" ? "default" : "outline"}>{row.status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">${row.total_amount.toLocaleString("es-AR")}</TableCell>
                                        <TableCell className="text-right">
                                            {row.status !== "approved" ? (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={approveReturnMutation.isPending}
                                                    onClick={() => void handleApproveReturn(row.id)}
                                                >
                                                    Aprobar
                                                </Button>
                                            ) : null}
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
                        <DialogTitle>Nueva devolución</DialogTitle>
                        <DialogDescription>Registrá mercadería devuelta por un cliente.</DialogDescription>
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
                            <Label>Cantidad</Label>
                            <Input
                                type="number"
                                min="1"
                                value={quantity}
                                onChange={(event) => setQuantity(Number(event.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Motivo</Label>
                            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
                        </div>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void handleCreateReturn()} disabled={createReturnMutation.isPending}>
                            Guardar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function CreditNotesTab() {
    const queryClient = useQueryClient();

    const [createOpen, setCreateOpen] = useState(false);
    const [clientId, setClientId] = useState("");
    const [amount, setAmount] = useState(0);
    const [reason, setReason] = useState("");

    const creditNotesQuery = useQuery({
        queryKey: queryKeys.creditNotes.all,
        queryFn: async () => mapCreditNoteRows(await api.getCreditNotes()),
    });

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    });

    const createCreditNoteMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createCreditNote>[0]) => api.createCreditNote(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.creditNotes.all });
        },
    });

    const creditNotes = creditNotesQuery.data ?? EMPTY_CREDIT_NOTES;
    const clients = clientsQuery.data ?? EMPTY_CLIENTS;
    const loading = creditNotesQuery.isLoading || clientsQuery.isLoading;
    const hasLoadError = creditNotesQuery.isError || clientsQuery.isError;

    async function handleCreateCreditNote() {
        if (!clientId || amount <= 0) {
            toast.error("Cliente y monto son obligatorios");
            return;
        }

        try {
            const trimmedReason = reason.trim();
            await createCreditNoteMutation.mutateAsync({
                client_id: clientId,
                amount: Number(amount),
                ...(trimmedReason ? { reason: trimmedReason, notes: trimmedReason } : {}),
                reference_type: "manual",
            });
            toast.success("Nota de crédito creada");
            setCreateOpen(false);
            setClientId("");
            setAmount(0);
            setReason("");
        } catch (error) {
            showErrorToast("No se pudo crear la nota de crédito", error);
        }
    }

    function retry() {
        void Promise.all([creditNotesQuery.refetch(), clientsQuery.refetch()]);
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Notas de crédito</CardTitle>
                <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva nota
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
                                <TableHead>Número</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Monto</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {creditNotes.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                                        Sin notas de crédito.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                creditNotes.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell>{new Date(row.created_at).toLocaleDateString("es-AR")}</TableCell>
                                        <TableCell>{row.number}</TableCell>
                                        <TableCell>{row.client_name}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{row.status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-right">${row.amount.toLocaleString("es-AR")}</TableCell>
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
                        <DialogTitle>Nueva nota de crédito</DialogTitle>
                        <DialogDescription>Emití una nota manual para el cliente seleccionado.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <Label>Cliente</Label>
                            <Select value={clientId} onValueChange={setClientId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar" />
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
                            <Label>Monto</Label>
                            <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={amount}
                                onChange={(event) => setAmount(Number(event.target.value))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Motivo</Label>
                            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
                        </div>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void handleCreateCreditNote()} disabled={createCreditNoteMutation.isPending}>
                            Guardar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

