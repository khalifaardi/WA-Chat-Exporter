// background.js v12
// Perbaikan utama v12:
// 1. FIX: Error btnLoadChatsX dihapus (tidak ada di HTML)
// 2. FIX: Load chat 1000+ — virtual list WA Web di-trigger dengan dispatchEvent
// 3. FIX: Export chat cari by name (bukan index) — aman meski sidebar sudah discroll
// 4. FIX: Pesan historis terbaca — tunggu loading indicator WA menghilang setelah scroll
// 5. FIX: Tidak ada limit pesan — loop sampai benar-benar habis
// 6. NEW: Search bar di popup untuk filter chat

let isRunning = false;
let isPaused  = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'START_EXPORT') {
    if (isRunning) { sendResponse({ error: 'Sedang berjalan' }); return true; }
    startExport(msg.settings);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'PAUSE_RESUME') {
    isPaused = !isPaused;
    updateProgress({ paused: isPaused });
    sendResponse({ paused: isPaused });
    return true;
  }
  if (msg.action === 'CANCEL_EXPORT') {
    isRunning = false; isPaused = false;
    updateProgress({ status: 'cancelled', text: '⛔ Export dibatalkan.', paused: false });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'GET_STATUS') {
    chrome.storage.local.get('exportProgress', r => sendResponse(r.exportProgress || {}));
    return true;
  }
  if (msg.action === 'LOAD_ALL_CHATS') {
    loadAllChatsFromSidebar(msg.tabId)
      .then(chats => sendResponse({ chats }))
      .catch(e   => sendResponse({ error: e.message, chats: [] }));
    return true;
  }
});

// ============================================================
// CONFIG
// ============================================================
const CFG = {
  safeModeDelay:   { min: 4000, max: 8000 },
  normalDelay:     { min: 1000, max: 2200 },
  pauseEvery:      15,
  pauseDuration:   45000,
  scrollDelay:     700,
  msgLoadTimeout:  14000,
  maxScrollRounds: 300,   // batas atas scroll saat export (praktis unlimited)
  noNewLimit:      15,    // berhenti jika 15 ronde berturut-turut tidak ada pesan baru
};

