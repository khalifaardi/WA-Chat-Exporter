// background.js v13.1 — Safe Mode always-on, overlay progress, folder save
const DBG = true;
function lg(...a) { if(DBG) console.log("[BG]",...a); }
function er(...a) { if(DBG) console.error("[BG]",...a); }

let isRunning = false;
let isPaused = false;
let waTabId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "START_EXPORT") {
    if (isRunning) { sendResponse({ error: "Already running" }); return true; }
    startExport(msg.settings);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === "PAUSE_RESUME") {
    isPaused = !isPaused;
    updateProgress({ paused: isPaused });
    if (isPaused) {
      sendToWAOverlay({ paused: true, text: "Paused \u2014 click Resume" });
    } else {
      sendToWAOverlay({ text: "Resuming...", subText: "Safe Mode active", percent: 0, extra: "" });
    }
    sendResponse({ paused: isPaused });
    return true;
  }
  if (msg.action === "CANCEL_EXPORT") {
    isRunning = false; isPaused = false;
    updateProgress({ status: "cancelled", text: "Export cancelled." });
    sendToWAOverlay({ hide: true });
    sendToastToWA("Export cancelled", false, false);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === "GET_STATUS") {
    chrome.storage.local.get("exportProgress", r => sendResponse(r.exportProgress || {}));
    return true;
  }
  if (msg.action === "LOAD_CHATS") {
    lg("LOAD_CHATS received");
    loadChatsFromWA().then(chats => { lg("LOAD_CHATS success:", chats.length); sendResponse({ chats }); })
      .catch(e => { er("LOAD_CHATS failed:", e.message); sendResponse({ error: e.message }); });
    return true;
  }
});

const CFG = {
  delayMin: 4000, delayMax: 8000,
  pauseEvery: 20, pauseDuration: 15000
};
const rand = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sanitize = n => (n||"chat").replace(/[\/\\:*?"<>|]/g,"").replace(/\s+/g,"_").substring(0,80)||"chat";
const toBase64 = str => { const b = new TextEncoder().encode(str); let s=""; for(let i=0;i<b.length;i++)s+=String.fromCharCode(b[i]); return btoa(s); };

async function getWATab() {
  if (waTabId) {
    try { await chrome.tabs.get(waTabId); return { id: waTabId }; } catch(e) { waTabId = null; }
  }
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (!tabs.length) throw new Error("WhatsApp Web not open");
  waTabId = tabs[0].id;
  return tabs[0];
}

async function sendToWA(payload) {
  const tab = await getWATab();
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action: "WA_API_REQUEST", payload }, r => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (r && r.error) reject(new Error(r.error));
      else resolve(r || []);
    });
  });
}

async function sendToWAOverlay(data) {
  try {
    const tab = await getWATab();
    chrome.tabs.sendMessage(tab.id, { action: "PROGRESS_UPDATE", data });
  } catch(e) {}
}

async function sendToastToWA(text, isError, isDone) {
  try {
    const tab = await getWATab();
    chrome.tabs.sendMessage(tab.id, { action: "EXPORT_TOAST", data: { text, isError, isDone } });
    // Also send to popup
    chrome.runtime.sendMessage({ action: "EXPORT_TOAST", text, isError, isDone }).catch(()=>{});
  } catch(e) {}
}

async function checkWAReady() {
  lg("checkWAReady");
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  if (!tabs.length) { er("No WA tab"); return { ready: false, error: "WhatsApp Web not open" }; }
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabs[0].id, { action: "CHECK_WA_READY" }, r => {
      lg("CHECK_WA_READY resp:", r);
      resolve(r || { ready: false, error: "No response" });
    });
  });
}

function updateProgress(data) {
  chrome.storage.local.get("exportProgress", r => {
    chrome.storage.local.set({ exportProgress: { ...(r.exportProgress || {}), ...data } });
  });
}

async function loadChatsFromWA() {
  const ready = await checkWAReady();
  if (!ready.ready) throw new Error(ready.error || "WhatsApp not ready");
  return await sendToWA({ action: "GET_CHATS", data: {} });
}

