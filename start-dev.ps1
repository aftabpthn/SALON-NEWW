param(
  [switch]$Release
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $root '.codex-runtime'
$backend = Join-Path $root 'backend-rust'
$frontend = Join-Path $root 'frontend-angular'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

function Test-Port($port) {
  Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Stop-ProjectBuildLocks {
  Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -match 'cargo|rustc') -and
      ($_.CommandLine -match [regex]::Escape($backend) -or $_.CommandLine -match 'aurashine-.*target')
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Stop-DuplicateFrontends {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -match [regex]::Escape($frontend) -and
      $_.CommandLine -match 'ng\.js|ng serve|npm-cli\.js' -and
      $_.CommandLine -notmatch '--port 4200'
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-Backend {
  if (Test-Port 8082) { return }
  Stop-ProjectBuildLocks
  $profile = if ($Release) { '--release' } else { '' }
  $cmd = "Set-Location -LiteralPath '$backend'; cargo run $profile 1> '$runtime\backend.out.log' 2> '$runtime\backend.err.log'"
  Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd) -WindowStyle Hidden
}

function Start-Frontend {
  Stop-DuplicateFrontends
  if (Test-Port 4200) { return }
  $cmd = "Set-Location -LiteralPath '$frontend'; npm start -- --host 127.0.0.1 --port 4200 1> '$runtime\frontend.out.log' 2> '$runtime\frontend.err.log'"
  Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd) -WindowStyle Hidden
}

Start-Backend
Start-Frontend

for ($i = 0; $i -lt 60; $i++) {
  if ((Test-Port 8082) -and (Test-Port 4200)) { break }
  Start-Sleep -Seconds 1
}

Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 4200, 8082, 15432, 16379 } |
  Select-Object LocalAddress, LocalPort, OwningProcess
