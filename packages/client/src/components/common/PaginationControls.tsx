import { Button } from "@/components/ui/button";

type PaginationControlsProps = {
    page: number;
    totalPages: number;
    totalCount: number;
    itemLabel: string;
    isLoading?: boolean;
    onPageChange: (nextPage: number) => void;
};

function formatItemLabel(count: number, baseLabel: string): string {
    if (count === 1) return baseLabel;
    if (baseLabel.endsWith("s")) return baseLabel;
    return `${baseLabel}s`;
}

export function PaginationControls({
    page,
    totalPages,
    totalCount,
    itemLabel,
    isLoading = false,
    onPageChange,
}: PaginationControlsProps) {
    const safePage = Math.max(1, page);
    const safeTotalPages = Math.max(1, totalPages);
    const canGoPrevious = safePage > 1 && !isLoading;
    const canGoNext = safePage < safeTotalPages && !isLoading;
    const label = formatItemLabel(totalCount, itemLabel);

    return (
        <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <span>
                Pagina {safePage} de {safeTotalPages} · {totalCount} {label}
            </span>
            <div className="flex gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canGoPrevious}
                    onClick={() => onPageChange(safePage - 1)}
                >
                    Anterior
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canGoNext}
                    onClick={() => onPageChange(safePage + 1)}
                >
                    Siguiente
                </Button>
            </div>
        </div>
    );
}
