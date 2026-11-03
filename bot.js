'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error('No BOT_TOKEN'); process.exit(1); }
const API = 'https://api.telegram.org/bot' + TOKEN;
const BOSS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const GROUP = process.env.GROUP_ID || '';
const DB = path.join(__dirname, 'data.json');

const boss = id => BOSS.includes(String(id));
const e = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = n => '£' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '');

const TIERS = [
  { id: 't1', label: 'STARTER', price: 200, cash: '2,500' },
  { id: 't2', label: 'STANDARD', price: 350, cash: '5,000' },
  { id: 't3', label: 'PRO', price: 500, cash: '8,000' },
  { id: 't4', label: 'ELITE', price: 700, cash: '12,000' }
];

const HOWTO = '<b>HOW TO CASH OUT</b>\n\n1. Insert ATM card\n2. Select the language\n3. Enter 4 digit PIN\n4. Select your transaction\n5. Select your account\n6. Enter the withdrawal amount\n7. Collect the cash\n8. Take a printed receipt\n\n<b>Only do responsible carding.</b>';

const fresh = () => ({
  price: { t1: 200, t2: 350, t3: 500, t4: 700 },
  out: {}, busy: false, people: {}, orders: [],
  appeal: 'Hi, my account was restricted for duplicate content. I make all my own posts. Please review - I think this was a mistake. Thanks.',
  redirect: 'Account blocked. Still selling, same person. Message me here @yourbackup'
});

