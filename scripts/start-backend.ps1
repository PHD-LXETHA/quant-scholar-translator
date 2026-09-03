$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $pythonExe)) {
  throw 'Environment missing. Run scripts\setup.ps1 first.'
}

Push-Location $projectRoot
try {
  & $pythonExe -m quant_scholar_translator serve
} finally {
  Pop-Location
}
