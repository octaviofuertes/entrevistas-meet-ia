# =====================================================================
#  Launcher leIA — levanta Cloudflare Tunnel + backend SINCRONIZADOS.
#
#  Por qué: las URLs gratis de trycloudflare rotan/mueren, y cada bot de
#  Recall "hornea" la URL al crearse. Si el tunnel y el backend se
#  desincronizan, el bot carga una URL muerta y leIA no aparece.
#
#  Este script:
#    1. Mata cualquier cloudflared/backend viejo (slate limpio).
#    2. Levanta UN cloudflared y espera su URL.
#    3. Escribe esa URL en .env (PUBLIC_BASE_URL), sin BOM.
#    4. Arranca el backend (tsx watch). El tunnel sobrevive los reloads.
#
#  Uso: desde backend/ ->  .\scripts\start-all.ps1
# =====================================================================
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent          # carpeta backend/
$cf   = Join-Path $root 'cloudflared.exe'
$envPath = Join-Path $root '.env'
$log  = Join-Path $env:TEMP 'leia-cloudflared.log'

if (-not (Test-Path $cf)) {
  Write-Host "No esta cloudflared.exe en $cf" -ForegroundColor Red
  exit 1
}

Write-Host "Limpiando procesos viejos..." -ForegroundColor Cyan
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$conn = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  $conn.OwningProcess | Select-Object -Unique | ForEach-Object {
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 1

Write-Host "Levantando Cloudflare Tunnel..." -ForegroundColor Cyan
Remove-Item $log, "$log.err" -ErrorAction SilentlyContinue
Start-Process -FilePath $cf `
  -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://localhost:4000' `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err" -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  $txt = (Get-Content $log, "$log.err" -ErrorAction SilentlyContinue) -join "`n"
  $m = [regex]::Match($txt, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($m.Success) { $url = $m.Value; break }
}
if (-not $url) {
  Write-Host "No se pudo obtener la URL del tunnel. Revisa $log.err" -ForegroundColor Red
  exit 1
}
Write-Host "Tunnel listo: $url" -ForegroundColor Green

# Escribir PUBLIC_BASE_URL en .env (UTF-8 sin BOM para no romper dotenv).
$lines = Get-Content $envPath
$found = $false
$lines = $lines | ForEach-Object {
  if ($_ -match '^\s*PUBLIC_BASE_URL=') { $found = $true; "PUBLIC_BASE_URL=$url" } else { $_ }
}
if (-not $found) { $lines += "PUBLIC_BASE_URL=$url" }
[System.IO.File]::WriteAllLines($envPath, $lines)
Write-Host "PUBLIC_BASE_URL actualizado en .env" -ForegroundColor Green

Write-Host "Arrancando backend (Ctrl+C para cortar)..." -ForegroundColor Cyan
Set-Location $root
npm run dev
