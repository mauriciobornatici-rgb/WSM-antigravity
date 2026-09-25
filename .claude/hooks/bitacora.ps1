# PostToolUse (Edit|Write|NotebookEdit): agrega una linea a .agents/context/BITACORA.md.
# Rastro append-only (local, gitignored) de todo archivo tocado. No entra al contexto:
# lo usa el auditor externo para detectar desvios de alcance. Nunca bloquea ni falla.

$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $ev = ConvertFrom-Json $raw

    $root = $env:CLAUDE_PROJECT_DIR
    if ([string]::IsNullOrWhiteSpace($root)) { $root = $ev.cwd }
    if ([string]::IsNullOrWhiteSpace($root)) { exit 0 }

    $ctx = Join-Path $root '.agents\context'
    if (-not (Test-Path $ctx)) { exit 0 }

    $archivo = $null
    if ($ev.tool_input) {
        if ($ev.tool_input.file_path)         { $archivo = $ev.tool_input.file_path }
        elseif ($ev.tool_input.notebook_path) { $archivo = $ev.tool_input.notebook_path }
    }
    if ([string]::IsNullOrWhiteSpace($archivo)) { exit 0 }

    try {
        $full = [System.IO.Path]::GetFullPath($archivo)
        $base = [System.IO.Path]::GetFullPath($root)
        if ($full.StartsWith($base, [System.StringComparison]::OrdinalIgnoreCase)) {
            $archivo = $full.Substring($base.Length).TrimStart('\', '/')
        }
    } catch { }

    # La propia bitacora no se registra
    if ($archivo -like '*BITACORA.md') { exit 0 }

    $quien = 'principal'
    if (-not [string]::IsNullOrWhiteSpace($ev.agent_type)) { $quien = $ev.agent_type }

    $sesion = ''
    if (-not [string]::IsNullOrWhiteSpace($ev.session_id)) {
        $sesion = $ev.session_id.Substring(0, [Math]::Min(8, $ev.session_id.Length))
    }

    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $linea = "$ts | $sesion | $quien | $($ev.tool_name) | $archivo"

    $destino = Join-Path $ctx 'BITACORA.md'
    if (-not (Test-Path $destino)) {
        Set-Content -Path $destino -Encoding utf8 -Value @(
            '# Bitacora',
            '',
            'Rastro append-only escrito por hook (local, no versionado). No editar a mano.',
            'Formato: fecha | sesion | agente | herramienta | archivo',
            ''
        )
    }
    Add-Content -Path $destino -Encoding utf8 -Value $linea
    exit 0
}
catch {
    exit 0
}
