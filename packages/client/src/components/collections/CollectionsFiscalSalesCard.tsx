import { Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginationControls } from "@/components/common/PaginationControls";
import { formatMoney } from "@/lib/formatters";
import type { FiscalSaleStatus } from "@/types/api";

interface CollectionsFiscalSalesCardProps {
    fiscalSales: FiscalSaleStatus[];
    page: number;
    onPageChange: (page: number) => void;
    pageSize?: number;
}

export function CollectionsFiscalSalesCard({
    fiscalSales,
    page,
    onPageChange,
    pageSize = 10,
}: CollectionsFiscalSalesCardProps) {
    const totalPages = Math.max(1, Math.ceil(fiscalSales.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const visibleSales = fiscalSales.slice((safePage - 1) * pageSize, safePage * pageSize);

    return (
        <Card className="order-last">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <Receipt className="h-5 w-5" /> Control fiscal de ventas
                </CardTitle>
                <CardDescription>
                    Todas las ventas asociadas a clientes, separando la deuda financiera del estado de facturación y CAE.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <Table className="min-w-[900px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Venta</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Factura</TableHead>
                                <TableHead>Estado fiscal</TableHead>
                                <TableHead className="text-right">Total venta</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {fiscalSales.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                                        No hay ventas vinculadas a clientes para controlar.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                visibleSales.map((sale) => (
                                    <TableRow key={sale.order_id}>
                                        <TableCell className="font-mono text-xs">
                                            {sale.order_id.slice(0, 8).toUpperCase()}
                                        </TableCell>
                                        <TableCell>
                                            <p className="font-medium">{sale.client_name}</p>
                                            <p className="text-xs text-muted-foreground">{sale.client_tax_id || "Sin CUIT/DNI"}</p>
                                        </TableCell>
                                        <TableCell>{new Date(sale.sale_date).toLocaleDateString("es-AR")}</TableCell>
                                        <TableCell>
                                            {sale.invoice_id
                                                ? `${sale.invoice_type}-${String(sale.point_of_sale || 0).padStart(4, "0")}-${String(sale.invoice_number || 0).padStart(8, "0")}`
                                                : "—"}
                                        </TableCell>
                                        <TableCell>
                                            {sale.fiscal_status === "authorized" ? (
                                                <Badge className="bg-emerald-600">CAE autorizado</Badge>
                                            ) : sale.fiscal_status === "pending_cae" ? (
                                                <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-300">
                                                    Factura sin CAE
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">Pendiente de facturar</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right font-mono font-semibold">
                                            {formatMoney(sale.order_total)}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <PaginationControls
                    page={safePage}
                    totalPages={totalPages}
                    totalCount={fiscalSales.length}
                    itemLabel="venta"
                    onPageChange={onPageChange}
                />
            </CardContent>
        </Card>
    );
}
