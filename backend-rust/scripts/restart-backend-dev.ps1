param(
    [switch]$SkipBuild,
    [int]$Port = 8082
)

$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceExe = Join-Path $backendRoot 'target\debug\aura-shine-backend.exe'
$runtimeDir = Join-Path $backendRoot '.codex-runtime\backend-dev'
$runtimeExe = Join-Path $runtimeDir 'aura-shine-backend.exe'
$localEnv = Join-Path $backendRoot '.env'

# Local dev must use the same AI credentials as the companion AI container.
# Explicitly load these values because inherited shell variables otherwise win over dotenv.
if (Test-Path -LiteralPath $localEnv) {
    foreach ($name in @('AI_SERVICE_URL', 'AI_SERVICE_TOKEN')) {
        $line = Get-Content -LiteralPath $localEnv | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
        if ($line) {
            $value = $line.Substring($line.IndexOf('=') + 1).Trim().Trim('"').Trim("'")
            if ($name -ne 'AI_SERVICE_TOKEN' -or $value.Length -ge 32) {
                Set-Item -LiteralPath "Env:$name" -Value $value
            }
        }
    }
}

function Get-BackendListeners {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)"
        if (-not $process) { continue }

        $allowed = @($sourceExe, $runtimeExe) | Where-Object {
            [string]::Equals($_, $process.ExecutablePath, [System.StringComparison]::OrdinalIgnoreCase)
        }
        if (-not $allowed) {
            throw "Port $Port is owned by unmanaged process $($process.ProcessId): $($process.ExecutablePath)"
        }
        $process
    }
}

function Stop-BackendListeners {
    $listeners = @(Get-BackendListeners)
    $managed = @(Get-CimInstance Win32_Process -Filter "Name = 'aura-shine-backend.exe'" |
        Where-Object {
            [string]::Equals($_.ExecutablePath, $sourceExe, [System.StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($_.ExecutablePath, $runtimeExe, [System.StringComparison]::OrdinalIgnoreCase)
        })
    foreach ($process in @(($listeners + $managed) | Sort-Object ProcessId -Unique)) {
        Stop-Process -Id $process.ProcessId -Force
        Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

if (-not $SkipBuild) {
    $activeCargo = @(Get-CimInstance Win32_Process -Filter "Name = 'cargo.exe'")
    if ($activeCargo) {
        $cargoPids = ($activeCargo.ProcessId | Sort-Object) -join ', '
        throw "Cargo is already running (PID: $cargoPids). Wait for it or use -SkipBuild to restart the existing executable."
    }

    $activeRustc = Get-CimInstance Win32_Process -Filter "Name = 'rustc.exe'" |
        Where-Object { $_.CommandLine -like "*$backendRoot*" }
    if ($activeRustc) {
        throw 'An AuraShine Rust build is already running. Wait for it instead of starting a duplicate.'
    }

    foreach ($process in @(Get-BackendListeners)) {
        if ([string]::Equals($process.ExecutablePath, $sourceExe, [System.StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $process.ProcessId -Force
            Wait-Process -Id $process.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
        }
    }

    Push-Location $backendRoot
    try {
        & cargo build --bin aura-shine-backend
        if ($LASTEXITCODE -ne 0) { throw "Cargo build failed with exit code $LASTEXITCODE" }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $sourceExe)) {
    throw "Backend executable not found: $sourceExe"
}

Stop-BackendListeners
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        Copy-Item -LiteralPath $sourceExe -Destination $runtimeExe -Force
        break
    }
    catch {
        if ($attempt -eq 19) { throw }
        Start-Sleep -Milliseconds 250
    }
}

$stdout = Join-Path $runtimeDir 'backend.out.log'
$stderr = Join-Path $runtimeDir 'backend.err.log'
$backend = Start-Process -FilePath $runtimeExe -WorkingDirectory $backendRoot -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

$healthUrl = "http://127.0.0.1:$Port/health"
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    if ($backend.HasExited) { break }
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Write-Output "Backend ready: $healthUrl (PID $($backend.Id))"
            return
        }
    }
    catch { }
}

$errorTail = Get-Content -LiteralPath $stderr -Tail 20 -ErrorAction SilentlyContinue
throw "Backend did not become healthy. PID=$($backend.Id). Error log:`n$($errorTail -join [Environment]::NewLine)"
