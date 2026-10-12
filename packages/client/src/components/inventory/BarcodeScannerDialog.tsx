import { useEffect, useRef, useState, type FormEvent } from "react"
import { Camera, Keyboard, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

type Detector = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> }

interface BarcodeScannerDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    onDetected: (value: string) => void
}

export function BarcodeScannerDialog({ open, onOpenChange, title, description, onDetected }: BarcodeScannerDialogProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const detectorRef = useRef<Detector | null>(null)
    const frameRef = useRef<number | null>(null)
    const detectingRef = useRef(false)
    const onDetectedRef = useRef(onDetected)
    const onOpenChangeRef = useRef(onOpenChange)
    const [manualValue, setManualValue] = useState("")
    const [status, setStatus] = useState("Preparando cámara...")

    useEffect(() => {
        onDetectedRef.current = onDetected
        onOpenChangeRef.current = onOpenChange
    }, [onDetected, onOpenChange])

    useEffect(() => {
        if (!open) return
        let cancelled = false

        const stop = () => {
            if (frameRef.current != null) cancelAnimationFrame(frameRef.current)
            frameRef.current = null
            streamRef.current?.getTracks().forEach((track) => track.stop())
            streamRef.current = null
            detectorRef.current = null
        }

        const start = async () => {
            if (!window.isSecureContext && window.location.hostname !== "localhost") {
                setStatus("La cámara del teléfono requiere HTTPS. Puedes usar un lector Bluetooth/USB o ingresar el código manualmente.")
                return
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                setStatus("Este navegador no permite acceder a la cámara. Usa el ingreso manual.")
                return
            }
            const DetectorConstructor = (globalThis as unknown as {
                BarcodeDetector?: new (options?: { formats?: string[] }) => Detector
            }).BarcodeDetector
            if (!DetectorConstructor) {
                setStatus("El navegador no reconoce códigos desde cámara. Usa Chrome actualizado o el ingreso manual.")
                return
            }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: "environment" } },
                    audio: false,
                })
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }
                streamRef.current = stream
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                    await videoRef.current.play()
                }
                detectorRef.current = new DetectorConstructor({ formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code"] })
                setStatus("Cámara activa: centra el código dentro del recuadro.")

                const detectFrame = async () => {
                    if (cancelled || !videoRef.current || !detectorRef.current) return
                    if (!detectingRef.current && videoRef.current.readyState >= 2) {
                        detectingRef.current = true
                        try {
                            const results = await detectorRef.current.detect(videoRef.current)
                            const value = results.find((result) => result.rawValue?.trim())?.rawValue?.trim()
                            if (value) {
                                stop()
                                onDetectedRef.current(value)
                                onOpenChangeRef.current(false)
                                return
                            }
                        } catch {
                            setStatus("No se pudo leer el código. Acércate o mejora la iluminación.")
                        } finally {
                            detectingRef.current = false
                        }
                    }
                    frameRef.current = requestAnimationFrame(() => void detectFrame())
                }
                frameRef.current = requestAnimationFrame(() => void detectFrame())
            } catch {
                setStatus("No se pudo abrir la cámara. Revisa el permiso del navegador o usa el ingreso manual.")
            }
        }

        setManualValue("")
        setStatus("Preparando cámara...")
        void start()
        return () => {
            cancelled = true
            stop()
        }
    }, [open])

    function submitManual(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const value = manualValue.trim()
        if (!value) return
        onDetected(value)
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] max-w-xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5" />{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="relative overflow-hidden rounded-xl border bg-black">
                        <video ref={videoRef} className="h-56 w-full object-cover" muted playsInline />
                        <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.28)]" />
                        <Camera className="absolute bottom-3 right-3 h-5 w-5 text-white/80" />
                    </div>
                    <p className="min-h-10 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" role="status">{status}</p>
                    <form onSubmit={submitManual} className="flex gap-2">
                        <Input
                            value={manualValue}
                            onChange={(event) => setManualValue(event.target.value)}
                            placeholder="SKU, código de barras o ubicación"
                            autoComplete="off"
                        />
                        <Button type="submit" variant="secondary">
                            <Keyboard className="mr-2 h-4 w-4" />Usar
                        </Button>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    )
}
