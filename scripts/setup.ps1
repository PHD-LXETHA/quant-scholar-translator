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
Invoke-ProjectPython -m pip install -e "$projectRoot[all]"

Write-Host ''
Write-Host 'Quant Scholar environment is ready.'
Write-Host 'Next: run scripts\start-backend.ps1, then load apps\browser-extension in Chrome.'
