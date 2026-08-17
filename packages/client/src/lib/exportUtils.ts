/**
 * Utility functions for exporting data tables to CSV format compatible with Excel.
 */

export function convertToCSV<T extends Record<string, unknown>>(
    data: T[],
    headers: { key: keyof T; label: string }[]
): string {
    if (!data || data.length === 0) return "";

    const headerRow = headers.map(h => `"${String(h.label).replace(/"/g, '""')}"`).join(",");
    const bodyRows = data.map(row => {
        return headers.map(h => {
            const rawVal = row[h.key];
            if (rawVal === null || rawVal === undefined) return '""';
            if (typeof rawVal === "object") return `"${String(JSON.stringify(rawVal)).replace(/"/g, '""')}"`;
            return `"${String(rawVal).replace(/"/g, '""')}"`;
        }).join(",");
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
