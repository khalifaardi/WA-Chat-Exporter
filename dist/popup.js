// popup.js v15
const D = id => document.getElementById(id);
const $ = (s,p) => (p||document).querySelectorAll(s);

let allChats = [], selectedSet = new Set(), isRunning = false, isPaused = false;
let polling = null, dropdownOpen = false, loadTimeout = null, lang = "en", i18nLoaded = false;

// ============================================================
// I18N — easy to edit: just change the strings below
// ============================================================
const I18N = {
  id: {
    sectionLang:      "Bahasa",
    extName:          "WA Chat Exporter",
    extDesc:          "Ekspor chat WhatsApp dalam CSV atau teks",
    sectionFormat:    "Pilih Format File",
    sectionChat:      "Pilih Chat",
    sectionDate:      "Pilih Tanggal",
    optCsv:           "CSV (disarankan untuk analisis)",
    optTxt:           "Teks Biasa (format mudah dibaca)",
    allChats:         "Semua Chat",
    selectChats:      "Pilih chat...",
    loading:          "Memuat chat...",
    failed:           "Gagal memuat. Ulangi?",
    failedHint:       "Gagal memuat chat. Muat ulang WhatsApp Web lalu coba lagi.",
    searchPlaceholder:"Cari chat...",
    tooLong:          "Memuat terlalu lama. Muat ulang WhatsApp Web lalu coba lagi.",
    btnReloadWA:      "Muat Ulang WhatsApp",
    dateStart:        "Mulai",
    dateEnd:          "Akhir",
    allMsg:           "Ekspor semua pesan (abaikan rentang tanggal)",
    btnExport:        "Ekspor Chat",
    btnPause:         "Jeda Ekspor",
    btnCancel:        "Batalkan",
    btnResume:        "Lanjutkan",
    statusStarting:   "Memulai ekspor...",
    statusCancelled:  "Ekspor dibatalkan.",
    statusSelect:     "Pilih setidaknya satu chat.",
    groupLabel:       "Grup",
    chatLabel:        "Chat",
    selChats:         " chat dipilih",
    langName:         "Bahasa Indonesia",
    loginTitle:       "Silakan login ke WhatsApp Web dulu",
    loginDesc:        "Buka WhatsApp Web, pindai kode QR dengan ponsel Anda, lalu kembali ke sini.",
    btnOpenWA:        "Buka WhatsApp Web",
    btnCheckAgain:    "Cek Lagi",
  },
  en: {
    sectionLang:      "Language",
    extName:          "WA Chat Exporter",
    extDesc:          "Export WhatsApp chats as CSV or plain text",
    sectionFormat:    "Choose File Format",
    sectionChat:      "Select Chat",
    sectionDate:      "Choose Date",
    optCsv:           "CSV (recommended for analysis)",
    optTxt:           "Plain Text (readable format)",
    allChats:         "All Chats",
    selectChats:      "Select chats...",
    loading:          "Loading chats...",
    failed:           "Failed to load. Retry?",
    failedHint:       "Failed to load chats. Reload WhatsApp Web and try again.",
    searchPlaceholder:"Search chats...",
    tooLong:          "Taking too long. Reload WhatsApp Web and try again.",
    btnReloadWA:      "Reload WhatsApp",
    dateStart:        "Start",
    dateEnd:          "End",
    allMsg:           "Export all messages (ignore date range)",
    btnExport:        "Export Chat",
    btnPause:         "Pause Export",
    btnCancel:        "Cancel",
    btnResume:        "Resume",
    statusStarting:   "Starting export...",
    statusCancelled:  "Export cancelled.",
    statusSelect:     "Select at least one chat.",
    groupLabel:       "Group",
    chatLabel:        "Chat",
    selChats:         " chats selected",
    langName:         "English",
    loginTitle:       "Please log in to WhatsApp Web first",
    loginDesc:        "Open WhatsApp Web, scan the QR code with your phone, then come back.",
    btnOpenWA:        "Open WhatsApp Web",
    btnCheckAgain:    "Check Again",
  }
};

function T(key) {
  return (I18N[lang] && I18N[lang][key]) || (I18N.en && I18N.en[key]) || key;
}

