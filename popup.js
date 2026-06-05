// popup.js v12

const today = new Date();
const ago7  = new Date(); ago7.setDate(today.getDate() - 7);
document.getElementById('dateFrom').value = ago7.toISOString().split('T')[0];
document.getElementById('dateTo').value   = today.toISOString().split('T')[0];

let pollInterval = null;
let safeMode     = false;

// ============================================================
// SAFE MODE TOGGLE
// ============================================================
document.getElementById('safeToggleRow').addEventListener('click', () => {
  safeMode = !safeMode;
  document.getElementById('safeToggle').classList.toggle('on', safeMode);
  document.getElementById('safeLabel').textContent = safeMode ? 'ON' : 'OFF';
});

// ============================================================
// TAB SWITCHING
// ============================================================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ============================================================
// CEK STATUS SAAT POPUP DIBUKA
// ============================================================
window.addEventListener('load', () => {
  chrome.runtime.sendMessage({ action: 'GET_STATUS' }, progress => {
    if (!progress || !progress.status) return;
    if (progress.status === 'running') {
      setExportUI('running', progress.paused);
      showProgress(progress);
      startPolling();
    } else if (progress.status === 'done') {
      showProgress(progress);
      setExportUI('idle');
    }
  });
});

// ============================================================
// SEARCH BAR — filter chat list
// ============================================================
document.getElementById('chatSearch').addEventListener('input', function() {
  const q = this.value.toLowerCase().trim();
  let visible = 0;
  document.querySelectorAll('#chatList .chat-item').forEach(item => {
    const name = (item.querySelector('.name')?.textContent || '').toLowerCase();
    const show  = !q || name.includes(q);
    item.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  const counter = document.getElementById('searchCount');
  if (counter) counter.textContent = q ? `${visible} hasil` : '';
});

// ============================================================
// MUAT SEMUA CHAT (via background.js — unlimited)
// ============================================================
document.getElementById('btnLoadChats').addEventListener('click', async () => {
  const btn = document.getElementById('btnLoadChats');
  btn.disabled = true;
  btn.textContent = '⏳ Memuat...';
  setStatus('⏳ Memuat semua chat... ini mungkin butuh 10–30 detik.');

  const tab = await getWATab();
  if (!tab) {
    btn.disabled = false;
    btn.textContent = '🔄 Muat Semua Chat';
    return;
  }

  chrome.runtime.sendMessage({ action: 'LOAD_ALL_CHATS', tabId: tab.id }, res => {
    btn.disabled = false;
    btn.textContent = '🔄 Muat Semua Chat';

    if (!res || res.error || !res.chats || res.chats.length === 0) {
      setStatus('❌ Gagal memuat chat. Pastikan WhatsApp Web sudah login.', 'error');
      return;
    }
    renderChatList(res.chats);
    setStatus(`✅ ${res.chats.length} chat dimuat. Centang yang mau di-export.`, 'success');
  });
});

function renderChatList(chats) {
  const listEl = document.getElementById('chatList');
  listEl.innerHTML = '';

  // Reset search
  const searchEl = document.getElementById('chatSearch');
  if (searchEl) searchEl.value = '';
  const counter = document.getElementById('searchCount');
  if (counter) counter.textContent = '';

  chats.forEach((chat, i) => {
    const div = document.createElement('div');
    div.className = 'chat-item';
    const safeName = (chat.name || '').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    div.innerHTML = `
      <input type="checkbox" class="chat-check" value="${i}" checked>
      <span class="name" title="${chat.name}">${safeName}</span>
      <span class="badge ${chat.isGroup ? 'group' : 'personal'}">${chat.isGroup ? 'Grup' : 'Chat'}</span>`;
    listEl.appendChild(div);
  });

  document.getElementById('chatListContainer').style.display = 'block';
  window._loadedChats = chats;

  // Re-attach check-all
  const ca    = document.getElementById('checkAll');
  const newCa = ca.cloneNode(true);
  ca.parentNode.replaceChild(newCa, ca);
  newCa.checked = true;
  newCa.addEventListener('change', () => {
    // Hanya toggle yang terlihat (sesuai filter search)
    document.querySelectorAll('#chatList .chat-item').forEach(item => {
      if (item.style.display !== 'none') {
        const cb = item.querySelector('.chat-check');
        if (cb) cb.checked = newCa.checked;
      }
    });
  });
}

// ============================================================
// MULAI EXPORT
// ============================================================
document.getElementById('btnExportChat').addEventListener('click', async () => {
  const dateFrom = document.getElementById('dateFrom').value;
  const dateTo   = document.getElementById('dateTo').value;
  const format   = document.getElementById('chatFormat').value;

  if (!dateFrom || !dateTo)  { setStatus('❌ Pilih rentang tanggal dulu.', 'error'); return; }
  if (!window._loadedChats)  { setStatus('❌ Klik "Muat Semua Chat" dulu.', 'error'); return; }

  const checked = [...document.querySelectorAll('.chat-check:checked')];
  if (checked.length === 0)  { setStatus('❌ Pilih minimal 1 chat.', 'error'); return; }

  const selectedChats = checked.map(c => window._loadedChats[parseInt(c.value)]);
  const tab = await getWATab(); if (!tab) return;

  await chrome.storage.local.remove(['exportProgress']);

  chrome.runtime.sendMessage({
    action: 'START_EXPORT',
    settings: { chats: selectedChats, dateFrom, dateTo, format, tabId: tab.id, safeMode }
  });

  setExportUI('running', false);
  document.getElementById('progressWrap').style.display = 'block';
  document.getElementById('progressBar').style.width = '0%';
  setStatus(
    safeMode
      ? `🛡️ Export ${selectedChats.length} chat dimulai (Safe Mode).`
      : `🚀 Export ${selectedChats.length} chat dimulai!`,
    'success'
  );

  startPolling();
});

// ============================================================
// PAUSE / RESUME
// ============================================================
document.getElementById('btnPause').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'PAUSE_RESUME' }, res => {
    const paused = res?.paused;
    document.getElementById('btnPause').innerHTML = paused ? '▶ Resume' : '⏸ Pause';
  });
});

