import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { SupplierPaymentCreateInput } from '@/types/api';

interface PaymentLine {
    id: string;
    amount: string;
    payment_method: string;
    reference_number: string;
}

interface SupplierPaymentFormProps {
    supplier: {
        id: string;
        name: string;
        account_balance?: number;
    };
    onSubmit: (data: SupplierPaymentCreateInput) => Promise<void>;
    onCancel: () => void;
}

export function SupplierPaymentForm({ supplier, onSubmit, onCancel }: SupplierPaymentFormProps) {
    const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
        { id: crypto.randomUUID(), amount: '', payment_method: 'Efectivo', reference_number: '' }
    ]);

    const addPaymentLine = () => {
        setPaymentLines([...paymentLines, {
            id: crypto.randomUUID(),
            amount: '',
            payment_method: 'Efectivo',
            reference_number: ''
        }]);
    };

    const removePaymentLine = (id: string) => {
        if (paymentLines.length === 1) return;
        setPaymentLines(paymentLines.filter(line => line.id !== id));
    };

    const updateLine = (id: string, field: keyof PaymentLine, value: string) => {
        setPaymentLines(paymentLines.map(line =>
            line.id === id ? { ...line, [field]: value } : line
        ));
    };

    const totalAmount = paymentLines.reduce((acc, line) => acc + parseFloat(line.amount || '0'), 0);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (totalAmount <= 0) {
            toast.error("El monto total debe ser mayor a 0");
            return;
        }

        const validLines = paymentLines.filter(l => parseFloat(l.amount) > 0);
        if (validLines.length === 0) {
            toast.error("Debe ingresar al menos un pago válido");
            return;
        }

        setSubmitting(true);
        try {
            const data: SupplierPaymentCreateInput = {
                supplier_id: supplier.id,
                payment_date: paymentDate,
                payments: validLines.map(l => ({
                    amount: parseFloat(l.amount),
                    payment_method: l.payment_method,
                    ...(l.reference_number ? { reference_number: l.reference_number } : {}),
                })),
                ...(notes ? { notes } : {}),
            };

            await onSubmit(data);
        } catch {
            // Error handling is delegated to the parent component
        } finally {
            setSubmitting(false);
        }
    };

    const currentBalance = Number(supplier.account_balance) || 0;
    const newBalance = currentBalance - totalAmount;

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Balance Info */}
            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-sm text-muted-foreground">Saldo Actual</p>
                        <p className="text-2xl font-bold">
                            ${currentBalance.toLocaleString()}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm text-muted-foreground">Nuevo Saldo</p>
                        <p className={`text-2xl font-bold ${newBalance < 0 ? 'text-green-600' : 'text-red-500'}`}>
                            ${newBalance.toLocaleString()}
                        </p>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Label className="text-lg font-semibold">Desglose de Pago</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addPaymentLine} className="text-blue-600 border-blue-200 hover:bg-blue-50">
                        <Plus className="h-4 w-4 mr-2" /> Agregar Método
                    </Button>
                </div>

                <div className="space-y-3">
                    {paymentLines.map((line) => (
                        <div key={line.id} className="grid grid-cols-12 gap-3 items-end bg-white dark:bg-slate-950 p-3 rounded-md border border-slate-100 dark:border-slate-800 shadow-sm transition-all hover:border-blue-200 dark:hover:border-blue-800">
                            <div className="col-span-12 md:col-span-3 space-y-1.5">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Método</Label>
                                <Select value={line.payment_method} onValueChange={(val) => updateLine(line.id, 'payment_method', val)}>
                                    <SelectTrigger className="h-9">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Efectivo">Efectivo</SelectItem>
                                        <SelectItem value="Transferencia">Transferencia</SelectItem>
                                        <SelectItem value="Echeq">Echeq</SelectItem>
                                        <SelectItem value="Cheque Físico">Cheque Físico</SelectItem>
                                        <SelectItem value="Otro">Otro</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="col-span-12 md:col-span-3 space-y-1.5">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Monto</Label>
                                <div className="relative">
                                    <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={line.amount}
                                        onChange={(e) => updateLine(line.id, 'amount', e.target.value)}
                                        placeholder="0.00"
                                        className="pl-8 h-9"
                                    />
                                </div>
                            </div>

                            <div className="col-span-12 md:col-span-5 space-y-1.5">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Referencia / Observación</Label>
                                <Input
                                    value={line.reference_number}
                                    onChange={(e) => updateLine(line.id, 'reference_number', e.target.value)}
                                    placeholder="Ej: Nro de cheque o Transf."
                                    className="h-9"
                                />
                            </div>

                            <div className="col-span-12 md:col-span-1 flex justify-end">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => removePaymentLine(line.id)}
                                    disabled={paymentLines.length === 1}
                                    className="h-9 w-9 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="paymentDate">Fecha General de Pago</Label>
                    <Input
                        id="paymentDate"
                        type="date"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        required
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="notes">Notas Generales</Label>
                    <Input
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Ej: Pago de factura #123..."
                    />
                </div>
            </div>

            {/* Footer Actions */}
            <div className="flex justify-between items-center pt-4 border-t">
                <div className="text-sm font-medium">
                    Total a Registrar: <span className="text-blue-600 text-lg ml-1 font-bold">${totalAmount.toLocaleString()}</span>
                </div>
                <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                        Cancelar
                    </Button>
                    <Button type="submit" disabled={submitting || totalAmount <= 0} className="bg-blue-600 hover:bg-blue-700">
                        {submitting ? 'Registrando...' : 'Registrar Pago Completo'}
                    </Button>
                </div>
            </div>
        </form>
    );
}

