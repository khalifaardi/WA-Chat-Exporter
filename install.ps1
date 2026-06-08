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
    Write-Host "  ❌ Google Chrome is not installed on this computer." -ForegroundColor Red
    Write-Host "  Please install Chrome from https://www.google.com/chrome/ first." -ForegroundColor Red
    Read-Host "  Press ENTER to exit"
    exit 1
}
Write-Host "  ✓ Chrome found." -ForegroundColor Green
Write-Host ""

# ── Step 1: Check if Chrome is running ──────────────────────────
Write-Host "[1/5] Checking for running Chrome..." -ForegroundColor Cyan
$chromeRunning = Get-Process chrome -ErrorAction SilentlyContinue
if ($chromeRunning) {
    Write-Host "  ⚠️  Chrome is currently running!" -ForegroundColor Yellow
    Write-Host "  Please CLOSE Chrome completely (all windows)," -ForegroundColor Yellow
    Write-Host "  then press ENTER to continue." -ForegroundColor Yellow
    Read-Host "  Press ENTER after closing Chrome"
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
if (Test-Path $INSTALL) { Remove-Item -Recurse -Force $INSTALL }
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item -Recurse -Force "$src\*" $INSTALL
@("install.bat","install.ps1","install.sh","install.command","uninstall.bat","uninstall.sh","genkey.ps1") | ForEach-Object {
    Remove-Item "$INSTALL\$_" -ErrorAction SilentlyContinue
}
Write-Host "  ✓ Files copied." -ForegroundColor Green
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
    Write-Host "  ❌ No Chrome profiles found." -ForegroundColor Red
    Write-Host "  Make sure Chrome has been run at least once." -ForegroundColor Red
    Read-Host "  Press ENTER to exit"
    exit 1
}
Write-Host "  ✓ Found $($profiles.Count) profile(s)." -ForegroundColor Green
Write-Host ""

# ── Step 4: Register extension in all profiles ─────────────────
Write-Host "[4/5] Registering extension in Chrome..." -ForegroundColor Cyan
$registered = 0
foreach ($prefsPath in $profiles) {
    $backupPath = $prefsPath + ".backup-waexporter"
    try {
        # Backup
        Copy-Item -Force $prefsPath $backupPath

        # Read & modify
        $json = Get-Content $prefsPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
        if (-not $json.extensions) { $json | Add-Member -Force -NotePropertyName "extensions" -NotePropertyValue ([PSCustomObject]@{}) }
        if (-not $json.extensions.ui) { $json.extensions | Add-Member -Force -NotePropertyName "ui" -NotePropertyValue ([PSCustomObject]@{}) }
        if (-not $json.extensions.settings) { $json.extensions | Add-Member -Force -NotePropertyName "settings" -NotePropertyValue ([PSCustomObject]@{}) }
        $json.extensions.ui | Add-Member -Force -NotePropertyName "developer_mode" -NotePropertyValue $true
        $extEntry = [PSCustomObject]@{ path = $INSTALL.Replace('\', '/'); state = 1; was_installed_by_default = $false }
        $json.extensions.settings | Add-Member -Force -NotePropertyName $EXT_ID -NotePropertyValue $extEntry

        # Write back
        $newJson = ($json | ConvertTo-Json -Depth 100 -Compress) -replace '\\/', '/'
        [System.IO.File]::WriteAllText($prefsPath, $newJson, [System.Text.UTF8Encoding]::new($false))
        $registered++
    } catch {
        Write-Host "  ⚠️  Could not update profile: $prefsPath" -ForegroundColor Yellow
        Copy-Item -Force $backupPath $prefsPath -ErrorAction SilentlyContinue
    }
}
if ($registered -eq 0) {
    Write-Host "  ❌ Failed to register in any profile." -ForegroundColor Red
    Read-Host "  Press ENTER to exit"
    exit 1
}
Write-Host "  ✓ Registered in $registered profile(s)." -ForegroundColor Green
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
