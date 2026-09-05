param(
  [string]$Version = '0.7.0'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $projectRoot 'dist'
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'

Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath $python)) {
    throw 'Project virtual environment is missing. Run scripts\setup.ps1 first.'
  }
  $declared = (& $python -c 'import quant_scholar_translator; print(quant_scholar_translator.__version__)').Trim()
  if ($declared -ne $Version) {
    throw "Version mismatch: requested $Version, package declares $declared."
  }
  if ((& git status --porcelain)) {
    throw 'Release packages must be built from a clean committed working tree.'
  }

  New-Item -ItemType Directory -Path $dist -Force | Out-Null
  $distPath = (Resolve-Path -LiteralPath $dist).Path
  if ((Split-Path -Parent $distPath) -ne $projectRoot) {
    throw 'Refusing to clean an unexpected output directory.'
  }
  $names = @(
    "quant-scholar-translator-professional-$Version.zip",
    "quant-scholar-browser-extension-$Version.zip",
    "quant-scholar-safari-web-extension-$Version.zip",
    "quant_scholar_translator-$Version-py3-none-any.whl",
    "SHA256SUMS-$Version.txt"
  )
  foreach ($name in $names) {
    $target = Join-Path $dist $name
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
    }
  }

  & git archive --format=zip --output=(Join-Path $dist $names[0]) HEAD
  if ($LASTEXITCODE -ne 0) { throw 'Failed to build professional source package.' }
  & git archive --format=zip --output=(Join-Path $dist $names[1]) HEAD:apps/browser-extension
  if ($LASTEXITCODE -ne 0) { throw 'Failed to build browser extension package.' }
  & git archive --format=zip --output=(Join-Path $dist $names[2]) HEAD:apps/safari-extension
  if ($LASTEXITCODE -ne 0) { throw 'Failed to build Safari extension package.' }
  & $python -m pip wheel . --no-deps --no-build-isolation --wheel-dir $dist
  if ($LASTEXITCODE -ne 0) { throw 'Failed to build Python wheel.' }

  $hashLines = foreach ($name in $names[0..3]) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dist $name)).Hash.ToLowerInvariant()
    "$hash  $name"
  }
  Set-Content -LiteralPath (Join-Path $dist $names[4]) -Value $hashLines -Encoding ascii
  Get-Item -LiteralPath ($names | ForEach-Object { Join-Path $dist $_ }) |
    Select-Object Name, Length, @{n='SHA256';e={(Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()}} |
    Format-Table -AutoSize
} finally {
  Pop-Location
}
