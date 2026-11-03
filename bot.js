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

const fresh = () => ({
  price: { n10: 2.5, n20: 4, n50: 9 },
  out: {}, areas: ['Ancoats', 'Salford', 'City Centre', 'M4'],
  hours: [10, 22], busy: false,
  people: {}, orders: [],
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

const line = []; let busySend = false;
const say = (to, text, extra) => new Promise(r => { line.push({ to, text, extra, r }); go(); });
async function go() {
  if (busySend || !line.length) return; busySend = true;
  while (line.length) {
    const j = line.shift();
    try { j.r(await api('sendMessage', { chat_id: j.to, text: j.text, parse_mode: 'HTML', disable_web_page_preview: true, ...(j.extra || {}) })); }
    catch { j.r(null); }
    await new Promise(r => setTimeout(r, 90 + Math.random() * 120));
  }
  busySend = false;
}
async function api(method, body) {
  const r = await fetch(API + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}

const isOpen = () => { const h = new Date().getHours(); return !db.busy && h >= db.hours[0] && h < db.hours[1]; };
const stock = () => [
  { id: 'n10', name: '£10 note', price: db.price.n10 },
  { id: 'n20', name: '£20 note', price: db.price.n20 },
  { id: 'n50', name: '£50 note', price: db.price.n50 }
];
const newCode = () => { let c; do { c = 'D-' + Math.floor(10000 + Math.random() * 89999); } while (db.orders.some(o => o.code === c)); return c; };
const getOrder = c => db.orders.find(o => o.code === c);

const buyerMenu = () => ({ inline_keyboard: [
  [{ text: '🛒  ORDER NOW', callback_data: 'shop' }],
  [{ text: '💷  PRICES', callback_data: 'prices' }],
  [{ text: '📍  WHERE WE GO', callback_data: 'areas' }]
]});

const bossMenu = () => ({ inline_keyboard: [
  [{ text: '💰  MY PRICES', callback_data: 'b:prices' }],
  [{ text: '📦  SOLD OUT', callback_data: 'b:out' }],
  [{ text: '📍  WHERE I GO', callback_data: 'b:areas' }],
  [{ text: db.busy ? '✅  BACK ON' : '🛑  TAKE A BREAK', callback_data: 'b:busy' }],
  [{ text: '📣  MESSAGE EVERYONE', callback_data: 'b:all' }],
  [{ text: '📊  HOW MANY TODAY', callback_data: 'b:count' }],
  [{ text: '🚨  ACCOUNT GOT BLOCKED', callback_data: 'b:ban' }]
]});

const wait = {};

function menuText(id) {
  const p = db.people[id];
  return '👋 <b>' + e(p ? p.name : 'mate') + '</b>\n\n' + (isOpen() ? 'I am <b>OPEN</b> now. 20 to 40 mins, cash when I get there.' : 'I am <b>SHUT</b> right now. Order anyway - it goes out first thing.') + '\n\n<b>Tap what you want 👇</b>';
}

async function incoming(m) {
  const id = String(m.from.id);
  const person = db.people[id];
  const t = (m.text || '').trim();
  if (!t) return;

  const w = wait[id];
  if (w) {
    if (w.what === 'vouch') {
      const o = getOrder(w.code); wait[id] = null;
      if (o && GROUP) say(GROUP, '⭐ <b>' + e(o.name) + ' says</b>\n“' + e(t) + '”\n<i>' + o.item + ' x ' + o.qty + '</i>');
      return say(id, 'Thank you 🙏');
    }
    if (w.what === 'address') {
      wait[id] = null;
      const c = w.cart;
      const use = Math.min(person.credit || 0, c.total);
      person.credit = (person.credit || 0) - use;
      const o = { code: newCode(), who: id, name: person.name, tag: person.tag, item: c.name, qty: c.qty, total: c.total, credit: use, pay: +(c.total - use).toFixed(2), addr: t, state: 'new', when: Date.now() };
      person.orders = (person.orders || 0) + 1;
      db.orders.push(o); keep();
      await say(id, '✅ <b>DONE - YOUR NUMBER IS ' + o.code + '</b>\n\n' + o.item + ' x ' + o.qty + '\nPay when I get there: <b>' + money(o.pay) + '</b>\n\nI will message you when I am close.');
      if (GROUP) say(GROUP, '🔔 <b>NEW ORDER ' + o.code + '</b>\n\n' + e(o.item) + ' x ' + o.qty + ' = <b>' + money(o.pay) + '</b>\n👤 ' + e(o.name) + (o.tag ? ' @' + e(o.tag) : '') + '\n📍 ' + e(o.addr) + '\n\n<b>TAP WHAT IS HAPPENING 👇</b>', {
        reply_markup: { inline_keyboard: [
          [{ text: '✅  TAKE IT', callback_data: 'o:' + o.code + ':taken' }],
          [{ text: '🛵  ON MY WAY', callback_data: 'o:' + o.code + ':moving' }],
          [{ text: '📦  DELIVERED', callback_data: 'o:' + o.code + ':done' }],
          [{ text: '✖️  CANCEL', callback_data: 'o:' + o.code + ':gone' }]
        ] }
      });
      return;
    }
    if (w.what === 'price') {
      wait[id] = null;
      const n = parseFloat(t.replace(/[^0-9.]/g, ''));
      if (isNaN(n)) return say(id, 'Send just the number. Like 2.50');
      db.price[w.which] = n; keep();
      return say(id, '✅ Now <b>' + money(n) + '</b>', bossMenu());
    }
    if (w.what === 'area') { wait[id] = null; db.areas.push(t); keep(); return say(id, '✅ Added ' + e(t), bossMenu()); }
    if (w.what === 'hours') {
      wait[id] = null;
      const p = t.split(/[\s-]+/).map(Number);
      if (p.length < 2 || isNaN(p[0]) || isNaN(p[1])) return say(id, 'Send two numbers. Like 10 22');
      db.hours = [p[0], p[1]]; keep();
      return say(id, '✅ Open ' + p[0] + ' to ' + p[1], bossMenu());
    }
    if (w.what === 'all') {
      wait[id] = null;
      const all = Object.keys(db.people).filter(x => !db.people[x].blocked);
      say(id, 'Sending to ' + all.length + ' people...');
      let ok = 0;
      for (const x of all) { if (await say(x, t)) ok++; }
      return say(id, '✅ Sent to ' + ok);
    }
  }

  if (boss(id) && t === '/admin') return say(id, '<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());

  if (t.indexOf('/start') === 0) {
    if (!person) {
      db.people[id] = { id, name: m.from.first_name || 'mate', tag: m.from.username || '', credit: 0, orders: 0, blocked: false };
      const ref = (t.split(' ')[1] || '');
      if (ref.indexOf('ref_') === 0 && db.people[ref.slice(4)]) { db.people[ref.slice(4)].credit += 1; say(ref.slice(4), '👥 Someone joined on your link. £1 credit for you.'); }
      keep();
    }
    if (db.people[id].blocked) return say(id, 'You are on the list. Message the main account.');
    if (boss(id)) return say(id, '<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());
    return say(id, menuText(id), buyerMenu());
  }
  if (t === '/id') return say(id, 'Chat id: <code>' + m.chat.id + '</code>');
  if (!person) return;

  if (/^D-\d{5}$/i.test(t)) {
    const o = getOrder(t.toUpperCase());
    return say(id, o ? o.code + ' - ' + o.item + ' x ' + o.qty + '\n\nCurrently: <b>' + o.state + '</b>' : 'I cannot find that number.');
  }
  say(id, 'Tap here 👇', buyerMenu());
}

async function tapped(cb) {
  const id = String(cb.from.id);
  const d = cb.data || '';
  const person = db.people[id];
  const isBoss = boss(id);
  const edit = (text, kb) => api('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text, parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  api('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});

  if (d === 'prices') return edit('<b>MY PRICES</b>\n\n' + stock().map(i => i.name + ' - <b>' + money(i.price) + '</b>' + (db.out[i.id] ? '  ❌ SOLD OUT' : '')).join('\n') + '\n\n10 or more? Ask me for a deal.', buyerMenu());
  if (d === 'areas') return edit('<b>WHERE I GO</b>\n\n' + (db.areas.length ? db.areas.map(a => '• ' + e(a)).join('\n') : 'Message me your postcode.') + '\n\nAnywhere else, just ask.', buyerMenu());
  if (d === 'shop') return person && edit('<b>WHAT DO YOU WANT?</b>\n\n<b>Tap one 👇</b>', { inline_keyboard: stock().map(i => [{ text: i.name + ' - ' + money(i.price) + (db.out[i.id] ? '  ❌' : ''), callback_data: 'pick:' + i.id }]).concat([[{ text: '⬅️  BACK', callback_data: 'back' }]]) });
  if (d === 'back') return edit(menuText(id), buyerMenu());

  if (d.indexOf('pick:') === 0) {
    const it = stock().find(x => x.id === d.slice(5));
    if (!person || !it) return;
    if (db.out[it.id]) return say(cb.message.chat.id, it.name + ' is sold out right now.');
    return edit('<b>' + it.name + ' - ' + money(it.price) + ' each</b>\n\n<b>How many?</b>', { inline_keyboard: [
      [{ text: '1', callback_data: 'many:' + it.id + ':1' }, { text: '2', callback_data: 'many:' + it.id + ':2' }, { text: '3', callback_data: 'many:' + it.id + ':3' }],
      [{ text: '5', callback_data: 'many:' + it.id + ':5' }, { text: '10', callback_data: 'many:' + it.id + ':10' }],
      [{ text: '⬅️  BACK', callback_data: 'shop' }]
    ] });
  }
  if (d.indexOf('many:') === 0) {
    const parts = d.split(':');
    const it = stock().find(x => x.id === parts[1]);
    if (!person || !it) return;
    wait[id] = { what: 'address', cart: { name: it.name, qty: +parts[2], total: it.price * +parts[2] } };
    return edit('<b>' + parts[2] + ' x ' + it.name + ' = ' + money(it.price * +parts[2]) + '</b>\n\n<b>Now send your address.</b>\nJust type it and hit send 👇');
  }
  if (d.indexOf('vouch:') === 0) {
    const o = getOrder(d.slice(6));
    if (!o) return;
    wait[o.who] = { what: 'vouch', code: o.code };
    return say(o.who, 'Nice one 🙏 What is your area, and one line about it?');
  }

  if (d.indexOf('o:') === 0 && isBoss) {
    const parts = d.split(':');
    const code = parts[1], state = parts[2];
    const o = getOrder(code);
    if (!o) return;
    o.state = state; keep();
    if (state === 'taken') say(o.who, '✅ <b>' + o.code + '</b> - I have got it. On my way soon.');
    if (state === 'moving') say(o.who, '🛵 <b>' + o.code + '</b> - 1 minute away!');
    if (state === 'gone') say(o.who, '✖️ <b>' + o.code + '</b> - sorry, cancelled.');
    if (state === 'done') say(o.who, '✅ <b>' + o.code + '</b> - delivered. Cheers 🙏', { reply_markup: { inline_keyboard: [[{ text: '⭐  LEAVE A VOUCH', callback_data: 'vouch:' + o.code }]] } });

    const next = state === 'taken' ? [['🛵  ON MY WAY', 'moving'], ['✖️  CANCEL', 'gone']] : state === 'moving' ? [['📦  DELIVERED', 'done'], ['✖️  CANCEL', 'gone']] : [];
    const kb = next.length ? { inline_keyboard: next.map(function (p) { return [{ text: p[0], callback_data: 'o:' + o.code + ':' + p[1] }]; }) } : { inline_keyboard: [] };
    return api('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: cb.message.text + '\n\n<b>▶  ' + state.toUpperCase() + '</b>', parse_mode: 'HTML', reply_markup: kb }).catch(() => {});
  }

  if (d.indexOf('b:') !== 0 || !isBoss) return;
  const k = d.slice(2);
  if (k === 'home') return edit('<b>WHAT DO YOU WANT TO DO?</b>', bossMenu());
  if (k === 'prices') return edit('<b>Tap the one to change 👇</b>', { inline_keyboard: stock().map(i => [{ text: i.name + ' - ' + money(i.price), callback_data: 'b:p:' + i.id }]).concat([[{ text: '⬅️  BACK', callback_data: 'b:home' }]]) });
  if (k === 'out') return edit('<b>Tap to mark sold out / back in 👇</b>', { inline_keyboard: stock().map(i => [{ text: (db.out[i.id] ? '❌' : '✅') + ' ' + i.name, callback_data: 'b:o:' + i.id }]).concat([[{ text: '⬅️  BACK', callback_data: 'b:home' }]]) });
  if (k === 'areas') return edit('<b>WHERE I GO</b>\n\n' + (db.areas.map(a => '• ' + e(a)).join('\n') || 'Nothing yet') + '\n\nTap Add to put a new place on.', { inline_keyboard: [[{ text: '➕  ADD A PLACE', callback_data: 'b:addarea' }], [{ text: '⬅️  BACK', callback_data: 'b:home' }]] });
  if (k === 'busy') { db.busy = !db.busy; keep(); return edit(db.busy ? '🛑 <b>ON A BREAK</b>\n\nPeople are told you are shut.' : '✅ <b>BACK ON</b>\n\nPeople can order again.', bossMenu()); }
  if (k === 'all') { wait[id] = { what: 'all' }; return edit('Type the message you want to send to everyone, then hit send.'); }
  if (k === 'addarea') { wait[id] = { what: 'area' }; return edit('Type the place name, then hit send.'); }
  if (k === 'count') {
    const day = new Date().setHours(0, 0, 0, 0);
    const today = db.orders.filter(o => o.when >= day);
    const done = today.filter(o => o.state === 'done');
    return edit('<b>TODAY</b>\n\nOrders: <b>' + today.length + '</b>\nDelivered: <b>' + done.length + '</b>\nTook: <b>' + money(done.reduce((s, o) => s + o.pay, 0)) + '</b>\nOut now: <b>' + db.orders.filter(o => ['new', 'taken', 'moving'].indexOf(o.state) > -1).length + '</b>', bossMenu());
  }
  if (k === 'ban') return edit('<b>IF YOU GET BLOCKED</b>\n\n<b>1. Put this as your bio on the new account:</b>\n<i>' + e(db.redirect) + '</i>\n\n<b>2. Send the same thing to everyone:</b>\nTap MESSAGE EVERYONE, paste it, send.\n\n<b>3. When appealing, send this:</b>\n<i>' + e(db.appeal) + '</i>', bossMenu());
  if (d.indexOf('b:p:') === 0) { const it = stock().find(x => x.id === d.slice(4)); if (!it) return; wait[id] = { what: 'price', which: it.id }; return edit('<b>New price for ' + it.name + '?</b>\n\nSend just the number. Like 2.50'); }
  if (d.indexOf('b:o:') === 0) {
    const it = stock().find(x => x.id === d.slice(4));
    if (!it) return;
    db.out[it.id] = !db.out[it.id]; keep();
    return edit('<b>Tap to mark sold out / back in 👇</b>', { inline_keyboard: stock().map(i => [{ text: (db.out[i.id] ? '❌' : '✅') + ' ' + i.name, callback_data: 'b:o:' + i.id }]).concat([[{ text: '⬅️  BACK', callback_data: 'b:home' }]]) });
  }
}

let BOTNAME = ''; let pos = 0;
async function loop() {
  for (;;) {
    try {
      const j = await (await fetch(API + '/getUpdates?timeout=30&offset=' + pos)).json();
      const list = j.result || [];
      for (const u of list) {
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
    { command: 'start', description: 'Order' },
    { command: 'admin', description: 'Boss panel' },
    { command: 'id', description: 'Chat id' }
  ]});
  http.createServer((_, r) => r.end('ok')).listen(process.env.PORT || 3000);
  console.log('running @' + BOTNAME);
  loop();
})();
