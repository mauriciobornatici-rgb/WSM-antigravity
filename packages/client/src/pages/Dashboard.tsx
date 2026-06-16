import { useEffect, useMemo, useState } from "react";
import { TrendingUp, Package, AlertCircle, DollarSign, UserCheck } from "lucide-react";
import { DashboardSkeleton } from "@/components/common/Skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { showErrorToast } from "@/lib/errorHandling";
import { api } from "@/services/api";

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

type PickerLeaderboardItem = {
    picker_name: string;
    sessions_count: number;
    total_picked: number;
    avg_duration_sec: number;
    shortage_count: number;
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


export default function Dashboard() {
    const [isLoading, setIsLoading] = useState(true);
    const [stats, setStats] = useState<DashboardStat[]>([]);
    const [dailySales, setDailySales] = useState<DailySalesPoint[]>([]);
    const [activities, setActivities] = useState<ActivityItem[]>([]);
    const [pickerLeaderboard, setPickerLeaderboard] = useState<PickerLeaderboardItem[]>([]);

    useEffect(() => {
        void loadDashboard();
    }, []);

    async function loadDashboard() {
        try {
            setIsLoading(true);
            const data = await api.getDashboardStats();

            const salesDelta = data.salesYesterday > 0
                ? `${Math.round(((data.salesToday - data.salesYesterday) / data.salesYesterday) * 100)}% vs ayer`
                : data.todayOperations > 0
                    ? "Sin base para comparar"
                    : "Sin ventas hoy";

            setStats([
                {
                    title: "Ventas de hoy",
                    value: currencyFormatter.format(data.salesToday),
                    icon: DollarSign,
                    trend: `${data.todayOperations} operaciones (${salesDelta})`,
                },
                {
                    title: "Pedidos de deposito",
                    value: String(data.pendingOrders),
                    icon: Package,
                    trend: `${data.readyToDispatch} listos para despacho`,
                },
                {
                    title: "Stock bajo",
                    value: String(data.lowStockCount),
                    icon: AlertCircle,
                    trend: data.lowStockCount > 0 ? "Requiere reposicion" : "Sin alertas",
                    className: data.lowStockCount > 0 ? "text-destructive" : "text-emerald-600",
                },
                {
                    title: "Rendimiento",
                    value: `${data.completionRate}%`,
                    icon: TrendingUp,
                    trend: `${data.closedOrdersCount}/${data.totalActionable} pedidos cerrados`,
                },
            ]);

            setDailySales(data.dailySalesHistory || []);

            const recentActivities = (data.activities || []).map((row) => ({
                id: row.id,
                title: row.title,
                subtitle: formatRelativeTime(row.date),
                amount: Number(row.amount || 0),
                positive: !!row.positive,
            }));
            setActivities(recentActivities);
            setPickerLeaderboard(data.pickerLeaderboard || []);
        } catch (error) {
            showErrorToast("Error al cargar el dashboard", error);
            setStats([]);
            setDailySales([]);
            setActivities([]);
            setPickerLeaderboard([]);
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

            <div className="grid grid-cols-1 gap-6 md:grid-cols-7 mt-6">
                <Card className="md:col-span-7">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <div className="space-y-0.5">
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <UserCheck className="h-5 w-5 text-blue-500" />
                                Eficiencia de Depósito (Picking WMS)
                            </CardTitle>
                            <p className="text-xs text-muted-foreground">Productividad y velocidad de los pickers en el armado de pedidos.</p>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {pickerLeaderboard.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No hay registros de picking completados esta semana.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-700/50 pb-2 text-muted-foreground text-xs uppercase tracking-wider">
                                            <th className="py-2 font-medium">Picker</th>
                                            <th className="py-2 text-center font-medium">Pedidos</th>
                                            <th className="py-2 text-right font-medium">Bultos</th>
                                            <th className="py-2 text-right font-medium">Tiempo Promedio</th>
                                            <th className="py-2 text-right font-medium">Discrepancias</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/40">
                                        {pickerLeaderboard.map((item, idx) => {
                                            const maxPicked = Math.max(1, ...pickerLeaderboard.map(p => p.total_picked));
                                            const progressPct = Math.round((item.total_picked / maxPicked) * 100);
                                            
                                            const formatDuration = (sec: number) => {
                                                if (sec < 60) return `${sec}s`;
                                                const m = Math.floor(sec / 60);
                                                const s = sec % 60;
                                                return `${m}m ${s}s`;
                                            };

                                            return (
                                                <tr key={idx} className="hover:bg-slate-800/20 transition-colors">
                                                    <td className="py-3 font-semibold text-slate-200">
                                                        <div className="flex items-center gap-2">
                                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500/10 text-xs font-bold text-blue-400">
                                                                {idx + 1}
                                                            </span>
                                                            {item.picker_name}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 text-center font-bold text-slate-300">
                                                        {item.sessions_count}
                                                    </td>
                                                    <td className="py-3 text-right">
                                                        <div className="flex flex-col items-end gap-1">
                                                            <span className="font-bold text-slate-100">{item.total_picked}</span>
                                                            <div className="h-1 w-20 rounded bg-slate-850 overflow-hidden">
                                                                <div 
                                                                    className="h-full bg-blue-500 rounded" 
                                                                    style={{ width: `${progressPct}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 text-right font-mono text-slate-300 text-xs">
                                                        {formatDuration(item.avg_duration_sec)}
                                                    </td>
                                                    <td className="py-3 text-right">
                                                        {item.shortage_count > 0 ? (
                                                            <span className="inline-flex items-center rounded-full bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-400">
                                                                {item.shortage_count} quiebres
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                                                                Sin quiebres
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
