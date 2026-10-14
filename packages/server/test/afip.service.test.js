import test from 'node:test';
import assert from 'node:assert/strict';

import afipService, {
    arcaToday,
    associatedVoucherMatches,
    buildVoucherAmounts,
    isArcaRejection,
    voucherMatchesRequest,
} from '../services/afip.service.js';

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

function useFakeSdk(t, electronicBilling) {
    const original = afipService._getAfipInstance;
    afipService._getAfipInstance = async () => ({ ElectronicBilling: electronicBilling });
    t.after(() => { afipService._getAfipInstance = original; });
}

test('_getAfipInstance builds a new SDK instance when the certificate is renewed', async (t) => {
    afipService.instances.clear();
    t.after(() => afipService.instances.clear());
    const first = await afipService._getAfipInstance(settings);
    const renewed = await afipService._getAfipInstance({ ...settings, billing_afip_crt: 'renewed-certificate' });
    assert.notEqual(renewed, first);
    assert.equal(afipService.instances.size, 2);
    // The same certificate keeps hitting the cache.
    assert.equal(await afipService._getAfipInstance({ ...settings, billing_afip_crt: 'renewed-certificate' }), renewed);
    assert.equal(afipService.instances.size, 2);
});

test('buildRequest prepares Factura A, B and C requests before asking ARCA for a number', () => {
    const a = afipService.buildRequest(
        { invoice_type: 'A', client_tax_id: '20-12345678-9' },
        [
            { quantity: 2, unit_price: 121, vat_rate: 21 },
            { quantity: 1, unit_price: 110.5, vat_rate: 10.5 }
        ],
        settings
    );
    assert.equal(a.pos, 3);
    assert.equal(a.voucherType, 1);
    assert.equal(a.docType, 80);
    assert.equal(a.docNumber, 20123456789);
    assert.equal(a.associated, null);
    // Catalog prices are net (ADR-008): 2 x 121 + 21 % and 1 x 110.5 + 10.5 %.
    assert.deepEqual(a.amounts, {
        roundedTotal: 414.92,
        roundedNet: 352.5,
        roundedVat: 62.42,
        ivaArray: [
            { Id: 5, BaseImp: 242, Importe: 50.82 },
            { Id: 4, BaseImp: 110.5, Importe: 11.6 },
        ],
    });

    const b = afipService.buildRequest({ invoice_type: 'B' }, [{ quantity: 1, unit_price: 121 }], settings);
    assert.equal(b.voucherType, 6);
    assert.equal(b.docType, 99);
    assert.equal(b.docNumber, 0);
    assert.equal(b.amounts.ivaArray[0].Id, 5);

    const c = afipService.buildRequest({ invoice_type: 'C' }, [{ quantity: 1, unit_price: 100, vat_rate: 0 }], settings);
    assert.equal(c.voucherType, 11);
    assert.deepEqual(c.amounts.ivaArray, []);
    // The point of sale defaults to 1.
    assert.equal(afipService.pointOfSale({}), 1);
});

test('buildRequest refuses a Factura A or NC A without a customer CUIT, and keeps the associated invoice', () => {
    for (const invoice_type of ['A', 'NC_A']) {
        for (const client_tax_id of [undefined, '12345678', '20-1234']) {
            assert.throws(
                () => afipService.buildRequest({ invoice_type, client_tax_id }, [{ quantity: 1, unit_price: 1 }], settings),
                (error) => error.statusCode === 400 && error.errorCode === 'ARCA_CUIT_REQUIRED'
            );
        }
    }
    const associated = { invoice_type: 'B', point_of_sale: 3, invoice_number: 10 };
    const note = afipService.buildRequest(
        { invoice_type: 'NC_B', client_tax_id: '12345678', associated_voucher: associated },
        [{ quantity: 1, unit_price: 10 }],
        settings
    );
    assert.equal(note.voucherType, 8);
    assert.equal(note.docType, 96);
    assert.equal(note.associated, associated);
});

