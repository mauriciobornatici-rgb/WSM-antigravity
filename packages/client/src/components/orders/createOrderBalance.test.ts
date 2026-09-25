import { describe, expect, it } from "vitest";

describe("CreateOrder balance and payment allocation logic", () => {
    function computeOrderTotal(items: Array<{ quantity: number; sale_price: number }>) {
        return items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.sale_price || 0), 0);
    }

    function computePaymentsTotal(lines: Array<{ amount: string | number }>) {
        return Math.round(lines.reduce((sum, line) => sum + Number(line.amount || 0), 0) * 100) / 100;
    }

    function computeRemainingToAssign(orderTotal: number, paymentsTotal: number) {
        return Math.round((orderTotal - paymentsTotal) * 100) / 100;
    }

    function isPaymentBalanced(
        itemsCount: number,
        remainingToAssign: number,
        lines: Array<{ amount: string | number }>
    ) {
        return (
            itemsCount > 0 &&
            Math.abs(remainingToAssign) <= 0.01 &&
            lines.length > 0 &&
            lines.every((l) => Number(l.amount || 0) > 0)
        );
    }

    it("calculates total amount correctly across multiple products and quantities", () => {
        const items = [
            { quantity: 1, sale_price: 1800 },
            { quantity: 1, sale_price: 250000 },
            { quantity: 1, sale_price: 1 },
            { quantity: 1, sale_price: 47000 },
            { quantity: 1, sale_price: 45000 },
        ];
        const total = computeOrderTotal(items);
        expect(total).toBe(343801);
    });

    it("detects when payment is missing and calculates exact pending difference ('Falta asignar')", () => {
        const orderTotal = 343801;
        const payments = [{ amount: "100000" }];
        const paymentsTotal = computePaymentsTotal(payments);
        const remaining = computeRemainingToAssign(orderTotal, paymentsTotal);

        expect(remaining).toBe(243801);
        expect(remaining > 0).toBe(true);
        expect(isPaymentBalanced(5, remaining, payments)).toBe(false);
    });

    it("detects when payment exceeds the order total ('Excedente')", () => {
        const orderTotal = 343801;
        const payments = [{ amount: "350000" }];
        const paymentsTotal = computePaymentsTotal(payments);
        const remaining = computeRemainingToAssign(orderTotal, paymentsTotal);

        expect(remaining).toBe(-6199);
        expect(remaining < 0).toBe(true);
        expect(isPaymentBalanced(5, remaining, payments)).toBe(false);
    });

    it("enables creation only when remaining amount reaches exactly zero with valid lines", () => {
        const orderTotal = 343801;
        const payments = [
            { amount: "100000" },
            { amount: "243801" },
        ];
        const paymentsTotal = computePaymentsTotal(payments);
        const remaining = computeRemainingToAssign(orderTotal, paymentsTotal);

        expect(remaining).toBe(0);
        expect(isPaymentBalanced(5, remaining, payments)).toBe(true);
    });

    it("blocks creation if items list is empty even if payment is 0", () => {
        const orderTotal = 0;
        const payments = [{ amount: "0" }];
        const remaining = computeRemainingToAssign(orderTotal, 0);

        expect(isPaymentBalanced(0, remaining, payments)).toBe(false);
    });
});
