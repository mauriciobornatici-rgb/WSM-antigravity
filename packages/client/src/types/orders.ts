import type { Order } from "@/types"

export type OrderStatus = Order["status"];
export type OrderFilter = OrderStatus | "all";
export type ShippingMethod = "pickup" | "delivery";
export type InvoiceType = "A" | "B" | "C" | "TK";
export type CreateOrderItem = { product_id: string; quantity: number };
export type NewClientForm = {
    name: string;
    tax_id: string;
    email: string;
    phone: string;
    address: string;
    credit_limit: number;
};
