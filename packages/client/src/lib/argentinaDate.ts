export function formatArgentinaDate(value?: string | null): string {
    const isoDate = String(value || "").slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

export function parseArgentinaDate(value: string): string | null {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value.trim());
    if (!match) return null;

    const day = Number(match[1]);
    const month = Number(match[2]);
    const yearPart = match[3] || "";
    const rawYear = Number(yearPart);
    const year = yearPart.length === 2 ? 2000 + rawYear : rawYear;
    const candidate = new Date(Date.UTC(year, month - 1, day));

    if (
        candidate.getUTCFullYear() !== year
        || candidate.getUTCMonth() !== month - 1
        || candidate.getUTCDate() !== day
    ) return null;

    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
