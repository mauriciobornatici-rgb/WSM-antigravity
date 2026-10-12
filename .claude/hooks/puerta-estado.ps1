# Stop: impide cerrar el turno con el checkpoint (.agents/context/TASKS.md) desactualizado.
# Bloquea como maximo UNA vez por sesion. Exit 2 = bloquea y stderr va a Claude.

$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    $sesion = 'sin-id'
    $root = $env:CLAUDE_PROJECT_DIR

    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        try {
            $ev = ConvertFrom-Json $raw
            if (-not [string]::IsNullOrWhiteSpace($ev.session_id)) { $sesion = $ev.session_id }
            if ([string]::IsNullOrWhiteSpace($root)) { $root = $ev.cwd }
            # Evita bucles: si ya estamos continuando por un Stop hook, no bloquear
            if ($ev.stop_hook_active -eq $true) { exit 0 }
        } catch { }
    }
    if ([string]::IsNullOrWhiteSpace($root)) { exit 0 }

    $ctx      = Join-Path $root '.agents\context'
    $estado   = Join-Path $ctx 'TASKS.md'
    $bitacora = Join-Path $ctx 'BITACORA.md'

    if (-not (Test-Path $estado))   { exit 0 }
    if (-not (Test-Path $bitacora)) { exit 0 }

    # Tolerancia: la edicion del propio checkpoint escribe su linea en la bitacora
    # un instante despues, y eso no debe contar como "cambio sin checkpoint".
    if ((Get-Item $estado).LastWriteTime.AddSeconds(10) -ge (Get-Item $bitacora).LastWriteTime) { exit 0 }

    $marcador = Join-Path $env:TEMP ("wsm-puerta-$sesion.flag")
    if (Test-Path $marcador) { exit 0 }
    Set-Content -Path $marcador -Encoding utf8 -Value (Get-Date -Format 'o')

    $msg = @(
        'Se editaron archivos despues del ultimo checkpoint y .agents/context/TASKS.md quedo desactualizado.',
        'Antes de cerrar el turno, actualizalo con: criterios cumplidos, evidencia, proximas acciones y bloqueos.',
        'Si el checkpoint ya es correcto tal como esta, decilo y termina: esta puerta no vuelve a bloquear en esta sesion.'
    ) -join ' '

    [Console]::Error.WriteLine($msg)
    exit 2
}
catch {
    exit 0
}
