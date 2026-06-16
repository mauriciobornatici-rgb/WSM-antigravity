import { useState } from "react";
import { Activity, ArrowRightLeft, PackageSearch, RefreshCw, Search } from "lucide-react";
import { api, type TraceabilityEvent } from "@/services/api";
import { getErrorMessage } from "@/lib/errorHandling";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    buildTraceabilityFilters,
    formatTraceabilityDate,
    formatTraceabilityEventTitle,
    resolveTraceabilityLocation,
    type TraceabilitySearchMode,
} from "./traceabilityUtils";

const searchPlaceholders: Record<TraceabilitySearchMode, string> = {
    sku: "Ej: SKU-001",
    barcode: "Ej: 7791234567890",
    product_id: "ID interno del producto",
};

function eventBadgeLabel(event: TraceabilityEvent): string {
    if (event.reference_type) return event.reference_type;
    return event.source_table;
}

function TraceabilityEventRow({ event }: { event: TraceabilityEvent }) {
    const location = resolveTraceabilityLocation(event);

    return (
        <div className="grid gap-3 border-b border-slate-200 px-4 py-4 last:border-b-0 dark:border-slate-800 md:grid-cols-[180px_minmax(0,1fr)]">
            <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatTraceabilityDate(event.occurred_at)}
                </p>
                <Badge variant="outline" className="max-w-full truncate">
                    {eventBadgeLabel(event)}
                </Badge>
            </div>

            <div className="min-w-0 space-y-2">
                <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                            {formatTraceabilityEventTitle(event)}
                        </h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                            {event.description || event.product_name || event.sku || "Evento registrado"}
                        </p>
                    </div>
                    {event.quantity != null ? (
                        <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            Cantidad: {Number(event.quantity).toLocaleString("es-AR")}
                        </span>
                    ) : null}
                </div>

                <div className="grid gap-2 text-xs text-slate-500 dark:text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
                    <span className="truncate">Producto: {event.product_name || "-"}</span>
                    <span className="truncate">SKU: {event.sku || "-"}</span>
                    <span className="truncate">Ubicación: {location}</span>
                    <span className="truncate">Actor: {event.actor_name || "-"}</span>
                </div>
            </div>
        </div>
    );
}

export function TraceabilityPanel() {
    const [mode, setMode] = useState<TraceabilitySearchMode>("sku");
    const [query, setQuery] = useState("");
    const [events, setEvents] = useState<TraceabilityEvent[]>([]);
    const [lastQuery, setLastQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [emptySearch, setEmptySearch] = useState(false);

    async function runSearch(rawQuery = query) {
        const filters = buildTraceabilityFilters(rawQuery, mode);
        if (!filters) {
            setEmptySearch(true);
            setEvents([]);
            setLastQuery("");
            return;
        }

        try {
            setLoading(true);
            setError(null);
            setEmptySearch(false);
            const timeline = await api.traceability.getTimeline(filters);
            setEvents(timeline);
            setLastQuery(rawQuery.trim());
        } catch (searchError) {
            setEvents([]);
            setError(getErrorMessage(searchError, "No se pudo cargar la trazabilidad."));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-emerald-500" />
                    Trazabilidad
                </CardTitle>
                <CardDescription>
                    Consulta movimientos, lotes, series y auditoría por producto.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <form
                    className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto]"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void runSearch();
                    }}
                >
                    <Select value={mode} onValueChange={(value) => setMode(value as TraceabilitySearchMode)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="sku">SKU</SelectItem>
                            <SelectItem value="barcode">Código de barras</SelectItem>
                            <SelectItem value="product_id">ID producto</SelectItem>
                        </SelectContent>
                    </Select>

                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={searchPlaceholders[mode]}
                    />

                    <Button type="submit" className="gap-2" disabled={loading}>
                        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        Buscar
                    </Button>
                </form>

                {emptySearch ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        Ingresa un valor para consultar.
                    </div>
                ) : null}

                {error ? (
                    <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 md:flex-row md:items-center md:justify-between">
                        <span>{error}</span>
                        <Button type="button" variant="outline" size="sm" onClick={() => void runSearch(lastQuery || query)}>
                            Reintentar
                        </Button>
                    </div>
                ) : null}

                {!loading && !error && !emptySearch && !lastQuery ? (
                    <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
                        <PackageSearch className="mb-3 h-10 w-10 text-slate-400" />
                        <p className="text-sm font-semibold text-slate-200">Busca un producto para ver su historial.</p>
                    </div>
                ) : null}

                {!loading && !error && lastQuery && events.length === 0 ? (
                    <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
                        <PackageSearch className="mb-3 h-10 w-10 text-slate-400" />
                        <p className="text-sm font-semibold text-slate-200">Sin eventos para {lastQuery}.</p>
                    </div>
                ) : null}

                {loading ? (
                    <div className="flex min-h-52 items-center justify-center rounded-md border border-slate-200 dark:border-slate-800">
                        <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
                    </div>
                ) : null}

                {!loading && events.length > 0 ? (
                    <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                            <ArrowRightLeft className="h-4 w-4" />
                            {events.length} eventos encontrados
                        </div>
                        {events.map((event) => (
                            <TraceabilityEventRow key={`${event.source_table}-${event.id}-${event.occurred_at}`} event={event} />
                        ))}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}