// ============================================================
// CANCEL
// ============================================================
document.getElementById('btnCancel').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'CANCEL_EXPORT' });
  stopPolling();
  setExportUI('idle');
  setStatus('⛔ Export dibatalkan.', 'error');
});

// ============================================================
// POLLING PROGRESS
// ============================================================
function startPolling() {
  stopPolling();
  pollInterval = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'GET_STATUS' }, progress => {
      if (!progress) return;
      showProgress(progress);
      if (progress.status === 'done' || progress.status === 'error' || progress.status === 'cancelled') {
        stopPolling();
        setExportUI('idle');
      }
    });
  }, 700);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function showProgress(p) {
  if (!p) return;
  const pct = p.percent || 0;
  document.getElementById('progressWrap').style.display = 'block';
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressLeft').textContent  = p.subText || (p.downloadedFiles ? `📥 ${p.downloadedFiles} file` : '');
  document.getElementById('progressRight').textContent = p.total ? `${p.done||0}/${p.total}` : '';
  if (p.text) setStatus(p.text);
}

function setExportUI(state, paused = false) {
  const btnExport = document.getElementById('btnExportChat');
  const btnPause  = document.getElementById('btnPause');
  const btnCancel = document.getElementById('btnCancel');
  btnExport.style.display = state === 'idle'    ? 'flex' : 'none';
  btnPause.style.display  = state === 'running' ? 'flex' : 'none';
  btnCancel.style.display = state === 'running' ? 'flex' : 'none';
  if (state === 'running')
    btnPause.innerHTML = paused ? '▶ Resume' : '⏸ Pause';
}

// ============================================================
// MEMBER GRUP
// ============================================================
document.getElementById('btnExportMembers').addEventListener('click', async () => {
  setStatusMember('⏳ Mengambil member...');
  const tab = await getWATab(); if (!tab) return;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: scrapeMembersFromPage
    });
    const members = results?.[0]?.result || [];
    if (!members.length) {
      setStatusMember('❌ Buka Info Grup dulu (klik nama grup di atas).', 'error'); return;
    }
    document.getElementById('memberFormat').value === 'csv' ? dlMembersCSV(members) : dlVCard(members);
    setStatusMember(`✅ ${members.length} member berhasil di-export!`, 'success');
  } catch(e) { setStatusMember('❌ ' + e.message, 'error'); }
});

