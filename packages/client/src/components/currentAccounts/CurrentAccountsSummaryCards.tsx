import { Wallet, TrendingUp, TrendingDown, ArrowLeftRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/formatters";
import type { Client, Supplier } from "@/types";

interface CurrentAccountsSummaryCardsProps {
    accountType: "client" | "supplier";
    summaryKPI: {
        totalBilled: number;
        totalPaid: number;
        totalCredits: number;
        currentBalance: number;
    };
    selectedClient?: Client | undefined;
    selectedSupplier?: Supplier | undefined;
}

export function CurrentAccountsSummaryCards({
    accountType,
    summaryKPI,
    selectedClient,
}: CurrentAccountsSummaryCardsProps) {
    const isClient = accountType === "client";
    const balance = summaryKPI.currentBalance;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Current Balance */}
            <Card className="border-border shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {isClient ? "Saldo Adeudado (Cliente)" : "Saldo a Pagar (Proveedor)"}
                        </p>
                        <p
                            className={`text-2xl font-black mt-0.5 font-mono ${
                                balance > 0
                                    ? isClient
                                        ? "text-amber-500"
                                        : "text-rose-500"
                                    : "text-emerald-500"
                            }`}
                        >
                            {formatMoney(balance)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            {balance > 0 ? "Saldo pendiente actual" : "Cuenta al día / Sin deuda"}
                        </p>
                    </div>
                    <div
                        className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                            balance > 0 ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
                        }`}
                    >
                        <Wallet className="h-5 w-5" />
                    </div>
                </CardContent>
            </Card>

            {/* Total Facturado */}
            <Card className="border-border shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {isClient ? "Total Ventas Facturadas" : "Total Compras Facturadas"}
                        </p>
                        <p className="text-xl font-black text-foreground mt-0.5 font-mono">
                            {formatMoney(summaryKPI.totalBilled)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Acumulado histórico</p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                        <TrendingUp className="h-5 w-5" />
                    </div>
                </CardContent>
            </Card>

            {/* Total Cobrado / Pagado */}
            <Card className="border-border shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {isClient ? "Total Cobranzas Recibidas" : "Total Pagos Emitidos"}
                        </p>
                        <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                            {formatMoney(summaryKPI.totalPaid)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Cancelaciones registradas</p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <TrendingDown className="h-5 w-5" />
                    </div>
                </CardContent>
            </Card>

            {/* Límite de Crédito o Créditos */}
            <Card className="border-border shadow-sm">
                <CardContent className="p-4 flex items-center justify-between">
                    <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            {isClient ? "Límite de Crédito" : "Notas de Crédito / Dev."}
                        </p>
                        <p className="text-xl font-black text-foreground mt-0.5 font-mono">
                            {isClient
                                ? formatMoney(selectedClient?.credit_limit ?? 0)
                                : formatMoney(summaryKPI.totalCredits)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            {isClient ? "Margen operativo asignado" : "Descuentos y ajustes"}
                        </p>
                    </div>
                    <div className="h-10 w-10 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                        <ArrowLeftRight className="h-5 w-5" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
