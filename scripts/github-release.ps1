param(
  [ValidateSet('Inspect', 'Publish', 'CleanOld')]
  [string]$Mode = 'Inspect'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$repository = 'PHD-LXETHA/quant-scholar-translator'
$apiBase = "https://api.github.com/repos/$repository"
$tag = 'v0.7.0'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'

# Use the existing Git credential only in process memory, for its own GitHub
# origin. Never print, persist, or include it in the release package.
Push-Location $projectRoot
try {
  $origin = (& git remote get-url origin).Trim()
  if ($origin -ne "https://github.com/$repository.git") {
    throw 'Refusing to publish: the repository origin does not match.'
  }
  $credentialLines = "protocol=https`nhost=github.com`npath=$repository.git`n`n" | git credential fill
  if ($LASTEXITCODE -ne 0) { throw 'Existing GitHub login is unavailable.' }
  $passwordLine = $credentialLines | Where-Object { $_.StartsWith('password=') } | Select-Object -First 1
  if (-not $passwordLine) { throw 'Existing GitHub login did not provide a credential.' }
  $accessToken = $passwordLine.Substring(9)
  $headers = @{
    Authorization = "Bearer $accessToken"
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2026-03-10'
    'User-Agent' = 'Quant-Scholar-Release'
  }
  $repo = Invoke-RestMethod -Uri $apiBase -Headers $headers
  if (-not $repo.private) { throw 'Refusing to publish: this repository must remain private.' }
  $releases = Invoke-RestMethod -Uri "$apiBase/releases?per_page=30" -Headers $headers

  if ($Mode -eq 'Inspect') {
    [pscustomobject]@{ repository = $repo.full_name; private = $repo.private; default_branch = $repo.default_branch } | ConvertTo-Json
    $releases | Select-Object id, tag_name, name, draft, published_at, @{n='assets';e={@($_.assets | Select-Object name,size)}} | ConvertTo-Json -Depth 5
    return
  }

  $assetNames = @(
    'quant-scholar-translator-professional-0.7.0.zip',
    'quant-scholar-browser-extension-0.7.0.zip',
    'quant-scholar-safari-web-extension-0.7.0.zip',
    'quant_scholar_translator-0.7.0-py3-none-any.whl',
    'SHA256SUMS-0.7.0.txt'
  )
  if ($Mode -eq 'Publish') {
    foreach ($name in $assetNames) {
      if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "dist\$name"))) {
        throw "Missing release artifact: $name"
      }
    }
    $release = $releases | Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
    $body = (Get-Content -LiteralPath (Join-Path $projectRoot 'docs\RELEASE_NOTES_0.7.0.md') -Raw -Encoding utf8) + "`n`n---`n`n" + (Get-Content -LiteralPath (Join-Path $projectRoot 'docs\RELEASE_NOTES_0.7.0_EN.md') -Raw -Encoding utf8)
    if (-not $release) {
      $payload = @{ tag_name=$tag; target_commitish=((& git rev-parse HEAD).Trim()); name='Quant Scholar Translator 0.7.0 · Professional Translation'; body=$body; draft=$true; prerelease=$false } | ConvertTo-Json -Depth 4
      $release = Invoke-RestMethod -Method Post -Uri "$apiBase/releases" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    }
    if (-not $release.draft) { throw 'Release already published; inspect it instead of overwriting assets.' }
    foreach ($name in $assetNames) {
      if ($release.assets.name -contains $name) { continue }
      $path = Join-Path $projectRoot "dist\$name"
      $uploadUrl = $release.upload_url.Split('{')[0] + '?name=' + [Uri]::EscapeDataString($name)
      $uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -ContentType 'application/octet-stream' -InFile $path
      if ($uploaded.size -ne (Get-Item -LiteralPath $path).Length) { throw "Upload size mismatch: $name" }
      Write-Host "Uploaded: $name"
    }
    $release = Invoke-RestMethod -Uri "$apiBase/releases/$($release.id)" -Headers $headers
    foreach ($name in $assetNames) {
      if ($release.assets.name -notcontains $name) { throw "Upload verification failed: $name" }
    }
    $payload = @{ draft=$false; make_latest='true'; body=$body } | ConvertTo-Json
    $release = Invoke-RestMethod -Method Patch -Uri "$apiBase/releases/$($release.id)" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
    [pscustomobject]@{ url=$release.html_url; tag=$release.tag_name; draft=$release.draft; assets=@($release.assets.name) } | ConvertTo-Json
    return
  }

  # Only the two explicitly superseded project releases are eligible. Preserve
  # all Git tags and source history; never delete unrelated releases or repos.
  $current = $releases | Where-Object { $_.tag_name -eq $tag -and -not $_.draft } | Select-Object -First 1
  if (-not $current) { throw 'The replacement release is not published; old releases were not touched.' }
  foreach ($name in $assetNames) {
    if ($current.assets.name -notcontains $name) { throw 'Replacement assets are incomplete; old releases were not touched.' }
  }
  foreach ($old in @($releases | Where-Object { $_.tag_name -in @('v0.4.0','v0.5.0') })) {
    Invoke-RestMethod -Method Delete -Uri "$apiBase/releases/$($old.id)" -Headers $headers | Out-Null
    Write-Host "Removed old release and attached packages: $($old.tag_name). Git tag and source history preserved."
  }
} finally {
  $accessToken = $null
  $passwordLine = $null
  $credentialLines = $null
  $headers = $null
  Pop-Location
}
