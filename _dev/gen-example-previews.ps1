# Generate preview.jpg for the 4 example packages (ASCII-only)
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$root = 'dwp-spec/examples'

function Save-Jpg($bmp, $path) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]82)
  $bmp.Save($path, $codec, $ep)
  $bmp.Dispose()
  Write-Host "saved $path"
}

# rain-night: bg scaled
$src = [System.Drawing.Image]::FromFile("$PWD/$root/rain-night/assets/bg.png")
$bmp = New-Object System.Drawing.Bitmap(1280, 720)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, 0, 0, 1280, 720)
$src.Dispose(); $g.Dispose(); Save-Jpg $bmp "$root/rain-night/preview.jpg"

# water-lake: sky top + water bottom
$sky = [System.Drawing.Image]::FromFile("$PWD/$root/water-lake/assets/sky.png")
$water = [System.Drawing.Image]::FromFile("$PWD/$root/water-lake/assets/water.png")
$bmp = New-Object System.Drawing.Bitmap(1280, 720)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($sky, 0, 0, 1280, 360)
$g.DrawImage($water, 0, 360, 1280, 360)
$sky.Dispose(); $water.Dispose(); $g.Dispose(); Save-Jpg $bmp "$root/water-lake/preview.jpg"

# clock-desk: dark bg + big time text
$bmp = New-Object System.Drawing.Bitmap(1280, 720)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 16, 20, 35))
$b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 11, 14, 26))
$g.FillRectangle($b, 0, 610, 1280, 110); $b.Dispose()
$font = New-Object System.Drawing.Font('Segoe UI', 130, [System.Drawing.FontStyle]::Bold)
$b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 232, 236, 255))
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$g.DrawString('21:37', $font, $b, (New-Object System.Drawing.RectangleF(0, 200, 1280, 260)), $sf)
$b.Dispose()
$b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 122, 162, 255))
$g.FillRectangle($b, 490, 470, 300, 4)
$font2 = New-Object System.Drawing.Font('Segoe UI', 26)
$g.DrawString('2026-08-29 Saturday', $font2, $b, (New-Object System.Drawing.RectangleF(0, 490, 1280, 60)), $sf)
$b.Dispose(); $font.Dispose(); $font2.Dispose(); $g.Dispose(); Save-Jpg $bmp "$root/clock-desk/preview.jpg"

# puppet-breath: composited parts
$bmp = New-Object System.Drawing.Bitmap(1280, 720)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 26, 31, 51))
$b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 18, 22, 42))
$g.FillRectangle($b, 0, 660, 1280, 60); $b.Dispose()
$cx = 640; $feet = 660; $s = 1.1
$body = [System.Drawing.Image]::FromFile("$PWD/$root/puppet-breath/assets/body.png")
$head = [System.Drawing.Image]::FromFile("$PWD/$root/puppet-breath/assets/head.png")
$bangs = [System.Drawing.Image]::FromFile("$PWD/$root/puppet-breath/assets/bangs.png")
$eye = [System.Drawing.Image]::FromFile("$PWD/$root/puppet-breath/assets/eye.png")
# hips bone at feet-300*s; body center at hips+90
$hipsy = $feet - 300 * $s
$g.DrawImage($body, $cx - (260 * $s) / 2, $hipsy + (90 - 210) * $s, 260 * $s, 420 * $s)
$heady = $hipsy - 210 * $s
$g.DrawImage($head, $cx - (200 * $s) / 2, $heady - (210 * $s) / 2, 200 * $s, 210 * $s)
$g.DrawImage($eye, $cx - 46 * $s - 13 * $s, $heady - 10 * $s - 9 * $s, 26 * $s, 18 * $s)
$g.DrawImage($eye, $cx + 46 * $s - 13 * $s, $heady - 10 * $s - 9 * $s, 26 * $s, 18 * $s)
$g.DrawImage($bangs, $cx - (220 * $s) / 2, $heady - 55 * $s - (130 * $s) / 2, 220 * $s, 130 * $s)
$body.Dispose(); $head.Dispose(); $bangs.Dispose(); $eye.Dispose(); $g.Dispose()
Save-Jpg $bmp "$root/puppet-breath/preview.jpg"

Write-Host 'ALL PREVIEWS DONE'
