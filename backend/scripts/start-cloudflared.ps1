# Levanta un tunel cloudflared apuntando al backend en 4000 y deja la URL
# pegada en la consola para poner en .env como PUBLIC_BASE_URL.
#
# Por qué cloudflared en vez de ngrok: ngrok-free.dev muestra una página
# interstitial a cualquier User-Agent de browser, y el Chrome headless de
# Recall (que carga la webpage del bot-stage) la ve y nunca llega a nuestra
# página. Cloudflare Tunnel quick mode no tiene interstitial.

$exe = Join-Path $PSScriptRoot '..\cloudflared.exe'
if (-not (Test-Path $exe)) {
  Write-Host "cloudflared.exe no esta en $exe" -ForegroundColor Red
  exit 1
}

Write-Host "Iniciando cloudflared tunnel -> http://localhost:4000" -ForegroundColor Cyan
Write-Host "Cuando aparezca la URL .trycloudflare.com, pegala en backend/.env como PUBLIC_BASE_URL=" -ForegroundColor Yellow
Write-Host ""

& $exe tunnel --no-autoupdate --url http://localhost:4000
