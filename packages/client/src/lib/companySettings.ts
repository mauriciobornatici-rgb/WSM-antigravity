import { api } from "@/services/api";
import type { CompanySettings } from "@/types";

const DEFAULT_TAX_RATE = 0.21;
const DEFAULT_CURRENCY = "ARS";

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = {
    identity: { brand_name: "", legal_name: "", tax_id: "", logo_url: "" },
    contact: { phone: "", email: "", website: "" },
    address: { street: "", number: "", city: "", state: "", zip: "" },
    socials: { instagram: "", facebook: "", linkedin: "" },
    operation: { tax_rate: DEFAULT_TAX_RATE, default_currency: DEFAULT_CURRENCY },
};

function toSafeText(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeTaxRate(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_TAX_RATE;
    const normalized = parsed > 1 ? parsed / 100 : parsed;
    return Math.min(1, Math.max(0, normalized));
}

function normalizeCurrency(value: unknown): string {
    const text = toSafeText(value).toUpperCase();
    if (text.length !== 3) return DEFAULT_CURRENCY;
    return text;
}

export function normalizeCompanySettings(input?: Partial<CompanySettings> | null): CompanySettings {
    return {
        identity: {
            brand_name: toSafeText(input?.identity?.brand_name),
            legal_name: toSafeText(input?.identity?.legal_name),
            tax_id: toSafeText(input?.identity?.tax_id),
            logo_url: toSafeText(input?.identity?.logo_url),
        },
        contact: {
            phone: toSafeText(input?.contact?.phone),
            email: toSafeText(input?.contact?.email),
            website: toSafeText(input?.contact?.website),
        },
        address: {
            street: toSafeText(input?.address?.street),
            number: toSafeText(input?.address?.number),
            city: toSafeText(input?.address?.city),
            state: toSafeText(input?.address?.state),
            zip: toSafeText(input?.address?.zip),
        },
        socials: {
            instagram: toSafeText(input?.socials?.instagram),
            facebook: toSafeText(input?.socials?.facebook),
            linkedin: toSafeText(input?.socials?.linkedin),
        },
        operation: {
            tax_rate: normalizeTaxRate(input?.operation?.tax_rate),
            default_currency: normalizeCurrency(input?.operation?.default_currency),
        },
    };
}

export async function fetchCompanySettingsSafe(): Promise<CompanySettings> {
    try {
        const settings = await api.getCompanyPublicProfile();
        return normalizeCompanySettings(settings);
    } catch {
        try {
            const settings = await api.getCompanySettings();
            return normalizeCompanySettings(settings);
        } catch {
            return normalizeCompanySettings();
        }
    }
}

export function getCompanyDisplayName(settings: CompanySettings): string {
    return settings.identity.legal_name || settings.identity.brand_name || "Empresa";
}

export function getCompanyAddressLine(settings: CompanySettings): string {
    const parts = [
        settings.address.street,
        settings.address.number,
        settings.address.city,
    ].filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(", ") : "Domicilio no informado";
}

export function getTaxRatePercentage(settings: CompanySettings): number {
    return Number((normalizeTaxRate(settings.operation.tax_rate) * 100).toFixed(2));
}
