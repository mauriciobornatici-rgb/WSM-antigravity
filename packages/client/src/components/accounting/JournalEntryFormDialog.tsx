import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { JournalEntryForm } from "./JournalEntryForm"
import type { ChartAccount } from "@/types/accounting"

interface JournalEntryFormDialogProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    date: string
    onDateChange: (val: string) => void
    description: string
    onDescriptionChange: (val: string) => void
    lines: Array<{ account_code: string; debit: number; credit: number; notes: string }>
    chartAccounts: ChartAccount[]
    onUpdateLine: (idx: number, key: "account_code" | "debit" | "credit" | "notes", val: string | number) => void
    onAddLine: () => void
    onRemoveLine: (idx: number) => void
    totalDebit: number
    totalCredit: number
    isBalanced: boolean
    isSubmitting: boolean
    onSubmit: () => void
}

export function JournalEntryFormDialog({
    isOpen,
    onOpenChange,
    date,
    onDateChange,
    description,
    onDescriptionChange,
    lines,
    chartAccounts,
    onUpdateLine,
    onAddLine,
    onRemoveLine,
    totalDebit,
    totalCredit,
    isBalanced,
    isSubmitting,
    onSubmit,
}: JournalEntryFormDialogProps) {
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Editar Asiento Contable</DialogTitle>
                </DialogHeader>
                <div className="space-y-6 max-w-4xl py-4 max-h-[70vh] overflow-y-auto">
                    <JournalEntryForm
                        date={date}
                        onDateChange={onDateChange}
                        description={description}
                        onDescriptionChange={onDescriptionChange}
                        lines={lines}
                        chartAccounts={chartAccounts}
                        onUpdateLine={onUpdateLine}
                        onAddLine={onAddLine}
                        onRemoveLine={onRemoveLine}
                        totalDebit={totalDebit}
                        totalCredit={totalCredit}
                        isBalanced={isBalanced}
                        isSubmitting={isSubmitting}
                        onSubmit={onSubmit}
                        submitLabel="Actualizar Asiento"
                        showCancel={true}
                        onCancel={() => onOpenChange(false)}
                    />
                </div>
            </DialogContent>
        </Dialog>
    )
}
