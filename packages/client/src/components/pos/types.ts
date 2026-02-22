import type { Client, Product } from "@/types";
import type { CashRegister, CashShiftSummary, Invoice } from "@/types/api";

export type POSProduct = Product & { stock: number };
export type CartItem = POSProduct & { quantity: number };
export type PaymentMethod = "cash" | "debit_card" | "credit_card" | "qr" | "transfer" | "credit_account";
export type InvoiceType = "A" | "B";
export type PaymentSplit = { id: string; method: PaymentMethod; amount: number };

export type NewClientForm = {
    name: string;
    tax_id: string;
    email: string;
    phone: string;
    address: string;
    credit_limit: number;
};

export type PaymentMethodOption = { value: PaymentMethod; label: string };
export type InvoiceTypeOption = { value: InvoiceType; label: string };

export const PAYMENT_METHOD_OPTIONS: PaymentMethodOption[] = [
    { value: "cash", label: "Efectivo" },
    { value: "debit_card", label: "Tarjeta débito" },
    { value: "credit_card", label: "Tarjeta crédito" },
    { value: "qr", label: "QR" },
    { value: "transfer", label: "Transferencia" },
    { value: "credit_account", label: "Cuenta corriente" },
];

export const INVOICE_TYPE_OPTIONS: InvoiceTypeOption[] = [
    { value: "B", label: "Factura B" },
    { value: "A", label: "Factura A" },
];

export type CartPanelProps = {
    clients: Client[];
    selectedClientId: string;
    onClientChange: (clientId: string) => void;
    onOpenClientDialog: () => void;
    selectedClient: Client | null;
    cart: CartItem[];
    onRemoveFromCart: (productId: string) => void;
    onUpdateQuantity: (productId: string, delta: number) => void;
    subtotal: number;
    taxLabel: string;
    taxAmount: number;
    grandTotal: number;
    onOpenPaymentDialog: () => void;
    currentShift: CashShiftSummary | null;
    currentRegister: CashRegister | null;
};

export type CheckoutSuccessDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    lastOrderId: string | null;
    lastInvoice: Invoice | null;
    grandTotal: number;
};
