import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, LayoutDashboard, ShoppingCart, Package, Users, FileText, Landmark, Settings, Truck, ClipboardCheck, X, ArrowRight, Store } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/services/api";
import type { Product } from "@/types";
import { formatMoney } from "@/lib/formatters";
import { grossPrice } from "@/lib/pricing";
import { useAuth } from "@/context/AuthContext";
import { hasPermission, PERMISSIONS, type Permission } from "@wsm/common";

interface NavigationCommand {
    id: string;
    title: string;
    description: string;
    href: string;
    category: "Navegación" | "Acción Rápida";
    icon: typeof LayoutDashboard;
    permission: Permission;
}

const STATIC_COMMANDS: NavigationCommand[] = [
    { id: "nav-pos", title: "Ir al Punto de Venta (POS)", description: "Abrir terminal de cobranzas y caja", href: "/pos", category: "Acción Rápida", icon: ShoppingCart, permission: PERMISSIONS.ORDERS_SELL },
    { id: "nav-dash", title: "Ir a Inicio / Dashboard", description: "Métricas y resumen general de operaciones", href: "/", category: "Navegación", icon: LayoutDashboard, permission: PERMISSIONS.DASHBOARD_READ },
    { id: "nav-inv", title: "Ir a Inventario (WMS)", description: "Gestión de catálogo, stock y ubicaciones", href: "/inventory", category: "Navegación", icon: Package, permission: PERMISSIONS.INVENTORY_MANAGE },
    { id: "nav-clients", title: "Ir a Clientes", description: "Base de datos comercial de clientes", href: "/clients", category: "Navegación", icon: Users, permission: PERMISSIONS.CLIENTS_MANAGE },
    { id: "nav-invoices", title: "Ir a Facturación", description: "Emisión de comprobantes A/B y tickets", href: "/invoices", category: "Navegación", icon: FileText, permission: PERMISSIONS.INVOICES_MANAGE },
    { id: "nav-cash", title: "Ir a Gestión de Caja", description: "Movimientos, aranceles y Cierre Z", href: "/cash-management", category: "Navegación", icon: Landmark, permission: PERMISSIONS.CASH_MANAGE },
    { id: "nav-suppliers", title: "Ir a Proveedores", description: "Cuentas corrientes y pagos de compras", href: "/suppliers", category: "Navegación", icon: Truck, permission: PERMISSIONS.SUPPLIERS_MANAGE },
    { id: "nav-receptions", title: "Ir a Recepciones (WMS)", description: "Control de remitos e ingreso de mercadería", href: "/receptions", category: "Navegación", icon: ClipboardCheck, permission: PERMISSIONS.RECEPTIONS_MANAGE },
    { id: "nav-online-store", title: "Ir a Tienda online", description: "Catálogo, pedidos, envíos, clientes y análisis de Tiendanube", href: "/online-store", category: "Navegación", icon: Store, permission: PERMISSIONS.ONLINE_STORE_READ },
    { id: "nav-online-store-config", title: "Configurar Tiendanube", description: "Credenciales, OAuth, ubicación y webhooks de la tienda online", href: "/online-store?tab=connection", category: "Navegación", icon: Settings, permission: PERMISSIONS.INTEGRATIONS_MANAGE },
    { id: "nav-settings", title: "Ir a Configuración", description: "Empresa, usuarios, sistema, ARCA y auditoría", href: "/settings", category: "Navegación", icon: Settings, permission: PERMISSIONS.SETTINGS_MANAGE },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [query, setQuery] = useState("");
    const [products, setProducts] = useState<Product[]>([]);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);

    // Global shortcut Ctrl+K / Cmd+K listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                onOpenChange(!open);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, onOpenChange]);

    // Live search products when query length >= 2
    useEffect(() => {
        if (!query.trim() || query.length < 2) {
            setProducts([]);
            return;
        }

        const timer = setTimeout(async () => {
            setLoadingProducts(true);
            try {
                const res = await api.getProducts({ search: query.trim() } as Record<string, string>);
                setProducts(Array.isArray(res) ? res.slice(0, 5) : []);
            } catch {
                setProducts([]);
            } finally {
                setLoadingProducts(false);
            }
        }, 200);

        return () => clearTimeout(timer);
    }, [query]);

    const filteredNavCommands = useMemo(() => {
        const allowedCommands = STATIC_COMMANDS.filter((command) => hasPermission(user?.role, command.permission));
        if (!query.trim()) return allowedCommands;
        const q = query.toLowerCase();
        return allowedCommands.filter(c => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }, [query, user?.role]);

    const totalItemsCount = filteredNavCommands.length + products.length;

    const handleSelectCommand = (href: string) => {
        onOpenChange(false);
        setQuery("");
        navigate(href);
    };

    const handleKeyDownInDialog = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev + 1) % Math.max(1, totalItemsCount));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev - 1 + totalItemsCount) % Math.max(1, totalItemsCount));
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (selectedIndex < filteredNavCommands.length) {
                const cmd = filteredNavCommands[selectedIndex];
                if (cmd) handleSelectCommand(cmd.href);
            } else {
                const prod = products[selectedIndex - filteredNavCommands.length];
                if (prod) handleSelectCommand("/inventory");
            }
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="p-0 max-w-2xl overflow-hidden border border-border shadow-2xl rounded-xl">
                {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- el keydown navega la lista de resultados y llega por burbujeo desde el Input enfocable de más abajo, no requiere interacción directa sobre el div */}
                <div className="flex items-center px-4 border-b border-border bg-muted/20" onKeyDown={handleKeyDownInDialog}>
                    <Search className="h-5 w-5 text-muted-foreground shrink-0 mr-3" />
                    <Input
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelectedIndex(0);
                        }}
                        placeholder="Escribe un comando o busca un producto por SKU, nombre..."
                        className="h-14 border-0 focus-visible:ring-0 text-base shadow-none bg-transparent"
                        autoFocus
                    />
                    {query && (
                        <button type="button" aria-label="Limpiar búsqueda" onClick={() => setQuery("")} className="p-1 rounded-md hover:bg-muted text-muted-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                <div className="max-h-[60vh] overflow-y-auto p-2 space-y-4">
                    {/* Navigation Commands */}
                    {filteredNavCommands.length > 0 && (
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 py-1">
                                Accesos Rápidos
                            </div>
                            <div className="space-y-1">
                                {filteredNavCommands.map((cmd, idx) => {
                                    const Icon = cmd.icon;
                                    const isSelected = selectedIndex === idx;
                                    return (
                                        <button
                                            type="button"
                                            key={cmd.id}
                                            onClick={() => handleSelectCommand(cmd.href)}
                                            className={`flex w-full items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all text-left text-sm ${
                                                isSelected ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted text-foreground"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Icon className={`h-4 w-4 ${isSelected ? "text-primary-foreground" : "text-blue-500"}`} />
                                                <div>
                                                    <div className="font-semibold">{cmd.title}</div>
                                                    <div className={`text-xs ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>{cmd.description}</div>
                                                </div>
                                            </div>
                                            <ArrowRight className={`h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`} />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Live Products Results */}
                    {loadingProducts ? (
                        <div className="p-4 text-center text-xs text-muted-foreground animate-pulse">
                            Buscando productos en el catálogo...
                        </div>
                    ) : products.length > 0 ? (
                        <div>
                            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 py-1">
                                Coincidencias en Productos
                            </div>
                            <div className="space-y-1">
                                {products.map((prod, idx) => {
                                    const globalIdx = filteredNavCommands.length + idx;
                                    const isSelected = selectedIndex === globalIdx;
                                    return (
                                        <button
                                            type="button"
                                            key={prod.id}
                                            onClick={() => handleSelectCommand("/inventory")}
                                            className={`flex w-full items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all text-left text-sm ${
                                                isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Package className={`h-4 w-4 ${isSelected ? "text-primary-foreground" : "text-emerald-500"}`} />
                                                <div>
                                                    <div className="font-semibold">{prod.name}</div>
                                                    <div className={`text-xs font-mono ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                                                        SKU: {prod.sku || "-"} | Stock: {prod.stock_current ?? 0}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="font-bold text-sm">
                                                {formatMoney(grossPrice(prod.sale_price, prod.vat_rate))} c/IVA
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    {filteredNavCommands.length === 0 && products.length === 0 && !loadingProducts && (
                        <div className="p-8 text-center text-sm text-muted-foreground">
                            No se encontraron comandos o productos que coincidan con "{query}".
                        </div>
                    )}
                </div>

                <div className="border-t border-border px-4 py-2 bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground select-none">
                    <div className="flex items-center gap-2">
                        <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">↑↓</kbd> Navegar
                        <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">Enter</kbd> Seleccionar
                        <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">Esc</kbd> Cerrar
                    </div>
                    <div>
                        Presiona <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">Ctrl + K</kbd> en cualquier momento
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
