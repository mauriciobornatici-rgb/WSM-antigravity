import type {
    PosException,
    PosExceptionPriceDetails,
    PosExceptionStockShortageDetails,
} from "@/services/api";
import { formatMoney } from "@/lib/formatters";

/** Spanish label for the exception type badge (never color-only). */
export function formatPosExceptionTypeLabel(type: PosException["type"]): string {
    if (type === "price") return "Precio distinto";
    // ADR-019: an online-store order recorded without enough stock to reserve.
    if (type === "channel_stock_shortage") return "Pedido online sin stock";
    return "Faltante de stock";
}

function shortenProductId(productId: string): string {
    if (!productId) return "-";
    return productId.length > 8 ? `${productId.slice(0, 8)}…` : productId;
}

function resolveProductLabel(productId: string, productNameById?: Record<string, string>): string {
    const name = productNameById?.[productId];
    return name && name.trim().length > 0 ? name : `Producto ${shortenProductId(productId)}`;
}

/**
 * Human-readable summary of a POS exception's detail lines, resolving product names when available.
 * For 'price': "Producto X: catálogo $Y vs. cobrado $Z" per line.
 * For 'stock_shortage': "Producto X: faltaron N de M unidades" per line.
 */
export function formatPosExceptionDetail(
    exception: Pick<PosException, "type" | "details">,
    productNameById?: Record<string, string>
): string {
    if (exception.type === "price") {
        const details = exception.details as PosExceptionPriceDetails;
        const lines = Array.isArray(details?.lines) ? details.lines : [];
        if (lines.length === 0) return "Sin detalle de precios";
        return lines
            .map((line) => {
                const label = resolveProductLabel(line.product_id, productNameById);
                return `${label}: catálogo ${formatMoney(line.catalog_price)} vs. cobrado ${formatMoney(line.unit_price)}`;
            })
            .join(" · ");
    }

    const details = exception.details as PosExceptionStockShortageDetails;
    const lines = Array.isArray(details?.lines) ? details.lines : [];
    if (lines.length === 0) return "Sin detalle de faltantes";
    return lines
        .map((line) => {
            const label = resolveProductLabel(line.product_id, productNameById);
            return exception.type === "channel_stock_shortage"
                ? `${label}: sin reservar ${line.shortage} de ${line.requested} unidades`
                : `${label}: faltaron ${line.shortage} de ${line.requested} unidades`;
        })
        .join(" · ");
}
