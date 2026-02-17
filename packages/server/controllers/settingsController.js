import pool from '../config/db.js';
import catchAsync from '../utils/catchAsync.js';
import auditService from '../services/audit.service.js';

const DEFAULT_TAX_RATE = 0.21;
const DEFAULT_CURRENCY = 'ARS';

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip;
}

function normalizeTaxRate(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_TAX_RATE;
    if (parsed > 1) {
        return Math.min(1, Math.max(0, parsed / 100));
    }
    return Math.min(1, Math.max(0, parsed));
}

function normalizeCurrency(value) {
    if (typeof value !== 'string') return DEFAULT_CURRENCY;
    const trimmed = value.trim().toUpperCase();
    if (trimmed.length !== 3) return DEFAULT_CURRENCY;
    return trimmed;
}

function buildCompanySettingsResponse(data) {
    if (!data) {
        return {
            identity: { brand_name: '', legal_name: '', tax_id: '', logo_url: '' },
            contact: { phone: '', email: '', website: '' },
            address: { street: '', number: '', city: '', state: '', zip: '' },
            socials: { instagram: '', facebook: '', linkedin: '' },
            operation: { tax_rate: DEFAULT_TAX_RATE, default_currency: DEFAULT_CURRENCY }
        };
    }

    return {
        identity: {
            brand_name: data.brand_name || '',
            legal_name: data.legal_name || '',
            tax_id: data.tax_id || '',
            logo_url: data.logo_url || ''
        },
        contact: {
            phone: data.contact_phone || '',
            email: data.contact_email || '',
            website: data.contact_website || ''
        },
        address: {
            street: data.address_street || '',
            number: '',
            city: data.address_city || '',
            state: '',
            zip: ''
        },
        socials: {
            instagram: data.social_instagram || '',
            facebook: data.social_facebook || '',
            linkedin: data.social_linkedin || ''
        },
        operation: {
            tax_rate: normalizeTaxRate(data.tax_rate),
            default_currency: normalizeCurrency(data.default_currency)
        }
    };
}

export const getCompanySettings = catchAsync(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM company_settings LIMIT 1');
    const data = rows[0] || null;
    res.json(buildCompanySettingsResponse(data));
});

export const getCompanyPublicProfile = catchAsync(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM company_settings LIMIT 1');
    const data = rows[0] || null;
    const payload = buildCompanySettingsResponse(data);
    res.json(payload);
});

export const updateCompanySettings = catchAsync(async (req, res) => {
    const { identity, contact, address, socials, operation } = req.body;
    const [previousRows] = await pool.query('SELECT * FROM company_settings WHERE id = 1 LIMIT 1');
    const previous = previousRows[0] || null;
    const safeTaxRate = operation?.tax_rate == null
        ? normalizeTaxRate(previous?.tax_rate)
        : normalizeTaxRate(operation.tax_rate);
    const safeCurrency = operation?.default_currency == null
        ? normalizeCurrency(previous?.default_currency)
        : normalizeCurrency(operation.default_currency);

    await pool.query(`
        INSERT INTO company_settings (id, brand_name, legal_name, tax_id, logo_url, contact_phone, contact_email, contact_website, address_street, address_city, social_instagram, social_facebook, social_linkedin, tax_rate, default_currency)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
            brand_name = VALUES(brand_name),
            legal_name = VALUES(legal_name),
            tax_id = VALUES(tax_id),
            logo_url = VALUES(logo_url),
            contact_phone = VALUES(contact_phone),
            contact_email = VALUES(contact_email),
            contact_website = VALUES(contact_website),
            address_street = VALUES(address_street),
            address_city = VALUES(address_city),
            social_instagram = VALUES(social_instagram),
            social_facebook = VALUES(social_facebook),
            social_linkedin = VALUES(social_linkedin),
            tax_rate = VALUES(tax_rate),
            default_currency = VALUES(default_currency)
    `, [
        identity?.brand_name, identity?.legal_name, identity?.tax_id, identity?.logo_url,
        contact?.phone, contact?.email, contact?.website,
        address?.street, address?.city,
        socials?.instagram, socials?.facebook, socials?.linkedin,
        safeTaxRate, safeCurrency
    ]);

    const [updatedRows] = await pool.query('SELECT * FROM company_settings WHERE id = 1 LIMIT 1');
    await auditService.log({
        user_id: req.user?.id || null,
        action: 'UPDATE_COMPANY_SETTINGS',
        entity_type: 'company_settings',
        entity_id: '1',
        old_values: previousRows[0] || null,
        new_values: updatedRows[0] || req.body,
        ip_address: getRequestIp(req)
    });

    res.json({ success: true });
});

export const getAuditLogs = catchAsync(async (req, res) => {
    const filters = req.query;
    const logs = await auditService.getLogs(filters);
    res.json(logs);
});
