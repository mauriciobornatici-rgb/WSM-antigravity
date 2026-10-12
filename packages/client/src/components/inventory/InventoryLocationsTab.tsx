import { useState } from "react";
import { MapPin, Move, Search, Plus, Pencil, Power } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/services/api";
import { showErrorToast } from "@/lib/errorHandling";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InventoryItem, WarehouseLocation } from "@/types";

interface InventoryLocationsTabProps {
    groupedInventory: Record<string, InventoryItem[]>;
    locationSearch: string;
    onLocationSearchChange: (search: string) => void;
    onStartTransfer: (productId: string, location: string) => void;
    warehouseLocations: WarehouseLocation[];
    onLocationsChanged: () => void;
}

export function InventoryLocationsTab({
    groupedInventory,
    locationSearch,
    onLocationSearchChange,
    onStartTransfer,
    warehouseLocations,
    onLocationsChanged,
}: InventoryLocationsTabProps) {
    const [locationDialogOpen, setLocationDialogOpen] = useState(false);
    const [editingLocation, setEditingLocation] = useState<WarehouseLocation | null>(null);
    const [code, setCode] = useState("");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [saving, setSaving] = useState(false);

    function openLocationDialog(location?: WarehouseLocation) {
        setEditingLocation(location ?? null);
        setCode(location?.code ?? "");
        setName(location?.name ?? "");
        setDescription(location?.description ?? "");
        setLocationDialogOpen(true);
    }

    async function saveLocation() {
        if (!code.trim() || !name.trim()) {
            toast.error("Código y nombre son obligatorios");
            return;
        }
        setSaving(true);
        try {
            if (editingLocation) {
                await api.updateWarehouseLocation(editingLocation.id, {
                    code: code.trim(),
                    name: name.trim(),
                    description: description.trim() || null,
                });
                toast.success("Ubicación actualizada");
            } else {
                await api.createWarehouseLocation({
                    code: code.trim(),
                    name: name.trim(),
                    ...(description.trim() ? { description: description.trim() } : {}),
                });
                toast.success("Ubicación creada");
            }
            setLocationDialogOpen(false);
            onLocationsChanged();
        } catch (error) {
            showErrorToast("No se pudo guardar la ubicación", error);
        } finally {
            setSaving(false);
        }
    }

    async function toggleLocation(location: WarehouseLocation) {
        try {
            await api.updateWarehouseLocation(location.id, { active: !location.active });
            toast.success(location.active ? "Ubicación archivada" : "Ubicación reactivada");
            onLocationsChanged();
        } catch (error) {
            showErrorToast("No se pudo cambiar el estado", error);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-indigo-600 flex items-center gap-2">
                    <MapPin className="h-5 w-5" /> Ubicaciones de Almacén (Góndolas)
                </CardTitle>
                <CardDescription>
                    Mercadería clasificada físicamente en el depósito. Permite reubicar stock al instante.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h3 className="text-sm font-semibold">Maestro de ubicaciones</h3>
                            <p className="text-xs text-muted-foreground">Crea destinos válidos y edita su nombre, descripción o estado.</p>
                        </div>
                        <Button size="sm" onClick={() => openLocationDialog()}>
                            <Plus className="mr-2 h-4 w-4" /> Nueva ubicación
                        </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {warehouseLocations.map((location) => (
                            <div key={location.id} className={`rounded-md border p-3 ${location.active ? "bg-card" : "bg-muted/40 opacity-70"}`}>
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold">{location.name}</p>
                                        <p className="font-mono text-[11px] text-muted-foreground">{location.code}</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openLocationDialog(location)} title="Editar ubicación" aria-label={`Editar ubicación ${location.name}`}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void toggleLocation(location)} title={location.active ? "Archivar" : "Reactivar"} aria-label={`${location.active ? "Archivar" : "Reactivar"} ubicación ${location.name}`}>
                                            <Power className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{location.description || "Sin descripción"}</p>
                                <p className="mt-2 text-[10px] text-muted-foreground">{location.sku_count ?? 0} SKU · {location.total_quantity ?? 0} unidades</p>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex items-center gap-2 max-w-sm">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                        placeholder="Filtrar por estante o producto..."
                        value={locationSearch}
                        onChange={(e) => onLocationSearchChange(e.target.value)}
                        className="h-9 text-xs"
                    />
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(groupedInventory).length === 0 ? (
                        <div className="col-span-full py-8 text-center text-muted-foreground text-sm border border-dashed rounded-lg">
                            No se encontraron ubicaciones para la búsqueda actual.
                        </div>
                    ) : (
                        Object.entries(groupedInventory).map(([locName, items]) => (
                            <Card key={locName} className="border border-border shadow-sm overflow-hidden bg-card">
                                <CardHeader className="bg-muted/30 px-4 py-3 flex flex-row items-center justify-between border-b border-border">
                                    <CardTitle className="text-sm font-bold flex items-center gap-1.5 text-foreground">
                                        <MapPin className="h-4 w-4 text-indigo-500" />
                                        {locName}
                                    </CardTitle>
                                    <span className="bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                        {items.length} SKUs
                                    </span>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <Table>
                                        <TableHeader className="bg-muted/20">
                                            <TableRow>
                                                <TableHead className="px-3 py-2 text-xs">SKU / Producto</TableHead>
                                                <TableHead className="text-right px-3 py-2 text-xs w-40">Estado del Stock</TableHead>
                                                <TableHead className="w-12 px-3 py-2"></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {items.map((item) => {
                                                const physical = Number(item.quantity || 0);
                                                const reserved = Number(item.reserved_quantity || 0);
                                                const available = physical - reserved;

                                                return (
                                                    <TableRow key={item.id} className="hover:bg-transparent border-b border-border">
                                                        <TableCell className="px-3 py-2 text-xs">
                                                            <div className="font-bold text-foreground">{item.sku || item.product?.sku || "-"}</div>
                                                            <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                                                                {item.product_name || item.product?.name || "Producto sin nombre"}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="px-3 py-2 text-xs">
                                                            <div className="space-y-1 text-right ml-auto max-w-[150px]">
                                                                <div className="flex items-center justify-between gap-2">
                                                                    <span className="text-muted-foreground text-[10px]">Físico:</span>
                                                                    <span className="font-semibold text-foreground">{physical} u</span>
                                                                </div>
                                                                {reserved > 0 && (
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="text-amber-500 text-[10px] font-medium flex items-center gap-0.5">
                                                                            <span className="h-1 w-1 rounded-full bg-amber-500 animate-pulse"></span>
                                                                            Reservado:
                                                                        </span>
                                                                        <span className="font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded text-[10px]">
                                                                            {reserved} u
                                                                        </span>
                                                                    </div>
                                                                )}
                                                                <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-border">
                                                                    <span className="text-muted-foreground text-[10px]">Disponible:</span>
                                                                    <span
                                                                        className={`font-bold ${
                                                                            available > 0
                                                                                ? "text-emerald-600 dark:text-emerald-400"
                                                                                : "text-red-500"
                                                                        }`}
                                                                    >
                                                                        {available} u
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="px-3 py-2 text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                                                                onClick={() => onStartTransfer(item.product_id, item.location)}
                                                                title="Reubicar este stock"
                                                                aria-label={`Reubicar stock en ${item.location}`}
                                                            >
                                                                <Move className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>

                <Dialog open={locationDialogOpen} onOpenChange={setLocationDialogOpen}>
                    <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                            <DialogTitle>{editingLocation ? "Editar ubicación" : "Nueva ubicación"}</DialogTitle>
                            <DialogDescription>El código identifica físicamente el destino; el nombre y la descripción ayudan al operador.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="warehouse-location-code">Código</Label>
                                <Input id="warehouse-location-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="Ej: DEP-A-03" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="warehouse-location-name">Nombre</Label>
                                <Input id="warehouse-location-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej: Depósito A - Estante 3" />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="warehouse-location-description">Descripción</Label>
                                <Input id="warehouse-location-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Opcional" />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setLocationDialogOpen(false)}>Cancelar</Button>
                            <Button onClick={() => void saveLocation()} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
}
