import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CartPanelCard } from "@/components/pos/CartPanelCard";
import type { CartItem } from "@/components/pos/types";

const item: CartItem = {
    id: "p-1",
    sku: "SKU-1",
    name: "Zapatilla",
    description: "",
    category: "Calzado",
    purchase_price: 500,
    sale_price: 1000, // stored net
    vat_rate: 21,
    created_at: "2026-01-01",
    stock: 10,
    quantity: 2,
};

describe("CartPanelCard prices (ADR-015)", () => {
    it("shows the final unit price and line total, keeping the fiscal summary as net", () => {
        render(
            <MemoryRouter>
                <CartPanelCard
                    clients={[]}
                    selectedClientId=""
                    onClientChange={vi.fn()}
                    onOpenClientDialog={vi.fn()}
                    selectedClient={null}
                    cart={[item]}
                    onRemoveFromCart={vi.fn()}
                    onUpdateQuantity={vi.fn()}
                    subtotal={2000}
                    taxLabel="IVA (21%)"
                    taxAmount={420}
                    grandTotal={2420}
                    onOpenPaymentDialog={vi.fn()}
                    currentShift={null}
                    currentRegister={null}
                />
            </MemoryRouter>,
        );

        expect(screen.getByText("Precios con IVA")).toBeTruthy();
        expect(screen.getByText("$ 1.210,00")).toBeTruthy();
        expect(screen.getAllByText("$ 2.420,00").length).toBeGreaterThan(0);
        expect(screen.getByText("Incluye neto $ 2.000,00 + IVA $ 420,00")).toBeTruthy();
        expect(screen.queryByText("Subtotal neto")).toBeNull();
        expect(screen.getByRole("button", { name: "Restar una unidad de Zapatilla" })).toBeTruthy();
    });
});
