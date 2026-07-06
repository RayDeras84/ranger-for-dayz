import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = path.resolve("build");
const iconSvgPath = path.resolve("public", "icon.svg");
const icoPath = path.join(outDir, "icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(iconSvgPath)) {
  throw new Error(`Icon source not found: ${iconSvgPath}`);
}

function existingFile(candidate) {
  return candidate && fs.existsSync(candidate) ? candidate : null;
}

function where(command) {
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    stdio: "pipe"
  });
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findBrowser() {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    process.env.RFDZ_CHROME_PATH,
    programFiles && path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    programFilesX86 && path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    programFiles && path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    programFilesX86 && path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    localAppData && path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    ...where("chrome.exe"),
    ...where("msedge.exe")
  ];

  const browser = candidates.map(existingFile).find(Boolean);
  if (!browser) {
    throw new Error(
      "Chrome or Edge is required to render public/icon.svg. Install one, or set RFDZ_CHROME_PATH."
    );
  }
  return browser;
}

const browserPath = findBrowser();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rfdz-icon-"));
const sourceSvg = fs
  .readFileSync(iconSvgPath, "utf8")
  .replace(/^\uFEFF/, "")
  .replace(/<\?xml[^>]*\?>\s*/i, "");

function setSvgRootAttribute(svg, name, value) {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    const attrPattern = new RegExp(`\\s${name}=("|')[^"']*\\1`, "i");
    if (attrPattern.test(tag)) {
      return tag.replace(attrPattern, ` ${name}="${value}"`);
    }
    return tag.replace(/^<svg\b/i, `<svg ${name}="${value}"`);
  });
}

function sizedSvg(size) {
  return setSvgRootAttribute(setSvgRootAttribute(sourceSvg, "width", size), "height", size);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForFile(filePath) {
  const start = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - start > 5000) {
      throw new Error(`Expected icon render was not created: ${filePath}`);
    }
    sleep(100);
  }
}

try {
  for (const size of sizes) {
    const pngPath = path.join(tempDir, `icon-${size}.png`);
    const sizedSvgPath = path.join(tempDir, `icon-${size}.svg`);
    const profilePath = path.join(tempDir, `chrome-profile-${size}`);
    fs.writeFileSync(sizedSvgPath, sizedSvg(size));

    const result = spawnSync(browserPath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      `--user-data-dir=${profilePath}`,
      "--default-background-color=00000000",
      `--screenshot=${pngPath}`,
      `--window-size=${size},${size}`,
      pathToFileURL(sizedSvgPath).href
    ], {
      encoding: "utf8",
      stdio: "pipe"
    });

    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout);
      process.exit(result.status || 1);
    }

    waitForFile(pngPath);
    const stat = fs.statSync(pngPath);
    if (stat.size === 0) {
      throw new Error(`Rendered empty PNG for ${size}px icon.`);
    }
  }

const psScript = String.raw`
using namespace System.Drawing
using namespace System.Drawing.Drawing2D
using namespace System.Drawing.Imaging
using namespace System.IO

param(
  [string]$ImageDir,
  [string]$IcoPath,
  [string]$SizeList
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$Sizes = $SizeList.Split(",") | ForEach-Object { [int]$_ }

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

$images = @()
foreach ($size in $Sizes) {
  $pngPath = Join-Path $ImageDir ("icon-{0}.png" -f $size)
  $source = [Image]::FromFile($pngPath)
  $bmp = [Bitmap]::new($size, $size, [PixelFormat]::Format32bppArgb)
  $g = [Graphics]::FromImage($bmp)
  $g.CompositingMode = [CompositingMode]::SourceCopy
  $g.DrawImage($source, 0, 0, $size, $size)
  $g.Dispose()
  $source.Dispose()
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
[File]::WriteAllBytes([Path]::GetFullPath($IcoPath), $iconStream.ToArray())
$iconWriter.Dispose()
$iconStream.Dispose()
`;

const scriptPath = path.join(tempDir, "create-icon.ps1");
fs.writeFileSync(scriptPath, psScript);
const result = spawnSync("powershell.exe", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  scriptPath,
  "-ImageDir",
  tempDir,
  "-IcoPath",
  icoPath,
  "-SizeList",
  sizes.join(",")
], {
  encoding: "utf8",
  stdio: "pipe"
});
fs.rmSync(scriptPath, { force: true });

if (result.status !== 0) {
  process.stderr.write(result.stderr || result.stdout);
  process.exit(result.status || 1);
}
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
