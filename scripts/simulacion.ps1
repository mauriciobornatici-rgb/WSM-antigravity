# Entorno de SIMULACIÓN de WSM SportsERP: una base aparte (wsm_simulacion) en el MySQL local de
# Docker, con datos maestros de una tienda de deportes, para practicar todos los procesos sin
# tocar la base de desarrollo (wsm_sports_erp) ni la de producción.
#
#   powershell -File scripts\simulacion.ps1             levanta la simulación (la crea si no existe)
#   powershell -File scripts\simulacion.ps1 -Reiniciar  la borra y la vuelve a crear desde cero
#   ... -Reiniciar -SinMovimientos                       solo datos maestros (caja cerrada, sin ventas ni pedidos)
#   ... -Red                                             la abre también a otras computadoras de la misma red wifi
#
# Para volver al entorno de desarrollo habitual:  powershell -File scripts\dev-local.ps1
# Guía de procesos y usuarios: docs\execution\GUIA_SIMULACION.md
param([switch]$Reiniciar, [switch]$SinMovimientos, [switch]$Red)

# 'Continue': en Windows PowerShell 5.1 las advertencias que los comandos nativos (docker, mysql)
# escriben en stderr cortarían el script con 'Stop'. Los errores se controlan explícitamente.
$ErrorActionPreference = 'Continue'
# La consola en UTF-8: si no, los acentos que escribe Node se ven como símbolos raros.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$base = 'wsm_simulacion'
$claveSimulacion = 'Simulacion2026!'

function Stop-Port([int]$port) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) { Stop-Process -Id $listener.OwningProcess -Force -Confirm:$false -ErrorAction SilentlyContinue }
}

# 1) MySQL local en Docker (el mismo contenedor que el desarrollo).
if (-not (docker ps -a --filter name=^/wsm_local_db$ --format '{{.Names}}')) {
    throw 'No existe el contenedor wsm_local_db: corré primero scripts\dev-local.ps1 una vez.'
}
docker start wsm_local_db | Out-Null
Write-Host '==> esperando a MySQL...'
for ($i = 0; $i -lt 40; $i++) {
    $r = docker exec wsm_local_db mysqladmin ping -h 127.0.0.1 -u wsm_user -pwsm_pass_2026 2>$null
    if ($r -match 'mysqld is alive') { break }
    Start-Sleep -Seconds 2
}

# 2) Base de simulación (solo esta base; el nombre está fijo a propósito).
$existe = docker exec wsm_local_db mysql -uroot -pwsm_root_2026 -N -e "SHOW DATABASES LIKE '$base'" 2>$null
$nueva = $Reiniciar -or -not $existe
if ($nueva) {
    Write-Host "==> creando la base $base desde cero"
    docker exec wsm_local_db mysql -uroot -pwsm_root_2026 -e "DROP DATABASE IF EXISTS $base; CREATE DATABASE $base CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON $base.* TO 'wsm_user'@'%'; FLUSH PRIVILEGES;" 2>$null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear la base $base." }
}

# Con -Red: la dirección de esta computadora en la red local (wifi o cable). La app y la API se
# publican en esa dirección y la API acepta pedidos que vengan de ella.
$ip = $null
if ($Red) {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\.' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|VirtualBox|VMware' } |
        Select-Object -First 1 -ExpandProperty IPAddress
    if (-not $ip) { throw 'No se encontró la dirección de esta computadora en la red local.' }
    $env:CORS_ORIGINS = "http://localhost:5173,http://${ip}:5173"
    $env:VITE_API_URL = "http://${ip}:3001"
} else {
    $env:CORS_ORIGINS = $null
    $env:VITE_API_URL = $null
}

# 3) API sobre la base de simulación (aplica las migraciones; crea el admin si la base es nueva).
Stop-Port 3001
$env:ENV_FILE = '.env.local'
$env:NODE_ENV = 'development'
$env:DB_NAME = $base
$env:ADMIN_DEFAULT_PASSWORD = $claveSimulacion
Write-Host "==> API -> http://localhost:3001 (base $base)"
Start-Process -FilePath 'node' -ArgumentList 'packages/server/index.js' `
    -RedirectStandardOutput "$env:TEMP\wsm_simulacion.out.log" `
    -RedirectStandardError  "$env:TEMP\wsm_simulacion.err.log" -WindowStyle Hidden
$lista = $false
for ($i = 0; $i -lt 60; $i++) {
    try { if ((Invoke-WebRequest -Uri 'http://localhost:3001/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $lista = $true; break } } catch { }
    Start-Sleep -Seconds 2
}
if (-not $lista) { throw "La API no arrancó: revisá $env:TEMP\wsm_simulacion.err.log" }

# 4) Datos maestros (solo en una base nueva).
if ($nueva) {
    Write-Host '==> cargando datos de la simulación'
    if ($SinMovimientos) { node packages/server/scripts/simulation/preparar-simulacion.mjs --sin-movimientos }
    else { node packages/server/scripts/simulation/preparar-simulacion.mjs }
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron cargar los datos de la simulación.' }
}

# 5) Aplicación web.
Stop-Port 5173
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { $npm = (Get-Command npm).Source }
$webArgs = if ($Red) { @('exec', '-w', '@wsm/client', '--', 'vite', '--host', '0.0.0.0') } else { @('run', 'dev') }
Start-Process -FilePath $npm -ArgumentList $webArgs -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput "$env:TEMP\wsm_web.out.log" -RedirectStandardError "$env:TEMP\wsm_web.err.log"

Write-Host ''
if ($Red) {
    Write-Host "Simulación lista en la red: http://${ip}:5173  (desde esta computadora también usá esa dirección)"
    Write-Host 'Si Windows pregunta si Node.js puede usar la red, permití el acceso en redes privadas.'
} else {
    Write-Host 'Simulación lista: http://localhost:5173'
}
Write-Host 'Usuarios y procesos a probar: docs\execution\GUIA_SIMULACION.md'
