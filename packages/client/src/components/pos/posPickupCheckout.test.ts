import { describe, expect, it } from "vitest";
import type { CartItem } from "./types";

describe("POS Pickup Checkout & Cross-selling Logic", () => {
    function separatePreparedAndExtraItems(cart: CartItem[]) {
        const preparedItems = cart.filter((item) => item.isPrepared);
        const extraItems = cart
            .filter((item) => !item.isPrepared)
            .map((item) => ({
                product_id: item.id,
                quantity: item.quantity,
                unit_price: Number(item.sale_price),
            }));

        return { preparedItems, extraItems };
    }

    function calculateTotalWithExtras(cart: CartItem[]) {
        return cart.reduce(
            (sum, item) => sum + Number(item.quantity || 0) * Number(item.sale_price || 0),
            0
        );
    }

    it("correctly identifies prepared items vs newly added counter extra items", () => {
        const cart: CartItem[] = [
            {
                id: "prod-1",
                name: "Camiseta Titular",
                sku: "CAM-01",
                sale_price: 35000,
                purchase_price: 20000,
                description: "",
                category: "Indumentaria",
                created_at: new Date().toISOString(),
                stock: 5,
                quantity: 1,
                isPrepared: true,
            },
            {
                id: "prod-2",
                name: "Medias Deportivas",
                sku: "MED-02",
                sale_price: 5000,
                purchase_price: 2500,
                description: "",
                category: "Accesorios",
                created_at: new Date().toISOString(),
                stock: 20,
                quantity: 2,
                isPrepared: false, // Added at counter
            },
        ];

        const { preparedItems, extraItems } = separatePreparedAndExtraItems(cart);

        expect(preparedItems.length).toBe(1);
        expect(preparedItems[0]?.id).toBe("prod-1");
        expect(extraItems.length).toBe(1);
        expect(extraItems[0]).toEqual({
            product_id: "prod-2",
            quantity: 2,
            unit_price: 5000,
        });

        const total = calculateTotalWithExtras(cart);
        expect(total).toBe(45000); // 35000 + (5000 * 2)
    });

    it("handles pickup with zero extra items (pure fulfillment)", () => {
        const cart: CartItem[] = [
            {
                id: "prod-1",
                name: "Pelota Fútbol",
                sku: "PEL-01",
                sale_price: 20000,
                purchase_price: 12000,
                description: "",
                category: "Equipamiento",
                created_at: new Date().toISOString(),
                stock: 3,
                quantity: 1,
                isPrepared: true,
            },
        ];

        const { preparedItems, extraItems } = separatePreparedAndExtraItems(cart);

        expect(preparedItems.length).toBe(1);
        expect(extraItems.length).toBe(0);
        expect(calculateTotalWithExtras(cart)).toBe(20000);
    });

    it("prepares complete atomic pickup checkout payload", () => {
        const cart: CartItem[] = [
            {
                id: "prod-1",
                name: "Botines Papi",
                sku: "BOT-01",
                sale_price: 60000,
                purchase_price: 35000,
                description: "",
                category: "Calzado",
                created_at: new Date().toISOString(),
                stock: 2,
                quantity: 1,
                isPrepared: true,
            },
            {
                id: "prod-3",
                name: "Cinta Tape",
                sku: "CIN-01",
                sale_price: 3000,
                purchase_price: 1500,
                description: "",
                category: "Accesorios",
                created_at: new Date().toISOString(),
                stock: 50,
                quantity: 1,
            },
        ];

        const { extraItems } = separatePreparedAndExtraItems(cart);
        const total = calculateTotalWithExtras(cart);

        const payload = {
            recipient_name: "Esteban Quito",
            recipient_dni: "28999111",
            delivery_notes: "Retiro en mostrador POS",
            shift_id: "shift-uuid-1",
            invoice_type: "B" as const,
            point_of_sale: 1,
            payments: [{ method: "cash", amount: total }],
            extra_items: extraItems.length > 0 ? extraItems : undefined,
        };

        expect(payload.recipient_name).toBe("Esteban Quito");
        expect(payload.payments[0]?.amount).toBe(63000);
        expect(payload.extra_items).toEqual([{ product_id: "prod-3", quantity: 1, unit_price: 3000 }]);
    });
});
