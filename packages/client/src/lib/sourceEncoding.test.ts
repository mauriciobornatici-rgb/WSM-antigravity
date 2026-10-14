import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

// UTF-8 text decoded as Windows-1252 and saved again (an accented letter turns into an "A" with
// a tilde plus a symbol). It reaches the screen as strange symbols, so every source file is
// checked (the user's rule: Spanish, readable). Built from code points so this file is clean.
const LEAD_TILDE_A = String.fromCharCode(0xc3)
const LEAD_CIRCUMFLEX_A = String.fromCharCode(0xc2)
const LEAD_E_EURO = String.fromCharCode(0xe2, 0x20ac)

function isMojibake(line: string): boolean {
    for (let i = 0; i < line.length - 1; i++) {
        const next = line.charCodeAt(i + 1)
        if (line[i] === LEAD_TILDE_A && ((next >= 0x80 && next <= 0xbf) || (next >= 0xa1 && next <= 0xff))) return true
        if (line[i] === LEAD_CIRCUMFLEX_A && next >= 0xa0 && next <= 0xbf) return true
    }
    return line.includes(LEAD_E_EURO)
}

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sourceFiles(path)
        return /\.(tsx?|css|html)$/.test(name) ? [path] : []
    })
}

describe("codificación de los textos", () => {
    it("detecta texto con doble codificación", () => {
        expect(isMojibake(`A${LEAD_TILDE_A}${String.fromCharCode(0xba)}n`)).toBe(true)
        expect(isMojibake("Aún no agregaste productos. Gestión de caja. Comisión. ítems")).toBe(false)
    })

    it("ningún archivo del cliente tiene texto con doble codificación (símbolos raros en pantalla)", () => {
        const root = join(__dirname, "..")
        const broken = sourceFiles(root)
            .flatMap((file) => readFileSync(file, "utf8").split("\n")
                .map((line, index) => ({ line, index }))
                .filter(({ line }) => isMojibake(line))
                .map(({ line, index }) => `${relative(root, file)}:${index + 1}: ${line.trim().slice(0, 80)}`))
        expect(broken).toEqual([])
    })
})
