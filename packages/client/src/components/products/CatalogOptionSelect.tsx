import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import type { ProductCatalogOption, ProductCatalogOptionType } from "@/types";
import { api } from "@/services/api";
import { showErrorToast } from "@/lib/errorHandling";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const EMPTY_VALUE = "__none__";

const TYPE_LABELS: Record<ProductCatalogOptionType, string> = {
    group: "grupo",
    subgroup: "subgrupo",
    brand: "marca",
    size: "talle",
    color: "color",
};

interface CatalogOptionSelectProps {
    type: ProductCatalogOptionType;
    value?: string | null;
    options: ProductCatalogOption[];
    parentId?: string | null;
    placeholder: string;
    onValueChange: (value: string | null) => void;
    onCreated: (option: ProductCatalogOption) => void;
}

export function CatalogOptionSelect({
    type,
    value,
    options,
    parentId,
    placeholder,
    onValueChange,
    onCreated,
}: CatalogOptionSelectProps) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const availableOptions = options.filter((option) =>
        option.type === type &&
        (option.active || option.id === value) &&
        (type !== "subgroup" || option.parent_id === parentId)
    );
    const canCreate = type !== "subgroup" || Boolean(parentId);

    async function createOption() {
        const normalizedName = name.trim();
        if (!normalizedName) {
            toast.error("Ingrese un nombre");
            return;
        }
        setSaving(true);
        try {
            const created = await api.createProductCatalogOption({
                type,
                name: normalizedName,
                ...(type === "subgroup" ? { parent_id: parentId } : {}),
            });
            onCreated(created);
            setName("");
            setDialogOpen(false);
            // Radix must render the newly added option before it can display it as selected.
            window.setTimeout(() => onValueChange(created.id), 0);
            toast.success(`${TYPE_LABELS[type][0]?.toUpperCase()}${TYPE_LABELS[type].slice(1)} creado`);
        } catch (error) {
            showErrorToast(`No se pudo crear el ${TYPE_LABELS[type]}`, error);
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
            <div className="flex gap-2">
                <Select
                    value={value || EMPTY_VALUE}
                    onValueChange={(next) => {
                        if (next === EMPTY_VALUE) {
                            onValueChange(null);
                        } else if (next.trim()) {
                            onValueChange(next);
                        }
                    }}
                >
                    <SelectTrigger className="min-w-0 flex-1">
                        <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={EMPTY_VALUE}>Sin asignar</SelectItem>
                        {availableOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                                {option.name}{option.active ? "" : " (archivado)"}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    disabled={!canCreate}
                    title={canCreate ? `Crear ${TYPE_LABELS[type]}` : "Seleccione primero un grupo"}
                    aria-label={canCreate ? `Crear ${TYPE_LABELS[type]}` : "Seleccione primero un grupo"}
                    onClick={() => setDialogOpen(true)}
                >
                    <Plus className="h-4 w-4" />
                </Button>
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Nuevo {TYPE_LABELS[type]}</DialogTitle>
                        <DialogDescription>
                            Se agregará al maestro y quedará seleccionado en este producto.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Label htmlFor={`new-catalog-${type}`}>Nombre</Label>
                        <Input
                            id={`new-catalog-${type}`}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    void createOption();
                                }
                            }}
                            autoFocus
                        />
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button type="button" onClick={() => void createOption()} disabled={saving}>
                            {saving ? "Creando..." : "Crear y seleccionar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
