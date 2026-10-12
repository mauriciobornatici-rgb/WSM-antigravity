import { useEffect, useState } from "react"
import QRCode from "qrcode"

type AfipQrImageProps = {
    url: string
    size?: number
    alt?: string
    className?: string | undefined
}

/**
 * Renderiza el código QR fiscal localmente (sin depender de servicios
 * externos como api.qrserver.com, que rompen la impresión sin internet).
 */
export function AfipQrImage({ url, size = 150, alt = "Código QR AFIP", className }: AfipQrImageProps) {
    const [src, setSrc] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        QRCode.toDataURL(url, { width: size, margin: 1, errorCorrectionLevel: "M" })
            .then((dataUrl) => {
                if (!cancelled) setSrc(dataUrl)
            })
            .catch(() => {
                if (!cancelled) setSrc(null)
            })
        return () => {
            cancelled = true
        }
    }, [url, size])

    if (!src) return null
    return <img src={src} alt={alt} className={className} width={size} height={size} />
}
