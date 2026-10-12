import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePOSCart } from "./usePOSCart";
import type { POSProduct } from "@/components/pos/types";

const mockProduct: POSProduct = {
    id: "prod-1",
    name: "Pelota de Futbol",
    sku: "PEL-01",
    description: "Pelota profesional",
    category: "Futbol",
    sale_price: 1000,
    purchase_price: 600,
    stock: 5,
    created_at: new Date().toISOString(),
};

describe("usePOSCart", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("should initialize with empty cart and calculate zero totals", () => {
        const { result } = renderHook(() => usePOSCart());
        expect(result.current.cart).toHaveLength(0);
        expect(result.current.subtotal).toBe(0);
        expect(result.current.grandTotal).toBe(0);
    });

    it("should add products to cart and update totals", () => {
        const { result } = renderHook(() => usePOSCart());

        act(() => {
            result.current.addToCart(mockProduct);
        });

        expect(result.current.cart).toHaveLength(1);
        expect(result.current.cart[0]?.quantity).toBe(1);
        expect(result.current.subtotal).toBe(1000);
        // 21% default VAT
        expect(result.current.taxAmount).toBe(210);
        expect(result.current.grandTotal).toBe(1210);
    });

    it("should update product quantities and respect stock limits", () => {
        const { result } = renderHook(() => usePOSCart());

        act(() => {
            result.current.addToCart(mockProduct);
            result.current.updateQuantity(mockProduct.id, 2);
        });

        expect(result.current.cart[0]?.quantity).toBe(3);

        // Attempting to exceed stock (5)
        act(() => {
            result.current.updateQuantity(mockProduct.id, 10);
        });
        expect(result.current.cart[0]?.quantity).toBe(3);
    });

    it("should support parking and restoring carts", () => {
        const { result } = renderHook(() => usePOSCart());

        act(() => {
            result.current.addToCart(mockProduct);
        });
        expect(result.current.cart).toHaveLength(1);

        let parkedSuccess = false;
        act(() => {
            parkedSuccess = result.current.parkCurrentCart("Cliente Carlos");
        });

        expect(parkedSuccess).toBe(true);
        expect(result.current.cart).toHaveLength(0);
        expect(result.current.parkedCarts).toHaveLength(1);
        expect(result.current.parkedCarts[0]?.label).toBe("Cliente Carlos");

        const parkedId = result.current.parkedCarts[0]?.id;
        expect(parkedId).toBeDefined();

        if (parkedId) {
            act(() => {
                result.current.restoreParkedCart(parkedId);
            });
        }

        expect(result.current.cart).toHaveLength(1);
        expect(result.current.parkedCarts).toHaveLength(0);
    });

    it("does not overwrite an active cart when restoring a parked cart", () => {
        const { result } = renderHook(() => usePOSCart());

        act(() => {
            result.current.addToCart(mockProduct);
        });
        act(() => {
            result.current.parkCurrentCart("En espera");
        });
        act(() => {
            result.current.addToCart({ ...mockProduct, id: "prod-2", name: "Producto activo" });
        });

        const parkedId = result.current.parkedCarts[0]!.id;
        act(() => {
            expect(result.current.restoreParkedCart(parkedId)).toBeNull();
        });

        expect(result.current.cart[0]!.id).toBe("prod-2");
        expect(result.current.parkedCarts).toHaveLength(1);
    });
});
