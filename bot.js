
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error('no BOT_TOKEN'); process.exit(1); }
const API = 'https://api.telegram.org/bot' + TOKEN;
const BOSS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const GROUP = process.env.GROUP_ID || '';
const DB = path.join(__dirname, 'data.json');
const TAG = 'ND_STATE:';
const VERSION = '2.0.0';

const boss = id => BOSS.includes(String(id));
const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = n => '£' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');
const now = () => Date.now();
const isMk = x => !!(x && (x.inline_keyboard || x.reply_markup));
const asMarkup = x => (!x ? null : isMk(x) ? x : { inline_keyboard: x });

const TIERS = [
  { id: 't1', label: 'STARTER', price: 200, cash: '2,500' },
  { id: 't2', label: 'STANDARD', price: 350, cash: '5,000' },
  { id: 't3', label: 'PRO', price: 500, cash: '8,000' },
  { id: 't4', label: 'ELITE', price: 700, cash: '12,000' }
];
const PAYNAME = { crypto: 'Crypto', bank: 'Bank transfer', remitly: 'Remitly' };

const HOWTO = '<b>HOW TO CASH OUT</b>\n\n1. Insert the card into any ATM\n2. Choose your language\n3. Enter the PIN that comes with it\n4. Select WITHDRAWAL\n5. Select the current account\n6. Enter the amount, up to the limit on your tier\n7. Take the cash\n8. Take the receipt\n\n<b>Only withdraw what you need, then check the balance before you try again.</b>';

const fresh = () => ({
  price: { t1: 200, t2: 350, t3: 500, t4: 700 },
  stock: { t1: -1, t2: -1, t3: -1, t4: -1 },
  busy: false,
  pay: { crypto: '', bank: '', remitly: '' },
  photos: { t1: '', t2: '', t3: '', t4: '' },
  appeal: 'Hi, my account was restricted for duplicate content. I make all my own posts. Please review, I think this was a mistake. Thanks.',
  redirect: 'Account blocked. Still selling, same person. Message me here @yourbackup',
  people: {}, orders: {}, drafts: {}, seq: 1000, tick: 0,
  digest: 0, autoClose: 72, muted: {}
});

let db; let firstBoot = false;
try { db = Object.assign(fresh(), JSON.parse(fs.readFileSync(DB, 'utf8'))); } catch { db = fresh(); firstBoot = true; }

let writing = false;
const keep = () => {
  if (writing) return;
  writing = true;
  setTimeout(() => {
    writing = false;
    try { fs.writeFileSync(DB + '.tmp', JSON.stringify(db)); fs.renameSync(DB + '.tmp', DB); } catch {}
    saveState();
  }, 250);
};

const settingsJson = () => {
  const base = { price: db.price, stock: db.stock, busy: db.busy, pay: db.pay, photos: db.photos, appeal: db.appeal, redirect: db.redirect, seq: db.seq, digest: db.digest, autoClose: db.autoClose };
  const ids = Object.keys(db.orders).slice(-25);
  const recent = {};
  let txt = TAG + JSON.stringify(Object.assign({ orders: recent }, base));
  for (const id of ids) { recent[id] = db.orders[id]; }
  txt = TAG + JSON.stringify(Object.assign({ orders: recent }, base));
  if (txt.length > 3900) {
    const lean = {};
    for (const id of ids.slice(-10)) { const o = db.orders[id]; lean[id] = { code: o.code, who: o.who, tier: o.tier, how: o.how, state: o.state, when: o.when }; }
    txt = TAG + JSON.stringify(Object.assign({ orders: lean }, base));
  }
  return txt;
};

let storeMsg = 0, storeBusy = false, restoring = false;
async function saveState() {
  if (!BOSS[0] || storeBusy || restoring) return;
  storeBusy = true;
  try {
    const body = { chat_id: BOSS[0], text: settingsJson() };
    if (storeMsg) {
      const r = await api('editMessageText', Object.assign({ message_id: storeMsg }, body));
      if (!r || !r.ok) storeMsg = 0;
    }
    if (!storeMsg) {
      const r = await api('sendMessage', body);
      if (r && r.ok) { storeMsg = r.result.message_id; await api('pinChatMessage', { chat_id: BOSS[0], message_id: storeMsg, disable_notification: true }); }
    }
  } catch {}
  storeBusy = false;
}

