#!/bin/bash
# WA Chat Exporter - Uninstaller (macOS)
set -e
EXT_ID="boecjoljbbpohhleiaoefnjdflkcfdmh"
PREFS_DIR="$HOME/Library/Application Support/Google/Chrome"
INSTALL_DIR="$HOME/WA-Chat-Exporter"

echo "Removing WA Chat Exporter..."

# Remove from Chrome profiles
for d in "$PREFS_DIR/Default" "$PREFS_DIR"/Profile*/; do
    PREFS="${d}Preferences"
    if [ -f "$PREFS" ]; then
        python3 -c "
import json
with open('$PREFS', 'r') as f: data = json.load(f)
if 'extensions' in data and 'settings' in data['extensions'] and '$EXT_ID' in data['extensions']['settings']:
    del data['extensions']['settings']['$EXT_ID']
    with open('$PREFS', 'w') as f: json.dump(data, f, separators=(',',':'), ensure_ascii=False)
    print('  Registration removed.')
" 2>/dev/null
    fi
done

# Remove files
if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    echo "  Files removed."
fi

echo ""
echo "Done! Close Chrome and reopen for changes to take effect."
read -p "Press ENTER to finish"
