import { useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import {
    LayoutDashboard,
    Package,
    ShoppingCart,
    FileText,
    Settings,
    Menu,
    ChevronLeft,
    ClipboardList,
    Users,
    BadgeAlert,
    Truck,
    ClipboardCheck,
    FileSpreadsheet,
    Printer,
    Landmark,
    CreditCard,
    Wallet,
    Sun,
    Moon,
    Search,
    Store,
    ScanLine,
    LogOut,
    ShieldAlert,
} from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { CommandPalette } from "@/components/common/CommandPalette";
import { hasPermission, PERMISSIONS, type Permission } from "@wsm/common";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import { queryKeys } from "@/lib/queryKeys";
import { useArcaAlerts } from "@/hooks/useArcaAlerts";
import { arcaAlertCount } from "@/lib/arca";

export default function AppLayout() {
    const { user, logout } = useAuth();

    // Offline POS sales that broke a rule wait for a manager (ADR-011): keep the count visible.
    const canReviewPosExceptions = hasPermission(user?.role, PERMISSIONS.ORDERS_PRICE_OVERRIDE);
    const pendingPosExceptions = useQuery({
        queryKey: queryKeys.posExceptions.byStatus("pending"),
        queryFn: () => api.getPosExceptions("pending"),
        enabled: canReviewPosExceptions,
        refetchInterval: 60_000,
        meta: { silentError: true },
    });
    // ADR-021: ARCA documents in conflict, stuck in verification, rejected or unauthorized, on "Facturación".
    const arcaAlerts = useArcaAlerts();
    const badgeByHref: Record<string, number> = {
        "/pos-exceptions": pendingPosExceptions.data?.length ?? 0,
        "/invoices": arcaAlertCount(arcaAlerts.data),
    };
    const { theme, toggleTheme } = useTheme();
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [collapsed, setCollapsed] = useState(() => (
        typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false
    ));
    const location = useLocation();

    const roleLabels: Record<string, string> = {
        admin: "Administrador",
        manager: "Gerencia",
        cashier: "Caja",
        warehouse: "Depósito",
    };

    const navSections: Array<{ title: string; items: Array<{ name: string; href: string; icon: typeof LayoutDashboard; permission?: Permission }> }> = [
        {
            title: "Operación Comercial",
            items: [
                { name: "Inicio", href: "/", icon: LayoutDashboard },
                { name: "Punto de Venta", href: "/pos", icon: ShoppingCart, permission: PERMISSIONS.ORDERS_SELL },
                { name: "Pedidos", href: "/orders", icon: ClipboardList, permission: PERMISSIONS.ORDERS_READ },
                { name: "Clientes", href: "/clients", icon: Users, permission: PERMISSIONS.CLIENTS_MANAGE },
                { name: "Tienda online", href: "/online-store", icon: Store, permission: PERMISSIONS.ONLINE_STORE_READ },
            ]
        },
        {
            title: "Depósito y Logística",
            items: [
                { name: "Picking", href: "/picking", icon: ScanLine, permission: PERMISSIONS.ORDERS_PICK },
                { name: "Control de stock", href: "/stock-control", icon: ClipboardCheck, permission: PERMISSIONS.INVENTORY_COUNT },
                { name: "Inventario (WMS)", href: "/inventory", icon: Package, permission: PERMISSIONS.INVENTORY_MANAGE },
                { name: "Órdenes de compra", href: "/purchase-orders", icon: FileSpreadsheet, permission: PERMISSIONS.PROCUREMENT_MANAGE },
                { name: "Recepciones", href: "/receptions", icon: ClipboardCheck, permission: PERMISSIONS.RECEPTIONS_MANAGE },
                { name: "Proveedores", href: "/suppliers", icon: Truck, permission: PERMISSIONS.SUPPLIERS_MANAGE },
                { name: "Reclamos y garantías", href: "/returns-warranties", icon: BadgeAlert, permission: PERMISSIONS.WARRANTIES_MANAGE },
            ]
        },
        {
            title: "Administración y Finanzas",
            items: [
                { name: "Excepciones POS", href: "/pos-exceptions", icon: ShieldAlert, permission: PERMISSIONS.ORDERS_PRICE_OVERRIDE },
                { name: "Facturación", href: "/invoices", icon: Printer, permission: PERMISSIONS.INVOICES_MANAGE },
                { name: "Gestión de caja", href: "/cash-management", icon: Landmark, permission: PERMISSIONS.CASH_MANAGE },
                { name: "Cobranzas", href: "/collections", icon: FileText, permission: PERMISSIONS.COLLECTIONS_MANAGE },
                { name: "Pagos Proveedores", href: "/supplier-payments", icon: CreditCard, permission: PERMISSIONS.SUPPLIER_PAYMENTS_MANAGE },
                { name: "Cuentas Corrientes", href: "/current-accounts", icon: Wallet, permission: PERMISSIONS.COLLECTIONS_MANAGE },
                { name: "Contabilidad", href: "/accounting", icon: FileText, permission: PERMISSIONS.ACCOUNTING_MANAGE },
                { name: "Configuración", href: "/settings", icon: Settings, permission: PERMISSIONS.SETTINGS_MANAGE },
            ]
        }
    ];

    const allNavItems = navSections.flatMap((sec) => sec.items);
    const filteredNavItems = allNavItems.filter((item) => !item.permission || hasPermission(user?.role, item.permission));
    const isRouteActive = (href: string) => (
        href === "/" ? location.pathname === "/" : location.pathname === href || location.pathname.startsWith(`${href}/`)
    );
    const activeNavItem = filteredNavItems.find((item) => isRouteActive(item.href));
    const ActiveIcon = activeNavItem?.icon;

    const filteredSections = navSections
        .map((sec) => ({
            ...sec,
            items: sec.items.filter((item) => !item.permission || hasPermission(user?.role, item.permission))
        }))
        .filter((sec) => sec.items.length > 0);

    return (
        <div className="min-h-screen bg-background flex text-foreground font-sans antialiased overflow-hidden">
            <aside
                className={cn(
                    "bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col z-20 text-slate-100",
                    collapsed ? "w-16" : "w-64"
                )}
            >
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800 shrink-0">
                    {!collapsed && <span className="font-bold text-xl text-blue-400 tracking-tight">SportsERP</span>}
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"}
                        aria-expanded={!collapsed}
                        onClick={() => setCollapsed(!collapsed)}
                        className={cn("ml-auto hover:bg-slate-800 text-slate-300 hover:text-white", collapsed && "mx-auto")}
                    >
                        {collapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </Button>
                </div>

                <nav className="flex-1 p-2 space-y-4 overflow-y-auto scrollbar-none">
                    {filteredSections.map((sec) => (
                        <div key={sec.title} className="space-y-1">
                            {!collapsed && (
                                <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider px-3 mb-1.5 mt-3 select-none">
                                    {sec.title}
                                </div>
                            )}
                            {collapsed && sec.title !== "General" && (
                                <div className="border-t border-slate-800 my-2 mx-2" />
                            )}
                            <div className="space-y-1">
                                {sec.items.map((item) => {
                                    const isActive = isRouteActive(item.href);
                                    const badge = badgeByHref[item.href] ?? 0;
                                    const badgeLabel = badge >= 100 ? "99+" : String(badge);
                                    return (
                                        <Link
                                            key={item.href}
                                            to={item.href}
                                            className={cn(
                                                "relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group text-sm font-medium",
                                                isActive
                                                    ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20 font-bold"
                                                    : "hover:bg-slate-800 text-slate-300 hover:text-white",
                                                collapsed && "justify-center px-2"
                                            )}
                                        >
                                            <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-white" : "text-slate-400 group-hover:text-white")} />
                                            {!collapsed && <span>{item.name}</span>}
                                            {badge > 0 && (
                                                <span
                                                    className={cn(
                                                        "rounded-full bg-amber-400 text-[10px] font-bold text-slate-900",
                                                        collapsed ? "absolute right-1.5 top-1.5 h-2.5 w-2.5" : "ml-auto px-1.5 py-0.5"
                                                    )}
                                                >
                                                    {!collapsed && <span aria-hidden="true">{badgeLabel}</span>}
                                                    <span className="sr-only">
                                                        {item.href === "/invoices"
                                                            ? `${badgeLabel} ${badge === 1 ? "alerta" : "alertas"} de ARCA`
                                                            : `${badgeLabel} ${badge === 1 ? "pendiente" : "pendientes"} de revisión`}
                                                    </span>
                                                </span>
                                            )}
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </nav>
            </aside>

            <main className="flex-1 flex flex-col h-screen overflow-hidden bg-background relative selection:bg-blue-500/30">
                <div className="absolute top-0 left-0 right-0 h-96 bg-blue-500/5 rounded-full blur-3xl -z-10 transform -translate-y-1/2" />

                <header className="h-16 border-b border-border px-2 sm:px-6 flex items-center justify-between gap-2 bg-background/90 backdrop-blur-md z-10 text-foreground">
                    <h1 className="min-w-0 flex flex-1 items-center gap-1.5 text-sm font-bold capitalize tracking-tight sm:gap-2 sm:text-xl">
                        {ActiveIcon ? <ActiveIcon className="h-4 w-4 shrink-0 text-blue-500 sm:h-5 sm:w-5" /> : null}
                        <span className="truncate">{activeNavItem?.name || "Inicio"}</span>
                    </h1>
                    <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCommandPaletteOpen(true)}
                            className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 border-border hover:bg-muted"
                        >
                            <Search className="h-3.5 w-3.5" />
                            <span>Buscar / Comandos</span>
                            <kbd className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono border border-border">Ctrl K</kbd>
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label={theme === "dark" ? "Activar tema claro" : "Activar tema oscuro"}
                            onClick={toggleTheme}
                            title={theme === "dark" ? "Cambiar a Modo Día" : "Cambiar a Modo Noche"}
                            className="text-slate-400 hover:text-foreground hover:bg-slate-800/40 rounded-lg"
                        >
                            {theme === "dark" ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5 text-indigo-500" />}
                        </Button>
                        <div className="text-right hidden sm:block">
                            <p className="text-sm font-medium text-foreground">{user?.name || "Usuario"}</p>
                            <p className="text-xs text-blue-400 uppercase font-bold tracking-wider">
                                {roleLabels[user?.role || ""] || user?.role || "-"}
                            </p>
                        </div>
                        <div className="hidden h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20 sm:flex">
                            {(user?.name || "U").charAt(0)}
                        </div>
                        <Button variant="ghost" size="icon" aria-label="Salir" onClick={() => void logout()} className="text-slate-400 hover:text-foreground hover:bg-slate-800/40 sm:hidden">
                            <LogOut className="h-5 w-5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void logout()} className="hidden text-slate-400 hover:text-foreground hover:bg-slate-800/40 sm:inline-flex">
                            Salir
                        </Button>
                    </div>
                </header>

                <div className="flex-1 overflow-auto p-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent sm:p-6">
                    <Outlet />
                </div>
            </main>

            <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
        </div>
    );
}