document.getElementById('btnExportAllGroups').addEventListener('click', async () => {
  setStatusMember('⏳ Memindai grup...');
  const tab = await getWATab(); if (!tab) return;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: scrapeGroupsFromPage
    });
    const groups = results?.[0]?.result || [];
    if (!groups.length) { setStatusMember('❌ Tidak ada grup.', 'error'); return; }
    dlGroupsCSV(groups);
    setStatusMember(`✅ ${groups.length} grup di-export!`, 'success');
  } catch(e) { setStatusMember('❌ ' + e.message, 'error'); }
});

function scrapeMembersFromPage() {
  const members=[], seen=new Set();
  const sels=['[data-testid="participant-name"]','div[role="listitem"] span[dir="auto"]','div[role="button"] span[dir="auto"]:first-child'];
  let els=[];
  for(const s of sels){const f=document.querySelectorAll(s);if(f.length){els=[...f];break;}}
  els.forEach(el=>{
    const name=el.textContent.trim();
    if(!name||name.length<2||name.length>80||seen.has(name))return;
    seen.add(name);
    const row=el.closest('div[role="button"]')||el.closest('div[role="listitem"]')||el.parentElement;
    const isAdmin=row?(row.innerText||'').toLowerCase().includes('admin'):false;
    let phone='';
    if(row)row.querySelectorAll('span').forEach(s=>{const t=s.textContent.trim();if(/^\+?\d[\d\s\-]{6,}/.test(t)&&t!==name)phone=t;});
    members.push({no:members.length+1,nama:name,nomor:phone,status:isAdmin?'Admin':'Member'});
  });
  return members;
}

function scrapeGroupsFromPage() {
  const groups=[];
  document.querySelectorAll('[data-testid="cell-frame-container"]').forEach(row=>{
    const nameEl=row.querySelector('span[title][dir="auto"], span[title]');
    if(!nameEl)return;
    const name=(nameEl.getAttribute('title')||nameEl.textContent||'').trim();
    if(!name||/^\+?\d[\d\s\-\(\)]{6,}$/.test(name.trim()))return;
    const previewText=row.innerText||'';
    if(!/\n[^:]{1,30}:/.test(previewText))return;
    groups.push({no:groups.length+1,nama_grup:name});
  });
  return groups;
}

function dlMembersCSV(members){
  let csv='\uFEFF'+'No,Nama,Nomor HP,Status\n';
  members.forEach(m=>{csv+=`${m.no},"${m.nama}","${m.nomor}","${m.status}"\n`;});
  dl(csv,'text/csv','wa-group-members.csv');
}
function dlGroupsCSV(groups){
  let csv='\uFEFF'+'No,Nama Grup\n';
  groups.forEach(g=>{csv+=`${g.no},"${g.nama_grup}"\n`;});
  dl(csv,'text/csv','wa-all-groups.csv');
}
function dlVCard(members){
  let vcf='';
  members.forEach(m=>{vcf+=`BEGIN:VCARD\nVERSION:3.0\nFN:${m.nama}\n${m.nomor?`TEL;TYPE=CELL:${m.nomor}\n`:''}NOTE:${m.status}\nEND:VCARD\n\n`;});
  dl(vcf,'text/vcard','wa-contacts.vcf');
}
function dl(content,type,filename){
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
}

async function getWATab() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.url?.includes('web.whatsapp.com')){
    const m='❌ Aktifkan tab WhatsApp Web dulu.';
    setStatus(m,'error');setStatusMember(m,'error');return null;
  }
  return tab;
}
function setStatus(msg,type=''){const el=document.getElementById('status');el.textContent=msg;el.className=type;}
function setStatusMember(msg,type=''){const el=document.getElementById('statusMember');el.textContent=msg;el.className=type;}