function applyI18n() {
  D("extTitle").textContent = T("extName");
  D("extDesc").textContent = T("extDesc");
  D("dropdownSearch").placeholder = T("searchPlaceholder");
  D("tooLongMsg").textContent = T("tooLong");
  D("btnReloadWA").textContent = T("btnReloadWA");
  D("allMsgRow").querySelector("span").textContent = T("allMsg");
  D("btnExportChat").textContent = T("btnExport");
  D("btnPause").textContent = isPaused ? T("btnResume") : T("btnPause");
  D("btnCancel").textContent = T("btnCancel");
  D("langLabel").textContent = T("langName");

  // Section titles
  const titles = document.querySelectorAll(".section-title");
  if (titles[0]) titles[0].textContent = T("sectionFormat");
  if (titles[1]) titles[1].textContent = T("sectionChat");
  if (titles[2]) titles[2].textContent = T("sectionDate");

  // Login prompt
  D("loginTitle").textContent = T("loginTitle");
  D("loginDesc").textContent = T("loginDesc");
  D("btnOpenWA").textContent = T("btnOpenWA");
  D("btnCheckAgain").textContent = T("btnCheckAgain");

  // Date labels
  const dateLabels = document.querySelectorAll(".date-col label");
  if (dateLabels[0]) dateLabels[0].textContent = T("dateStart");
  if (dateLabels[1]) dateLabels[1].textContent = T("dateEnd");

  // Format options
  D("fmtCsvLabel").textContent = T("optCsv");
  D("fmtTxtLabel").textContent = T("optTxt");

  updateDropdownLabel();
}

document.addEventListener("DOMContentLoaded", () => {
  const now = new Date();
  D("dateTo").value = now.toISOString().split("T")[0];
  const dayAgo = new Date(now.getTime() - 86400000);
  D("dateFrom").value = dayAgo.toISOString().split("T")[0];

  // Language — load first, then init everything else
  chrome.storage.local.get("lang", r => {
    lang = r.lang || "id";
    D("langSelect").value = lang;
    applyI18n();
    i18nLoaded = true;

    // Auto-open WhatsApp Web if not already open
    ensureWATab();

    // Now safe to load chats (T() will return correct language)
    loadChats();
  });

  D("langSelect").addEventListener("change", () => {
    lang = D("langSelect").value;
    chrome.storage.local.set({ lang });
    applyI18n();
    if (allChats.length) { updateDropdownLabel(); renderDropdownOptions(); }
  });

  // All messages toggle
  D("allMsgRow").addEventListener("click", () => {
    const cb = D("allMessages");
    cb.checked = !cb.checked;
    D("dateFrom").disabled = cb.checked;
    D("dateTo").disabled = cb.checked;
  });
  D("allMessages").addEventListener("click", e => e.stopPropagation());
  D("allMessages").addEventListener("change", () => {
    const cb = D("allMessages");
    D("dateFrom").disabled = cb.checked;
    D("dateTo").disabled = cb.checked;
  });

  // Dropdown
  const trigger = D("dropdownTrigger");
  trigger.addEventListener("click", toggleDropdown);
  D("dropdownSearch").addEventListener("input", renderDropdownOptions);
  document.addEventListener("click", e => {
    if (dropdownOpen && !D("chatDropdown").contains(e.target)) closeDropdown();
  });

  // Buttons
  D("btnExportChat").addEventListener("click", startExport);
  D("btnPause").addEventListener("click", togglePause);
  D("btnCancel").addEventListener("click", cancelExport);
  D("btnReloadWA").addEventListener("click", reloadWA);
  D("btnOpenWA").addEventListener("click", openWATab);
  D("btnCheckAgain").addEventListener("click", () => {
    showLoginPrompt(false);
    loadChats();
  });

  // Listen for toast from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "EXPORT_TOAST") {
      D("status").style.display = "";
      D("status").textContent = msg.text || "";
      D("status").className = msg.isError ? "error" : msg.isDone ? "success" : "";
    }
  });

  checkStatus();
  polling = setInterval(checkStatus, 1500);
});

// ============================================================
// Dropdown
// ============================================================
function toggleDropdown() {
  dropdownOpen = !dropdownOpen;
  const trigger = D("dropdownTrigger");
  const menu = D("dropdownMenu");
  trigger.classList.toggle("open", dropdownOpen);
  menu.classList.toggle("open", dropdownOpen);
  if (dropdownOpen) {
    D("dropdownSearch").value = "";
    renderDropdownOptions();
    setTimeout(() => D("dropdownSearch").focus(), 100);
  }
}

function closeDropdown() {
  dropdownOpen = false;
  D("dropdownTrigger").classList.remove("open");
  D("dropdownMenu").classList.remove("open");
}

