// content-script.js — v13
// Injected into WhatsApp Web by manifest. Bridges popup/background ↔ inject scripts.

(function() {
  const P = '[CS]';

  // Use a dedicated console group to make logs visible
  console.log(P, 'content-script v13 loaded —', new Date().toISOString());

  let initRequestId = 0;
  let wppReady = false;
  const pendingRequests = new Map();

  // Listen for responses from injected init.js
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    const msg = event.data;

    if (msg.type === 'WA_EXPORTER_READY') {
      wppReady = true;
    }

    if (msg.type === 'WA_EXPORTER_RESPONSE') {
      const { id, result, error } = msg;
      const pending = pendingRequests.get(id);
      if (pending) {
        pendingRequests.delete(id);
        if (error) pending.reject(new Error(error));
        else pending.resolve(result);
      }
    }
  });

  // Listen for messages from background.js
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log(P, 'onMessage from BG:', msg.action);
    if (msg.action === 'WA_API_REQUEST') {
      console.log(P, '-> fwd to page:', msg.payload.action);
      sendToPage(msg.payload).then(r => { console.log(P, '<- page resp:', msg.payload.action, typeof r, Array.isArray(r)?r.length:''); sendResponse(r); }).catch(e => { console.error(P, '<- page err:', e.message); sendResponse({ error: e.message }); });
      return true; // keep channel open for async
    }

    if (msg.action === 'CHECK_WA_READY') {
      console.log(P, 'CHECK_WA_READY wppReady=', wppReady);
      checkReady().then(r => { console.log(P, 'checkReady:', r); sendResponse(r); });
      return true;
    }

    if (msg.action === 'PICK_FOLDER') {
      pickFolder().then(folder => sendResponse({ folder })).catch(e => sendResponse({ error: e.message }));
      return true;
    }

    if (msg.action === 'PROGRESS_UPDATE') {
      updateOverlay(msg.data);
      return false;
    }

    if (msg.action === 'EXPORT_TOAST') {
      showToast(msg.data.text, msg.data.isError, msg.data.isDone);
      return false;
    }
  });

  // Send request to injected page script and wait for response
  function sendToPage(payload) {
    return new Promise((resolve, reject) => {
      const id = ++initRequestId;
      pendingRequests.set(id, { resolve, reject });

      window.postMessage({
        type: 'WA_EXPORTER_REQUEST',
        id,
        action: payload.action,
        payload: payload.data
      }, '*');

      // Timeout after 60 seconds
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error('Request timed out'));
        }
      }, 60000);
    });
  }

  // Check if init.js has signaled ready
  function checkReady() {
    return new Promise((resolve) => {
      // Already initialized — resolve immediately
      if (wppReady) {
        resolve({ ready: true });
        return;
      }

      const handler = function(event) {
        if (event.source !== window) return;
        if (event.data.type === 'WA_EXPORTER_READY') {
          wppReady = true;
          window.removeEventListener('message', handler);
          resolve({ ready: true });
        }
        if (event.data.type === 'WA_EXPORTER_ERROR') {
          window.removeEventListener('message', handler);
          resolve({ ready: false, error: event.data.error });
        }
      };
      window.addEventListener('message', handler);

      // Inject the WPP library if not already present
      if (!document.getElementById('wppconnect-js')) {
        const script = document.createElement('script');
        script.id = 'wppconnect-js';
        script.src = chrome.runtime.getURL('inject/wppconnect.js');
        script.onload = () => {
          const initScript = document.createElement('script');
          initScript.src = chrome.runtime.getURL('inject/init.js');
          (document.head || document.documentElement).appendChild(initScript);
        };
        (document.head || document.documentElement).appendChild(script);
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ ready: false, error: 'Timed out waiting for WhatsApp to be ready' });
      }, 30000);
    });
  }

  // ============================================================
  // Progress Overlay (injected into WhatsApp Web page)
  // ============================================================
  let overlayEl = null;

  function getOverlay() {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'wa-exporter-overlay';
      overlayEl.innerHTML = `
        <div style="
          position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;
          background:#fff;color:#1a1a1a;
          border-radius:0 0 14px 14px;padding:14px 22px;min-width:370px;max-width:520px;
          box-shadow:0 4px 24px rgba(0,0,0,0.18);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
          border:1px solid #e0e3e0;border-top:none;text-align:center;transition:all .3s;
          display:none;
        ">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:13px;font-weight:600" id="woe-title">Exporting...</span>
            <span style="font-size:10px;color:#999" id="woe-extra"></span>
          </div>
          <div style="font-size:11px;color:#666;margin-bottom:8px" id="woe-sub"></div>
          <div style="background:#e8ece8;border-radius:5px;overflow:hidden;height:5px;margin-bottom:10px">
            <div id="woe-bar" style="height:100%;background:#0bbd00;width:0;transition:width .4s"></div>
          </div>
          <div style="display:flex;gap:8px;justify-content:center" id="woe-buttons">
            <button id="woe-btn-pause" style="padding:5px 16px;border:1px solid #d0d8e0;border-radius:6px;background:#f5f7fa;color:#5a7aaa;cursor:pointer;font-size:11px;font-weight:600;font-family:inherit">Pause</button>
            <button id="woe-btn-cancel" style="padding:5px 16px;border:1px solid #f0d0d0;border-radius:6px;background:#faf5f5;color:#c62828;cursor:pointer;font-size:11px;font-weight:600;font-family:inherit">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlayEl);

      // Wire up overlay buttons
      const btnPause = overlayEl.querySelector('#woe-btn-pause');
      const btnCancel = overlayEl.querySelector('#woe-btn-cancel');
      let overlayPaused = false;

      btnPause.addEventListener('click', () => {
        overlayPaused = !overlayPaused;
        btnPause.textContent = overlayPaused ? 'Resume' : 'Pause';
        btnPause.style.background = overlayPaused ? '#e8f5e0' : '#f5f7fa';
        btnPause.style.color = overlayPaused ? '#2e7d32' : '#5a7aaa';
        btnPause.style.borderColor = overlayPaused ? '#c8e0c0' : '#d0d8e0';
        chrome.runtime.sendMessage({ action: 'PAUSE_RESUME' }, (r) => {
          if (r) overlayPaused = r.paused;
        });
      });

      btnCancel.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'CANCEL_EXPORT' });
      });
    }
    return overlayEl;
  }

  function updateOverlay(data) {
    const el = getOverlay();
    const wrap = el.querySelector('div');
    if (!data || data.hide) {
      if (data && data.done) {
        // Show done state briefly then fade
        const title = el.querySelector('#woe-title');
        const sub = el.querySelector('#woe-sub');
        const bar = el.querySelector('#woe-bar');
        const extra = el.querySelector('#woe-extra');
        if (title) title.textContent = '\u2705 Export Complete';
        if (sub) sub.textContent = data.text || '';
        if (bar) bar.style.width = '100%';
        if (extra) extra.textContent = data.files ? data.files + ' files' : '';
        const btns = el.querySelector('#woe-buttons');
        if (btns) btns.style.display = 'none';
        wrap.style.display = '';
        setTimeout(() => { wrap.style.display = 'none'; }, 5000);
      } else {
        wrap.style.display = 'none';
      }
      return;
    }

    wrap.style.display = '';
    const title = el.querySelector('#woe-title');
    const sub = el.querySelector('#woe-sub');
    const bar = el.querySelector('#woe-bar');
    const extra = el.querySelector('#woe-extra');
    const btns = el.querySelector('#woe-buttons');
    if (btns) btns.style.display = '';

    if (data.paused) {
      if (title) title.textContent = '\u23F8 Paused \u2014 Safe Mode';
      if (sub) sub.textContent = data.text || 'Pausing to avoid detection...';
      if (extra) extra.textContent = '';
      const pauseBtn = el.querySelector('#woe-btn-pause');
      if (pauseBtn) {
        pauseBtn.textContent = 'Resume';
        pauseBtn.style.background = '#e8f5e0';
        pauseBtn.style.color = '#2e7d32';
        pauseBtn.style.borderColor = '#c8e0c0';
      }
    } else {
      if (title) title.textContent = data.text || 'Exporting...';
      if (sub) sub.textContent = data.subText || '';
      if (bar) bar.style.width = (data.percent || 0) + '%';
      if (extra) extra.textContent = data.extra || '';
    }
  }

  // ============================================================
  // Toast (also on WhatsApp page)
  // ============================================================
  function showToast(text, isError, isDone) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed;bottom:40px;left:50%;transform:translateX(-50%);z-index:99999;
      background:${isError ? '#3d1a1a' : isDone ? '#1a3a2a' : '#1a2d3a'};
      color:${isError ? '#e57373' : isDone ? '#66bb6a' : '#64b5f6'};
      padding:10px 22px;border-radius:10px;font-size:12.5px;font-family:'DM Sans',sans-serif;
      box-shadow:0 4px 16px rgba(0,0,0,0.4);border:1px solid ${isError ? '#5a2a2a' : isDone ? '#1e4d2a' : '#1e3a4a'};
      transition:opacity .4s;opacity:0;
    `;
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
    }, isError ? 6000 : 4000);
  }

  // ============================================================
  // Folder picker (File System Access API)
  // ============================================================
  async function pickFolder() {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      return handle.name;
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }
})();
