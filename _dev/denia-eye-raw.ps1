param(
  [string]$Dir = '_dev\denia-out\truth',
  [int]$X = 1285, [int]$Y = 645, [int]$W = 110, [int]$H = 145,
  [string]$RawOut = '_dev\denia-out\truth-eye.raw'
)
# Dump the eye region of every captured frame as raw Format32bppArgb bytes.
# ASCII-only comments: Windows PowerShell 5.1 misreads UTF-8 Chinese in .ps1 files.
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem -Path $Dir -Filter 'f*.jpg' | Sort-Object Name
$path = Join-Path (Get-Location) $RawOut
$fs = [System.IO.File]::Create($path)
$count = 0
try {
  foreach ($f in $files) {
    $img = [System.Drawing.Image]::FromFile($f.FullName)
    $bmp = New-Object System.Drawing.Bitmap $img
    $img.Dispose()
    $rect = New-Object System.Drawing.Rectangle $X, $Y, $W, $H
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    # LockBits on a sub-rect keeps the FULL-image stride, so copy row by row.
    $stride = $data.Stride
    $rowBytes = $W * 4
    $bytes = [byte[]]::new($rowBytes * $H)
    for ($y = 0; $y -lt $H; $y++) {
      $src = [System.IntPtr]([int64]$data.Scan0 + [int64]($y * $stride))
      [System.Runtime.InteropServices.Marshal]::Copy($src, $bytes, $y * $rowBytes, $rowBytes)
    }
    $bmp.UnlockBits($data)
    $bmp.Dispose()
    $fs.Write($bytes, 0, $bytes.Length)
    $count++
  }
} finally { $fs.Dispose() }
Write-Output ("raw written: " + $path + " frames=" + $count + " " + $W + "x" + $H)
