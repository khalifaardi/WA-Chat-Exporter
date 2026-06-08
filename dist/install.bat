@echo off
title WA Chat Exporter - One-Click Installer
echo.
echo ========================================
echo   WA Chat Exporter - Installer
echo ========================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if %ERRORLEVEL% EQU 0 goto :done

echo.
echo ========================================
echo   ⚠️  Automatic install failed.
echo   Please install manually:
echo ========================================
echo.
echo   1. Open Chrome and go to: chrome://extensions/
echo   2. Turn ON "Developer mode" (top-right)
echo   3. Click "Load unpacked"
echo   4. Select this folder: %~dp0
echo      (This folder is already open in Explorer)
echo.
start "" explorer "%~dp0"
echo   Press any key to close...
pause >nul
exit

:done
pause
