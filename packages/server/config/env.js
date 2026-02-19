const ALLOWED_NODE_ENVS = new Set(['development', 'staging', 'production']);

function parseBooleanEnv(name, defaultValue = false) {
    const raw = process.env[name];
    if (raw == null || raw === '') return defaultValue;

    const normalized = String(raw).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    throw new Error(`Invalid boolean value for ${name}: '${raw}'`);
}

function parsePortEnv(name, defaultValue) {
    const raw = process.env[name];
    const value = raw == null || raw === '' ? defaultValue : Number(raw);

    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
        throw new Error(`Invalid port value for ${name}: '${raw ?? defaultValue}'`);
    }
    return value;
}

function parsePositiveIntEnv(name, defaultValue) {
    const raw = process.env[name];
    if (raw == null || raw === '') return defaultValue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid positive integer for ${name}: '${raw}'`);
    }
    return value;
}

function parseCorsOrigins(raw, fallback = []) {
    const value = raw == null || raw === '' ? null : raw;
    if (!value) return fallback;
    return String(value)
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function parseTrustProxy(raw) {
    if (raw == null || raw === '') return undefined;

    const normalized = String(raw).trim().toLowerCase();
    if (normalized === 'true') return 1;
    if (normalized === 'false') return false;
    if (!Number.isNaN(Number(normalized))) return Number(normalized);
    return raw;
}

function isLocalhostOrigin(origin) {
    try {
        const url = new URL(origin);
        return ['localhost', '127.0.0.1'].includes(url.hostname);
    } catch {
        return false;
    }
}

let cachedConfig = null;

export function getEnvConfig() {
    if (cachedConfig) return cachedConfig;

    const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
    if (!ALLOWED_NODE_ENVS.has(nodeEnv)) {
        throw new Error(`Invalid NODE_ENV '${nodeEnv}'. Allowed: development, staging, production`);
    }

    const isDevelopment = nodeEnv === 'development';
    const isStaging = nodeEnv === 'staging';
    const isProduction = nodeEnv === 'production';
    const isNonDevelopment = isStaging || isProduction;

    const config = {
        nodeEnv,
        isDevelopment,
        isStaging,
        isProduction,
        isNonDevelopment,
        port: parsePortEnv('PORT', 3001),
        dbPort: parsePortEnv('DB_PORT', 3306),
        jwtSecret: process.env.JWT_SECRET || '',
        jwtExpiresIn: String(process.env.JWT_EXPIRES_IN || '8h').trim(),
        corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS, isDevelopment ? ['http://localhost:5173'] : []),
        trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
        dbSsl: parseBooleanEnv('DB_SSL', false),
        dbSslRejectUnauthorized: parseBooleanEnv('DB_SSL_REJECT_UNAUTHORIZED', true),
        allowInsecureNonDev: parseBooleanEnv('ALLOW_INSECURE_NON_DEV', false),
        apiRateLimitWindowMs: parsePositiveIntEnv('API_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
        apiRateLimitMax: parsePositiveIntEnv(
            'API_RATE_LIMIT_MAX',
            isDevelopment ? 1200 : isStaging ? 2000 : 500
        ),
        loginRateLimitWindowMs: parsePositiveIntEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
        loginRateLimitMax: parsePositiveIntEnv('LOGIN_RATE_LIMIT_MAX', 8)
    };

    const errors = [];
    const warnings = [];

    if (!config.jwtSecret) {
        errors.push('JWT_SECRET is required');
    }

    if (!config.jwtExpiresIn) {
        errors.push('JWT_EXPIRES_IN is required');
    }

    if (config.isNonDevelopment) {
        if (config.corsOrigins.length === 0) {
            errors.push('CORS_ORIGINS cannot be empty in staging/production');
        }

        if (!config.allowInsecureNonDev) {
            if (config.jwtSecret.length < 32) {
                errors.push('JWT_SECRET must be at least 32 chars in staging/production');
            }
            if (!config.dbSsl) {
                errors.push('DB_SSL must be true in staging/production');
            }
            if (config.dbSsl && !config.dbSslRejectUnauthorized) {
                errors.push('DB_SSL_REJECT_UNAUTHORIZED must be true in staging/production');
            }
            if (config.corsOrigins.includes('*')) {
                errors.push('CORS_ORIGINS cannot contain wildcard (*) in staging/production');
            }
        }

        if (config.corsOrigins.some((origin) => isLocalhostOrigin(origin))) {
            warnings.push('CORS_ORIGINS includes localhost in non-development environment');
        }

        if (config.trustProxy === false || config.trustProxy === undefined) {
            warnings.push('TRUST_PROXY is not enabled in non-development environment');
        }
    }

    if (warnings.length > 0) {
        warnings.forEach((warning) => console.warn(`[env-warning] ${warning}`));
    }

    if (errors.length > 0) {
        throw new Error(`Environment validation failed:\n- ${errors.join('\n- ')}`);
    }

    cachedConfig = config;
    return config;
}
