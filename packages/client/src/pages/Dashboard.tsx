import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Package, AlertCircle, DollarSign } from "lucide-react";
import { DashboardSkeleton } from "@/components/common/Skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { showErrorToast } from "@/lib/errorHandling";
import { api } from "@/services/api";
import { isApiError } from "@/services/httpClient";
import type { Order, Transaction } from "@/types";

type DashboardStat = {
    title: string;
    value: string;
    trend: string;
    className?: string;
    icon: typeof DollarSign;
};

type DailySalesPoint = {
    label: string;
    amount: number;
};

type ActivityItem = {
    id: string;
    title: string;
    subtitle: string;
    amount: number;
    positive: boolean;
};

const currencyFormatter = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
});

function parseDate(value: string | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getDayKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isSameDay(value: string | undefined, target: Date): boolean {
    const parsed = parseDate(value);
    return parsed ? getDayKey(parsed) === getDayKey(target) : false;
}

function formatRelativeTime(value: string | undefined): string {
    const parsed = parseDate(value);
    if (!parsed) return "Sin fecha";

    const diffMs = Date.now() - parsed.getTime();
    if (diffMs < 60_000) return "Hace unos segundos";

    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 60) return `Hace ${minutes} min`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `Hace ${days} d`;

    return parsed.toLocaleDateString("es-AR");
}

function orderStatusLabel(status: Order["status"]): string {
    const labels: Record<Order["status"], string> = {
        pending: "Pendiente",
        picking: "Preparacion",
        packed: "Empaquetado",
        dispatched: "Despachado",
        delivered: "Entregado",
        completed: "Completado",
        cancelled: "Cancelado",
    };
    return labels[status] ?? status;
}

