import { type ReactNode } from "react"
import { createPortal } from "react-dom"

export function PrintPortal({ children }: { children: ReactNode }) {
    if (typeof document === "undefined") {
        return null
    }

    const printRoot = document.getElementById("print-portal") || document.body
    return createPortal(children, printRoot)
}

