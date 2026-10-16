// Character classes built from code points (an editor or a tool can turn escapes into the
// invisible characters themselves, which the linter rightly refuses).
const chars = (...codes) => codes.map((code) => String.fromCharCode(code)).join('');
// Dashes a CUIT pasted from a document or a spreadsheet often brings: hyphen, figure dash,
// en dash, em dash, horizontal bar, minus, small and full-width hyphen-minus.
const LOOKALIKE_DASHES = new RegExp(`[${chars(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212, 0xFE58, 0xFE63, 0xFF0D)}]`, 'g');
// Invisible characters that also travel in a paste: soft hyphen, zero-width space and
// joiners, word joiner, byte order mark.
const INVISIBLE = new RegExp(`[${chars(0x00AD, 0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF)}]`, 'g');

// A CUIT/DNI as typed, cleaned of what a paste can bring: full-width digits become normal
// ones (NFKC), any dash becomes "-", invisible characters go away. Empty means none (a blank
// field is not a duplicate of every other blank one).
export function normalizeTaxId(taxId) {
    const value = taxId == null
        ? ''
        : String(taxId).normalize('NFKC').replace(INVISIBLE, '').replace(LOOKALIKE_DASHES, '-').trim();
    return value || null;
}

// The same CUIT written with or without dashes, dots, spaces or slashes is the same person:
// "20-12345678-9" and "20123456789" collide. Must match taxIdKeySql (stored values are
// already normalized by normalizeTaxId).
export function taxIdKey(taxId) {
    return String(normalizeTaxId(taxId) ?? '').replace(/[ .\-/]/g, '').toUpperCase();
}

// The same key computed in MySQL (plain REPLACE works on every version; the collation already
// ignores case).
export function taxIdKeySql(column = 'tax_id') {
    return `REPLACE(REPLACE(REPLACE(REPLACE(${column}, '-', ''), '.', ''), ' ', ''), '/', '')`;
}
