// The business runs on Argentine time, whatever the server's timezone (a cloud server usually
// runs in UTC, three hours ahead).
export const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

// The year that goes into document numbers (NC-2026-0001, PO-2026-001...). On 31 December at
// 22:00 in Buenos Aires it is already 1 January in UTC: the document still belongs to the
// year it was made in.
export function businessYear(now = new Date()) {
    return Number(new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE, year: 'numeric' }).format(now));
}
