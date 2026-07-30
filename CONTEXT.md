# WA Chat Exporter

A Chrome extension (Manifest V3) that exports WhatsApp Web chats as CSV or plain text files using the [wppconnect/wa-js](https://github.com/wppconnect-team/wa-js) library for direct IndexedDB access.

## Language

- **Chat** — Any WhatsApp conversation, either personal (one-on-one) or group. Referred to as `chat` in code.
- **WPP** — The global `window.WPP` object injected by `wppconnect.js`, providing programmatic access to WhatsApp Web's internal module system (chats, messages, contacts, groups).
- **IndexedDB** — WhatsApp Web's local offline store. The WPP library reads chat lists and message history directly from here — zero network requests are made during export.
- **Content script bridge** — `content-script.js` acts as a message relay between the service worker (`background.js`) and the injected page scripts (`wppconnect.js` + `init.js`), using `window.postMessage` for page-context communication and `chrome.runtime.sendMessage` for extension messaging.
- **Overlay** — A progress bar injected into the WhatsApp Web page by `content-script.js`, showing export status, pause/resume/cancel controls, and a completion toast.
- **Safe Mode** — Always-on export pacing: randomized 4–8s delays between chats and a 15s pause every 20 chats to reduce detection risk. Timing is configurable in `background.js` (`CFG` object).
- **Export chat** — The primary feature: read messages from selected chats within a date range via `WPP.chat.getMessages()`, format as CSV or TXT, and trigger a browser download to `WA_Export_YYYY-MM-DD/`.

## Architecture

The extension has four layers, flowing from UI → orchestration → bridge → WhatsApp API:

### Popup (`popup.html` + `popup.js` v15)
The user interface. Bilingual (EN/ID) with language toggle. Features a multi-select dropdown with search, date range picker, "export all messages" toggle, format picker (CSV/TXT radio buttons), and pause/resume/cancel controls. Polls `chrome.storage.local` every 1.5s for progress updates. Auto-opens WhatsApp Web tab on launch and shows a login wall screen when not authenticated.

### Service Worker (`background.js` v13.1)
The orchestrator. All export logic runs here. Communicates with the WhatsApp page via `chrome.tabs.sendMessage` to `content-script.js`. Key responsibilities:
- **Chat loader** — Sends `GET_CHATS` action to the page bridge; receives the full chat list from `WPP.chat.list()`.
- **Message fetcher** — Sends `GET_MESSAGES` with chat ID + date range; receives filtered messages from `WPP.chat.getMessages()` via IndexedDB.
- **File generator** — Converts messages to CSV (with BOM for Excel) or plain text, encodes as base64 data URI, triggers `chrome.downloads.download`.
- **Progress system** — Broadcasts status via `chrome.storage.local`; also sends overlay updates and toast notifications to the WhatsApp page.
- **Safe Mode pacing** — Enforces delays (4–8s random) between chats and a 15s pause every 20 chats.
- **Session expiry detection** — Detects auth/session errors from the page bridge and stops the export gracefully.

### Content Script (`content-script.js` v13)
Injected into WhatsApp Web by the manifest. Bridges the gap between the service worker (Chrome extension context) and the page scripts (WhatsApp Web context). Responsibilities:
- **Message relay** — Forwards `WA_API_REQUEST` from background → page scripts via `window.postMessage`, returns responses.
- **Script injection** — Dynamically injects `wppconnect.js` then `init.js` into the page when first needed.
- **Progress overlay** — Creates and manages the floating overlay bar on WhatsApp Web (pause/resume/cancel buttons, progress bar, completion message).
- **Toast notifications** — Shows temporary toast messages on the WhatsApp page for export completion/errors.

### Page Scripts (`inject/`)
Two scripts injected in sequence into the WhatsApp Web page context:

- **`wppconnect.js`** (502 KB) — Compiled wa-js library bundle. Exposes `window.WPP` with modules: `WPP.chat`, `WPP.conn`, `WPP.contact`, `WPP.group`, etc.
- **`init.js`** (v13) — The API bridge. Waits for `WPP.conn.isMainReady()`, then listens for `WA_EXPORTER_REQUEST` messages from the content script. Handles:
  - `GET_CHATS` — Calls `WPP.chat.list()` and maps to `{id, name, isGroup, t}`. For groups, fetches participants via up to 4 fallback strategies (`WPP.group.getParticipants`, `groupMetadata`, `WPP.group.getMembers`, `WPP.group.getGroupInfo`). Extracts phone numbers and display names from multiple WPP object properties.
  - `GET_MESSAGES` — Calls `WPP.chat.getMessages()` with date filtering, formats message bodies with human-readable media type labels (`[Image]`, `[Video]`, `[Sticker]`, etc.), resolves `@mentions` from LID to phone numbers.

## Key decisions

1. **WPP API over DOM scraping** — v13 replaced the old DOM-scraping approach (`chrome.scripting.executeScript`, virtual list scrolling, `[data-testid]` selectors) with direct IndexedDB access via wa-js. This is faster (instant chat loading, no scrolling), more reliable (not dependent on WhatsApp's DOM structure), and covers 100% of chats/messages regardless of UI state.

2. **Message-passing bridge pattern** — Service worker can't directly access `window.WPP` (isolated contexts). The `content-script.js` ↔ `init.js` bridge uses `window.postMessage` for page-context communication with request/response IDs and 60s timeouts.

3. **IndexedDB reads, no network requests** — All data comes from WhatsApp's local offline store. The only network activity is the initial WhatsApp Web page load. This makes the extension fast and low-risk.

4. **Safe Mode always-on** — Unlike v12's toggle, v13 always applies delays. The 4–8s random delay between chats plus 15s pause every 20 chats provides a ~3-minute cycle per 20 chats. Since reads are from IndexedDB (not API calls), actual ban risk is very low — Safe Mode is a safety margin.

5. **One file per chat, date-stamped folder** — Files are saved as `WA_Export_YYYY-MM-DD/ChatName_DateRange.ext`. This keeps exports organized and avoids filename collisions across multiple export sessions.

6. **Sequential export** — Chats are exported one at a time. Parallel would be faster but increases complexity and risk. The IndexedDB reads are fast enough that sequential is not a bottleneck.

## Flagged ambiguities

- **wa-js version compatibility** — The bundled `wppconnect.js` must stay compatible with the current WhatsApp Web version. A WhatsApp Web update can break wa-js patches. The wppconnect team releases updates frequently — monitor `wppconnect-team/wa-js` releases.
- **Persistence across WhatsApp restarts** — The extension holds no state beyond `chrome.storage`. If the user refreshes WhatsApp Web mid-export, all progress is lost and the export must restart.
- **Group participant extraction** — The 4 fallback strategies in `init.js` may not cover all edge cases. Some group metadata may not be available via WPP's public API surface.
- **Large exports** — Very large chat histories (years of messages) may produce large CSV/TXT files. The base64 data URI approach has no explicit size limit but very large files (~50MB+) could cause browser memory pressure.
