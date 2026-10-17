import { IMPORT_COLUMNS, type ImportColumn, type ImportEntity } from "@wsm/common"
import type { ImportRow } from "@/services/api"

/** A cell as read from the file. */
export type SheetCell = string | number | boolean | Date | null | undefined

export const IMPORT_FILE_ACCEPT = ".xlsx,.csv"

const ENTITY_FILE_NAMES: Record<ImportEntity, string> = {
    products: "productos",
    clients: "clientes",
    suppliers: "proveedores",
}

const ENTITY_SHEET_NAMES: Record<ImportEntity, string> = {
    products: "Productos",
    clients: "Clientes",
    suppliers: "Proveedores",
}

/** Text without accents, case, punctuation or extra spaces: how headers are compared. */
export function plainHeader(value: unknown): string {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9%/ ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

/**
 * A CSV as rows of cells. The separator is the one the first line uses most (";" when Excel in
 * Spanish saves it, "," otherwise, or a tab). Quotes follow the usual rules ("" inside quotes).
 */
export function parseCsv(text: string): string[][] {
    const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
    const firstLine = content.split(/\r?\n/, 1)[0] ?? ""
    const best = [";", ",", "\t"]
        .map((candidate) => ({ candidate, count: firstLine.split(candidate).length - 1 }))
        .sort((a, b) => b.count - a.count)[0]
    const separator = best && best.count > 0 ? best.candidate : ","

    const rows: string[][] = []
    let row: string[] = []
    let cell = ""
    let quoted = false
    for (let index = 0; index < content.length; index++) {
        const char = content[index]
        if (quoted) {
            if (char === '"') {
                if (content[index + 1] === '"') {
                    cell += '"'
                    index++
                } else {
                    quoted = false
                }
            } else {
                cell += char
            }
        } else if (char === '"' && cell === "") {
            quoted = true
        } else if (char === separator) {
            row.push(cell)
            cell = ""
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && content[index + 1] === "\n") index++
            row.push(cell)
            rows.push(row)
            row = []
            cell = ""
        } else {
            cell += char
        }
    }
    if (cell !== "" || row.length > 0) {
        row.push(cell)
        rows.push(row)
    }
    return rows
}

// A CSV saved by Excel in Spanish is usually Windows-1252, not UTF-8: if UTF-8 decoding finds
// invalid bytes, it is read again as Windows-1252 so "Categoría" does not turn into symbols.
function decodeText(buffer: ArrayBuffer): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
    } catch {
        return new TextDecoder("windows-1252").decode(buffer)
    }
}

/** The first sheet of an .xlsx or the rows of a .csv, with errors a person can act on. */
export async function readSpreadsheet(file: File): Promise<SheetCell[][]> {
    const name = file.name.toLowerCase()
    if (name.endsWith(".xlsx")) {
        // The entry that reads in this same thread: the "browser" one starts Web Workers from blob:
        // URLs, which the Content-Security-Policy of the production server does not allow.
        const { readSheet } = await import("read-excel-file/web-worker")
        try {
            return (await readSheet(file)) as SheetCell[][]
        } catch {
            // The library's own message is technical and in English.
            throw new Error("No se pudo abrir el archivo. Revisá que sea un .xlsx válido y sin contraseña, o guardalo como CSV.")
        }
    }
    if (name.endsWith(".csv")) {
        return parseCsv(decodeText(await file.arrayBuffer()))
    }
    if (name.endsWith(".xls")) {
        throw new Error("Es un Excel de formato viejo (.xls). Abrilo en Excel y guardalo como .xlsx, o como CSV.")
    }
    throw new Error("El archivo tiene que ser una planilla de Excel (.xlsx) o un CSV.")
}

function cellValue(value: SheetCell): string | number | boolean | null {
    if (value === undefined || value === null) return null
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (typeof value === "string") {
        const text = value.trim()
        return text === "" ? null : text
    }
    return value
}

export interface MappedSheet {
    rows: ImportRow[]
    /** Headers of the file that match no column: they are left out. */
    ignoredHeaders: string[]
    /** Required columns the file does not have. */
    missingHeaders: string[]
    /** Rows that are still the template's example (left out, so it is never imported by accident). */
    exampleRows: number[]
}

// The row is the template's example untouched: every cell it has equals the example.
function isTemplateExample(columns: readonly ImportColumn[], row: ImportRow): boolean {
    const filled = columns.filter((column) => row[column.key] !== null && row[column.key] !== undefined)
    if (filled.length === 0 || columns.some((column) => column.required && !filled.includes(column))) return false
    return filled.every((column) => String(row[column.key]) === String(column.example))
}

function columnFor(columns: readonly ImportColumn[], header: string): ImportColumn | undefined {
    const plain = plainHeader(header)
    if (!plain) return undefined
    return columns.find((column) => plainHeader(column.header) === plain)
        ?? columns.find((column) => (column.aliases ?? []).some((alias) => plainHeader(alias) === plain))
}

