# WA Chat Exporter - Smart Installer
# Double-click install.bat (not this file directly)
# This script auto-registers the extension in Chrome — no Dev Mode needed.

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "WA Chat Exporter - Installer"

$EXT_ID   = "boecjoljbbpohhleiaoefnjdflkcfdmh"
$INSTALL  = "$env:USERPROFILE\WA-Chat-Exporter"
$PREFS    = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Preferences"
$BACKUP   = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Preferences.backup-waexporter"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  WA Chat Exporter - Smart Installer" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# ── Step 1: Check if Chrome is running ──────────────────────────
Write-Host "[1/5] Checking for running Chrome..." -ForegroundColor Cyan
$chromeRunning = Get-Process chrome -ErrorAction SilentlyContinue
if ($chromeRunning) {
    Write-Host ""
    Write-Host "  ⚠️  Chrome is currently running!" -ForegroundColor Yellow
    Write-Host "  Please CLOSE Chrome completely (all windows)," -ForegroundColor Yellow
    Write-Host "  then press ENTER to continue." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  Press ENTER after closing Chrome"
    # Double-check
    Start-Sleep -Seconds 2
    $chromeRunning = Get-Process chrome -ErrorAction SilentlyContinue
    if ($chromeRunning) {
        Write-Host "  ❌ Chrome is STILL running. Please close it and re-run this installer." -ForegroundColor Red
        Read-Host "  Press ENTER to exit"
        exit 1
    }
}
Write-Host "  ✓ Chrome is closed." -ForegroundColor Green
Write-Host ""

# ── Step 2: Copy extension files ───────────────────────────────
Write-Host "[2/5] Copying extension files to:" -ForegroundColor Cyan
Write-Host "  $INSTALL" -ForegroundColor White
if (Test-Path $INSTALL) {
    Remove-Item -Recurse -Force $INSTALL
}
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -Recurse -Force "$src\*" $INSTALL
# Remove installer scripts from install dir (extension doesn't need them)
@("install.bat", "install.ps1", "uninstall.bat", "genkey.ps1") | ForEach-Object {
    Remove-Item "$INSTALL\$_" -ErrorAction SilentlyContinue
}
Write-Host "  ✓ Files copied." -ForegroundColor Green
Write-Host ""

# ── Step 3: Backup Chrome Preferences ──────────────────────────
Write-Host "[3/5] Preparing Chrome settings..." -ForegroundColor Cyan
if (-not (Test-Path $PREFS)) {
    Write-Host "  ❌ Chrome Preferences file not found at:" -ForegroundColor Red
    Write-Host "  $PREFS" -ForegroundColor Red
    Write-Host "  Make sure Google Chrome is installed and has been run at least once." -ForegroundColor Red
    Read-Host "  Press ENTER to exit"
    exit 1
}
Copy-Item -Force $PREFS $BACKUP
Write-Host "  ✓ Backup saved." -ForegroundColor Green
Write-Host ""

# ── Step 4: Register extension in Chrome ───────────────────────
Write-Host "[4/5] Registering extension in Chrome..." -ForegroundColor Cyan
try {
    $json = Get-Content $PREFS -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
} catch {
    Write-Host "  ❌ Failed to read Chrome Preferences. It may be corrupted." -ForegroundColor Red
    Write-Host "  Restoring backup..." -ForegroundColor Yellow
    Copy-Item -Force $BACKUP $PREFS
    exit 1
}

# Ensure extensions tree exists
if (-not $json.extensions) {
    $json | Add-Member -MemberType NoteProperty -Name "extensions" -Value ([PSCustomObject]@{}) -Force
}
if (-not $json.extensions.ui) {
    $json.extensions | Add-Member -MemberType NoteProperty -Name "ui" -Value ([PSCustomObject]@{}) -Force
}
if (-not $json.extensions.settings) {
    $json.extensions | Add-Member -MemberType NoteProperty -Name "settings" -Value ([PSCustomObject]@{}) -Force
}

# Enable Developer Mode
$json.extensions.ui | Add-Member -MemberType NoteProperty -Name "developer_mode" -Value $true -Force

# Register the extension
$extEntry = [PSCustomObject]@{
    path                      = $INSTALL.Replace('\', '/')
    state                     = 1
    was_installed_by_default  = $false
}
$json.extensions.settings | Add-Member -MemberType NoteProperty -Name $EXT_ID -Value $extEntry -Force

# Write back
$newJson = $json | ConvertTo-Json -Depth 100 -Compress
# Fix PowerShell's ConvertTo-Json escaping (Chrome expects unescaped slashes)
$newJson = $newJson -replace '\\/', '/'
[System.IO.File]::WriteAllText($PREFS, $newJson, [System.Text.UTF8Encoding]::new($false))

Write-Host "  ✓ Extension registered with Chrome." -ForegroundColor Green
Write-Host ""

# ── Step 5: Done ───────────────────────────────────────────────
Write-Host "========================================" -ForegroundColor Green
Write-Host "  ✅ INSTALLATION COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Open Google Chrome normally." -ForegroundColor White
Write-Host "  The 'WA Chat Exporter' extension will be loaded automatically." -ForegroundColor White
Write-Host "  Look for the green dot icon in your toolbar." -ForegroundColor White
Write-Host ""
Write-Host "  If you don't see it, click the puzzle icon 🧩" -ForegroundColor Gray
Write-Host "  in Chrome's toolbar and pin the extension." -ForegroundColor Gray
Write-Host ""
Read-Host "  Press ENTER to finish"
