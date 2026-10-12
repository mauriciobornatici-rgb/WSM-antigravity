/**
 * Standard monetary formatter for Argentine Pesos ($ 000.000.000,00).
 */
export function formatMoney(amount: number | string | null | undefined): string {
    if (amount === null || amount === undefined) return "$ 0,00";
    const numeric = typeof amount === "number" ? amount : parseFloat(String(amount));
    if (isNaN(numeric)) return "$ 0,00";

    const absoluteVal = Math.abs(numeric);
    const formattedNumber = absoluteVal.toLocaleString("es-AR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });

    return numeric < 0 ? `-$ ${formattedNumber}` : `$ ${formattedNumber}`;
}
