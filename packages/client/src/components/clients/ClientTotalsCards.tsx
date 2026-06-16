import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ClientTotalsCardsProps {
    accountTotals: {
        billed: number;
        credited: number;
        paid: number;
        balance: number;
    };
}

const formatMoney = (value: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value || 0));
};

export function ClientTotalsCards({ accountTotals }: ClientTotalsCardsProps) {
    return (
        <div className="grid gap-4 md:grid-cols-4">
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Facturado</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-bold">{formatMoney(accountTotals.billed)}</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Notas de credito</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-bold text-amber-500">-{formatMoney(accountTotals.credited)}</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Cobrado</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-2xl font-bold text-emerald-500">-{formatMoney(accountTotals.paid)}</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Saldo calculado</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className={cn("text-2xl font-bold", accountTotals.balance > 0 ? "text-amber-500" : "text-emerald-500")}>
                        {formatMoney(accountTotals.balance)}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
