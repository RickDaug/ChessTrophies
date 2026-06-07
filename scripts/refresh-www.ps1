# refresh-www.ps1 - Windows-native equivalent of refresh-www.sh.
#
# Regenerates the gitignored www/ Capacitor bundle from the repo-root client
# files, re-applies the two required patches with UTF-8-safe I/O, and runs
# `npx cap sync` so the Android project picks up the changes.
#
# Run from anywhere -- the script cd's to the repo root (its own parent dir).
#
# WHY THIS EXISTS (and why not use the .sh on Windows): PowerShell 5.1's
# Get-Content -Raw / Out-File default to Windows-1252 for files without a BOM,
# which silently mangles multi-byte UTF-8 sequences (em-dashes, emoji, arrows)
# into mojibake when round-tripped. .NET's [System.IO.File]::ReadAllText /
# WriteAllText with an explicit UTF-8 encoding does NOT have this bug.
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $scriptDir '..')

$files = @(
  'index.html','app.js','academy.js','sounds.js','stockfish-ai.js',
  'chess.min.js','chess960.js','config.js','ct-net.js',
  'checkers.js','checkers-ai.js','ct-checkers.js',
  'puzzles-data.js','puzzles.js',
  'review.js','trophy-extras.js','learn-library.js','sw.js','manifest.json',
  'terms.html','privacy.html',
  'icon.svg','icon-192.png','icon-512.png','icon-1024.png'
)

# Verify every source file exists before clearing www/
$missing = @()
foreach ($f in $files) { if (-not (Test-Path $f)) { $missing += $f } }
if ($missing.Count -gt 0) {
  Write-Host "ERROR: missing source files: $($missing -join ', ')"
  exit 1
}

Write-Host "==> Refreshing www/ from repo root"
if (Test-Path 'www') { Remove-Item 'www' -Recurse -Force }
New-Item -ItemType Directory -Path 'www' | Out-Null

# Copy-Item is byte-for-byte (binary safe), so we preserve UTF-8 verbatim here.
foreach ($f in $files) { Copy-Item -LiteralPath $f -Destination "www/$f" }
Write-Host ("    copied {0} files into www/" -f $files.Count)

# --- Patch 1: ensure Vercel origin in CSP connect-src (idempotent) ---
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$indexPath = (Resolve-Path 'www/index.html').Path
$idx = [System.IO.File]::ReadAllText($indexPath, $utf8NoBom)
if ($idx -like '*playchesstrophies.com*') {
  Write-Host "==> CSP: Vercel origin already present, skipping"
} else {
  $before = "connect-src 'self' https://chesstrophies-production.up.railway.app wss://chesstrophies-production.up.railway.app;"
  $after  = "connect-src 'self' https://chesstrophies-production.up.railway.app https://playchesstrophies.com wss://chesstrophies-production.up.railway.app;"
  if (-not $idx.Contains($before)) {
    Write-Host "ERROR: CSP patch did not apply; connect-src directive not in expected form."
    exit 1
  }
  $idx = $idx.Replace($before, $after)
  [System.IO.File]::WriteAllText($indexPath, $idx, $utf8NoBom)
  Write-Host "==> CSP: added Vercel origin to connect-src"
}

# --- Patch 2: guard service-worker registration against Capacitor (idempotent) ---
$idx = [System.IO.File]::ReadAllText($indexPath, $utf8NoBom)
$plain   = "if ('serviceWorker' in navigator) {"
$guarded = "if (!window.Capacitor && 'serviceWorker' in navigator) {"
if ($idx.Contains($guarded)) {
  Write-Host "==> SW guard: already present, skipping"
} else {
  $occurrences = ([regex]::Matches($idx, [regex]::Escape($plain))).Count
  if ($occurrences -ne 1) {
    Write-Host "ERROR: SW registration block not found in expected form (count=$occurrences)"
    exit 1
  }
  $idx = $idx.Replace($plain, $guarded)
  [System.IO.File]::WriteAllText($indexPath, $idx, $utf8NoBom)
  Write-Host "==> SW guard: wrapped service worker registration"
}

# --- Encoding sanity check: no replacement characters should be present ---
$idx = [System.IO.File]::ReadAllText($indexPath, $utf8NoBom)
$replCount = ($idx.ToCharArray() | Where-Object { [int]$_ -eq 0xFFFD }).Count
if ($replCount -gt 0) {
  Write-Host "ERROR: $replCount Unicode replacement character(s) detected in www/index.html -- encoding got mangled."
  exit 1
}

Write-Host "==> Syncing into Android project"
npx cap sync
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: npx cap sync failed (exit $LASTEXITCODE)"
  exit $LASTEXITCODE
}

Write-Host "==> Done. www/ refreshed and synced."
