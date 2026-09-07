$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'apps\safari-extension\*'
$output = Join-Path $projectRoot 'dist\quant-scholar-safari-web-extension-0.8.1.zip'

New-Item -ItemType Directory -Path (Split-Path -Parent $output) -Force | Out-Null
if (Test-Path -LiteralPath $output) {
  Remove-Item -LiteralPath $output -Force
}
Compress-Archive -Path $source -DestinationPath $output -CompressionLevel Optimal
Write-Host "Safari Web Extension source package: $output"
