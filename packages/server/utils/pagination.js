const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function toPositiveInt(value) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeInt(value) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getPagination(query = {}, options = {}) {
    const defaultLimit = Number(options.defaultLimit || DEFAULT_LIMIT);
    const maxLimit = Number(options.maxLimit || MAX_LIMIT);

    const hasPage = query.page !== undefined;
    const hasLimit = query.limit !== undefined;
    const hasOffset = query.offset !== undefined;
    const enabled = hasPage || hasLimit || hasOffset;

    if (!enabled) {
        return {
            enabled: false,
            page: 1,
            limit: defaultLimit,
            offset: 0
        };
    }

    const safeLimitRaw = toPositiveInt(query.limit) ?? defaultLimit;
    const safeLimit = Math.min(safeLimitRaw, maxLimit);
    const safePage = toPositiveInt(query.page) ?? 1;
    const safeOffset = toNonNegativeInt(query.offset);
    const offset = safeOffset ?? (safePage - 1) * safeLimit;

    return {
        enabled: true,
        page: safePage,
        limit: safeLimit,
        offset
    };
}

export function applyPaginationHeaders(res, pagination, total) {
    if (!pagination?.enabled) return;
    const currentPage = Number(pagination.page || 1);
    const currentLimit = Number(pagination.limit || 0);
    const totalCount = Number(total || 0);
    const totalPages = currentLimit > 0 ? Math.max(1, Math.ceil(totalCount / currentLimit)) : 1;

    res.setHeader('X-Total-Count', String(totalCount));
    res.setHeader('X-Page', String(currentPage));
    res.setHeader('X-Limit', String(currentLimit));
    res.setHeader('X-Total-Pages', String(totalPages));
}
