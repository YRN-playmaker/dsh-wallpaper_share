param(
  [string]$Dir = '_dev\denia-out\truth',
  [int]$X = 1280, [int]$Y = 620, [int]$W = 200, [int]$H = 180,
  [double]$Zoom = 4,
  [int]$Start = 0, [int]$Step = 2, [int]$Count = 64, [int]$Cols = 8,
  [string]$Out = '_dev\denia-out\truth-crop.png'
)
# Crop/zoom captured frames and tile them into one contact sheet.
# ASCII-only: Windows PowerShell 5.1 misreads UTF-8 Chinese in .ps1 files.
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem -Path $Dir -Filter 'f*.jpg' | Sort-Object Name
$sel = @()
for ($i = $Start; $i -lt $files.Count -and $sel.Count -lt $Count; $i += $Step) { $sel += $files[$i] }
$tw = [int]($W * $Zoom); $th = [int]($H * $Zoom)
$rows = [int][math]::Ceiling($sel.Count / $Cols)
$label = 16
$sheet = New-Object System.Drawing.Bitmap ([int]($tw * $Cols)), ([int](($th + $label) * $rows))
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.Clear([System.Drawing.Color]::FromArgb(255, 30, 30, 30))
$font = New-Object System.Drawing.Font 'Consolas', 12
$brush = [System.Drawing.Brushes]::White
$idx = 0
foreach ($f in $sel) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  $bmp = New-Object System.Drawing.Bitmap $img
  $img.Dispose()
  $cx = [int]($idx % $Cols) * $tw
  $cy = [int][math]::Floor($idx / $Cols) * ($th + $label)
  $rectDst = New-Object System.Drawing.Rectangle $cx, ($cy + $label), $tw, $th
  $rectSrc = New-Object System.Drawing.Rectangle $X, $Y, $W, $H
  $g.DrawImage($bmp, $rectDst, $rectSrc, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString($f.BaseName, $font, $brush, $cx + 2, $cy + 1)
  $bmp.Dispose()
  $idx++
}
$g.Dispose()
$full = Join-Path (Get-Location) $Out
$sheet.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
Write-Output ("sheet=" + $full + " tiles=" + $sel.Count + " region=" + $X + "," + $Y + " " + $W + "x" + $H + " zoom=" + $Zoom)
