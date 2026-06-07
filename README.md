# WA Chat Exporter

Chrome extension to export WhatsApp Web chats — one file per chat, CSV or plain text, with date filtering and Safe Mode.

> Built for sales teams to extract their own WhatsApp conversations easily.

## Quick Install (for end users)

1. Extract the zip file
2. **Double-click `install.bat`**
3. If Chrome is open → close it, press Enter
4. Open Chrome — extension is ready ✅

Full guide: see `INSTALL_GUIDE.txt` (English & Bahasa Indonesia).

## Features

- **Bilingual UI** — English ↔ Bahasa Indonesia toggle
- **Radio button format picker** — CSV or plain text
- **Multi-select chat dropdown** — search, filter, select specific chats or all at once
- **Date range filter** — export messages within a range, or all messages
- **One file per chat** — saved as `[name]_[date].[csv|txt]` in `WA_Export_YYYY-MM-DD/`
- **Safe Mode always on** — randomized delays + pauses to reduce detection risk
- **Pause / Resume / Cancel** — full control during long exports
- **Progress bar** — real-time status overlay on WhatsApp Web tab
- **One-click installer** — no Developer Mode or manual loading required
- **Auto-open WhatsApp Web** — opens/focuses WhatsApp tab automatically
- **Login wall** — shows clear "please log in" screen if not signed in

## Tech Stack

- Manifest V3 Chrome Extension
- [wppconnect-wa.js](https://github.com/wppconnect-team/wa-js) — reads WhatsApp's IndexedDB directly
- Vanilla JS, no framework dependencies

## Development

```bash
# Load unpacked in Chrome:
# 1. Go to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" → select this folder
```

### Project Structure

```
├── manifest.json          # Extension manifest (MV3)
├── popup.html             # Popup UI
├── popup.js               # Popup logic + i18n
├── background.js          # Service worker, export engine
├── content-script.js      # Bridge: background ↔ WhatsApp page
├── inject/
│   ├── wppconnect.js      # WPP library
│   └── init.js            # WhatsApp API bridge
├── _locales/              # Chrome i18n (en, id)
├── icons/                 # Extension icons
├── install.bat            # One-click installer wrapper
├── install.ps1            # Smart installer (auto-registers in Chrome)
├── uninstall.bat          # Cleanup script
└── dist/                  # Distribution package
```

## License

Private — for internal company use.

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the project folder
5. The extension icon will appear in your toolbar

## Usage

1. Open [web.whatsapp.com](https://web.whatsapp.com) and log in via QR code
2. Click the extension icon to open the popup
3. **Choose File Format** — CSV (Excel-compatible) or Plain Text
4. **Select Chat** — The dropdown auto-loads all your chats
   - Search to filter
   - Check individual chats or "All Chats"
   - Selected chats appear as pills below the dropdown (click x to remove)
5. **Choose Date** — Set start and end dates, or check "Export all messages"
6. Click **Export Chat**
7. Watch the progress overlay on your WhatsApp tab
8. Files are saved to `Downloads/WA_Export_YYYY-MM-DD/`
9. Toggle between EN / ID using the language selector in the top-right corner of the popup

## File Formats

### CSV

Standard CSV with BOM for Excel compatibility.

```
Timestamp,Sender,Message
2026-06-07 14:30:00,"Alice","Hello everyone!"
2026-06-07 14:31:00,"Bob","[Image] Check this out"
```

### Plain Text

Readable format with date headers and timestamps.

```
[07/06/26]
[14:30] Alice: Hello everyone!
[14:31] Bob: [Image] Check this out

[08/06/26]
[09:00] Alice: Good morning
```

## Media Type Labels

Non-text messages are automatically labelled in the export:

| WhatsApp Type | Export Label |
|---|---|
| Image | `[Image]` |
| Video | `[Video]` |
| Sticker | `[Sticker]` |
| Voice Message | `[Voice Message]` |
| Document | `[Document - filename.pdf]` |
| Location | `[Location]` |
| Contact | `[Contact]` |
| Poll | `[Poll]` |
| Call | `[Call]` |
| Deleted message | `[Message deleted]` |

## How It Works

The extension uses [wppconnect-wa.js](https://github.com/wppconnect-team/wa-js) to hook into WhatsApp Web's internal module system (`window.WPP`). This provides programmatic access to:

- `WPP.chat.list()` — all chats and groups
- `WPP.chat.getMessages()` — message history from IndexedDB

All data is read from WhatsApp's local offline store — **zero network requests** are made during export.

## Architecture

```
popup.html / popup.js     ->  User interface
background.js             ->  Service worker - orchestrates export
content-script.js         ->  Injected into WhatsApp Web - bridges messages
inject/wppconnect.js      ->  WPP library (502 KB)
inject/init.js            ->  API calls: getChats(), getMessages()
```

## Safe Mode Details

Safe Mode is always active with the following timing:

| Parameter | Value |
|---|---|
| Delay between chats | 4-8 seconds (randomized) |
| Auto-pause | 15 seconds every 20 chats |
| Timing per 20 chats | ~3 minutes total |

Since the extension reads from local IndexedDB (not making network requests), the ban risk is very low. Safe Mode adds a safety margin for large exports.

## Running Tests

```bash
node tests/unit.test.js
```

63 tests covering CSV generation, TXT formatting, media type labels, filename sanitization, date filtering, and chat sorting.

## Limitations

- **WhatsApp Web only** — Does not work with mobile or desktop WhatsApp apps
- **Requires logged-in session** — You must be logged into web.whatsapp.com
- **No media download** — Attachments are labelled but not downloaded
- **Chrome only** — Built for Manifest V3 (may work in Edge/Brave with minor adjustments)

## Disclaimer

This extension is not affiliated with, endorsed by, or connected to WhatsApp or Meta. It reads data from WhatsApp Web's local browser storage via [wppconnect-wa.js](https://github.com/wppconnect-team/wa-js). Use at your own risk.

## License

MIT
