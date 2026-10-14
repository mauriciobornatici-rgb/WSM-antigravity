import pool from '../config/db.js';
import auditService from './audit.service.js';
import { encrypt } from '../utils/crypto.js';

const DEFAULT_TAX_RATE = 0.21;
const DEFAULT_CURRENCY = 'ARS';

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

export function buildCompanySettingsResponse(data) {
    if (!data) {
        return {
            identity: { brand_name: '', legal_name: '', tax_id: '', logo_url: '' },
            contact: { phone: '', email: '', website: '' },
            address: { street: '', number: '', city: '', state: '', zip: '' },
            socials: { instagram: '', facebook: '', linkedin: '' },
            operation: { tax_rate: DEFAULT_TAX_RATE, default_currency: DEFAULT_CURRENCY },
            billing: { iibb: '', start_date: '', iva_condition: 'Responsable Inscripto', pos: 1, afip_crt: '', afip_key: '', afip_credentials_configured: false, afip_env: 'homologacion' },
            integrations: {
                tiendanube_access_token: '',
                tiendanube_access_token_configured: false,
                tiendanube_store_id: '',
                tiendanube_location_id: '',
                tiendanube_client_id: '',
                tiendanube_client_secret: '',
                tiendanube_client_secret_configured: false
            }
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
        },
        billing: {
            iibb: data.billing_iibb || '',
            start_date: data.billing_start_date || '',
            iva_condition: data.billing_iva_condition || 'Responsable Inscripto',
            pos: data.billing_pos || 1,
            afip_crt: '',
            afip_key: '',
            afip_credentials_configured: Boolean(data.billing_afip_crt && data.billing_afip_key),
            afip_env: data.billing_afip_env || 'homologacion'
        },
        integrations: {
            tiendanube_access_token: '',
            tiendanube_access_token_configured: Boolean(data.tiendanube_access_token),
            tiendanube_store_id: data.tiendanube_store_id || '',
            tiendanube_location_id: data.tiendanube_location_id || '',
            tiendanube_client_id: data.tiendanube_client_id || '',
            tiendanube_client_secret: '',
            tiendanube_client_secret_configured: Boolean(data.tiendanube_client_secret)
        }
    };
}

class SettingsService {
    async getCompanySettingsRow() {
        const [rows] = await pool.query('SELECT * FROM company_settings LIMIT 1');
        return rows[0] || null;
    }

    async getCompanyRecordForAfip() {
        const [compRows] = await pool.query('SELECT * FROM company_settings WHERE id = 1 LIMIT 1');
        return compRows[0] || {};
    }

