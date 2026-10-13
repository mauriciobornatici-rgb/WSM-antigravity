import { arcaLastErrorText } from "@/lib/arca"

type ArcaLastErrorProps = {
    doc: { status?: string | null | undefined; arca_last_error?: unknown }
    className?: string
}

/** Reason of the last failed ARCA attempt, small and red; nothing when there is none. */
export function ArcaLastError({ doc, className = "" }: ArcaLastErrorProps) {
    const text = arcaLastErrorText(doc)
    if (!text) return null
    return (
        <p className={`text-xs font-medium text-red-600 dark:text-red-400 font-sans ${className}`.trim()}>
            Último intento: {text}
        </p>
    )
}
