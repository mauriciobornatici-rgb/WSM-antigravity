import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';
import settingsService, { buildCompanySettingsResponse } from '../services/settings.service.js';
import getRequestIp from '../utils/requestIp.js';
import { applyPaginationHeaders, getPagination } from '../utils/pagination.js';
import afipService from '../services/afip.service.js';

export { buildCompanySettingsResponse };

export const getCompanySettings = catchAsync(async (req, res) => {
    const data = await settingsService.getCompanySettingsRow();
    res.json(buildCompanySettingsResponse(data));
});

export const getCompanyPublicProfile = catchAsync(async (req, res) => {
    const data = await settingsService.getCompanySettingsRow();
    const payload = buildCompanySettingsResponse(data);
    res.json(payload);
});

export const updateCompanySettings = catchAsync(async (req, res) => {
    await settingsService.updateCompanySettings({
        body: req.body,
        actorId: req.user?.id,
        ip: getRequestIp(req)
    });
    res.json({ success: true });
});
export const getAuditLogs = catchAsync(async (req, res) => {
    const { entity_type, entity_id } = req.query;
    const filters = {
        ...(entity_type ? { entity_type } : {}),
        ...(entity_id ? { entity_id } : {})
    };

    const pagination = getPagination(req.query, { defaultLimit: 100, maxLimit: 500 });
    if (!pagination.enabled) {
        const logs = await auditService.getLogs(filters);
        return res.json(logs);
    }

    const result = await auditService.getLogs(filters, {
        limit: pagination.limit,
        offset: pagination.offset,
        includeTotal: true
    });
    applyPaginationHeaders(res, pagination, result.total);
    res.json(result.rows);
});

export const testAfipConnection = catchAsync(async (req, res) => {

    const company = await settingsService.getCompanyRecordForAfip();
    const cuit = company.tax_id || '';

    const pos = Number(company.billing_pos || 0);
    const environment = company.billing_afip_env || 'homologacion';
    const logs = [`[ARCA] Iniciando verificación real en ${environment.toUpperCase()}.`];

    if (!cuit || !Number.isInteger(pos) || pos <= 0 || !company.billing_afip_crt || !company.billing_afip_key) {
        return res.status(422).json({
            success: false,
            logs: [...logs, '[ERROR] CUIT, punto de venta, certificado o clave privada no están configurados.']
        });
    }

    try {
        const lastVoucherNumber = await afipService.getLastVoucher('A', {
            identity: { tax_id: cuit },
            billing_pos: pos,
            billing_afip_env: environment,
            billing_afip_crt: company.billing_afip_crt,
            billing_afip_key: company.billing_afip_key
        });
        logs.push(`[OK] ARCA respondió correctamente. Última Factura A autorizada en PV ${pos}: ${lastVoucherNumber}.`);
        res.json({ success: true, logs, nextVoucherNumber: Number(lastVoucherNumber) + 1 });
    } catch (error) {
        console.error('[ARCA connection test] Failed:', error);
        res.status(502).json({
            success: false,
            logs: [...logs, '[ERROR] ARCA no pudo validar las credenciales o no respondió.'],
            message: 'No fue posible verificar la conexión con ARCA.'
        });
    }
});
