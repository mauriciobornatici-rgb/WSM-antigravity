import { MapPin, Move, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { InventoryItem } from "@/types";

interface InventoryLocationsTabProps {
    groupedInventory: Record<string, InventoryItem[]>;
    locationSearch: string;
    onLocationSearchChange: (search: string) => void;
    onStartTransfer: (productId: string, location: string) => void;
}

export function InventoryLocationsTab({
    groupedInventory,
    locationSearch,
    onLocationSearchChange,
    onStartTransfer,
}: InventoryLocationsTabProps) {
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
                                                            <div className="font-bold text-foreground">{item.product?.sku || "-"}</div>
                                                            <div className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                                                                {item.product?.name || "Producto sin nombre"}
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
            </CardContent>
        </Card>
    );
}
