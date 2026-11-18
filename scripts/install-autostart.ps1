#Requires -Version 5.1
param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "server.js"))) {
  throw "Projeto nao encontrado (server.js em $Root)."
}

$Startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$ShortcutApi = Join-Path $Startup "DOE-Backoffice-API.lnk"
$ShortcutWorker = Join-Path $Startup "DOE-Backoffice-Worker.lnk"
$ApiVbs = Join-Path $Root "scripts\run-api-hidden.vbs"
$WorkerVbs = Join-Path $Root "scripts\run-worker-hidden.vbs"
$StopScript = Join-Path $Root "scripts\stop-background.ps1"
$StartScript = Join-Path $Root "scripts\start-background.ps1"

function New-VbsShortcut([string]$LinkPath, [string]$TargetVbs) {
  $w = New-Object -ComObject WScript.Shell
  $s = $w.CreateShortcut($LinkPath)
  $s.TargetPath = "$env:SystemRoot\System32\wscript.exe"
  $s.Arguments = "`"$TargetVbs`""
  $s.WorkingDirectory = $Root
  $s.WindowStyle = 7
  $s.Description = "DOE Backoffice background"
  $s.Save()
}

if ($Uninstall) {
  & $StopScript
  Remove-Item $ShortcutApi -Force -ErrorAction SilentlyContinue
  Remove-Item $ShortcutWorker -Force -ErrorAction SilentlyContinue
  Write-Host "Removido do Inicializar e processos parados."
  exit 0
}

if (-not (Test-Path $Startup)) {
  New-Item -ItemType Directory -Path $Startup -Force | Out-Null
}

New-VbsShortcut $ShortcutApi $ApiVbs
New-VbsShortcut $ShortcutWorker $WorkerVbs
Write-Host "Atalhos criados em:"
Write-Host "  $Startup"

& $StartScript

Write-Host ""
Write-Host "Pronto - nao depende de terminal aberto."
Write-Host "  API:    http://localhost:3847"
Write-Host "  Worker: sync a cada 5 min"
Write-Host "  Parar:       npm run bg:stop"
Write-Host "  Desinstalar: npm run bg:uninstall"
