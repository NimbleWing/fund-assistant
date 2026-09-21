Add-Type -AssemblyName System.Drawing

$outDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-FundIcon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  $r = [int]($size * 0.22)
  $d = $r * 2
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc(0, 0, $d, $d, 180, 90)
  $p.AddArc($size - $d - 1, 0, $d, $d, 270, 90)
  $p.AddArc($size - $d - 1, $size - $d - 1, $d, $d, 0, 90)
  $p.AddArc(0, $size - $d - 1, $d, $d, 90, 90)
  $p.CloseFigure()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $c1 = [System.Drawing.Color]::FromArgb(255, 56, 189, 248)  # sky-400
  $c2 = [System.Drawing.Color]::FromArgb(255, 79, 70, 229)   # indigo-600
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45)
  $g.FillPath($brush, $p)

  $w = [float]([Math]::Max(1.5, $size * 0.10))
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $w)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

  # 上行折线（净值走势示意）+ 底线
  $g.DrawLine($pen, [float]($size * 0.20), [float]($size * 0.64), [float]($size * 0.44), [float]($size * 0.46))
  $g.DrawLine($pen, [float]($size * 0.44), [float]($size * 0.46), [float]($size * 0.58), [float]($size * 0.56))
  $g.DrawLine($pen, [float]($size * 0.58), [float]($size * 0.56), [float]($size * 0.80), [float]($size * 0.28))
  $g.DrawLine($pen, [float]($size * 0.22), [float]($size * 0.80), [float]($size * 0.78), [float]($size * 0.80))

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $brush.Dispose(); $p.Dispose(); $g.Dispose(); $bmp.Dispose()

  $check = [System.Drawing.Image]::FromFile($path)
  Write-Output "$path => $($check.Width)x$($check.Height)"
  $check.Dispose()
}

New-FundIcon 16 (Join-Path $outDir 'icon-16.png')
New-FundIcon 48 (Join-Path $outDir 'icon-48.png')
New-FundIcon 128 (Join-Path $outDir 'icon-128.png')
