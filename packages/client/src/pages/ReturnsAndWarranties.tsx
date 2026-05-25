import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { FileText, Plus, RotateCcw, ShieldCheck, Eye, Printer, ReceiptText, Trash2, Truck, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { fetchCompanySettingsSafe, DEFAULT_COMPANY_SETTINGS, getCompanyAddressLine, getCompanyDisplayName, getTaxRatePercentage } from "@/lib/companySettings";
import { CreditNotePreviewDialog } from "@/components/invoices/CreditNotePreviewDialog";
import { PrintableCreditNoteArea } from "@/components/invoices/PrintableCreditNoteArea";
import { PrintableThermalCreditNote } from "@/components/invoices/PrintableThermalCreditNote";
import { showErrorToast } from "@/lib/errorHandling";
import type { Client, Product, CompanySettings, Supplier } from "@/types";
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
    order_id?: string;
    reason: string;
    status: string;
    total_amount: number;
};

export type CreditNoteRow = {
    id: string;
    number: string;
    created_at: string;
    client_name: string;
    amount: number;
    status: string;
    point_of_sale?: number | undefined;
    credit_note_type?: string | undefined;
    cae?: string | undefined;
    cae_expiration_date?: string | undefined;
    reference_type?: string | undefined;
    reference_id?: string | undefined;
    customer_name?: string | undefined;
    notes?: string | undefined;
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

function warrantyStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        initiated: "Iniciada",
        received: "Recibida",
        in_progress: "En proceso",
        resolved: "Resuelta",
        rejected: "Rechazada",
        closed: "Cerrada",
    };
    return labels[status] ?? status;
}

function returnStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        draft: "Borrador",
        initiated: "Iniciada",
        pending: "Pendiente",
        approved: "Aprobada",
        rejected: "Rechazada",
        closed: "Cerrada",
    };
    return labels[status] ?? status;
}

function creditNoteStatusLabel(status: string): string {
    const labels: Record<string, string> = {
        draft: "Borrador",
        pending: "Pendiente",
        issued: "Emitida",
        approved: "Aprobada",
        cancelled: "Anulada",
        closed: "Cerrada",
    };
    return labels[status] ?? status;
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
    return rows.map((row) => {
        const mapped: ClientReturnRow = {
            id: readText(row.id, crypto.randomUUID()),
            created_at: readIsoDate(row.created_at),
            client_name: readText(row.client_name),
            reason: readText(row.reason),
            status: readText(row.status, "draft"),
            total_amount: readNumber(row.total_amount),
        };
        if (typeof row.order_id === "string") {
            mapped.order_id = row.order_id;
        }
        return mapped;
    });
}

