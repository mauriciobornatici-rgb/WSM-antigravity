import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { api, type PosException } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { showErrorToast } from "@/lib/errorHandling";
import { formatPosExceptionDetail, formatPosExceptionTypeLabel } from "@/lib/posExceptions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type ExceptionStatusTab = "pending" | "reviewed";
type ReviewDecision = "approved" | "rejected";

const EMPTY_EXCEPTIONS: PosException[] = [];
const EMPTY_PRODUCTS: Array<{ id: string; name: string }> = [];

function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function shortOrderId(orderId: string): string {
    if (!orderId) return "-";
    return orderId.length > 8 ? `${orderId.slice(0, 8)}…` : orderId;
}

export default function PosExceptionsPage() {
    const queryClient = useQueryClient();
    const [statusTab, setStatusTab] = useState<ExceptionStatusTab>("pending");
    const [reviewTarget, setReviewTarget] = useState<{ exception: PosException; decision: ReviewDecision } | null>(null);
    const [notes, setNotes] = useState("");

    const exceptionsQuery = useQuery({
        queryKey: queryKeys.posExceptions.byStatus(statusTab),
        queryFn: () => api.getPosExceptions(statusTab),
    });

    const productsQuery = useQuery({
        queryKey: queryKeys.products.all,
        queryFn: () => api.getProducts(),
    });

    const reviewMutation = useMutation({
        mutationFn: ({ id, decision, notes: reviewNotes }: { id: number; decision: ReviewDecision; notes: string }) => {
            const trimmedNotes = reviewNotes.trim();
            return trimmedNotes
                ? api.reviewPosException(id, { decision, notes: trimmedNotes })
                : api.reviewPosException(id, { decision });
        },
        onSuccess: async (_data, variables) => {
            toast.success(variables.decision === "approved" ? "Excepción aprobada" : "Excepción rechazada");
            setReviewTarget(null);
            setNotes("");
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.posExceptions.byStatus("pending") }),
                queryClient.invalidateQueries({ queryKey: queryKeys.posExceptions.byStatus("reviewed") }),
            ]);
        },
        onError: (error) => {
            showErrorToast("Error al revisar la excepción", error);
        },
    });

    const exceptions = exceptionsQuery.data ?? EMPTY_EXCEPTIONS;
    const products = productsQuery.data ?? EMPTY_PRODUCTS;

    const productNameById = useMemo(() => {
        const map: Record<string, string> = {};
        for (const product of products) {
            map[product.id] = product.name;
        }
        return map;
    }, [products]);

    const isReviewPending = reviewMutation.isPending;

    const openReviewDialog = (exception: PosException, decision: ReviewDecision) => {
        setReviewTarget({ exception, decision });
        setNotes("");
    };

    const confirmReview = () => {
        if (!reviewTarget || isReviewPending) return;
        reviewMutation.mutate({ id: reviewTarget.exception.id, decision: reviewTarget.decision, notes });
    };

    return (
        <div className="space-y-6 p-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Excepciones POS</h1>
                <p className="text-muted-foreground">
                    Revisión de ventas offline del punto de venta que incumplieron una regla de negocio (ADR-010).
                </p>
            </div>

            <Tabs value={statusTab} onValueChange={(value) => setStatusTab(value as ExceptionStatusTab)}>
                <TabsList>
                    <TabsTrigger value="pending">Pendientes</TabsTrigger>
                    <TabsTrigger value="reviewed">Revisadas</TabsTrigger>
                </TabsList>
            </Tabs>

            <Card>
                <CardContent className="p-0">
                    {exceptionsQuery.isLoading ? (
                        <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
                            Cargando excepciones...
                        </div>
                    ) : exceptionsQuery.isError ? (
                        <div className="flex flex-col items-center justify-center gap-2 p-10 text-sm text-destructive">
                            <AlertTriangle className="h-6 w-6" />
                            <span>No se pudieron cargar las excepciones.</span>
                            <Button variant="outline" size="sm" onClick={() => void exceptionsQuery.refetch()}>
                                Reintentar
                            </Button>
                        </div>
                    ) : exceptions.length === 0 ? (
                        <div className="flex items-center justify-center p-10 text-sm text-muted-foreground">
                            {statusTab === "pending" ? "No hay excepciones pendientes" : "No hay excepciones revisadas"}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead>Pedido</TableHead>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead>Cajero</TableHead>
                                    <TableHead>Detalle</TableHead>
                                    {statusTab === "reviewed" ? <TableHead>Resolución</TableHead> : null}
                                    {statusTab === "pending" ? <TableHead className="text-right">Acciones</TableHead> : null}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {exceptions.map((exception) => (
                                    <TableRow key={exception.id}>
                                        <TableCell className="whitespace-nowrap text-xs font-mono">
                                            {formatDateTime(exception.created_at)}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={exception.type === "price" ? "secondary" : "outline"}>
                                                {formatPosExceptionTypeLabel(exception.type)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs" title={exception.order_id}>
                                            {shortOrderId(exception.order_id)}
                                        </TableCell>
                                        <TableCell>{exception.customer_name || "Consumidor Final"}</TableCell>
                                        <TableCell>{exception.user_name}</TableCell>
                                        <TableCell className="max-w-sm text-xs text-muted-foreground">
                                            {formatPosExceptionDetail(exception, productNameById)}
                                        </TableCell>
                                        {statusTab === "reviewed" ? (
                                            <TableCell>
                                                {exception.review ? (
                                                    <div className="space-y-1">
                                                        <Badge
                                                            variant={exception.review.decision === "approved" ? "default" : "destructive"}
                                                            className={exception.review.decision === "approved" ? "bg-emerald-600" : ""}
                                                        >
                                                            {exception.review.decision === "approved" ? "Aprobada" : "Rechazada"}
                                                        </Badge>
                                                        {exception.review.notes ? (
                                                            <p className="text-xs text-muted-foreground">{exception.review.notes}</p>
                                                        ) : null}
                                                    </div>
                                                ) : (
                                                    "-"
                                                )}
                                            </TableCell>
                                        ) : null}
                                        {statusTab === "pending" ? (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="border-emerald-500/50 text-emerald-600 hover:bg-emerald-500/10"
                                                        onClick={() => openReviewDialog(exception, "approved")}
                                                    >
                                                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Aprobar
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="border-rose-500/50 text-rose-600 hover:bg-rose-500/10"
                                                        onClick={() => openReviewDialog(exception, "rejected")}
                                                    >
                                                        <XCircle className="mr-1.5 h-3.5 w-3.5" /> Rechazar
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        ) : null}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog
                open={reviewTarget !== null}
                onOpenChange={(open) => {
                    if (!open && !isReviewPending) {
                        setReviewTarget(null);
                        setNotes("");
                    }
                }}
            >
                <DialogContent className="w-[95vw] sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {reviewTarget?.decision === "approved" ? "Aprobar excepción" : "Rechazar excepción"}
                        </DialogTitle>
                        <DialogDescription>
                            Pedido {reviewTarget ? shortOrderId(reviewTarget.exception.order_id) : ""} — {" "}
                            {reviewTarget ? formatPosExceptionTypeLabel(reviewTarget.exception.type) : ""}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor="review-notes">Notas (opcional)</Label>
                        <Textarea
                            id="review-notes"
                            maxLength={500}
                            placeholder="Comentario para el registro de auditoría..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            disabled={isReviewPending}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReviewTarget(null)} disabled={isReviewPending}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={confirmReview}
                            disabled={isReviewPending}
                            className={
                                reviewTarget?.decision === "approved"
                                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                    : "bg-rose-600 text-white hover:bg-rose-700"
                            }
                        >
                            {isReviewPending
                                ? "Guardando..."
                                : reviewTarget?.decision === "approved"
                                    ? "Confirmar aprobación"
                                    : "Confirmar rechazo"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
