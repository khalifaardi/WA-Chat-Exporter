#!/bin/bash
# WA Chat Exporter - Smart Installer (macOS)
# Double-click install.command (not this file directly)
# Auto-registers the extension in Chrome — no Dev Mode needed.

set -e

EXT_ID="boecjoljbbpohhleiaoefnjdflkcfdmh"
INSTALL_DIR="$HOME/WA-Chat-Exporter"
CHROME_USER_DATA="$HOME/Library/Application Support/Google/Chrome"

echo ""
echo "========================================"
echo "  WA Chat Exporter - Smart Installer"
echo "========================================"
echo ""

# ── Step 0: Check Chrome is installed ──────────────────────────
echo "[0/5] Checking Google Chrome..."
if [ ! -d "/Applications/Google Chrome.app" ]; then
    echo "  ❌ Google Chrome is not installed."
    echo "  Please install Chrome from https://www.google.com/chrome/ first."
    read -p "  Press ENTER to exit"
    exit 1
fi
echo "  ✓ Chrome found."
echo ""

# ── Step 1: Check if Chrome is running ──────────────────────────
echo "[1/5] Checking for running Chrome..."
if pgrep -i "Google Chrome" > /dev/null 2>&1; then
    echo "  ⚠️  Chrome is currently running!"
    echo "  Please QUIT Chrome completely (Cmd+Q),"
    echo "  then press ENTER to continue."
    read -p "  Press ENTER after closing Chrome"
    sleep 2
    if pgrep -i "Google Chrome" > /dev/null 2>&1; then
        echo "  ❌ Chrome is STILL running. Please close it and re-run this installer."
        read -p "  Press ENTER to exit"
        exit 1
    fi
fi
echo "  ✓ Chrome is closed."
echo ""

# ── Step 2: Copy extension files ───────────────────────────────
echo "[2/5] Copying extension files to:"
echo "  $INSTALL_DIR"
if [ -d "$INSTALL_DIR" ]; then rm -rf "$INSTALL_DIR"; fi
SRC="$(cd "$(dirname "$0")" && pwd)"
cp -R "$SRC/" "$INSTALL_DIR/"
# Remove installer scripts from destination
rm -f "$INSTALL_DIR/install.bat" "$INSTALL_DIR/install.ps1" "$INSTALL_DIR/install.sh" "$INSTALL_DIR/install.command" "$INSTALL_DIR/uninstall.bat" "$INSTALL_DIR/uninstall.sh" "$INSTALL_DIR/genkey.ps1" 2>/dev/null
echo "  ✓ Files copied."
echo ""

# ── Step 3: Find Chrome profiles ───────────────────────────────
echo "[3/5] Finding Chrome profiles..."
PROFILES=()
# Default profile
if [ -f "$CHROME_USER_DATA/Default/Preferences" ]; then
    PROFILES+=("$CHROME_USER_DATA/Default/Preferences")
fi
# Numbered profiles
for d in "$CHROME_USER_DATA"/Profile*/; do
    if [ -f "${d}Preferences" ]; then
        PROFILES+=("${d}Preferences")
    fi
done
if [ ${#PROFILES[@]} -eq 0 ]; then
    echo "  ❌ No Chrome profiles found."
    echo "  Make sure Chrome has been run at least once."
    read -p "  Press ENTER to exit"
    exit 1
fi
echo "  ✓ Found ${#PROFILES[@]} profile(s)."
echo ""

# ── Step 4: Register extension in all profiles ─────────────────
echo "[4/5] Registering extension in Chrome..."
REGISTERED=0
for PREFS in "${PROFILES[@]}"; do
    BACKUP="${PREFS}.backup-waexporter"
    cp "$PREFS" "$BACKUP" 2>/dev/null
    python3 -c "
import json, sys
prefs_path = '$PREFS'
install_dir = '$INSTALL_DIR'
ext_id = '$EXT_ID'

with open(prefs_path, 'r', encoding='utf-8') as f:
    data = json.load(f)

if 'extensions' not in data:
    data['extensions'] = {}
if 'ui' not in data['extensions']:
    data['extensions']['ui'] = {}
if 'settings' not in data['extensions']:
    data['extensions']['settings'] = {}

data['extensions']['ui']['developer_mode'] = True
data['extensions']['settings'][ext_id] = {
    'path': install_dir,
    'state': 1,
    'was_installed_by_default': False
}

with open(prefs_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, separators=(',', ':'), ensure_ascii=False)
" 2>/dev/null
    if [ $? -eq 0 ]; then
        REGISTERED=$((REGISTERED + 1))
    else
        echo "  ⚠️  Could not update profile: $PREFS"
        cp "$BACKUP" "$PREFS" 2>/dev/null
    fi
done

if [ $REGISTERED -eq 0 ]; then
    echo "  ❌ Failed to register in any profile."
    read -p "  Press ENTER to exit"
    exit 1
fi
echo "  ✓ Registered in $REGISTERED profile(s)."
echo ""

# ── Step 5: Done ───────────────────────────────────────────────
echo "========================================"
echo "  ✅ INSTALLATION COMPLETE!"
echo "========================================"
echo ""
echo "  Open Google Chrome normally."
echo "  The 'WA Chat Exporter' extension will be loaded automatically."
echo "  Look for the green dot icon in your toolbar."
echo ""
echo "  If you don't see it, click the puzzle icon 🧩"
echo "  in Chrome's toolbar and pin the extension."
echo ""
read -p "  Press ENTER to finish"
