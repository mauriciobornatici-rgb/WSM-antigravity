import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Order } from "@/types";
import { isPickableStatus, statusLabel } from "@/lib/pickingUtils";

interface PickingOrdersTableProps {
    orders: Order[];
    onSelectOrder: (order: Order) => void;
}

export function PickingOrdersTable({ orders, onSelectOrder }: PickingOrdersTableProps) {
    const pickableOrders = orders.filter((order) => isPickableStatus(order.status));

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-3xl font-bold tracking-tight">Picking</h2>
                <p className="text-muted-foreground">Selecciona un pedido para iniciar la preparacion en deposito.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pickableOrders.length === 0 ? (
                    <Card className="md:col-span-2 lg:col-span-3">
                        <CardContent className="p-8 text-center text-muted-foreground">
                            No hay pedidos pendientes de picking.
                        </CardContent>
                    </Card>
                ) : (
                    pickableOrders.map((order) => (
                        <Card
                            key={order.id}
                            className="cursor-pointer border-l-4 border-l-blue-500 transition hover:bg-muted/50 dark:border-l-blue-400"
                        >
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <CardTitle>{order.id}</CardTitle>
                                    <Badge variant={order.status === "pending" ? "default" : "secondary"}>
                                        {statusLabel(order.status)}
                                    </Badge>
                                </div>
                                <CardDescription>{order.customer_name || order.client_name || "Sin cliente"}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="text-sm text-muted-foreground">
                                    {order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} items
                                </div>
                                <Button
                                    className="mt-4 w-full"
                                    onClick={() => onSelectOrder(order)}
                                >
                                    Iniciar picking
                                </Button>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>
        </div>
    );
}
