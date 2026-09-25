import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/services/api";
import { formatMoney } from "@/lib/formatters";
import { toast } from "sonner";
import { Package, Search, RotateCw, ArrowRight, Clock, User, CheckCircle2 } from "lucide-react";
import type { Order } from "@/types";

interface POSPickupOrdersDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSelectOrder: (order: Order) => Promise<void> | void;
}

export function POSPickupOrdersDialog({
    open,
    onOpenChange,
    onSelectOrder,
}: POSPickupOrdersDialogProps) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectingId, setSelectingId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");

    const loadOrders = async () => {
        setLoading(true);
        try {
            // Retrieve orders with status 'packed' (and also 'dispatched' for local pickup)
            const packedOrders = await api.getOrders({
                shipping_method: "pickup",
                status: "packed",
            });
            const dispatchedOrders = await api.getOrders({
                shipping_method: "pickup",
                status: "dispatched",
            });
            // Merge and deduplicate
            const map = new Map<string, Order>();
            for (const ord of [...(packedOrders || []), ...(dispatchedOrders || [])]) {
                if (!ord.invoice_id) {
                    map.set(ord.id, ord);
                }
            }
            setOrders(Array.from(map.values()));
        } catch {
            toast.error("No se pudieron cargar los pedidos de retiro");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            void loadOrders();
            setSearchTerm("");
        }
    }, [open]);

    const filteredOrders = orders.filter((ord) => {
        if (!searchTerm.trim()) return true;
        const term = searchTerm.toLowerCase();
        return (
            ord.id.toLowerCase().includes(term) ||
            (ord.customer_name || "").toLowerCase().includes(term) ||
            (ord.client_name || "").toLowerCase().includes(term) ||
            (ord.recipient_name || "").toLowerCase().includes(term)
        );
    });

    const handleSelect = async (order: Order) => {
        try {
            setSelectingId(order.id);
            await onSelectOrder(order);
            onOpenChange(false);
        } catch {
            toast.error("Error al cargar el pedido en mostrador");
        } finally {
            setSelectingId(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl bg-card border-border">
                <DialogHeader>
                    <div className="flex items-center justify-between pr-6">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                                <Package className="h-5 w-5" />
                            </div>
                            <div>
                                <DialogTitle className="text-lg font-bold">
                                    Pedidos Listos para Retiro en Mostrador
                                </DialogTitle>
                                <DialogDescription className="text-xs text-muted-foreground">
                                    Selecciona un pedido preparado por almacén para cobrarlo y entregarlo en el mostrador.
                                </DialogDescription>
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-xs"
                            onClick={() => void loadOrders()}
                            disabled={loading}
                        >
                            <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                            <span>Actualizar</span>
                        </Button>
                    </div>
                </DialogHeader>

                <div className="space-y-3 pt-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por n° de pedido, cliente o destinatario..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-8 text-sm"
                        />
                    </div>

                    <div className="max-h-[50vh] overflow-y-auto space-y-2 pr-1">
                        {loading && orders.length === 0 ? (
                            <div className="py-12 text-center text-sm text-muted-foreground">
                                <RotateCw className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                                Cargando pedidos preparados...
                            </div>
                        ) : filteredOrders.length === 0 ? (
                            <div className="py-12 text-center text-sm text-muted-foreground space-y-2 border border-dashed rounded-lg">
                                <Package className="h-8 w-8 mx-auto text-muted-foreground/50" />
                                <p className="font-medium">No hay pedidos pendientes de retiro</p>
                                <p className="text-xs text-muted-foreground/70">
                                    Los pedidos aparecerán aquí una vez que almacén finalice su preparación (estado Empaquetado).
                                </p>
                            </div>
                        ) : (
                            filteredOrders.map((order) => {
                                const isSelecting = selectingId === order.id;
                                const shortId = order.id.slice(0, 8);
                                const dateFormatted = order.created_at
                                    ? new Date(order.created_at).toLocaleDateString("es-AR", {
                                          day: "2-digit",
                                          month: "short",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                      })
                                    : "-";

                                return (
                                    <div
                                        key={order.id}
                                        className="rounded-lg border bg-card/60 p-3.5 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                                    >
                                        <div className="space-y-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono font-bold text-sm">
                                                    #{shortId}
                                                </span>
                                                <Badge
                                                    variant="outline"
                                                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-[10px] gap-1 py-0"
                                                >
                                                    <CheckCircle2 className="h-3 w-3" />
                                                    Listo para retiro
                                                </Badge>
                                            </div>

                                            <div className="flex items-center gap-1.5 text-xs text-foreground font-medium">
                                                <User className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span className="truncate">
                                                    {order.customer_name || order.client_name || "Consumidor Final"}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
                                                <span className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    {dateFormatted}
                                                </span>
                                                {order.counter_name && (
                                                    <span>Origen: {order.counter_name}</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 border-border/40">
                                            <div className="text-left sm:text-right">
                                                <div className="text-xs text-muted-foreground">Total pedido</div>
                                                <div className="font-mono font-bold text-base text-foreground">
                                                    {formatMoney(order.total_amount)}
                                                </div>
                                            </div>

                                            <Button
                                                size="sm"
                                                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                                                onClick={() => void handleSelect(order)}
                                                disabled={isSelecting}
                                            >
                                                {isSelecting ? (
                                                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    <ArrowRight className="h-3.5 w-3.5" />
                                                )}
                                                <span>Cargar en Mostrador</span>
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
