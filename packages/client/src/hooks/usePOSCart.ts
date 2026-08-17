import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { CartItem, POSProduct } from "@/components/pos/types";
import { playScanErrorBeep, playScanSuccessBeep } from "@/lib/scanAudio";

function roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export function usePOSCart() {
    const [cart, setCart] = useState<CartItem[]>([]);

    function addToCart(product: POSProduct) {
        if (product.stock <= 0) {
            toast.warning("Producto sin stock");
            playScanErrorBeep();
            return;
        }

        let addedSuccessfully = true;

        setCart((current) => {
            const found = current.find((item) => item.id === product.id);
            if (!found) return [...current, { ...product, quantity: 1 }];

            if (found.quantity >= product.stock) {
                toast.warning("No hay más stock disponible");
                addedSuccessfully = false;
                return current;
            }
            return current.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
        });

        if (addedSuccessfully) {
            playScanSuccessBeep();
        } else {
            playScanErrorBeep();
        }
    }

    function updateQuantity(productId: string, delta: number) {
        setCart((current) =>
            current
                .map((item) => {
                    if (item.id !== productId) return item;
                    const nextQuantity = Math.max(0, item.quantity + delta);
                    if (nextQuantity > item.stock) {
                        toast.warning("No hay más stock disponible");
                        playScanErrorBeep();
                        return item;
                    }
                    return { ...item, quantity: nextQuantity };
                })
                .filter((item) => item.quantity > 0),
        );
    }

    function removeFromCart(productId: string) {
        setCart((current) => current.filter((item) => item.id !== productId));
    }

    function clearCart() {
        setCart([]);
    }

    const subtotal = useMemo(
        () => roundMoney(cart.reduce((sum, item) => sum + Number(item.sale_price || 0) * item.quantity, 0)),
        [cart]
    );

    const taxAmount = useMemo(
        () => roundMoney(
            cart.reduce((sum, item) => {
                const itemVatRate = item.vat_rate != null ? Number(item.vat_rate) : 21.00;
                const lineNet = roundMoney(item.quantity * Number(item.sale_price || 0));
                const lineVat = roundMoney(lineNet * (itemVatRate / 100));
                return sum + lineVat;
            }, 0)
        ),
        [cart]
    );

    const grandTotal = useMemo(
        () => roundMoney(subtotal + taxAmount),
        [subtotal, taxAmount]
    );

    return {
        cart,
        setCart,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        subtotal,
        taxAmount,
        grandTotal,
    };
}