const rand  = r => Math.floor(Math.random() * (r.max - r.min + 1)) + r.min;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sanitize = n => (n||'chat').replace(/[\/\\:*?"<>|]/g,'').replace(/\s+/g,'_')
  .replace(/_{2,}/g,'_').replace(/^_|_$/g,'').substring(0,80) || 'chat';

// ============================================================
// LOAD SEMUA CHAT (virtual-list aware — support 1000+ chat)
// ============================================================
async function loadAllChatsFromSidebar(tabId) {
  updateProgress({ status: 'loading', text: '📋 Memuat chat...' });

  // Reset sidebar ke posisi paling atas dulu
  await executeInTab(tabId, () => {
    const sb = getSidebar();
    if (sb) { sb.scrollTop = 0; }

    function getSidebar() {
      const a = document.querySelector('[data-testid="chat-list"]');
      if (a) return a;
      const ps = document.querySelector('#pane-side');
      if (!ps) return null;
      for (const d of ps.querySelectorAll('div')) {
        const s = window.getComputedStyle(d);
        if ((s.overflowY === 'scroll' || s.overflowY === 'auto') && d.scrollHeight > d.clientHeight + 50) return d;
      }
      return null;
    }
  }, []);

  await sleep(400);

  // Kumpulkan semua chat dengan scroll bertahap
  // WA Web pakai react-virtualized: elemen DOM dibuat/dihapus saat scroll
  // Kita harus scroll perlahan, scrape, scroll lagi, sampai tidak ada data baru
  const allChatsMap = new Map(); // key: name, value: chat object
  let prevSize = 0;
  let sameCount = 0;
  const MAX_SAME = 8;
  let scrollStep = 0;

  for (let i = 0; i < 500; i++) {
    // Scrape chat yang terlihat sekarang
    const batch = await executeInTab(tabId, () => {
      const results = [];
      document.querySelectorAll('[data-testid="cell-frame-container"]').forEach((row, idx) => {
        const nameEl = row.querySelector('span[title][dir="auto"], span[title]');
        if (!nameEl) return;
        const name = (nameEl.getAttribute('title') || nameEl.textContent || '').trim();
        if (!name) return;
        const previewText    = row.innerText || '';
        const hasGroupPrefix = /\n[^:]{1,40}:/.test(previewText);
        const isPhone        = /^\+?\d[\d\s\-\(\)]{6,}$/.test(name.trim());
        const isGroup        = hasGroupPrefix && !isPhone;
        // Simpan posisi scroll saat ini sebagai referensi klik nanti
        const sb = (() => {
          const a = document.querySelector('[data-testid="chat-list"]');
          if (a) return a;
          const ps = document.querySelector('#pane-side');
          if (!ps) return null;
          for (const d of ps.querySelectorAll('div')) {
            const s = window.getComputedStyle(d);
            if ((s.overflowY==='scroll'||s.overflowY==='auto') && d.scrollHeight>d.clientHeight+50) return d;
          }
          return null;
        })();
        const sbScrollTop = sb ? sb.scrollTop : 0;
        results.push({ name, isGroup, scrollPos: sbScrollTop });
      });
      return results;
    }, []);

    if (batch) {
      for (const c of batch) {
        if (!allChatsMap.has(c.name)) {
          allChatsMap.set(c.name, c);
        }
      }
    }

    const size = allChatsMap.size;
    updateProgress({ text: `📋 ${size} chat ditemukan, scroll ${i+1}...` });

    if (size === prevSize) {
      sameCount++;
      if (sameCount >= MAX_SAME) break; // tidak ada chat baru — selesai
    } else {
      sameCount = 0;
      prevSize = size;
    }

    // Scroll sidebar ke bawah — gunakan wheel event agar react-virtualized merespons
    const scrolled = await executeInTab(tabId, () => {
      function getSidebar() {
        const a = document.querySelector('[data-testid="chat-list"]');
        if (a) return a;
        const ps = document.querySelector('#pane-side');
        if (!ps) return null;
        for (const d of ps.querySelectorAll('div')) {
          const s = window.getComputedStyle(d);
          if ((s.overflowY==='scroll'||s.overflowY==='auto') && d.scrollHeight>d.clientHeight+50) return d;
        }
        return null;
      }
      const sb = getSidebar();
      if (!sb) return false;
      const before = sb.scrollTop;
      // Scroll langsung
      sb.scrollTop += 600;
      // Juga dispatch scroll event agar react-virtualized tahu
      sb.dispatchEvent(new Event('scroll', { bubbles: true }));
      return true;
    }, []);

    if (!scrolled) break;
    await sleep(280); // cukup untuk react-virtualized render
  }

  // Assign index urut (0-based) untuk referensi klik
  const allChats = Array.from(allChatsMap.values()).map((c, i) => ({ ...c, index: i }));

  // Scroll sidebar kembali ke atas
  await executeInTab(tabId, () => {
    function getSidebar() {
      const a = document.querySelector('[data-testid="chat-list"]');
      if (a) return a;
      const ps = document.querySelector('#pane-side');
      if (!ps) return null;
      for (const d of ps.querySelectorAll('div')) {
        const s = window.getComputedStyle(d);
        if ((s.overflowY==='scroll'||s.overflowY==='auto') && d.scrollHeight>d.clientHeight+50) return d;
      }
      return null;
    }
    const sb = getSidebar();
    if (sb) {
      sb.scrollTop = 0;
      sb.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }, []);

  updateProgress({ status: 'idle', text: `✅ ${allChats.length} chat dimuat.` });
  return allChats;
}

// ============================================================
// MAIN EXPORT LOOP
// ============================================================
async function startExport(settings) {
  isRunning = true; isPaused = false;
  const { chats, dateFrom, dateTo, format, tabId, safeMode } = settings;

  let totalMessages   = 0;
  let downloadedFiles = 0;
  const failedChats   = [];

  updateProgress({
    status: 'running', text: '🚀 Export dimulai...', percent: 0,
    total: chats.length, done: 0, downloadedFiles: 0, paused: false
  });

  for (let i = 0; i < chats.length; i++) {
    if (!isRunning) break;

    while (isPaused && isRunning) {
      updateProgress({ paused: true, text: '⏸ Di-pause. Klik Resume.' });
      await sleep(500);
    }
    if (!isRunning) break;

    if (safeMode && i > 0 && i % CFG.pauseEvery === 0) {
      for (let s = CFG.pauseDuration / 1000; s > 0 && isRunning; s--) {
        updateProgress({ text: `🛡️ Jeda ${s}d (${i}/${chats.length} selesai)` });
        await sleep(1000);
      }
    }

    const chat = chats[i];
    updateProgress({
      status: 'running',
      text: `⏳ [${i+1}/${chats.length}] "${chat.name}"...`,
      percent: Math.round((i / chats.length) * 100),
      done: i, total: chats.length, subText: ''
    });

    let messages = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Buka chat by name — scroll sidebar untuk temukan, lalu klik
        const clicked = await openChatByName(tabId, chat.name);
        if (!clicked) throw new Error(`Chat "${chat.name}" tidak ditemukan`);

        const loaded = await waitForMessages(tabId, CFG.msgLoadTimeout);
        if (!loaded) throw new Error('Timeout loading pesan');

        await sleep(800);

        messages = await collectAllMessages(tabId, dateFrom, dateTo, txt => {
          updateProgress({ subText: txt });
        });

        break;

      } catch(e) {
        if (attempt < 3) {
          updateProgress({ subText: `🔄 Retry ${attempt}/3: ${e.message}` });
          await sleep(2500);
        } else {
          failedChats.push({ name: chat.name, error: e.message });
          updateProgress({
            text: `⚠️ [${i+1}/${chats.length}] "${chat.name}" gagal: ${e.message}`,
            percent: Math.round(((i+1)/chats.length)*100),
            done: i+1, total: chats.length
          });
        }
      }
    }

    if (messages && messages.length > 0) {
      totalMessages += messages.length;
      downloadedFiles++;
      const fn = `${sanitize(chat.name)}_${dateFrom}_${dateTo}.${format}`;
      const content  = format === 'csv'
        ? generateCSV(messages, chat.name, dateFrom, dateTo)
        : generateHTML(messages, chat.name, dateFrom, dateTo);
      const mime = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/html';
      const url  = 'data:' + mime + ';base64,' + btoa(unescape(encodeURIComponent(content)));
      await new Promise(res => chrome.downloads.download({ url, filename: fn, saveAs: false }, () => res()));
      updateProgress({
        status: 'running',
        text: `✅ [${i+1}/${chats.length}] "${chat.name}": ${messages.length} pesan`,
        percent: Math.round(((i+1)/chats.length)*100),
        done: i+1, total: chats.length, downloadedFiles
      });
    } else if (messages !== null) {
      updateProgress({
        text: `ℹ️ [${i+1}/${chats.length}] "${chat.name}": tidak ada pesan di rentang ini`,
        percent: Math.round(((i+1)/chats.length)*100),
        done: i+1, total: chats.length
      });
    }

    if (i < chats.length - 1 && isRunning) {
      const delay = rand(safeMode ? CFG.safeModeDelay : CFG.normalDelay);
      if (safeMode) updateProgress({ subText: `⏳ Jeda ${(delay/1000).toFixed(1)}d...` });
      await sleep(delay);
    }
  }

  isRunning = false;
  const failNote = failedChats.length > 0 ? ` | ⚠️ ${failedChats.length} gagal` : '';
  updateProgress({
    status: downloadedFiles > 0 ? 'done' : 'error',
    text: downloadedFiles > 0
      ? `🎉 Selesai! ${downloadedFiles} file, ${totalMessages} pesan.${failNote}`
      : `❌ Tidak ada pesan ditemukan.${failNote}`,
    percent: 100, done: chats.length, total: chats.length, paused: false
  });
}

// ============================================================
// BUKA CHAT BY NAME — scroll sidebar untuk cari, lalu klik
// ============================================================
async function openChatByName(tabId, chatName) {
  // Coba langsung klik dulu (mungkin sudah terlihat)
  let clicked = await executeInTab(tabId, (name) => {
    const rows = document.querySelectorAll('[data-testid="cell-frame-container"]');
    for (const row of rows) {
      const el = row.querySelector('span[title][dir="auto"], span[title]');
      if (!el) continue;
      const n = (el.getAttribute('title') || el.textContent || '').trim();
      if (n === name) { row.click(); return true; }
    }
    return false;
  }, [chatName]);

  if (clicked) return true;

  // Kalau tidak ketemu — scroll sidebar dari atas, cari nama
  // Reset ke atas dulu
  await executeInTab(tabId, () => {
    function getSB() {
      const a = document.querySelector('[data-testid="chat-list"]');
      if (a) return a;
      const ps = document.querySelector('#pane-side');
      if (!ps) return null;
      for (const d of ps.querySelectorAll('div')) {
        const s = window.getComputedStyle(d);
        if ((s.overflowY==='scroll'||s.overflowY==='auto') && d.scrollHeight>d.clientHeight+50) return d;
      }
      return null;
    }
    const sb = getSB();
    if (sb) { sb.scrollTop = 0; sb.dispatchEvent(new Event('scroll',{bubbles:true})); }
  }, []);
  await sleep(350);

  for (let i = 0; i < 200; i++) {
    clicked = await executeInTab(tabId, (name) => {
      const rows = document.querySelectorAll('[data-testid="cell-frame-container"]');
      for (const row of rows) {
        const el = row.querySelector('span[title][dir="auto"], span[title]');
        if (!el) continue;
        const n = (el.getAttribute('title') || el.textContent || '').trim();
        if (n === name) { row.click(); return true; }
      }
      return false;
    }, [chatName]);

    if (clicked) return true;

    // Scroll sidebar ke bawah
    const atBottom = await executeInTab(tabId, () => {
      function getSB() {
        const a = document.querySelector('[data-testid="chat-list"]');
        if (a) return a;
        const ps = document.querySelector('#pane-side');
        if (!ps) return null;
        for (const d of ps.querySelectorAll('div')) {
          const s = window.getComputedStyle(d);
          if ((s.overflowY==='scroll'||s.overflowY==='auto') && d.scrollHeight>d.clientHeight+50) return d;
        }
        return null;
      }
      const sb = getSB();
      if (!sb) return true;
      const before = sb.scrollTop;
      sb.scrollTop += 500;
      sb.dispatchEvent(new Event('scroll',{bubbles:true}));
      return sb.scrollTop === before; // true jika tidak bergerak (sudah di bawah)
    }, []);

    await sleep(220);
    if (atBottom) break;
  }

  return false;
}

// ============================================================
// KUMPULKAN SEMUA PESAN — scroll sampai pesan tertua di rentang
// Kunci fix: tunggu loading indicator WA hilang setelah setiap scroll
// ============================================================
async function collectAllMessages(tabId, dateFrom, dateTo, onProgress) {
  const allMessages = new Map();

  // Step 1: Scroll ke paling atas chat (trigger lazy-load WA)
  onProgress('📜 Memuat pesan lama...');
  await executeInTab(tabId, () => {
    function getPanel() {
      const p = document.querySelector('[data-testid="conversation-panel-messages"]');
      if (p) return p;
      const main = document.querySelector('#main');
      if (!main) return null;
      for (const d of main.querySelectorAll('div')) {
        const s = window.getComputedStyle(d);
        if ((s.overflowY==='scroll'||s.overflowY==='auto') && d.scrollHeight>d.clientHeight+50) return d;
      }
      return null;
    }
    const p = getPanel();
    if (p) p.scrollTop = 0;
  }, []);

  // Step 2: Scroll ke atas sambil tunggu loading, sampai tanggal awal terbaca
  await scrollUntilTargetDate(tabId, dateFrom, onProgress);

  // Step 3: Scroll ke bawah sambil kumpulkan semua pesan
  let noNewRounds = 0;
  let round = 0;

  while (noNewRounds < CFG.noNewLimit && round < CFG.maxScrollRounds) {
    // Expand tombol "baca lebih" jika ada
    await expandReadMore(tabId);

    // Scrape DOM saat ini
    const batch = await executeInTab(tabId, scrapeVisible, [dateFrom, dateTo]);
    let newCount = 0;

    if (batch) {
      for (const m of batch) {
        const key = `${m.pengirim}||${m.tanggal}||${m.pesan.substring(0, 80)}`;
        if (!allMessages.has(key)) {
          allMessages.set(key, m);
          newCount++;
        }
      }
    }

    round++;
    onProgress(`📨 ${allMessages.size} pesan terkumpul (ronde ${round})...`);

    if (newCount === 0) noNewRounds++;
    else noNewRounds = 0;

    // Cek apakah sudah lewat tanggal akhir
    const past = await executeInTab(tabId, checkPastEnd, [dateTo]);
    if (past) break;

    // Scroll ke bawah + tunggu WA lazy-load
    const more = await executeInTab(tabId, scrollDownPanel, []);
    if (!more) break;

    // Tunggu WA selesai lazy-load (hilangkan loading spinner)
    await waitForLoadingDone(tabId, 3000);
    await sleep(CFG.scrollDelay);
  }

  const result = Array.from(allMessages.values());
  result.sort((a, b) => parseTS(a.tanggal) - parseTS(b.tanggal));
  return result;
}

// Scroll ke atas + tunggu loading WA + cek tanggal awal terbaca
async function scrollUntilTargetDate(tabId, dateFrom, onProgress) {
  const parts = dateFrom.split('-');
  const target = new Date(+parts[0], +parts[1]-1, +parts[2]);

  for (let i = 0; i < 200; i++) {
    // Cek apakah tanggal awal sudah ada di DOM
    const ok = await executeInTab(tabId, (y, mo, d) => {
      // Fungsi parse tanggal lokal
      const MONTHS = {
        jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
        januari:0,februari:1,maret:2,april:3,mei:4,juni:5,juli:6,agustus:7,
        september:8,oktober:9,november:10,desember:11,march:2,june:5,july:6,august:7,october:9
      };
      function pl(str) {
        str=(str||'').trim();
        if(/^(today|hari ini)$/i.test(str)) return new Date();
        if(/^(yesterday|kemarin)$/i.test(str)){const x=new Date();x.setDate(x.getDate()-1);return x;}
        const sl=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if(sl) return new Date(+sl[3],+sl[1]-1,+sl[2]);
        const lo=str.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
        if(lo){const m=MONTHS[lo[2].toLowerCase()];if(m!==undefined)return new Date(+lo[3],m,+lo[1]);}
        return null;
      }
      const target = new Date(y, mo-1, d);
      const labels = document.querySelectorAll('[data-testid="msg-dateseparator"] span');
      let earliest = null;
      labels.forEach(el=>{const dt=pl(el.textContent);if(dt&&(!earliest||dt<earliest))earliest=dt;});
      return earliest !== null && earliest <= target;
    }, [+parts[0], +parts[1], +parts[2]]);

    if (ok) break;

    // Scroll ke atas
    await executeInTab(tabId, () => {
      function getPanel() {
        const p = document.querySelector('[data-testid="conversation-panel-messages"]');
        if (p) return p;
        const main = document.querySelector('#main');
        if (!main) return null;
        for (const d of main.querySelectorAll('div')) {
          const s = window.getComputedStyle(d);
          if ((s.overflowY==='scroll'||s.overflowY==='auto') && d.scrollHeight>d.clientHeight+50) return d;
        }
        return null;
      }
      const p = getPanel();
      if (p) p.scrollTop = 0;
    }, []);

    // Tunggu WA lazy-load selesai (loading indicator di atas pesan)
    await waitForLoadingDone(tabId, 5000);
    await sleep(500);

    onProgress(`📜 Memuat pesan lama... (scroll ${i+1})`);
  }
}

// Tunggu loading indicator WA hilang (artinya pesan sudah dimuat)
async function waitForLoadingDone(tabId, maxWait) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const loading = await executeInTab(tabId, () => {
      // WA menampilkan spinner/loading saat memuat pesan historis
      const spinner = document.querySelector(
        '[data-testid="msg-loading"], ' +
        '[data-icon="loading"], ' +
        'div[class*="loading"]'
      );
      return !!spinner;
    }, []);
    if (!loading) return; // sudah selesai load
    await sleep(200);
  }
}

