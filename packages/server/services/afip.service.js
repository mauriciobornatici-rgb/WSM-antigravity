import crypto from 'crypto';
import fsSync from 'fs';
import Afip from '@afipsdk/afip.js';
import { decrypt } from '../utils/crypto.js';

// ARCA (AFIP) VAT aliquot ids.
const VAT_RATE_IDS = new Map([[0, 3], [2.5, 9], [5, 8], [10.5, 4], [21, 5], [27, 6]]);
const VOUCHER_TYPES_WITHOUT_VAT = new Set([11, 13]); // Factura C / NC C (monotributo)

const toCents = (value) => Math.round(Number(value || 0) * 100);

// Whether a voucher returned by ARCA lists the given invoice among its associated vouchers.
// Unknown shape → false: better to request a new voucher than adopt another note's CAE.
export function associatedVoucherMatches(voucherInfo, associated) {
    const raw = voucherInfo?.CbtesAsoc?.CbteAsoc ?? voucherInfo?.CbtesAsoc;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return list.some((cbte) => Number(cbte?.PtoVta) === Number(associated.point_of_sale)
        && Number(cbte?.Nro) === Number(associated.invoice_number));
}

// YYYYMMDD in local time, as ARCA expects dates.
export function formatAfipDate(value) {
    // A date-only string is already a calendar date: parsing it would read it as UTC
    // and shift it a day back in Argentina.
    const dateOnly = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (dateOnly) return `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`;
    const date = value instanceof Date ? value : new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Voucher amounts for ARCA from invoice lines, in integer cents so that
 * ImpTotal = ImpNeto + ImpIVA and the sum of Iva[].Importe = ImpIVA exactly.
 *
 * Catalog prices are net (ADR-008). A line stored by the local invoice carries its
 * own vat_amount and total_line: those are reported as-is so ARCA always matches
 * what the customer was charged. A line without them is priced as net + VAT.
 * A line with only total_line (gross) is split into net + VAT.
 */
export function buildVoucherAmounts(voucherType, invoiceItems) {
    const byRate = new Map();
    let totalCents = 0;
    let netCents = 0;
    let vatCents = 0;

    for (const item of invoiceItems) {
        const vatRate = item.vat_rate == null || item.vat_rate === '' ? 21 : Number(item.vat_rate);
        if (!VAT_RATE_IDS.has(vatRate)) {
            throw new Error(`Alícuota de IVA no soportada por ARCA: ${item.vat_rate}`);
        }

        let lineNet;
        let lineVat;
        if (item.total_line != null && item.vat_amount != null) {
            lineVat = toCents(item.vat_amount);
            lineNet = toCents(item.total_line) - lineVat;
        } else if (item.total_line != null) {
            const gross = toCents(item.total_line);
            lineNet = Math.round(gross / (1 + vatRate / 100));
            lineVat = gross - lineNet;
        } else {
            lineNet = toCents(Number(item.quantity) * Number(item.unit_price));
            lineVat = Math.round(lineNet * vatRate / 100);
        }

        netCents += lineNet;
        vatCents += lineVat;
        totalCents += lineNet + lineVat;
        const bucket = byRate.get(vatRate) || { base: 0, vat: 0 };
        bucket.base += lineNet;
        bucket.vat += lineVat;
        byRate.set(vatRate, bucket);
    }

    if (VOUCHER_TYPES_WITHOUT_VAT.has(voucherType)) {
        // Factura C does not discriminate VAT: the whole amount is reported as net.
        return { roundedTotal: totalCents / 100, roundedNet: totalCents / 100, roundedVat: 0, ivaArray: [] };
    }

    const ivaArray = [...byRate.entries()].map(([rate, bucket]) => ({
        Id: VAT_RATE_IDS.get(rate),
        BaseImp: bucket.base / 100,
        Importe: bucket.vat / 100,
    }));
    return { roundedTotal: totalCents / 100, roundedNet: netCents / 100, roundedVat: vatCents / 100, ivaArray };
}

// ARCA voucher type codes.
const VOUCHER_TYPE_CODES = Object.freeze({ A: 1, B: 6, C: 11, NC_A: 3, NC_B: 8, NC_C: 13 });

// Today's date in Argentina as ARCA expects it (YYYYMMDD), whatever the server's timezone.
export function arcaToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
    return Number(parts.replace(/-/g, ''));
}

