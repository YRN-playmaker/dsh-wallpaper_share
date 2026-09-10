# Publish / re-publish "DeepSeek Day & Night" to the DWP market.
#
# Run it in a normal PowerShell 7 or Windows PowerShell 5.1 window:
#     $env:GH_TOKEN = '<token>'; pwsh -File _dev\publish-daynight.ps1
#     pwsh -File _dev\publish-daynight.ps1 -Token <token>
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads BOM-less files as
# ANSI/GBK, so non-ASCII text here would be mangled into a parse error.
#
# Token needs write access to YRN-playmaker/dwp-releases and YRN-playmaker/dwp-registry
# (classic: repo/public_repo; fine-grained: Contents + Pull requests = Read and write).
#
# Idempotent: reuses an existing release, replaces a same-named asset, recreates the
# registry branch. Verifies the uploaded bytes by re-downloading before touching the registry.
[CmdletBinding()]
param(
  [string]$Token = $env:GH_TOKEN,
  [string]$Owner = 'YRN-playmaker',
  [string]$ReleaseRepo = 'dwp-releases',
  [string]$RegistryRepo = 'dwp-registry',
  [string]$Tag = 'deepseek-day-night-1.1.0',
  [string]$Version = '1.1.0',
  [string]$Asset = 'deepseek-day-night.dwp',
  [string]$Preview = 'deepseek-day-night.png',
  [string]$EntryId = 'yrn.deepseek-day-night',
  [string]$Branch = 'deepseek-day-night',
  [switch]$SkipRegistry
)

$ErrorActionPreference = 'Stop'
$API = 'https://api.github.com'
$Root = Split-Path $PSScriptRoot -Parent

if ([string]::IsNullOrWhiteSpace($Token)) { throw 'No token: set $env:GH_TOKEN or pass -Token' }
$H = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'dwp-publish' }

Write-Host "[0/4] credentials" -ForegroundColor Cyan
Write-Host ('  login = ' + (Invoke-RestMethod -Uri "$API/user" -Headers $H -UseBasicParsing).login)

$pkgLocal = Join-Path $Root ('_dist\daynight\{0}-{1}.dwp' -f $EntryId, $Version)
if (-not (Test-Path $pkgLocal)) { throw "Package not found: $pkgLocal (run: node _dev\make-daynight-dwp.mjs)" }
$prevLocal = Join-Path $Root ('_dist\daynight\{0}' -f $Preview)
if (-not (Test-Path $prevLocal)) { throw "Preview not found: $prevLocal" }
$assetTmp = Join-Path $env:TEMP $Asset
Copy-Item $pkgLocal $assetTmp -Force
$shaLocal = 'sha512-' + [Convert]::ToBase64String([Security.Cryptography.SHA512]::Create().ComputeHash([IO.File]::ReadAllBytes($assetTmp)))
Write-Host ('  package ' + (Get-Item $assetTmp).Length + ' B')
Write-Host ('  ' + $shaLocal)

Write-Host "[1/4] preview -> $ReleaseRepo main:previews/$Preview" -ForegroundColor Cyan
$body = @{ message = 'deepseek-day-night: add preview'; content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($prevLocal)); branch = 'main' }
try { $body.sha = (Invoke-RestMethod -Uri "$API/repos/$Owner/$ReleaseRepo/contents/previews/$Preview" -Headers $H -UseBasicParsing).sha } catch { }
$r1 = Invoke-RestMethod -Method Put -Uri "$API/repos/$Owner/$ReleaseRepo/contents/previews/$Preview" -Headers $H -Body ($body | ConvertTo-Json -Compress -Depth 5) -ContentType 'application/json' -UseBasicParsing
Write-Host ('  ' + $r1.content.html_url)

Write-Host "[2/4] release $Tag + asset" -ForegroundColor Cyan
$rel = $null
try { $rel = Invoke-RestMethod -Uri "$API/repos/$Owner/$ReleaseRepo/releases/tags/$Tag" -Headers $H -UseBasicParsing } catch { }
if (-not $rel) {
  $rb = @{ tag_name = $Tag; name = 'DeepSeek Day & Night 1.0.0'; body = "Two full-canvas images switched by local time: night image from 18:00 to 06:00, day image otherwise, 10-minute linear crossfade at both boundaries.`n`n- 1920x1080, two image layers + an opacity effect driven by the clock variables fed by dsh-wallpaper_share.`n- id: $EntryId  license: content CC-BY-4.0 / code MIT" }
  $rel = Invoke-RestMethod -Method Post -Uri "$API/repos/$Owner/$ReleaseRepo/releases" -Headers $H -Body ($rb | ConvertTo-Json -Compress -Depth 5) -ContentType 'application/json' -UseBasicParsing
  Write-Host ('  created ' + $rel.tag_name)
} else { Write-Host ('  reusing ' + $rel.tag_name) }
$old = $rel.assets | Where-Object { $_.name -eq $Asset }
if ($old) {
  Invoke-RestMethod -Method Delete -Uri "$API/repos/$Owner/$ReleaseRepo/releases/assets/$($old.id)" -Headers $H -UseBasicParsing | Out-Null
  Write-Host '  removed previous asset with the same name'
}
$up = ($rel.upload_url -replace '\{\?name,label\}', '') + '?name=' + $Asset
$ul = Invoke-RestMethod -Method Post -Uri $up -Headers $H -ContentType 'application/octet-stream' -InFile $assetTmp -UseBasicParsing
Write-Host ('  uploaded ' + $ul.name + ' (' + $ul.size + ' B)')

