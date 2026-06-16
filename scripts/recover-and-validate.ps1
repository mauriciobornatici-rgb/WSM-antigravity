<#
=====================================================================
 WSM SportsERP - Recuperacion y Validacion (Milestone M0)
=====================================================================
 Objetivo:
   1) Asegurar el trabajo sin versionar (backup + commit + push).
   2) Restablecer una corrida verde reproducible (install limpio + validate).
   3) Reportar vulnerabilidades (npm audit).

 IMPORTANTE: ejecutar en tu ENTORNO REAL (Windows), en la raiz del repo.
 Disenado para ser SEGURO por defecto: las acciones destructivas
 (borrar node_modules, npm audit fix) requieren flags explicitos.

 Uso:
   # Asegura el trabajo + install (si falta) + audit (reporte) + validate
   pwsh ./scripts/recover-and-validate.ps1

   # Ademas: push del checkpoint, reinstall limpio y audit fix
   pwsh ./scripts/recover-and-validate.ps1 -Push -CleanInstall -AuditFix

 Parametros:
   -Push          Hace push del branch/commit de respaldo al remoto 'origin'.
   -CleanInstall  Borra node_modules (y package-lock) y reinstala desde cero.
   -AuditFix      Corre 'npm audit fix' (cambios no disruptivos).
   -Yes           No pregunta confirmaciones (modo desatendido).
=====================================================================
#>

[CmdletBinding()]
param(
    [switch]$Push,
    [switch]$CleanInstall,
    [switch]$AuditFix,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'
function Section($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)      { Write-Host "[OK] $t"   -ForegroundColor Green }
function Warn($t)    { Write-Host "[!] $t"    -ForegroundColor Yellow }
function Confirm($t) { if ($Yes) { return $true } $r = Read-Host "$t [s/N]"; return ($r -eq 's' -or $r -eq 'S') }

# --- 0. Pre-requisitos -------------------------------------------------
Section "0. Verificaciones previas"
if (-not (Test-Path ".git")) { throw "No estas en la raiz del repositorio (no se encuentra .git)." }
foreach ($cmd in @('git','node','npm')) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Falta '$cmd' en el PATH." }
}
Ok ("git $(git --version)  |  node $(node --version)  |  npm $(npm --version)")

# Aviso si el repo vive en una carpeta sincronizada (riesgo de corrupcion/locks)
$here = (Get-Location).Path
if ($here -match 'OneDrive|Dropbox|Google Drive|GoogleDrive') {
    Warn "El repo parece estar en una carpeta SINCRONIZADA ($here)."
    Warn "Recomendacion fuerte: mover el repo a una ruta local dedicada (ej. C:\dev\wsm-sportserp)."
}

# Limpiar lock huerfano de git si quedo trabado
if (Test-Path ".git/index.lock") {
    Warn "Se encontro .git/index.lock huerfano."
    if (Confirm "Eliminar el lock para poder operar?") { Remove-Item ".git/index.lock" -Force; Ok "Lock eliminado." }
}

# --- 1. Asegurar el trabajo (lo mas importante) ------------------------
Section "1. Asegurar el trabajo sin versionar"
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$pending = (git status --porcelain).Length
Write-Host "Branch actual: $branch"
Write-Host "Ultimo commit: $(git log -1 --format='%h %ci %s')"

if ($pending -eq 0) {
    Ok "No hay cambios sin versionar. El arbol ya esta limpio."
} else {
    $count = (git status --porcelain | Measure-Object).Count
    Warn "$count rutas con cambios sin versionar."
    # Pointer de respaldo al estado pre-commit (por si se quiere reorganizar luego)
    git branch "backup/pre-wip-$ts" | Out-Null
    Ok "Branch de respaldo creado: backup/pre-wip-$ts (apunta al estado actual)."
    if (Confirm "Crear commit de checkpoint con TODO el trabajo en '$branch'?") {
        git add -A
        git commit -m "wip: checkpoint $ts (recuperacion dirección - M0)" | Out-Null
        Ok "Checkpoint commiteado en '$branch'."
        Write-Host "   (Para reorganizar luego: git reset --soft HEAD~1)" -ForegroundColor DarkGray
    } else {
        Warn "Checkpoint NO creado. El trabajo sigue sin versionar."
    }
}

if ($Push) {
    if (git remote 2>$null) {
        if (Confirm "Hacer push de '$branch' y los branches de respaldo a 'origin'?") {
            git push origin $branch
            git push origin --all
            Ok "Push completado."
        }
    } else {
        Warn "No hay remoto 'origin' configurado. Configura uno: git remote add origin <url>"
    }
}

# --- 2. Entorno de dependencias ---------------------------------------
Section "2. Dependencias (resolver node_modules)"
if ($CleanInstall) {
    if (Confirm "Borrar node_modules y package-lock.json para reinstalar desde cero?") {
        if (Test-Path "node_modules") { Remove-Item "node_modules" -Recurse -Force }
        Get-ChildItem -Recurse -Filter "node_modules" -Directory -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path "package-lock.json") { Remove-Item "package-lock.json" -Force }
        Ok "Limpieza realizada."
    }
}
Write-Host "Instalando dependencias (npm install)..."
npm install
Ok "Dependencias instaladas."

# --- 3. Auditoria de seguridad ----------------------------------------
Section "3. npm audit"
npm audit
if ($AuditFix) {
    if (Confirm "Aplicar 'npm audit fix' (no disruptivo)?") {
        npm audit fix
        Ok "audit fix aplicado. Revisar y re-validar."
    }
}

# --- 4. Gate de validacion --------------------------------------------
Section "4. Gate de validacion (npm run validate)"
$validateOk = $true
try { npm run validate } catch { $validateOk = $false }

# --- 5. Resumen --------------------------------------------------------
Section "5. Resumen M0"
git log -1 --format='Checkpoint: %h %s' | Write-Host
if ($validateOk) {
    Ok "validate VERDE. Baseline reproducible restablecido. M0 cerrado."
    Write-Host "Siguiente: arrancar M1 (Fiscal AFIP) segun docs/execution/PLAN_DIRECTOR_100.md" -ForegroundColor Cyan
} else {
    Warn "validate FALLO. Revisar el log de arriba (es el arbitro objetivo del estado verde)."
    Write-Host "Compartir la salida para diagnosticar antes de avanzar a M1." -ForegroundColor Yellow
}
