import { useId, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatArgentinaDate, parseArgentinaDate } from "@/lib/argentinaDate";

type ArgentinaDateInputProps = {
    id?: string;
    value?: string | null;
    onChange: (isoDate: string) => void;
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
    required?: boolean;
    disabled?: boolean;
    min?: string;
    max?: string;
};

export function ArgentinaDateInput({
    id,
    value,
    onChange,
    className,
    placeholder = "dd/mm/aaaa",
    ariaLabel = "Fecha",
    required = false,
    disabled = false,
    min,
    max,
}: ArgentinaDateInputProps) {
    const generatedId = useId();
    const inputId = id || generatedId;
    const pickerRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState(() => formatArgentinaDate(value));
    const [editing, setEditing] = useState(false);
    const [invalid, setInvalid] = useState(false);

    const commitDraft = () => {
        if (!draft.trim()) {
            setInvalid(required);
            onChange("");
            return;
        }

        const parsed = parseArgentinaDate(draft);
        setInvalid(!parsed);
        if (parsed) {
            setDraft(formatArgentinaDate(parsed));
            onChange(parsed);
        }
    };

    return (
        <div className={cn("relative", className)}>
            <Input
                id={inputId}
                value={editing || invalid ? draft : formatArgentinaDate(value)}
                onFocus={() => {
                    setDraft(formatArgentinaDate(value));
                    setEditing(true);
                    setInvalid(false);
                }}
                onChange={(event) => {
                    setDraft(event.target.value);
                    setInvalid(false);
                }}
                onBlur={() => {
                    commitDraft();
                    setEditing(false);
                }}
                onKeyDown={(event) => {
                    if (event.key === "Enter") commitDraft();
                }}
                placeholder={placeholder}
                aria-label={ariaLabel}
                aria-invalid={invalid}
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                required={required}
                disabled={disabled}
                className={cn("pr-11 tabular-nums", invalid && "border-destructive focus-visible:ring-destructive")}
            />
            <input
                ref={pickerRef}
                type="date"
                value={String(value || "").slice(0, 10)}
                min={min}
                max={max}
                disabled={disabled}
                tabIndex={-1}
                aria-hidden="true"
                className="absolute right-0 top-0 h-full w-11 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                onChange={(event) => {
                    setDraft(formatArgentinaDate(event.target.value));
                    setEditing(false);
                    setInvalid(false);
                    onChange(event.target.value);
                }}
            />
            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            {invalid ? <p className="mt-1 text-xs text-destructive">Ingresá una fecha válida en formato dd/mm/aaaa.</p> : null}
        </div>
    );
}
