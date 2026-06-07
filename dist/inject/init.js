// inject/init.js — v13
// Bridge between the WPP API (injected via wppconnect.js) and content-script.js
// Runs in the WhatsApp Web page context

(async function() {
  const DBG = true;
  function log(...a) { if(DBG) console.log('[INIT]',...a); }
  function err(...a) { if(DBG) console.error('[INIT]',...a); }

  log('init.js loaded, checking WPP...');

  // Wait for WPP to be available (injected by content-script before this file)
  if (!window.WPP) {
    err('WPP library not loaded!');
    window.postMessage({ type: 'WA_EXPORTER_ERROR', error: 'WPP library not loaded' }, '*');
    return;
  }
  log('WPP found, waiting for main ready...');

  // Poll WPP.conn.isMainReady() every 500ms, 30s timeout
  const deadline = Date.now() + 30000;
  while (!WPP.conn.isMainReady()) {
    if (Date.now() > deadline) {
      err('Timeout waiting for main ready');
      window.postMessage({ type: 'WA_EXPORTER_ERROR', error: 'WhatsApp not ready after 30s' }, '*');
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  log('WPP main ready! Signaling READY');
  // Signal ready
  window.postMessage({ type: 'WA_EXPORTER_READY' }, '*');

  // Listen for requests from content-script
  window.addEventListener('message', async function(event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (msg.type !== 'WA_EXPORTER_REQUEST') return;

    const { id, action, payload } = msg;
    log('request #' + id + ':', action, payload);

    try {
      let result;

      switch (action) {
        case 'GET_CHATS':
          result = await getChats();
          log('GET_CHATS done:', result.length, 'chats');
          break;
        case 'GET_MESSAGES':
          result = await getMessages(payload.chatId, payload.from, payload.to);
          log('GET_MESSAGES done:', result.length, 'msgs for', payload.chatId);
          break;
        case 'CHECK_READY':
          result = { ready: true };
          break;
        default:
          throw new Error('Unknown action: ' + action);
      }

      window.postMessage({
        type: 'WA_EXPORTER_RESPONSE',
        id,
        result
      }, '*');

    } catch (e) {
      err('request #' + id + ' failed:', e.message);
      window.postMessage({
        type: 'WA_EXPORTER_RESPONSE',
        id,
        error: e.message
      }, '*');
    }
  });

  // ============================================================
  // Get all chats — sorted by last message (newest first)
  // ============================================================
  async function getChats() {
    const chats = await WPP.chat.list({ count: -1 });
    return chats
      .map(chat => ({
        id: chat.id._serialized || chat.id.toString(),
        name: chat.name || chat.formattedTitle || 'Unknown',
        isGroup: chat.id.isGroup ? chat.id.isGroup() : false,
        t: chat.t || 0
      }))
      .sort((a, b) => (b.t || 0) - (a.t || 0));
  }

  // ============================================================
  // Get messages from a chat within date range
  // ============================================================
  async function getMessages(chatId, dateFrom, dateTo) {
    const fromMs = new Date(dateFrom).getTime() / 1000;
    const toMs = new Date(dateTo + 'T23:59:59').getTime() / 1000;

    // Get all messages (the library reads from IndexedDB)
    const allMessages = await WPP.chat.getMessages(chatId, { count: -1 });

    return allMessages
      .filter(msg => {
        const ts = msg.t || msg.timestamp;
        return ts && ts >= fromMs && ts <= toMs;
      })
      .map(msg => ({
        id: msg.id ? msg.id.toString() : '',
        timestamp: msg.t || msg.timestamp,
        sender: msg.senderObj
          ? (msg.senderObj.pushname || msg.senderObj.formattedName || msg.sender)
          : (msg.author || msg.sender || ''),
        body: formatBody(msg),
        type: msg.type
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // ============================================================
  // Format message body — human-readable for media types
  // ============================================================
  function formatBody(msg) {
    const caption = msg.caption || '';
    const t = msg.type || '';

    const mediaLabels = {
      'image':            '[Image]',
      'video':            '[Video]',
      'sticker':          '[Sticker]',
      'ptt':              '[Voice Message]',
      'audio':            '[Audio]',
      'document':         '[Document' + (msg.filename ? ' - ' + msg.filename : '') + ']',
      'location':         '[Location]',
      'vcard':            '[Contact]',
      'multi_vcard':      '[Contacts]',
      'poll_creation':    '[Poll]',
      'event_creation':   '[Event]',
      'call_log':         '[Call]',
      'revoked':          '[Message deleted]',
      'gp2':              '[Group action]',
      'notification':     '[Notification]',
      'ephemeral':        '[Disappearing message]',
      'ciphertext':       '[Encrypted message]',
      'order':            '[Order]',
      'product':          '[Product]',
      'catalog':          '[Catalog]',
      'list':             '[List]',
      'list_response':    '[List response]',
      'buttons_response': '[Button response]',
      'payment':          '[Payment]',
      'reaction':         '[Reaction]',
      'hsm':              '[Template message]',
      'protocol':         msg.subtype === 'message_edit' ? '[Edited message]' : '[System message]'
    };

    const label = mediaLabels[t] || null;

    if (label && caption) return label + ' ' + caption;
    if (label) return label;
    if (caption) return caption;
    return msg.body || '';
  }

})();
