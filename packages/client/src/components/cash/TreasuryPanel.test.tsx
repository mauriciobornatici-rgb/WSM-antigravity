import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TreasuryPanel } from "@/components/cash/TreasuryPanel";

const authState = vi.hoisted(() => ({ role: "manager" }));

vi.mock("@/context/AuthContext", () => ({
    useAuth: () => ({ user: { id: "u-1", role: authState.role } }),
}));

vi.mock("@/services/api", () => ({
    api: {
        getTreasury: vi.fn().mockResolvedValue({ balance: 1500, movements: [] }),
        getCashRegisters: vi.fn().mockResolvedValue([]),
        getBank: vi.fn().mockResolvedValue({ balance: 0, movements: [] }),
        getVatRates: vi.fn().mockResolvedValue([]),
        createTreasuryTransfer: vi.fn(),
    },
}));

function renderPanel(props: { readOnly?: boolean } = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <TreasuryPanel {...props} />
        </QueryClientProvider>,
    );
}

async function openOriginOptions() {
    const trigger = await screen.findByLabelText("Sale de");
    fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("TreasuryPanel", () => {
    beforeEach(() => {
        // jsdom has no layout: Radix Select scrolls the highlighted option into view.
        Element.prototype.scrollIntoView = vi.fn();
        authState.role = "manager";
    });

    it("hides the opening balance origin for a non-admin", async () => {
        renderPanel();
        await openOriginOptions();

        expect(await screen.findByRole("option", { name: "Banco" })).toBeTruthy();
        expect(screen.queryByRole("option", { name: "Saldo inicial" })).toBeNull();
    });

    it("offers the opening balance origin to an admin", async () => {
        authState.role = "admin";
        renderPanel();
        await openOriginOptions();

        expect(await screen.findByRole("option", { name: "Saldo inicial" })).toBeTruthy();
    });

    it("renders only the balance and movements when read-only", async () => {
        renderPanel({ readOnly: true });

        expect(await screen.findByText(/\$\s?1\.500,00/)).toBeTruthy();
        expect(screen.queryByLabelText("Sale de")).toBeNull();
        expect(screen.queryByRole("button", { name: "Registrar movimiento" })).toBeNull();
    });
});