test('requestCae sends the exact number and date and maps the answer', async (t) => {
    let payload;
    useFakeSdk(t, { createVoucher: async (value) => { payload = value; return { CAE: 'CAE-1', CAEFchVto: '20260930' }; } });
    const request = afipService.buildRequest(
        { invoice_type: 'A', client_tax_id: '20-12345678-9' },
        [{ quantity: 1, unit_price: 100, vat_rate: 21 }],
        settings
    );
    const result = await afipService.requestCae(request, 42, 20260930, settings);
    assert.deepEqual(result, { cae: 'CAE-1', cae_expiration_date: '2026-09-30', number: 42 });
    assert.equal(payload.PtoVta, 3);
    assert.equal(payload.CbteTipo, 1);
    assert.equal(payload.CbteDesde, 42);
    assert.equal(payload.CbteHasta, 42);
    assert.equal(payload.CbteFch, 20260930);
    assert.equal(payload.ImpTotal, 121);
    assert.equal(payload.ImpNeto, 100);
    assert.equal(payload.ImpIVA, 21);
    assert.deepEqual(payload.Iva, [{ Id: 5, BaseImp: 100, Importe: 21 }]);
    assert.equal('CbtesAsoc' in payload, false);
});

test('requestCae omits Iva for Factura C and names the corrected invoice on a credit note', async (t) => {
    const payloads = [];
    useFakeSdk(t, { createVoucher: async (value) => { payloads.push(value); return { CAE: 'X', CAEFchVto: 'bad' }; } });
    const c = afipService.buildRequest({ invoice_type: 'C' }, [{ quantity: 1, unit_price: 100, vat_rate: 0 }], settings);
    const resultC = await afipService.requestCae(c, 1, 20261001, settings);
    assert.equal('Iva' in payloads[0], false);
    assert.equal(payloads[0].CbteTipo, 11);
    assert.equal(resultC.cae_expiration_date, null);

    const note = afipService.buildRequest(
        {
            invoice_type: 'NC_A',
            client_tax_id: '20123456789',
            associated_voucher: { invoice_type: 'A', point_of_sale: '3', invoice_number: '10' }
        },
        [{ quantity: 1, unit_price: 100, vat_rate: 21 }],
        settings
    );
    await afipService.requestCae(note, 5, 20261001, settings);
    assert.equal(payloads[1].CbteTipo, 3);
    assert.deepEqual(payloads[1].CbtesAsoc, [{ Tipo: 1, PtoVta: 3, Nro: 10 }]);
});

test('requestCae lets SDK failures through untouched so the caller can tell rejections apart', async (t) => {
    const failure = new Error('sin servicio');
    useFakeSdk(t, { createVoucher: async () => { throw failure; } });
    const request = afipService.buildRequest({ invoice_type: 'B' }, [{ quantity: 1, unit_price: 1 }], settings);
    await assert.rejects(() => afipService.requestCae(request, 1, 20261001, settings), (error) => error === failure);
});

test('lastVoucherNumber asks the SDK for the point of sale and voucher type', async (t) => {
    let answer = 12;
    useFakeSdk(t, {
        getLastVoucher: async (pos, type) => {
            assert.deepEqual([pos, type], [3, 6]);
            return answer;
        }
    });
    const request = afipService.buildRequest({ invoice_type: 'B' }, [{ quantity: 1, unit_price: 1 }], settings);
    assert.equal(await afipService.lastVoucherNumber(request, settings), 12);
    answer = undefined;
    assert.equal(await afipService.lastVoucherNumber(request, settings), 0);
});

test('voucherAt returns the voucher, null when ARCA has none, and propagates any other failure', async (t) => {
    let mode = 'found';
    const failure = new Error('timeout');
    useFakeSdk(t, {
        getVoucherInfo: async (number, pos, type) => {
            assert.deepEqual([number, pos, type], [7, 3, 6]);
            if (mode === 'error') throw failure;
            return mode === 'found' ? { ImpTotal: 10 } : null;
        }
    });
    const request = afipService.buildRequest({ invoice_type: 'B' }, [{ quantity: 1, unit_price: 1 }], settings);
    assert.deepEqual(await afipService.voucherAt(request, 7, settings), { ImpTotal: 10 });
    mode = 'none';
    assert.equal(await afipService.voucherAt(request, 7, settings), null);
    mode = 'error';
    await assert.rejects(() => afipService.voucherAt(request, 7, settings), (error) => error === failure);
});