let db;
try { db = Object.assign(fresh(), JSON.parse(fs.readFileSync(DB, 'utf8'))); } catch { db = fresh(); }
let writing = false;
const keep = () => { if (writing) return; writing = true; setTimeout(() => {
  writing = false;
  try { fs.writeFileSync(DB + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(DB + '.tmp', DB); } catch {}
}, 300); };

const q = []; let busySend = false;
const say = (to, text, extra) => new Promise(r => { q.push({ to, text, extra, r }); pump(); });
async function pump() {
  if (busySend || !q.length) return; busySend = true;
  while (q.length) {
    const j = q.shift();
    try { j.r(await api('sendMessage', { chat_id: j.to, text: j.text, parse_mode: 'HTML', disable_web_page_preview: true, ...(j.extra || {}) })); }
    catch { j.r(null); }
    await new Promise(r => setTimeout(r, 80 + Math.random() * 120));
  }
  busySend = false;
}
async function api(method, body) {
  const r = await fetch(API + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}

const tiers = () => TIERS.map(t => ({ ...t, price: db.price[t.id] }));
const newCode = () => { let c; do { c = 'ND-' + Math.floor(1000 + Math.random() * 8999); } while (db.orders.some(o => o.code === c)); return c; };
const getOrder = c => db.orders.find(o => o.code === c);
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');

const menu = () => ({ inline_keyboard: [
  [{ text: '🛒  ORDER NOW', callback_data: 'shop' }],
  [{ text: '💷  PRICES', callback_data: 'prices' }],
  [{ text: '📖  HOW TO USE IT', callback_data: 'how' }],
  [{ text: '📦  POSTAGE & PAYMENT', callback_data: 'info' }],
  [{ text: '⭐  VOUCHES', callback_data: 'vouch' }]
]});

const bossMenu = () => ({ inline_keyboard: [
  [{ text: '💰  MY PRICES', callback_data: 'b:prices' }],
  [{ text: '📦  SOLD OUT', callback_data: 'b:out' }],
  [{ text: db.busy ? '✅  BACK ON' : '🛑  TAKE A BREAK', callback_data: 'b:busy' }],
  [{ text: '📣  MESSAGE EVERYONE', callback_data: 'b:all' }],
  [{ text: '📊  HOW MANY TODAY', callback_data: 'b:count' }],
  [{ text: '🚨  ACCOUNT GOT BLOCKED', callback_data: 'b:ban' }]
]});

const wait = {};
const openLine = () => '👋 <b>Never Dark</b>\n\nClone cards. Blank, verified, works in any ATM.\n\n<b>Tap what you want 👇</b>';

async function incoming(m) {
  const id = String(m.from.id);
  const p = db.people[id];
  const t = (m.text || '').trim();
  if (!t) return;

  const w = wait[id];
  if (w) {
    if (w.what === 'name') { wait[id] = { what: 'addr', tier: w.tier }; return say(id, 'Got it. Now your <b>full postal address</b> with postcode.'); }
    if (w.what === 'addr') { wait[id] = { what: 'pay', tier: w.tier, name: t }; return say(id, '<b>How are you paying?</b>', { inline_keyboard: [
      [{ text: '₿  Crypto', callback_data: 'pay:crypto' }],
      [{ text: '🏦  Bank transfer', callback_data: 'pay:bank' }],
      [{ text: '💸  Remitly', callback_data: 'pay:remitly' }]
    ]}); }
    if (w.what === 'voucher') { wait[id] = null; if (GROUP) say(GROUP, '⭐ <b>Vouch</b>\n“' + e(t) + '”\n<i>' + e(p ? p.name : 'buyer') + '</i>'); return say(id, 'Thank you 🙏'); }
    if (w.what === 'price') {
      wait[id] = null;
      const n = parseFloat(t.replace(/[^0-9.]/g, ''));
      if (isNaN(n)) return say(id, 'Just the number please. Like 250');
      db.price[w.which] = n; keep();
      return say(id, '✅ Now <b>' + money(n) + '</b>', bossMenu());
    }
    if (w.what === 'all') {
      wait[id] = null;
      const all = Object.keys(db.people).filter(x => !db.people[x].blocked);
      say(id, 'Sending to ' + all.length + '...');
      let ok = 0;
      for (const x of all) { if (await say(x, t)) ok++; }
      return say(id, '✅ Sent to ' + ok);
    }
  }

  if (boss(id) && t === '/admin') return say(id, '<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());

  if (t.indexOf('/start') === 0) {
    if (!p) {
      db.people[id] = { id, name: m.from.first_name || 'buyer', credit: 0, blocked: false };
      const ref = (t.split(' ')[1] || '');
      if (ref.indexOf('ref_') === 0 && db.people[ref.slice(4)]) {
        db.people[ref.slice(4)].credit = (db.people[ref.slice(4)].credit || 0) + 1;
        say(ref.slice(4), '👥 Someone joined on your link. £1 credit for you.');
      }
      keep();
    }
    if (db.people[id].blocked) return say(id, 'You are on the list. Message the main account.');
    if (boss(id)) return say(id, '<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());
    return say(id, openLine(), menu());
  }
  if (t === '/id') return say(id, 'Chat id: <code>' + m.chat.id + '</code>');
  if (boss(id) && t === '/broadcast') return say(id, 'Use /admin then MESSAGE EVERYONE.');
  if (!p) return;

  if (/^ND-\d{4}$/i.test(t)) {
    const o = getOrder(t.toUpperCase());
    return say(id, o ? o.code + ' - ' + o.label + '\n\nStatus: <b>' + o.state + '</b>' : 'No order with that number.');
  }
  say(id, 'Tap below 👇', menu());
}

async function tapped(cb) {
  const id = String(cb.from.id);
  const d = cb.data || '';
  const p = db.people[id];
  const isBoss = boss(id);
  const edit = (text, kb) => api('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text, parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  api('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

  if (d === 'prices') return edit('<b>PRICES</b>\n\n' + tiers().map(t => '<b>' + t.label + '</b> - ' + money(t.price) + (db.out[t.id] ? '  ❌ SOLD OUT' : '') + '\n<i>cashes out ' + t.cash + '</i>').join('\n\n') + '\n\nAll posted out. Pay by crypto, bank or Remitly.', menu());
  if (d === 'how') return edit(HOWTO, menu());
  if (d === 'vouch') return edit('<b>VOUCHES</b>\n\nReal feedback goes up in the group. We do not chase reviews.', menu());
  if (d === 'info') return edit('<b>POSTAGE</b>\n\nPosted out tracked, next working day.\n\n<b>PAYMENT</b>\n\nCrypto, bank transfer or Remitly. Details sent the second you order.\n\n<b>AFTER PAYING</b>\n\nCard and PIN out same day. Then follow <b>How to use it</b>.', menu());
  if (d === 'menu') return edit(openLine(), menu());
  if (d === 'shop') return p && edit('<b>PICK YOUR TIER</b>\n\n<b>Tap one 👇</b>', { inline_keyboard: tiers().map(t => [{ text: t.label + ' - ' + money(t.price) + (db.out[t.id] ? ' ❌' : ''), callback_data: 'pick:' + t.id }]).concat([[{ text: '⬅️  BACK', callback_data: 'menu' }]]) });

  if (d.indexOf('pick:') === 0) {
    const t = tiers().find(x => x.id === d.slice(5));
    if (!p || !t) return;
    if (db.out[t.id]) return say(cb.message.chat.id, t.label + ' is sold out right now.');
    wait[id] = { what: 'name', tier: t.id };
    return edit('<b>' + t.label + ' - ' + money(t.price) + '</b>\nCashes out <b>' + t.cash + '</b>\n\n<b>Send your full name.</b>', { inline_keyboard: [[{ text: '⬅️  BACK', callback_data: 'shop' }]] });
  }

  if (d.indexOf('pay:') === 0) {
    const w = wait[id];
    if (!w || w.what !== 'pay') return;
    wait[id] = null;
    const howName = d.slice(4) === 'crypto' ? 'Crypto' : d.slice(4) === 'bank' ? 'Bank transfer' : 'Remitly';
    const t = tiers().find(x => x.id === w.tier);
    const o = { code: newCode(), who: id, name: w.name, tier: w.tier, label: t.label, price: t.price, address: w.addr, how: howName, state: 'new', when: Date.now() };
    db.orders.push(o); keep();
    await say(id, '✅ <b>ORDER ' + o.code + '</b>\n\n' + t.label + ' - ' + money(t.price) + '\nBy <b>' + howName + '</b>\n\nPayment details coming now. Send proof once paid and it goes out same day.');
    if (GROUP) say(GROUP, '🔔 <b>NEW ORDER ' + o.code + '</b>\n\n' + e(t.label) + ' - <b>' + money(t.price) + '</b>\n👤 ' + e(o.name) + '\n📍 ' + e(o.address) + '\n💳 ' + e(howName) + '\n\n<b>TAP WHAT IS HAPPENING 👇</b>', {
      reply_markup: { inline_keyboard: [
        [{ text: '✅  TAKE IT', callback_data: 'o:' + o.code + ':taken' }],
        [{ text: '📮  POSTED', callback_data: 'o:' + o.code + ':sent' }],
        [{ text: '📦  DELIVERED', callback_data: 'o:' + o.code + ':done' }],
        [{ text: '✖️  CANCEL', callback_data: 'o:' + o.code + ':gone' }]
      ] }
    });
    return;
  }

  if (d.indexOf('o:') === 0 && isBoss) {
    const parts = d.split(':');
    const o = getOrder(parts[1]);
    const state = parts[2];
    if (!o) return;
    o.state = state; keep();
    if (state === 'taken') say(o.who, '✅ <b>' + o.code + '</b> - payment confirmed, packing now.');
    if (state === 'sent') say(o.who, '📮 <b>' + o.code + '</b> - posted. Card and PIN on the way.');
    if (state === 'gone') say(o.who, '✖️ <b>' + o.code + '</b> - cancelled.');
    if (state === 'done') say(o.who, '📦 <b>' + o.code + '</b> - delivered 🙏 Any problems, message me.', { reply_markup: { inline_keyboard: [[{ text: '⭐  LEAVE A VOUCH', callback_data: 'vouchit' }]] } });
    const next = state === 'taken' ? [['📮  POSTED', 'sent'], ['✖️  CANCEL', 'gone']] : state === 'sent' ? [['📦  DELIVERED', 'done'], ['✖️  CANCEL', 'gone']] : [];
    const kb = next.length ? { inline_keyboard: next.map(x => [{ text: x[0], callback_data: 'o:' + o.code + ':' + x[1] }]) } : { inline_keyboard: [] };
    return api('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: cb.message.text + '\n\n<b>▶  ' + state.toUpperCase() + '</b>', parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  }

  if (d === 'vouchit') { wait[id] = { what: 'voucher' }; return say(cb.message.chat.id, 'One line about it and I will post it up 🙏'); }

  if (d.indexOf('b:') !== 0 || !isBoss) return;
  const k = d.slice(2);
  if (k === 'home') return edit('<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());
  if (k === 'prices') return edit('<b>Tap the one to change 👇</b>', { inline_keyboard: tiers().map(t => [{ text: t.label + ' - ' + money(t.price), callback_data: 'b:p:' + t.id }]).concat([[{ text: '⬅️  BACK', callback_data: 'b:home' }]]) });
  if (k === 'out') return edit('<b>Tap to toggle 👇</b>', { inline_keyboard: tiers().map(t => [{ text: (db.out[t.id] ? '❌' : '✅') + ' ' + t.label, callback_data: 'b:o:' + t.id }]).concat([[{ text: '⬅️  BACK', callback_data: 'b:home' }]]) });
  if (k === 'busy') { db.busy = !db.busy; keep(); return edit(db.busy ? '🛑 <b>ON A BREAK</b>' : '✅ <b>BACK ON</b>', bossMenu()); }
  if (k === 'all') { wait[id] = { what: 'all' }; return edit('Type the message for everyone, then send.'); }
  if (k === 'count') {
    const day = new Date().setHours(0, 0, 0, 0);
    const today = db.orders.filter(o => o.when >= day);
    return edit('<b>TODAY</b>\n\nOrders: <b>' + today.length + '</b>\nDelivered: <b>' + today.filter(o => o.state === 'done').length + '</b>\nTook: <b>' + money(today.filter(o => o.state === 'done').reduce((s, o) => s + o.price, 0)) + '</b>', bossMenu());
  }
  if (k === 'ban') return edit('<b>IF YOU GET BLOCKED</b>\n\n<b>1. Bio on new account:</b>\n<i>' + e(db.redirect) + '</i>\n\n<b>2. Send to everyone:</b> MESSAGE EVERYONE, paste, send.\n\n<b>3. Appeal with:</b>\n<i>' + e(db.appeal) + '</i>', bossMenu());
  if (d.indexOf('b:p:') === 0) { const t = tiers().find(x => x.id === d.slice(4)); if (!t) return; wait[id] = { what: 'price', which: t.id }; return edit('<b>New price for ' + t.label + '?</b>\n\nJust the number. Like 250'); }
  if (d.indexOf('b:o:') === 0) {
    const t = tiers().find(x => x.id === d.slice(4));
    if (!t) return;
    db.out[t.id] = !db.out[t.id]; keep();
    return edit('<b>Tap to toggle 👇</b>', { inline_keyboard: tiers().map(x => [{ text: (db.out[x.id] ? '❌' : '✅') + ' ' + x.label, callback_data: 'b:o:' + x.id }]).concat([[{ text: '⬅️  BACK', callback_data: 'b:home' }]]) });
  }
}

let BOTNAME = ''; let pos = 0;
async function loop() {
  for (;;) {
    try {
      const j = await (await fetch(API + '/getUpdates?timeout=30&offset=' + pos)).json();
      for (const u of j.result || []) {
        pos = u.update_id + 1;
        try { if (u.message) await incoming(u.message); if (u.callback_query) await tapped(u.callback_query); }
        catch (err) { console.error(err.message); }
      }
    } catch { await new Promise(r => setTimeout(r, 2000)); }
  }
}

(async () => {
  const me = await api('getMe');
  if (!me.ok) { console.error('Token wrong'); process.exit(1); }
  BOTNAME = me.result.username;
  await api('setMyCommands', { commands: [
    { command: 'start', description: 'Menu' },
    { command: 'admin', description: 'Boss panel' },
    { command: 'id', description: 'Chat id' }
  ]});
  http.createServer((_, r) => r.end('ok')).listen(process.env.PORT || 3000);
  console.log('running @' + BOTNAME);
  loop();
})();
