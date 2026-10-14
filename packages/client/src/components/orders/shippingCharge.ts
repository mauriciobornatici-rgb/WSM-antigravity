export interface ShippingChargeValue {
    amount: string
    chargeCustomer: boolean
    vatRate: string
}

/** Envío vacío: se cobra al cliente y con IVA 21 % (otras alícuotas, solo por excepción). */
export const EMPTY_SHIPPING_CHARGE: ShippingChargeValue = { amount: "", chargeCustomer: true, vatRate: "21" }
