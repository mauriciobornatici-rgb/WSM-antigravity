// Reading the cells of an imported spreadsheet row. Excel sends numbers as numbers, but a CSV or a
// cell typed as text sends "1.234,56" (Argentina), "1234.56" or "$ 12.100": all of them are read
// the way a person in Argentina means them.

// A cell as text: trimmed, empty means missing. Whole numbers keep every digit (a barcode read
// as a number never turns into 7.79e+12).
export function cellText(value) {
    if (value == null || typeof value === 'boolean') return null;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return null;
        return Number.isInteger(value) ? BigInt(Math.trunc(value)).toString() : String(value);
    }
    const text = String(value).replace(/\s+/g, ' ').trim();
    return text || null;
}

/**
 * A decimal number from a cell. Returns { value } (null when empty) or { error }.
 * With both "." and "," the last one is the decimal mark. A single "," is decimal. A single "."
 * followed by exactly three digits is a thousands mark ("12.500" = 12500) unless the number
 * starts with 0 ("0.125" is a decimal: a thousands group never follows a 0); otherwise decimal
 * ("10.5", "2.5").
 */
export function cellDecimal(value) {
    if (value == null || value === '') return { value: null };
    if (typeof value === 'number') return Number.isFinite(value) ? { value } : { error: 'no es un número' };
    if (typeof value === 'boolean') return { error: 'no es un número' };
    let text = String(value).replace(/[$\s]/g, '').replace(/^ARS/i, '');
    if (text === '') return { value: null };
    const negative = text.startsWith('-');
    if (negative) text = text.slice(1);
    if (!/^[\d.,]+$/.test(text)) return { error: 'no es un número' };
    const lastDot = text.lastIndexOf('.');
    const lastComma = text.lastIndexOf(',');
    let normalized;
    if (lastDot >= 0 && lastComma >= 0) {
        const decimalMark = lastDot > lastComma ? '.' : ',';
        const thousandsMark = decimalMark === '.' ? ',' : '.';
        normalized = text.split(thousandsMark).join('').replace(decimalMark, '.');
    } else if (lastComma >= 0) {
        normalized = (text.match(/,/g).length > 1) ? text.split(',').join('') : text.replace(',', '.');
    } else if (lastDot >= 0) {
        const dots = text.match(/\./g).length;
        normalized = (dots > 1 || /^[1-9]\d{0,2}\.\d{3}$/.test(text)) ? text.split('.').join('') : text;
    } else {
        normalized = text;
    }
    if (!/^\d+(\.\d+)?$/.test(normalized)) return { error: 'no es un número' };
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return { error: 'no es un número' };
    return { value: negative ? -parsed : parsed };
}

// Text without accents, case or extra spaces: to compare headers and names people type.
export function plainText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9%/ ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// A code (SKU) as the database compares it (utf8mb4_unicode_ci ignores case and accents):
// "CAMISÓN-M" and "camison-m" are the same product.
export function codeKey(value) {
    return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(value) {
    return EMAIL.test(String(value || ''));
}

// Collects the problems of one row, with the column name the person sees in the template.
export class RowIssues {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    error(message) { this.errors.push(message); }

    warn(message) { this.warnings.push(message); }

    // `max` keeps the value inside its column (a bigger one would fail the whole batch);
    // `decimals` rounds as the column stores it, so what is saved and what is posted match.
    decimal(value, header, { min = 0, max = 1e12, integer = false, decimals = null } = {}) {
        const parsed = cellDecimal(value);
        if (parsed.error) {
            this.error(`${header}: ${parsed.error} ("${cellText(value)}").`);
            return null;
        }
        if (parsed.value == null) return null;
        if (parsed.value < min) {
            this.error(`${header}: no puede ser menor que ${min}.`);
            return null;
        }
        if (parsed.value > max) {
            this.error(`${header}: ${parsed.value} es demasiado grande (máximo ${max.toLocaleString('es-AR')}).`);
            return null;
        }
        if (integer && !Number.isInteger(parsed.value)) {
            this.error(`${header}: tiene que ser un número entero.`);
            return null;
        }
        if (decimals != null) {
            const factor = 10 ** decimals;
            return Math.round((parsed.value + Number.EPSILON) * factor) / factor;
        }
        return parsed.value;
    }

    text(value, header, max) {
        const text = cellText(value);
        if (text && text.length > max) {
            this.error(`${header}: admite hasta ${max} caracteres.`);
            return null;
        }
        return text;
    }
}

// Totals of the per-row results, for the screen.
export function summarize(results) {
    const summary = { create: 0, update: 0, skip: 0, error: 0 };
    for (const result of results) summary[result.action] += 1;
    return summary;
}