// Expand tombol "Baca Selengkapnya" / "Read More"
async function expandReadMore(tabId) {
  await executeInTab(tabId, () => {
    const keywords = ['read more','baca selengkapnya','baca lebih','show more','lihat lebih'];
    document.querySelectorAll('span[role="button"], button').forEach(el => {
      const txt = (el.textContent||'').toLowerCase().trim();
      if (keywords.some(k => txt.includes(k))) {
        try { el.click(); } catch(e) {}
      }
    });
  }, []);
  await sleep(200);
}

// ============================================================
// IN-PAGE FUNCTIONS
// ============================================================

function checkPastEnd(dateTo) {
  const tp = dateTo.split('-');
  const toDate = new Date(+tp[0],+tp[1]-1,+tp[2]);
  toDate.setHours(23,59,59,999);
  const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,januari:0,februari:1,maret:2,april:3,mei:4,juni:5,juli:6,agustus:7,september:8,oktober:9,november:10,desember:11,march:2,june:5,july:6,august:7,october:9};
  function pl(str){str=(str||'').trim();if(/^(today|hari ini)$/i.test(str))return new Date();if(/^(yesterday|kemarin)$/i.test(str)){const d=new Date();d.setDate(d.getDate()-1);return d;}const sl=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(sl)return new Date(+sl[3],+sl[1]-1,+sl[2]);const lo=str.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);if(lo){const m=MONTHS[lo[2].toLowerCase()];if(m!==undefined)return new Date(+lo[3],m,+lo[1]);}return null;}
  const labels=document.querySelectorAll('[data-testid="msg-dateseparator"] span');
  let latest=null;
  labels.forEach(el=>{const d=pl(el.textContent);if(d&&(!latest||d>latest))latest=d;});
  return latest ? latest > toDate : false;
}

