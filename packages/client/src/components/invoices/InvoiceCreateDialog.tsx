import { Plus } from "lucide-react"
import type { Client } from "@/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import type { DraftInvoice, DraftInvoiceItem } from "./types"

type InvoiceCreateDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    clients: Client[]
    draftInvoice: DraftInvoice
    manualItem: DraftInvoiceItem
    total: number
    onDraftChange: (invoice: DraftInvoice) => void
    onManualItemChange: (item: DraftInvoiceItem) => void
    onAddItem: () => void
    onCreateInvoice: () => void
}

export function InvoiceCreateDialog({
    open,
    onOpenChange,
    clients,
    draftInvoice,
    manualItem,
    total,
    onDraftChange,
    onManualItemChange,
    onAddItem,
    onCreateInvoice,
}: InvoiceCreateDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogTrigger asChild>
                <Button className="bg-primary">
                    <Plus className="mr-2 h-4 w-4" />
                    Factura manual
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[800px]">
                <DialogHeader>
                    <DialogTitle>Nueva factura de venta</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Cliente</Label>
                            <Select
                                value={draftInvoice.client_id}
                                onValueChange={(value) => onDraftChange({ ...draftInvoice, client_id: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Seleccionar cliente" />
                                </SelectTrigger>
                                <SelectContent>
                                    {clients.map((client) => (
                                        <SelectItem key={client.id} value={client.id}>
                                            {client.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                                <Label>Tipo</Label>
                                <Select
                                    value={draftInvoice.invoice_type}
                                    onValueChange={(value) => onDraftChange({ ...draftInvoice, invoice_type: value as "A" | "B" })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="A">Factura A</SelectItem>
                                        <SelectItem value="B">Factura B</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Pto. venta</Label>
                                <Input value={draftInvoice.point_of_sale} disabled className="bg-muted" />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 rounded-md border bg-slate-50 p-4 dark:bg-slate-900/50">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Descripción</TableHead>
                                    <TableHead className="w-20">Cant.</TableHead>
                                    <TableHead>Precio unit.</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {draftInvoice.items.map((item, index) => (
                                    <TableRow key={index}>
                                        <TableCell>{item.description}</TableCell>
                                        <TableCell>{item.quantity}</TableCell>
                                        <TableCell>${item.unit_price}</TableCell>
                                        <TableCell className="text-right">
                                            ${((item.quantity * item.unit_price) * (1 + item.vat_rate / 100)).toFixed(2)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>

                        <div className="grid grid-cols-12 gap-2">
                            <div className="col-span-6">
                                <Input
                                    placeholder="Descripción..."
                                    value={manualItem.description}
                                    onChange={(event) =>
                                        onManualItemChange({
                                            ...manualItem,
                                            description: event.target.value,
                                        })
                                    }
                                />
                            </div>
                            <div className="col-span-2">
                                <Input
                                    type="number"
                                    value={manualItem.quantity}
                                    onChange={(event) =>
                                        onManualItemChange({
                                            ...manualItem,
                                            quantity: Number(event.target.value),
                                        })
                                    }
                                />
                            </div>
                            <div className="col-span-2">
                                <Input
                                    type="number"
                                    value={manualItem.unit_price}
                                    onChange={(event) =>
                                        onManualItemChange({
                                            ...manualItem,
                                            unit_price: Number(event.target.value),
                                        })
                                    }
                                />
                            </div>
                            <div className="col-span-2">
                                <Button variant="secondary" className="w-full" onClick={onAddItem}>
                                    Agregar
                                </Button>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end text-xl font-bold">Total: ${total.toFixed(2)}</div>
                </div>
                <DialogFooter>
                    <Button onClick={onCreateInvoice}>Emitir factura</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
