import { describe, expect, it } from "vitest"
import { arcaAlertCount, canReissueInvoice, reissueLetters, arcaAlertLink, arcaAlertSummary, arcaAlertTitle, arcaErrorText } from "./arca"
import { suggestedInvoiceLetter, taxConditionCuitError, taxConditionName, TAX_CONDITION_OPTIONS } from "./taxConditions"

describe("alertas de ARCA (ADR-021)", () => {
    it("titula facturas y notas de crédito con su número fiscal", () => {
        expect(arcaAlertTitle({ document_kind: "invoice", id: "i", letter: "B", point_of_sale: 2, number: 42 }))
            .toBe("Factura B 0002-00000042")
        expect(arcaAlertTitle({ document_kind: "credit_note", id: "c", letter: "NC_A", point_of_sale: 1, number: "7" }))
            .toBe("Nota de crédito A 0001-00000007")
        expect(arcaAlertTitle({ document_kind: "credit_note", id: "c", letter: null, point_of_sale: null, number: "NC-0001-15" }))
            .toBe("Nota de crédito NC-0001-15")
        expect(arcaAlertTitle({ document_kind: "invoice", id: "i", letter: "A", point_of_sale: 1, number: null }))
            .toBe("Factura A")
    })

    it("lleva a la factura o a la pestaña de notas de crédito", () => {
        expect(arcaAlertLink({ document_kind: "invoice", id: "a b", letter: "B", point_of_sale: 1, number: 1 }))
            .toBe("/invoices?invoice_id=a%20b")
        expect(arcaAlertLink({ document_kind: "credit_note", id: "c", letter: "B", point_of_sale: 1, number: 1 }))
            .toBe("/returns-warranties?tab=credits&credit_note_id=c")
    })

    it("resume conflictos y comprobantes sin confirmar", () => {
        expect(arcaAlertSummary(2, 1)).toBe("2 en conflicto · 1 sin confirmar")
        expect(arcaAlertSummary(0, 3)).toBe("3 sin confirmar")
        expect(arcaAlertSummary(1, 0)).toBe("1 en conflicto")
        expect(arcaAlertSummary(0, 0)).toBe("")
        expect(arcaAlertSummary(1, 0, 1)).toBe("1 en conflicto · 1 rechazado")
        expect(arcaAlertSummary(0, 0, 3)).toBe("3 rechazados")
        expect(arcaAlertSummary(0, 1, 0, 2)).toBe("1 sin confirmar · 2 sin autorizar")
        expect(arcaAlertCount({ conflicts: 1, stuck: 2, rejected: 3, unauthorized: 4 })).toBe(10)
        expect(arcaAlertCount(null)).toBe(0)
    })

    it("muestra los errores de red en español y deja los motivos de ARCA tal cual", () => {
        expect(arcaErrorText("connect ETIMEDOUT 1.2.3.4:443")).toBe("ARCA no respondió (error de conexión).")
        expect(arcaErrorText("socket hang up")).toBe("ARCA no respondió (error de conexión).")
        expect(arcaErrorText("(10016) El número no es el siguiente")).toBe("(10016) El número no es el siguiente")
        expect(arcaErrorText("  ")).toBeNull()
        expect(arcaErrorText(null)).toBeNull()
    })
})

describe("reemisión de facturas sin autorizar (ADR-022)", () => {
    it("solo se anula una factura sin CAE y fuera de trámite con ARCA", () => {
        expect(canReissueInvoice({ status: "issued", cae: null })).toBe(true)
        expect(canReissueInvoice({ status: "issued", cae: "123" })).toBe(false)
        expect(canReissueInvoice({ status: "authorizing" })).toBe(false)
        expect(canReissueInvoice({ status: "authorized", cae: "1" })).toBe(false)
        expect(canReissueInvoice(null)).toBe(false)
    })

    it("conserva el tratamiento del IVA: A, B y ticket entre sí, C solo a C", () => {
        expect(reissueLetters("B")).toEqual(["A", "B", "TK"])
        expect(reissueLetters("TK")).toEqual(["TK", "A", "B"])
        expect(reissueLetters("C")).toEqual(["C"])
        expect(reissueLetters(null)).toEqual([])
    })
})

describe("condición frente al IVA del cliente (ADR-021)", () => {
    it("ofrece las cuatro condiciones con su nombre", () => {
        expect(TAX_CONDITION_OPTIONS.map((option) => option.label)).toEqual([
            "Consumidor Final", "Responsable Inscripto", "Monotributista", "Exento",
        ])
        expect(taxConditionName("tc_Exento")).toBe("Exento")
        expect(taxConditionName(null)).toBeNull()
        expect(taxConditionName("desconocida")).toBeNull()
    })

    it("sugiere A para inscriptos y B para el resto, monotributistas incluidos", () => {
        expect(suggestedInvoiceLetter("tc_RespInscripto")).toBe("A")
        expect(suggestedInvoiceLetter("tc_Monotributo", "Responsable Inscripto")).toBe("B")
        expect(suggestedInvoiceLetter("tc_ConsFinal")).toBe("B")
        expect(suggestedInvoiceLetter("tc_Exento")).toBe("B")
    })

    it("no sugiere nada sin condición cargada ni si la empresa es monotributista", () => {
        expect(suggestedInvoiceLetter(null)).toBeNull()
        expect(suggestedInvoiceLetter(undefined)).toBeNull()
        expect(suggestedInvoiceLetter("tc_RespInscripto", "Monotributo")).toBeNull()
    })

    it("exige CUIT de 11 dígitos solo al responsable inscripto", () => {
        expect(taxConditionCuitError("tc_RespInscripto", "28999000")).toMatch(/CUIT \(11 dígitos\)/)
        expect(taxConditionCuitError("tc_RespInscripto", "")).not.toBeNull()
        expect(taxConditionCuitError("tc_Monotributo", "28999000")).toBeNull()
        expect(taxConditionCuitError("tc_RespInscripto", "30-71234567-4")).toBeNull()
        expect(taxConditionCuitError("tc_ConsFinal", "28999000")).toBeNull()
        expect(taxConditionCuitError("none", "")).toBeNull()
    })
})
