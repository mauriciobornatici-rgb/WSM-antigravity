/**
 * Utility functions for exporting data tables to CSV format compatible with Excel.
 */

// A text cell that starts like a formula (=, +, -, @, tab or return) would run as one when the
// file is opened in Excel: names, SKUs and notes come from people, so it is shown as text.
// Numbers are left alone (a negative balance stays a number).
function neutralizeFormula(value: string): string {
    return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function convertToCSV<T extends Record<string, unknown>>(
    data: T[],
    headers: { key: keyof T; label: string }[],
    // ";" opens in columns in Excel set to Spanish; "," is the default of the existing exports.
    { separator = "," }: { separator?: "," | ";" } = {}
): string {
    if (!data || data.length === 0) return "";

    const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const headerRow = headers.map(h => quote(String(h.label))).join(separator);
    const bodyRows = data.map(row => {
        return headers.map(h => {
            const rawVal = row[h.key];
            if (rawVal === null || rawVal === undefined) return '""';
            if (typeof rawVal === "object") return quote(neutralizeFormula(JSON.stringify(rawVal)));
            if (typeof rawVal === "number" || typeof rawVal === "boolean") return quote(String(rawVal));
            return quote(neutralizeFormula(String(rawVal)));
        }).join(separator);
    });

    return [headerRow, ...bodyRows].join("\r\n");
}

export function downloadCSV(filename: string, csvContent: string): void {
    if (typeof window === "undefined") return;

    // Add UTF-8 BOM byte order mark so Excel correctly decodes special characters (accents, ñ, etc.)
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.setAttribute("href", url);
    link.setAttribute("download", filename.endsWith(".csv") ? filename : `${filename}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
