param(
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$restartScript = Join-Path $PSScriptRoot 'restart-backend-dev.ps1'
$verifier = Join-Path $repositoryRoot 'scripts\verify-release-baseline.mjs'

if ($SkipBuild) {
    & $restartScript -SkipBuild -Port 8082
}
else {
    & $restartScript -Port 8082
}
Push-Location $repositoryRoot
try {
    & node $verifier --runtime --write
    if ($LASTEXITCODE -ne 0) { throw "Release baseline verification failed with exit code $LASTEXITCODE" }
}
finally {
    Pop-Location
}
