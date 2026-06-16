export function QueryErrorBanner({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 md:flex-row md:items-center md:justify-between">
            <span>No pudimos cargar esta sección. Reintentá para actualizar la vista.</span>
            <button
                type="button"
                onClick={onRetry}
                className="rounded border border-red-300 px-3 py-1 font-medium text-red-700 transition hover:bg-red-100"
            >
                Reintentar
            </button>
        </div>
    )
}

export function QueryLoadingState() {
    return (
        <div className="flex h-48 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
        </div>
    )
}
