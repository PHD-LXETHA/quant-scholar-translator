# Quant Scholar Translator — install the Native Messaging host (current user).
#
# What this does:
#   1) Renders the host manifest template with the absolute path to launcher.bat
#   2) Writes it next to the template as com.quant_scholar.translator.json
#   3) Registers it in HKCU so Chrome can find it:
#        HKCU\Software\Google\Chrome\NativeMessagingHosts\com.quant_scholar.translator
#        (default) -> full path to com.quant_scholar.translator.json
#
# Run from PowerShell (no admin needed — HKCU only):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId <Chrome 显示的扩展 ID>
#
# After install:
#   - Reload the extension in chrome://extensions.

param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId
)

$ErrorActionPreference = 'Stop'

$HostDir       = Split-Path -Parent $MyInvocation.MyCommand.Path
$Template      = Join-Path $HostDir 'com.quant_scholar.translator.json.template'
$Manifest      = Join-Path $HostDir 'com.quant_scholar.translator.json'
$LauncherBat   = Join-Path $HostDir 'launcher.bat'
$HostName      = 'com.quant_scholar.translator'

if (-not (Test-Path $Template))    { throw "template missing: $Template" }
if (-not (Test-Path $LauncherBat)) { throw "launcher.bat missing: $LauncherBat" }

# Render template — JSON requires forward slashes or escaped backslashes.
$bat = $LauncherBat.Replace('\', '/')
$rendered = (Get-Content $Template -Raw) -replace '__LAUNCHER_BAT_PATH__', $bat
$rendered = $rendered -replace '__EXTENSION_ID__', $ExtensionId
$rendered |
    Set-Content -Path $Manifest -Encoding UTF8 -NoNewline

Write-Host "wrote $Manifest"

# Register for Chrome (and Edge — both honor the Chrome key).
$Targets = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'
)
foreach ($base in $Targets) {
    if (-not (Test-Path $base)) { New-Item -Path $base -Force | Out-Null }
    $key = Join-Path $base $HostName
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name '(default)' -Value $Manifest
    Write-Host "registered: $key  ->  $Manifest"
}

Write-Host ''
Write-Host 'Done. Reload the extension at chrome://extensions and click Start.'
