import { useEffect, useReducer } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { User } from "@/types";
import type { UserFormValues, UserRole, UserStatus } from "@/types/api";

interface UserFormProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: UserFormValues) => Promise<void>;
    initialData?: User;
    isLoading?: boolean;
}

const DEFAULT_FORM: UserFormValues = {
    name: "",
    email: "",
    password: "",
    role: "cashier",
    status: "active",
};

function replaceFormState(_: UserFormValues, next: UserFormValues): UserFormValues {
    return next;
}

export function UserForm({ open, onOpenChange, onSubmit, initialData, isLoading }: UserFormProps) {
    const [formData, setFormData] = useReducer(replaceFormState, DEFAULT_FORM);

    useEffect(() => {
        if (!open) return;
        if (initialData) {
            setFormData({
                name: initialData.name || "",
                email: initialData.email || "",
                password: "",
                role: initialData.role || "cashier",
                status: initialData.status || "active",
            });
            return;
        }
        setFormData(DEFAULT_FORM);
    }, [open, initialData]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onSubmit(formData);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{initialData ? "Editar Usuario" : "Nuevo Usuario"}</DialogTitle>
                    <DialogDescription>
                        {initialData
                            ? "Modifica los datos del usuario. Deja la contrasena en blanco para mantener la actual."
                            : "Ingresa los datos del nuevo usuario."}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Nombre Completo</Label>
                        <Input
                            id="name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email">Correo Electronico</Label>
                        <Input
                            id="email"
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="password">{initialData ? "Nueva Contrasena (Opcional)" : "Contrasena"}</Label>
                        <Input
                            id="password"
                            type="password"
                            value={formData.password}
                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                            required={!initialData}
                            minLength={6}
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="role">Rol</Label>
                            <Select
                                value={formData.role}
                                onValueChange={(value: UserRole) => setFormData({ ...formData, role: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar rol" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="admin">Administrador</SelectItem>
                                    <SelectItem value="manager">Manager</SelectItem>
                                    <SelectItem value="cashier">Cajero</SelectItem>
                                    <SelectItem value="warehouse">Depósito</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="status">Estado</Label>
                            <Select
                                value={formData.status}
                                onValueChange={(value: UserStatus) => setFormData({ ...formData, status: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Estado" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Activo</SelectItem>
                                    <SelectItem value="inactive">Inactivo</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {initialData ? "Guardar Cambios" : "Crear Usuario"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
