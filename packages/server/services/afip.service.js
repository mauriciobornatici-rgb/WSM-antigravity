import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import Afip from '@afipsdk/afip.js';

class AfipService {
    constructor() {
        this.instances = new Map(); // Cache Afip instances by CUIT
    }

    async _getAfipInstance(companySettings) {
        const cuit = companySettings?.identity?.tax_id?.replace(/\D/g, '');
        if (!cuit) throw new Error("CUIT de empresa no configurado");
        
        const env = companySettings?.billing_afip_env || 'homologacion';
        const isProduction = env === 'produccion';
        
        const cert = companySettings?.billing_afip_crt;
        const key = companySettings?.billing_afip_key;

        if (!cert || !key) {
            throw new Error("Certificado (.crt) o llave (.key) de AFIP no configurados");
        }

        const cacheKey = `${cuit}-${isProduction}`;
        if (this.instances.has(cacheKey)) {
            return this.instances.get(cacheKey);
        }

        // afip.js requiere los archivos en disco
        const tmpDir = os.tmpdir();
        const certFileName = `afip_cert_${cuit}_${isProduction}.crt`;
        const keyFileName = `afip_key_${cuit}_${isProduction}.key`;
        
        const certPath = path.join(tmpDir, certFileName);
        const keyPath = path.join(tmpDir, keyFileName);

        await fs.writeFile(certPath, cert, 'utf8');
        await fs.writeFile(keyPath, key, 'utf8');

        const afip = new Afip({
            CUIT: parseInt(cuit, 10),
            cert: certPath,
            key: keyPath,
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

        let totalAmount = 0;
        let netAmount = 0;
        let vatAmount = 0;
        let ivaArray = [];

        // Agrupar tasas de IVA
        const ivaMap = {};

        for (const item of invoiceItems) {
            const qty = item.quantity;
            const unitPrice = item.unit_price;
            const vatRate = item.vat_rate || 21;
            
            const lineTotal = Number(qty * unitPrice);
            
            const vatRateId = vatRate === 21 ? 5 : (vatRate === 10.5 ? 4 : 3); // 5=21%, 4=10.5%, 3=0%
            
            if (voucherType === 1 || voucherType === 3) { // Facturas A discriminan IVA
                const lineNet = lineTotal / (1 + (vatRate / 100));
                const lineVat = lineTotal - lineNet;
                
                netAmount += lineNet;
                vatAmount += lineVat;
                totalAmount += lineTotal;

                if (!ivaMap[vatRateId]) {
                    ivaMap[vatRateId] = { BaseImp: 0, Importe: 0 };
                }
                ivaMap[vatRateId].BaseImp += lineNet;
                ivaMap[vatRateId].Importe += lineVat;
            } else {
                // Facturas B o C no discriminan en el detalle hacia AFIP de igual manera, 
                // pero si AFIP exige BaseImp e Importe para B, se debe informar
                const lineNet = lineTotal / (1 + (vatRate / 100));
                const lineVat = lineTotal - lineNet;
                
                netAmount += lineNet;
                vatAmount += lineVat;
                totalAmount += lineTotal;

                if (voucherType === 6 || voucherType === 8) { // B discrimina internamente
                    if (!ivaMap[vatRateId]) {
                        ivaMap[vatRateId] = { BaseImp: 0, Importe: 0 };
                    }
                    ivaMap[vatRateId].BaseImp += lineNet;
                    ivaMap[vatRateId].Importe += lineVat;
                }
            }
        }

        // Format to AFIP 2 decimals requirements
        const roundedTotal = Math.round(totalAmount * 100) / 100;
        const roundedNet = Math.round(netAmount * 100) / 100;
        const roundedVat = Math.round(vatAmount * 100) / 100;

        for (const k in ivaMap) {
            ivaArray.push({
                Id: parseInt(k, 10),
                BaseImp: Math.round(ivaMap[k].BaseImp * 100) / 100,
                Importe: Math.round(ivaMap[k].Importe * 100) / 100
            });
        }

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

        if (ivaArray.length > 0 && roundedVat > 0) {
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
}

export default new AfipService();
