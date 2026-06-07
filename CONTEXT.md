# WA Group Exporter

A Chrome extension (Manifest V3) that scrapes WhatsApp Web to export chats and group members as CSV/HTML files.

## Language

- **Chat** — Any WhatsApp conversation, either personal (one-on-one) or group. Referred to as `chat` in code.
- **Sidebar** — The left panel in WhatsApp Web listing all chats. Uses React Virtualized (virtual list), meaning DOM elements for off-screen chats are created/destroyed dynamically.
- **Virtual list** — WhatsApp Web's rendering technique: only visible chat rows exist in the DOM. Scrolling triggers re-render. This is the core challenge the extension solves — you can't just `querySelectorAll` once.
- **Cell frame container** — WhatsApp's DOM element (`[data-testid="cell-frame-container"]`) wrapping each chat row in the sidebar. The extension uses this to identify chat entries.
- **Pane side** — WhatsApp's sidebar container (`#pane-side`). The extension falls back to finding a scrollable `div` within it when the `chat-list` test ID is absent.
- **Safe Mode** — An export mode that adds artificial delays (4–8s between chats, 45s pause every 15 chats) to avoid triggering WhatsApp rate limits.
- **Collect all messages** — The process of scrolling the chat pane upward repeatedly until all messages within the date range are loaded. Uses a "no new messages" counter to detect when scrolling is exhausted.
- **Export chat** — The primary feature: scrape messages from a selected chat within a date range, format as CSV or HTML, and trigger a browser download.
- **Export members** — A secondary feature: scrape group participant names and phone numbers from the currently open group info panel.

## Architecture

### Service Worker (`background.js`)
The brain of the extension. All scraping, message collection, and file generation happen here. It uses `chrome.scripting.executeScript` to inject functions into the WhatsApp Web tab. Key subsystems:

- **Chat loader** — Scrolls the sidebar incrementally, scraping visible chat names on each scroll step, until no new chats appear (8 consecutive rounds of no new names = done). Supports 1000+ contacts.
- **Chat opener** — Given a chat name, scrolls the sidebar from top to bottom looking for a match, then clicks it. Falls back to full sidebar scan if the chat isn't in the currently visible rows.
- **Message collector** — After opening a chat, scrolls the message pane upward in rounds. Each round: scroll up, wait for WhatsApp's loading spinner to disappear, scrape newly visible messages, stop when messages fall outside the date range. Stops after 15 consecutive rounds with no new messages (or 300 total rounds).
- **File generator** — Converts collected messages to CSV (with BOM for Excel) or styled HTML, encodes as base64 data URI, triggers `chrome.downloads.download`.
- **Progress system** — Broadcasts status via `chrome.storage.local`; the popup polls this every 700ms.

### Popup (`popup.html` + `popup.js`)
The user interface. Two tabs: Export Chat and Member Grup. Features search/filter, select-all checkbox, Safe Mode toggle, pause/resume/cancel controls, and a progress bar. Settings are sent to the service worker via `chrome.runtime.sendMessage`.

### No content script
Previously registered but unused `content.js` was removed in v12. All DOM access happens through `chrome.scripting.executeScript` from the service worker.

## Key decisions

1. **Virtual list handling** — WhatsApp's React Virtualized sidebar means chat rows appear/disappear as you scroll. The extension scrolls in small increments (600px), scrapes, and repeats. This is the only reliable way to enumerate all chats without direct API access.

2. **Chat lookup by name, not index** — Early versions used chat index (position in the sidebar). This broke when the sidebar was scrolled because React Virtualized reuses DOM elements. v12 uses name-based lookup, scanning all visible rows each time.

3. **Message loading spinner detection** — After scrolling the chat pane, WhatsApp shows a loading indicator while fetching history. The extension waits for this indicator to disappear before scraping, using a DOM observer or timeout. Without this, stale/missing messages result.

4. **No official API** — WhatsApp has no public API for chat export. This extension uses DOM scraping, which is inherently fragile. Selectors like `[data-testid="cell-frame-container"]` are WhatsApp's internal test hooks and can change without notice.

5. **Sequential export, not parallel** — Chats are exported one at a time with configurable delays. Parallel scraping would be faster but dramatically increases the risk of WhatsApp rate-limiting or banning the session.

6. **Date filtering is post-scrape** — Messages are collected until they fall outside the date range, then filtered. The extension cannot jump to a specific date in WhatsApp's UI, so it scrolls from newest backward.

## Flagged ambiguities

- **Persistence across WhatsApp restarts** — The extension holds no state beyond `chrome.storage`. If the user refreshes WhatsApp Web mid-export, all progress is lost and the export must restart.
- **Selector fragility** — All DOM selectors are WhatsApp-internal and undocumented. A WhatsApp Web update can break any of them silently.
- **Rate limit detection** — There's no detection of WhatsApp throttling. The Safe Mode delays are heuristic, not based on actual rate-limit signals from WhatsApp.
