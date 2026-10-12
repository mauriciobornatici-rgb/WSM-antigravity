import test from 'node:test';
import assert from 'node:assert/strict';

import afipService, { buildVoucherAmounts } from '../services/afip.service.js';

const settings = {
    identity: { tax_id: '30-70000000-1' },
    billing_pos: 3,
    billing_afip_env: 'homologacion',
    billing_afip_crt: 'legacy-certificate',
    billing_afip_key: 'legacy-private-key'
};

test('AFIP document, voucher and expiration mappings cover Argentine identities', () => {
    assert.equal(afipService._getDocType(), 99);
    assert.equal(afipService._getDocType('20-12345678-9'), 80);
    assert.equal(afipService._getDocType('12.345.678'), 96);
    assert.equal(afipService._getDocType('123'), 99);
    assert.equal(afipService._getInvoiceType('A'), 1);
    assert.equal(afipService._getInvoiceType('NC_B'), 8);
    assert.equal(afipService._getInvoiceType('unknown'), 6);
    assert.equal(afipService.formatExpirationDate('20260930'), '2026-09-30');
    assert.equal(afipService.formatExpirationDate('bad'), null);
    assert.equal(afipService.formatExpirationDate(), null);
});

test('_getAfipInstance validates credentials and caches SDK instances by environment', async () => {
    await assert.rejects(() => afipService._getAfipInstance({}), /CUIT/);
    await assert.rejects(
        () => afipService._getAfipInstance({ identity: { tax_id: '30700000001' } }),
        /Certificado.*llave/
    );
    afipService.instances.clear();
    const first = await afipService._getAfipInstance(settings);
    const second = await afipService._getAfipInstance(settings);
    assert.equal(first, second);
    const production = await afipService._getAfipInstance({ ...settings, billing_afip_env: 'produccion' });
    assert.notEqual(production, first);
    afipService.instances.clear();
});

test('createVoucher builds a rounded Factura A payload with grouped VAT', async (t) => {
    let payload;
    const fakeAfip = { ElectronicBilling: {
        getLastVoucher: async () => 41,
        createVoucher: async (value) => {
            payload = value;
            return { CAE: 'CAE-1', CAEFchVto: '20260930' };
        }
    } };
    const original = afipService._getAfipInstance;
    afipService._getAfipInstance = async () => fakeAfip;
    t.after(() => { afipService._getAfipInstance = original; });
    const result = await afipService.createVoucher(
        { invoice_type: 'A', client_tax_id: '20-12345678-9' },
        [
            { quantity: 2, unit_price: 121, vat_rate: 21 },
            { quantity: 1, unit_price: 110.5, vat_rate: 10.5 }
        ],
        settings
    );
    assert.deepEqual(result, { cae: 'CAE-1', cae_expiration_date: '20260930', invoice_number: 42 });
    assert.equal(payload.PtoVta, 3);
    assert.equal(payload.CbteTipo, 1);
    assert.equal(payload.DocTipo, 80);
    assert.equal(payload.DocNro, 20123456789);
    // Catalog prices are net (ADR-008): 2 × 121 + 21 % and 1 × 110.5 + 10.5 %.
    assert.equal(payload.ImpNeto, 352.5);
    assert.equal(payload.ImpIVA, 62.42);
    assert.equal(payload.ImpTotal, 414.92);
    assert.deepEqual(payload.Iva, [
        { Id: 5, BaseImp: 242, Importe: 50.82 },
        { Id: 4, BaseImp: 110.5, Importe: 11.6 },
    ]);
});

test('voucher amounts reproduce the stored invoice lines exactly and close to the cent', () => {
    // mysql2 returns DECIMAL columns as strings.
    const amounts = buildVoucherAmounts(6, [
        { quantity: '1.00', unit_price: '10000.00', vat_rate: '21.00', vat_amount: '2100.00', total_line: '12100.00' },
        { quantity: '3.00', unit_price: '0.33', vat_rate: '21.00', vat_amount: '0.21', total_line: '1.20' },
    ]);
    assert.deepEqual(amounts, {
        roundedTotal: 12101.2,
        roundedNet: 10000.99,
        roundedVat: 2100.21,
        ivaArray: [{ Id: 5, BaseImp: 10000.99, Importe: 2100.21 }],
    });
    assert.equal(Math.round((amounts.roundedNet + amounts.roundedVat) * 100), Math.round(amounts.roundedTotal * 100));
});

test('voucher amounts split a gross-only line and report Factura C without VAT detail', () => {
    assert.deepEqual(buildVoucherAmounts(8, [{ total_line: 121, vat_rate: 21 }]).ivaArray, [{ Id: 5, BaseImp: 100, Importe: 21 }]);
    assert.deepEqual(buildVoucherAmounts(11, [{ quantity: 1, unit_price: 100, vat_rate: 21 }]), {
        roundedTotal: 121, roundedNet: 121, roundedVat: 0, ivaArray: [],
    });
    assert.deepEqual(buildVoucherAmounts(6, [{ quantity: 1, unit_price: 50, vat_rate: 0 }]).ivaArray, [{ Id: 3, BaseImp: 50, Importe: 0 }]);
    assert.throws(() => buildVoucherAmounts(6, [{ quantity: 1, unit_price: 1, vat_rate: 19 }]), /no soportada/);
});

