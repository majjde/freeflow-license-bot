# Runs the bot and restarts it if it crashes (Windows)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "Starting Freeflow License Bot..." -ForegroundColor Cyan

while ($true) {
  try {
    node bot.js
    Write-Host "Bot exited. Restarting in 5 seconds..." -ForegroundColor Yellow
  } catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host "Restarting in 5 seconds..." -ForegroundColor Yellow
  }
  Start-Sleep -Seconds 5
}
