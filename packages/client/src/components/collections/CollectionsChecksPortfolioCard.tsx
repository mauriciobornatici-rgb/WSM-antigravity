import { History, Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PaginationControls } from "@/components/common/PaginationControls";
import { formatMoney } from "@/lib/formatters";
import type { CustomerCheck } from "@/types/api";
import { CHECK_STATUS_LABELS, type CheckPortfolioFilter } from "./types";

interface CollectionsChecksPortfolioCardProps {
    checks: CustomerCheck[];
    filter: CheckPortfolioFilter;
    onFilterChange: (filter: CheckPortfolioFilter) => void;
    page: number;
    onPageChange: (page: number) => void;
    pageSize?: number;
    selectedCheckId: string | null;
    onSelectCheck: (check: CustomerCheck | null) => void;
    selectedCheck: CustomerCheck | undefined;
    isLoadingCheck: boolean;
    checkStatus: CustomerCheck["status"];
    onCheckStatusChange: (status: CustomerCheck["status"]) => void;
    checkDeliveredTo: string;
    onCheckDeliveredToChange: (val: string) => void;
    checkNotes: string;
    onCheckNotesChange: (val: string) => void;
    onSaveStatus: () => Promise<void>;
}

export function CollectionsChecksPortfolioCard({
    checks,
    filter,
    onFilterChange,
    page,
    onPageChange,
    pageSize = 10,
    selectedCheckId,
    onSelectCheck,
    selectedCheck,
    isLoadingCheck,
    checkStatus,
    onCheckStatusChange,
    checkDeliveredTo,
    onCheckDeliveredToChange,
    checkNotes,
    onCheckNotesChange,
    onSaveStatus,
}: CollectionsChecksPortfolioCardProps) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    const dueSoonLimit = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, "0")}-${String(limit.getDate()).padStart(2, "0")}`;
    const isOpen = (status: CustomerCheck["status"]) => ["received", "deposited"].includes(status);

    const filteredChecks = checks.filter((check) => {
        const dueDate = String(check.due_date || "").slice(0, 10);
        if (filter === "open") return isOpen(check.status);
        if (filter === "cleared") return check.status === "cleared";
        if (filter === "overdue") return isOpen(check.status) && dueDate < today;
        if (filter === "due_soon") return isOpen(check.status) && dueDate >= today && dueDate <= dueSoonLimit;
        return true;
    });

    const totalPages = Math.max(1, Math.ceil(filteredChecks.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const visibleChecks = filteredChecks.slice((safePage - 1) * pageSize, safePage * pageSize);

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                        <Landmark className="h-5 w-5" /> Cartera de cheques
                    </CardTitle>
                    <CardDescription>Seguimiento desde la recepción hasta el depósito, endoso, acreditación o rechazo.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,240px)_1fr] sm:items-end">
                        <div className="space-y-1.5">
                            <Label>Estado de cartera</Label>
                            <Select
                                value={filter}
                                onValueChange={(value) => {
                                    onFilterChange(value as CheckPortfolioFilter);
                                    onPageChange(1);
                                }}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos</SelectItem>
                                    <SelectItem value="open">Pendientes de cobro</SelectItem>
                                    <SelectItem value="due_soon">Vencen en 7 días</SelectItem>
                                    <SelectItem value="overdue">Vencidos sin cobrar</SelectItem>
                                    <SelectItem value="cleared">Cobrados</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <p className="text-sm text-muted-foreground">
                            {filteredChecks.length} cheque{filteredChecks.length === 1 ? "" : "s"} en la vista seleccionada.
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <Table className="min-w-[900px]">
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Cheque</TableHead>
                                    <TableHead>Librador / cliente</TableHead>
                                    <TableHead>Vencimiento</TableHead>
                                    <TableHead className="text-right">Importe</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead>Acción</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {visibleChecks.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                                            No hay cheques para este filtro.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    visibleChecks.map((check) => (
                                        <TableRow key={check.id}>
                                            <TableCell>
                                                <p className="font-medium">{check.bank_name}</p>
                                                <p className="font-mono text-xs text-muted-foreground">Nº {check.check_number}</p>
                                            </TableCell>
                                            <TableCell>
                                                <p>{check.issuer_name}</p>
                                                <p className="text-xs text-muted-foreground">{check.client_name || "Sin cliente vinculado"}</p>
                                            </TableCell>
                                            <TableCell>{new Date(`${String(check.due_date).slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR")}</TableCell>
                                            <TableCell className="text-right font-mono font-semibold">{formatMoney(check.amount)}</TableCell>
                                            <TableCell>{CHECK_STATUS_LABELS[check.status]}</TableCell>
                                            <TableCell>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => onSelectCheck(check)}
                                                >
                                                    <History className="mr-1 h-4 w-4" /> Ver seguimiento
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    <PaginationControls
                        page={safePage}
                        totalPages={totalPages}
                        totalCount={filteredChecks.length}
                        itemLabel="cheque"
                        onPageChange={onPageChange}
                    />
                </CardContent>
            </Card>

            <Dialog
                open={Boolean(selectedCheckId)}
                onOpenChange={(open) => {
                    if (!open) onSelectCheck(null);
                }}
            >
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Seguimiento del cheque</DialogTitle>
                        <DialogDescription>
                            {selectedCheck ? `${selectedCheck.bank_name} · Nº ${selectedCheck.check_number} · ${formatMoney(selectedCheck.amount)}` : "Cargando instrumento..."}
                        </DialogDescription>
                    </DialogHeader>

                    {isLoadingCheck && !selectedCheck ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">Cargando trazabilidad...</p>
                    ) : selectedCheck ? (
                        <div className="space-y-5">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>Nuevo estado</Label>
                                    <Select value={checkStatus} onValueChange={(value) => onCheckStatusChange(value as CustomerCheck["status"])}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {Object.entries(CHECK_STATUS_LABELS).map(([value, label]) => (
                                                <SelectItem key={value} value={value}>
                                                    {label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="check-delivered-to">Entregado a</Label>
                                    <Input
                                        id="check-delivered-to"
                                        value={checkDeliveredTo}
                                        onChange={(event) => onCheckDeliveredToChange(event.target.value)}
                                        placeholder="Persona, proveedor o banco"
                                    />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="check-status-notes">Nota del movimiento</Label>
                                    <Textarea
                                        id="check-status-notes"
                                        value={checkNotes}
                                        onChange={(event) => onCheckNotesChange(event.target.value)}
                                        placeholder="Constancia, número de depósito, motivo de rechazo, etc."
                                    />
                                </div>
                            </div>

                            <div>
                                <h3 className="mb-2 text-sm font-semibold">Aplicación del cheque</h3>
                                {selectedCheck.allocations?.length ? (
                                    <div className="space-y-2">
                                        {selectedCheck.allocations.map((allocation) => (
                                            <div key={allocation.id} className="flex justify-between rounded-md border p-2 text-sm">
                                                <span>
                                                    Factura {allocation.invoice_type || ""}{" "}
                                                    {allocation.point_of_sale != null ? String(allocation.point_of_sale).padStart(4, "0") : ""}-
                                                    {allocation.invoice_number != null ? String(allocation.invoice_number).padStart(8, "0") : ""}
                                                </span>
                                                <span className="font-mono font-medium">{formatMoney(allocation.amount)}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">Sin facturas vinculadas.</p>
                                )}
                            </div>

                            <div>
                                <h3 className="mb-2 text-sm font-semibold">Historial</h3>
                                <div className="max-h-48 space-y-2 overflow-y-auto">
                                    {selectedCheck.events?.map((event) => (
                                        <div key={event.id} className="rounded-md border-l-2 border-primary bg-muted/40 px-3 py-2 text-sm">
                                            <div className="flex justify-between gap-3">
                                                <span className="font-medium">{CHECK_STATUS_LABELS[event.status]}</span>
                                                <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString("es-AR")}</span>
                                            </div>
                                            {event.notes ? <p className="mt-1 text-muted-foreground">{event.notes}</p> : null}
                                            {event.performed_by_name ? <p className="mt-1 text-xs text-muted-foreground">Por {event.performed_by_name}</p> : null}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onSelectCheck(null)}>
                            Cerrar
                        </Button>
                        <Button
                            type="button"
                            disabled={!selectedCheck || (checkStatus === "endorsed" && !checkDeliveredTo.trim())}
                            onClick={onSaveStatus}
                        >
                            Guardar movimiento
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
