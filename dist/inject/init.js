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
    const result = [];
    for (const chat of chats) {
      const id = chat.id._serialized || chat.id.toString();
      const isGroup = chat.id.isGroup ? chat.id.isGroup() : false;
      let phone = null;
      let participants = null;

      if (isGroup) {
        // Get group participants with phone numbers
        try {
          // Try WPP.group.getParticipants first
          let rawParticipants = [];
          try {
            rawParticipants = await WPP.group.getParticipants(id);
            log('Got participants via WPP.group for', chat.name);
          } catch (e1) {
            // Fallback: try groupMetadata
            if (chat.groupMetadata && chat.groupMetadata.participants) {
              rawParticipants = chat.groupMetadata.participants;
              log('Got participants via groupMetadata for', chat.name);
            }
          }

          participants = [];
          for (const p of rawParticipants) {
            const jid = (p.id && p.id._serialized) ? p.id._serialized : (p.id || '').toString();
            // Extract phone: everything before the first @ (handles @c.us, @lid, @s.whatsapp.net, etc.)
            const parts = jid.split('@');
            const pPhone = parts[0] || '';
            if (pPhone && /^\d+$/.test(pPhone)) {
              participants.push({
                id: jid,
                phone: pPhone,
                name: p.pushname || p.name || p.formattedName || pPhone
              });
            }
          }
          log('Group', chat.name, ':', participants.length, 'participants extracted');
        } catch (e) {
          log('Failed to get participants for', chat.name, ':', e.message);
          participants = [];
        }
      } else {
        // Individual chat — extract phone from JID (e.g., 6281234567890@c.us → 6281234567890)
        // Works for both @c.us (JID) and @lid (LID) formats
        const parts = id.split('@');
        const rawPhone = parts[0] || '';
        if (rawPhone && /^\d+$/.test(rawPhone)) {
          phone = rawPhone;
        }
        // If extraction failed, try contact API
        if (!phone) {
          try {
            const contact = await WPP.contact.get(id);
            if (contact) {
              phone = contact.phone || contact.id || (contact.id && contact.id.user) || null;
              if (phone && typeof phone === 'object') phone = phone._serialized || phone.user || phone.toString();
              if (phone) phone = String(phone).split('@')[0];
              if (phone && !/^\d+$/.test(phone)) phone = null;
            }
          } catch (e) {
            log('Contact lookup failed for', chat.name, ':', e.message);
          }
        }
        log('Individual chat', chat.name, 'phone:', phone);
      }

      result.push({
        id,
        name: chat.name || chat.formattedTitle || 'Unknown',
        isGroup,
        t: chat.t || 0,
        phone,
        participants
      });
    }
    return result.sort((a, b) => (b.t || 0) - (a.t || 0));
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
      .map(msg => {
        // Build mention map: JID → phone number for this message
        const mentionMap = {};
        const mentionedJidList = msg.mentionedJidList || msg.mentionedIds || [];
        for (const jid of mentionedJidList) {
          const jidStr = (jid && jid._serialized) ? jid._serialized : String(jid || '');
          const phone = jidStr.split('@')[0];
          if (phone && /^\d+$/.test(phone)) {
            mentionMap[jidStr] = phone;
            mentionMap[phone] = phone; // also map phone→phone for body replacement
          }
        }
        return {
          id: msg.id ? msg.id.toString() : '',
          timestamp: msg.t || msg.timestamp,
          sender: msg.senderObj
            ? (msg.senderObj.pushname || msg.senderObj.formattedName || msg.sender)
            : (msg.author || msg.sender || ''),
          body: formatBody(msg, mentionMap),
          type: msg.type
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  // ============================================================
  // Format message body — human-readable for media types
  // Resolves @mentions to phone numbers
  // ============================================================
  function formatBody(msg, mentionMap) {
    const caption = msg.caption || '';
    const t = msg.type || '';
    mentionMap = mentionMap || {};

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

    let body = '';
    if (label && caption) body = label + ' ' + caption;
    else if (label) body = label;
    else if (caption) body = caption;
    else body = msg.body || '';

    // Resolve @mentions: strip ANY @domain suffix, leaving clean @phonenumber
    // Handles: @628xxx@c.us, @628xxx@s.whatsapp.net, @xxx@lid, @xxx@anything
    body = body.replace(/@(\d+)@[\w.]+/g, '@$1');

    return body;

    return body;
  }

})();
