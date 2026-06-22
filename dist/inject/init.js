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
  // Helper: extract phone number from a contact-like object or chat ID
  // Priority: id.user (often has real phone even with LID), then _serialized split, then string
  // ============================================================
  function extractPhone(obj) {
    if (!obj) return null;
    // If obj has an 'id' property, use that
    const idObj = obj.id || obj;
    // PRIORITY 1: id.user — often the real phone number even when LID is used
    if (idObj.user) {
      const u = String(idObj.user);
      if (/^\d+$/.test(u)) return u;
    }
    // PRIORITY 2: id._serialized split on @ (handles "628xxx@c.us" and "123xxx@lid")
    if (idObj._serialized) {
      const parts = String(idObj._serialized).split('@');
      if (parts[0] && /^\d+$/.test(parts[0])) return parts[0];
    }
    // PRIORITY 3: raw string split on @
    if (typeof obj === 'string') {
      const parts = obj.split('@');
      if (parts[0] && /^\d+$/.test(parts[0])) return parts[0];
    }
    // PRIORITY 4: obj.phone field
    if (obj.phone) {
      const p = String(obj.phone).split('@')[0];
      if (/^\d+$/.test(p)) return p;
    }
    // PRIORITY 5: toString() if it looks like a JID/LID
    if (obj.toString && typeof obj.toString === 'function') {
      const s = obj.toString();
      const parts = s.split('@');
      if (parts[0] && /^\d+$/.test(parts[0])) return parts[0];
    }
    return null;
  }

  // ============================================================
  // Helper: get display name — NEVER fall back to phone/LID number
  // ============================================================
  function extractName(obj) {
    if (!obj) return 'Unknown';
    if (obj.pushname && obj.pushname !== 'Unknown') return obj.pushname;
    if (obj.name && obj.name !== 'Unknown') return obj.name;
    if (obj.formattedName && obj.formattedName !== 'Unknown') return obj.formattedName;
    if (obj.shortName && obj.shortName !== 'Unknown') return obj.shortName;
    // Check if obj is a string that looks like a name (not just digits)
    if (typeof obj === 'string' && !/^[\d\s@.:+-]+$/.test(obj) && obj.length > 0) return obj;
    return 'Unknown';
  }

  // ============================================================
  // Get all chats — sorted by last message (newest first)
  // ============================================================
  async function getChats() {
    const chats = await WPP.chat.list({ count: -1 });
    log('Total chats from WPP:', chats.length);
    // Dump first chat structure for debugging
    if (chats.length > 0) {
      const c0 = chats[0];
      err('DEBUG first chat keys:', Object.keys(c0).join(','));
      err('DEBUG first chat name:', c0.name || c0.formattedTitle);
      err('DEBUG first chat id keys:', Object.keys(c0.id || {}).join(','));
      err('DEBUG first chat id._serialized:', c0.id && c0.id._serialized);
      err('DEBUG first chat id.user:', c0.id && c0.id.user);
      err('DEBUG first chat id.server:', c0.id && c0.id.server);
      if (c0.contact) {
        err('DEBUG first chat contact keys:', Object.keys(c0.contact).join(','));
        err('DEBUG first chat contact id._serialized:', c0.contact.id && c0.contact.id._serialized);
        err('DEBUG first chat contact id.user:', c0.contact.id && c0.contact.id.user);
      }
      if (c0.groupMetadata) {
        err('DEBUG first chat groupMetadata keys:', Object.keys(c0.groupMetadata).join(','));
        if (c0.groupMetadata.participants && c0.groupMetadata.participants.length) {
          const p0 = c0.groupMetadata.participants[0];
          err('DEBUG first participant keys:', Object.keys(p0).join(','));
          err('DEBUG first participant id keys:', Object.keys(p0.id || {}).join(','));
          err('DEBUG first participant id._serialized:', p0.id && p0.id._serialized);
          err('DEBUG first participant id.user:', p0.id && p0.id.user);
        }
      }
    }
    const result = [];
    for (const chat of chats) {
      const id = chat.id._serialized || chat.id.toString();
      const isGroup = chat.id.isGroup ? chat.id.isGroup() : false;
      let phone = null;
      let participants = null;

      if (isGroup) {
        // ---- GROUP CHAT ----
        log('Processing GROUP:', chat.name || id, 'id:', id);
        try {
          let rawParticipants = [];

          // Strategy 1: WPP.group.getParticipants
          try {
            const gp = await WPP.group.getParticipants(id);
            if (Array.isArray(gp) && gp.length) {
              rawParticipants = gp;
              log('  Got', gp.length, 'participants via WPP.group.getParticipants');
            }
          } catch (e1) {
            log('  WPP.group.getParticipants failed:', e1.message);
          }

          // Strategy 2: chat.groupMetadata.participants
          if (!rawParticipants.length && chat.groupMetadata && chat.groupMetadata.participants) {
            rawParticipants = chat.groupMetadata.participants;
            log('  Got', rawParticipants.length, 'participants via groupMetadata');
          }

          // Strategy 3: WPP.group.getMembers
          if (!rawParticipants.length) {
            try {
              const gm = await WPP.group.getMembers(id);
              if (Array.isArray(gm) && gm.length) {
                rawParticipants = gm;
                log('  Got', gm.length, 'participants via WPP.group.getMembers');
              }
            } catch (e2) {
              log('  WPP.group.getMembers failed:', e2.message);
            }
          }

          // Strategy 4: try WPP.group.getGroupInfo
          if (!rawParticipants.length) {
            try {
              const gi = await WPP.group.getGroupInfo(id);
              if (gi && gi.participants && gi.participants.length) {
                rawParticipants = gi.participants;
                log('  Got', gi.participants.length, 'participants via getGroupInfo');
              }
            } catch (e3) {
              log('  WPP.group.getGroupInfo failed:', e3.message);
            }
          }

          // Process each participant
          participants = [];
          for (const p of rawParticipants) {
            const pJid = (p.id && p.id._serialized) ? p.id._serialized : String(p.id || '');
            let pPhone = extractPhone(p);
            let pName = extractName(p);

            // If no phone from participant object, try contact lookup
            if (!pPhone) {
              try {
                const contact = await WPP.contact.get(pJid);
                if (contact) {
                  pPhone = extractPhone(contact);
                  pName = extractName(contact) || pName;
                }
              } catch (e) {
                log('    Contact lookup failed for participant:', pJid);
              }
            }

            if (pPhone && /^\d+$/.test(pPhone)) {
              participants.push({ id: pJid, phone: pPhone, name: pName });
            } else {
              log('    Skipping participant (no valid phone):', pJid);
            }
          }
          log('  Final participants count:', participants.length);
        } catch (e) {
          err('  Group processing failed:', chat.name, e.message);
          participants = [];
        }
      } else {
        // ---- INDIVIDUAL CHAT ----
        log('Processing INDIVIDUAL:', chat.name || id, 'id._serialized:', id);

        // Strategy 1: extract from chat.id.user (often has real phone even with LID)
        phone = extractPhone(chat.id);
        if (phone) log('  Phone from chat.id:', phone);

        // Strategy 2: Try chat.contact property
        if (!phone && chat.contact) {
          phone = extractPhone(chat.contact);
          if (phone) log('  Phone from chat.contact:', phone);
        }

        // Strategy 3: Try WPP.contact.get with original id
        if (!phone) {
          try {
            const contact = await WPP.contact.get(id);
            if (contact) {
              phone = extractPhone(contact);
              if (phone) log('  Phone from WPP.contact.get(id):', phone);
              else {
                err('  WPP.contact.get returned, keys:', Object.keys(contact).join(','));
                if (contact.id) err('    contact.id keys:', Object.keys(contact.id).join(','), 'user:', contact.id.user, 'serialized:', contact.id._serialized);
              }
            }
          } catch (e) {
            log('  WPP.contact.get(id) failed:', e.message);
          }
        }

        // Strategy 4: try @c.us alias (old JID format might still work)
        if (!phone && id.includes('@')) {
          try {
            const userPart = extractPhone(chat.id);
            if (userPart) {
              const cusId = userPart + '@c.us';
              log('  Trying @c.us alias:', cusId);
              const contact = await WPP.contact.get(cusId);
              if (contact) {
                phone = extractPhone(contact);
                if (phone) log('  Phone from @c.us alias:', phone);
              }
            }
          } catch (e) {
            log('  @c.us alias failed:', e.message);
          }
        }

        // Strategy 4: fallback string extraction
        if (!phone) {
          phone = extractPhone(id);
          if (phone) log('  Phone from string fallback:', phone);
        }

        if (!phone) {
          err('  NO phone found for:', chat.name, '| id keys:', Object.keys(chat.id || {}).join(','), '| serialized:', id);
        }
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
        // Build mention map: mentioned ID → phone number
        const mentionedJidList = msg.mentionedJidList || msg.mentionedIds || [];
        const mentionMap = {};
        for (const jid of mentionedJidList) {
          const jidStr = (jid && jid._serialized) ? jid._serialized : String(jid || '');
          const phone = extractPhone(jidStr);
          if (phone) {
            mentionMap[jidStr] = phone;
            const numPart = jidStr.split('@')[0];
            if (numPart) mentionMap[numPart] = phone;
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
  // Resolves @mentions to phone numbers using mentionMap
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

    // Step 1: Strip domain suffixes (@phone@c.us → @phone, @LID@lid → @LID)
    body = body.replace(/@(\d+)@[\w.]+/g, '@$1');

    // Step 2: Replace LID mentions with phone numbers from mentionMap
    if (Object.keys(mentionMap).length > 0) {
      body = body.replace(/@(\d+)/g, function(match, num) {
        if (mentionMap[num] && mentionMap[num] !== num) {
          return '@' + mentionMap[num];
        }
        return match;
      });
    }

    return body;
  }

})();
