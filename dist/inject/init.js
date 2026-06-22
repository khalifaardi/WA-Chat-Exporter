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

  // Helper: check if a name looks like a phone number (e.g. "+62 822-9940-1163" → "6282299401163")
  function phoneFromName(name) {
    if (!name) return null;
    const digits = name.replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 16) return digits;
    return null;
  }

  // ============================================================
  // Helper: get display name — NEVER fall back to phone/LID number
  // ============================================================
  function extractName(obj) {
    if (!obj) return 'Unknown';
    // WPP often uses __x_ prefixed properties
    if (obj.pushname && obj.pushname !== 'Unknown') return obj.pushname;
    if (obj.__x_pushname && obj.__x_pushname !== 'Unknown') return obj.__x_pushname;
    if (obj.name && obj.name !== 'Unknown') return obj.name;
    if (obj.__x_name && obj.__x_name !== 'Unknown') return obj.__x_name;
    if (obj.formattedName && obj.formattedName !== 'Unknown') return obj.formattedName;
    if (obj.__x_formattedTitle && obj.__x_formattedTitle !== 'Unknown') return obj.__x_formattedTitle;
    if (obj.shortName && obj.shortName !== 'Unknown') return obj.shortName;
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
      err('DEBUG first chat id._serialized:', c0.id && c0.id._serialized);
      err('DEBUG first chat id.user:', c0.id && c0.id.user);
      err('DEBUG first chat id.server:', c0.id && c0.id.server);
      err('DEBUG isGroup:', c0.id && c0.id.isGroup && c0.id.isGroup());
      // Also dump an individual chat if possible
      const indiv = chats.find(c => c.id && c.id.isGroup && !c.id.isGroup());
      if (indiv) {
        err('DEBUG INDIVIDUAL chat name:', indiv.name || indiv.formattedTitle);
        err('DEBUG INDIVIDUAL id._serialized:', indiv.id && indiv.id._serialized);
        err('DEBUG INDIVIDUAL id.user:', indiv.id && indiv.id.user);
        err('DEBUG INDIVIDUAL id.server:', indiv.id && indiv.id.server);
        // Dump ALL contact properties
        if (indiv.contact) {
          const cKeys = Object.getOwnPropertyNames(indiv.contact);
          err('DEBUG contact own property names:', cKeys.join(','));
          for (const k of cKeys) {
            try {
              const v = indiv.contact[k];
              if (typeof v === 'string' || typeof v === 'number') {
                err('  contact.' + k + ':', v);
              }
            } catch(e) {}
          }
        }
        // Try raw __x_contact
        if (indiv.__x_contact) {
          err('DEBUG __x_contact exists, keys:', Object.getOwnPropertyNames(indiv.__x_contact).join(','));
        }
      }
      // Safe participant check
      if (c0.groupMetadata) {
        try {
          const plist = Array.from(c0.groupMetadata.participants || []);
          err('DEBUG group participant count:', plist.length);
          if (plist.length > 0) {
            const p0 = plist[0];
            if (p0 && typeof p0 === 'object') {
              try { err('DEBUG participant keys:', Object.keys(p0).join(',')); } catch(e){}
              if (p0.id) err('DEBUG participant id._serialized:', p0.id._serialized, 'user:', p0.id.user);
              // Dump participant contact if available
              if (p0.contact) {
                err('DEBUG participant has contact object');
                const pcKeys = Object.getOwnPropertyNames(p0.contact);
                for (const k of pcKeys) {
                  try {
                    const v = p0.contact[k];
                    if (typeof v === 'string' || typeof v === 'number') err('  participant.contact.' + k + ':', v);
                  } catch(e) {}
                }
              }
            }
          }
        } catch(e) { err('DEBUG participant read failed:', e.message); }
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
        log('Processing GROUP:', chat.name || id);
        try {
          let rawParticipants = [];

          // Strategy 1: WPP.group.getParticipants
          try {
            const gp = await WPP.group.getParticipants(id);
            rawParticipants = Array.from(gp || []);
            if (rawParticipants.length) log('  Got', rawParticipants.length, 'via WPP.group.getParticipants');
          } catch (e1) {
            log('  WPP.group.getParticipants failed:', e1.message);
          }

          // Strategy 2: chat.groupMetadata.participants (use Array.from for WPP collections)
          if (!rawParticipants.length && chat.groupMetadata && chat.groupMetadata.participants) {
            try {
              rawParticipants = Array.from(chat.groupMetadata.participants);
              if (rawParticipants.length) log('  Got', rawParticipants.length, 'via groupMetadata');
            } catch(e) {
              log('  groupMetadata.participants Array.from failed:', e.message);
            }
          }

          // Strategy 3: WPP.group.getMembers
          if (!rawParticipants.length) {
            try {
              const gm = await WPP.group.getMembers(id);
              rawParticipants = Array.from(gm || []);
              if (rawParticipants.length) log('  Got', rawParticipants.length, 'via WPP.group.getMembers');
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
            let pPhone = extractPhone(p) || phoneFromName(p.name) || phoneFromName(p.pushname) || phoneFromName(p.__x_name) || phoneFromName(p.__x_pushname);
            // Try __x_phoneNumber on participant
            if (!pPhone && p.__x_phoneNumber) {
              pPhone = extractPhone(p.__x_phoneNumber) || phoneFromName(String(p.__x_phoneNumber));
            }
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
        log('Processing INDIVIDUAL:', chat.name || id);

        // Strategy 1: Check if the name itself IS a phone number (unsaved contacts)
        phone = phoneFromName(chat.name) || phoneFromName(chat.formattedTitle);
        if (phone) log('  Phone from name:', phone);

        // Strategy 2: extract from chat.id
        if (!phone) {
          phone = extractPhone(chat.id);
          if (phone) log('  Phone from chat.id:', phone);
        }

        // Strategy 3: Try chat.contact
        if (!phone && chat.contact) {
          phone = extractPhone(chat.contact);
          if (phone) log('  Phone from chat.contact:', phone);
        }

        // Strategy 4: Try __x_contact.__x_phoneNumber (internal phone field!)
        if (!phone && chat.__x_contact && chat.__x_contact.__x_phoneNumber) {
          const raw = chat.__x_contact.__x_phoneNumber;
          err('DEBUG __x_phoneNumber type:', typeof raw, 'value:', raw);
          if (typeof raw === 'string' && /^\d+$/.test(raw)) phone = raw;
          else if (raw && typeof raw === 'object') {
            // might be a Wid object
            phone = extractPhone(raw) || phoneFromName(raw._serialized || raw.user || String(raw));
          } else if (typeof raw === 'number') {
            phone = String(raw);
          }
          if (phone) log('  Phone from __x_phoneNumber:', phone);
        }

        // Strategy 5: Try contact.__x_phoneNumber via getOwnPropertyDescriptor
        if (!phone && chat.contact) {
          try {
            const desc = Object.getOwnPropertyDescriptor(chat.contact, '__x_phoneNumber');
            if (desc && desc.value) {
              phone = extractPhone(desc.value) || phoneFromName(String(desc.value));
              if (phone) log('  Phone from descriptor:', phone);
            }
          } catch(e) {}
        }

        if (!phone) {
          err('  NO phone found for:', chat.name);
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
