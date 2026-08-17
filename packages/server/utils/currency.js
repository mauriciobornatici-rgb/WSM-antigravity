/**
 * Formats numeric monetary amounts into Argentine Peso format:
 * $ 000.000.000,00
 *
 * @param {number|string|null|undefined} amount
 * @returns {string}
 */
export function formatMoney(amount) {
    const num = Number(amount || 0);
    if (isNaN(num)) return "$ 0,00";

    const parts = num.toFixed(2).split(".");
    const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const decimalPart = parts[1];

    return `$ ${integerPart},${decimalPart}`;
}

export default {
    formatMoney
};
