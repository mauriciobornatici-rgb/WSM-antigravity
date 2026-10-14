/** Margins are computed on NET prices and costs (ADR-015): VAT is neither margin nor cost. */
export interface ProductAnalyticsInput {
    id: string;
    name: string;
    sku?: string | null;
    cost_price?: number | string | null;
    sale_price?: number | string | null;
    stock_current?: number | string | null;
    category?: string | null;
}

function toNonNegativeNumber(value: number | string | null | undefined): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export type ABCClass = "A" | "B" | "C";

export interface AnalyzedProduct extends ProductAnalyticsInput {
    numericCost: number;
    numericPrice: number;
    numericStock: number;
    stockValue: number; // cost * stock
    grossMarginAmount: number; // price - cost
    grossMarginPercent: number; // (price - cost) / price * 100
    markupPercent: number; // (price - cost) / cost * 100
    abcClass: ABCClass;
    cumulativeSharePercent: number;
}

export interface InventoryValuationSummary {
    totalProductsCount: number;
    totalStockUnits: number;
    totalValuationCost: number;
    totalValuationSale: number;
    potentialProfit: number;
    averageMarginPercent: number;
    classACount: number;
    classBCount: number;
    classCCount: number;
}

export function calculateGrossMargin(cost: number, price: number): { amount: number; marginPercent: number; markupPercent: number } {
    const validCost = toNonNegativeNumber(cost);
    const validPrice = toNonNegativeNumber(price);
    const amount = validPrice - validCost;

    const marginPercent = validPrice > 0 ? Math.round(((amount / validPrice) * 100 + Number.EPSILON) * 100) / 100 : 0;
    const markupPercent = validCost > 0 ? Math.round(((amount / validCost) * 100 + Number.EPSILON) * 100) / 100 : 0;

    return { amount: Math.round((amount + Number.EPSILON) * 100) / 100, marginPercent, markupPercent };
}

export function analyzeInventoryABC(products: ProductAnalyticsInput[]): {
    items: AnalyzedProduct[];
    summary: InventoryValuationSummary;
} {
    if (!products || products.length === 0) {
        return {
            items: [],
            summary: {
                totalProductsCount: 0,
                totalStockUnits: 0,
                totalValuationCost: 0,
                totalValuationSale: 0,
                potentialProfit: 0,
                averageMarginPercent: 0,
                classACount: 0,
                classBCount: 0,
                classCCount: 0,
            },
        };
    }

    const normalized = products.map((p) => {
        const numericCost = toNonNegativeNumber(p.cost_price);
        const numericPrice = toNonNegativeNumber(p.sale_price);
        const numericStock = toNonNegativeNumber(p.stock_current);
        const stockValue = Math.round((numericCost * numericStock + Number.EPSILON) * 100) / 100;
        const { amount, marginPercent, markupPercent } = calculateGrossMargin(numericCost, numericPrice);

        return {
            ...p,
            numericCost,
            numericPrice,
            numericStock,
            stockValue,
            grossMarginAmount: amount,
            grossMarginPercent: marginPercent,
            markupPercent,
            abcClass: "C" as ABCClass,
            cumulativeSharePercent: 0,
        };
    });

    // Sort descending by stock value (cost * stock) for Pareto calculation
    normalized.sort((a, b) => b.stockValue - a.stockValue);

    const totalValuationCost = normalized.reduce((acc, i) => acc + i.stockValue, 0);
    const totalValuationSale = normalized.reduce((acc, i) => acc + (i.numericPrice * i.numericStock), 0);
    const totalStockUnits = normalized.reduce((acc, i) => acc + i.numericStock, 0);

    let cumulativeValue = 0;
    let classACount = 0;
    let classBCount = 0;
    let classCCount = 0;

    for (const item of normalized) {
        cumulativeValue += item.stockValue;
        const sharePercent = totalValuationCost > 0
            ? Math.round(((cumulativeValue / totalValuationCost) * 100 + Number.EPSILON) * 100) / 100
            : 0;

        item.cumulativeSharePercent = sharePercent;

        if (totalValuationCost > 0 && (sharePercent <= 80 || classACount === 0)) {
            item.abcClass = "A";
            classACount++;
        } else if (totalValuationCost > 0 && sharePercent <= 95) {
            item.abcClass = "B";
            classBCount++;
        } else {
            item.abcClass = "C";
            classCCount++;
        }
    }

    const potentialProfit = Math.round((totalValuationSale - totalValuationCost + Number.EPSILON) * 100) / 100;
    const averageMarginPercent = totalValuationSale > 0
        ? Math.round(((potentialProfit / totalValuationSale) * 100 + Number.EPSILON) * 100) / 100
        : 0;

    return {
        items: normalized,
        summary: {
            totalProductsCount: normalized.length,
            totalStockUnits,
            totalValuationCost: Math.round((totalValuationCost + Number.EPSILON) * 100) / 100,
            totalValuationSale: Math.round((totalValuationSale + Number.EPSILON) * 100) / 100,
            potentialProfit,
            averageMarginPercent,
            classACount,
            classBCount,
            classCCount,
        },
    };
}
