import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatMoney } from "@/lib/formatters"
import { grossPrice } from "@/lib/pricing"
import type { SupplierReturnSuggestedCost } from "@/services/api"
import { RETURN_COST_SOURCE } from "./useReturnCosts"

interface ReturnCostFieldProps {
    id: string
    productName: string
    // What purchasing typed ("" = cleared, undefined = never typed): empty uses the suggestion.
    costInput: string | undefined
    suggested: SupplierReturnSuggestedCost | undefined
    // The cost that applies (typed or suggested); null while it is not known.
    cost: number | null
    vatRate: number | string | null | undefined
    canSetCost: boolean
    waitingForReception: boolean
    loading: boolean
    failed: boolean
    onRetry: () => void
    onChange: (costInput: string | undefined) => void
}

/**
 * ADR-028: what the supplier takes a product back at. Purchasing may type another cost; for anyone
 * else it is read only, as text. While it is not known, it says why instead of showing $0.
 */
export function ReturnCostField({
    id, productName, costInput, suggested, cost, vatRate, canSetCost,
    waitingForReception, loading, failed, onRetry, onChange,
}: ReturnCostFieldProps) {
    const hintId = `${id}-hint`
    const typed = canSetCost && costInput !== undefined && costInput.trim() !== ""
    let status: React.ReactNode = null
    if (cost == null) {
        if (waitingForReception) status = "Elegí el remito para ver el costo."
        else if (failed) {
            status = (
                <span role="alert" className="text-destructive">
                    No se pudo obtener el costo.{" "}
                    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onRetry}>Reintentar</Button>
                </span>
            )
        } else if (loading) status = "Calculando costo…"
    }

    return (
        <div className="space-y-1" aria-busy={loading && cost == null}>
            {canSetCost ? (
                <Input
                    id={id}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    aria-label={`Costo unitario neto de ${productName}`}
                    aria-describedby={hintId}
                    className="h-11 text-right lg:h-9"
                    value={costInput ?? (suggested ? String(suggested.unit_cost) : "")}
                    onChange={(event) => onChange(event.target.value)}
                />
            ) : (
                <output id={id} aria-describedby={hintId} className="block py-2 text-right font-mono text-sm">
                    {cost == null ? "—" : formatMoney(cost)}
                </output>
            )}
            <p id={hintId} className="text-xs text-muted-foreground" aria-live="polite">
                {status ?? (
                    <>
                        {typed ? "Costo cargado a mano. " : suggested ? `${RETURN_COST_SOURCE[suggested.source]}. ` : ""}
                        {canSetCost && costInput !== undefined && costInput.trim() === "" && suggested
                            ? `Vacío: se usa ${formatMoney(suggested.unit_cost)}. `
                            : ""}
                        {canSetCost ? "" : "Solo un gerente o un administrador puede cambiarlo. "}
                        {cost != null ? `Final (c/IVA): ${formatMoney(grossPrice(cost, vatRate ?? undefined))}` : ""}
                    </>
                )}
            </p>
            {typed && suggested ? (
                <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onChange(undefined)}>
                    Usar el último costo facturado ({formatMoney(suggested.unit_cost)})
                </Button>
            ) : null}
        </div>
    )
}
