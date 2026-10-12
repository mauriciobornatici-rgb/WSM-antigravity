import { useMemo, useState } from "react";
import { Layers3, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import type { ProductCatalogOption, ProductCatalogOptionType } from "@/types";
import { api } from "@/services/api";
import { showErrorToast } from "@/lib/errorHandling";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const TYPES: Array<{ value: ProductCatalogOptionType; label: string }> = [
    { value: "group", label: "Grupos" },
    { value: "subgroup", label: "Subgrupos" },
    { value: "brand", label: "Marcas" },
    { value: "size", label: "Talles" },
    { value: "color", label: "Colores" },
];

interface ProductCatalogMastersTabProps {
    options: ProductCatalogOption[];
    onOptionsChanged: () => void;
}

export function ProductCatalogMastersTab({ options, onOptionsChanged }: ProductCatalogMastersTabProps) {
    const [selectedType, setSelectedType] = useState<ProductCatalogOptionType>("group");
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState<ProductCatalogOption | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [name, setName] = useState("");
    const [parentId, setParentId] = useState("");
    const [saving, setSaving] = useState(false);
    const groups = useMemo(() => options.filter((option) => option.type === "group" && option.active), [options]);
    const visibleOptions = useMemo(() => {
        const query = search.trim().toLocaleLowerCase("es-AR");
        return options.filter((option) =>
            option.type === selectedType &&
            (!query || option.name.toLocaleLowerCase("es-AR").includes(query) || option.parent_name?.toLocaleLowerCase("es-AR").includes(query))
        );
    }, [options, search, selectedType]);

    function openDialog(option?: ProductCatalogOption) {
        setEditing(option ?? null);
        setName(option?.name ?? "");
        setParentId(option?.parent_id ?? "");
        setDialogOpen(true);
    }

    async function saveOption() {
        if (!name.trim()) {
            toast.error("El nombre es obligatorio");
            return;
        }
        if (selectedType === "subgroup" && !parentId) {
            toast.error("Seleccione el grupo al que pertenece");
            return;
        }
        setSaving(true);
        try {
            if (editing) {
                await api.updateProductCatalogOption(editing.id, {
                    name: name.trim(),
                    ...(selectedType === "subgroup" ? { parent_id: parentId } : {}),
                });
                toast.success("Valor actualizado");
            } else {
                await api.createProductCatalogOption({
                    type: selectedType,
                    name: name.trim(),
                    ...(selectedType === "subgroup" ? { parent_id: parentId } : {}),
                });
                toast.success("Valor creado");
            }
            setDialogOpen(false);
            onOptionsChanged();
        } catch (error) {
            showErrorToast("No se pudo guardar el valor", error);
        } finally {
            setSaving(false);
        }
    }

    async function toggleOption(option: ProductCatalogOption) {
        try {
            await api.updateProductCatalogOption(option.id, { active: !option.active });
            toast.success(option.active ? "Valor archivado" : "Valor reactivado");
            onOptionsChanged();
        } catch (error) {
            showErrorToast("No se pudo cambiar el estado", error);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Layers3 className="h-5 w-5 text-violet-500" /> Maestros de catálogo</CardTitle>
                <CardDescription>Valores normalizados para evitar duplicados y errores de tipeo en productos, filtros y reportes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex w-full flex-col gap-2 sm:flex-row">
                        <Select value={selectedType} onValueChange={(value) => setSelectedType(value as ProductCatalogOptionType)}>
                            <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Input className="w-full sm:max-w-xs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar valor o grupo..." />
                    </div>
                    <Button onClick={() => openDialog()}><Plus className="mr-2 h-4 w-4" /> Nuevo valor</Button>
                </div>
                <div className="overflow-hidden rounded-md border">
                    <Table>
                        <TableHeader><TableRow><TableHead>Nombre</TableHead>{selectedType === "subgroup" ? <TableHead>Grupo</TableHead> : null}<TableHead>Uso</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {visibleOptions.length === 0 ? (
                                <TableRow><TableCell colSpan={selectedType === "subgroup" ? 5 : 4} className="h-24 text-center text-muted-foreground">Todavía no hay valores en este maestro.</TableCell></TableRow>
                            ) : visibleOptions.map((option) => (
                                <TableRow key={option.id} className={option.active ? "" : "opacity-60"}>
                                    <TableCell className="font-medium">{option.name}</TableCell>
                                    {selectedType === "subgroup" ? <TableCell>{option.parent_name || "-"}</TableCell> : null}
                                    <TableCell>{option.usage_count ?? 0} producto(s)</TableCell>
                                    <TableCell><Badge variant={option.active ? "default" : "secondary"}>{option.active ? "Activo" : "Archivado"}</Badge></TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => openDialog(option)} title="Editar" aria-label={`Editar ${option.name}`}><Pencil className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => void toggleOption(option)} title={option.active ? "Archivar" : "Reactivar"} aria-label={`${option.active ? "Archivar" : "Reactivar"} ${option.name}`}><Power className="h-4 w-4" /></Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                <p className="text-xs text-muted-foreground">Archivar evita nuevas selecciones sin alterar productos ni reportes históricos.</p>
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader><DialogTitle>{editing ? "Editar" : "Nuevo"} {TYPES.find((type) => type.value === selectedType)?.label.toLowerCase()}</DialogTitle><DialogDescription>Los espacios y mayúsculas se normalizan para impedir duplicados equivalentes.</DialogDescription></DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1.5"><Label htmlFor="catalog-master-name">Nombre</Label><Input id="catalog-master-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus /></div>
                        {selectedType === "subgroup" ? (
                            <div className="space-y-1.5"><Label>Grupo</Label><Select value={parentId} onValueChange={setParentId}><SelectTrigger><SelectValue placeholder="Seleccionar grupo" /></SelectTrigger><SelectContent>{groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}</SelectContent></Select></div>
                        ) : null}
                    </div>
                    <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button><Button onClick={() => void saveOption()} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
