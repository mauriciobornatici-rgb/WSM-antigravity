import { useEffect, useId, useRef, useState } from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { IMPORT_BATCH_ROWS, IMPORT_MAX_ROWS, type ImportEntity, type ImportResponse, type ImportRowResult, type ImportSummary } from "@wsm/common"
import { api, type ImportRow } from "@/services/api"
import { isApiError } from "@/services/httpClient"
import { formatMoney } from "@/lib/formatters"
import { createClientUuid } from "@/lib/clientUuid"
import { getErrorMessage } from "@/lib/errorHandling"
import { convertToCSV, downloadCSV } from "@/lib/exportUtils"
import { chunk, downloadImportTemplate, IMPORT_FILE_ACCEPT, mapSheet, readSpreadsheet } from "@/lib/imports/spreadsheet"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

type Step = "select" | "preview" | "importing" | "done"

const ENTITY_TEXT: Record<ImportEntity, { title: string; singular: string; plural: string; keyLabel: string; fileName: string }> = {
    products: { title: "Importar productos", singular: "producto", plural: "productos", keyLabel: "SKU", fileName: "productos" },
    clients: { title: "Importar clientes", singular: "cliente", plural: "clientes", keyLabel: "CUIT o nombre", fileName: "clientes" },
    suppliers: { title: "Importar proveedores", singular: "proveedor", plural: "proveedores", keyLabel: "CUIT o nombre", fileName: "proveedores" },
}

const STEP_TEXT: Record<Step, string> = {
    select: "Paso 1 de 3 · Elegí el archivo",
    preview: "Paso 2 de 3 · Revisá antes de guardar",
    importing: "Paso 3 de 3 · Guardando",
    done: "Resultado",
}

const ACTION_LABEL: Record<ImportRowResult["action"], string> = {
    create: "Se crea",
    update: "Se actualiza",
    skip: "Ya existe",
    error: "Con errores",
}

// Rows with something to read first: errors, then warnings.
const PROBLEM_ROWS_SHOWN = 300
// The server reads up to 4 MB per request; a bit less, to leave room.
const MAX_REQUEST_CHARS = 3_800_000

interface StopInfo {
    row: number | string
    message: string
}

interface ImportResult {
    summary: ImportSummary
    failed: ImportRowResult[]
    sent: number
    total: number
    stop: StopInfo | null
}

function emptySummary(): ImportSummary {
    return { create: 0, update: 0, skip: 0, error: 0 }
}

function addSummary(total: ImportSummary, part: ImportSummary): ImportSummary {
    return {
        create: total.create + part.create,
        update: total.update + part.update,
        skip: total.skip + part.skip,
        error: total.error + part.error,
    }
}

const withPeriod = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// "busy": another import or a sale was using the same rows and the batch was rolled back whole;
// it is sent again a couple of times before stopping.
async function commitWithRetry(entity: ImportEntity, data: { rows: ImportRow[]; update_existing: boolean; batch_id: string }) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await api.commitImport(entity, data)
        } catch (error) {
            const busy = isApiError(error) && error.status === 409
                && typeof error.body === "object" && error.body !== null && (error.body as { error?: unknown }).error === "busy"
            if (!busy || attempt >= 3) throw error
            await wait(2000 * attempt)
        }
    }
}

interface ImportDialogProps {
    entity: ImportEntity
    /** Called after something was saved, to reload the list behind the dialog. */
    onImported: () => void | Promise<void>
}

/**
 * Spreadsheet import: download the template, choose the file, see what will happen with every
 * row (nothing is saved yet), and import. The rows are saved in small batches with a progress
 * bar; a batch that fails stops the import and says how far it got (running it again skips
 * what was already saved).
 */