function scrollDownPanel() {
  function getPanel() {
    const p=document.querySelector('[data-testid="conversation-panel-messages"]');
    if(p)return p;
    const main=document.querySelector('#main');
    if(!main)return null;
    for(const d of main.querySelectorAll('div')){const s=window.getComputedStyle(d);if((s.overflowY==='scroll'||s.overflowY==='auto')&&d.scrollHeight>d.clientHeight+50)return d;}
    return null;
  }
  const panel=getPanel();
  if(!panel)return false;
  const before=panel.scrollTop;
  panel.scrollTop += panel.clientHeight * 0.65;
  panel.dispatchEvent(new Event('scroll',{bubbles:true}));
  return Math.abs(panel.scrollTop-before)>3 || panel.scrollTop < panel.scrollHeight-panel.clientHeight-5;
}

function scrapeVisible(dateFrom, dateTo) {
  const fp=dateFrom.split('-'), tp=dateTo.split('-');
  const from=new Date(+fp[0],+fp[1]-1,+fp[2]);
  const to=new Date(+tp[0],+tp[1]-1,+tp[2]);
  to.setHours(23,59,59,999);

  const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,januari:0,februari:1,maret:2,april:3,mei:4,juni:5,juli:6,agustus:7,september:8,oktober:9,november:10,desember:11,march:2,june:5,july:6,august:7,october:9};
  function pl(str){str=(str||'').trim();if(/^(today|hari ini)$/i.test(str))return new Date();if(/^(yesterday|kemarin)$/i.test(str)){const d=new Date();d.setDate(d.getDate()-1);return d;}const sl=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(sl)return new Date(+sl[3],+sl[1]-1,+sl[2]);const lo=str.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);if(lo){const m=MONTHS[lo[2].toLowerCase()];if(m!==undefined)return new Date(+lo[3],m,+lo[1]);}return null;}

  const messages=[];
  let currentDate=null;

  const allNodes=document.querySelectorAll('[data-testid="msg-dateseparator"], [data-testid="msg-container"]');

  allNodes.forEach(node=>{
    // Date separator
    if(node.matches('[data-testid="msg-dateseparator"]')||node.querySelector('[data-testid="msg-dateseparator"]')){
      const sepEl=node.querySelector('[data-testid="msg-dateseparator"] span')||node.querySelector('span');
      if(sepEl){const d=pl(sepEl.textContent.trim());if(d)currentDate=d;}
      return;
    }
    if(!node.matches('[data-testid="msg-container"]'))return;

    let sender='Saya', msgDate=currentDate, timeStr='-';

    const copyable=node.querySelector('[data-pre-plain-text]');
    if(copyable){
      const meta=copyable.getAttribute('data-pre-plain-text')||'';
      const m=meta.match(/\[(\d+:\d+),\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]\s*(.*?):\s*$/);
      if(m){
        const[,jam,n1,n2,yr,name]=m;
        sender=name.trim();
        msgDate=new Date(+yr,+n1-1,+n2);
        const dd=String(msgDate.getDate()).padStart(2,'0');
        const mm=String(msgDate.getMonth()+1).padStart(2,'0');
        timeStr=`${dd}/${mm}/${yr} ${jam}`;
      }
    } else {
      const timeEl=node.querySelector('[data-testid="msg-meta"] span')||node.querySelector('span[aria-label]');
      if(timeEl&&msgDate){
        const t=timeEl.textContent.trim();
        if(/^\d{1,2}:\d{2}$/.test(t)){
          const dd=String(msgDate.getDate()).padStart(2,'0');
          const mm=String(msgDate.getMonth()+1).padStart(2,'0');
          timeStr=`${dd}/${mm}/${msgDate.getFullYear()} ${t}`;
        }
      }
    }

    if(msgDate&&!isNaN(msgDate)&&(msgDate<from||msgDate>to))return;

    // Ambil teks pesan — gabungkan semua span, jangan terpotong
    let text='';

    if(copyable){
      // Ambil semua span selectable-text, gabungkan unik
      const spans=copyable.querySelectorAll('span.selectable-text');
      if(spans.length>0){
        const parts=[];
        const seen=new Set();
        spans.forEach(el=>{
          const t=(el.innerText||el.textContent||'').trim();
          if(t&&!seen.has(t)){seen.add(t);parts.push(t);}
        });
        text=parts.join('\n').trim();
      }
      // fallback: innerText copyable minus metadata
      if(!text){
        text=(copyable.innerText||'').replace(/^\[\d{1,2}:\d{2},.*?\]\s*.+?:\s*/,'').trim();
      }
    }

    if(!text){
      const spans=node.querySelectorAll('span.selectable-text');
      if(spans.length>0){
        const parts=[];
        const seen=new Set();
        spans.forEach(el=>{
          const t=(el.innerText||el.textContent||'').trim();
          if(t&&!seen.has(t)){seen.add(t);parts.push(t);}
        });
        text=parts.join('\n').trim();
      }
    }

    if(!text){
      const alt=node.querySelector('[data-testid="selectable-text"]');
      if(alt)text=(alt.innerText||alt.textContent||'').trim();
    }

    if(!text){
      if(node.querySelector('[data-testid="sticker-image"]'))      text='[Sticker]';
      else if(node.querySelector('[data-testid="document-thumb"]'))text='[Dokumen]';
      else if(node.querySelector('[data-testid="audio-player"]'))  text='[Voice Note]';
      else if(node.querySelector('[data-testid="image-thumb"]'))   text='[Gambar]';
      else if(node.querySelector('video'))                         text='[Video]';
      else if(node.querySelector('img[src*="blob"]'))              text='[Gambar]';
      else if(node.querySelector('[data-icon="poll"]'))            text='[Poll]';
      else if(node.querySelector('[data-testid="media-url-preview"]'))text='[Link]';
    }

    if(!text)return;

    text=text.replace(/\u200B|\u200C|\u200D|\uFEFF/g,'').trim();
    if(!text)return;

    messages.push({tanggal:timeStr, pengirim:sender, pesan:text});
  });

  return messages;
}

