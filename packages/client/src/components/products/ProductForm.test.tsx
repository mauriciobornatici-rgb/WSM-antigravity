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

const auth = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/context/AuthContext", () => ({
    useAuth: () => ({ user: { id: "u-1", role: auth.role } }),
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
        expect((screen.getByLabelText(/Costo de compra neto/) as HTMLInputElement).value).toBe("500");
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

    it("uses the product's VAT rate: with 10,5 % a final price of 110,50 saves net 100 and sends the rate", async () => {
        const onSubmit = vi.fn();
        render(
            <ProductForm
                initialData={{ ...storedProduct, vat_rate: 10.5, sale_price: 50 }}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );

        expect(screen.getByLabelText("Alícuota de IVA")).toBeTruthy();
        fireEvent.change(screen.getByLabelText(/Precio de venta final/), { target: { value: "110.5" } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ sale_price: 100, vat_rate: 10.5 });
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

describe("ProductForm cost policy (ADR-027)", () => {
    it("shows the price that follows a new cost and sends both options, checked by default", async () => {
        auth.role = "manager";
        const onSubmit = vi.fn();
        render(<ProductForm initialData={storedProduct} onSubmit={onSubmit} onCancel={vi.fn()} />);

        expect((screen.getByLabelText("Actualizar el costo con cada compra") as HTMLInputElement).checked).toBe(true);
        expect((screen.getByLabelText("Ajustar el precio de venta al costo") as HTMLInputElement).checked).toBe(true);
        // Cost 500 → 600: the final price 1210 keeps the markup and becomes 1452.
        fireEvent.change(screen.getByLabelText(/Costo de compra neto/), { target: { value: "600" } });
        expect(screen.getByText(/el precio final pasa a \$ 1\.452,00/)).toBeTruthy();

        fireEvent.click(screen.getByLabelText("Ajustar el precio de venta al costo"));
        expect(screen.queryByText(/el precio final pasa a/)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ purchase_price: 600, auto_update_cost: true, auto_update_price: false });
    });

    it("starts from the legacy cost when purchase_price is empty, so saving does not zero it", async () => {
        auth.role = "admin";
        const onSubmit = vi.fn();
        render(<ProductForm initialData={{ ...storedProduct, purchase_price: 0, cost_price: 450 }} onSubmit={onSubmit} onCancel={vi.fn()} />);

        expect((screen.getByLabelText(/Costo de compra neto/) as HTMLInputElement).value).toBe("450");
        fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ purchase_price: 450 });
    });

    it("does not let a warehouse user change the cost of an existing product (D5)", () => {
        auth.role = "warehouse";
        render(<ProductForm initialData={{ ...storedProduct, auto_update_cost: 0 }} onSubmit={vi.fn()} onCancel={vi.fn()} />);

        expect((screen.getByLabelText(/Costo de compra neto/) as HTMLInputElement).disabled).toBe(true);
        expect(screen.getByText(/Solo un gerente o un administrador puede cambiar el costo/)).toBeTruthy();
        const costOption = screen.getByLabelText("Actualizar el costo con cada compra") as HTMLInputElement;
        expect(costOption.disabled).toBe(true);
        expect(costOption.checked).toBe(false);
        expect((screen.getByLabelText("Ajustar el precio de venta al costo") as HTMLInputElement).disabled).toBe(false);
    });

    it("lets a warehouse user load the first cost of a new product, but not fix it (D5, AUD-016)", () => {
        auth.role = "warehouse";
        render(<ProductForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

        expect((screen.getByLabelText(/Costo de compra neto/) as HTMLInputElement).disabled).toBe(false);
        const costOption = screen.getByLabelText("Actualizar el costo con cada compra") as HTMLInputElement;
        expect(costOption.disabled).toBe(true);
        expect(costOption.checked).toBe(true);
        // The hint is a description, not part of the name, and says who can change it.
        expect(costOption.getAttribute("aria-describedby")).toBe("product-auto-update-cost-hint");
        expect(screen.getByText("Solo un gerente o un administrador puede cambiarlo.")).toBeTruthy();
    });
});
