import { describe, expect, it } from "vitest"
import { arcaAuthorizeButtonLabel, arcaLastErrorText, creditNoteFiscalNumber, formatFiscalNumber } from "./arca"

describe("arca helpers", () => {
    it("formatea el número fiscal con punto de venta de 4 dígitos y número de 8", () => {
        expect(formatFiscalNumber(3, 45)).toBe("0003-00000045")
        expect(formatFiscalNumber(undefined, "123")).toBe("0001-00000123")
    })

    it("devuelve el número fiscal de la NC solo si ARCA asignó número", () => {
        expect(creditNoteFiscalNumber({ point_of_sale: 2, arca_voucher_number: 17 })).toBe("0002-00000017")
        expect(creditNoteFiscalNumber({ point_of_sale: 2 })).toBeNull()
        expect(creditNoteFiscalNumber({ point_of_sale: 2, arca_voucher_number: null })).toBeNull()
    })

    it("muestra 'Verificar ahora' mientras el comprobante está en verificación", () => {
        expect(arcaAuthorizeButtonLabel("authorizing")).toBe("Verificar ahora")
        expect(arcaAuthorizeButtonLabel("issued")).toBe("Autorizar con ARCA")
    })

    it("muestra el último error solo si no está autorizado", () => {
        expect(arcaLastErrorText({ status: "issued", arca_last_error: "CUIT inválido" })).toBe("CUIT inválido")
        expect(arcaLastErrorText({ status: "authorized", arca_last_error: "viejo" })).toBeNull()
        expect(arcaLastErrorText({ status: "issued", arca_last_error: null })).toBeNull()
    })
})
