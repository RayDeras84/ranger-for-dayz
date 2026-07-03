import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve("build");
fs.mkdirSync(outDir, { recursive: true });

const psScript = String.raw`
using namespace System.Drawing
using namespace System.Drawing.Drawing2D
using namespace System.Drawing.Imaging
using namespace System.IO

Add-Type -AssemblyName System.Drawing

$outDir = Resolve-Path "build"
$icoPath = Join-Path $outDir "icon.ico"

function Brush($hex) {
  return [SolidBrush]::new([ColorTranslator]::FromHtml($hex))
}

function PenC($hex, $width) {
  $p = [Pen]::new([ColorTranslator]::FromHtml($hex), $width)
  $p.StartCap = [LineCap]::Round
  $p.EndCap = [LineCap]::Round
  return $p
}

function RoundedRectPath($x, $y, $w, $h, $r) {
  $p = [GraphicsPath]::new()
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function FillRound($g, $x, $y, $w, $h, $r, $hex) {
  $p = RoundedRectPath $x $y $w $h $r
  $g.FillPath((Brush $hex), $p)
  $p.Dispose()
}

function DrawIconBitmap($size) {
  $bmp = [Bitmap]::new($size, $size, [PixelFormat]::Format32bppArgb)
  $g = [Graphics]::FromImage($bmp)
  $g.SmoothingMode = [SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $scale = $size / 256
  $g.ScaleTransform($scale, $scale)
  $g.Clear([Color]::Transparent)

  FillRound $g 0 0 256 256 58 "#080d0b"

  $field = RoundedRectPath 14 14 228 228 49
  $fieldBrush = [LinearGradientBrush]::new([RectangleF]::new(14, 14, 228, 228), [ColorTranslator]::FromHtml("#24392e"), [ColorTranslator]::FromHtml("#314533"), 135)
  $g.FillPath($fieldBrush, $field)
  $fieldBrush.Dispose()
  $field.Dispose()

  $green = PenC "#82ad79" 13
  $yellow = PenC "#f0d47b" 13
  $g.DrawArc($green, [RectangleF]::new(51, 51, 154, 154), 205, 92)
  $g.DrawArc($yellow, [RectangleF]::new(79, 79, 98, 98), 205, 92)
  $g.FillEllipse((Brush "#f0d47b"), 169, 92, 20, 20)
  $green.Dispose()
  $yellow.Dispose()

  $font = [Font]::new("Segoe UI Black", 88, [FontStyle]::Bold, [GraphicsUnit]::Pixel)
  $format = [StringFormat]::GenericTypographic
  $format.FormatFlags = $format.FormatFlags -bor [StringFormatFlags]::NoClip
  $g.DrawString("RD", $font, (Brush "#eef2df"), [PointF]::new(43, 99), $format)
  $font.Dispose()
  $format.Dispose()

  $zPen = PenC "#f0d47b" 13
  $zPen.LineJoin = [LineJoin]::Round
  $g.DrawLines($zPen, [PointF[]]@(
    [PointF]::new(171, 126),
    [PointF]::new(216, 126),
    [PointF]::new(178, 184),
    [PointF]::new(220, 184)
  ))
  $zPen.Dispose()

  $g.Dispose()
  return $bmp
}

function BitmapToDib($bmp) {
  $size = $bmp.Width
  $pixelBytes = $size * $size * 4
  $maskStride = [int]([Math]::Ceiling($size / 32) * 4)
  $maskBytes = $maskStride * $size
  $ms = [MemoryStream]::new()
  $bw = [BinaryWriter]::new($ms)

  $bw.Write([UInt32]40)
  $bw.Write([Int32]$size)
  $bw.Write([Int32]($size * 2))
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]0)
  $bw.Write([UInt32]($pixelBytes + $maskBytes))
  $bw.Write([Int32]0)
  $bw.Write([Int32]0)
  $bw.Write([UInt32]0)
  $bw.Write([UInt32]0)

  for ($y = $size - 1; $y -ge 0; $y -= 1) {
    for ($x = 0; $x -lt $size; $x += 1) {
      $c = $bmp.GetPixel($x, $y)
      $bw.Write([byte]$c.B)
      $bw.Write([byte]$c.G)
      $bw.Write([byte]$c.R)
      $bw.Write([byte]$c.A)
    }
  }

  if ($maskBytes -gt 0) {
    $bw.Write([byte[]]::new($maskBytes))
  }

  $bw.Flush()
  $dib = $ms.ToArray()
  $bw.Dispose()
  $ms.Dispose()
  return $dib
}

$sizes = @(32, 64, 128, 256)
$images = @()
foreach ($size in $sizes) {
  $bmp = DrawIconBitmap $size
  $images += [PSCustomObject]@{ Size = $size; Dib = BitmapToDib $bmp }
  $bmp.Dispose()
}

$iconStream = [MemoryStream]::new()
$iconWriter = [BinaryWriter]::new($iconStream)
$iconWriter.Write([UInt16]0)
$iconWriter.Write([UInt16]1)
$iconWriter.Write([UInt16]$images.Count)

$offset = 6 + ($images.Count * 16)
foreach ($image in $images) {
  $sizeByte = if ($image.Size -eq 256) { 0 } else { [byte]$image.Size }
  $iconWriter.Write([byte]$sizeByte)
  $iconWriter.Write([byte]$sizeByte)
  $iconWriter.Write([byte]0)
  $iconWriter.Write([byte]0)
  $iconWriter.Write([UInt16]1)
  $iconWriter.Write([UInt16]32)
  $iconWriter.Write([UInt32]$image.Dib.Length)
  $iconWriter.Write([UInt32]$offset)
  $offset += $image.Dib.Length
}

foreach ($image in $images) {
  $iconWriter.Write([byte[]]$image.Dib)
}

$iconWriter.Flush()
[File]::WriteAllBytes($icoPath, $iconStream.ToArray())
$iconWriter.Dispose()
$iconStream.Dispose()
`;

const scriptPath = path.join(outDir, "create-icon.ps1");
fs.writeFileSync(scriptPath, psScript);
const result = spawnSync("powershell.exe", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  scriptPath
], {
  encoding: "utf8",
  stdio: "pipe"
});
fs.rmSync(scriptPath, { force: true });

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
