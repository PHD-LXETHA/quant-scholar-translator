param(
  [switch]$WithPdf
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $projectRoot '.venv'
$pythonExe = Join-Path $venvPath 'Scripts\python.exe'

function Invoke-ProjectPython {
  & $pythonExe @args
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed with exit code $LASTEXITCODE"
  }
}

if (-not (Test-Path -LiteralPath $pythonExe)) {
  python -m venv $venvPath
}

Invoke-ProjectPython -m pip install --upgrade pip
if ($WithPdf) {
  Invoke-ProjectPython -m pip install -e "$projectRoot[all]"
} else {
  Invoke-ProjectPython -m pip install -e "$projectRoot[gpu]"
}

Write-Host ''
Write-Host 'Quant Scholar environment is ready.'
Write-Host 'Next: run scripts\start-backend.ps1, then load apps\browser-extension in Chrome.'
if (-not $WithPdf) {
  Write-Host 'For layout-preserving PDF translation, run scripts\setup.ps1 -WithPdf.'
}
