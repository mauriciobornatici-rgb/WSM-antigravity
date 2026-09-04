import type { CustomerCheck, InvoicePaymentLineInput } from "@/types/api";

export type PaymentLine = {
    id: string;
    method: InvoicePaymentLineInput["method"];
    amount: string;
    check: {
        issuer_name: string;
        bank_name: string;
        check_number: string;
        issue_date: string;
        due_date: string;
    };
};

export type CheckPortfolioFilter = "all" | "open" | "due_soon" | "overdue" | "cleared";

export const PAYMENT_METHOD_OPTIONS: Array<{ value: PaymentLine["method"]; label: string }> = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta debito" },
    { value: "credit_card", label: "Tarjeta credito" },
    { value: "transfer", label: "Transferencia" },
    { value: "qr", label: "QR" },
    { value: "credit_account", label: "Cuenta corriente" },
    { value: "card", label: "Tarjeta" },
    { value: "check", label: "Cheque" },
];

export const CHECK_STATUS_LABELS: Record<CustomerCheck["status"], string> = {
    received: "Recibido",
    deposited: "Depositado",
    cleared: "Cobrado",
    endorsed: "Entregado / endosado",
    rejected: "Rechazado",
    cancelled: "Anulado",
};