export function ImportDialog({ entity, onImported }: ImportDialogProps) {
    const text = ENTITY_TEXT[entity]
    const fileInputId = useId()
    const updateInputId = useId()
    const headingRef = useRef<HTMLHeadingElement>(null)
    const problemRef = useRef<HTMLParagraphElement>(null)
    // Each file or check gets a number: an answer that arrives after a reset or a newer request
    // is dropped instead of showing an old preview.
    const requestRef = useRef(0)
    const [open, setOpen] = useState(false)
    const [step, setStep] = useState<Step>("select")
    const [busy, setBusy] = useState<null | "reading" | "checking">(null)
    const [fileName, setFileName] = useState("")
    const [rows, setRows] = useState<ImportRow[]>([])
    const [ignoredHeaders, setIgnoredHeaders] = useState<string[]>([])
    const [exampleRows, setExampleRows] = useState<number[]>([])
    const [updateExisting, setUpdateExisting] = useState(false)
    const [preview, setPreview] = useState<ImportResponse | null>(null)
    const [problem, setProblem] = useState<string | null>(null)
    const [progress, setProgress] = useState({ done: 0, total: 0 })
    const [result, setResult] = useState<ImportResult | null>(null)
    const [downloading, setDownloading] = useState(false)
    const [announcement, setAnnouncement] = useState("")

    // The focus follows the step (keyboard and screen reader users land on the new content).
    useEffect(() => {
        if (open) headingRef.current?.focus()
    }, [step, open])

    useEffect(() => {
        if (problem) problemRef.current?.focus()
    }, [problem])

    // Leaving the page in the middle of an import would cut it without saying how far it got.
    useEffect(() => {
        if (step !== "importing") return
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
        window.addEventListener("beforeunload", warn)
        return () => window.removeEventListener("beforeunload", warn)
    }, [step])

    function reset() {
        requestRef.current += 1
        setStep("select")
        setBusy(null)
        setFileName("")
        setRows([])
        setIgnoredHeaders([])
        setExampleRows([])
        setPreview(null)
        setProblem(null)
        setProgress({ done: 0, total: 0 })
        setResult(null)
        setAnnouncement("")
    }

    function handleOpenChange(next: boolean) {
        if (!next && step === "importing") {
            toast.info("Esperá a que termine la importación: si se corta, quedaría a mitad de camino.")
            return
        }
        setOpen(next)
        if (!next) reset()
    }

    async function handleTemplate() {
        setDownloading(true)
        try {
            await downloadImportTemplate(entity)
        } catch (error) {
            toast.error("No se pudo generar la plantilla", { description: getErrorMessage(error) })
        } finally {
            setDownloading(false)
        }
    }

    async function check(nextRows: ImportRow[], nextUpdate: boolean, request: number) {
        setBusy("checking")
        setProblem(null)
        try {
            const response = await api.previewImport(entity, { rows: nextRows, update_existing: nextUpdate })
            if (request !== requestRef.current) return
            setPreview(response)
            setStep("preview")
            setAnnouncement(`Archivo revisado: ${response.summary.create} nuevos, ${response.summary.update} para actualizar, ${response.summary.skip} ya existen, ${response.summary.error} con errores.`)
        } catch (error) {
            if (request !== requestRef.current) return
            setProblem(getErrorMessage(error, "No se pudo revisar el archivo."))
        } finally {
            if (request === requestRef.current) setBusy(null)
        }
    }

    async function handleFile(input: HTMLInputElement) {
        const file = input.files?.[0]
        // Cleared at once: the same file, corrected and saved again, can be chosen again.
        input.value = ""
        if (!file) return
        const request = ++requestRef.current
        setFileName(file.name)
        setProblem(null)
        setPreview(null)
        setBusy("reading")
        try {
            const mapped = mapSheet(entity, await readSpreadsheet(file))
            if (request !== requestRef.current) return
            const fail = (message: string) => {
                setProblem(message)
                setBusy(null)
            }
            if (mapped.missingHeaders.length > 0) {
                return fail(`Al archivo le faltan columnas obligatorias: ${mapped.missingHeaders.join(", ")}. Descargá la plantilla para ver cómo se llaman.`)
            }
            if (mapped.rows.length === 0) {
                return fail(mapped.exampleRows.length > 0
                    ? "El archivo solo tiene la fila de ejemplo de la plantilla. Reemplazala por tus datos."
                    : "El archivo no tiene filas con datos debajo de los encabezados.")
            }
            if (mapped.rows.length > IMPORT_MAX_ROWS) {
                return fail(`El archivo tiene ${mapped.rows.length} filas y el máximo es ${IMPORT_MAX_ROWS}. Dividilo en varios archivos.`)
            }
            if (JSON.stringify(mapped.rows).length > MAX_REQUEST_CHARS) {
                return fail("El archivo es demasiado grande para revisarlo de una vez (mucho texto en las celdas). Dividilo en varios archivos.")
            }
            setRows(mapped.rows)
            setIgnoredHeaders(mapped.ignoredHeaders)
            setExampleRows(mapped.exampleRows)
            await check(mapped.rows, updateExisting, request)
        } catch (error) {
            if (request !== requestRef.current) return
            setProblem(getErrorMessage(error, "No se pudo leer el archivo."))
            setBusy(null)
        }
    }

    async function handleUpdateToggle(next: boolean) {
        setUpdateExisting(next)
        // In the preview the rows are checked again with the new choice; the preview stays visible.
        if (step === "preview" && rows.length > 0) await check(rows, next, ++requestRef.current)
    }

    async function handleImport() {
        if (!preview) return
        // Only the rows that create or update something travel: errors and existing ones stay out.
        const toSave = new Set(preview.rows.filter((row) => row.action === "create" || row.action === "update").map((row) => row.row))
        const batches = chunk(rows.filter((row) => toSave.has(row.row)), IMPORT_BATCH_ROWS)
        const batchId = createClientUuid()
        const total = toSave.size
        let summary = emptySummary()
        let sent = 0
        let lastQuarter = 0
        const failed: ImportRowResult[] = []
        let stop: StopInfo | null = null
        setStep("importing")
        setProgress({ done: 0, total })
        setAnnouncement(`Importando ${total} filas.`)
        for (const batch of batches) {
            try {
                const response = await commitWithRetry(entity, { rows: batch, update_existing: updateExisting, batch_id: batchId })
                summary = addSummary(summary, response.summary)
                failed.push(...response.rows.filter((row) => row.action === "error"))
                sent += batch.length
                setProgress({ done: sent, total })
                // Announced every quarter, not every batch (a long file would be a hundred messages).
                const quarter = Math.floor((sent / total) * 4)
                if (quarter > lastQuarter && quarter < 4) {
                    lastQuarter = quarter
                    setAnnouncement(`Importando: ${quarter * 25} %.`)
                }
            } catch (error) {
                stop = { row: batch[0]?.row ?? "?", message: getErrorMessage(error) }
                break
            }
        }
        setResult({ summary, failed, sent, total, stop })
        setStep("done")
        setAnnouncement(stop
            ? `La importación se cortó: se guardaron ${sent} de ${total} filas.`
            : `Importación terminada: ${summary.create} creados, ${summary.update} actualizados, ${summary.error} con errores.`)
        if (summary.create > 0 || summary.update > 0) void onImported()
    }

    function downloadRows(list: ImportRowResult[], name: string) {
        const data = list.map((row) => ({
            row: row.row,
            key: row.key,
            result: ACTION_LABEL[row.action],
            errors: row.errors.join(" | "),
            warnings: row.warnings.join(" | "),
        }))
        const csv = convertToCSV(data, [
            { key: "row", label: "Fila" },
            { key: "key", label: text.keyLabel },
            { key: "result", label: "Resultado" },
            { key: "errors", label: "Errores" },
            { key: "warnings", label: "Avisos" },
        ], { separator: ";" })
        downloadCSV(`${name}-${text.fileName}-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    }

    const problemRows = (preview?.rows ?? [])
        .filter((row) => row.errors.length > 0 || row.warnings.length > 0)
        .sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || a.row - b.row)
    const toImport = preview ? preview.summary.create + preview.summary.update : 0
    const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
    const importing = step === "importing"

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button type="button" variant="outline" className="w-full gap-2 sm:w-auto">
                    <Upload className="h-4 w-4" aria-hidden="true" /> Importar
                </Button>
            </DialogTrigger>
            <DialogContent
                className="w-[95vw] max-h-[92vh] overflow-y-auto sm:max-w-3xl"
                hideClose={importing}
                onEscapeKeyDown={(event) => { if (importing) { event.preventDefault(); handleOpenChange(false) } }}
                onInteractOutside={(event) => { if (importing) { event.preventDefault(); handleOpenChange(false) } }}
            >
                <DialogHeader>
                    <DialogTitle>{text.title}</DialogTitle>
                    <DialogDescription>
                        Cargá muchos {text.plural} de una vez desde una planilla de Excel o un CSV.
                    </DialogDescription>
                </DialogHeader>
                <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
                <h3 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">{STEP_TEXT[step]}</h3>

                {step === "select" && (
                    <div className="space-y-4">
                        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                            <li>Descargá la plantilla: tiene las columnas, un ejemplo y una hoja con instrucciones.</li>
                            <li>Completala con tus datos (o usá tu propia planilla con los mismos encabezados).</li>
                            <li>Elegí el archivo: se revisa sin guardar nada.</li>
                        </ol>
                        <Button type="button" variant="outline" className="gap-2" onClick={() => void handleTemplate()} disabled={downloading}>
                            {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                            Descargar plantilla
                        </Button>
                        <div className="space-y-2">
                            <label htmlFor={fileInputId} className="text-sm font-medium">Archivo (.xlsx o .csv)</label>
                            <input
                                id={fileInputId}
                                type="file"
                                accept={IMPORT_FILE_ACCEPT}
                                aria-disabled={busy !== null}
                                onClick={(event) => { if (busy !== null) event.preventDefault() }}
                                onChange={(event) => void handleFile(event.currentTarget)}
                                aria-describedby={problem ? `${fileInputId}-problem` : undefined}
                                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-accent"
                            />
                            {/* The input is cleared after each choice (so the same file can be chosen again): its name is shown here. */}
                            {fileName && <p className="text-xs text-muted-foreground">Último archivo elegido: {fileName}</p>}
                        </div>
                        <UpdateExistingOption id={updateInputId} checked={updateExisting} disabled={busy !== null} onChange={(next) => void handleUpdateToggle(next)} />
                        {busy !== null && (
                            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {busy === "reading" ? "Leyendo" : "Revisando"} {fileName}...
                            </p>
                        )}
                        {problem && (
                            <p
                                ref={problemRef}
                                tabIndex={-1}
                                id={`${fileInputId}-problem`}
                                role="alert"
                                className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 outline-none dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                            >
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {problem}
                            </p>
                        )}
                    </div>
                )}

                {step === "preview" && preview && (
                    <div className="space-y-4">
                        <p className="flex flex-wrap items-center gap-2 text-sm">
                            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <span className="font-medium">{fileName}</span>
                            <span className="text-muted-foreground">· {rows.length} filas · Todavía no se guardó nada.</span>
                        </p>
                        <SummaryBadges summary={preview.summary} />
                        <UpdateExistingOption id={updateInputId} checked={updateExisting} disabled={busy !== null} onChange={(next) => void handleUpdateToggle(next)} />
                        {busy === "checking" && (
                            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Volviendo a revisar...
                            </p>
                        )}
                        {exampleRows.length > 0 && (
                            <p className="text-sm text-muted-foreground">
                                La fila {exampleRows.join(", ")} es el ejemplo de la plantilla y no se importa.
                            </p>
                        )}
                        {ignoredHeaders.length > 0 && (
                            <p className="text-xs text-muted-foreground">Columnas que no se usan: {ignoredHeaders.join(", ")}.</p>
                        )}
                        {entity === "products" && <ReadValuesSample rows={preview.rows} />}
                        {problem && (
                            <p ref={problemRef} tabIndex={-1} role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 outline-none dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                                {problem}
                            </p>
                        )}
                        {preview.summary.error > 0 && (
                            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
                                Las filas con errores no se importan. Podés corregir el archivo y volver a elegirlo, o importar ahora el resto.
                            </p>
                        )}
                        {problemRows.length > 0 && (
                            <ProblemList rows={problemRows.slice(0, PROBLEM_ROWS_SHOWN)} keyLabel={text.keyLabel} total={problemRows.length} />
                        )}
                        <div className="flex flex-wrap gap-2">
                            {problemRows.length > 0 && (
                                <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => downloadRows(problemRows, "revision")}>
                                    <Download className="h-4 w-4" aria-hidden="true" /> Descargar filas para revisar
                                </Button>
                            )}
                            <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => downloadRows(preview.rows, "resultado")}>
                                <Download className="h-4 w-4" aria-hidden="true" /> Descargar el resultado de todas las filas
                            </Button>
                        </div>
                        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 flex-col-reverse gap-2 border-t bg-card px-6 py-4 sm:flex-row sm:justify-end">
                            <Button type="button" variant="outline" onClick={reset}>Elegir otro archivo</Button>
                            <Button type="button" onClick={() => void handleImport()} disabled={toImport === 0 || busy !== null}>
                                {toImport === 0
                                    ? "No hay nada para importar"
                                    : `Importar ${toImport} ${toImport === 1 ? text.singular : text.plural}`}
                            </Button>
                        </DialogFooter>
                    </div>
                )}

                {step === "importing" && (
                    <div className="space-y-3">
                        <p className="text-sm" aria-hidden="true">Guardando {progress.done} de {progress.total} filas... No cierres esta ventana.</p>
                        <Progress value={percent} aria-label="Avance de la importación" />
                    </div>
                )}

                {step === "done" && result && (
                    <div className="space-y-4">
                        {result.stop ? (
                            <div role="alert" className="space-y-1 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
                                <p className="flex items-start gap-2 font-medium">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                                    La importación se cortó en la fila {result.stop.row}. Se guardaron {result.sent} de {result.total} filas; faltan {result.total - result.sent}.
                                </p>
                                <p>Motivo: {withPeriod(result.stop.message)}</p>
                                <p>
                                    Podés volver a subir el mismo archivo: lo ya cargado {updateExisting ? "se vuelve a actualizar con los mismos datos" : "se saltea"}.
                                </p>
                            </div>
                        ) : (
                            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Importación terminada.
                            </p>
                        )}
                        <SummaryBadges summary={result.summary} saved />
                        {result.failed.length > 0 && (
                            <>
                                <ProblemList rows={result.failed.slice(0, PROBLEM_ROWS_SHOWN)} keyLabel={text.keyLabel} total={result.failed.length} />
                                <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => downloadRows(result.failed, "errores")}>
                                    <Download className="h-4 w-4" aria-hidden="true" /> Descargar filas con errores
                                </Button>
                            </>
                        )}
                        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <Button type="button" variant="outline" onClick={reset}>Importar otro archivo</Button>
                            <Button type="button" onClick={() => handleOpenChange(false)}>Cerrar</Button>
                        </DialogFooter>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}

// The first rows that will be saved, with the numbers as they were read: a price written with a
// stray dot (1.250 vs 1,250) shows up here before anything is saved.
function ReadValuesSample({ rows }: { rows: ImportRowResult[] }) {
    const sample = rows.filter((row) => (row.action === "create" || row.action === "update") && row.values).slice(0, 5)
    if (sample.length === 0) return null
    const money = (value: number | null | undefined) => (value === null || value === undefined ? "-" : formatMoney(value))
    return (
        <section className="space-y-2" aria-label="Cómo se leyeron los números">
            <p className="text-sm font-medium">Así se leyeron los primeros productos (revisá que los importes estén bien):</p>
            <div className="overflow-x-auto rounded-md border" role="region" aria-label="Valores leídos">
                <table className="w-full text-xs">
                    <thead>
                        <tr className="border-b text-left">
                            <th scope="col" className="px-3 py-2 font-medium">Fila</th>
                            <th scope="col" className="px-3 py-2 font-medium">SKU</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Precio final</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Costo sin IVA</th>
                            <th scope="col" className="px-3 py-2 text-right font-medium">Stock inicial</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sample.map((row) => (
                            <tr key={row.row} className="border-b last:border-0">
                                <td className="px-3 py-1.5 font-mono">{row.row}</td>
                                <td className="max-w-[10rem] truncate px-3 py-1.5" title={row.key}>{row.key}</td>
                                <td className="px-3 py-1.5 text-right">{money(row.values?.sale_price)}</td>
                                <td className="px-3 py-1.5 text-right">{money(row.values?.cost)}</td>
                                <td className="px-3 py-1.5 text-right">{row.values?.stock ?? "-"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    )
}

function UpdateExistingOption({ id, checked, disabled, onChange }: { id: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
    return (
        <div className="flex min-h-11 items-start gap-3 py-1">
            <input
                id={id}
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-primary"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
                aria-describedby={`${id}-hint`}
            />
            <div>
                <label htmlFor={id} className="block cursor-pointer text-sm font-medium">Actualizar los que ya existen</label>
                <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                    Si está marcado, los que ya estaban cargados toman los datos del archivo (las celdas vacías no borran nada). Si no, se saltean.
                </p>
            </div>
        </div>
    )
}

// Colors with enough contrast in light and dark mode (WCAG AA).
const BADGE = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"

function SummaryBadges({ summary, saved = false }: { summary: ImportSummary; saved?: boolean }) {
    return (
        <ul className="flex flex-wrap gap-2" aria-label="Resumen">
            <li className={cn(BADGE, "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100")}>
                {summary.create} {saved ? "creados" : "nuevos"}
            </li>
            <li className={cn(BADGE, "border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100")}>
                {summary.update} {saved ? "actualizados" : "para actualizar"}
            </li>
            <li className={cn(BADGE, "border-border bg-muted text-foreground")}>{summary.skip} ya existen</li>
            <li className={cn(BADGE, summary.error > 0
                ? "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100"
                : "border-border text-foreground")}
            >
                {summary.error} con errores
            </li>
        </ul>
    )
}

function RowMessages({ row }: { row: ImportRowResult }) {
    return (
        <ul className="space-y-0.5">
            {row.errors.map((message, index) => (
                <li key={`e-${index}`} className="flex items-start gap-1 text-red-700 dark:text-red-300">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span><span className="font-semibold">Error:</span> {message}</span>
                </li>
            ))}
            {row.warnings.map((message, index) => (
                <li key={`w-${index}`} className="flex items-start gap-1 text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span><span className="font-semibold">Aviso:</span> {message}</span>
                </li>
            ))}
        </ul>
    )
}

function ProblemList({ rows, keyLabel, total }: { rows: ImportRowResult[]; keyLabel: string; total: number }) {
    return (
        <section className="space-y-2" aria-label="Filas con errores o avisos">
            <p className="text-sm font-medium">
                Filas con errores o avisos ({total}){total > rows.length ? `: se muestran las primeras ${rows.length}` : ""}
            </p>
            {/* Phones: one card per row, the detail always visible. */}
            <ul className="max-h-80 space-y-2 overflow-y-auto sm:hidden" aria-label="Filas para revisar">
                {rows.map((row) => (
                    <li key={row.row} className="rounded-md border p-2 text-xs">
                        <p className="mb-1 font-medium">
                            Fila {row.row} · {row.key || "-"} · <span className={row.action === "error" ? "text-red-700 dark:text-red-300" : ""}>{ACTION_LABEL[row.action]}</span>
                        </p>
                        <RowMessages row={row} />
                    </li>
                ))}
            </ul>
            {/* Wider screens: a table in a single scroller with a sticky header. */}
            <div className="hidden max-h-72 overflow-auto rounded-md border sm:block" role="region" aria-label="Filas para revisar">
                <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card">
                        <tr className="border-b text-left">
                            <th scope="col" className="w-16 px-3 py-2 font-medium">Fila</th>
                            <th scope="col" className="px-3 py-2 font-medium">{keyLabel}</th>
                            <th scope="col" className="px-3 py-2 font-medium">Resultado</th>
                            <th scope="col" className="px-3 py-2 font-medium">Detalle</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.row} className="border-b align-top last:border-0">
                                <td className="px-3 py-2 font-mono text-xs">{row.row}</td>
                                <td className="max-w-[10rem] truncate px-3 py-2 text-xs" title={row.key}>{row.key || "-"}</td>
                                <td className={cn("whitespace-nowrap px-3 py-2 text-xs font-medium", row.action === "error" && "text-red-700 dark:text-red-300")}>
                                    {ACTION_LABEL[row.action]}
                                </td>
                                <td className="px-3 py-2 text-xs"><RowMessages row={row} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    )
}
