import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArgentinaDateInput } from "@/components/common/ArgentinaDateInput";
import { formatMoney } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_OPTIONS, type PaymentLine } from "./types";

interface CollectionsPaymentFormCardProps {
    isActive: boolean;
    totalSelected: number;
    totalToRegister: number;
    remainingToAssign: number;
    paymentLines: PaymentLine[];
    onUpdatePaymentLine: (lineId: string, patch: Partial<PaymentLine>) => void;
    onRemovePaymentLine: (lineId: string) => void;
    onAddPaymentLine: () => void;
    paymentNotes: string;
    onPaymentNotesChange: (notes: string) => void;
    isSubmitDisabled: boolean;
    isRegistering: boolean;
    onSubmit: () => void;
}

export function CollectionsPaymentFormCard({
    isActive,
    totalSelected,
    totalToRegister,
    remainingToAssign,
    paymentLines,
    onUpdatePaymentLine,
    onRemovePaymentLine,
    onAddPaymentLine,
    paymentNotes,
    onPaymentNotesChange,
    isSubmitDisabled,
    isRegistering,
    onSubmit,
}: CollectionsPaymentFormCardProps) {
    return (
        <Card className={cn("transition-opacity", !isActive ? "opacity-50 pointer-events-none" : "opacity-100")}>
            <CardHeader>
                <CardTitle className="text-lg">3. Métodos de Pago</CardTitle>
                <CardDescription>
                    Asigna los métodos de pago para cubrir <span className="font-semibold text-foreground">{formatMoney(totalSelected)}</span>.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-3">
                    {paymentLines.map((line) => (
                        <div key={line.id} className="space-y-2 rounded-md border p-2">
                            <div className="grid gap-2 grid-cols-[1fr_auto]">
                                <Select
                                    value={line.method}
                                    onValueChange={(value) => onUpdatePaymentLine(line.id, { method: value as PaymentLine["method"] })}
                                >
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PAYMENT_METHOD_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="flex items-center gap-1">
                                    <Input
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={line.amount}
                                        onChange={(event) => onUpdatePaymentLine(line.id, { amount: event.target.value })}
                                        placeholder="0.00"
                                        className="w-24 text-right"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                        onClick={() => onRemovePaymentLine(line.id)}
                                        disabled={paymentLines.length <= 1}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                            {line.method === "check" ? (
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <Input
                                        value={line.check.issuer_name}
                                        onChange={(event) => onUpdatePaymentLine(line.id, { check: { ...line.check, issuer_name: event.target.value } })}
                                        placeholder="Librador / titular"
                                    />
                                    <Input
                                        value={line.check.bank_name}
                                        onChange={(event) => onUpdatePaymentLine(line.id, { check: { ...line.check, bank_name: event.target.value } })}
                                        placeholder="Banco"
                                    />
                                    <Input
                                        value={line.check.check_number}
                                        onChange={(event) => onUpdatePaymentLine(line.id, { check: { ...line.check, check_number: event.target.value } })}
                                        placeholder="Número de cheque"
                                    />
                                    <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Fecha de emisión</Label>
                                            <ArgentinaDateInput
                                                value={line.check.issue_date}
                                                onChange={(value) => onUpdatePaymentLine(line.id, { check: { ...line.check, issue_date: value } })}
                                                ariaLabel="Fecha de emisión del cheque"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Fecha de cobro / vencimiento</Label>
                                            <ArgentinaDateInput
                                                value={line.check.due_date}
                                                onChange={(value) => onUpdatePaymentLine(line.id, { check: { ...line.check, due_date: value } })}
                                                ariaLabel="Fecha de cobro o vencimiento del cheque"
                                                required
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground sm:col-span-2">
                                        Formato argentino: dd/mm/aaaa. El cheque ingresará automáticamente a cartera.
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    ))}
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full border-dashed"
                        onClick={onAddPaymentLine}
                    >
                        <Plus className="mr-1 h-4 w-4" />
                        Agregar línea
                    </Button>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="notes">Observaciones (Opcional)</Label>
                    <Textarea
                        id="notes"
                        placeholder="Detalle de transferencia, cheque, etc."
                        className="resize-none"
                        value={paymentNotes}
                        onChange={(e) => onPaymentNotesChange(e.target.value)}
                    />
                </div>
            </CardContent>
            <CardFooter className="flex-col gap-4 bg-muted/50 p-4 border-t">
                <div className="w-full space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Total seleccionado:</span>
                        <span className="font-semibold">{formatMoney(totalSelected)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Total asignado:</span>
                        <span className="font-semibold">{formatMoney(totalToRegister)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t">
                        <span className="text-muted-foreground">Restante:</span>
                        <span
                            className={cn(
                                "font-bold",
                                remainingToAssign < -0.01 ? "text-red-500" : remainingToAssign > 0.01 ? "text-amber-500" : "text-emerald-500",
                            )}
                        >
                            {formatMoney(Math.abs(remainingToAssign))} {remainingToAssign < -0.01 && "(Excede)"}
                        </span>
                    </div>
                </div>
                <Button className="w-full" size="lg" disabled={isSubmitDisabled} onClick={onSubmit}>
                    {isRegistering ? "Procesando..." : "Registrar Cobranza"}
                </Button>
            </CardFooter>
        </Card>
    );
}
