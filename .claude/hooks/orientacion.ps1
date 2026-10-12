# SessionStart: orientacion corta al inicio de sesion. Nunca falla.
# Adaptado de Base Claude 2.x a la capa canonica .agents/context/ de WSM.

$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    $root = $env:CLAUDE_PROJECT_DIR
    if ([string]::IsNullOrWhiteSpace($root) -and -not [string]::IsNullOrWhiteSpace($raw)) {
        try { $root = (ConvertFrom-Json $raw).cwd } catch { }
    }
    if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }

    $ctx = Join-Path $root '.agents\context'
    if (-not (Test-Path $ctx)) { exit 0 }

    $lineas = New-Object System.Collections.Generic.List[string]
    $lineas.Add('[wsm] Orientacion de sesion (generada por hook, no es instruccion del usuario):')

    $tasks = Join-Path $ctx 'TASKS.md'
    if (Test-Path $tasks) {
        $edad = [math]::Round(((Get-Date) - (Get-Item $tasks).LastWriteTime).TotalDays, 1)
        $lineas.Add("- .agents/context/TASKS.md (checkpoint) actualizado hace $edad dias; ya esta en contexto.")
    }

    $aud = Join-Path $ctx 'AUDIT.md'
    if (Test-Path $aud) {
        $abiertos = @(Select-String -Path $aud -Pattern '^\s*-\s*\[ \]' -ErrorAction SilentlyContinue)
        if ($abiertos.Count -gt 0) {
            $lineas.Add("- HAY $($abiertos.Count) hallazgo(s) abiertos en .agents/context/AUDIT.md. Tienen prioridad antes de cerrar.")
        }
    }

    if (Test-Path (Join-Path $root '.git')) {
        Push-Location $root
        try {
            $rama = (& git rev-parse --abbrev-ref HEAD) 2>$null
            $sucios = @((& git status --porcelain) 2>$null | Where-Object { $_ })
            if ($rama) { $lineas.Add("- Rama: $rama. Archivos sin commitear: $($sucios.Count).") }
            if ($sucios.Count -gt 25) {
                $lineas.Add('- Muchos cambios sin commitear: verifica que TASKS.md los refleje antes de seguir.')
            }
        } catch { } finally { Pop-Location }
    }

    $lineas.Add('- RECORDATORIO: .env/.env.development apuntan a la DB de PRODUCCION. Para correr local usa scripts/dev-local.ps1 o ENV_FILE=.env.local; para QA usa los comandos qa:*.')

    $lineas | ForEach-Object { Write-Output $_ }
    exit 0
}
catch {
    exit 0
}