async function loadState() {
  if (!BOSS[0]) return false;
  try {
    const r = await api('getChat', { chat_id: BOSS[0] });
    const m = r && r.ok && r.result && r.result.pinned_message;
    if (!m || !m.text || m.text.indexOf(TAG) !== 0) return false;
    storeMsg = m.message_id;
    const j = JSON.parse(m.text.slice(TAG.length));
    for (const k of ['price', 'stock', 'pay', 'photos', 'appeal', 'redirect', 'orders', 'seq', 'digest', 'autoClose']) { if (j[k] != null) db[k] = j[k]; }
    if (typeof j.busy === 'boolean') db.busy = j.busy;
    return true;
  } catch { return false; }
}
const q = []; let busySend = false;
const say = (to, text, extra) => new Promise(r => { q.push({ to, text, extra, r }); pump(); });
async function pump() {
  if (busySend || !q.length) return;
  busySend = true;
  while (q.length) {
    const j = q.shift();
    try { j.r(await api('sendMessage', Object.assign({ chat_id: j.to, text: j.text, parse_mode: 'HTML', disable_web_page_preview: true }, asMarkup(j.extra)))); }
    catch { j.r(null); }
    await new Promise(r => setTimeout(r, 55 + Math.random() * 70));
  }
  busySend = false;
}

async function api(method, body, tries) {
  const n = tries || 3;
  for (let i = 0; i < n; i++) {
    try {
      const r = await fetch(API + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j && j.ok) return j;
      if (j && j.error_code === 429) { const w = ((j.parameters && j.parameters.retry_after) || 1) * 1000; await new Promise(s => setTimeout(s, w)); continue; }
      if (j && j.error_code === 400) return j;
      await new Promise(s => setTimeout(s, 400 * (i + 1)));
    } catch { await new Promise(s => setTimeout(s, 400 * (i + 1))); }
  }
  return { ok: false };
}

const tiers = () => TIERS.map(t => ({ ...t, price: db.price[t.id] || t.price, stock: db.stock[t.id] == null ? -1 : db.stock[t.id] }));
const tierOf = id => tiers().find(t => t.id === id);
const avail = t => (t.stock === -1 || t.stock > 0);
const stockLine = t => (t.stock === -1 ? '' : t.stock === 0 ? ' ❌ gone' : t.stock <= 2 ? ' ⚠️ ' + t.stock + ' left' : '');
const newCode = () => { db.seq = (db.seq || 1000) + 1; return 'ND-' + db.seq; };
const menu = () => ({ inline_keyboard: [
  [{ text: '🛒 ORDER NOW', callback_data: 'shop' }],
  [{ text: '💷 PRICES', callback_data: 'prices' }, { text: '📖 HOW IT WORKS', callback_data: 'how' }],
  [{ text: '📦 POSTAGE & PAYMENT', callback_data: 'info' }],
  [{ text: '⭐ VOUCHES', callback_data: 'vouch' }]
]});
const openLine = () => '👋 <b>Never Dark</b>\n\nClone cards. Blank, verified, works in any ATM.\n\n<b>Tap what you want 👇</b>';

const STEPS = { new: 'Just paid, not confirmed', taken: 'Payment confirmed, packing', sent: 'Posted', done: 'Delivered', gone: 'Cancelled' };
const draftOf = id => db.drafts[id] || null;
const setDraft = (id, d) => { db.drafts[id] = Object.assign({ at: now() }, d); keep(); };
const clearDraft = id => { if (db.drafts[id]) { delete db.drafts[id]; keep(); } };
async function card(o) {
  const t = tierOf(o.tier);
  if (!GROUP) return null;
  const r = await api('sendMessage', {
    chat_id: GROUP,
    text: '🔔 <b>NEW ORDER ' + e(o.code) + '</b>\n\n' + e(t.label) + ' - <b>' + money(o.price) + '</b>\n👤 ' + e(o.name) + '\n📍 ' + e(o.addr) + '\n💳 ' + e(PAYNAME[o.how] || o.how) + '\n\n<i>tap the step you have just done</i>',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [
      [{ text: '✅ MONEY IN', callback_data: 'o:' + o.code + ':taken' }],
      [{ text: '📮 POSTED', callback_data: 'o:' + o.code + ':sent' }],
      [{ text: '📦 DELIVERED', callback_data: 'o:' + o.code + ':done' }],
      [{ text: '✖️ CANCEL', callback_data: 'o:' + o.code + ':gone' }]
    ] }
  });
  if (r && r.ok) { o.card = r.result.message_id; keep(); }
  return r;
}

