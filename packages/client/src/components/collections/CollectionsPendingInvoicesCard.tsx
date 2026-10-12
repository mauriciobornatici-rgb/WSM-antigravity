import { Receipt, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/formatters";
import type { PendingInvoiceResponse } from "@/types/api";

function formatInvoiceLabel(invoice: PendingInvoiceResponse): string {
    if (invoice.document_type === "order") return `Venta ${String(invoice.order_id || invoice.id).slice(0, 8).toUpperCase()}`;
    const type = String(invoice.invoice_type || "B");
    const pos = String(Number(invoice.point_of_sale || 1)).padStart(4, "0");
    const number = String(Number(invoice.invoice_number || 0)).padStart(8, "0");
    return `${type}-${pos}-${number}`;
}

interface ClientForCollection {
    id: string;
    name: string;
    debt: number;
}

interface CollectionsPendingInvoicesCardProps {
    clients: ClientForCollection[];
    selectedClientId: string;
    onSelectClient: (clientId: string) => void;
    isLoading: boolean;
    hasLoadError: boolean;
    clientInvoices: PendingInvoiceResponse[];
    selectedInvoiceIds: Set<string>;
    onToggleInvoice: (invoiceId: string) => void;
    onToggleAllInvoices: () => void;
}

export function CollectionsPendingInvoicesCard({
    clients,
    selectedClientId,
    onSelectClient,
    isLoading,
    hasLoadError,
    clientInvoices,
    selectedInvoiceIds,
    onToggleInvoice,
    onToggleAllInvoices,
}: CollectionsPendingInvoicesCardProps) {
    return (
        <div className="flex flex-col gap-6">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">1. Seleccionar Cliente</CardTitle>
                    <CardDescription>Clientes registrados, priorizando quienes tienen ventas a cuenta corriente pendientes.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Select value={selectedClientId} onValueChange={onSelectClient}>
                        <SelectTrigger className="w-full sm:max-w-md">
                            <SelectValue placeholder={isLoading ? "Cargando..." : "Selecciona un cliente"} />
                        </SelectTrigger>
                        <SelectContent>
                            {clients.map((client) => (
                                <SelectItem key={client.id} value={client.id}>
                                    <div className="flex items-center justify-between w-full pr-4">
                                        <span>{client.name}</span>
                                        <span className="text-muted-foreground tabular-nums ml-4">
                                            {client.debt > 0 ? formatMoney(client.debt) : "Sin deuda pendiente"}
                                        </span>
                                    </div>
                                </SelectItem>
                            ))}
                            {clients.length === 0 && !isLoading && (
                                <SelectItem value="empty" disabled>
                                    No hay clientes registrados
                                </SelectItem>
                            )}
                        </SelectContent>
                    </Select>
                    {hasLoadError ? (
                        <p className="mt-2 text-sm text-destructive">No se pudieron cargar clientes o facturas. Reintenta en unos segundos.</p>
                    ) : null}
                </CardContent>
            </Card>

            {selectedClientId ? (
                <Card className="flex-1">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div>
                            <CardTitle className="text-lg">2. Comprobantes pendientes</CardTitle>
                            <CardDescription>
                                Incluye ventas a cuenta corriente aunque todavía no tengan factura o CAE.
                            </CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <Table className="min-w-[680px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[50px] text-center">
                                            <input
                                                type="checkbox"
                                                className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                                                checked={selectedInvoiceIds.size > 0 && selectedInvoiceIds.size === clientInvoices.length}
                                                onChange={onToggleAllInvoices}
                                            />
                                        </TableHead>
                                        <TableHead>Comprobante</TableHead>
                                        <TableHead>Estado fiscal</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                        <TableHead className="text-right">Pagado</TableHead>
                                        <TableHead className="text-right font-bold text-amber-600 dark:text-amber-400">Pendiente</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {clientInvoices.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                                                No hay ventas a cuenta corriente con saldo pendiente para este cliente.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        clientInvoices.map((inv) => (
                                            <TableRow
                                                key={inv.id}
                                                className={cn("cursor-pointer", selectedInvoiceIds.has(inv.id) && "bg-muted/50")}
                                                onClick={() => onToggleInvoice(inv.id)}
                                            >
                                                <TableCell className="text-center">
                                                    <input
                                                        type="checkbox"
                                                        className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                                                        checked={selectedInvoiceIds.has(inv.id)}
                                                        onChange={() => onToggleInvoice(inv.id)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </TableCell>
                                                <TableCell className="font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <Receipt className="h-4 w-4 text-muted-foreground" />
                                                        {formatInvoiceLabel(inv)}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {inv.fiscal_status === "authorized" ? (
                                                        <Badge className="bg-emerald-600">Con CAE</Badge>
                                                    ) : inv.fiscal_status === "pending_cae" ? (
                                                        <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
                                                            Sin CAE
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="secondary">Sin facturar</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell>{new Date(inv.issue_date || "").toLocaleDateString()}</TableCell>
                                                <TableCell className="text-right font-mono">{formatMoney(inv.total_amount)}</TableCell>
                                                <TableCell className="text-right font-mono">{formatMoney(inv.paid_amount)}</TableCell>
                                                <TableCell className="text-right font-bold font-mono text-amber-600 dark:text-amber-400">
                                                    {formatMoney(Number(inv.total_amount) - Number(inv.paid_amount))}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <Card className="flex-1 flex flex-col items-center justify-center p-12 text-center border-dashed">
                    <div className="rounded-full bg-primary/10 p-4 mb-3">
                        <Users className="h-8 w-8 text-primary" />
                    </div>
                    <h3 className="font-semibold text-lg">Selecciona un cliente</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mt-1">
                        Elige un cliente para cargar sus ventas pendientes y armar el cobro.
                    </p>
                </Card>
            )}
        </div>
    );
}
