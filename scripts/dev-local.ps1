# Levanta el entorno LOCAL completo de WSM SportsERP (DB Docker + backend + frontend).
# No toca la BD remota de produccion. Uso:  powershell -File scripts\dev-local.ps1
# 'Continue': en Windows PowerShell 5.1 las advertencias que los comandos nativos (docker, mysql)
# escriben en stderr cortarían el script con 'Stop'. Los errores se controlan explícitamente.
$ErrorActionPreference = 'Continue'
# La consola en UTF-8: si no, los acentos que escribe Node se ven como símbolos raros.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 1) Base de datos MySQL local en Docker
if (-not (docker ps -a --filter name=^/wsm_local_db$ --format '{{.Names}}')) {
    Write-Host '==> creando contenedor wsm_local_db'
    docker run -d --name wsm_local_db --restart unless-stopped `
        -e MYSQL_ROOT_PASSWORD=wsm_root_2026 -e MYSQL_DATABASE=wsm_sports_erp `
        -e MYSQL_USER=wsm_user -e MYSQL_PASSWORD=wsm_pass_2026 `
        -p 127.0.0.1:3319:3306 -v wsm_local_db_data:/var/lib/mysql `
        mysql:8.0 --default-authentication-plugin=mysql_native_password `
        --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci `
        --skip-log-bin --log-bin-trust-function-creators=1 | Out-Null
} else {
    Write-Host '==> iniciando contenedor wsm_local_db'
    docker start wsm_local_db | Out-Null
}

Write-Host '==> esperando a MySQL...'
for ($i = 0; $i -lt 40; $i++) {
    $r = docker exec wsm_local_db mysqladmin ping -h 127.0.0.1 -u wsm_user -pwsm_pass_2026 2>$null
    if ($r -match 'mysqld is alive') { Write-Host '   DB lista'; break }
    Start-Sleep -Seconds 2
}

# Si quedó corriendo otra API o la app (por ejemplo la de la simulación), se cierran antes.
foreach ($port in 3001, 5173) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

# 2) Backend (aplica migraciones + seed del admin la primera vez)
$env:DB_NAME = $null   # la base de desarrollo es la de .env.local (no la de la simulación)
$env:ENV_FILE = '.env.local'
$env:NODE_ENV = 'development'
Write-Host '==> backend  -> http://localhost:3001'
Start-Process -FilePath 'node' -ArgumentList 'packages/server/index.js' `
    -RedirectStandardOutput "$env:TEMP\wsm_server.out.log" `
    -RedirectStandardError  "$env:TEMP\wsm_server.err.log" -WindowStyle Hidden

# 3) Frontend
Write-Host '==> frontend -> http://localhost:5173'
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = (Get-Command npm).Source }
Start-Process -FilePath $npm -ArgumentList 'run','dev' -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput "$env:TEMP\wsm_web.out.log" -RedirectStandardError "$env:TEMP\wsm_web.err.log"

Write-Host ''
Write-Host 'Listo. Login: admin@sports.store / Admin1234!'
