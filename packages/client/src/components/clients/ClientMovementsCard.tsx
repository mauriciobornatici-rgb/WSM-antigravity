import { History, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type ClientMovement = {
    id: string;
    date: string;
    type: "sale" | "credit_note" | "return" | "payment" | "adjustment";
    description: string;
    amount: number;
    document_id?: string;
    related_invoice_id?: string;
};

interface ClientMovementsCardProps {
    movements: ClientMovement[];
    onPrint: (movement: ClientMovement) => void;
}

const formatMoney = (value: number) => {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value || 0));
};

function movementLabel(type: ClientMovement["type"]): string {
    switch (type) {
        case "sale":
            return "Venta";
        case "credit_note":
            return "Nota de credito";
        case "return":
            return "Devolucion";
        case "adjustment":
            return "Ajuste";
        default:
            return "Pago";
    }
}

function movementVariant(type: ClientMovement["type"]): "default" | "secondary" | "outline" | "destructive" {
    switch (type) {
        case "credit_note":
        case "return":
            return "secondary";
        case "adjustment":
            return "outline";
        case "payment":
            return "default";
        default:
            return "outline";
    }
}

function canPrintMovement(movement: ClientMovement): boolean {
    return movement.type === "sale" || movement.type === "credit_note" || movement.type === "payment";
}

export function ClientMovementsCard({ movements, onPrint }: ClientMovementsCardProps) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5 text-purple-500" />
                    Resumen integral de cuenta
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="max-h-[430px] overflow-auto">
                    <Table className="min-w-[720px]">
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Descripcion</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead className="text-right">Monto</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {movements.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                                        Sin movimientos.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                movements.map((movement) => (
                                    <TableRow key={movement.id}>
                                        <TableCell>{new Date(movement.date).toLocaleDateString("es-AR")}</TableCell>
                                        <TableCell>{movement.description}</TableCell>
                                        <TableCell>
                                            <Badge variant={movementVariant(movement.type)}>
                                                {movementLabel(movement.type)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className={cn("text-right", movement.amount < 0 ? "text-emerald-500" : "text-amber-500")}>
                                            {formatMoney(movement.amount)}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {canPrintMovement(movement) ? (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => onPrint(movement)}
                                                >
                                                    <Printer className="mr-1 h-4 w-4" />
                                                    Imprimir
                                                </Button>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