    async updateCompanySettings({ body, actorId, ip }) {
        const { identity, contact, address, socials, operation, billing, integrations } = body;
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
        const [previousRows] = await connection.query('SELECT * FROM company_settings WHERE id = 1 LIMIT 1 FOR UPDATE');
        const previous = previousRows[0] || null;
        const safeTaxRate = operation?.tax_rate == null
            ? normalizeTaxRate(previous?.tax_rate)
            : normalizeTaxRate(operation.tax_rate);
        const safeCurrency = operation?.default_currency == null
            ? normalizeCurrency(previous?.default_currency)
            : normalizeCurrency(operation.default_currency);

        const safeAfipCrt = billing?.afip_crt?.trim() ? encrypt(billing.afip_crt.trim()) : previous?.billing_afip_crt;
        const safeAfipKey = billing?.afip_key?.trim() ? encrypt(billing.afip_key.trim()) : previous?.billing_afip_key;
        const safeTnToken = integrations?.tiendanube_access_token?.trim() ? encrypt(integrations.tiendanube_access_token.trim()) : previous?.tiendanube_access_token;
        const safeTnSecret = integrations?.tiendanube_client_secret?.trim() ? encrypt(integrations.tiendanube_client_secret.trim()) : previous?.tiendanube_client_secret;
        const safeTnStoreId = integrations?.tiendanube_store_id !== undefined ? (integrations.tiendanube_store_id || '') : previous?.tiendanube_store_id;
        const safeTnLocationId = integrations?.tiendanube_location_id !== undefined ? (integrations.tiendanube_location_id || '') : previous?.tiendanube_location_id;
        const safeTnClientId = integrations?.tiendanube_client_id !== undefined ? (integrations.tiendanube_client_id || '') : previous?.tiendanube_client_id;

        await connection.query(`
            INSERT INTO company_settings (
                id, brand_name, legal_name, tax_id, logo_url, 
                contact_phone, contact_email, contact_website, 
                address_street, address_city, 
                social_instagram, social_facebook, social_linkedin, 
                tax_rate, default_currency,
                billing_iibb, billing_start_date, billing_iva_condition, 
                billing_pos, billing_afip_crt, billing_afip_key, billing_afip_env,
                tiendanube_access_token, tiendanube_store_id, tiendanube_location_id, tiendanube_client_id, tiendanube_client_secret
            )
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                default_currency = VALUES(default_currency),
                billing_iibb = VALUES(billing_iibb),
                billing_start_date = VALUES(billing_start_date),
                billing_iva_condition = VALUES(billing_iva_condition),
                billing_pos = VALUES(billing_pos),
                billing_afip_crt = VALUES(billing_afip_crt),
                billing_afip_key = VALUES(billing_afip_key),
                billing_afip_env = VALUES(billing_afip_env),
                tiendanube_access_token = VALUES(tiendanube_access_token),
                tiendanube_store_id = VALUES(tiendanube_store_id),
                tiendanube_location_id = VALUES(tiendanube_location_id),
                tiendanube_client_id = VALUES(tiendanube_client_id),
                tiendanube_client_secret = VALUES(tiendanube_client_secret)
        `, [
            identity?.brand_name ?? previous?.brand_name, identity?.legal_name ?? previous?.legal_name, identity?.tax_id ?? previous?.tax_id, identity?.logo_url ?? previous?.logo_url,
            contact?.phone ?? previous?.contact_phone, contact?.email ?? previous?.contact_email, contact?.website ?? previous?.contact_website,
            address?.street ?? previous?.address_street, address?.city ?? previous?.address_city,
            socials?.instagram ?? previous?.social_instagram, socials?.facebook ?? previous?.social_facebook, socials?.linkedin ?? previous?.social_linkedin,
            safeTaxRate, safeCurrency,
            billing?.iibb ?? previous?.billing_iibb, billing?.start_date ?? previous?.billing_start_date, billing?.iva_condition ?? previous?.billing_iva_condition,
            billing?.pos || previous?.billing_pos || 1, safeAfipCrt, safeAfipKey, billing?.afip_env || previous?.billing_afip_env || 'homologacion',
            safeTnToken, safeTnStoreId, safeTnLocationId, safeTnClientId, safeTnSecret
        ]);

        // ADR-022 (user): the "no CAE after 24 h" alert counts only invoices issued once ARCA is
        // configured, so the moment the credentials are first complete is kept.
        await connection.query(
            `UPDATE company_settings SET arca_configured_at = NOW()
             WHERE id = 1 AND arca_configured_at IS NULL
               AND COALESCE(billing_afip_crt, '') <> '' AND COALESCE(billing_afip_key, '') <> ''`
        );

        const [updatedRows] = await connection.query('SELECT * FROM company_settings WHERE id = 1 LIMIT 1');
        await auditService.log({
            user_id: actorId || null,
            action: 'UPDATE_COMPANY_SETTINGS',
            entity_type: 'company_settings',
            entity_id: '1',
            old_values: buildCompanySettingsResponse(previousRows[0] || null),
            new_values: buildCompanySettingsResponse(updatedRows[0] || null),
            ip_address: ip
        }, connection);

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

export default new SettingsService();