// ============================================================
// HELPERS
// ============================================================
function parseTS(s) {
  if(!s||s==='-')return 0;
  const m=s.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if(!m)return 0;
  return new Date(+m[3],+m[2]-1,+m[1],+m[4],+m[5]).getTime();
}

async function waitForMessages(tabId, timeout) {
  const start=Date.now();
  while(Date.now()-start<timeout){
    const found=await executeInTab(tabId,()=>document.querySelectorAll('[data-testid="msg-container"]').length>0,[]);
    if(found)return true;
    await sleep(300);
  }
  return false;
}

function executeInTab(tabId, func, args=[]) {
  return new Promise((resolve,reject)=>{
    chrome.scripting.executeScript(
      {target:{tabId},func,args},
      results=>{
        if(chrome.runtime.lastError)reject(new Error(chrome.runtime.lastError.message));
        else resolve(results?.[0]?.result);
      }
    );
  });
}

function updateProgress(data) {
  chrome.storage.local.get('exportProgress',r=>{
    const prev=r.exportProgress||{};
    chrome.storage.local.set({exportProgress:{...prev,...data,ts:Date.now()}});
  });
}

// ============================================================
// GENERATE OUTPUT
// ============================================================
function generateCSV(messages, chatName, dateFrom, dateTo) {
  const esc=v=>`"${(v||'').replace(/"/g,'""')}"`;
  let csv='\uFEFF';
  csv+=`# Chat: ${chatName}\n# Periode: ${dateFrom} s/d ${dateTo}\n# Total: ${messages.length} pesan\n`;
  csv+='No,Tanggal & Waktu,Pengirim,Pesan\n';
  messages.forEach((m,i)=>{csv+=`${i+1},${esc(m.tanggal)},${esc(m.pengirim)},${esc(m.pesan)}\n`;});
  return csv;
}

