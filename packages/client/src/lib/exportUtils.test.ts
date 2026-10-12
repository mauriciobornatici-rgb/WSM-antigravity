import { describe, it, expect } from "vitest";
import { convertToCSV } from "./exportUtils";

describe("exportUtils", () => {
    it("should convert simple object array to CSV format with headers", () => {
        const data = [
            { id: 1, name: "Zapatillas Running", price: 15000, category: "Calzado" },
            { id: 2, name: 'Remera "Pro" Ultra', price: 8500, category: "Indumentaria" },
        ];

        const headers = [
            { key: "id" as const, label: "ID" },
            { key: "name" as const, label: "Producto" },
            { key: "price" as const, label: "Precio ($)" },
            { key: "category" as const, label: "Categoría" },
        ];

        const csv = convertToCSV(data, headers);
        const lines = csv.split("\r\n");

        expect(lines[0]).toBe('"ID","Producto","Precio ($)","Categoría"');
        expect(lines[1]).toBe('"1","Zapatillas Running","15000","Calzado"');
        expect(lines[2]).toBe('"2","Remera ""Pro"" Ultra","8500","Indumentaria"');
    });

    it("should handle empty data gracefully", () => {
        const csv = convertToCSV([], [{ key: "name", label: "Nombre" }]);
        expect(csv).toBe("");
    });
});
