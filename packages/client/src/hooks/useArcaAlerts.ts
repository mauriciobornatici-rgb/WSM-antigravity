import { useQuery } from "@tanstack/react-query"
import { hasPermission, PERMISSIONS } from "@wsm/common"
import { useAuth } from "@/context/AuthContext"
import { api } from "@/services/api"
import { queryKeys } from "@/lib/queryKeys"

/**
 * ADR-021: ARCA documents in conflict or stuck in verification. Shared by the menu badge and
 * the dashboard card (same query, one request).
 */
export function useArcaAlerts() {
    const { user } = useAuth()
    const canInvoice = hasPermission(user?.role, PERMISSIONS.INVOICES_MANAGE)
    return useQuery({
        queryKey: queryKeys.arcaAlerts,
        queryFn: () => api.getArcaAlerts(),
        enabled: canInvoice,
        refetchInterval: 120_000,
        meta: { silentError: true },
    })
}
