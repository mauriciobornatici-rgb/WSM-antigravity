import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CartItem, POSProduct } from "@/components/pos/types";
import { playScanErrorBeep, playScanSuccessBeep } from "@/lib/scanAudio";
import { createClientUuid } from "@/lib/clientUuid";

function roundMoney(value: number): number {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export interface ParkedCart {
    id: string;
    label: string;
    timestamp: number;
    items: CartItem[];
    subtotal: number;
    grandTotal: number;
    clientId?: string | undefined;
}

const PARKED_CARTS_STORAGE_KEY = "wsm_pos_parked_carts";
const PARKED_CARTS_STORAGE_VERSION = 1;

function normalizeParkedCart(value: unknown): ParkedCart | null {
    if (!value || typeof value !== "object") return null;
    const cart = value as Partial<ParkedCart>;
    if (!cart.id || !cart.label || !Array.isArray(cart.items)) return null;
    const validItems = cart.items.filter((item) => (
        item && typeof item.id === "string" && Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0
    ));
    if (validItems.length === 0) return null;
    return {
        id: cart.id,
        label: cart.label,
        timestamp: Number(cart.timestamp || Date.now()),
        items: validItems,
        subtotal: Number(cart.subtotal || 0),
        grandTotal: Number(cart.grandTotal || 0),
        ...(cart.clientId ? { clientId: cart.clientId } : {}),
    };
}

function getStoredParkedCarts(): ParkedCart[] {
    try {
        const raw = localStorage.getItem(PARKED_CARTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        const values = Array.isArray(parsed)
            ? parsed
            : (parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
                ? (parsed as { items: unknown[] }).items
                : []);
        return values.map(normalizeParkedCart).filter((cart): cart is ParkedCart => cart !== null);
    } catch {
        return [];
    }
}

function saveStoredParkedCarts(carts: ParkedCart[]) {
    try {
        localStorage.setItem(PARKED_CARTS_STORAGE_KEY, JSON.stringify({
            version: PARKED_CARTS_STORAGE_VERSION,
            items: carts,
        }));
    } catch (e) {
        console.error("Error saving parked carts", e);
    }
}

export function usePOSCart() {
    const [cart, setCart] = useState<CartItem[]>([]);
    const [parkedCarts, setParkedCarts] = useState<ParkedCart[]>(() => getStoredParkedCarts());

    useEffect(() => {
        saveStoredParkedCarts(parkedCarts);
    }, [parkedCarts]);

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

    function parkCurrentCart(label?: string, clientId?: string): boolean {
        if (cart.length === 0) {
            toast.warning("No hay productos en el carrito para poner en espera.");
            return false;
        }

        const newParked: ParkedCart = {
            id: createClientUuid(),
            label: label?.trim() || `Venta en espera #${parkedCarts.length + 1}`,
            timestamp: Date.now(),
            items: [...cart],
            subtotal,
            grandTotal,
            clientId,
        };

        setParkedCarts((prev) => [newParked, ...prev]);
        setCart([]);
        toast.success(`Carrito "${newParked.label}" guardado en espera.`);
        return true;
    }

    function restoreParkedCart(id: string): { items: CartItem[]; clientId?: string | undefined } | null {
        if (cart.length > 0) {
            toast.warning("Guarda o vacía el carrito activo antes de recuperar otro.");
            return null;
        }
        const found = parkedCarts.find((c) => c.id === id);
        if (!found) return null;

        setCart(found.items);
        setParkedCarts((prev) => prev.filter((c) => c.id !== id));
        toast.success(`Carrito "${found.label}" recuperado.`);
        return { items: found.items, clientId: found.clientId };
    }

    function deleteParkedCart(id: string) {
        setParkedCarts((prev) => prev.filter((c) => c.id !== id));
        toast.info("Venta en espera eliminada.");
    }

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
        parkedCarts,
        parkCurrentCart,
        restoreParkedCart,
        deleteParkedCart,
    };
}