/**
 * The rows of a sheet as the server expects them: the first non-empty row is the header, its
 * names are matched to the template columns (with or without accents, and common synonyms),
 * empty rows are skipped and every row keeps its number in the file, to point at it.
 */
export function mapSheet(entity: ImportEntity, sheet: SheetCell[][]): MappedSheet {
    const columns = IMPORT_COLUMNS[entity]
    const isEmpty = (row: SheetCell[] | undefined) => !row || row.every((cell) => cellValue(cell) === null)
    const headerIndex = sheet.findIndex((row) => !isEmpty(row))
    if (headerIndex < 0) return { rows: [], ignoredHeaders: [], missingHeaders: columns.filter((column) => column.required).map((column) => column.header), exampleRows: [] }

    const headerRow = sheet[headerIndex] ?? []
    const keyByIndex = new Map<number, string>()
    const ignoredHeaders: string[] = []
    headerRow.forEach((cell, index) => {
        const header = String(cellValue(cell) ?? "")
        if (!header) return
        const column = columnFor(columns, header)
        if (column && ![...keyByIndex.values()].includes(column.key)) keyByIndex.set(index, column.key)
        else ignoredHeaders.push(header)
    })
    const mappedKeys = new Set(keyByIndex.values())
    const missingHeaders = columns.filter((column) => column.required && !mappedKeys.has(column.key)).map((column) => column.header)

    const rows: ImportRow[] = []
    const exampleRows: number[] = []
    for (let index = headerIndex + 1; index < sheet.length; index++) {
        const source = sheet[index]
        if (isEmpty(source)) continue
        const row: ImportRow = { row: index + 1 }
        for (const [cellIndex, key] of keyByIndex) {
            row[key] = cellValue(source?.[cellIndex])
        }
        if (isTemplateExample(columns, row)) exampleRows.push(row.row)
        else rows.push(row)
    }
    return { rows, ignoredHeaders, missingHeaders, exampleRows }
}

/** The template file name for a kind of data ("plantilla-productos.xlsx"). */
export function importTemplateName(entity: ImportEntity): string {
    return `plantilla-${ENTITY_FILE_NAMES[entity]}.xlsx`
}

/** Builds the template and offers it to save. */
export async function downloadImportTemplate(entity: ImportEntity): Promise<void> {
    const blob = await buildImportTemplate(entity)
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = importTemplateName(entity)
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Freed a moment later: some browsers start the download after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The template to fill: the columns with an example row (codes and CUITs as text, so Excel keeps
 * their leading zeros), and an "Instrucciones" sheet that explains each column.
 */
export async function buildImportTemplate(entity: ImportEntity): Promise<Blob> {
    const { default: writeExcelFile } = await import("write-excel-file/browser")
    const columns = IMPORT_COLUMNS[entity]
    const header = columns.map((column) => ({
        value: column.required ? `${column.header} *` : column.header,
        fontWeight: "bold" as const,
        backgroundColor: column.required ? "#FDE68A" : "#E5E7EB",
    }))
    const example = columns.map((column) => (
        column.text || typeof column.example === "string"
            ? { value: String(column.example), type: String, format: "@" }
            : { value: Number(column.example), type: Number }
    ))
    const instructions = [
        [
            { value: "Columna", fontWeight: "bold" as const },
            { value: "Obligatoria", fontWeight: "bold" as const },
            { value: "Cómo completarla", fontWeight: "bold" as const },
        ],
        ...columns.map((column) => [
            { value: column.header },
            { value: column.required ? "Sí" : "No" },
            { value: column.hint },
        ]),
        [],
        [{ value: "Las columnas marcadas con * (fondo amarillo) son obligatorias." }],
        [{ value: "La fila 2 es un ejemplo: reemplazala por tus datos. Si queda igual, no se importa." }],
        [{ value: "Se puede subir esta planilla o un CSV con las mismas columnas." }],
        [{ value: "Antes de guardar, la aplicación muestra qué se va a crear, qué ya existe y qué filas tienen errores." }],
    ]
    const sheets: Parameters<typeof writeExcelFile>[0] = [
        {
            sheet: ENTITY_SHEET_NAMES[entity],
            data: [header, example],
            columns: columns.map((column) => ({ width: Math.max(14, Math.min(40, column.header.length + 4)) })),
            stickyRowsCount: 1,
        },
        {
            sheet: "Instrucciones",
            data: instructions,
            columns: [{ width: 32 }, { width: 12 }, { width: 90 }],
        },
    ]
    return writeExcelFile(sheets).toBlob()
}

/** The rows of a file in batches of `size`, in order. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
    const batches: T[][] = []
    for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size))
    return batches
}