async function reCard(o) {
  if (!GROUP || !o.card) return;
  const t = tierOf(o.tier);
  const kb = o.state === 'taken' ? [[{ text: '📮 POSTED', callback_data: 'o:' + o.code + ':sent' }, { text: '✖️ CANCEL', callback_data: 'o:' + o.code + ':gone' }]]
    : o.state === 'sent' ? [[{ text: '📦 DELIVERED', callback_data: 'o:' + o.code + ':done' }, { text: '✖️ CANCEL', callback_data: 'o:' + o.code + ':gone' }]]
    : o.state === 'new' ? [[{ text: '✅ MONEY IN', callback_data: 'o:' + o.code + ':taken' }], [{ text: '✖️ CANCEL', callback_data: 'o:' + o.code + ':gone' }]] : [];
  await api('editMessageText', {
    chat_id: GROUP, message_id: o.card, parse_mode: 'HTML',
    text: '🔔 <b>ORDER ' + e(o.code) + '</b>\n\n' + e(t.label) + ' - <b>' + money(o.price) + '</b>\n👤 ' + e(o.name) + '\n📍 ' + e(o.addr) + '\n💳 ' + e(PAYNAME[o.how] || o.how) + '\n\n<b>' + (STEPS[o.state] || o.state).toUpperCase() + '</b>',
    reply_markup: { inline_keyboard: kb }
  });
}

async function move(code, state, quiet) {
  const o = db.orders[code];
  if (!o) return false;
  const from = o.state;
  const ok = ['new', 'taken', 'sent', 'done', 'gone'];
  if (!ok.includes(state)) return false;
  o.state = state;
  o.moved = now();
  if (state === 'done' && !o.doneAt) o.doneAt = now();
  keep();
  await reCard(o);
  if (quiet) return true;
  if (state === 'new') await say(o.who, '🕐 <b>' + o.code + '</b> received. Sending your payment details now.');
  if (state === 'taken' && from !== 'taken') await say(o.who, '✅ <b>' + o.code + '</b> - payment confirmed. Packing today, posting next working day.');
  if (state === 'sent') await say(o.who, '📮 <b>' + o.code + '</b> - posted. Card and PIN are on the way, tracking follows if you asked for it.');
  if (state === 'gone') await say(o.who, '✖️ <b>' + o.code + '</b> - cancelled. Anything paid is refunded in full.');
  if (state === 'done') await say(o.who, '📦 <b>' + o.code + '</b> - delivered 🙏 Any trouble at all, message me. If it went smoothly, one line as a vouch helps a lot.', { inline_keyboard: [[{ text: '⭐ LEAVE A VOUCH', callback_data: 'vouch:' + o.code }]] });
  return true;
}

async function placeOrder(id, d) {
  const t = tierOf(d.tier);
  if (!t) { clearDraft(id); return say(id, 'That tier has gone. Tap /start and pick again.'); }
  const o = {
    code: newCode(), who: id, name: d.name, addr: d.addr, tier: d.tier,
    price: t.price, how: d.how, state: 'new', when: now(), note: d.note || '', card: 0, moved: now()
  };
  db.orders[o.code] = o;
  if (db.stock[d.tier] > 0) db.stock[d.tier] -= 1;
  clearDraft(id);
  keep();
  const det = (db.pay[d.how] || '').trim();
  await say(id, '✅ <b>ORDER ' + o.code + '</b>\n\n' + e(t.label) + ' - ' + money(t.price) + '\n\n' + (det ? '💷 <b>PAY HERE</b>\n\n' + e(det) + '\n\n<b>Send the screenshot when paid</b> and it goes out same day.' : 'Payment details follow shortly. Send the screenshot when paid and it goes out same day.'), { inline_keyboard: [[{ text: '📋 MY ORDER', callback_data: 'mine:' + o.code }]] });
  await card(o);
  return o;
}

async function proof(id, m) {
  const d = draftOf(id);
  const live = Object.values(db.orders).filter(o => o.who === id && (o.state === 'new' || o.state === 'taken')).sort((a, b) => b.when - a.when);
  const o = d && d.code ? (db.orders[d.code] || live[0]) : live[0];
  if (!o) return say(id, 'Thanks. I have not got an open order for you though. Tap /start to place one.');
  o.proof = m.message_id; o.proofAt = now(); keep();
  await say(id, '📸 Proof received against <b>' + o.code + '</b>. Checking now, you will hear back here.');
  if (GROUP) await api('sendMessage', { chat_id: GROUP, text: '📸 <b>PROOF SENT - ' + e(o.code) + '</b>\n👤 ' + e(o.name), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '✅ MONEY IN', callback_data: 'o:' + o.code + ':taken' }, { text: '✖️ CANCEL', callback_data: 'o:' + o.code + ':gone' }]] } });
}

const note = (id, text) => { const d = draftOf(id); if (!d) return; d.note = text; setDraft(id, d); };
const wait = {};

