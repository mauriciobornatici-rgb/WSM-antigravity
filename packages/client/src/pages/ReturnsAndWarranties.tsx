import { useEffect, useState } from "react";
import { FileText, Plus, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import type { Client, Product } from "@/types";
import { showErrorToast } from "@/lib/errorHandling";
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
};

type CreditNoteRow = {
    id: string;
    number: string;
    created_at: string;
    client_name: string;
    amount: number;
    status: string;
};

function readText(value: unknown, fallback = "-"): string {
    return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readNumber(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

export default function ReturnsAndWarrantiesPage() {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Devoluciones y garantias</h2>
                <p className="text-muted-foreground">Gestión de reclamos, devoluciones y notas de crédito.</p>
            </div>

            <Tabs defaultValue="warranties" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="warranties" className="gap-2">
                        <ShieldCheck className="h-4 w-4" />
                        Garantías
                    </TabsTrigger>
                    <TabsTrigger value="returns" className="gap-2">
                        <RotateCcw className="h-4 w-4" />
                        Devoluciones
                    </TabsTrigger>
                    <TabsTrigger value="credits" className="gap-2">
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
    const [warranties, setWarranties] = useState<WarrantyRow[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [createOpen, setCreateOpen] = useState(false);

    const [clientId, setClientId] = useState("");
    const [productId, setProductId] = useState("");
    const [issueDescription, setIssueDescription] = useState("");

    useEffect(() => {
        void loadData();
    }, []);

    async function loadData() {
        try {
            const [warrantiesResponse, clientsResponse, productsResponse] = await Promise.all([
                api.getWarranties(),
                api.getClients(),
                api.getProducts(),
            ]);
            setWarranties(
                warrantiesResponse.map((row) => ({
                    id: readText(row.id, crypto.randomUUID()),
                    created_at: readText(row.created_at, new Date().toISOString()),
                    client_name: readText(row.client_name),
                    product_name: readText(row.product_name),
                    issue_description: readText(row.issue_description),
                    status: readText(row.status, "initiated"),
                })),
            );
            setClients(clientsResponse);
            setProducts(productsResponse);
        } catch (error) {
            showErrorToast("Error al cargar garantias", error);
        }
    }

    async function createWarranty() {
        if (!productId || !issueDescription) {
            toast.error("Completa producto y descripción");
            return;
        }
        try {
            await api.createWarranty({
                product_id: productId,
                issue_description: issueDescription,
                ...(clientId ? { client_id: clientId } : { customer_name: "Consumidor final" }),
            });
            toast.success("Garantia registrada");
            setCreateOpen(false);
            setClientId("");
            setProductId("");
            setIssueDescription("");
            await loadData();
        } catch (error) {
            showErrorToast("Error al crear garantia", error);
        }
    }

    async function updateWarrantyStatus(id: string, status: string) {
        try {
            await api.updateWarrantyStatus(id, { status: status as Parameters<typeof api.updateWarrantyStatus>[1]["status"] });
            toast.success("Estado actualizado");
            await loadData();
        } catch (error) {
            showErrorToast("Error al actualizar garantia", error);
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Reclamos de garantia</CardTitle>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva garantia
                </Button>
            </CardHeader>
            <CardContent>
                <Table>
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
                                    Sin garantias.
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
                                        <Select onValueChange={(value) => void updateWarrantyStatus(warranty.id, value)}>
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
            </CardContent>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nueva garantia</DialogTitle>
                        <DialogDescription>Registra el reclamo del cliente.</DialogDescription>
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
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void createWarranty()}>Guardar</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function ReturnsTab() {
    const [returns, setReturns] = useState<ClientReturnRow[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [createOpen, setCreateOpen] = useState(false);

    const [clientId, setClientId] = useState("");
    const [productId, setProductId] = useState("");
    const [quantity, setQuantity] = useState(1);
    const [reason, setReason] = useState("");

    useEffect(() => {
        void loadData();
    }, []);

    async function loadData() {
        try {
            const [returnsResponse, clientsResponse, productsResponse] = await Promise.all([
                api.getClientReturns(),
                api.getClients(),
                api.getProducts(),
            ]);
            setReturns(
                returnsResponse.map((row) => ({
                    id: readText(row.id, crypto.randomUUID()),
                    created_at: readText(row.created_at, new Date().toISOString()),
                    client_name: readText(row.client_name),
                    reason: readText(row.reason),
                    status: readText(row.status, "draft"),
                })),
            );
            setClients(clientsResponse);
            setProducts(productsResponse);
        } catch (error) {
            showErrorToast("Error al cargar devoluciones", error);
        }
    }

    async function createReturn() {
        if (!productId || quantity <= 0) {
            toast.error("Completa producto y cantidad");
            return;
        }
        try {
            const selectedClient = clients.find((client) => client.id === clientId);
            const payload: Parameters<typeof api.createClientReturn>[0] = {
                customer_name: selectedClient?.name || "Consumidor final",
                reason,
                items: [{ product_id: productId, quantity, condition_status: "sellable" }],
            };
            if (clientId) payload.client_id = clientId;
            await api.createClientReturn(payload);
            toast.success("Devolucion registrada");
            setCreateOpen(false);
            setClientId("");
            setProductId("");
            setQuantity(1);
            setReason("");
            await loadData();
        } catch (error) {
            showErrorToast("Error al registrar devolución", error);
        }
    }

    async function approveReturn(id: string) {
        try {
            await api.approveClientReturn(id);
            toast.success("Devolucion aprobada");
            await loadData();
        } catch (error) {
            showErrorToast("Error al aprobar devolución", error);
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Devoluciones de clientes</CardTitle>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva devolución
                </Button>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead>Motivo</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {returns.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
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
                                    <TableCell className="text-right">
                                        {row.status !== "approved" ? (
                                            <Button size="sm" variant="outline" onClick={() => void approveReturn(row.id)}>
                                                Aprobar
                                            </Button>
                                        ) : null}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </CardContent>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nueva devolución</DialogTitle>
                        <DialogDescription>Registra mercaderia devuelta por un cliente.</DialogDescription>
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
                            <Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Motivo</Label>
                            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void createReturn()}>Guardar</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function CreditNotesTab() {
    const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [createOpen, setCreateOpen] = useState(false);

    const [clientId, setClientId] = useState("");
    const [amount, setAmount] = useState(0);
    const [reason, setReason] = useState("");

    useEffect(() => {
        void loadData();
    }, []);

    async function loadData() {
        try {
            const [creditResponse, clientsResponse] = await Promise.all([api.getCreditNotes(), api.getClients()]);
            setCreditNotes(
                creditResponse.map((row) => ({
                    id: readText(row.id, crypto.randomUUID()),
                    number: readText(row.number, "-"),
                    created_at: readText(row.created_at, new Date().toISOString()),
                    client_name: readText(row.client_name),
                    amount: readNumber(row.amount),
                    status: readText(row.status, "issued"),
                })),
            );
            setClients(clientsResponse);
        } catch (error) {
            showErrorToast("Error al cargar notas de crédito", error);
        }
    }

    async function createCreditNote() {
        if (!clientId || amount <= 0) {
            toast.error("Cliente y monto son obligatorios");
            return;
        }
        try {
            await api.createCreditNote({
                client_id: clientId,
                amount,
                reason,
                reference_type: "manual",
            });
            toast.success("Nota de crédito creada");
            setCreateOpen(false);
            setClientId("");
            setAmount(0);
            setReason("");
            await loadData();
        } catch (error) {
            showErrorToast("Error al crear nota de crédito", error);
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Notas de crédito</CardTitle>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Nueva nota
                </Button>
            </CardHeader>
            <CardContent>
                <Table>
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
            </CardContent>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Nueva nota de crédito</DialogTitle>
                        <DialogDescription>Emite una nota manual para el cliente seleccionado.</DialogDescription>
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
                            <Input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
                        </div>
                        <div className="space-y-2">
                            <Label>Motivo</Label>
                            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => void createCreditNote()}>Guardar</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
