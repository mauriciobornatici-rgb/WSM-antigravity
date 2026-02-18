import { toast } from "sonner";
import { isApiError } from "@/services/httpClient";

type ErrorLikeRecord = Record<string, unknown>;

const trackedErrors = new WeakSet<object>();
let lastToastSignature = "";
let lastToastAt = 0;
const TOAST_DEDUP_WINDOW_MS = 1_500;

function isRecord(value: unknown): value is ErrorLikeRecord {
    return typeof value === "object" && value !== null;
}

function readStringProp(source: unknown, key: string): string | null {
    if (!isRecord(source)) return null;
    const value = source[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function getErrorMessage(error: unknown, fallback = "Ocurrió un error inesperado"): string {
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

function canTrackError(error: unknown): error is object {
    return typeof error === "object" && error !== null;
}

export function wasErrorToastHandled(error: unknown): boolean {
    return canTrackError(error) && trackedErrors.has(error);
}

function markErrorToastHandled(error: unknown): void {
    if (canTrackError(error)) {
        trackedErrors.add(error);
    }
}

function shouldSkipBySignature(signature: string): boolean {
    const now = Date.now();
    if (signature === lastToastSignature && now - lastToastAt < TOAST_DEDUP_WINDOW_MS) {
        return true;
    }
    lastToastSignature = signature;
    lastToastAt = now;
    return false;
}

export function showErrorToast(
    title: string,
    error: unknown,
    fallback = "Ocurrió un error inesperado"
): void {
    if (wasErrorToastHandled(error)) return;

    const description = getErrorMessage(error, fallback);
    const signature = `${title}::${description}`;
    if (shouldSkipBySignature(signature)) return;

    toast.error(title, { description });
    markErrorToastHandled(error);
}

export function safeJsonParse(value: string | null | undefined): unknown {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}
