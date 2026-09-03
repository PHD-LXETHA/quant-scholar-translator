# Quant Scholar Translator — remove the Native Messaging host registration.
$ErrorActionPreference = 'SilentlyContinue'

$HostName = 'com.quant_scholar.translator'
$Targets = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
)
foreach ($k in $Targets) {
    if (Test-Path $k) {
        Remove-Item -Path $k -Force
        Write-Host "removed: $k"
    }
}
Write-Host 'Done.'