Write-Host '[3/4] verify by re-download' -ForegroundColor Cyan
$dl = Join-Path $env:TEMP ('verify-' + $Asset)
Invoke-WebRequest -Uri "https://github.com/$Owner/$ReleaseRepo/releases/download/$Tag/$Asset" -OutFile $dl -UseBasicParsing -Headers @{ 'User-Agent' = 'dwp-publish' }
$shaDl = 'sha512-' + [Convert]::ToBase64String([Security.Cryptography.SHA512]::Create().ComputeHash([IO.File]::ReadAllBytes($dl)))
$ok = ($shaDl -eq $shaLocal) -and ((Get-Item $dl).Length -eq (Get-Item $assetTmp).Length)
Write-Host ('  downloaded ' + (Get-Item $dl).Length + ' B  match=' + $ok) -ForegroundColor ($(if ($ok) { 'Green' } else { 'Red' }))
if (-not $ok) { throw 'Uploaded bytes differ from local package - aborting before the registry step' }

if ($SkipRegistry) { Write-Host '[4/4] skipped (-SkipRegistry)' -ForegroundColor Yellow; return }

Write-Host "[4/4] registry branch + PR" -ForegroundColor Cyan
$base = Invoke-RestMethod -Uri "$API/repos/$Owner/$RegistryRepo/git/ref/heads/main" -Headers $H -UseBasicParsing
try { Invoke-RestMethod -Method Delete -Uri "$API/repos/$Owner/$RegistryRepo/git/refs/heads/$Branch" -Headers $H -UseBasicParsing | Out-Null } catch { }
Invoke-RestMethod -Method Post -Uri "$API/repos/$Owner/$RegistryRepo/git/refs" -Headers $H -Body (@{ ref = "refs/heads/$Branch"; sha = $base.object.sha } | ConvertTo-Json -Compress -Depth 5) -ContentType 'application/json' -UseBasicParsing | Out-Null
Write-Host ('  branch ' + $Branch + ' @ ' + $base.object.sha.Substring(0, 7))
foreach ($f in @(@{ p = "entries/$EntryId.yml"; l = "dwp-registry\entries\$EntryId.yml" }, @{ p = 'data/catalog.json'; l = 'dwp-registry\data\catalog.json' })) {
  $loc = Join-Path $Root $f.l
  if (-not (Test-Path $loc)) { throw "Not found: $loc" }
  $b = @{ message = "deepseek-day-night: update entry ($Tag)"; content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($loc)); branch = $Branch }
  try { $b.sha = (Invoke-RestMethod -Uri "$API/repos/$Owner/$RegistryRepo/contents/$($f.p)?ref=$Branch" -Headers $H -UseBasicParsing).sha } catch { }
  Invoke-RestMethod -Method Put -Uri "$API/repos/$Owner/$RegistryRepo/contents/$($f.p)" -Headers $H -Body ($b | ConvertTo-Json -Compress -Depth 5) -ContentType 'application/json' -UseBasicParsing | Out-Null
  Write-Host ('  committed ' + $f.p)
}
$pr = Invoke-RestMethod -Method Post -Uri "$API/repos/$Owner/$RegistryRepo/pulls" -Headers $H -Body (@{
  title = 'deepseek-day-night: update DeepSeek Day & Night (' + $Tag + ')'
  head  = $Branch
  base  = 'main'
  body  = ("Package: https://github.com/$Owner/$ReleaseRepo/releases/download/$Tag/$Asset`n`n- id: $EntryId`n- integrity (re-verified after upload): $shaLocal`n- size: " + (Get-Item $assetTmp).Length)
} | ConvertTo-Json -Compress -Depth 5) -ContentType 'application/json' -UseBasicParsing
Write-Host ''
Write-Host 'Done' -ForegroundColor Green
Write-Host ('  release : https://github.com/{0}/{1}/releases/tag/{2}' -f $Owner, $ReleaseRepo, $Tag)
Write-Host ('  preview : https://raw.githubusercontent.com/{0}/{1}/main/previews/{2}' -f $Owner, $ReleaseRepo, $Preview)
Write-Host ('  PR      : ' + $pr.html_url)
Write-Host '  Merge the PR (CI must be green) to make it visible in Library -> Market.'
