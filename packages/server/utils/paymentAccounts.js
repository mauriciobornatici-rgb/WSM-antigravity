// Ledger accounts for money in and out, by payment method. One map for every posting, so
// the "Caja Principal" account only holds what is physically in the cash drawer.
export const ACCOUNTS = Object.freeze({
    CASH: '1.1.01.01',
    TREASURY_CASH: '1.1.01.02',
    VAT_CREDIT_21: '1.1.05.02',
    BANK: '1.1.02.01',
    CHECKS_TO_DEPOSIT: '1.1.02.02',
    CARDS_TO_COLLECT: '1.1.02.03',
    RECEIVABLES: '1.1.03.01',
    INVENTORY: '1.1.04.01',
    SUPPLIERS: '2.1.01.01',
    // ADR-027: goods received and not yet invoiced by the supplier.
    GOODS_TO_INVOICE: '2.1.01.02',
    // ADR-018: the counterpart of stock that entered without a purchase (opening stock).
    OPENING_ADJUSTMENT: '3.1.03.01',
    // ADR-028: corrections of earlier fiscal years (RT 17, AREA), straight to equity.
    PRIOR_PERIOD_ADJUSTMENT: '3.1.02.02',
    // ADR-027: the change in value of the goods in stock when their cost changes.
    HOLDING_RESULT: '4.2.02.01',
    VAT_DEBIT_21: '2.1.02.02',
    SALES: '4.1.01.01',
    OTHER_INCOME: '4.2.01.01',
    COGS: '5.1.01.01',
    GENERAL_EXPENSES: '5.1.02.01',
    INVENTORY_LOSSES: '5.1.02.02',
    WARRANTY_COSTS: '5.1.02.03',
    BANK_FEES: '5.1.02.04',
    // ADR-016: tax on bank debits and credits, and withholdings / perceptions suffered.
    BANK_TAX: '5.1.02.05',
    WITHHOLDINGS: '1.1.05.04',
});

// Non-sellable locations used by the warranty flow (same names as StockLedger's list).
export const LOCATIONS = Object.freeze({
    QUARANTINE: 'Cuarentena',
    SUPPLIER_RETURNS: 'Devoluciones a Proveedores',
});

const CARD_METHODS = new Set(['card', 'debit_card', 'credit_card', 'qr', 'tarjeta', 'debito', 'credito', 'mercadopago']);
const BANK_METHODS = new Set(['transfer', 'bank', 'transferencia', 'banco', 'deposito']);
const CASH_METHODS = new Set(['cash', 'efectivo', 'caja']);
// "Caja 2": treasury cash outside the POS drawer (ADR-015).
const TREASURY_METHODS = new Set(['caja 2', 'caja2', 'treasury', 'efectivo caja 2', 'tesoreria', 'tesorería']);

const normalize = (method) => String(method || '').trim().toLowerCase();

// Where a customer payment lands.
export function receiptAccountFor(method) {
    const m = normalize(method);
    if (m === 'check' || m === 'cheque') return ACCOUNTS.CHECKS_TO_DEPOSIT;
    if (BANK_METHODS.has(m)) return ACCOUNTS.BANK;
    if (CARD_METHODS.has(m)) return ACCOUNTS.CARDS_TO_COLLECT;
    return ACCOUNTS.CASH;
}

// Where a payment to a supplier comes from. Only explicit cash leaves the drawer;
// transfers and own checks leave the bank; a third-party check leaves the checks portfolio.
export function disbursementAccountFor(method, { thirdPartyCheck = false } = {}) {
    const m = normalize(method);
    if ((m === 'check' || m === 'cheque') && thirdPartyCheck) return ACCOUNTS.CHECKS_TO_DEPOSIT;
    if (TREASURY_METHODS.has(m)) return ACCOUNTS.TREASURY_CASH;
    if (CASH_METHODS.has(m)) return ACCOUNTS.CASH;
    return ACCOUNTS.BANK;
}
