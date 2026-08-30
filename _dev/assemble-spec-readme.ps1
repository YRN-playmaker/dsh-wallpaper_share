# assemble dwp-spec/README.md = intro + spec body (draft minus its H1 line)
$ErrorActionPreference = 'Stop'
$intro = Get-Content _dev/spec-intro.md -Raw -Encoding UTF8
$draft = Get-Content docs/dwp-spec-draft.md -Raw -Encoding UTF8
# strip first line (old H1)
$nl = $draft.IndexOf("`n")
if ($nl -lt 0) { throw 'unexpected draft format' }
$body = $draft.Substring($nl + 1)
$out = $intro + $body
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText("$PWD/dwp-spec/README.md", $out, $enc)
Write-Host "README.md written: $($out.Length) chars"