/**
 * ADR-020: an ARCA rejection (the request reached ARCA and was refused, so the number was not
 * used) versus "we do not know" (timeout, connection, ARCA down: it may have been issued).
 * The SDK reports refusals as AfipWebServiceError with ARCA's numeric code.
 */
export function isArcaRejection(error) {
    if (error?.constructor?.name === 'AfipWebServiceError') return true;
    // ARCA codes are numeric ("10016"); network errors use names ("ECONNRESET", "ETIMEDOUT").
    return error?.code != null && /^\d+$/.test(String(error.code));
}

/**
 * RG 5616: the customer's VAT condition (CondicionIVAReceptorId) on every voucher. Taken from
 * the condition saved on the invoice; a Factura A (or its notes) goes to a Responsable
 * Inscripto unless it says Monotributo (customers have no stored condition yet, so the invoice
 * snapshot says "Consumidor Final" by default).
 */
export function receiverVatCondition(voucherType, taxCondition) {
    const text = String(taxCondition || '').trim().toLowerCase();
    const fromText = text.includes('inscripto') ? 1
        : text.includes('exento') ? 4
            : text.includes('monotribut') ? 6
                : text.includes('no categorizado') ? 7
                    : text.includes('consumidor final') ? 5
                        : null;
    const isA = Number(voucherType) === 1 || Number(voucherType) === 3;
    if (isA) return fromText === 6 ? 6 : 1;
    return fromText || 5;
}

/**
 * Whether the voucher ARCA has at a number is the one this document asked for: same type,
 * total, customer document and date (saved before asking), and for a credit note the same
 * associated invoice. Anything unknown → false: never adopt someone else's voucher.
 */
export function voucherMatchesRequest(info, request, requestDate) {
    if (!info) return false;
    if (Number(info.CbteTipo) !== Number(request.voucherType)) return false;
    if (toCents(info.ImpTotal) !== toCents(request.amounts.roundedTotal)) return false;
    if (Number(info.DocTipo) !== Number(request.docType) || Number(info.DocNro) !== Number(request.docNumber)) return false;
    if (requestDate != null && String(info.CbteFch) !== String(requestDate)) return false;
    if (request.associated && !associatedVoucherMatches(info, request.associated)) return false;
    return true;
}

class AfipService {
    constructor() {
        this.instances = new Map(); // Afip instances by CUIT, environment and certificate
        this.createdTempFiles = new Set();

        // Temporal keys and certs are deleted on 'exit', which also fires at the end of
        // the graceful shutdown in index.js. Signal handlers that call process.exit()
        // here would abort that shutdown (open requests, pool close) immediately.
        process.on('exit', () => this.cleanupTempFilesSync());
    }

    cleanupTempFilesSync() {
        for (const filePath of this.createdTempFiles) {
            try {
                if (fsSync.existsSync(filePath)) {
                    fsSync.unlinkSync(filePath);
                }
            } catch {
                // Silent catch on process exit
            }
        }
        this.createdTempFiles.clear();
    }

    async _getAfipInstance(companySettings) {
        const cuit = companySettings?.identity?.tax_id?.replace(/\D/g, '') || String(companySettings?.tax_id || '').replace(/\D/g, '');
        if (!cuit) throw new Error('CUIT de empresa no configurado');

        const env = companySettings?.billing_afip_env || 'homologacion';
        const isProduction = env === 'produccion';

        const cert = decrypt(companySettings?.billing_afip_crt);
        const key = decrypt(companySettings?.billing_afip_key);

        if (!cert || !key) {
            throw new Error('Certificado (.crt) o llave (.key) de ARCA no configurados');
        }

        // A renewed certificate gets a new instance (the cache used to keep the old one until a restart).
        const fingerprint = crypto.createHash('sha256').update(`${cert}|${key}`).digest('hex').slice(0, 16);
        const cacheKey = `${cuit}-${isProduction}-${fingerprint}`;
        if (this.instances.has(cacheKey)) {
            return this.instances.get(cacheKey);
        }

        // Pass cert and key contents directly in memory without writing to disk
        const afip = new Afip({
            CUIT: parseInt(cuit, 10),
            cert,
            key,
            production: isProduction
        });

        this.instances.set(cacheKey, afip);
        return afip;
    }

