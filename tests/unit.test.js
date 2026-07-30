// tests/unit.test.js — Pure-function unit tests for WA Chat Exporter
// Run: node tests/unit.test.js
// These test the core business logic independently of Chrome APIs.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS', name);
  } catch (e) {
    failed++;
    console.log('  FAIL', name);
    console.log('       ', e.message);
  }
}

// ============================================================
// Replicated pure functions from the codebase
// ============================================================

// From background.js
function sanitize(n) {
  return (n || 'chat').replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '_')
    .substring(0, 80) || 'chat';
}

function toBase64(str) {
  const b = new TextEncoder().encode(str);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function genCSV(msgs, chat) {
  let meta = '# Chat: ' + ((chat && chat.name) || 'Unknown');
  if (chat && chat.id && !chat.isGroup && chat.phone) {
    meta += ' (' + chat.phone + ')';
  }
  let csv = '\uFEFF' + meta + '\n';
  if (chat && chat.isGroup && chat.participants && chat.participants.length > 0) {
    csv += '# Participants: ' + chat.participants.map(p => p.name + ' (' + p.phone + ')').join(', ') + '\n';
  }
  csv += 'Time,Sender,Message\n';
  for (const m of msgs) {
    const d = new Date(m.timestamp * 1000);
    const ds = String(d.getDate()).padStart(2,'0') + '/' +
      String(d.getMonth()+1).padStart(2,'0') + '/' +
      String(d.getFullYear()).slice(-2) + ' ' +
      String(d.getHours()).padStart(2,'0') + ':' +
      String(d.getMinutes()).padStart(2,'0');
    csv += ds + ',"' + (m.sender || '').replace(/"/g, '""') + '","' + (m.body || '').replace(/"/g, '""') + '"\n';
  }
  return csv;
}

function genTXT(msgs, chat) {
  let header = '# Chat: ' + ((chat && chat.name) || 'Unknown');
  if (chat && chat.id && !chat.isGroup && chat.phone) {
    header += ' (' + chat.phone + ')';
  } else if (chat && chat.isGroup && chat.participants && chat.participants.length > 0) {
    header += ' | ' + chat.participants.map(p => p.name + ' (' + p.phone + ')').join(' ');
  }
  let txt = header + '\n';
  let last = '';
  for (const m of msgs) {
    const d = new Date(m.timestamp * 1000);
    const ds = String(d.getDate()).padStart(2, '0') + '/' +
      String(d.getMonth() + 1).padStart(2, '0') + '/' +
      String(d.getFullYear()).slice(-2);
    const ts = String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0');
    if (ds !== last) { txt += '\n[' + ds + ']\n'; last = ds; }
    txt += '[' + ts + '] ' + (m.sender || '?') + ': ' + (m.body || '') + '\n';
  }
  return txt.trim();
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// From inject/init.js — formatBody for media types + mention resolution
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

// ============================================================
// Message filtering helper (from init.js getMessages)
// ============================================================
function filterMessagesByDate(messages, dateFrom, dateTo) {
  const fromMs = new Date(dateFrom).getTime() / 1000;
  const toMs = new Date(dateTo + 'T23:59:59').getTime() / 1000;
  return messages.filter(msg => {
    const ts = msg.t || msg.timestamp;
    return ts && ts >= fromMs && ts <= toMs;
  });
}

// ============================================================
// Chat sorting by last message timestamp (from init.js getChats)
// ============================================================
function sortChatsByLastMsg(chats) {
  return [...chats].sort((a, b) => (b.t || 0) - (a.t || 0));
}

// ============================================================
// PRE-FLIGHT: Syntax check on ALL source files
// ============================================================
console.log('\n=== PRE-FLIGHT SYNTAX CHECK ===');
const sourceFiles = [
  'manifest.json',
  'background.js',
  'content-script.js',
  'popup.js',
  'inject/init.js',
  '_locales/en/messages.json',
  '_locales/id/messages.json',
];
for (const f of sourceFiles) {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) {
    console.log('  FAIL', f, '— FILE MISSING');
    failed++;
    continue;
  }
  const src = fs.readFileSync(fp, 'utf8');
  if (f.endsWith('.json')) {
    try { JSON.parse(src); console.log('  PASS', f); passed++; }
    catch (e) { console.log('  FAIL', f, '—', e.message); failed++; }
  } else if (f.endsWith('.js')) {
    try { new Function(src); console.log('  PASS', f); passed++; }
    catch (e) { console.log('  FAIL', f, '—', e.message); failed++; }
  }
}

if (failed > 0) {
  console.log('\nSYNTAX ERRORS DETECTED — aborting further tests');
  process.exit(1);
}

// ============================================================
// TESTS — sanitize()
// ============================================================
console.log('\n=== sanitize() ===');

test('normal chat name', () => {
  assert.strictEqual(sanitize('My Chat'), 'My_Chat');
});

test('spaces collapse to underscores', () => {
  const result = sanitize('Team  Rocket  Chat');
  // \s+ collapses consecutive spaces into single _
  assert.strictEqual(result, 'Team_Rocket_Chat');
});

test('special chars replaced with underscores', () => {
  const result = sanitize('Chat: "Hello" / World?');
  assert.ok(!result.includes(':'), 'colon removed');
  assert.ok(!result.includes('"'), 'quotes removed');
  assert.ok(!result.includes('/'), 'slash removed');
  assert.ok(!result.includes('?'), 'question removed');
  assert.ok(result.includes('Hello'), 'Hello preserved');
  assert.ok(result.includes('World'), 'World preserved');
});

test('backslash and pipe removed', () => {
  assert.strictEqual(sanitize('A\\B|C'), 'ABC');
});

test('truncates to 80 chars', () => {
  const long = 'A'.repeat(100);
  assert.strictEqual(sanitize(long).length, 80);
});

test('empty name defaults to "chat"', () => {
  assert.strictEqual(sanitize(''), 'chat');
});

test('null name defaults to "chat"', () => {
  assert.strictEqual(sanitize(null), 'chat');
});

test('unicode emoji preserved', () => {
  const result = sanitize('Team 🚀');
  assert.ok(result.includes('Team'));
  assert.ok(!result.includes('/'));
});

// ============================================================
// TESTS — toBase64()
// ============================================================
console.log('\n=== toBase64() ===');

test('simple string', () => {
  assert.strictEqual(toBase64('hello'), 'aGVsbG8=');
});

test('empty string', () => {
  assert.strictEqual(toBase64(''), '');
});

test('unicode (BOM for CSV)', () => {
  const result = toBase64('\uFEFFHello');
  assert.ok(result.length > 0);
});

// ============================================================
// TESTS — genCSV()
// ============================================================
console.log('\n=== genCSV() ===');

test('single message', () => {
  const msgs = [{ timestamp: 1700000000, sender: 'Alice', body: 'Hello world' }];
  const csv = genCSV(msgs);
  assert.ok(csv.startsWith('\uFEFF'), 'has BOM');
  assert.ok(csv.includes('Alice'), 'has sender');
  assert.ok(csv.includes('Hello world'), 'has body');
  assert.ok(csv.includes('/11'), 'has date in DD/MM format');
});

test('empty messages produces header only', () => {
  const csv = genCSV([]);
  assert.ok(csv.includes('\uFEFF'), 'has BOM');
  assert.ok(csv.includes('Time,Sender,Message'), 'has column headers');
});

test('escapes double quotes in text', () => {
  const msgs = [{ timestamp: 1700000000, sender: 'A "Bot"', body: 'He said "hi"' }];
  const csv = genCSV(msgs);
  assert.ok(csv.includes('A ""Bot""'), 'sender quotes escaped');
  assert.ok(csv.includes('He said ""hi""'), 'body quotes escaped');
});

test('messages appear in given order (no internal sort)', () => {
  // genCSV does NOT sort — sorting is done upstream in inject/init.js
  const msgs = [
    { timestamp: 1700000001, sender: 'Alice', body: 'First' },
    { timestamp: 1700000002, sender: 'Bob', body: 'Later' },
  ];
  const csv = genCSV(msgs);
  const lines = csv.split('\n');
  // Line 0: BOM+header, Line 1: column names, Line 2+: data
  assert.ok(lines[2].includes('Alice') && lines[3].includes('Bob'), 'order preserved as given');
});

test('handles null sender/body', () => {
  const msgs = [{ timestamp: 1700000000, sender: null, body: null }];
  const csv = genCSV(msgs);
  assert.ok(csv.includes(',"",""'), 'empty fields quoted');
});

// ============================================================
// TESTS — genTXT()
// ============================================================
console.log('\n=== genTXT() ===');

test('single message with date header', () => {
  const msgs = [{ timestamp: 1686830400, sender: 'Alice', body: 'Hello' }];
  const txt = genTXT(msgs);
  assert.ok(txt.includes('[15/06/23]'), 'has date header: ' + txt.substring(0, 50));
  assert.ok(txt.includes('Hello'), 'has body');
});

test('same day groups under one date', () => {
  const noon = 1686830400; // 2023-06-15 12:00 UTC
  const msgs = [
    { timestamp: noon,      sender: 'Alice', body: 'First' },
    { timestamp: noon + 60, sender: 'Bob',   body: 'Second' },
  ];
  const txt = genTXT(msgs);
  const dateCount = (txt.match(/\[\d{2}\/\d{2}\/\d{2}\]/g) || []).length;
  assert.strictEqual(dateCount, 1, 'only one date header');
});

test('different days get separate headers', () => {
  const noon = 1686830400; // 2023-06-15 12:00 UTC
  const nextDay = noon + 86400;
  const msgs = [
    { timestamp: noon,    sender: 'Alice', body: 'Day 1' },
    { timestamp: nextDay, sender: 'Bob',   body: 'Day 2' },
  ];
  const txt = genTXT(msgs);
  const dateCount = (txt.match(/\[\d{2}\/\d{2}\/\d{2}\]/g) || []).length;
  assert.strictEqual(dateCount, 2, 'two date headers');
});

test('null sender shows "?"', () => {
  const noon = 1686830400;
  const msgs = [{ timestamp: noon, sender: null, body: 'Test' }];
  const txt = genTXT(msgs);
  assert.ok(txt.includes('?: Test'), 'null sender -> ?');
});

// ============================================================
// TESTS — genCSV/genTXT headers with phone & participants
// ============================================================
console.log('\n=== CSV/TXT headers with phone & participants ===');

test('CSV header includes phone for individual chat', () => {
  const chat = { id: '6281234567890@c.us', name: 'Alice', isGroup: false, phone: '6281234567890' };
  const csv = genCSV([], chat);
  assert.ok(csv.includes('# Chat: Alice (6281234567890)'), 'phone in header: ' + csv.substring(0, 80));
});

test('CSV header no phone if phone is null', () => {
  const chat = { id: '6281234567890@c.us', name: 'Alice', isGroup: false, phone: null };
  const csv = genCSV([], chat);
  assert.ok(!csv.includes('('), 'no phone parens when phone null');
});

test('CSV header includes participants for group chat', () => {
  const chat = {
    id: '123@g.us', name: 'Team Chat', isGroup: true,
    participants: [
      { name: 'Alice', phone: '628111' },
      { name: 'Bob', phone: '628222' }
    ]
  };
  const csv = genCSV([], chat);
  assert.ok(csv.includes('# Participants: Alice (628111), Bob (628222)'), 'participants on separate line. Got: ' + csv.substring(0, 150));
});

test('CSV header no participants if group has none', () => {
  const chat = { id: '123@g.us', name: 'Empty Group', isGroup: true, participants: [] };
  const csv = genCSV([], chat);
  assert.ok(!csv.includes('Participants'), 'no participants line when empty');
});

test('TXT header includes phone for individual chat', () => {
  const chat = { id: '6281234567890@c.us', name: 'Alice', isGroup: false, phone: '6281234567890' };
  const txt = genTXT([], chat);
  assert.ok(txt.includes('# Chat: Alice (6281234567890)'), 'phone in TXT header');
});

test('TXT header includes participants for group chat', () => {
  const chat = {
    id: '123@g.us', name: 'Team Chat', isGroup: true,
    participants: [
      { name: 'Alice', phone: '628111' },
      { name: 'Bob', phone: '628222' }
    ]
  };
  const txt = genTXT([], chat);
  assert.ok(txt.includes('# Chat: Team Chat | Alice (628111) Bob (628222)'), 'participants space-separated in TXT header');
});

// ============================================================
// TESTS — formatBody() media types
// ============================================================
console.log('\n=== formatBody() ===');

test('plain text passes through', () => {
  const msg = { body: 'Hello', type: 'chat' };
  assert.strictEqual(formatBody(msg), 'Hello');
});

test('image without caption', () => {
  const msg = { body: '', type: 'image' };
  assert.strictEqual(formatBody(msg), '[Image]');
});

test('image with caption', () => {
  const msg = { body: '', type: 'image', caption: 'Check this out' };
  assert.strictEqual(formatBody(msg), '[Image] Check this out');
});

test('video', () => {
  const msg = { body: '', type: 'video' };
  assert.strictEqual(formatBody(msg), '[Video]');
});

test('sticker', () => {
  const msg = { type: 'sticker' };
  assert.strictEqual(formatBody(msg), '[Sticker]');
});

test('voice message (ptt)', () => {
  const msg = { type: 'ptt' };
  assert.strictEqual(formatBody(msg), '[Voice Message]');
});

test('audio', () => {
  const msg = { type: 'audio' };
  assert.strictEqual(formatBody(msg), '[Audio]');
});

test('document without filename', () => {
  const msg = { type: 'document' };
  assert.strictEqual(formatBody(msg), '[Document]');
});

test('document with filename', () => {
  const msg = { type: 'document', filename: 'report.pdf' };
  assert.strictEqual(formatBody(msg), '[Document - report.pdf]');
});

test('location', () => {
  const msg = { type: 'location' };
  assert.strictEqual(formatBody(msg), '[Location]');
});

test('contact (vcard)', () => {
  const msg = { type: 'vcard' };
  assert.strictEqual(formatBody(msg), '[Contact]');
});

test('poll', () => {
  const msg = { type: 'poll_creation' };
  assert.strictEqual(formatBody(msg), '[Poll]');
});

test('event', () => {
  const msg = { type: 'event_creation' };
  assert.strictEqual(formatBody(msg), '[Event]');
});

test('call log', () => {
  const msg = { type: 'call_log' };
  assert.strictEqual(formatBody(msg), '[Call]');
});

test('revoked message', () => {
  const msg = { type: 'revoked' };
  assert.strictEqual(formatBody(msg), '[Message deleted]');
});

test('group action', () => {
  const msg = { type: 'gp2' };
  assert.strictEqual(formatBody(msg), '[Group action]');
});

test('notification', () => {
  const msg = { type: 'notification' };
  assert.strictEqual(formatBody(msg), '[Notification]');
});

test('disappearing message', () => {
  const msg = { type: 'ephemeral' };
  assert.strictEqual(formatBody(msg), '[Disappearing message]');
});

test('encrypted message', () => {
  const msg = { type: 'ciphertext' };
  assert.strictEqual(formatBody(msg), '[Encrypted message]');
});

test('order', () => {
  const msg = { type: 'order' };
  assert.strictEqual(formatBody(msg), '[Order]');
});

test('payment', () => {
  const msg = { type: 'payment' };
  assert.strictEqual(formatBody(msg), '[Payment]');
});

test('reaction', () => {
  const msg = { type: 'reaction' };
  assert.strictEqual(formatBody(msg), '[Reaction]');
});

test('template message', () => {
  const msg = { type: 'hsm' };
  assert.strictEqual(formatBody(msg), '[Template message]');
});

test('edited message', () => {
  const msg = { type: 'protocol', subtype: 'message_edit' };
  assert.strictEqual(formatBody(msg), '[Edited message]');
});

test('other protocol', () => {
  const msg = { type: 'protocol', subtype: 'something_else' };
  assert.strictEqual(formatBody(msg), '[System message]');
});

test('list', () => {
  const msg = { type: 'list' };
  assert.strictEqual(formatBody(msg), '[List]');
});

test('list response', () => {
  const msg = { type: 'list_response' };
  assert.strictEqual(formatBody(msg), '[List response]');
});

test('button response', () => {
  const msg = { type: 'buttons_response' };
  assert.strictEqual(formatBody(msg), '[Button response]');
});

test('product', () => {
  const msg = { type: 'product' };
  assert.strictEqual(formatBody(msg), '[Product]');
});

test('catalog', () => {
  const msg = { type: 'catalog' };
  assert.strictEqual(formatBody(msg), '[Catalog]');
});

test('unknown type returns body', () => {
  const msg = { body: 'Custom content', type: 'unknown_type_xyz' };
  assert.strictEqual(formatBody(msg), 'Custom content');
});

test('unknown type without body returns empty', () => {
  const msg = { type: 'unknown_type_xyz' };
  assert.strictEqual(formatBody(msg), '');
});

test('caption only, no body, no type match, no label', () => {
  const msg = { caption: 'Just a caption', type: 'unknown' };
  assert.strictEqual(formatBody(msg), 'Just a caption');
});

// ============================================================
// TESTS — formatBody() mention resolution (@phone)
// ============================================================
console.log('\n=== formatBody() mention resolution ===');

test('resolves @phone@c.us to @phone', () => {
  const msg = { body: 'Hello @6281234567890@c.us how are you?', type: 'chat' };
  const result = formatBody(msg);
  assert.strictEqual(result, 'Hello @6281234567890 how are you?');
});

test('resolves multiple @c.us mentions', () => {
  const msg = { body: '@628111@c.us and @628222@c.us joined', type: 'chat' };
  const result = formatBody(msg);
  assert.strictEqual(result, '@628111 and @628222 joined');
});

test('leaves plain @phone untouched', () => {
  const msg = { body: 'Call @6281234567890 please', type: 'chat' };
  const result = formatBody(msg);
  assert.strictEqual(result, 'Call @6281234567890 please');
});

test('handles no mentions', () => {
  const msg = { body: 'Hello world', type: 'chat' };
  const result = formatBody(msg);
  assert.strictEqual(result, 'Hello world');
});

test('resolves @phone@s.whatsapp.net to @phone', () => {
  const msg = { body: 'Hey @6281234567890@s.whatsapp.net', type: 'chat' };
  const result = formatBody(msg);
  assert.strictEqual(result, 'Hey @6281234567890');
});

test('mention resolution with media caption', () => {
  const msg = { body: '', type: 'image', caption: 'Look @628999@c.us' };
  const result = formatBody(msg);
  assert.strictEqual(result, '[Image] Look @628999');
});

test('mentionMap replaces LID with phone', () => {
  const msg = { body: 'Hello @123456789012345', type: 'chat' };
  const mentionMap = { '123456789012345': '6281234567890' };
  const result = formatBody(msg, mentionMap);
  assert.strictEqual(result, 'Hello @6281234567890');
});

test('mentionMap replaces multiple LIDs', () => {
  const msg = { body: '@111111@lid and @222222@lid joined', type: 'chat' };
  const mentionMap = { '111111': '628111', '222222': '628222' };
  const result = formatBody(msg, mentionMap);
  assert.strictEqual(result, '@628111 and @628222 joined');
});

test('mentionMap does not replace unknown numbers', () => {
  const msg = { body: 'Call @6281234567890', type: 'chat' };
  const mentionMap = { '99999': '628999' };
  const result = formatBody(msg, mentionMap);
  assert.strictEqual(result, 'Call @6281234567890');
});

// ============================================================
// TESTS — filterMessagesByDate()
// ============================================================
console.log('\n=== filterMessagesByDate() ===');

test('in range', () => {
  // Use UTC-safe timestamps to avoid timezone interpretation issues
  // 2023-06-15 12:00:00 UTC = 1686830400
  const jun15 = 1686830400;
  const jun16 = jun15 + 86400;
  const msgs = [
    { t: jun15 },
    { t: jun15 + 3600 },
    { t: jun16 },
  ];
  const result = filterMessagesByDate(msgs, '2023-06-15', '2023-06-16');
  assert.strictEqual(result.length, 3);
});

test('out of range before', () => {
  const msgs = [{ t: 1699000000 }]; // before range
  const result = filterMessagesByDate(msgs, '2023-11-14', '2023-11-16');
  assert.strictEqual(result.length, 0);
});

test('out of range after', () => {
  const msgs = [{ t: 1800000000 }]; // after range
  const result = filterMessagesByDate(msgs, '2023-11-14', '2023-11-16');
  assert.strictEqual(result.length, 0);
});

test('boundary — exactly at start of day', () => {
  const fromMs = new Date('2023-11-14').getTime() / 1000;
  const msgs = [{ t: fromMs }];
  const result = filterMessagesByDate(msgs, '2023-11-14', '2023-11-14');
  assert.strictEqual(result.length, 1, 'message at 00:00:00 of start date included');
});

test('boundary — end of day', () => {
  const endOfDay = new Date('2023-11-14T23:59:59').getTime() / 1000;
  const msgs = [{ t: endOfDay }];
  const result = filterMessagesByDate(msgs, '2023-11-14', '2023-11-14');
  assert.strictEqual(result.length, 1, 'message at 23:59:59 of end date included');
});

test('no timestamp filtered out', () => {
  const msgs = [{ body: 'no timestamp' }];
  const result = filterMessagesByDate(msgs, '2023-11-14', '2023-11-16');
  assert.strictEqual(result.length, 0);
});

// ============================================================
// From inject/init.js — extractPhone()
// ============================================================
function extractPhone(obj) {
  if (!obj) return null;
  const idObj = obj.id || obj;
  if (idObj.user) {
    const u = String(idObj.user);
    if (/^\d+$/.test(u)) return u;
  }
  if (idObj._serialized) {
    const parts = String(idObj._serialized).split('@');
    if (parts[0] && /^\d+$/.test(parts[0])) return parts[0];
  }
  if (typeof obj === 'string') {
    const parts = obj.split('@');
    if (parts[0] && /^\d+$/.test(parts[0])) return parts[0];
  }
  if (obj.phone) {
    const p = String(obj.phone).split('@')[0];
    if (/^\d+$/.test(p)) return p;
  }
  if (obj.toString && typeof obj.toString === 'function') {
    const s = obj.toString();
    const parts = s.split('@');
    if (parts[0] && /^\d+$/.test(parts[0])) return parts[0];
  }
  return null;
}

// ============================================================
// From inject/init.js — extractName()
// ============================================================
function extractName(obj) {
  if (!obj) return 'Unknown';
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
// From inject/init.js — phoneFromName()
// ============================================================
function phoneFromName(name) {
  if (!name) return null;
  const digits = name.replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 16) return digits;
  return null;
}

// ============================================================
// TESTS — extractPhone()
// ============================================================
console.log('\n=== extractPhone() ===');

test('null input returns null', () => {
  assert.strictEqual(extractPhone(null), null);
});

test('undefined input returns null', () => {
  assert.strictEqual(extractPhone(undefined), null);
});

test('id.user pure digits', () => {
  const obj = { id: { user: '6281234567890' } };
  assert.strictEqual(extractPhone(obj), '6281234567890');
});

test('id.user with non-digits returns null from user', () => {
  const obj = { id: { user: 'abc123' } };
  assert.strictEqual(extractPhone(obj), null);
});

test('id._serialized with @c.us', () => {
  const obj = { id: { _serialized: '6281234567890@c.us' } };
  assert.strictEqual(extractPhone(obj), '6281234567890');
});

test('id._serialized with @lid', () => {
  const obj = { id: { _serialized: '123456789012345@lid' } };
  assert.strictEqual(extractPhone(obj), '123456789012345');
});

test('id._serialized with @g.us (group) returns digits', () => {
  const obj = { id: { _serialized: '123456789@g.us' } };
  assert.strictEqual(extractPhone(obj), '123456789');
});

test('raw string with @c.us', () => {
  assert.strictEqual(extractPhone('628999@c.us'), '628999');
});

test('raw string with @s.whatsapp.net', () => {
  assert.strictEqual(extractPhone('628888@s.whatsapp.net'), '628888');
});

test('obj.phone field as fallback', () => {
  const obj = { phone: '628777' };
  assert.strictEqual(extractPhone(obj), '628777');
});

test('obj.phone with @suffix', () => {
  const obj = { phone: '628777@c.us' };
  assert.strictEqual(extractPhone(obj), '628777');
});

test('toString fallback', () => {
  const obj = { toString: () => '628666@c.us' };
  assert.strictEqual(extractPhone(obj), '628666');
});

test('no phone-like field returns null', () => {
  const obj = { name: 'Alice', foo: 'bar' };
  assert.strictEqual(extractPhone(obj), null);
});

test('empty object returns null', () => {
  assert.strictEqual(extractPhone({}), null);
});

test('id.user takes priority over _serialized', () => {
  const obj = { id: { user: '628111', _serialized: '628222@c.us' } };
  assert.strictEqual(extractPhone(obj), '628111');
});

// ============================================================
// TESTS — extractName()
// ============================================================
console.log('\n=== extractName() ===');

test('null input returns Unknown', () => {
  assert.strictEqual(extractName(null), 'Unknown');
});

test('undefined input returns Unknown', () => {
  assert.strictEqual(extractName(undefined), 'Unknown');
});

test('pushname takes highest priority', () => {
  const obj = {
    pushname: 'Alice',
    name: 'Bob',
    __x_pushname: 'Charlie'
  };
  assert.strictEqual(extractName(obj), 'Alice');
});

test('skips pushname if it equals "Unknown"', () => {
  const obj = { pushname: 'Unknown', name: 'Bob' };
  assert.strictEqual(extractName(obj), 'Bob');
});

test('__x_pushname fallback', () => {
  const obj = { __x_pushname: 'Charlie' };
  assert.strictEqual(extractName(obj), 'Charlie');
});

test('name fallback', () => {
  const obj = { name: 'Bob' };
  assert.strictEqual(extractName(obj), 'Bob');
});

test('skips name if "Unknown"', () => {
  const obj = { name: 'Unknown', formattedName: 'Bob Builder' };
  assert.strictEqual(extractName(obj), 'Bob Builder');
});

test('__x_name fallback', () => {
  const obj = { __x_name: 'Dana' };
  assert.strictEqual(extractName(obj), 'Dana');
});

test('formattedName fallback', () => {
  const obj = { formattedName: 'Bob Builder' };
  assert.strictEqual(extractName(obj), 'Bob Builder');
});

test('__x_formattedTitle fallback', () => {
  const obj = { __x_formattedTitle: 'The Builder' };
  assert.strictEqual(extractName(obj), 'The Builder');
});

test('shortName fallback', () => {
  const obj = { shortName: 'Bob' };
  assert.strictEqual(extractName(obj), 'Bob');
});

test('string input with valid name', () => {
  assert.strictEqual(extractName('Alice Cooper'), 'Alice Cooper');
});

test('string input that looks like phone returns Unknown', () => {
  assert.strictEqual(extractName('+62 822-9940-1163'), 'Unknown');
});

test('string input that looks like JID passes through (letters in domain)', () => {
  // "6281234567890@c.us" contains letters (c,u,s) so the phone-detection regex
  // does not block it — it passes through as a name string.
  assert.strictEqual(extractName('6281234567890@c.us'), '6281234567890@c.us');
});

test('empty string returns Unknown', () => {
  assert.strictEqual(extractName(''), 'Unknown');
});

test('no matching fields returns Unknown', () => {
  assert.strictEqual(extractName({ foo: 'bar' }), 'Unknown');
});

// ============================================================
// TESTS — phoneFromName()
// ============================================================
console.log('\n=== phoneFromName() ===');

test('null input returns null', () => {
  assert.strictEqual(phoneFromName(null), null);
});

test('undefined input returns null', () => {
  assert.strictEqual(phoneFromName(undefined), null);
});

test('empty string returns null', () => {
  assert.strictEqual(phoneFromName(''), null);
});

test('formatted phone "+62 822-9940-1163"', () => {
  assert.strictEqual(phoneFromName('+62 822-9940-1163'), '6282299401163');
});

test('phone with spaces "62812 3456 7890"', () => {
  assert.strictEqual(phoneFromName('62812 3456 7890'), '6281234567890');
});

test('phone with dashes "62812-3456-7890"', () => {
  assert.strictEqual(phoneFromName('62812-3456-7890'), '6281234567890');
});

test('phone with parens "(022) 12345678"', () => {
  assert.strictEqual(phoneFromName('(022) 12345678'), '02212345678');
});

test('too short (< 8 digits) returns null', () => {
  assert.strictEqual(phoneFromName('1234567'), null);
});

test('too long (> 16 digits) returns null', () => {
  assert.strictEqual(phoneFromName('12345678901234567'), null);
});

test('boundary: exactly 8 digits', () => {
  assert.strictEqual(phoneFromName('12345678'), '12345678');
});

test('boundary: exactly 16 digits', () => {
  assert.strictEqual(phoneFromName('1234567890123456'), '1234567890123456');
});

test('common name (no digits) returns null', () => {
  assert.strictEqual(phoneFromName('Alice'), null);
});

test('mixed text and digits too short', () => {
  assert.strictEqual(phoneFromName('Call 123'), null);
});

// ============================================================
// TESTS — sortChatsByLastMsg()
// ============================================================
console.log('\n=== sortChatsByLastMsg() ===');

test('newest first', () => {
  const chats = [
    { name: 'Old', t: 1000 },
    { name: 'New', t: 3000 },
    { name: 'Mid', t: 2000 },
  ];
  const sorted = sortChatsByLastMsg(chats);
  assert.strictEqual(sorted[0].name, 'New');
  assert.strictEqual(sorted[1].name, 'Mid');
  assert.strictEqual(sorted[2].name, 'Old');
});

test('no timestamp goes last', () => {
  const chats = [
    { name: 'NoDate' },
    { name: 'HasDate', t: 1000 },
  ];
  const sorted = sortChatsByLastMsg(chats);
  assert.strictEqual(sorted[0].name, 'HasDate');
  assert.strictEqual(sorted[1].name, 'NoDate');
});

test('does not mutate original', () => {
  const chats = [{ name: 'A', t: 100 }, { name: 'B', t: 200 }];
  const sorted = sortChatsByLastMsg(chats);
  assert.strictEqual(chats[0].name, 'A', 'original order preserved');
  assert.strictEqual(sorted[0].name, 'B');
});

// ============================================================
// TESTS — rand()
// ============================================================
console.log('\n=== rand() ===');

test('returns within range', () => {
  for (let i = 0; i < 100; i++) {
    const r = rand(4000, 8000);
    assert.ok(r >= 4000 && r <= 8000, r + ' out of range');
  }
});

// ============================================================
// RESULTS
// ============================================================
console.log('\n' + '='.repeat(40));
console.log(passed + ' passed, ' + failed + ' failed, ' + (passed + failed) + ' total');
console.log('='.repeat(40));

if (failed > 0) process.exit(1);
