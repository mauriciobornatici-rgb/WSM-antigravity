// The delivery note chosen for a supplier return (ADR-027, D7): "" = nothing chosen yet;
// NO_RECEPTION = chosen explicitly: no delivery note (the supplier already invoiced the goods).
export const NO_RECEPTION = "none";

/** The value to send: the chosen delivery note, or nothing for "no delivery note". */
export function receptionIdToSend(value: string): string | undefined {
    return value && value !== NO_RECEPTION ? value : undefined;
}