    _getDocType(clientId) {
        // 80 = CUIT, 96 = DNI, 99 = Sin Identificar (Consumidor Final)
        if (!clientId) return 99;
        const cleanId = String(clientId).replace(/\D/g, '');
        if (cleanId.length === 11) return 80; // CUIT
        if (cleanId.length === 7 || cleanId.length === 8) return 96; // DNI
        return 99; // Fallback
    }

    _getInvoiceType(invoiceType) {
        return VOUCHER_TYPE_CODES[invoiceType] || VOUCHER_TYPE_CODES.B;
    }

    pointOfSale(companySettings) {
        return parseInt(companySettings?.billing_pos || 1, 10);
    }

    /**
     * Everything ARCA needs about a document, decided before asking for a number. A Factura A
     * (or its notes) needs the customer's CUIT: ARCA would reject it, so it is refused here with
     * a clear message.
     */
    buildRequest(doc, items, companySettings) {
        const voucherType = this._getInvoiceType(doc.invoice_type);
        const docType = this._getDocType(doc.client_tax_id);
        const docNumber = docType === 99 ? 0 : parseInt(String(doc.client_tax_id).replace(/\D/g, ''), 10);
        if ((voucherType === 1 || voucherType === 3) && docType !== 80) {
            const error = new Error('Una factura o nota A necesita el CUIT del cliente (11 dígitos).');
            error.statusCode = 400;
            error.errorCode = 'ARCA_CUIT_REQUIRED';
            throw error;
        }
        return {
            pos: this.pointOfSale(companySettings),
            voucherType,
            docType,
            docNumber,
            amounts: buildVoucherAmounts(voucherType, items),
            associated: doc.associated_voucher || null,
            receiverVatCondition: receiverVatCondition(voucherType, doc.client_tax_condition),
        };
    }

    async lastVoucherNumber(request, companySettings) {
        const afip = await this._getAfipInstance(companySettings);
        return Number(await afip.ElectronicBilling.getLastVoucher(request.pos, request.voucherType)) || 0;
    }

    // The voucher ARCA has at that number, or null if ARCA says it does not exist. Any other
    // failure is thrown: "could not ask" must never be read as "it does not exist".
    async voucherAt(request, number, companySettings) {
        const afip = await this._getAfipInstance(companySettings);
        return (await afip.ElectronicBilling.getVoucherInfo(number, request.pos, request.voucherType)) || null;
    }

    // Asks ARCA for a CAE for exactly this number and date.
    async requestCae(request, number, requestDate, companySettings) {
        const afip = await this._getAfipInstance(companySettings);
        const { roundedTotal, roundedNet, roundedVat, ivaArray } = request.amounts;
        const payload = {
            'CantReg': 1,
            'PtoVta': request.pos,
            'CbteTipo': request.voucherType,
            'Concepto': 1, // 1 = Productos
            'DocTipo': request.docType,
            'DocNro': request.docNumber,
            'CbteDesde': number,
            'CbteHasta': number,
            'CbteFch': requestDate,
            'ImpTotal': roundedTotal,
            'ImpTotConc': 0, // No gravado
            'ImpNeto': roundedNet,
            'ImpOpEx': 0, // Exento
            'ImpTrib': 0, // Tributos
            'ImpIVA': roundedVat,
            'MonId': 'PES', // Pesos Argentinos
            'MonCotiz': 1,
            // RG 5616: the customer's VAT condition.
            'CondicionIVAReceptorId': request.receiverVatCondition || 5
        };
        if (ivaArray.length > 0) payload['Iva'] = ivaArray;
        // A credit note must name the invoice it corrects (comprobante asociado). CbteFch is
        // optional and left out: the local issue date may differ from the authorized one.
        if (request.associated) {
            payload['CbtesAsoc'] = [{
                'Tipo': this._getInvoiceType(request.associated.invoice_type),
                'PtoVta': parseInt(request.associated.point_of_sale, 10),
                'Nro': parseInt(request.associated.invoice_number, 10),
            }];
        }
        const res = await afip.ElectronicBilling.createVoucher(payload);
        return { cae: res.CAE, cae_expiration_date: this.formatExpirationDate(res.CAEFchVto), number };
    }

    formatExpirationDate(dateStr) {
        if (!dateStr || String(dateStr).length !== 8) return null;
        const value = String(dateStr);
        return `${value.substring(0, 4)}-${value.substring(4, 6)}-${value.substring(6, 8)}`;
    }
}

export default new AfipService();
