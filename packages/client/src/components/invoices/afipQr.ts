import type { InvoiceView } from "./types"

/**
 * Generación del código QR fiscal de AFIP/ARCA (RG 4892/2021).
 *
 * El QR se compone con la URL oficial + el parámetro `p` = Base64 de un JSON
 * con los campos definidos por AFIP. Referencia oficial:
 *   https://www.afip.gob.ar/fe/qr/especificaciones.asp
 *
 * Nota: el campo de cotización es `ctz` (NO `cotiz`). Esta utilidad reemplaza
 * implementaciones previas que usaban el nombre incorrecto y un QR decorativo.
 */

export const AFIP_QR_BASE_URL = "https://www.afip.gob.ar/fe/qr/?p="

/** Códigos de comprobante AFIP (CbteTipo). */
const VOUCHER_TYPE_CODE: Record<string, number> = {
    A: 1,
    B: 6,
    C: 11,
    M: 51,
    NC_A: 3,
    NC_B: 8,
    NC_C: 13,
    ND_A: 2,
    ND_B: 7,
    ND_C: 12,
}

export function getVoucherTypeCode(invoiceType?: string | null): number | null {
    if (!invoiceType) return null
    return VOUCHER_TYPE_CODE[invoiceType] ?? null
}

/** Tipo de documento del receptor: 80 = CUIT, 96 = DNI, 99 = Consumidor Final. */
export function getReceiverDocType(taxId?: string | null): number {
    const clean = String(taxId ?? "").replace(/\D/g, "")
    if (clean.length === 11) return 80
    if (clean.length === 8) return 96
    return 99
}

/** Base64 seguro para UTF-8, funciona en navegador (btoa) y en Node (Buffer). */
function toBase64(input: string): string {
    if (typeof btoa === "function") {
        return btoa(encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))))
    }
    const buf = (globalThis as unknown as { Buffer?: { from: (s: string, e: string) => { toString: (e: string) => string } } }).Buffer
    if (buf) {
        return buf.from(input, "utf8").toString("base64")
    }
    return ""
}

export type AfipQrInput = {
    emisorCuit: string | number
    invoiceType?: string | null | undefined
    pointOfSale?: number | null | undefined
    invoiceNumber?: number | null | undefined
    issueDate?: string | null | undefined
    totalAmount?: number | null | undefined
    cae?: string | null | undefined
    clientTaxId?: string | null | undefined
    /** "E" = CAE (default), "A" = CAEA. */
    authType?: "E" | "A" | undefined
}

export type AfipQrPayload = {
    ver: number
    fecha: string
    cuit: number
    ptoVta: number
    tipoCmp: number
    nroCmp: number
    importe: number
    moneda: string
    ctz: number
    tipoDocRec: number
    nroDocRec: number
    tipoCodAut: string
    codAut: number
}

/**
 * Construye el payload oficial del QR. Devuelve `null` si el comprobante no
 * está fiscalmente autorizado (sin CAE, sin CUIT emisor o tipo no fiscal),
 * para que la UI NO muestre un QR inválido.
 */
export function buildAfipQrPayload(input: AfipQrInput): AfipQrPayload | null {
    const tipoCmp = getVoucherTypeCode(input.invoiceType)
    const cuit = Number(String(input.emisorCuit ?? "").replace(/\D/g, ""))
    const codAut = Number(String(input.cae ?? "").replace(/\D/g, ""))

    if (!tipoCmp || !cuit || !codAut) return null

    const tipoDocRec = getReceiverDocType(input.clientTaxId)
    const nroDocRec = tipoDocRec === 99 ? 0 : Number(String(input.clientTaxId ?? "").replace(/\D/g, "")) || 0
    const fecha = input.issueDate
        ? String(input.issueDate).substring(0, 10)
        : new Date().toISOString().substring(0, 10)

    return {
        ver: 1,
        fecha,
        cuit,
        ptoVta: Number(input.pointOfSale || 1),
        tipoCmp,
        nroCmp: Number(input.invoiceNumber || 0),
        importe: Number(input.totalAmount || 0),
        moneda: "PES",
        ctz: 1,
        tipoDocRec,
        nroDocRec,
        tipoCodAut: input.authType || "E",
        codAut,
    }
}

/** Construye la URL completa del QR de AFIP, o `null` si no corresponde. */
export function buildAfipQrUrl(input: AfipQrInput): string | null {
    const payload = buildAfipQrPayload(input)
    if (!payload) return null
    return AFIP_QR_BASE_URL + toBase64(JSON.stringify(payload))
}

/** Atajo a partir de una factura ya cargada en el front. */
export function buildAfipQrUrlFromInvoice(
    invoice: InvoiceView,
    emisorCuit: string | number,
): string | null {
    return buildAfipQrUrl({
        emisorCuit,
        invoiceType: invoice.invoice_type ?? null,
        pointOfSale: invoice.point_of_sale ?? null,
        invoiceNumber: invoice.invoice_number ?? null,
        issueDate: invoice.issue_date ? String(invoice.issue_date) : null,
        totalAmount: invoice.total_amount ?? null,
        cae: invoice.cae ?? null,
        clientTaxId: invoice.client_tax_id ?? null,
    })
}
