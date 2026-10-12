export const AUTH_COOKIE_NAME = 'wsm_session';

export function getCookieValue(cookieHeader, name = AUTH_COOKIE_NAME) {
    if (!cookieHeader) return null;
    for (const part of String(cookieHeader).split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0) continue;
        const key = part.slice(0, separator).trim();
        if (key !== name) continue;
        try {
            return decodeURIComponent(part.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }
    return null;
}

export function sessionCookie(token, { secure = false } = {}) {
    return [
        `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/api',
        'HttpOnly',
        'SameSite=Strict',
        ...(secure ? ['Secure'] : []),
    ].join('; ');
}

export function expiredSessionCookie({ secure = false } = {}) {
    return [
        `${AUTH_COOKIE_NAME}=`,
        'Path=/api',
        'HttpOnly',
        'SameSite=Strict',
        'Max-Age=0',
        ...(secure ? ['Secure'] : []),
    ].join('; ');
}

export function isTrustedCookieRequest(method, origin, allowedOrigins) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())) return true;
    return Boolean(origin && allowedOrigins.includes(origin));
}
