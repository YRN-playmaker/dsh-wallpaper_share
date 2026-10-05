param(
  [string]$Dir = '_dev\denia-out\truth',
  [int]$X = 1285, [int]$Y = 645, [int]$W = 110, [int]$H = 145
)
# 逐帧分析眼睛区域的亮度与帧间差异（32bppArgb LockBits）
Add-Type -AssemblyName System.Drawing
$files = Get-ChildItem -Path $Dir -Filter 'f*.jpg' | Sort-Object Name
$prev = $null
$rows = @()
$i = 0
foreach ($f in $files) {
  $bmp = New-Object System.Drawing.Bitmap $f.FullName
  $rect = New-Object System.Drawing.Rectangle $X, $Y, $W, $H
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $H)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  $bmp.Dispose()
  $lum = 0.0; $n = 0; $diff = 0.0
  for ($y = 0; $y -lt $H; $y++) {
    $off = $y * $data.Stride
    for ($x = 0; $x -lt $W; $x++) {
      $p = $off + $x * 4
      $b = $bytes[$p]; $g = $bytes[$p + 1]; $r = $bytes[$p + 2]
      $v = 0.114 * $b + 0.587 * $g + 0.299 * $r
      $lum += $v; $n++
      if ($null -ne $prev) {
        $q = $p
        $dv = $v - $prev[$q]
        if ($dv -lt 0) { $dv = -$dv }
        $diff += $dv
      }
    }
  }
  $rows += [pscustomobject]@{ Frame = $i; Lum = [math]::Round($lum / $n, 2); Diff = if ($null -eq $prev) { 0 } else { [math]::Round($diff / $n, 3) } }
  $prev = $bytes
  $i++
}
$rows | Format-Table -AutoSize | Out-String -Width 200
$peak = ($rows | Sort-Object Diff -Descending | Select-Object -First 20)
Write-Output '--- top-20 diff frames ---'
$peak | Format-Table -AutoSize | Out-String -Width 200