const bossMenu = () => ({ inline_keyboard: [
  [{ text: '💰 PRICES', callback_data: 'b:prices' }, { text: '📦 STOCK', callback_data: 'b:stock' }],
  [{ text: '💷 PAYMENT DETAILS', callback_data: 'b:pay' }, { text: '🖼 PHOTOS', callback_data: 'b:photos' }],
  [{ text: db.busy ? '✅ BACK ON' : '🛑 TAKE A BREAK', callback_data: 'b:busy' }, { text: '📣 EVERYONE', callback_data: 'b:all' }],
  [{ text: '📊 TODAY', callback_data: 'b:count' }, { text: '🧾 OPEN ORDERS', callback_data: 'b:open' }],
  [{ text: '💾 BACKUP', callback_data: 'b:backup' }, { text: '🚨 IF BLOCKED', callback_data: 'b:ban' }],
  [{ text: '🛒 BUYER VIEW', callback_data: 'b:view' }]
]});

async function incoming(m) {
  const id = String(m.from.id);
  const chat = m.chat.id;
  const person = db.people[id];
  const isBoss = boss(id);
  if (isBoss && chat !== Number(BOSS[0] || 0) && !person) db.people[id] = { id, name: m.from.first_name || 'boss' };

  if (m.photo) { if (isBoss) return photoAs(m); return proof(id, m); }

  const raw = (m.text || '').trim();
  if (!raw) return;
  const t = raw.replace(/@\w+$/i, '').trim();
  const p = db.people[id];
  const d = draftOf(id);
  const w = wait[id];
  if (w && w.what === 'vouch') return vouchIn(id, w, t, chat);

  if (isBoss && t === '/start') return say(chat, '<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());
  if (isBoss && (t === '/admin' || t === '/menu')) return say(chat, '<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());
  if (isBoss && t === '/buyer') { clearDraft(id); return say(chat, openLine(), menu()); }
  if (t === '/id') return say(chat, 'Chat id: <code>' + chat + '</code>');

  if (w) {
    const r = await takeStep(id, w, t, m);
    if (r !== false) return;
  }

  if (t === '/start') {
    if (!p) { db.people[id] = { id, name: m.from.first_name || 'buyer' }; }
    const ref = (raw.split(' ')[1] || '');
    if (ref.indexOf('ref_') === 0 && db.people[ref.slice(4)]) { db.people[ref.slice(4)].credit = (db.people[ref.slice(4)].credit || 0) + 1; say(ref.slice(4), '👥 Someone joined on your link. £1 credit for you.'); }
    clearDraft(id);
    keep();
    return say(chat, openLine(), menu());
  }
  if (d && d.step === 'name') { d.name = t; d.step = 'addr'; setDraft(id, d); return say(chat, 'Got it. Now the <b>full postal address</b>, including the postcode.'); }
  if (d && d.step === 'addr') { d.addr = t; d.step = 'pay'; setDraft(id, d); return payPick(id, chat, d); }
  if (d && d.step === 'note') { d.note = t; d.step = 'pay'; setDraft(id, d); return payPick(id, chat, d); }

  if (/^(nd-)?\d{3,}$/i.test(t)) return track(chat, t.toUpperCase());
  if (t === '/orders') return mine(chat, id);

  if (isBoss && (t === '/stats' || t === '/digest')) return say(chat, statsText(), bossMenu());
  say(chat, 'Tap below 👇', menu());
}

const payPick = (id, chat, d) => {
  const t = tierOf(d.tier);
  const row = Object.keys(PAYNAME).map(k => [{ text: PAYNAME[k] + (db.pay[k] ? '' : ' ➖'), callback_data: 'pay:' + k }]);
  return say(chat, '📦 <b>' + e(t.label) + ' - ' + money(t.price) + '</b>\n👤 ' + e(d.name) + '\n📍 ' + e(d.addr) + '\n\n<b>How are you paying?</b>', { inline_keyboard: row.concat([[{ text: '⬅️ READDRESS', callback_data: 'redo' }]]) });
};

async function takeStep(id, w, t, m) {
  const chat = m.chat.id;
  const isBoss = boss(id);
  if (w.what === 'paydetail') {
    wait[id] = null;
    db.pay[w.which] = t;
    keep();
    await say(chat, '✅ Saved for <b>' + PAYNAME[w.which] + '</b>. Buyers get exactly that the moment they pick it.', bossMenu());
    return true;
  }
  if (w.what === 'price') {
    wait[id] = null;
    const n = parseFloat(t.replace(/[^0-9.]/g, ''));
    if (isNaN(n) || n <= 0) { await say(chat, 'Just the number please, like 250'); wait[id] = w; return true; }
    db.price[w.which] = n;
    keep();
    await say(chat, '✅ ' + (tierOf(w.which) || {}).label + ' is now <b>' + money(n) + '</b>', bossMenu());
    return true;
  }
  if (w.what === 'stock') {
    wait[id] = null;
    const n = parseInt(t.replace(/[^0-9-]/g, ''), 10);
    if (isNaN(n)) { await say(chat, 'A number please. 0 means gone, -1 means unlimited.'); wait[id] = w; return true; }
    db.stock[w.which] = n < 0 ? -1 : n;
    keep();
    await say(chat, '✅ ' + (tierOf(w.which) || {}).label + ' stock set to ' + (n < 0 ? 'unlimited' : n), bossMenu());
    return true;
  }
  if (w.what === 'all') {
    wait[id] = null;
    const all = Object.keys(db.people).filter(x => !db.people[x].blocked && !BOSSSET.has(x));
    await say(chat, 'Sending to ' + all.length + '…');
    let ok = 0;
    for (const x of all) { if (await say(x, t)) ok++; }
    await say(chat, '✅ Delivered to ' + ok + ' of ' + all.length, bossMenu());
    return true;
  }
  if (w.what === 'backup') {
    wait[id] = null;
    try {
      const j = JSON.parse(t);
      for (const k of ['price', 'pay', 'photos', 'stock']) if (j[k]) db[k] = j[k];
      if (j.appeal) db.appeal = j.appeal;
      if (j.redirect) db.redirect = j.redirect;
      keep();
      await say(chat, '✅ Restored.', bossMenu());
    } catch { await say(chat, 'That did not parse. Paste the whole line starting with {'); wait[id] = w; }
    return true;
  }
  if (w.what === 'appeal') { wait[id] = null; db.appeal = t; keep(); await say(chat, '✅ Appeal text saved.', bossMenu()); return true; }
  if (w.what === 'redirect') { wait[id] = null; db.redirect = t; keep(); await say(chat, '✅ Blocked notice saved.', bossMenu()); return true; }
  return false;
}

const BOSSSET = new Set(BOSS);

async function photoAs(m) {
  const id = String(m.from.id);
  const cap = (m.caption || '').trim().toUpperCase();
  const t = tiers().find(x => cap === x.label || cap === x.id.toUpperCase());
  const fid = m.photo[m.photo.length - 1].file_id;
  if (!t) return say(id, 'Send it with the tier name as the caption: STARTER, STANDARD, PRO or ELITE.');
  db.photos[t.id] = fid;
  keep();
  return say(id, '✅ Photo set for <b>' + t.label + '</b>, it now shows when a buyer picks that tier.');
}

async function track(chat, code) {
  if (!/^ND-/.test(code)) code = 'ND-' + code;
  const o = db.orders[code];
  if (!o) return say(chat, 'No order <b>' + e(code) + '</b>. Check the number and try again.');
  return say(chat, '🧾 <b>' + e(o.code) + '</b>\n' + e((tierOf(o.tier) || {}).label || '') + ' - ' + money(o.price) + '\n\nStatus: <b>' + (STEPS[o.state] || o.state).toUpperCase() + '</b>');
}

async function mine(chat, id) {
  const list = Object.values(db.orders).filter(o => o.who === id).sort((a, b) => b.when - a.when).slice(0, 8);
  if (!list.length) return say(chat, 'No orders yet. Tap /start to place one.');
  const rows = list.map(o => [{ text: o.code + ' · ' + (STEPS[o.state] || o.state), callback_data: 'mine:' + o.code }]);
  return say(chat, '<b>YOUR ORDERS</b>', { inline_keyboard: rows });
}

function statsText() {
  const day = new Date().setHours(0, 0, 0, 0);
  const list = Object.values(db.orders);
  const today = list.filter(o => o.when >= day);
  const sold = today.filter(o => o.state !== 'gone');
  const open = list.filter(o => o.state === 'new' || o.state === 'taken' || o.state === 'sent');
  const takings = list.filter(o => o.state === 'done').reduce((s, o) => s + o.price, 0);
  const rows = [
    '<b>TODAY</b>',
    'New orders: <b>' + today.length + '</b>',
    'Taken today: <b>' + money(sold.reduce((s, o) => s + o.price, 0)) + '</b>',
    '',
    '<b>ALL TIME</b>',
    'Orders: <b>' + list.length + '</b>',
    'Delivered: <b>' + list.filter(o => o.state === 'done').length + '</b>',
    'Takings: <b>' + money(takings) + '</b>',
    'Still open: <b>' + open.length + '</b>',
    '',
    '<b>STOCK</b>'
  ];
  for (const t of tiers()) rows.push(t.label + ': ' + (t.stock === -1 ? 'unlimited' : t.stock));
  return rows.join('\n');
}

function scan() {
  db.tick = (db.tick || 0) + 1;
  const spot = now();
  let dl = 0;
  for (const id of Object.keys(db.drafts)) {
    if (spot - (db.drafts[id].at || 0) > 1800000) { delete db.drafts[id]; dl++; }
  }
  if (dl) keep();
  for (const o of Object.values(db.orders)) {
    const age = spot - o.when;
    if (o.state === 'new' && !o.n1 && age > 900000) { o.n1 = 1; keep(); say(o.who, '💷 Still waiting on payment for <b>' + o.code + '</b>. Need the details again? Message me.'); }
    if (o.state === 'sent' && !o.n2 && spot - o.moved > 259200000) { o.n2 = 1; keep(); say(o.who, '📦 <b>' + o.code + '</b> went out a few days ago. Landed ok? Anything wrong, tell me now.'); }
  }
}

function digest() {
  const day = new Date().setHours(0, 0, 0, 0);
  const today = Object.values(db.orders).filter(o => o.when >= day);
  if (!today.length) return;
  const cash = today.filter(o => o.state !== 'gone');
  const open = Object.values(db.orders).filter(o => o.state === 'new' || o.state === 'taken').length;
  say(BOSS[0], '📊 <b>END OF DAY</b>\n\nOrders: <b>' + today.length + '</b>\nValue: <b>' + money(cash.reduce((s, o) => s + o.price, 0)) + '</b>\nStill open: <b>' + open + '</b>');
}
async function tapped(cb) {
  const id = String(cb.from.id);
  const chat = cb.message.chat.id;
  const mid = cb.message.message_id;
  const d = cb.data || '';
  const isBoss = boss(id);
  const p = db.people[id];
  api('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
  const edit = (text, mk) => api('editMessageText', { chat_id: chat, message_id: mid, text, parse_mode: 'HTML', reply_markup: isMk(mk) ? mk : { inline_keyboard: mk } });

  if (d === 'shop') {
    if (db.busy) return say(chat, '🛑 On a break right now, back shortly.');
    const rows = tiers().filter(avail).map(t => [{ text: t.label + ' - ' + money(t.price) + stockLine(t), callback_data: 'pick:' + t.id }]);
    if (!rows.length) return say(chat, 'Everything is sold out just now. Check back soon.');
    return edit('<b>PICK YOUR TIER</b>\n\nTap one 👇', rows.concat([[{ text: '⬅️ BACK', callback_data: 'menu' }]]));
  }
  if (d === 'menu') return edit(openLine(), menu());
  if (d === 'prices') return edit('<b>PRICES</b>\n\n' + tiers().map(t => '<b>' + t.label + '</b> - ' + money(t.price) + (avail(t) ? '' : ' ❌') + '\n<i>cashes out ' + t.cash + '</i>').join('\n\n') + '\n\nPosted tracked. Pay by crypto, bank or Remitly.', menu());
  if (d === 'how') return edit(HOWTO, menu());
  if (d === 'info') return edit('<b>POSTAGE</b>\n\nTracked, posted next working day.\n\n<b>PAYMENT</b>\n\nCrypto, bank transfer or Remitly. Details come the second you order.\n\n<b>AFTER PAYING</b>\n\nCard and PIN out same day, then read HOW IT WORKS.', menu());
  if (d === 'vouch') return edit('<b>VOUCHES</b>\n\nReal feedback goes in the group. We never chase reviews.\n\nDone a deal? Tap below and say one line.', { inline_keyboard: [[{ text: '⭐ LEAVE A VOUCH', callback_data: 'vouch:' }], [{ text: '⬅️ BACK', callback_data: 'menu' }]] });

  if (d.indexOf('pick:') === 0) {
    const t = tierOf(d.slice(5));
    if (!t) return say(chat, 'That one has gone. /start again.');
    if (!avail(t)) return say(chat, t.label + ' is out just now.');
    setDraft(id, { step: 'name', tier: t.id });
    const head = '📦 <b>' + t.label + ' - ' + money(t.price) + '</b>\nCashes out <b>' + t.cash + '</b>\n\n<b>Your full name?</b>';
    if (db.photos[t.id]) { api('deleteMessage', { chat_id: chat, message_id: mid }).catch(() => {}); return api('sendPhoto', { chat_id: chat, photo: db.photos[t.id], caption: head, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ BACK', callback_data: 'shop' }]] } }); }
    return edit(head, [[{ text: '⬅️ BACK', callback_data: 'shop' }]]);
  }
  if (d === 'redo') { const dr = draftOf(id); if (dr) { dr.step = 'name'; setDraft(id, dr); } return edit('<b>Your full name?</b>', [[{ text: '⬅️ BACK', callback_data: 'shop' }]]); }

  if (d.indexOf('pay:') === 0) {
    const dr = draftOf(id);
    if (!dr) return say(chat, 'Session expired. Tap /start and pick again.');
    dr.how = d.slice(4);
    setDraft(id, dr);
    const o = await placeOrder(id, dr);
    if (o) return;
  }

  if (d.indexOf('o:') === 0 && isBoss) {
    const parts = d.split(':');
    const code = parts[1], state = parts[2];
    const o = db.orders[code];
    if (!o) return say(chat, 'That order is not in memory. It may have been cleared.');
    await move(code, state);
    return;
  }

  if (d.indexOf('mine:') === 0) return track(chat, d.slice(5));
  if (d === 'vouchit') { wait[id] = { what: 'vouch' }; return say(chat, 'One line and I will put it in the group.'); }
  if (d.indexOf('vouch:') === 0) { wait[id] = { what: 'vouch', code: d.slice(6) }; return say(chat, 'One line and I will put it in the group.'); }

  if (!isBoss) return;
  if (d === 'b:view') return edit(openLine(), menu());
  if (d === 'b:home') return edit('<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());
  if (d === 'b:count') return edit(statsText(), bossMenu());
  if (d === 'b:busy') { db.busy = !db.busy; keep(); return edit(db.busy ? '🛑 <b>ON A BREAK</b>\n\nNew orders are paused.' : '✅ <b>BACK ON</b>', bossMenu()); }
  if (d === 'b:prices') return edit('<b>CHANGE A PRICE</b>\n\nTap one 👇', tiers().map(t => [{ text: t.label + ' - ' + money(t.price) + ' (' + (t.price / 100).toFixed(2) + ')', callback_data: 'b:p:' + t.id }]).concat([[{ text: '⬅️ BACK', callback_data: 'b:home' }]]));
  if (d.indexOf('b:p:') === 0) { const t = tierOf(d.slice(4)); if (!t) return; wait[id] = { what: 'price', which: t.id }; return edit('<b>New price for ' + t.label + '?</b>\n\nJust the number in pounds, like 250'); }
  if (d === 'b:stock') return edit('<b>STOCK</b>\n\n▫️ = unlimited, then counts down on its own.\n\nTap one 👇', tiers().map(t => [{ text: t.label + ': ' + (t.stock === -1 ? 'unlimited' : t.stock), callback_data: 'b:s:' + t.id }]).concat([[{ text: '⬅️ BACK', callback_data: 'b:home' }]]));
  if (d.indexOf('b:s:') === 0) { const t = tierOf(d.slice(4)); if (!t) return; wait[id] = { what: 'stock', which: t.id }; return edit('<b>' + t.label + ' stock</b>\n\nNumber. 0 = gone, -1 = unlimited.'); }
  if (d === 'b:pay') return edit('<b>PAYMENT DETAILS</b>\n\n' + Object.keys(PAYNAME).map(k => '<b>' + PAYNAME[k] + '</b>: ' + (db.pay[k] ? '✅ set' : '❌ not set')).join('\n'), ['crypto', 'bank', 'remitly'].map(k => [{ text: (db.pay[k] ? '✅ ' : '') + PAYNAME[k], callback_data: 'b:d:' + k }]).concat([[{ text: '⬅️ BACK', callback_data: 'b:home' }]]));
  if (d.indexOf('b:d:') === 0) { const k = d.slice(4); if (!PAYNAME[k]) return; wait[id] = { what: 'paydetail', which: k }; return edit('<b>' + PAYNAME[k] + ' details</b>\n\nSend exactly what a buyer should read. Address, amount, network, and ask for the screenshot.'); }
  if (d === 'b:photos') return edit('<b>TIER PHOTOS</b>\n\n' + tiers().map(t => (db.photos[t.id] ? '✅ ' : '❌ ') + t.label).join('\n') + '\n\n<b>Send me a photo with the tier name as the caption.</b>', bossMenu());
  if (d === 'b:all') { wait[id] = { what: 'all' }; return edit('Type the message for everyone, then send.'); }
  if (d === 'b:backup') return say(chat, '💾 <b>BACKUP</b>\n\n<code>' + e(JSON.stringify({ price: db.price, pay: db.pay, photos: db.photos, stock: db.stock, appeal: db.appeal, redirect: db.redirect })) + '</code>\n\nSent here by /restore.');
  if (d === 'b:ban') return edit('<b>IF YOU GET BLOCKED</b>\n\n<b>1. New account bio:</b>\n<i>' + e(db.redirect) + '</i>\n\n<b>2. Everyone:</b> use EVERYONE and paste that.\n\n<b>3. Appeal:</b>\n<i>' + e(db.appeal) + '</i>', { inline_keyboard: [[{ text: '✏️ EDIT APPEAL', callback_data: 'b:ap' }, { text: '✏️ EDIT NOTICE', callback_data: 'b:rd' }], [{ text: '⬅️ BACK', callback_data: 'b:home' }]] });
  if (d === 'b:ap') { wait[id] = { what: 'appeal' }; return edit('Send the appeal wording you want instead.'); }
  if (d === 'b:rd') { wait[id] = { what: 'redirect' }; return edit('Send the wording for the new-account bio instead.'); }
  if (d === 'b:open') {
    const open = Object.values(db.orders).filter(o => o.state === 'new' || o.state === 'taken' || o.state === 'sent').sort((a, b) => a.when - b.when);
    if (!open.length) return edit('Nothing open. Everything is closed out.', bossMenu());
    return edit('<b>OPEN ORDERS</b>\n\nTap one to look.', open.slice(0, 10).map(o => [{ text: o.code + ' · ' + (STEPS[o.state] || '') + ' · ' + (o.name || '').slice(0, 18), callback_data: 'view:' + o.code }]).concat([[{ text: '⬅️ BACK', callback_data: 'b:home' }]]));
  }
  if (d.indexOf('view:') === 0) { const o = db.orders[d.slice(5)]; if (!o) return say(chat, 'Not in memory.'); const t = tierOf(o.tier); return edit('🧾 <b>' + e(o.code) + '</b>\n\n' + e(t.label) + ' - ' + money(o.price) + '\n👤 ' + e(o.name) + '\n📍 ' + e(o.addr) + '\n💳 ' + e(PAYNAME[o.how] || '') + '\n\n<b>' + (STEPS[o.state] || '').toUpperCase() + '</b>', { inline_keyboard: [[{ text: '✅ MONEY IN', callback_data: 'o:' + o.code + ':taken' }, { text: '📮 POSTED', callback_data: 'o:' + o.code + ':sent' }], [{ text: '📦 DELIVERED', callback_data: 'o:' + o.code + ':done' }, { text: '✖️ CANCEL', callback_data: 'o:' + o.code + ':gone' }], [{ text: '⬅️ BACK', callback_data: 'b:open' }]] }); }
}
async function vouchIn(id, w, t, chat) {
  wait[id] = null;
  const p = db.people[id];
  const name = (p && p.name) || 'a buyer';
  const o = w.code ? db.orders[w.code] : null;
  if (GROUP) await api('sendMessage', { chat_id: GROUP, text: '⭐ <b>VOUCH</b>\n“' + e(t) + '”\n<i>' + e(name) + (o ? ' · ' + e(o.code) : '') + '</i>', parse_mode: 'HTML' });
  return say(chat, 'Thank you 🙏 Its in the group now.');
}

let BOTNAME = ''; let pos = 0; let lastBeat = now(); let started = 0;

async function loop() {
  for (;;) {
    try {
      const r = await fetch(API + '/getUpdates?timeout=30&offset=' + pos, { signal: AbortSignal.timeout(45000) });
      const j = await r.json();
      if (j && j.ok) {
        for (const u of j.result || []) {
          pos = u.update_id + 1;
          try { if (u.message) await incoming(u.message); if (u.callback_query) await tapped(u.callback_query); }
          catch (err) { console.error('update: ' + err.message); }
        }
        lastBeat = now();
      } else { await new Promise(s => setTimeout(s, 1500)); }
    } catch { await new Promise(s => setTimeout(s, 2000)); }
  }
}

setInterval(() => {
  if (now() - lastBeat > 120000) { console.log('poll stalled, restarting'); lastBeat = now(); busySend = false; loop(); }
}, 45000);

setInterval(() => { try { scan(); } catch (err) { console.error('scan: ' + err.message); } }, 60000);

function beat() {
  const h = new Date().getHours();
  if (h !== db.digest && h === 21) { db.digest = h; keep(); try { digest(); } catch {} }
  if (h !== 21 && db.digest !== h) { }
}
setInterval(beat, 300000);

(async () => {
  const me = await api('getMe');
  if (!me || !me.ok) { console.error('bad token'); process.exit(1); }
  BOTNAME = me.result.username;

  await api('setMyCommands', { commands: [
    { command: 'start', description: 'Menu' },
    { command: 'orders', description: 'Your orders' },
    { command: 'id', description: 'Chat id' }
  ]});

  restoring = true; const had = await loadState(); restoring = false;
  if (had) firstBoot = false; else if (!BOSS[0]) firstBoot = false;

  http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(started ? 'ok' : 'booting');
  }).listen(process.env.PORT || 3000);

  started = now();
  console.log('v' + VERSION + ' up @' + BOTNAME + ' boss=' + (BOSS.join(',') || 'none') + ' group=' + (GROUP || 'none') + ' restored=' + had);

  if (!had && BOSS[0]) {
    await say(BOSS[0], '⚠️ <b>Settings were reset by that deploy.</b>\n\nPrices, payment details, photos and stock have gone back to defaults.\n\nIf you have a /backup line, send /restore then paste it. If not, set the payment details again with /setpay.');
  }
  if (BOSS[0]) await say(BOSS[0], '✅ <b>Bot online</b> v' + VERSION + '\n\n' + (had ? 'Settings recovered.' : 'No saved settings found.') + '\n\nTap /start for the panel.');

  loop();
})();
