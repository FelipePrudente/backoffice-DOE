#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ApiVbs = Join-Path $Root "scripts\run-api-hidden.vbs"
$WorkerVbs = Join-Path $Root "scripts\run-worker-hidden.vbs"

$busy = Get-NetTCPConnection -LocalPort 3847 -ErrorAction SilentlyContinue
if ($busy) {
  Write-Host "API ja esta na porta 3847."
} else {
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$ApiVbs`"" -WorkingDirectory $Root -WindowStyle Hidden
  Write-Host "API iniciada em segundo plano (http://localhost:3847)."
}

Start-Sleep -Seconds 1

$hasWorker = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'worker\.js' }
if ($hasWorker) {
  Write-Host "Worker ja esta em execucao."
} else {
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$WorkerVbs`"" -WorkingDirectory $Root -WindowStyle Hidden
  Write-Host "Worker iniciado em segundo plano (sync a cada 5 min)."
}

Write-Host "Para parar: npm run bg:stop"
