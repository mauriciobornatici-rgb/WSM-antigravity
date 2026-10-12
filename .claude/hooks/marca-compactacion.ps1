# PreCompact: deja constancia en la bitacora de que el contexto se compacto.
# Un desvio que aparece justo despues suele ser perdida de contexto.

$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    $root = $env:CLAUDE_PROJECT_DIR
    if ([string]::IsNullOrWhiteSpace($root) -and -not [string]::IsNullOrWhiteSpace($raw)) {
        try { $root = (ConvertFrom-Json $raw).cwd } catch { }
    }
    if ([string]::IsNullOrWhiteSpace($root)) { exit 0 }

    $destino = Join-Path $root '.agents\context\BITACORA.md'
    if (-not (Test-Path $destino)) { exit 0 }

    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm'
    Add-Content -Path $destino -Encoding utf8 -Value "$ts | --- | sistema | COMPACTACION | el contexto se comprimio en este punto"
    exit 0
}
catch {
    exit 0
}
