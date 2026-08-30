# Generate dwp-spec example textures (ASCII-only for PS 5.1 compat)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$root = 'dwp-spec/examples'

function Save-Png($bmp, $path) {
  $dir = Split-Path $path -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "saved $path"
}

# rain-night bg.png 1920x1080 night gradient + windows + stars
$bmp = New-Object System.Drawing.Bitmap(1920, 1080)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$rect = New-Object System.Drawing.Rectangle(0, 0, 1920, 1080)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.Color]::FromArgb(255, 8, 12, 28),
  [System.Drawing.Color]::FromArgb(255, 34, 44, 82), 90.0)
$g.FillRectangle($brush, $rect)
$rnd = New-Object System.Random(42)
for ($i = 0; $i -lt 140; $i++) {
  $x = $rnd.Next(0, 1920); $y = $rnd.Next(500, 1080)
  $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(200, 255, 224, 150))
  $g.FillRectangle($b, $x, $y, 3, 4); $b.Dispose()
}
for ($i = 0; $i -lt 60; $i++) {
  $x = $rnd.Next(0, 1920); $y = $rnd.Next(0, 380)
  $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120, 255, 255, 255))
  $g.FillEllipse($b, $x, $y, 2, 2); $b.Dispose()
}
$brush.Dispose(); $g.Dispose(); Save-Png $bmp "$root/rain-night/assets/bg.png"

# rain-night rain.png 8x64 soft streak
$bmp = New-Object System.Drawing.Bitmap(8, 64)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$r2 = New-Object System.Drawing.Rectangle(0, 0, 8, 64)
$lb = New-Object System.Drawing.Drawing2D.LinearGradientBrush($r2,
  [System.Drawing.Color]::FromArgb(0, 200, 220, 255),
  [System.Drawing.Color]::FromArgb(180, 200, 220, 255), 0.0)
$g.FillRectangle($lb, 3, 0, 2, 64); $lb.Dispose()
$g.Dispose(); Save-Png $bmp "$root/rain-night/assets/rain.png"

# water-lake sky.png 1920x540 dusk gradient + sun
$bmp = New-Object System.Drawing.Bitmap(1920, 540)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$rect = New-Object System.Drawing.Rectangle(0, 0, 1920, 540)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.Color]::FromArgb(255, 24, 24, 64),
  [System.Drawing.Color]::FromArgb(255, 232, 128, 88), 90.0)
$g.FillRectangle($brush, $rect)
$b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 255, 214, 140))
$g.FillEllipse($b, 880, 380, 160, 160); $b.Dispose()
$brush.Dispose(); $g.Dispose(); Save-Png $bmp "$root/water-lake/assets/sky.png"

# water-lake water.png 1920x540 water gradient + ripples
$bmp = New-Object System.Drawing.Bitmap(1920, 540)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$rect = New-Object System.Drawing.Rectangle(0, 0, 1920, 540)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.Color]::FromArgb(255, 200, 110, 70),
  [System.Drawing.Color]::FromArgb(255, 18, 22, 48), 90.0)
$g.FillRectangle($brush, $rect)
$rnd = New-Object System.Random(7)
for ($i = 0; $i -lt 260; $i++) {
  $y = $rnd.Next(0, 540); $x = $rnd.Next(0, 1920); $w = $rnd.Next(20, 180)
  $a = [int](40 - ($y / 540.0) * 30)
  $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, 255, 255, 255))
  $g.FillRectangle($b, $x, $y, $w, 2); $b.Dispose()
}
$brush.Dispose(); $g.Dispose(); Save-Png $bmp "$root/water-lake/assets/water.png"

# puppet-breath parts
function New-Part($path, $w, $h, [byte]$r, [byte]$gr, [byte]$bl, [string]$shape) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $r, $gr, $bl))
  if ($shape -eq 'ellipse') {
    $g.FillEllipse($brush, 0, 0, $w - 1, $h - 1)
  } elseif ($shape -eq 'body') {
    $pts = @(
      (New-Object System.Drawing.PointF([float]($w/2), [float]0)),
      (New-Object System.Drawing.PointF([float]($w - 10), [float]($h*0.35))),
      (New-Object System.Drawing.PointF([float]($w - 1), [float]($h - 1))),
      (New-Object System.Drawing.PointF([float]0, [float]($h - 1))),
      (New-Object System.Drawing.PointF([float]10, [float]($h*0.35)))
    )
    $g.FillPolygon($brush, $pts)
  } elseif ($shape -eq 'bangs') {
    $g.FillPie($brush, 0, [int](-$h*0.6), $w - 1, [int]($h*1.9), 180, 180)
  }
  $brush.Dispose(); $g.Dispose(); Save-Png $bmp $path
}
New-Part "$root/puppet-breath/assets/body.png" 260 420 90 110 200 'body'
New-Part "$root/puppet-breath/assets/head.png" 200 210 255 224 196 'ellipse'
New-Part "$root/puppet-breath/assets/bangs.png" 220 130 60 60 96 'bangs'
New-Part "$root/puppet-breath/assets/eye.png" 26 18 40 60 120 'ellipse'

Write-Host 'ALL TEXTURES DONE'