function renderDropdownOptions() {
  const q = (D("dropdownSearch").value || "").toLowerCase();
  const filtered = allChats.filter(c => !q || c.name.toLowerCase().includes(q));
  const list = D("dropdownList");
  const selCount = selectedSet.size;
  const totalCount = allChats.length;

  if (!allChats.length) {
    list.innerHTML = '<div class="loading">' + T('loading') + '</div>';
    return;
  }

  let html = '';
  // "All Chats" option
  const allChecked = selCount === totalCount && totalCount > 0;
  html += '<div class="option all-chats" data-id="__all__">' +
    '<input type="checkbox" ' + (allChecked ? 'checked' : '') + '/>' +
    '<span class="name">' + T('allChats') + '</span>' +
    '<span style="font-size:10px;color:#999">' + totalCount + '</span>' +
    '</div>';

  for (const c of filtered) {
    const isSel = selectedSet.has(c.id);
    html += '<div class="option" data-id="' + c.id + '">' +
      '<input type="checkbox" ' + (isSel ? 'checked' : '') + '/>' +
      '<span class="name" title="' + c.name + '">' + c.name + '</span>' +
      '<span class="badge ' + (c.isGroup ? 'group' : 'chat') + '">' + T(c.isGroup ? 'groupLabel' : 'chatLabel') + '</span>' +
      '</div>';
  }

  list.innerHTML = html;

  // Click handlers
  list.querySelectorAll(".option").forEach(row => {
    row.addEventListener("click", e => {
      const cb = row.querySelector("input[type=checkbox]");
      if (e.target === cb) return; // let native checkbox handle it
      cb.checked = !cb.checked;
      handleOptionChange(row.dataset.id, cb.checked);
    });
    row.querySelector("input[type=checkbox]").addEventListener("change", e => {
      e.stopPropagation();
      handleOptionChange(row.dataset.id, row.querySelector("input[type=checkbox]").checked);
    });
  });

  updateDropdownLabel();
}

function handleOptionChange(id, checked) {
  if (id === "__all__") {
    if (checked) allChats.forEach(c => selectedSet.add(c.id));
    else selectedSet.clear();
  } else {
    checked ? selectedSet.add(id) : selectedSet.delete(id);
  }
  updateDropdownLabel();
  renderPills();
  renderDropdownOptions(); // refresh checkboxes + all-chats state
}

function renderPills() {
  const bar = D("pillBar");
  const selCount = selectedSet.size;
  const total = allChats.length;
  if (!total || selCount === 0 || selCount === total) { bar.innerHTML = ""; return; }

  const sel = allChats.filter(c => selectedSet.has(c.id));
  const MAX = 5;
  let html = "";
  for (let i = 0; i < Math.min(sel.length, MAX); i++) {
    html += '<span class="pill">' + sel[i].name.substring(0, 22) + '<span class="x" data-remove="' + sel[i].id + '">\u00D7</span></span>';
  }
  if (sel.length > MAX) html += '<span class="more">+ ' + (sel.length - MAX) + ' more</span>';
  bar.innerHTML = html;

  bar.querySelectorAll(".x").forEach(el => {
    el.addEventListener("click", e => {
      e.stopPropagation();
      selectedSet.delete(el.dataset.remove);
      updateDropdownLabel();
      renderPills();
      renderDropdownOptions();
    });
  });
}

function updateDropdownLabel() {
  const label = D("dropdownLabel");
  const sel = selectedSet.size;
  const total = allChats.length;
  if (!total) { label.textContent = T('loading'); label.className = "placeholder"; return; }
  if (sel === 0) { label.textContent = T('selectChats'); label.className = "placeholder"; return; }
  if (sel === total) { label.textContent = T('allChats'); label.className = ""; return; }
  label.textContent = sel > 3 ? sel + T('selChats') : allChats.filter(c => selectedSet.has(c.id)).map(c => c.name.substring(0, 18)).join(", ");
  label.className = "";
}

// ============================================================
// Load Chats
// ============================================================
async function loadChats() {
  D("dropdownLabel").textContent = T('loading');
  D("dropdownLabel").className = "placeholder";
  D("tooLong").style.display = "none";
  if (loadTimeout) clearTimeout(loadTimeout);
  loadTimeout = setTimeout(() => {
    D("tooLongMsg").textContent = T('tooLong');
    D("tooLong").style.display = "";
  }, 15000);

  chrome.runtime.sendMessage({ action: "LOAD_CHATS" }, (r) => {
    if (loadTimeout) clearTimeout(loadTimeout);
    D("tooLong").style.display = "none";
    if (chrome.runtime.lastError || (r && r.error)) {
      const errMsg = (r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "";
      // If error indicates not logged in / not ready, show login wall
      if (/not ready|not open|timed out/i.test(errMsg)) {
        showLoginPrompt(true);
        return;
      }
      D("dropdownLabel").textContent = T('failed');
      D("dropdownLabel").className = "placeholder";
      D("tooLongMsg").textContent = T('failedHint');
      D("tooLong").style.display = "";
      return;
    }
    allChats = r.chats || [];
    selectedSet = new Set(allChats.map(c => c.id));
    updateDropdownLabel();
    renderDropdownOptions();
  });
}

// ============================================================
// Reload WhatsApp Web tab
// ============================================================
async function reloadWA() {
  const btn = D("btnReloadWA");
  btn.disabled = true;
  btn.textContent = T('loading');
  try {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (tabs.length) {
      await chrome.tabs.reload(tabs[0].id);
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = T('btnReloadWA');
        D("tooLong").style.display = "none";
        loadChats();
      }, 3000);
    } else {
      D("tooLongMsg").textContent = T('failedHint');
      btn.textContent = T('btnReloadWA');
      btn.disabled = false;
    }
  } catch (e) {
    D("tooLongMsg").textContent = T('failedHint');
    btn.textContent = T('btnReloadWA');
    btn.disabled = false;
  }
}

