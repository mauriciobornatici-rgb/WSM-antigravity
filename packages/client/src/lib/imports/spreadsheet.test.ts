import { describe, expect, it } from "vitest"
import { chunk, mapSheet, parseCsv, plainHeader, readSpreadsheet } from "./spreadsheet"

describe("lectura de planillas para importar", () => {
    it("lee un CSV de Excel en castellano (con ; y BOM) y uno con comas y comillas", () => {
        const bom = String.fromCharCode(0xfeff)
        expect(parseCsv(`${bom}SKU;Nombre;Precio\r\nA-1;Remera;12.100,50\r\n`)).toEqual([
            ["SKU", "Nombre", "Precio"],
            ["A-1", "Remera", "12.100,50"],
        ])
        expect(parseCsv('sku,nombre\n"B-2","Botín ""Pro"", talle 40"\nC-3,Medias')).toEqual([
            ["sku", "nombre"],
            ["B-2", 'Botín "Pro", talle 40'],
            ["C-3", "Medias"],
        ])
        expect(parseCsv("SKU\tNombre\nD-4\tShort")).toEqual([["SKU", "Nombre"], ["D-4", "Short"]])
    })

    it("reconoce los encabezados con o sin acentos y sus sinónimos, y numera las filas como en el archivo", () => {
        const sheet = [
            [],
            ["sku", "NOMBRE", "Precio de venta", "Categoria", "Columna rara", "Stock"],
            ["A-1", "Remera", 12100, "Indumentaria", "x", 3],
            [null, "", undefined, null, null, null],
            ["A-2", "Short", "9.000", null, null, null],
        ]
        const mapped = mapSheet("products", sheet)
        expect(mapped.missingHeaders).toEqual([])
        expect(mapped.ignoredHeaders).toEqual(["Columna rara"])
        expect(mapped.rows).toEqual([
            { row: 3, sku: "A-1", name: "Remera", sale_price: 12100, category: "Indumentaria", stock: 3 },
            { row: 5, sku: "A-2", name: "Short", sale_price: "9.000", category: null, stock: null },
        ])
    })

    it("avisa las columnas obligatorias que faltan", () => {
        expect(mapSheet("products", [["Nombre"], ["Remera"]]).missingHeaders).toEqual(["SKU", "Precio de venta final (con IVA)"])
        expect(mapSheet("clients", []).missingHeaders).toEqual(["Nombre o razón social"])
        expect(mapSheet("suppliers", [["Razón social", "CUIT"], ["Textil", "30-1"]]).rows).toEqual([
            { row: 2, name: "Textil", tax_id: "30-1" },
        ])
    })

    it("la fila de ejemplo de la plantilla, sin tocar, no se importa", () => {
        const mapped = mapSheet("suppliers", [
            ["Razón social *", "CUIT", "Categoría"],
            ["Distribuidora Ejemplo SA", "30-71234567-4", "Indumentaria"],
            ["Textil Real SRL", "30-1", "Indumentaria"],
        ])
        expect(mapped.exampleRows).toEqual([2])
        expect(mapped.rows.map((row) => row.row)).toEqual([3])
    })

    it("explica en castellano un Excel viejo o un archivo que no es planilla", async () => {
        await expect(readSpreadsheet(new File(["x"], "lista.xls"))).rejects.toThrow(/formato viejo \(\.xls\)/)
        await expect(readSpreadsheet(new File(["x"], "foto.png"))).rejects.toThrow(/planilla de Excel \(\.xlsx\) o un CSV/)
        await expect(readSpreadsheet(new File(["x"], "roto.xlsx"))).rejects.toThrow(/No se pudo abrir el archivo/)
    })

    it("compara textos sin acentos ni mayúsculas, y parte en tandas", () => {
        expect(plainHeader("  Condición IVA ")).toBe("condicion iva")
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    })
})
