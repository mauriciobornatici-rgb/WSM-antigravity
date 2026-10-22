import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { hasPermission, PERMISSIONS } from "@wsm/common"
import { useAuth } from "@/context/AuthContext"
import { api, type SupplierReturnSuggestedCost } from "@/services/api"
import { receptionIdToSend } from "@/lib/receptionChoice"

// Where the suggested cost of a return comes from, in words.
export const RETURN_COST_SOURCE: Record<SupplierReturnSuggestedCost["source"], string> = {
    invoice: "Último costo facturado",
    reception: "Costo del remito",
    product: "Costo actual del producto",
}

/**
 * ADR-028: what the supplier takes each product back at is its last invoiced cost. Only purchasing
 * (a manager or an administrator) may change it; for anyone else it is shown and not sent (the
 * server uses the same one). While a new product's cost loads, the costs already known stay.
 */
export function useReturnCosts(supplierId: string, receptionChoice: string, productIds: string[]) {
    const { user } = useAuth()
    const canSetCost = hasPermission(user?.role, PERMISSIONS.PROCUREMENT_MANAGE)
    const ids = [...new Set(productIds.filter(Boolean))].sort()
    const reception = receptionIdToSend(receptionChoice)
    const enabled = Boolean(supplierId) && Boolean(receptionChoice) && ids.length > 0
    const query = useQuery({
        queryKey: ["supplier-returns", "suggested-costs", supplierId, reception ?? "", ids.join(",")],
        queryFn: () => api.getReturnSuggestedCosts({
            supplier_id: supplierId,
            ...(reception ? { reception_id: reception } : {}),
            product_ids: ids,
        }),
        enabled,
        placeholderData: keepPreviousData,
    })
    const costs = new Map((query.data ?? []).map((row) => [row.product_id, row]))
    return {
        canSetCost,
        costs,
        // Nothing to ask yet: the costs depend on the delivery note chosen.
        waitingForReception: !receptionChoice,
        loading: enabled && query.isFetching,
        failed: query.isError,
        retry: () => { void query.refetch() },
    }
}

/** What a return item's cost shows: typed by purchasing, or the one suggested (null: not known yet). */
export function returnItemCost(
    item: { product_id: string; cost_input?: string },
    canSetCost: boolean,
    costs: Map<string, SupplierReturnSuggestedCost>,
): number | null {
    if (canSetCost && item.cost_input !== undefined && item.cost_input.trim() !== "") {
        const typed = Number(item.cost_input)
        return Number.isFinite(typed) && typed >= 0 ? typed : null
    }
    return costs.get(item.product_id)?.unit_cost ?? null
}
