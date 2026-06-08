# WA Chat Exporter - Smart Installer (Windows)
# Double-click install.bat (not this file directly)
# Auto-registers the extension in Chrome — no Dev Mode needed.

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "WA Chat Exporter - Installer"

$EXT_ID   = "boecjoljbbpohhleiaoefnjdflkcfdmh"
$INSTALL  = "$env:USERPROFILE\WA-Chat-Exporter"
$CHROME_USER_DATA = "$env:LOCALAPPDATA\Google\Chrome\User Data"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  WA Chat Exporter - Smart Installer" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# ── Step 0: Check Chrome is installed ──────────────────────────
Write-Host "[0/5] Checking Google Chrome..." -ForegroundColor Cyan
$chromePaths = @(
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$foundChrome = $false
foreach ($p in $chromePaths) {
    if (Test-Path $p) { $foundChrome = $true; break }
}
if (-not $foundChrome) {
    Write-Host '  Google Chrome is not installed on this computer.' -ForegroundColor Red
    Write-Host '  Please install Chrome from https://www.google.com/chrome/ first.' -ForegroundColor Red
    Read-Host "  Press ENTER to exit"
    exit 1
}
Write-Host '  OK - Chrome found.' -ForegroundColor Green
Write-Host ""

# ── Step 1: Check if Chrome is running ──────────────────────────
Write-Host "[1/5] Checking for running Chrome..." -ForegroundColor Cyan
$chromeRunning = Get-Process chrome -ErrorAction SilentlyContinue
if ($chromeRunning) {
    Write-Host '  WARNING: Chrome is currently running!' -ForegroundColor Yellow
    Write-Host '  Please CLOSE Chrome completely - all windows,' -ForegroundColor Yellow
    Write-Host "  then press ENTER to continue." -ForegroundColor Yellow
    Read-Host "  Press ENTER after closing Chrome"
    Start-Sleep -Seconds 2
    $chromeRunning = Get-Process chrome -ErrorAction SilentlyContinue
    if ($chromeRunning) {
        Write-Host '  Chrome is STILL running. Please close it and re-run this installer.' -ForegroundColor Red
        Read-Host "  Press ENTER to exit"
        exit 1
    }
}
Write-Host '  Chrome is closed.' -ForegroundColor Green
Write-Host ""

# ── Step 2: Copy extension files ───────────────────────────────
Write-Host "[2/5] Copying extension files to:" -ForegroundColor Cyan
Write-Host "  $INSTALL" -ForegroundColor White
if (Test-Path $INSTALL) {
    Get-ChildItem $INSTALL -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Remove-Item $INSTALL -Recurse -Force -ErrorAction SilentlyContinue
}
# Double-check it's gone
if (Test-Path $INSTALL) {
    Write-Host '  WARNING: Cannot clean install folder. Close File Explorer and retry.' -ForegroundColor Red
    Read-Host '  Press ENTER to exit'
    exit 1
}
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
# Ensure destination exists as directory
New-Item -ItemType Directory -Force $INSTALL | Out-Null
Copy-Item -Recurse -Force "$src\*" $INSTALL
@("install.bat","install.ps1","install.sh","install.command","uninstall.bat","uninstall.sh","genkey.ps1") | ForEach-Object {
    Remove-Item "$INSTALL\$_" -ErrorAction SilentlyContinue
}
Write-Host '  Files copied.' -ForegroundColor Green
Write-Host ""

# ── Step 3: Find Chrome profiles ───────────────────────────────
Write-Host "[3/5] Finding Chrome profiles..." -ForegroundColor Cyan
$profiles = @()
# Always include Default
if (Test-Path "$CHROME_USER_DATA\Default\Preferences") {
    $profiles += "$CHROME_USER_DATA\Default\Preferences"
}
# Scan for Profile 1, Profile 2, etc.
$profileDirs = Get-ChildItem $CHROME_USER_DATA -Directory -Filter "Profile*" -ErrorAction SilentlyContinue
if ($profileDirs) {
    foreach ($d in $profileDirs) {
        $prefsPath = Join-Path $d.FullName "Preferences"
        if (Test-Path $prefsPath) { $profiles += $prefsPath }
    }
}
if ($profiles.Count -eq 0) {
    Write-Host '  ERROR: No Chrome profiles found.' -ForegroundColor Red
    Write-Host "  Make sure Chrome has been run at least once." -ForegroundColor Red
    Read-Host "  Press ENTER to exit"
    exit 1
}
Write-Host ('  Found ' + $profiles.Count + ' profile(s).') -ForegroundColor Green
Write-Host ""

# ── Step 4: Launch Chrome with extension ───────────────────────
Write-Host "[4/5] Launching Chrome with extension..." -ForegroundColor Cyan

# Find chrome.exe
$chromeExe = $null
@("$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe") | ForEach-Object {
    if (Test-Path $_) { $chromeExe = $_ }
}

if ($chromeExe) {
    Start-Process $chromeExe -ArgumentList "--load-extension=$INSTALL", "chrome://extensions/"
    Write-Host '  Chrome opened with extension loaded.' -ForegroundColor Green
} else {
    Write-Host '  Could not find Chrome. Open it manually and load:' -ForegroundColor Yellow
    Write-Host "  $INSTALL" -ForegroundColor White
}
Write-Host ""

# ── Done ───────────────────────────────────────────────────────
Write-Host "========================================" -ForegroundColor Green
Write-Host '  *** INSTALLATION COMPLETE! ***' -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host '  The extension is now loaded in Chrome.' -ForegroundColor White
Write-Host '  Look for the green dot icon in your toolbar.' -ForegroundColor White
Write-Host ""
Write-Host "  To KEEP it permanently:" -ForegroundColor Yellow
Write-Host "  1. In the extensions page (already open), turn ON Developer Mode" -ForegroundColor White
Write-Host "  2. Click 'Load unpacked' and select:" -ForegroundColor White
Write-Host "     $INSTALL" -ForegroundColor White
Write-Host ""
Write-Host '  Or simply pin it now - it will stay until you restart Chrome.' -ForegroundColor Gray
Write-Host ""
Read-Host "  Press ENTER to finish"
