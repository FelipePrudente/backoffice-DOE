#Requires -Version 5.1
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path -Parent $PSScriptRoot

$conns = Get-NetTCPConnection -LocalPort 3847 -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  if ($c.OwningProcess) {
    Write-Host "Encerrando API PID $($c.OwningProcess)"
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
  $cmd = $_.CommandLine
  if ($cmd -and ($cmd -match 'worker\.js' -or $cmd -match 'server\.js')) {
    if ($cmd -match 'backoffice' -or $cmd -match [regex]::Escape($Root)) {
      Write-Host "Encerrando PID $($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
}

Write-Host "Processos em segundo plano encerrados."
