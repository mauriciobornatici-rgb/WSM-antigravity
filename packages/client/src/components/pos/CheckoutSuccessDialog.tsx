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
            <DialogContent className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Venta registrada</DialogTitle>
                </DialogHeader>
                <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
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
                <div className="flex justify-end border-t pt-3">
                    <Button type="button" onClick={() => onOpenChange(false)}>
                        Cerrar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