async function startExport(settings) {
  isRunning = true; isPaused = false;
  const { chats, dateFrom, dateTo, format } = settings;
  const today = new Date().toISOString().split("T")[0]; // e.g. "2026-06-07"
  const exportFolder = "WA_Export_" + today + "/";
  let totalMessages = 0, downloadedFiles = 0;
  const failedChats = [];

  updateProgress({ status: "running", text: "Starting...", percent: 0, total: chats.length, done: 0, downloadedFiles: 0 });

  const ready = await checkWAReady();
  if (!ready.ready) { isRunning = false; updateProgress({ status: "error", text: ready.error || "WhatsApp not ready" }); return; }

  // Show initial overlay
  sendToWAOverlay({ text: "Exporting " + chats.length + " chats...", subText: "Safe Mode active", percent: 0, extra: "" });

  for (let i = 0; i < chats.length; i++) {
    if (!isRunning) break;
    while (isPaused && isRunning) {
      updateProgress({ paused: true });
      await sleep(500);
    }
    if (!isRunning) break;

    // Safe Mode: pause 15s every 20 chats
    if (i > 0 && i % CFG.pauseEvery === 0) {
      for (let s = CFG.pauseDuration / 1000; s > 0 && isRunning; s--) {
        sendToWAOverlay({ paused: true, text: "Pausing " + s + "s \u2014 Safe Mode", extra: (i) + "/" + chats.length + " done" });
        updateProgress({ text: "Safe Mode pause " + s + "s (" + i + "/" + chats.length + ")" });
        await sleep(1000);
      }
    }
    if (!isRunning) break;

    const chat = chats[i];
    const chatLabel = (i+1) + "/" + chats.length;
    sendToWAOverlay({ text: chat.name, subText: "Chat " + chatLabel, percent: Math.round(i/chats.length*100), extra: downloadedFiles + " files saved" });
    updateProgress({ text: "[" + chatLabel + "] " + chat.name, currentChatName: chat.name, percent: Math.round(i/chats.length*100), done: i, total: chats.length });

    try {
      const msgs = await sendToWA({ action: "GET_MESSAGES", data: { chatId: chat.id, from: dateFrom, to: dateTo } });
      if (msgs && msgs.length) {
        totalMessages += msgs.length; downloadedFiles++;
        const rangeLabel = dateFrom === "1970-01-01" ? "All_Time" : dateFrom + "_" + dateTo;
        const fn = exportFolder + sanitize(chat.name) + "_" + rangeLabel + "." + (format === "csv" ? "csv" : "txt");
        const content = format === "csv" ? genCSV(msgs, chat) : genTXT(msgs, chat);
        const mime = format === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8";
        const url = "data:" + mime + ";base64," + toBase64(content);
        await new Promise(res => chrome.downloads.download({ url, filename: fn, saveAs: false }, () => res()));
        updateProgress({ text: "[" + chatLabel + "] " + chat.name + ": " + msgs.length + " msgs", currentChatName: chat.name, percent: Math.round((i+1)/chats.length*100), done: i+1, total: chats.length, downloadedFiles });
      } else {
        updateProgress({ text: "[" + chatLabel + "] " + chat.name + ": 0 msgs", currentChatName: chat.name, percent: Math.round((i+1)/chats.length*100), done: i+1, total: chats.length });
      }
    } catch (e) {
      const errStr = (e.message || "").toLowerCase();
      // Detect session/auth expired — stop entire export
      if (/not logged|session expired|auth|unauthorized|not ready/i.test(errStr) && isRunning) {
        isRunning = false; isPaused = false;
        updateProgress({ status: "session_expired", text: "Session expired: " + (e.message || ""), currentChatName: chat.name, percent: Math.round((i+1)/chats.length*100), done: i+1, total: chats.length });
        sendToWAOverlay({ hide: true });
        return;
      }
      failedChats.push({ name: chat.name, error: e.message });
      updateProgress({ text: "[" + chatLabel + "] " + chat.name + ": FAILED", currentChatName: chat.name, percent: Math.round((i+1)/chats.length*100), done: i+1 });
    }

    // Delay between chats (Safe Mode)
    if (i < chats.length - 1 && isRunning) {
      const delay = rand(CFG.delayMin, CFG.delayMax);
      await sleep(delay);
    }
  }

  isRunning = false;

  if (downloadedFiles > 0) {
    const failNote = failedChats.length ? " | " + failedChats.length + " failed" : "";
    const msg = "Done: " + downloadedFiles + " files, " + totalMessages + " messages" + failNote;
    updateProgress({ status: "done", text: msg, percent: 100 });
    sendToWAOverlay({ hide: true, done: true, text: msg, files: downloadedFiles });
    sendToastToWA(msg, false, true);
  } else {
    const msg = "No messages found in date range.";
    updateProgress({ status: "error", text: msg, percent: 100 });
    sendToWAOverlay({ hide: true, done: true, text: msg });
    sendToastToWA(msg, true, false);
  }
}

function genCSV(msgs, chat) {
  let header = '# Chat: ' + (chat.name || 'Unknown');
  if (chat && chat.id && !chat.isGroup && chat.phone) {
    header += ' (' + chat.phone + ')';
  } else if (chat && chat.isGroup && chat.participants && chat.participants.length > 0) {
    header += ' | ' + chat.participants.map(p => p.name + ' (' + p.phone + ')').join(' ');
  }
  let csv = '\uFEFF' + header + '\nTimestamp,Sender,Message\n';
  for (const m of msgs) {
    const d = new Date(m.timestamp*1000);
    const t = d.toISOString().replace("T"," ").substring(0,19);
    csv += t + ",\"" + (m.sender||"").replace(/"/g,'""') + "\",\"" + (m.body||"").replace(/"/g,'""') + "\"\n";
  }
  return csv;
}

function genTXT(msgs, chat) {
  let header = '# Chat: ' + (chat.name || 'Unknown');
  if (chat && chat.id && !chat.isGroup && chat.phone) {
    header += ' (' + chat.phone + ')';
  } else if (chat && chat.isGroup && chat.participants && chat.participants.length > 0) {
    header += ' | ' + chat.participants.map(p => p.name + ' (' + p.phone + ')').join(' ');
  }
  let txt = header + '\n';
  let last = '';
  for (const m of msgs) {
    const d = new Date(m.timestamp*1000);
    const ds = String(d.getDate()).padStart(2,"0")+"/"+String(d.getMonth()+1).padStart(2,"0")+"/"+String(d.getFullYear()).slice(-2);
    const ts = String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
    if (ds !== last) { txt += "\n[" + ds + "]\n"; last = ds; }
    txt += "[" + ts + "] " + (m.sender||"?") + ": " + (m.body||"") + "\n";
  }
  return txt.trim();
}