test('isArcaRejection tells ARCA refusals from lost answers', () => {
    class AfipWebServiceError extends Error {}
    assert.equal(isArcaRejection(new AfipWebServiceError('refused')), true);
    assert.equal(isArcaRejection(Object.assign(new Error('refused'), { code: 10016 })), true);
    assert.equal(isArcaRejection(Object.assign(new Error('refused'), { code: '10016' })), true);
    assert.equal(isArcaRejection(Object.assign(new Error('reset'), { code: 'ECONNRESET' })), false);
    assert.equal(isArcaRejection(new Error('plain')), false);
    assert.equal(isArcaRejection(null), false);
    assert.equal(isArcaRejection(undefined), false);
});

test('arcaToday gives the Argentine calendar date whatever the server timezone', () => {
    assert.equal(arcaToday(new Date('2026-10-12T15:00:00Z')), 20261012);
    // 01:30 UTC is still the previous evening in Buenos Aires (UTC-3).
    assert.equal(arcaToday(new Date('2026-10-13T01:30:00Z')), 20261012);
    assert.equal(arcaToday(new Date('2027-01-01T02:59:00Z')), 20261231);
    assert.equal(typeof arcaToday(), 'number');
});

test('voucherMatchesRequest only adopts a voucher with the same type, total, customer, date and invoice', () => {
    const request = {
        voucherType: 6,
        docType: 96,
        docNumber: 12345678,
        amounts: { roundedTotal: 121 },
        associated: null,
    };
    const info = { CbteTipo: 6, ImpTotal: 121, DocTipo: 96, DocNro: 12345678, CbteFch: '20261012' };
    assert.equal(voucherMatchesRequest(info, request, 20261012), true);
    // No saved date: the date is not compared.
    assert.equal(voucherMatchesRequest({ ...info, CbteFch: '20250101' }, request, null), true);
    assert.equal(voucherMatchesRequest(null, request, 20261012), false);
    assert.equal(voucherMatchesRequest({ ...info, CbteTipo: 1 }, request, 20261012), false);
    assert.equal(voucherMatchesRequest({ ...info, ImpTotal: 121.01 }, request, 20261012), false);
    assert.equal(voucherMatchesRequest({ ...info, DocTipo: 80 }, request, 20261012), false);
    assert.equal(voucherMatchesRequest({ ...info, DocNro: 1 }, request, 20261012), false);
    assert.equal(voucherMatchesRequest({ ...info, CbteFch: '20261011' }, request, 20261012), false);

    const note = { ...request, voucherType: 8, associated: { point_of_sale: 3, invoice_number: 10 } };
    const noteInfo = { ...info, CbteTipo: 8 };
    assert.equal(voucherMatchesRequest(noteInfo, note, 20261012), false);
    assert.equal(
        voucherMatchesRequest({ ...noteInfo, CbtesAsoc: { CbteAsoc: [{ PtoVta: 3, Nro: 10 }] } }, note, 20261012),
        true
    );
    assert.equal(
        voucherMatchesRequest({ ...noteInfo, CbtesAsoc: [{ PtoVta: 3, Nro: 11 }] }, note, 20261012),
        false
    );
});

test('associatedVoucherMatches accepts one voucher or a list and rejects unknown shapes', () => {
    const associated = { point_of_sale: 3, invoice_number: '10' };
    assert.equal(associatedVoucherMatches({ CbtesAsoc: { CbteAsoc: { PtoVta: 3, Nro: 10 } } }, associated), true);
    assert.equal(associatedVoucherMatches({ CbtesAsoc: [{ PtoVta: 4, Nro: 10 }, { PtoVta: 3, Nro: 10 }] }, associated), true);
    assert.equal(associatedVoucherMatches({}, associated), false);
    assert.equal(associatedVoucherMatches(null, associated), false);
});
test('RG 5616: the customer VAT condition comes from the invoice, and a Factura A goes to a Responsable Inscripto', async () => {
    const { receiverVatCondition } = await import('../services/afip.service.js');
    assert.equal(receiverVatCondition(6, 'Consumidor Final'), 5);
    assert.equal(receiverVatCondition(6, 'Exento'), 4);
    assert.equal(receiverVatCondition(11, 'Responsable Monotributo'), 6);
    assert.equal(receiverVatCondition(8, null), 5);
    assert.equal(receiverVatCondition(1, 'Consumidor Final'), 1, 'A: the default snapshot is not a valid receiver');
    assert.equal(receiverVatCondition(3, 'Monotributista'), 6);
    assert.equal(receiverVatCondition(1, 'IVA Responsable Inscripto'), 1);
    assert.equal(receiverVatCondition(6, 'Sujeto No Categorizado'), 7);
});