test('createVoucher supports Factura B and tax-exempt C payloads', async (t) => {
    const payloads = [];
    const original = afipService._getAfipInstance;
    afipService._getAfipInstance = async () => ({ ElectronicBilling: {
        getLastVoucher: async () => 0,
        createVoucher: async (payload) => {
            payloads.push(payload);
            return { CAE: 'X', CAEFchVto: '20261001' };
        }
    } });
    t.after(() => { afipService._getAfipInstance = original; });
    await afipService.createVoucher({ invoice_type: 'B' }, [{ quantity: 1, unit_price: 121 }], settings);
    await afipService.createVoucher({ invoice_type: 'C' }, [{ quantity: 1, unit_price: 100, vat_rate: 0 }], settings);
    assert.equal(payloads[0].DocNro, 0);
    assert.equal(payloads[0].Iva[0].Id, 5);
    assert.equal('Iva' in payloads[1], false);
    assert.equal(payloads[1].CbteTipo, 11);
});

test('createVoucher wraps SDK failures with an AFIP domain message', async (t) => {
    const original = afipService._getAfipInstance;
    const originalError = console.error;
    console.error = () => {};
    afipService._getAfipInstance = async () => ({ ElectronicBilling: {
        getLastVoucher: async () => 0,
        createVoucher: async () => { throw new Error('sin servicio'); }
    } });
    t.after(() => {
        afipService._getAfipInstance = original;
        console.error = originalError;
    });
    await assert.rejects(
        () => afipService.createVoucher({ invoice_type: 'B' }, [{ quantity: 1, unit_price: 1 }], settings),
        /AFIP: sin servicio/
    );
});

test('authorizeVoucher recovers an identical split-brain voucher', async (t) => {
    const originals = {
        last: afipService.getLastVoucher,
        info: afipService.getVoucherInfo,
        create: afipService.createVoucher
    };
    let createCalls = 0;
    afipService.getLastVoucher = async () => 7;
    afipService.getVoucherInfo = async () => ({
        ImpTotal: 121,
        DocNro: 20123456789,
        CodAutorizacion: 'RECOVERED',
        FchVto: '20260930'
    });
    afipService.createVoucher = async () => { createCalls += 1; };
    t.after(() => Object.assign(afipService, {
        getLastVoucher: originals.last,
        getVoucherInfo: originals.info,
        createVoucher: originals.create
    }));
    const result = await afipService.authorizeVoucher(
        { invoice_type: 'A', client_tax_id: '20-12345678-9', total_amount: 121, invoice_number: 1 },
        [], settings
    );
    assert.deepEqual(result, {
        cae: 'RECOVERED', cae_expiration_date: '2026-09-30', invoice_number: 7
    });
    assert.equal(createCalls, 0);
});

test('authorizeVoucher creates new vouchers when recovery does not match and skips tickets', async (t) => {
    const originals = {
        last: afipService.getLastVoucher,
        info: afipService.getVoucherInfo,
        create: afipService.createVoucher
    };
    afipService.getLastVoucher = async () => 1;
    afipService.getVoucherInfo = async () => ({ ImpTotal: 99, DocNro: 0 });
    afipService.createVoucher = async () => ({ cae: 'NEW', cae_expiration_date: '20261001', invoice_number: 2 });
    t.after(() => Object.assign(afipService, {
        getLastVoucher: originals.last,
        getVoucherInfo: originals.info,
        createVoucher: originals.create
    }));
    const fiscal = await afipService.authorizeVoucher({ invoice_type: 'B', total_amount: 100 }, [], settings);
    const ticket = await afipService.authorizeVoucher({ invoice_type: 'TK', invoice_number: 55 }, [], settings);
    assert.equal(fiscal.cae, 'NEW');
    assert.equal(fiscal.cae_expiration_date, '2026-10-01');
    assert.deepEqual(ticket, { cae: null, cae_expiration_date: null, invoice_number: 55 });
});

test('authorizeVoucher wraps recovery or creation errors', async (t) => {
    const original = afipService.getLastVoucher;
    afipService.getLastVoucher = async () => { throw new Error('credencial inválida'); };
    t.after(() => { afipService.getLastVoucher = original; });
    await assert.rejects(
        () => afipService.authorizeVoucher({ invoice_type: 'A' }, [], settings),
        /Fallo autorización AFIP: credencial inválida/
    );
});

test('getLastVoucher and getVoucherInfo call the SDK and preserve safe failure semantics', async (t) => {
    let failInfo = false;
    const original = afipService._getAfipInstance;
    const originalError = console.error;
    console.error = () => {};
    afipService._getAfipInstance = async () => ({ ElectronicBilling: {
        getLastVoucher: async (pos, type) => {
            assert.deepEqual([pos, type], [3, 6]);
            return 12;
        },
        getVoucherInfo: async () => {
            if (failInfo) throw new Error('not found');
            return { ImpTotal: 10 };
        }
    } });
    t.after(() => {
        afipService._getAfipInstance = original;
        console.error = originalError;
    });
    assert.equal(await afipService.getLastVoucher('B', settings), 12);
    assert.deepEqual(await afipService.getVoucherInfo('B', 12, settings), { ImpTotal: 10 });
    failInfo = true;
    assert.equal(await afipService.getVoucherInfo('B', 99, settings), null);
});
