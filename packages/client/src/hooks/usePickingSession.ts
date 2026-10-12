import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { isApiError } from "@/services/httpClient";
import { queryKeys } from "@/lib/queryKeys";

export function usePickingSession() {
    const queryClient = useQueryClient();
    const [loading, setLoading] = useState(false);

    const transitionToPacked = useCallback(async (orderId: string): Promise<void> => {
        setLoading(true);
        try {
            const summary = await api.getOrderSummary(orderId);
            let currentStatus = String(summary.order?.status || "").toLowerCase();

            if (currentStatus === "packed") return;

            if (currentStatus === "pending") {
                try {
                    await api.updateOrderStatus(orderId, "picking");
                    currentStatus = "picking";
                } catch (error) {
                    if (isApiError(error) && error.status === 400) {
                        throw new Error("El backend rechazó el estado 'picking'.");
                    }
                    throw error;
                }
            }

            if (currentStatus === "picking") {
                await api.updateOrderStatus(orderId, "packed");
            }

            await queryClient.invalidateQueries({ queryKey: queryKeys.orders.all });
        } finally {
            setLoading(false);
        }
    }, [queryClient]);

    return {
        loading,
        transitionToPacked,
    };
}
