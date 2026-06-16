import { useQuery } from "@tanstack/react-query"
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/services/api"
import { QueryErrorBanner, QueryLoadingState } from "./QueryStates"

export function AnalyticsTab() {
    const query = useQuery({
        queryKey: ["returns-analytics"],
        queryFn: () => api.getReturnsAnalytics(),
    })

    const loading = query.isLoading
    const hasLoadError = query.isError
    const data = query.data

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
                                {data.topReasons?.map((r) => (
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
    )
}
