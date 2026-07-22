# Railway deploy helper — run after GitHub + Railway auth
# Usage:
#   $env:RAILWAY_TOKEN = "your_token"
#   .\deploy-railway.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "`n=== Freeflow Bot — Railway Deploy ===" -ForegroundColor Cyan

if (-not $env:RAILWAY_TOKEN) {
    Write-Host "ERROR: Set RAILWAY_TOKEN first:" -ForegroundColor Red
    Write-Host '  $env:RAILWAY_TOKEN = "rw_..."' -ForegroundColor Yellow
    exit 1
}

# Stop local bot to avoid Telegram 409 conflict
Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    try { (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine -match "bot.js" } catch { $false }
} | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Stopped local bot.js (if running)" -ForegroundColor Gray

# Load secrets from .env for Railway variables
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $val = $matches[2].Trim()
            switch ($name) {
                "BOT_TOKEN" { railway variables set "BOT_TOKEN=$val" --skip-deploys 2>$null }
                "ADMIN_CHAT_ID" { railway variables set "ADMIN_CHAT_ID=$val" --skip-deploys 2>$null }
                "SUPPORT_HANDLE" { railway variables set "SUPPORT_HANDLE=$val" --skip-deploys 2>$null }
            }
        }
    }
}

railway variables set "DB_PATH=/data/bot.db" --skip-deploys 2>$null

Write-Host "`nDeploying to Railway..." -ForegroundColor Green
railway up --detach

Write-Host @"

Done! Finish in Railway dashboard (railway.app):

  1. Open your project → click the service
  2. Settings → Service type → Worker (NOT Web)
  3. Settings → Volumes → Add volume → mount path: /data
  4. Settings → Source → Connect GitHub repo (for live edits via git push)
  5. Deployments → confirm latest deploy is Active

Live edit workflow:
  git add . && git commit -m "update" && git push
  → Railway auto-redeploys in ~1-2 min

"@ -ForegroundColor Cyan
