param(
  [string]$Token
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $pythonExe)) {
  throw '环境尚未安装。请先运行：powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1'
}

if ([string]::IsNullOrWhiteSpace($Token)) {
  $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
  $Token = [Convert]::ToHexString($bytes).ToLowerInvariant()
}

$addresses = @(
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress -Unique
)

$env:KAMI_HOST = '0.0.0.0'
$env:QS_MOBILE_TOKEN = $Token

Write-Host ''
Write-Host 'Quant Scholar 移动服务已准备。'
Write-Host "配对令牌：$Token"
foreach ($address in $addresses) {
  Write-Host "手机/平板打开：http://${address}:8765/mobile/"
}
Write-Host '电脑与移动设备必须连接同一可信局域网。关闭此窗口会停止移动服务。'
Write-Host ''

Push-Location $projectRoot
try {
  & $pythonExe -m quant_scholar_translator serve
} finally {
  Pop-Location
}
