param(
  [string]$Dir = '_dev\denia-out\truth',
  [string]$Frames = '0,120',
  [string]$Out = '_dev\denia-out\truth-full.raw'
)
# Dump FULL frames as raw Format32bppArgb for cross-frame comparison.
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem -Path $Dir -Filter 'f*.jpg' | Sort-Object Name
$idx = $Frames.Split(',') | ForEach-Object { [int]$_ }
$fs = [System.IO.File]::Create((Join-Path (Get-Location) $Out))
try {
  foreach ($i in $idx) {
    $f = $files[$i]
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    $bmp = New-Object System.Drawing.Bitmap $img
    $img.Dispose()
    $w = $bmp.Width; $h = $bmp.Height
    $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride
    $rowBytes = $w * 4
    $bytes = [byte[]]::new($rowBytes * $h)
    for ($y = 0; $y -lt $h; $y++) {
      $src = [System.IntPtr]([int64]$data.Scan0 + [int64]($y * $stride))
      [System.Runtime.InteropServices.Marshal]::Copy($src, $bytes, $y * $rowBytes, $rowBytes)
    }
    $bmp.UnlockBits($data)
    $bmp.Dispose()
    $fs.Write($bytes, 0, $bytes.Length)
    Write-Output ("frame " + $i + " " + $w + "x" + $h)
  }
} finally { $fs.Dispose() }
