# One-time GitHub setup — creates repo and pushes code
# Usage:
#   1. Run: gh auth login   (complete in browser)
#   2. Run: .\setup-github.ps1 -Username YOUR_GITHUB_USERNAME

param(
    [Parameter(Mandatory = $true)]
    [string]$Username
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$repoName = "freeflow-license-bot"

Write-Host "`n=== Creating GitHub repo ===" -ForegroundColor Cyan

gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Run 'gh auth login' first, then retry." -ForegroundColor Red
    exit 1
}

gh repo create "$Username/$repoName" --public --source=. --remote=origin --push --description "Freeflow license key Telegram bot"

git branch -M main 2>$null
git push -u origin main 2>$null

Write-Host "`nRepo: https://github.com/$Username/$repoName" -ForegroundColor Green
Write-Host "Next: run deploy-railway.ps1 with your RAILWAY_TOKEN" -ForegroundColor Yellow
