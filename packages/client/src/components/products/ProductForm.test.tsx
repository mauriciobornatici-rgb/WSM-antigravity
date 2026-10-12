import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/types";
import { ProductForm } from "@/components/products/ProductForm";

vi.mock("@/services/api", () => ({
    api: {
        getProductCatalogOptions: vi.fn().mockResolvedValue([]),
        uploadProductImage: vi.fn(),
    },
}));

const storedProduct: Product = {
    id: "p-1",
    sku: "SKU-1",
    name: "Zapatilla",
    description: "",
    category: "Calzado",
    purchase_price: 500,
    sale_price: 1000,
    vat_rate: 21,
    created_at: "2026-01-01",
};

describe("ProductForm prices (ADR-015)", () => {
    it("shows the sale price as final and the purchase price as net with its final value beside it", async () => {
        render(<ProductForm initialData={storedProduct} onSubmit={vi.fn()} onCancel={vi.fn()} />);

        expect((screen.getByLabelText(/Precio de venta final/) as HTMLInputElement).value).toBe("1210");
        expect((screen.getByLabelText(/Precio compra neto/) as HTMLInputElement).value).toBe("500");
        expect(screen.getByText(/Final c\/IVA: \$ 605,00/)).toBeTruthy();
        expect(screen.getByText(/Neto: \$ 1\.000,00/)).toBeTruthy();
    });

    it("sends the NET sale price when the final price is edited", async () => {
        const onSubmit = vi.fn();
        render(<ProductForm initialData={storedProduct} onSubmit={onSubmit} onCancel={vi.fn()} />);

        fireEvent.change(screen.getByLabelText(/Precio de venta final/), { target: { value: "2420" } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ sale_price: 2000, purchase_price: 500 });
    });

    it("keeps the stored net price when the final price is left untouched", async () => {
        const onSubmit = vi.fn();
        render(
            <ProductForm
                initialData={{ ...storedProduct, sale_price: 826.4463 }}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ sale_price: 826.4463 });
    });
});
