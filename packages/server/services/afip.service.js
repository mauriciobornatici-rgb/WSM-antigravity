import fsSync from 'fs';
import Afip from '@afipsdk/afip.js';
import { decrypt } from '../utils/crypto.js';

// ARCA (AFIP) VAT aliquot ids.
const VAT_RATE_IDS = new Map([[0, 3], [2.5, 9], [5, 8], [10.5, 4], [21, 5], [27, 6]]);
const VOUCHER_TYPES_WITHOUT_VAT = new Set([11, 13]); // Factura C / NC C (monotributo)

const toCents = (value) => Math.round(Number(value || 0) * 100);

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

class AfipService {
    constructor() {
        this.instances = new Map(); // Cache Afip instances by CUIT
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
            } catch (err) {
                // Silent catch on process exit
            }
        }
        this.createdTempFiles.clear();
    }

    async _getAfipInstance(companySettings) {
        const cuit = companySettings?.identity?.tax_id?.replace(/\D/g, '');
        if (!cuit) throw new Error("CUIT de empresa no configurado");
        
        const env = companySettings?.billing_afip_env || 'homologacion';
        const isProduction = env === 'produccion';
        
        const cert = decrypt(companySettings?.billing_afip_crt);
        const key = decrypt(companySettings?.billing_afip_key);

        if (!cert || !key) {
            throw new Error("Certificado (.crt) o llave (.key) de AFIP no configurados");
        }

        const cacheKey = `${cuit}-${isProduction}`;
        if (this.instances.has(cacheKey)) {
            return this.instances.get(cacheKey);
        }

        // Pass cert and key contents directly in memory without writing to disk
        const afip = new Afip({
            CUIT: parseInt(cuit, 10),
            cert: cert,
            key: key,
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
        if (cleanId.length === 8) return 96;  // DNI
        return 99; // Fallback
    }

    _getInvoiceType(invoiceType) {
        // AFIP Voucher Types:
        // 1 = Factura A, 6 = Factura B, 11 = Factura C
        // 3 = NC A, 8 = NC B, 13 = NC C
        const mapping = {
            'A': 1,
            'B': 6,
            'C': 11,
            'NC_A': 3,
            'NC_B': 8,
            'NC_C': 13
        };
        return mapping[invoiceType] || 6; // Default Factura B
    }

    async createVoucher(invoiceData, invoiceItems, companySettings) {
        const afip = await this._getAfipInstance(companySettings);
        
        const posNumber = parseInt(companySettings?.billing_pos || 1, 10);
        const voucherType = this._getInvoiceType(invoiceData.invoice_type);
        const docType = this._getDocType(invoiceData.client_tax_id);
        const docNumber = docType === 99 ? 0 : parseInt(String(invoiceData.client_tax_id).replace(/\D/g, ''), 10);

        // Get last voucher number
        const lastVoucher = await afip.ElectronicBilling.getLastVoucher(posNumber, voucherType);
        const nextVoucherNumber = lastVoucher + 1;

        const { roundedTotal, roundedNet, roundedVat, ivaArray } = buildVoucherAmounts(voucherType, invoiceItems);

        const date = new Date(Date.now() - ((new Date()).getTimezoneOffset() * 60000)).toISOString().split('T')[0].replace(/-/g, '');

        const payload = {
            'CantReg': 1,
            'PtoVta': posNumber,
            'CbteTipo': voucherType,
            'Concepto': 1, // 1 = Productos
            'DocTipo': docType,
            'DocNro': docNumber,
            'CbteDesde': nextVoucherNumber,
            'CbteHasta': nextVoucherNumber,
            'CbteFch': parseInt(date, 10),
            'ImpTotal': roundedTotal,
            'ImpTotConc': 0, // No gravado
            'ImpNeto': roundedNet,
            'ImpOpEx': 0, // Exento
            'ImpTrib': 0, // Tributos
            'ImpIVA': roundedVat,
            'MonId': 'PES', // Pesos Argentinos
            'MonCotiz': 1
        };

        if (ivaArray.length > 0) {
            payload['Iva'] = ivaArray;
        }

        try {
            const res = await afip.ElectronicBilling.createVoucher(payload);
            return {
                cae: res.CAE,
                cae_expiration_date: res.CAEFchVto, // Format YYYYMMDD
                invoice_number: nextVoucherNumber
            };
        } catch (error) {
            console.error("AFIP Error:", error);
            throw new Error(`AFIP: ${error.message || 'Error al generar CAE'}`);
        }
    }

    async authorizeVoucher(invoiceData, invoiceItems, companySettings) {
        let afipRes = null;

        // Call AFIP only for non-tickets
        if (invoiceData.invoice_type !== 'TK') {
            try {
                // 1. Prevención de Split-Brain (Comprobación de último comprobante emitido)
                const lastVoucherNumber = await this.getLastVoucher(invoiceData.invoice_type, companySettings);
                
                if (lastVoucherNumber > 0) {
                    const lastVoucherInfo = await this.getVoucherInfo(invoiceData.invoice_type, lastVoucherNumber, companySettings);
                    
                    if (lastVoucherInfo) {
                        const localTotal = Math.round(Number(invoiceData.total_amount) * 100) / 100;
                        const afipTotal = lastVoucherInfo.ImpTotal;
                        
                        const localDocType = this._getDocType(invoiceData.client_tax_id);
                        const localDocNumber = localDocType === 99 ? 0 : parseInt(String(invoiceData.client_tax_id).replace(/\D/g, ''), 10);
                        
                        // Si el monto total y el documento del cliente coinciden con el último voucher emitido,
                        // asumimos que fue la petición de esta factura que llegó a AFIP pero cuyo response perdimos.
                        if (afipTotal === localTotal && lastVoucherInfo.DocNro === localDocNumber) {
                            console.log(`[AFIP Split-Brain] Recuperando comprobante previo coincidente: ${lastVoucherNumber}`);
                            afipRes = {
                                cae: lastVoucherInfo.CodAutorizacion,
                                cae_expiration_date: lastVoucherInfo.FchVto,
                                invoice_number: lastVoucherNumber
                            };
                        }
                    }
                }

                // 2. Si no es un split-brain, pedimos uno nuevo
                if (!afipRes) {
                    afipRes = await this.createVoucher(invoiceData, invoiceItems, companySettings);
                }
            } catch (err) {
                throw new Error(`Fallo autorización AFIP: ${err.message}`);
            }
        }

        const cae = afipRes ? afipRes.cae : null;
        const expirationDate = afipRes ? this.formatExpirationDate(afipRes.cae_expiration_date) : null;
        const finalInvoiceNumber = afipRes ? afipRes.invoice_number : invoiceData.invoice_number;

        return {
            cae,
            cae_expiration_date: expirationDate,
            invoice_number: finalInvoiceNumber
        };
    }

    async getLastVoucher(invoiceType, companySettings) {
        const afip = await this._getAfipInstance(companySettings);
        const posNumber = parseInt(companySettings?.billing_pos || 1, 10);
        const voucherType = this._getInvoiceType(invoiceType);
        try {
            return await afip.ElectronicBilling.getLastVoucher(posNumber, voucherType);
        } catch (error) {
            console.error("AFIP getLastVoucher Error:", error);
            throw error;
        }
    }

    async getVoucherInfo(invoiceType, voucherNumber, companySettings) {
        const afip = await this._getAfipInstance(companySettings);
        const posNumber = parseInt(companySettings?.billing_pos || 1, 10);
        const voucherType = this._getInvoiceType(invoiceType);
        try {
            return await afip.ElectronicBilling.getVoucherInfo(voucherNumber, posNumber, voucherType);
        } catch (error) {
            console.error("AFIP getVoucherInfo Error:", error);
            return null; // Si no existe o hay error
        }
    }

    formatExpirationDate(dateStr) {
        if (!dateStr || String(dateStr).length !== 8) return null;
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6);
        const day = dateStr.substring(6, 8);
        return `${year}-${month}-${day}`;
    }
}

export default new AfipService();