function sumSalesFromTransactions(rows: Transaction[], date: Date): number {
    return rows
        .filter((row) => row.type === "sale" && isSameDay(row.date, date))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function sumSalesFromOrders(rows: Order[], date: Date): number {
    return rows
        .filter((row) => row.status !== "cancelled" && isSameDay(row.created_at, date))
        .reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
}

function buildDailySales(rows: Transaction[], fallbackOrders: Order[]): DailySalesPoint[] {
    const useTransactions = rows.length > 0;
    const series: DailySalesPoint[] = [];
    const today = new Date();

    for (let offset = 6; offset >= 0; offset -= 1) {
        const current = new Date(today);
        current.setDate(today.getDate() - offset);
        const amount = useTransactions
            ? sumSalesFromTransactions(rows, current)
            : sumSalesFromOrders(fallbackOrders, current);

        series.push({
            label: current.toLocaleDateString("es-AR", { weekday: "short" }),
            amount,
        });
    }

    return series;
}

export default function Dashboard() {
    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState<DashboardStat[]>([]);
    const [dailySales, setDailySales] = useState<DailySalesPoint[]>([]);
    const [activities, setActivities] = useState<ActivityItem[]>([]);

    useEffect(() => {
        void loadDashboard();
    }, []);

    async function loadDashboard() {
        try {
            setIsLoading(true);
            const [orders, products] = await Promise.all([
                api.getOrders(),
                api.getProducts(),
            ]);

            let transactions: Transaction[] = [];
            try {
                transactions = await api.getTransactions({ type: "sale" });
            } catch (error) {
                if (!isApiError(error) || error.status !== 403) {
                    throw error;
                }
            }

            const today = new Date();
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);

            const salesToday = transactions.length > 0
                ? sumSalesFromTransactions(transactions, today)
                : sumSalesFromOrders(orders, today);
            const salesYesterday = transactions.length > 0
                ? sumSalesFromTransactions(transactions, yesterday)
                : sumSalesFromOrders(orders, yesterday);
            const todayOperations = transactions.length > 0
                ? transactions.filter((row) => row.type === "sale" && isSameDay(row.date, today)).length
                : orders.filter((row) => row.status !== "cancelled" && isSameDay(row.created_at, today)).length;

            const pendingOrders = orders.filter((row) =>
                row.status === "pending" || row.status === "picking" || row.status === "packed"
            ).length;
            const readyToDispatch = orders.filter((row) => row.status === "packed").length;
            const lowStockCount = products.filter((product) => {
                const min = Number(product.stock_min ?? 0);
                const current = Number(product.stock_current ?? 0);
                return min > 0 && current <= min;
            }).length;

            const actionableOrders = orders.filter((row) => row.status !== "cancelled");
            const closedOrders = actionableOrders.filter((row) => row.status === "delivered" || row.status === "completed");
            const completionRate = actionableOrders.length > 0
                ? Math.round((closedOrders.length / actionableOrders.length) * 100)
                : 0;

            const salesDelta = salesYesterday > 0
                ? `${Math.round(((salesToday - salesYesterday) / salesYesterday) * 100)}% vs ayer`
                : todayOperations > 0
                    ? "Sin base para comparar"
                    : "Sin ventas hoy";

            setStats([
                {
                    title: "Ventas de hoy",
                    value: currencyFormatter.format(salesToday),
                    icon: DollarSign,
                    trend: `${todayOperations} operaciones (${salesDelta})`,
                },
                {
                    title: "Pedidos de deposito",
                    value: String(pendingOrders),
                    icon: Package,
                    trend: `${readyToDispatch} listos para despacho`,
                },
                {
                    title: "Stock bajo",
                    value: String(lowStockCount),
                    icon: AlertCircle,
                    trend: lowStockCount > 0 ? "Requiere reposicion" : "Sin alertas",
                    className: lowStockCount > 0 ? "text-destructive" : "text-emerald-600",
                },
                {
                    title: "Rendimiento",
                    value: `${completionRate}%`,
                    icon: TrendingUp,
                    trend: `${closedOrders.length}/${actionableOrders.length} pedidos cerrados`,
                },
            ]);

            setDailySales(buildDailySales(transactions, orders));

            if (transactions.length > 0) {
                const recentTransactions = [...transactions]
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .slice(0, 5)
                    .map((row) => ({
                        id: row.id,
                        title: row.description || "Venta registrada",
                        subtitle: formatRelativeTime(row.date),
                        amount: Number(row.amount || 0),
                        positive: row.type !== "refund" && row.type !== "expense",
                    }));
                setActivities(recentTransactions);
            } else {
                const recentOrders = [...orders]
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .slice(0, 5)
                    .map((row) => ({
                        id: row.id,
                        title: `Pedido #${row.id.slice(0, 8).toUpperCase()} (${orderStatusLabel(row.status)})`,
                        subtitle: formatRelativeTime(row.created_at),
                        amount: Number(row.total_amount || 0),
                        positive: row.status !== "cancelled",
                    }));
                setActivities(recentOrders);
            }
        } catch (error) {
            showErrorToast("Error al cargar el dashboard", error);
            setStats([]);
            setDailySales([]);
            setActivities([]);
        } finally {
            setIsLoading(false);
        }
    }

    const maxDailySales = useMemo(
        () => Math.max(1, ...dailySales.map((point) => point.amount)),
        [dailySales],
    );

    if (isLoading) {
        return <DashboardSkeleton />;
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat) => (
                    <Card key={stat.title}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                            <stat.icon className="h-4 w-4 text-muted-foreground" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{stat.value}</div>
                            <p className={`text-xs text-muted-foreground ${stat.className || ""}`}>{stat.trend}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-7">
                <Card className="md:col-span-4">
                    <CardHeader>
                        <CardTitle>Ventas de los ultimos 7 dias</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {dailySales.length === 0 ? (
                            <div className="h-[200px] rounded-md border border-dashed text-sm text-muted-foreground flex items-center justify-center">
                                Sin datos de ventas para este periodo.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {dailySales.map((point) => (
                                    <div key={point.label} className="space-y-1">
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span className="font-medium uppercase">{point.label}</span>
                                            <span className="font-semibold text-slate-700">{currencyFormatter.format(point.amount)}</span>
                                        </div>
                                        <div className="h-2 rounded bg-slate-200">
                                            <div
                                                className="h-2 rounded bg-blue-600"
                                                style={{
                                                    width: `${Math.max(4, (point.amount / maxDailySales) * 100)}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card className="md:col-span-3">
                    <CardHeader>
                        <CardTitle>Actividad reciente</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {activities.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No hay movimientos recientes.</p>
                        ) : (
                            <div className="space-y-4">
                                {activities.map((activity) => (
                                    <div key={activity.id} className="flex items-center gap-4">
                                        <div className={`h-2 w-2 rounded-full ${activity.positive ? "bg-emerald-500" : "bg-rose-500"}`} />
                                        <div className="flex-1">
                                            <p className="text-sm font-medium">{activity.title}</p>
                                            <p className="text-xs text-muted-foreground">{activity.subtitle}</p>
                                        </div>
                                        <div className={`text-sm font-bold ${activity.positive ? "text-emerald-600" : "text-rose-600"}`}>
                                            {activity.positive ? "+" : "-"}
                                            {currencyFormatter.format(activity.amount)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
