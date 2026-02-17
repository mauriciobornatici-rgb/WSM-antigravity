import { toast } from "sonner";
import { isApiError } from "@/services/httpClient";

type ErrorLikeRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorLikeRecord {
    return typeof value === "object" && value !== null;
}

function readStringProp(source: unknown, key: string): string | null {
    if (!isRecord(source)) return null;
    const value = source[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function getErrorMessage(error: unknown, fallback = "Ocurrio un error inesperado"): string {
    if (isApiError(error)) {
        const bodyMessage =
            readStringProp(error.body, "message") ??
            readStringProp(error.body, "error");
        return bodyMessage ?? error.message ?? fallback;
    }

    if (error instanceof Error) {
        return error.message || fallback;
    }

    const directMessage =
        readStringProp(error, "message") ??
        readStringProp(error, "error");
    return directMessage ?? fallback;
}

export function showErrorToast(
    title: string,
    error: unknown,
    fallback = "Ocurrio un error inesperado"
): void {
    toast.error(title, { description: getErrorMessage(error, fallback) });
}

export function safeJsonParse(value: string | null | undefined): unknown {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}