// ============================================================
// Auto-open & focus WhatsApp Web tab
// ============================================================
async function ensureWATab() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (tabs.length) {
      // Already open — focus it
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      // Not open — create new tab
      chrome.tabs.create({ url: "https://web.whatsapp.com/", active: true });
    }
  } catch (e) { /* ignore */ }
}

async function openWATab() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
    if (tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      chrome.tabs.create({ url: "https://web.whatsapp.com/", active: true });
    }
  } catch (e) { /* ignore */ }
}

// ============================================================
// Login wall — show/hide
// ============================================================
function showLoginPrompt(show) {
  D("loginPrompt").style.display = show ? "" : "none";
  D("mainUI").style.display = show ? "none" : "";
}

function getSelected() {
  return allChats.filter(c => selectedSet.has(c.id));
}

// ============================================================
// UI State
// ============================================================
function updateUI(state) {
  const running = state === "running";
  D("btnExportChat").style.display = running ? "none" : "";
  D("btnPause").style.display = running ? "" : "none";
  D("btnCancel").style.display = running ? "" : "none";
  document.querySelectorAll('input[name="chatFormat"]').forEach(r => r.disabled = running);
  D("allMessages").disabled = running;
  D("dateFrom").disabled = running || D("allMessages").checked;
  D("dateTo").disabled = running || D("allMessages").checked;
  D("dropdownTrigger").style.pointerEvents = running ? "none" : "";
  D("dropdownTrigger").style.opacity = running ? "0.5" : "1";
}

async function checkStatus() {
  chrome.runtime.sendMessage({ action: "GET_STATUS" }, (p) => {
    if (!p || !p.status) return;
    isRunning = p.status === "running";
    isPaused = !!p.paused;
    if (isRunning) {
      updateUI("running");
      D("status").style.display = "";
      D("status").textContent = p.text || "";
      D("status").className = "";
      D("progressWrap").style.display = "";
      D("progressBar").style.width = (p.percent || 0) + "%";
      D("progressLeft").textContent = (p.done||0) + "/" + (p.total||0) + " chats";
      D("progressRight").textContent = (p.downloadedFiles||0) + " files";
      D("btnPause").textContent = isPaused ? T('btnResume') : T('btnPause');
    } else if (p.status === "done" || p.status === "cancelled" || p.status === "error") {
      updateUI("done");
      D("status").style.display = "";
      D("progressWrap").style.display = "";
      D("progressBar").style.width = "100%";
      D("status").textContent = p.text || "";
      D("status").className = p.status === "error" ? "error" : p.status === "done" ? "success" : "";
      D("btnPause").textContent = T('btnPause');
      setTimeout(() => { if (!isRunning) D("status").style.display = "none"; }, 8000);
    } else {
      updateUI("idle");
      if (!isRunning) D("status").style.display = "none";
    }
  });
}

// ============================================================
// Export
// ============================================================
async function startExport() {
  const chats = getSelected();
  if (!chats.length) {
    D("status").style.display = "";
    D("status").textContent = T('statusSelect');
    D("status").className = "error";
    return;
  }

  isRunning = true; isPaused = false;
  updateUI("running");
  D("status").style.display = "";
  D("status").textContent = T('statusStarting');
  D("status").className = "";
  D("progressWrap").style.display = "";
  D("progressBar").style.width = "0%";
  D("progressLeft").textContent = "";
  D("progressRight").textContent = "";

  const useAll = D("allMessages").checked;
  chrome.runtime.sendMessage({
    action: "START_EXPORT",
    settings: {
      chats,
      dateFrom: useAll ? "1970-01-01" : D("dateFrom").value,
      dateTo: useAll ? new Date().toISOString().split("T")[0] : D("dateTo").value,
      format: document.querySelector('input[name="chatFormat"]:checked').value,
      safeMode: true
    }
  }, () => {
    if (chrome.runtime.lastError) {
      D("status").textContent = chrome.runtime.lastError.message;
      D("status").className = "error";
    }
  });
}

function togglePause() {
  chrome.runtime.sendMessage({ action: "PAUSE_RESUME" }, (r) => {
    if (r) isPaused = r.paused;
  });
}

function cancelExport() {
  chrome.runtime.sendMessage({ action: "CANCEL_EXPORT" });
  isRunning = false; isPaused = false;
  updateUI("idle");
  D("status").style.display = "";
  D("status").textContent = T('statusCancelled');
  D("status").className = "";
}