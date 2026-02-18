import type { CheckoutSuccessDialogProps } from "@/components/pos/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function CheckoutSuccessDialog({
    open,
    onOpenChange,
    lastOrderId,
    lastInvoice,
    grandTotal,
}: CheckoutSuccessDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Venta registrada</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 text-sm">
                    <p>
                        Orden: <strong>{lastOrderId || "-"}</strong>
                    </p>
                    <p>
                        Factura: <strong>{lastInvoice?.invoice_number ? String(lastInvoice.invoice_number) : "No emitida"}</strong>
                    </p>
                    <p>
                        Total: <strong>${grandTotal.toLocaleString("es-AR")}</strong>
                    </p>
                </div>
                <div className="flex justify-end">
                    <Button onClick={() => onOpenChange(false)}>Cerrar</Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
