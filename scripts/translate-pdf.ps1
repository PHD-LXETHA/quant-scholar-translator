param(
  [Parameter(Mandatory=$true)][string]$InputPdf,
  [string]$OutputDirectory = '',
  [string]$SourceLanguage = 'en',
  [string]$TargetLanguage = 'zh',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
  throw 'PDF environment missing. Run scripts\setup.ps1 -WithPdf first.'
}
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $InputPdf)) 'translated'
}

$arguments = @(
  '-m', 'quant_scholar_translator', 'pdf',
  $InputPdf,
  '--output-dir', $OutputDirectory,
  '--source', $SourceLanguage,
  '--target', $TargetLanguage
)
if ($DryRun) { $arguments += '--dry-run' }
& $pythonExe @arguments
