import type { SupplierInvoiceResponse } from '@/services/api';

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// ADR-029: lo que la factura dejó en «Notas de crédito a recibir» y todavía no saldó ninguna nota.
export function creditPending(invoice: Pick<SupplierInvoiceResponse, 'credit_expected_amount' | 'credit_applied_amount'>): number {
    return round2(Math.max(0, Number(invoice.credit_expected_amount || 0) - Number(invoice.credit_applied_amount || 0)));
}

// ADR-029: lo que queda por pagar de una factura: su total menos lo pagado y sus notas de crédito.
export function supplierInvoicePending(total: number | string, paid: number, credited: number | string | undefined): number {
    return round2(Math.max(0, Number(total || 0) - paid - Number(credited || 0)));
}