function mapCreditNoteRows(rows: GenericRow[]): CreditNoteRow[] {
    return rows.map((row) => ({
        id: readText(row.id, crypto.randomUUID()),
        number: readText(row.number, "-"),
        created_at: readIsoDate(row.created_at),
        client_name: readText(row.client_name),
        amount: readNumber(row.amount),
        status: readText(row.status, "issued"),
        point_of_sale: row.point_of_sale ? Number(row.point_of_sale) : undefined,
        credit_note_type: typeof row.credit_note_type === "string" ? row.credit_note_type : undefined,
        cae: typeof row.cae === "string" ? row.cae : undefined,
        cae_expiration_date: typeof row.cae_expiration_date === "string" ? row.cae_expiration_date : undefined,
        reference_type: typeof row.reference_type === "string" ? row.reference_type : undefined,
        reference_id: typeof row.reference_id === "string" ? row.reference_id : undefined,
        customer_name: typeof row.customer_name === "string" ? row.customer_name : undefined,
        notes: typeof row.notes === "string" ? row.notes : undefined,
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
    const [companySettings, setCompanySettings] = useState<CompanySettings>(DEFAULT_COMPANY_SETTINGS);
    const [selectedCreditNote, setSelectedCreditNote] = useState<CreditNoteRow | null>(null);
    const [activePrintLayout, setActivePrintLayout] = useState<'a4' | 'thermal' | null>(null);

    useEffect(() => {
        void fetchCompanySettingsSafe().then(setCompanySettings);
    }, []);

    const returnsQuery = useQuery({
        queryKey: queryKeys.clientReturns.all,
        queryFn: async () => mapClientReturnRows(await api.getClientReturns()),
    });
    const returns = returnsQuery.data || [];

    const linkedReturn = selectedCreditNote
        ? returns.find((r) => r.id === selectedCreditNote.reference_id)
        : null;

    const companyName = getCompanyDisplayName(companySettings);
    const companyTaxId = companySettings.identity.tax_id || "No informado";
    const companyAddress = getCompanyAddressLine(companySettings);
    const taxRateLabel = `IVA (${getTaxRatePercentage(companySettings)}%)`;

    return (
        <div className="space-y-6 print:hidden">
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
                        Devoluciones (Clientes)
                    </TabsTrigger>
                    <TabsTrigger value="supplier-returns" className="shrink-0 gap-2">
                        <Truck className="h-4 w-4" />
                        Devoluciones a Proveedores
                    </TabsTrigger>
                    <TabsTrigger value="credits" className="shrink-0 gap-2">
                        <FileText className="h-4 w-4" />
                        Notas de crédito
                    </TabsTrigger>
                    <TabsTrigger value="analytics" className="shrink-0 gap-2">
                        <BarChart3 className="h-4 w-4" />
                        Estadísticas
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="warranties">
                    <WarrantiesTab />
                </TabsContent>
                <TabsContent value="returns">
                    <ReturnsTab />
                </TabsContent>
                <TabsContent value="supplier-returns">
                    <SupplierReturnsTab />
                </TabsContent>
                <TabsContent value="credits">
                    <CreditNotesTab 
                        companySettings={companySettings}
                        onPrintCreditNote={(cn, layout) => {
                            setActivePrintLayout(layout);
                            setSelectedCreditNote(cn);
                            setTimeout(() => window.print(), 200);
                        }}
                        linkedReturn={linkedReturn}
                        companyName={companyName}
                        companyTaxId={companyTaxId}
                        companyAddress={companyAddress}
                        taxRateLabel={taxRateLabel}
                    />
                </TabsContent>
                <TabsContent value="analytics">
                    <AnalyticsTab />
                </TabsContent>
            </Tabs>

            {activePrintLayout === "a4" && selectedCreditNote && (
                <PrintableCreditNoteArea
                    creditNote={selectedCreditNote}
                    companyName={companyName}
                    companyTaxId={companyTaxId}
                    companyAddress={companyAddress}
                    taxRateLabel={taxRateLabel}
                    companySettings={companySettings}
                    linkedReturn={linkedReturn}
                />
            )}

            {activePrintLayout === "thermal" && selectedCreditNote && (
                <PrintableThermalCreditNote
                    creditNote={selectedCreditNote}
                    companyName={companyName}
                    companyTaxId={companyTaxId}
                    companyAddress={companyAddress}
                    companySettings={companySettings}
                    linkedReturn={linkedReturn}
                />
            )}
        </div>
    );
}

function AnalyticsTab() {
    const query = useQuery({
        queryKey: ["returns-analytics"],
        queryFn: () => api.getReturnsAnalytics(),
    });

    const loading = query.isLoading;
    const hasLoadError = query.isError;
    const data = query.data;

    return (
        <div className="space-y-4">
            {hasLoadError ? <QueryErrorBanner onRetry={() => void query.refetch()} /> : null}
            {loading ? <QueryLoadingState /> : null}
            {!loading && data ? (
                <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>Monto de Pérdida Total</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-red-600">
                                ${Number(data.totalLossAmount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Top Motivos de Devolución</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-2">
                                {data.topReasons?.map((r: any) => (
                                    <li key={r.reason} className="flex justify-between border-b pb-1 last:border-0">
                                        <span>{r.reason || "Sin especificar"}</span>
                                        <span className="font-semibold">{r.count}</span>
                                    </li>
                                ))}
                                {(!data.topReasons || data.topReasons.length === 0) && (
                                    <li className="text-muted-foreground text-sm">Sin datos de motivos</li>
                                )}
                            </ul>
                        </CardContent>
                    </Card>
                    <Card className="md:col-span-2">
                        <CardHeader>
                            <CardTitle>Productos más Devueltos</CardTitle>
                        </CardHeader>
                        <CardContent className="h-[300px]">
                            {data.topDefectiveProducts && data.topDefectiveProducts.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.topDefectiveProducts}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip />
                                        <Bar dataKey="count" fill="#3b82f6" name="Cantidad Devuelta" />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                                    No hay suficientes datos de productos devueltos
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            ) : null}
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
                                            <Badge variant="outline">{warrantyStatusLabel(warranty.status)}</Badge>
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
    const [orderId, setOrderId] = useState("");
    const [reason, setReason] = useState("");
    const [returnItems, setReturnItems] = useState<Array<{
        product_id: string;
        product_name: string;
        quantity: number;
        max_quantity: number;
        condition_status: string;
        unit_price: number;
    }>>([]);

    const returnsQuery = useQuery({
        queryKey: queryKeys.clientReturns.all,
        queryFn: async () => mapClientReturnRows(await api.getClientReturns()),
    });

    const clientsQuery = useQuery({
        queryKey: queryKeys.clients.all,
        queryFn: () => api.getClients(),
    });

    const ordersQuery = useQuery({
        queryKey: queryKeys.orders.all,
        queryFn: () => api.getOrders(),
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
    const orders = ordersQuery.data ?? [];

    const loading = returnsQuery.isLoading || clientsQuery.isLoading || ordersQuery.isLoading;
    const hasLoadError = returnsQuery.isError || clientsQuery.isError || ordersQuery.isError;

    useEffect(() => {
        if (!orderId) {
            setReturnItems([]);
            return;
        }
        const order = orders.find((o) => o.id === orderId);
        if (order && order.items) {
            const items = order.items.map((i: any) => ({
                product_id: i.product_id,
                product_name: i.product_name || i.product?.name || "Producto desconocido",
                quantity: 0,
                max_quantity: i.quantity,
                condition_status: "sellable",
                unit_price: i.unit_price || 0,
            }));
            setReturnItems(items);
            if (order.client_id) {
                setClientId(order.client_id);
            }
        }
    }, [orderId, orders]);

    async function handleCreateReturn() {
        const validItems = returnItems.filter((i) => i.quantity > 0);
        if (!orderId || validItems.length === 0) {
            toast.error("Seleccioná una orden e indicá cantidades a devolver mayores a 0");
            return;
        }
        try {
            const selectedClient = clients.find((client) => client.id === clientId);
            const payload: Parameters<typeof api.createClientReturn>[0] = {
                order_id: orderId,
                customer_name: selectedClient?.name || "Consumidor final",
                reason,
                items: validItems.map(i => ({
                    product_id: i.product_id,
                    quantity: i.quantity,
                    condition_status: i.condition_status,
                    unit_price: i.unit_price
                })),
            };
            if (clientId) payload.client_id = clientId;

            await createReturnMutation.mutateAsync(payload);
            toast.success("Devolución registrada");
            setCreateOpen(false);
            setClientId("");
            setOrderId("");
            setReturnItems([]);
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
        void Promise.all([returnsQuery.refetch(), clientsQuery.refetch(), ordersQuery.refetch()]);
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
                        <Table className="min-w-[860px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Orden</TableHead>
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
                                    <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                                        Sin devoluciones.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                returns.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell>{new Date(row.created_at).toLocaleDateString("es-AR")}</TableCell>
                                        <TableCell>{row.order_id ? <Badge variant="secondary" className="font-mono text-xs">{row.order_id.slice(0, 8)}</Badge> : "-"}</TableCell>
                                        <TableCell>{row.client_name}</TableCell>
                                        <TableCell>{row.reason}</TableCell>
                                        <TableCell>
                                            <Badge variant={row.status === "approved" ? "default" : "outline"}>
                                                {returnStatusLabel(row.status)}
                                            </Badge>
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
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Nueva devolución</DialogTitle>
                        <DialogDescription>Registrá mercadería devuelta vinculada a una orden.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Orden de Venta</Label>
                                <Select value={orderId} onValueChange={setOrderId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar orden" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {orders.map((order) => (
                                            <SelectItem key={order.id} value={order.id}>
                                                {order.id.slice(0, 8)} - {new Date(order.created_at).toLocaleDateString("es-AR")}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Cliente</Label>
                                <Select value={clientId} onValueChange={setClientId} disabled>
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
                        </div>
                        <div className="space-y-2">
                            <Label>Motivo general</Label>
                            <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ej: Cambio de talle, Defectuoso..." />
                        </div>
                        
                        {orderId && returnItems.length > 0 && (
                            <div className="border-t pt-4">
                                <Label className="mb-2 block font-semibold">Ítems de la orden</Label>
                                <div className="space-y-3">
                                    {returnItems.map((item, index) => (
                                        <div key={`${item.product_id}-${index}`} className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-12 items-center">
                                            <div className="sm:col-span-4">
                                                <Label className="text-xs text-muted-foreground block">Producto</Label>
                                                <span className="text-sm font-medium">{item.product_name}</span>
                                            </div>
                                            <div className="sm:col-span-3">
                                                <Label className="text-xs text-muted-foreground block">Cantidad a devolver</Label>
                                                <div className="flex items-center gap-2">
                                                    <Input
                                                        type="number"
                                                        min="0"
                                                        max={item.max_quantity}
                                                        value={item.quantity}
                                                        onChange={(e) => {
                                                            const newItems = [...returnItems];
                                                            if (newItems[index]) {
                                                                newItems[index].quantity = Number(e.target.value);
                                                                setReturnItems(newItems);
                                                            }
                                                        }}
                                                        className="h-8 w-20"
                                                    />
                                                    <span className="text-xs text-muted-foreground">/ {item.max_quantity}</span>
                                                </div>
                                            </div>
                                            <div className="sm:col-span-5">
                                                <Label className="text-xs text-muted-foreground block">Estado</Label>
                                                <Select
                                                    value={item.condition_status}
                                                    onValueChange={(val) => {
                                                        const newItems = [...returnItems];
                                                        if (newItems[index]) {
                                                            newItems[index].condition_status = val;
                                                            setReturnItems(newItems);
                                                        }
                                                    }}
                                                >
                                                    <SelectTrigger className="h-8">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="sellable">Reingreso a Stock</SelectItem>
                                                        <SelectItem value="loss">Pérdida</SelectItem>
                                                        <SelectItem value="supplier_rma">A proveedor</SelectItem>
                                                        <SelectItem value="rejected">Rechazado sin garantía</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-4">
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

type CreditNotesTabProps = {
    companySettings: CompanySettings;
    onPrintCreditNote: (cn: CreditNoteRow, layout: 'a4' | 'thermal') => void;
    linkedReturn: any;
    companyName: string;
    companyTaxId: string;
    companyAddress: string;
    taxRateLabel: string;
};

function CreditNotesTab({
    companySettings,
    onPrintCreditNote,
    linkedReturn,
    companyName,
    companyTaxId,
    companyAddress,
    taxRateLabel,
}: CreditNotesTabProps) {
    const queryClient = useQueryClient();

    const [createOpen, setCreateOpen] = useState(false);
    const [clientId, setClientId] = useState("");
    const [amount, setAmount] = useState(0);
    const [reason, setReason] = useState("");

    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewCreditNote, setPreviewCreditNote] = useState<CreditNoteRow | null>(null);

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

    const authorizeCreditNoteMutation = useMutation({
        mutationFn: (id: string) => api.authorizeCreditNote(id),
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

    async function handleAuthorizeCreditNote(cn: CreditNoteRow) {
        try {
            const updated = await authorizeCreditNoteMutation.mutateAsync(cn.id);
            toast.success("Nota de crédito autorizada exitosamente con CAE");
            if (previewCreditNote?.id === cn.id) {
                setPreviewCreditNote(updated as any);
            }
        } catch (error) {
            showErrorToast("No se pudo autorizar la nota de crédito", error);
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
                                <TableHead>CAE</TableHead>
                                <TableHead className="text-right">Monto</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {creditNotes.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-20 text-center text-muted-foreground">
                                        Sin notas de crédito.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                creditNotes.map((row) => (
                                    <TableRow key={row.id}>
                                        <TableCell>{new Date(row.created_at).toLocaleDateString("es-AR")}</TableCell>
                                        <TableCell className="font-mono font-bold">{row.number}</TableCell>
                                        <TableCell>{row.client_name || row.customer_name || "Consumidor Final"}</TableCell>
                                        <TableCell>
                                            <Badge variant={row.status === "authorized" ? "default" : "outline"}>
                                                {creditNoteStatusLabel(row.status)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {row.cae ? (
                                                <span className="text-xs font-mono font-bold text-green-600">{row.cae}</span>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-bold">${row.amount.toLocaleString("es-AR", { minimumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="flex justify-end gap-1 text-right">
                                            {row.status === "issued" && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="border-amber-600/40 text-amber-500 hover:bg-amber-600/10 hover:text-amber-600"
                                                    onClick={() => void handleAuthorizeCreditNote(row)}
                                                    disabled={authorizeCreditNoteMutation.isPending}
                                                    title="Autorizar con ARCA/AFIP"
                                                >
                                                    Autorizar
                                                </Button>
                                            )}
                                            <Button variant="ghost" size="sm" title="Ver detalles" onClick={() => { setPreviewCreditNote(row); setPreviewOpen(true); }}>
                                                <Eye className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" title="Imprimir A4" onClick={() => onPrintCreditNote(row, "a4")}>
                                                <Printer className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="sm" title="Imprimir Ticket (80mm)" onClick={() => onPrintCreditNote(row, "thermal")}>
                                                <ReceiptText className="h-4 w-4 text-slate-400" />
                                            </Button>
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

            <CreditNotePreviewDialog
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                creditNote={previewCreditNote}
                companyName={companyName}
                companyTaxId={companyTaxId}
                companyAddress={companyAddress}
                taxRateLabel={taxRateLabel}
                onClose={() => setPreviewOpen(false)}
                onAuthorize={handleAuthorizeCreditNote}
                companySettings={companySettings}
                linkedReturn={linkedReturn}
            />
        </Card>
    );
}

interface SupplierReturnRow {
    id: string;
    return_number: string;
    supplier_id: string;
    supplier_name: string;
    date: string;
    status: 'draft' | 'approved' | 'cancelled';
    notes?: string;
    created_at: string;
    items: Array<{
        id: string;
        return_id: string;
        product_id: string;
        product_name: string;
        sku: string;
        quantity: number;
        unit_cost: number;
        reason?: string;
    }>;
}

function SupplierReturnsTab() {
    const queryClient = useQueryClient();

    const [createOpen, setCreateOpen] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [selectedReturn, setSelectedReturn] = useState<SupplierReturnRow | null>(null);

    // Form state for creating a new return
    const [supplierId, setSupplierId] = useState("");
    const [notes, setNotes] = useState("");
    const [items, setItems] = useState<Array<{ product_id: string; quantity: number; unit_cost: number; reason: string }>>([
        { product_id: "", quantity: 1, unit_cost: 0, reason: "Defectuoso" }
    ]);

    const returnsQuery = useQuery({
        queryKey: queryKeys.supplierReturns.all,
        queryFn: async () => {
            const raw = await api.getSupplierReturns();
            return (raw || []) as unknown as SupplierReturnRow[];
        },
    });

    const suppliersQuery = useQuery({
        queryKey: queryKeys.suppliers.all,
        queryFn: () => api.getSuppliers(),
    });

    const productsQuery = useQuery({
        queryKey: queryKeys.products.all,
        queryFn: () => api.getProducts(),
    });

    const createReturnMutation = useMutation({
        mutationFn: (payload: Parameters<typeof api.createReturn>[0]) => api.createReturn(payload),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.supplierReturns.all });
        },
    });

    const approveReturnMutation = useMutation({
        mutationFn: (id: string) => api.approveReturn(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.supplierReturns.all });
        },
    });

    const returns = returnsQuery.data ?? [];
    const suppliers = (suppliersQuery.data ?? []) as Supplier[];
    const products = productsQuery.data ?? [];

    const loading = returnsQuery.isLoading || suppliersQuery.isLoading || productsQuery.isLoading;
    const hasLoadError = returnsQuery.isError || suppliersQuery.isError || productsQuery.isError;

    // Helper to calculate total amount of a return row
    const getReturnTotal = (row: SupplierReturnRow) => {
        if (!row.items) return 0;
        return row.items.reduce((sum: number, item: any) => sum + Number(item.quantity) * Number(item.unit_cost), 0);
    };

    const handleAddItem = () => {
        setItems([...items, { product_id: "", quantity: 1, unit_cost: 0, reason: "Defectuoso" }]);
    };

    const handleRemoveItem = (index: number) => {
        if (items.length === 1) {
            toast.error("Debe tener al menos un ítem");
            return;
        }
        const newItems = [...items];
        newItems.splice(index, 1);
        setItems(newItems);
    };

    const handleItemChange = (index: number, field: "product_id" | "quantity" | "unit_cost" | "reason", value: any) => {
        const newItems = [...items];
        const currentItem = { ...newItems[index] };

        if (field === "product_id") {
            currentItem.product_id = value as string;
            const prod = products.find((p) => p.id === value);
            if (prod) {
                currentItem.unit_cost = Number(prod.purchase_price || 0);
            }
        } else if (field === "quantity") {
            currentItem.quantity = Number(value);
        } else if (field === "unit_cost") {
            currentItem.unit_cost = Number(value);
        } else if (field === "reason") {
            currentItem.reason = value as string;
        }

        newItems[index] = currentItem as typeof newItems[number];
        setItems(newItems);
    };

    async function handleCreateReturn() {
        if (!supplierId) {
            toast.error("Seleccioná un proveedor");
            return;
        }

        const validItems = items.filter(item => item.product_id && item.quantity > 0);
        if (validItems.length === 0) {
            toast.error("Agregá al menos un producto válido con cantidad mayor a 0");
            return;
        }

        try {
            await createReturnMutation.mutateAsync({
                supplier_id: supplierId,
                notes: notes.trim(),
                items: validItems,
            });
            toast.success("Devolución a proveedor registrada en borrador");
            setCreateOpen(false);
            setSupplierId("");
            setNotes("");
            setItems([{ product_id: "", quantity: 1, unit_cost: 0, reason: "Defectuoso" }]);
        } catch (error) {
            showErrorToast("No se pudo registrar la devolución a proveedor", error);
        }
    }

    async function handleApproveReturn(id: string) {
        try {
            await approveReturnMutation.mutateAsync(id);
            toast.success("Devolución aprobada exitosamente");
            if (selectedReturn?.id === id) {
                setDetailOpen(false);
            }
        } catch (error) {
            showErrorToast("No se pudo aprobar la devolución", error);
        }
    }

    function retry() {
        void Promise.all([returnsQuery.refetch(), suppliersQuery.refetch(), productsQuery.refetch()]);
    }

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Devoluciones a proveedores</CardTitle>
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
                                    <TableHead>N° Comprobante</TableHead>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Monto Total</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {returns.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-20 text-center text-muted-foreground">
                                            Sin devoluciones a proveedores.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    returns.map((row) => {
                                        const total = getReturnTotal(row);
                                        return (
                                            <TableRow key={row.id}>
                                                <TableCell className="font-mono font-bold">{row.return_number}</TableCell>
                                                <TableCell>{new Date(row.created_at || row.date).toLocaleDateString("es-AR")}</TableCell>
                                                <TableCell>{row.supplier_name}</TableCell>
                                                <TableCell>
                                                    <Badge variant={row.status === "approved" ? "default" : "outline"}>
                                                        {returnStatusLabel(row.status)}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right font-bold">
                                                    ${total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            title="Ver detalles"
                                                            onClick={() => {
                                                                setSelectedReturn(row);
                                                                setDetailOpen(true);
                                                            }}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
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
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                ) : null}
            </CardContent>

            {/* Modal de Detalle */}
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Detalle de Devolución a Proveedor</DialogTitle>
                        <DialogDescription>
                            Comprobante: {selectedReturn?.return_number}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedReturn && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="font-semibold text-muted-foreground">Proveedor:</span>{" "}
                                    {selectedReturn.supplier_name}
                                </div>
                                <div>
                                    <span className="font-semibold text-muted-foreground">Fecha:</span>{" "}
                                    {new Date(selectedReturn.created_at || selectedReturn.date).toLocaleDateString("es-AR")}
                                </div>
                                <div>
                                    <span className="font-semibold text-muted-foreground">Estado:</span>{" "}
                                    <Badge variant={selectedReturn.status === "approved" ? "default" : "outline"} className="ml-1">
                                        {returnStatusLabel(selectedReturn.status)}
                                    </Badge>
                                </div>
                                <div>
                                    <span className="font-semibold text-muted-foreground">Monto Total:</span>{" "}
                                    <span className="font-bold">
                                        ${getReturnTotal(selectedReturn).toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                                    </span>
                                </div>
                            </div>

                            {selectedReturn.notes && (
                                <div className="rounded-md bg-muted p-3 text-sm">
                                    <span className="font-semibold text-muted-foreground block mb-1">Notas/Observaciones:</span>
                                    {selectedReturn.notes}
                                </div>
                            )}

                            <div>
                                <h4 className="font-semibold mb-2 text-sm text-muted-foreground">Ítems Devueltos</h4>
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Producto</TableHead>
                                                <TableHead>SKU</TableHead>
                                                <TableHead className="text-right">Cantidad</TableHead>
                                                <TableHead className="text-right">Costo Unit.</TableHead>
                                                <TableHead className="text-right">Total</TableHead>
                                                <TableHead>Motivo</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {selectedReturn.items && selectedReturn.items.map((item: any) => (
                                                <TableRow key={item.id}>
                                                    <TableCell>{item.product_name}</TableCell>
                                                    <TableCell className="font-mono text-xs">{item.sku}</TableCell>
                                                    <TableCell className="text-right">{Number(item.quantity).toLocaleString("es-AR")}</TableCell>
                                                    <TableCell className="text-right">${Number(item.unit_cost).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</TableCell>
                                                    <TableCell className="text-right font-bold">${(Number(item.quantity) * Number(item.unit_cost)).toLocaleString("es-AR", { minimumFractionDigits: 2 })}</TableCell>
                                                    <TableCell className="text-xs text-muted-foreground">{item.reason || "-"}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>

                            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-4">
                                <Button variant="outline" onClick={() => setDetailOpen(false)}>
                                    Cerrar
                                </Button>
                                {selectedReturn.status !== "approved" && (
                                    <Button
                                        onClick={() => void handleApproveReturn(selectedReturn.id)}
                                        disabled={approveReturnMutation.isPending}
                                    >
                                        Aprobar Devolución
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Modal "Nueva Devolución" */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Nueva devolución a proveedor</DialogTitle>
                        <DialogDescription>
                            Registrá mercadería en mal estado o rechazada para devolver al proveedor. Se creará en estado Borrador.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Proveedor</Label>
                                <Select value={supplierId} onValueChange={setSupplierId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar proveedor" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {suppliers.map((supplier) => (
                                            <SelectItem key={supplier.id} value={supplier.id}>
                                                {supplier.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Notas/Observaciones</Label>
                                <Input
                                    placeholder="Ej: Lote defectuoso detectado por control de calidad..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="border-t pt-4">
                            <div className="flex items-center justify-between mb-2">
                                <h4 className="font-semibold text-sm">Ítems a Devolver</h4>
                                <Button type="button" variant="outline" size="sm" onClick={handleAddItem}>
                                    <Plus className="mr-1 h-3.5 w-3.5" />
                                    Agregar ítem
                                </Button>
                            </div>

                            <div className="space-y-3">
                                {items.map((item, index) => (
                                    <div key={index} className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-12 items-end">
                                        <div className="space-y-1 sm:col-span-4">
                                            <Label className="text-xs">Producto</Label>
                                            <Select
                                                value={item.product_id}
                                                onValueChange={(val) => handleItemChange(index, "product_id", val)}
                                            >
                                                <SelectTrigger className="h-9">
                                                    <SelectValue placeholder="Seleccionar" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {products.map((prod) => (
                                                        <SelectItem key={prod.id} value={prod.id}>
                                                            {prod.name} (SKU: {prod.sku})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1 sm:col-span-2">
                                            <Label className="text-xs">Cantidad</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                step="any"
                                                className="h-9"
                                                value={item.quantity}
                                                onChange={(e) => handleItemChange(index, "quantity", Number(e.target.value))}
                                            />
                                        </div>
                                        <div className="space-y-1 sm:col-span-2">
                                            <Label className="text-xs">Costo Unitario ($)</Label>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="h-9"
                                                value={item.unit_cost}
                                                onChange={(e) => handleItemChange(index, "unit_cost", Number(e.target.value))}
                                            />
                                        </div>
                                        <div className="space-y-1 sm:col-span-3">
                                            <Label className="text-xs">Motivo</Label>
                                            <Select
                                                value={item.reason}
                                                onValueChange={(val) => handleItemChange(index, "reason", val)}
                                            >
                                                <SelectTrigger className="h-9">
                                                    <SelectValue placeholder="Seleccionar motivo" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Defectuoso">Defectuoso</SelectItem>
                                                    <SelectItem value="Error de envío">Error de envío</SelectItem>
                                                    <SelectItem value="Vencido">Vencido</SelectItem>
                                                    <SelectItem value="Otro">Otro</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="flex justify-end sm:col-span-1 pb-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => handleRemoveItem(index)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-4 pt-4 border-t">
                            <Button variant="outline" onClick={() => setCreateOpen(false)}>
                                Cancelar
                            </Button>
                            <Button onClick={() => void handleCreateReturn()} disabled={createReturnMutation.isPending}>
                                Guardar Borrador
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

