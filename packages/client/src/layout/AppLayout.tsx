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
} from "lucide-react";

export default function AppLayout() {
    const { user, logout } = useAuth();
    const [collapsed, setCollapsed] = useState(false);
    const location = useLocation();

    const roleLabels: Record<string, string> = {
        admin: "Administrador",
        manager: "Gerencia",
        cashier: "Caja",
        warehouse: "Deposito",
    };

    const navItems = [
        { name: "Inicio", href: "/", icon: LayoutDashboard, roles: ["admin", "manager", "cashier", "warehouse"] },
        { name: "Inventario (WMS)", href: "/inventory", icon: Package, roles: ["admin", "manager", "warehouse"] },
        { name: "Ordenes de Compra", href: "/purchase-orders", icon: FileSpreadsheet, roles: ["admin", "manager"] },
        { name: "Recepciones", href: "/receptions", icon: ClipboardCheck, roles: ["admin", "manager", "warehouse"] },
        { name: "Proveedores", href: "/suppliers", icon: Truck, roles: ["admin", "manager"] },
        { name: "Pedidos y Preparacion", href: "/orders", icon: ClipboardList, roles: ["admin", "manager", "cashier", "warehouse"] },
        { name: "Clientes", href: "/clients", icon: Users, roles: ["admin", "manager", "cashier"] },
        { name: "Reclamos y Garantias", href: "/returns-warranties", icon: BadgeAlert, roles: ["admin", "manager", "cashier"] },
        { name: "Punto de Venta", href: "/pos", icon: ShoppingCart, roles: ["admin", "cashier"] },
        { name: "Facturacion", href: "/invoices", icon: Printer, roles: ["admin", "manager", "cashier"] },
        { name: "Gestion de Caja", href: "/cash-management", icon: Landmark, roles: ["admin", "cashier"] },
        { name: "Contabilidad", href: "/accounting", icon: FileText, roles: ["admin"] },
        { name: "Configuracion", href: "/settings", icon: Settings, roles: ["admin"] },
    ];

    const filteredNavItems = navItems.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
    const activeNavItem = filteredNavItems.find((item) => item.href === location.pathname);
    const ActiveIcon = activeNavItem?.icon;

    return (
        <div className="min-h-screen bg-background flex text-foreground font-sans antialiased overflow-hidden">
            <aside
                className={cn(
                    "bg-slate-900/50 backdrop-blur-xl border-r border-slate-800 transition-all duration-300 flex flex-col z-20",
                    collapsed ? "w-16" : "w-64"
                )}
            >
                <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
                    {!collapsed && <span className="font-bold text-xl text-blue-400 tracking-tight">SportsERP</span>}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setCollapsed(!collapsed)}
                        className={cn("ml-auto hover:bg-slate-800 text-slate-400", collapsed && "mx-auto")}
                    >
                        {collapsed ? <Menu className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                    </Button>
                </div>

                <nav className="flex-1 p-2 space-y-2">
                    {filteredNavItems.map((item) => {
                        const isActive = location.pathname === item.href;
                        return (
                            <Link
                                key={item.href}
                                to={item.href}
                                className={cn(
                                    "flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200",
                                    isActive
                                        ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20"
                                        : "hover:bg-slate-800/50 text-slate-400 hover:text-white",
                                    collapsed && "justify-center px-2"
                                )}
                            >
                                <item.icon className={cn("h-5 w-5", isActive ? "text-white" : "text-slate-400 group-hover:text-white")} />
                                {!collapsed && <span>{item.name}</span>}
                            </Link>
                        );
                    })}
                </nav>
            </aside>

            <main className="flex-1 flex flex-col h-screen overflow-hidden bg-background relative selection:bg-blue-500/30">
                <div className="absolute top-0 left-0 right-0 h-96 bg-blue-500/5 rounded-full blur-3xl -z-10 transform -translate-y-1/2" />

                <header className="h-16 border-b border-slate-800 px-6 flex items-center justify-between bg-background/80 backdrop-blur-md z-10">
                    <h1 className="text-xl font-bold capitalize tracking-tight flex items-center gap-2">
                        {ActiveIcon ? <ActiveIcon className="h-5 w-5 text-blue-500" /> : null}
                        {activeNavItem?.name || "Inicio"}
                    </h1>
                    <div className="flex items-center gap-4">
                        <div className="text-right hidden sm:block">
                            <p className="text-sm font-medium text-slate-200">{user?.name || "Usuario"}</p>
                            <p className="text-xs text-blue-400 uppercase font-bold tracking-wider">
                                {roleLabels[user?.role || ""] || user?.role || "-"}
                            </p>
                        </div>
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20">
                            {(user?.name || "U").charAt(0)}
                        </div>
                        <Button variant="ghost" size="sm" onClick={logout} className="text-slate-400 hover:text-white hover:bg-slate-800">
                            Salir
                        </Button>
                    </div>
                </header>

                <div className="flex-1 overflow-auto p-6 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