function generateHTML(messages, chatName, dateFrom, dateTo) {
  const esc=s=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const senders={};
  messages.forEach(m=>{senders[m.pengirim]=(senders[m.pengirim]||0)+1;});
  const senderRows=Object.entries(senders).sort((a,b)=>b[1]-a[1])
    .map(([n,c])=>`<tr><td>${esc(n)}</td><td>${c}</td></tr>`).join('');
  const rows=messages.map((m,i)=>`<tr>
    <td class="num">${i+1}</td>
    <td class="time">${esc(m.tanggal)}</td>
    <td class="sender">${esc(m.pengirim)}</td>
    <td class="msg">${esc(m.pesan).replace(/\n/g,'<br>')}</td>
  </tr>`).join('');
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<title>${esc(chatName)} — ${dateFrom} s/d ${dateTo}</title>
<style>
body{font-family:-apple-system,Arial,sans-serif;background:#f0f2f5;margin:0;padding:20px}
.hdr{background:#128C7E;color:#fff;padding:14px 18px;border-radius:10px;margin-bottom:12px}
.hdr h1{font-size:16px;margin:0 0 2px}.hdr p{font-size:11px;opacity:.8;margin:0}
.cards{display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap}
.card{background:#fff;border-radius:8px;padding:10px 14px;box-shadow:0 1px 4px rgba(0,0,0,.07);min-width:90px}
.card .val{font-size:20px;font-weight:700;color:#128C7E}.card .lbl{font-size:10px;color:#888}
.summ{background:#fff;border-radius:8px;padding:12px 16px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.summ h3{font-size:11px;color:#555;margin:0 0 6px}.summ table{border-collapse:collapse;font-size:12px}
.summ td{padding:2px 12px 2px 0;color:#333}.summ td:last-child{font-weight:600;color:#128C7E;text-align:right}
table.main{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
th{background:#128C7E;color:#fff;padding:9px 12px;text-align:left;font-size:11px}
td{padding:7px 12px;border-bottom:1px solid #f0f2f5;vertical-align:top;font-size:12px}
tr:last-child td{border-bottom:none}tr:hover td{background:#f5faf9}
td.num{color:#ccc;width:32px}td.time{color:#999;white-space:nowrap;width:120px;font-size:11px}
td.sender{color:#128C7E;font-weight:600;white-space:nowrap;width:100px}
td.msg{color:#222;word-break:break-word;line-height:1.6}
</style></head><body>
<div class="hdr"><h1>💬 ${esc(chatName)}</h1><p>${dateFrom} s/d ${dateTo}</p></div>
<div class="cards">
  <div class="card"><div class="val">${messages.length}</div><div class="lbl">Total Pesan</div></div>
  <div class="card"><div class="val">${Object.keys(senders).length}</div><div class="lbl">Peserta</div></div>
</div>
<div class="summ"><h3>📊 Pesan per Peserta</h3><table>${senderRows}</table></div>
<table class="main"><thead><tr><th>#</th><th>Waktu</th><th>Pengirim</th><th>Pesan</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
}
