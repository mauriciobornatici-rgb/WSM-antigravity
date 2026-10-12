import { useEffect } from "react";

interface POSHotkeysOptions {
    onSearchFocus: () => void;
    onPaymentOpen: () => void;
    onEscape: () => void;
    onToggleInvoice: () => void;
    onClearCart?: () => void;
    onOpenHistory?: () => void;
}

export function usePOSHotkeys({
    onSearchFocus,
    onPaymentOpen,
    onEscape,
    onToggleInvoice,
    onClearCart,
    onOpenHistory,
}: POSHotkeysOptions) {
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "F2") {
                event.preventDefault();
                onSearchFocus();
            } else if (event.key === "F3") {
                if (onOpenHistory) {
                    event.preventDefault();
                    onOpenHistory();
                }
            } else if (event.key === "F4") {
                event.preventDefault();
                onPaymentOpen();
            } else if (event.key === "F8") {
                event.preventDefault();
                onToggleInvoice();
            } else if (event.key === "F9") {
                if (onClearCart) {
                    event.preventDefault();
                    onClearCart();
                }
            } else if (event.key === "Escape") {
                onEscape();
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [onSearchFocus, onPaymentOpen, onEscape, onToggleInvoice, onClearCart, onOpenHistory]);
}
