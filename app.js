/* Dukes Production app – works offline, syncs with the Dukes Production Google Sheet when online. */
'use strict';
var API = 'https://script.google.com/macros/s/AKfycbxcD25Bdz6Fxp2HMXvTZvDrPdgKXhX8TCnLVuo6fsYE0afOHNvqRk65b0YCS-s5YIp0/exec';
var LS = { key: 'dk_key', user: 'dk_user', data: 'dk_data', queue: 'dk_queue', drafts: 'dk_drafts' };
var S = { key: '', role: '', user: '', data: null, queue: [], syncing: false, lastError: '', drafts: {} };

/* ---------- small helpers ---------- */
function $(s, el) { return (el || document).querySelector(s); }
function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast('This device is out of storage space'); } }
function pad(n) { return (n < 10 ? '0' : '') + n; }
function iso(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return iso(new Date()); }
function parse(s) { if (!s) return null; var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
function addDays(s, n) { var d = parse(s) || new Date(); d.setDate(d.getDate() + n); return iso(d); }
function nice(s) { var d = parse(s); if (!d) return s || ''; return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
function short(s) { var d = parse(s); if (!d) return s || ''; return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function monday(s) { var d = parse(s) || new Date(); var dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return iso(d); }
function bestBefore(s) { var d = parse(s); if (!d) return ''; d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1); return iso(d); }
function num(v) { return v === '' || v == null || isNaN(Number(v)) ? '' : Number(v); }
function r2(n, dp) { var f = Math.pow(10, dp == null ? 2 : dp); return Math.round(Number(n) * f) / f; }
function set(k) { var v = S.data && S.data.settings ? S.data.settings[k] : ''; return v == null ? '' : v; }
function setN(k, d) { var v = Number(set(k)); return isNaN(v) || v === 0 ? (d || 0) : v; }
function office() { return S.role === 'office'; }
function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600); }
function val(id) { var e = document.getElementById(id); if (!e) return ''; return e.type === 'checkbox' ? e.checked : e.value.trim(); }
function opt(list, sel, blank) {
  return (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (x) {
    var v = typeof x === 'object' ? x.v : x, t = typeof x === 'object' ? x.t : x;
    return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(t) + '</option>';
  }).join('');
}
function field(label, inner, cls) { return '<label class="f' + (cls ? ' ' + cls : '') + '">' + esc(label) + inner + '</label>'; }
function inp(id, v, type, extra) { return '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(v == null ? '' : v) + '"' + (type === 'number' ? ' inputmode="decimal" step="any"' : '') + (extra || '') + '>'; }
function sel(id, list, v, blank, extra) { return '<select id="' + id + '"' + (extra || '') + '>' + opt(list, v, blank) + '</select>'; }
function staffSel(id, v) { return sel(id, D().staff || [], v == null ? S.user : v, 'Choose…'); }
function D() { return S.data || {}; }
function back(to, label) { return '<a class="back noprint" href="#' + (to || 'home') + '">‹ ' + esc(label || 'Home') + '</a>'; }
function render(html) { var app = $('#app'); app.removeAttribute('data-dirty'); app.innerHTML = html; window.scrollTo(0, 0); }

/* ---------- setup & who is using it ---------- */
function boot() {
  $('#logo').src = window.LOGO || 'icon.svg';
  // the set-up code stays in the web address, so "Add to Home Screen" on an iPad/iPhone copies it across
  // (the home-screen app has its own separate storage and would otherwise say it isn't set up)
  var m = location.hash.match(/setup=([\w-]+)/) || location.search.match(/[?&]setup=([\w-]+)/);
  if (m) { localStorage.setItem(LS.key, m[1]); history.replaceState(null, '', location.pathname + '?setup=' + m[1] + '#home'); }
  S.key = localStorage.getItem(LS.key) || '';
  S.user = localStorage.getItem(LS.user) || '';
  S.jcode = localStorage.getItem('dk_jcode') || null;
  S.data = load(LS.data, null);
  S.queue = load(LS.queue, []);
  S.drafts = load(LS.drafts, {});
  S.role = S.data && S.data._role || '';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });
  $('#who').onclick = function () { location.hash = 'who'; };
  $('#sync').onclick = function () { sync(true); };
  window.addEventListener('hashchange', route);
  window.addEventListener('online', function () { sync(); });
  window.addEventListener('offline', paintSync);
  setInterval(function () { sync(); }, 120000);
  route();
  sync();
}
function paintSync() {
  var el = $('#sync'), n = S.queue.length, cls = '', txt;
  if (!navigator.onLine) { cls = 'off'; txt = 'Offline' + (n ? ' · ' + n + ' to send' : ''); }
  else if (S.syncing) { cls = 'wait'; txt = 'Syncing…'; }
  else if (S.lastError) { cls = 'err'; txt = 'Not synced'; }
  else if (n) { cls = 'wait'; txt = n + ' to send'; }
  else txt = 'Up to date';
  el.className = cls; el.innerHTML = '<span class="dot"></span>' + esc(txt);
  $('#who').textContent = S.user ? S.user.split(' ')[0] : 'Who?';
}

/* ---------- saving & syncing ---------- */
// Every save becomes an "op": applied on this device straight away, then sent to Google when there's internet.
function record(type, data, msg) {
  var op = { id: uid(), type: type, by: S.user, at: new Date().toISOString(), data: data };
  S.queue.push(op); save(LS.queue, S.queue);
  applyLocal(op, S.data); save(LS.data, S.data);
  toast(msg || (navigator.onLine ? 'Saved' : 'Saved on this device – it will send when back online'));
  sync();
  return op;
}
function sync(manual) {
  paintSync();
  if (!S.key) return;
  if (S.syncing || !navigator.onLine) { if (manual && !navigator.onLine) toast('No internet here – everything is kept on this device'); return; }
  S.syncing = true; paintSync();
  var batch = S.queue.slice(0, 25);
  if (batch.length) S.oc = {};
  var req = batch.length
    ? fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ k: S.key, ops: batch }) })
    : fetch(API + '?a=data&k=' + encodeURIComponent(S.key));
  req.then(function (r) { return r.json(); }).then(function (res) {
    S.syncing = false;
    if (!res.ok) { S.lastError = res.error || 'Error'; paintSync(); if (res.error === 'Not set up') route(); return; }
    var failed = [];
    (res.results || []).forEach(function (x) { if (!x.ok) failed.push(x); });
    var doneIds = {}; (res.results || []).forEach(function (x) { if (x.ok) doneIds[x.id] = 1; });
    S.queue = S.queue.filter(function (op) { return !doneIds[op.id]; });
    if (failed.length) { S.lastError = failed[0].error; toast('Could not save: ' + failed[0].error); S.queue = S.queue.filter(function (op) { return !failed.some(function (f) { return f.id === op.id; }); }); }
    else S.lastError = '';
    S.role = res.role; res.data._role = res.role; S.data = res.data;
    S.queue.forEach(function (op) { applyLocal(op, S.data); });
    save(LS.data, S.data); save(LS.queue, S.queue);
    paintSync();
    if (S.queue.length) return sync();
    if (manual) toast('Up to date');
    refreshIfIdle();
  }).catch(function () { S.syncing = false; S.lastError = navigator.onLine ? 'No connection' : ''; paintSync(); });
}
// Redraw lists after a sync, but never while someone is typing into a form
function refreshIfIdle() {
  var a = document.activeElement;
  if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
  var r = (location.hash || '#home').slice(1).split('/')[0];
  if (['home', 'production', 'deliveries', 'packing', 'messages', 'office', 'records', 'who'].indexOf(r) >= 0 && !$('#app').hasAttribute('data-dirty')) route();
}

// Mirror of what the Google Sheet does, so the device is right even before syncing
function applyLocal(op, data) {
  if (!data) return;
  var d = op.data || {};
  function upsertBy(list, key, obj) { var i = list.findIndex(function (x) { return String(x[key]) === String(obj[key]); }); if (i >= 0) list[i] = Object.assign({}, list[i], obj); else list.push(obj); }
  switch (op.type) {
    case 'batch': {
      data.batches = data.batches || [];
      upsertBy(data.batches, 'no', { no: String(d.no), flavour: d.flavour, date: d.date, mix: d.mix, start: d.start, temp: d.temp, hold: d.hold, cool: d.cool, end: d.end, bb: d.bb, pby: d.pby, tub: d.tub, large: d.large, small: d.small, napolis: d.napolis, tc: d.tc, sw: d.sw, lw: d.lw, label: d.label ? 'Yes' : '', tby: d.tby, comments: d.comments, status: d.status || (d.tub ? 'Tubbed' : 'Pasteurised'), lines: d.lines });
      var n = parseInt(d.no, 10); if (n && n >= Number(data.settings['Next batch number'] || 0)) data.settings['Next batch number'] = n + 1;
      if (d.flavour && (data.flavours || []).indexOf(d.flavour) < 0) (data.flavours = data.flavours || []).push(d.flavour);
      break;
    }
    case 'batchStatus': (data.batches || []).forEach(function (b) { if (String(b.no) === String(d.no)) b.status = d.status; }); break;
    case 'delivery': data.lots = data.lots || []; upsertBy(data.lots, 'id', { id: d.id, date: d.date, item: d.item, supplier: d.supplier, qty: d.qty, unit: d.unit, useBy: d.useBy, temp: d.temp, batch: d.batch, comment: d.comment, by: d.by, status: d.status || 'Open' });
      if (d.item && !(data.ingredients || []).some(function (i) { return i.name.toLowerCase() === String(d.item).toLowerCase(); })) data.ingredients.push({ name: d.item, unit: d.unit, supplier: d.supplier, track: true });
      break;
    case 'lotStatus': (data.lots || []).forEach(function (l) { if (String(l.id) === String(d.id)) l.status = d.status; }); break;
    case 'temps': data.temps = data.temps || []; (d.days || []).forEach(function (day) { upsertBy(data.temps, 'date', { date: day.date, initials: day.initials, action: day.action, readings: day.readings }); }); break;
    case 'cleaning': data.cleaning = data.cleaning || []; upsertBy(data.cleaning, 'id', { id: d.id, date: d.date, list: d.list, by: d.by, comments: d.comments, batch: d.batch, items: d.items });
      (data.due || []).forEach(function (x) { if ((x.key === 'weeklyDue' && d.list === 'Weekly') || (x.key === 'monthlyDue' && d.list === 'Monthly')) x.value = false; });
      break;
    case 'pest': data.pest = data.pest || []; upsertBy(data.pest, 'id', d); data.due = (data.due || []).filter(function (x) { return x.key !== 'pest'; }); break;
    case 'iceStock': data.iceStock = (data.iceStock || []).filter(function (x) { return x.id.indexOf(d.id + ':') !== 0; }).concat(d.counts.map(function (c) { return Object.assign({ id: d.id + ':' + c.flavour, date: d.date, by: d.by }, c); }));
      data.due = (data.due || []).filter(function (x) { return x.key !== 'stock'; }); break;
    case 'ingStock': data.ingStock = (data.ingStock || []).filter(function (x) { return x.id.indexOf(d.id + ':') !== 0; }).concat(d.counts.filter(function (c) { return c.qty !== ''; }).map(function (c) { return { id: d.id + ':' + c.ingredient, date: d.date, ingredient: c.ingredient, qty: c.qty, unit: c.unit, packs: c.packs, packSize: c.packSize, packType: c.packType, by: d.by }; }));
      d.counts.forEach(function (c) { if (c.ingredient && !data.ingredients.some(function (i) { return i.name.toLowerCase() === c.ingredient.toLowerCase(); })) data.ingredients.push({ name: c.ingredient, unit: c.unit, track: true }); });
      break;
    case 'packStock': data.packStock = data.packStock || {}; (d.counts || []).forEach(function (c) { data.packStock[c.item] = { date: d.date, qty: c.qty, rolls: c.rolls, perRoll: c.perRoll, boxes: c.boxes, perBox: c.perBox, by: d.by }; (data.packItems || []).forEach(function (i) { if (i.item === c.item && c.perBox) i.perBox = c.perBox; }); if (!(data.packItems || []).some(function (i) { return i.item === c.item; })) (data.packItems = data.packItems || []).push({ item: c.item, group: c.group, unit: c.unit, perRoll: c.perRoll }); }); break;
    case 'recipe': if (d.request) { (data.recipeRequests = data.recipeRequests || []).push({ id: op.id, date: today(), flavour: d.flavour, by: d.name, user: op.by, lines: d.lines, notes: d.notes, local: true }); break; }
      (data.flavourInfo || []).forEach(function (x) { if (x.name === d.flavour) { x.savedBy = d.name; x.savedOn = today(); } });
      if (d.notes != null) { var fi = (data.flavourInfo || []).find(function (x) { return x.name === d.flavour; }); if (fi) fi.notes = d.notes; else (data.flavourInfo = data.flavourInfo || []).push({ name: d.flavour, active: true, type: 'Limited Edition', base: true, notes: d.notes }); }
      data.recipe = (data.recipe || []).filter(function (x) { return x.flavour !== d.flavour; }).concat(d.lines.filter(function (l) { return l.ingredient; }).map(function (l) { return { flavour: d.flavour, ingredient: l.ingredient, amount: Number(l.amount) || 0, per: Number(l.per) || 0, unit: l.unit }; })); break;
    case 'pack': (data.orders || []).forEach(function (o) { if (String(o.no) === String(d.no)) { o.lines = d.lines; o.status = d.done ? 'Packed' : 'Packing'; o.packedBy = d.by; if (d.done) o.packedAt = today(); } }); break;
    case 'message': data.messages = data.messages || []; upsertBy(data.messages, 'id', { id: d.id, date: today(), from: d.from, to: d.to, text: d.text, remind: d.remind, sent: false }); break;
    case 'delete': {
      var map = { delivery: ['lots', 'id'], pest: ['pest', 'id'], cleaning: ['cleaning', 'id'], batch: ['batches', 'no'], message: ['messages', 'id'] }[d.kind];
      if (map) data[map[0]] = (data[map[0]] || []).filter(function (x) { return String(x[map[1]]) !== String(d.id); });
      break;
    }
  }
}

/* ---------- drafts: half-filled forms survive the app closing ---------- */
function keepDraft(name, obj) { S.drafts[name] = obj; save(LS.drafts, S.drafts); }
function dropDraft(name) { delete S.drafts[name]; save(LS.drafts, S.drafts); }

/* ---------- router ---------- */
var ROUTES = {};
function route() {
  paintSync();
  if (!S.key) return render(setupScreen());
  if (!S.data) { render('<div class="card center"><h2>Getting things ready…</h2><p class="muted">This device needs the internet once to download the lists. After that it works without.</p></div>'); return; }
  var parts = (location.hash || '#home').slice(1).split('/');
  if (parts[0] !== 'hours') { S.hcode = null; S.hv = null; }
  // names are now first names only – move anyone signed in under their old full name across
  var stf = (D().staff || []).map(function (x) { return typeof x === 'string' ? x : x.name; });
  if (S.user && stf.length && stf.indexOf(S.user) < 0 && stf.indexOf(S.user.split(' ')[0]) >= 0) { S.user = S.user.split(' ')[0]; localStorage.setItem(LS.user, S.user); }
  if (S.user && S.user === owner() && !S.jcode) { S.user = ''; localStorage.removeItem(LS.user); }
  if (S.user === owner() && S.jcode && !office() && !S.oTimer) ownerIdle();
  if (!S.user && parts[0] !== 'who') { location.hash = 'who'; return; }
  var fn = ROUTES[parts[0]] || ROUTES.home;
  if (parts[0] === 'office' && !isOwner() && S.user !== manager()) fn = ROUTES.home;
  try { fn.apply(null, parts.slice(1).map(decodeURIComponent)); }
  catch (e) { render('<div class="card"><h2>Something went wrong</h2><p class="muted">' + esc(e.message) + '</p><a class="btn" href="#home">Home</a></div>'); console.error(e); }
}
function setupScreen() {
  return '<div class="card center" style="max-width:560px;margin:40px auto"><h1>Welcome</h1><p>This tablet or phone isn\'t set up yet.</p>' +
    '<p class="muted">Open the set-up link Jonny sent (it ends in <b>#setup=…</b>) on this device once. After that the app works here, even with no internet.</p>' +
    '<p style="margin-top:18px"><b>Opened from the home screen?</b> Copy the set-up link from the message, paste it here and tap Set up.</p>' +
    '<input id="su_link" placeholder="Paste the set-up link" style="width:100%;margin:6px 0 10px"><button class="btn" id="su_go" type="button" onclick="setupFromPaste()">Set up</button></div>';
}
function setupFromPaste() {
  var m = String(($('#su_link') || {}).value || '').match(/setup=([\w-]+)/);
  if (!m) return toast('That doesn\'t look like the set-up link – it should end in #setup=…');
  localStorage.setItem(LS.key, m[1]); history.replaceState(null, '', location.pathname + '?setup=' + m[1] + '#home'); location.reload();
}

ROUTES.who = function () {
  render('<h1>Who is using the app?</h1><p class="muted">Tap your name. Everything you record is saved with your name.</p><div class="names">' +
    (D().staff || []).map(function (n) { return '<button data-n="' + esc(n) + '"' + (n === S.user ? ' style="border-color:#1c2140"' : '') + '>' + esc(n) + '</button>'; }).join('') + '</div>');
  $$('.names button').forEach(function (b) { b.onclick = function () {
    var n = b.dataset.n;
    if (n === owner()) return ownerSignIn();
    S.user = n; S.jcode = null; localStorage.setItem(LS.user, S.user); localStorage.removeItem('dk_jcode'); paintSync(); location.hash = 'home';
  }; });
};
// The owner's account is behind his passcode (checked by Google, so it needs the internet)
function ownerSignIn() {
  render(back('who', 'Back') + '<div class="card center" style="max-width:420px;margin:30px auto"><h1>🔒 ' + esc(owner()) + '</h1><p class="muted">Enter your passcode.</p>' +
    '<input id="o_code" type="password" inputmode="numeric" autocomplete="off" style="text-align:center;font-size:26px;letter-spacing:8px;width:200px"><br>' +
    '<button class="btn" id="o_go" style="margin-top:14px">Sign in</button><p class="muted small">Needs the internet.' + (office() ? ' This device will remember you.' : ' You\'ll be signed out after 5 minutes without use.') + '</p></div>');
  var go = function () {
    var c = val('o_code'); if (!c) return toast('Enter the passcode');
    if (!navigator.onLine) return toast('Signing in as ' + owner() + ' needs the internet');
    $('#o_go').disabled = true;
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ a: 'hours', k: S.key, code: c, op: 'check', by: owner() }) }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok || r.level !== 'pay') { $('#o_go').disabled = false; $('#o_code').value = ''; return toast(r.error || 'Wrong passcode'); }
      S.user = owner(); S.jcode = c; localStorage.setItem(LS.user, S.user);
      if (office()) localStorage.setItem('dk_jcode', c); else localStorage.removeItem('dk_jcode');
      ownerIdle(); paintSync(); location.hash = 'home';
    }).catch(function () { $('#o_go').disabled = false; toast('No connection'); });
  };
  $('#o_go').onclick = go; $('#o_code').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  setTimeout(function () { $('#o_code').focus(); }, 50);
}
// On shared tablets the owner is signed out after 5 minutes without use
function ownerIdle() {
  if (office()) return;
  clearTimeout(S.oTimer);
  S.oTimer = setTimeout(function () { if (S.user === owner() && !office()) { S.user = ''; S.jcode = null; S.own = null; localStorage.removeItem(LS.user); toast('Signed out'); location.hash = 'who'; route(); } }, 5 * 60 * 1000);
  if (!S.oWatch) { S.oWatch = true; ['click', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, function () { if (S.user === owner()) ownerIdle(); }, true); }); }
}

ROUTES.home = function () {
  var due = (D().due || []).filter(function (x) { return !x.hidden; });
  var links = { temps: 'temps', pest: 'pest', stock: 'stock', pack: 'packing' };
  var open = (D().batches || []).filter(function (b) { return b.status === 'Pasteurised'; });
  var mine = isOwner(), boss = mine || S.user === manager();
  var tiles = [];
  if (boss) tiles.push(['office', '📊', 'Office', mine ? 'Sales, stock, orders & cream' : 'Stock & what to make', true]);
  tiles.push(['production', '🍦', 'Production', open.length ? open.length + ' batch' + (open.length > 1 ? 'es' : '') + ' to tub' : 'Batch records', !boss],
    ['recipes', '📖', 'Recipes', 'Base mix & flavours'],
    ['deliveries', '🚚', 'Deliveries in', 'Goods received'],
    ['packing', '🧾', 'Shop orders', 'Pack & record batches'],
    ['stock', '🍨', 'Ice cream stock', 'Every Saturday'],
    ['packaging', '📦', 'Packaging stock', 'Lids, tubs & labels'],
    ['ingstock', '🥄', 'Ingredient stock', 'Count dry goods'],
    ['fsc', '🛡️', 'Food safety checks', 'Temps, cleaning & more'],
    ['temps', '🌡️', 'Temperatures', 'Filled in ready to check'],
    ['cleaning', '🧽', 'Cleaning', 'Daily · weekly · monthly'],
    ['pest', '🐭', 'Pest control', 'Monthly check'],
    ['messages', '✉️', 'Messages', 'Notes & reminders'],
    ['records', '🖨️', 'Records', 'View & print'],
    ['xmas', '🎄', 'Christmas orders', 'Big tub pre-orders']);
  if (mine) tiles.push(['hours', '🔒', 'Hours & pay', 'Passcode needed']);
  else if (S.user === manager()) tiles.push(['hours', '🔒', 'Staff hours', 'Passcode needed']);
  if (boss) tiles.push(['weddings', '💍', 'Weddings', 'Tubs out & in']);
  due = due.filter(function (x) { return ['pack', 'temps', 'pest'].indexOf(x.key) < 0; });
  var big = function (icon, title, sub, href, btn, ext) {
    return '<a href="' + esc(href) + '"' + (ext ? ' target="_blank"' : '') + ' style="display:flex;align-items:center;gap:14px;background:#1c2140;color:#fff;border-radius:16px;padding:18px 20px;margin:0 0 12px;text-decoration:none;font-size:18px;box-shadow:0 4px 14px rgba(28,33,64,.25)"><span style="font-size:32px">' + icon + '</span><span style="flex:1"><b>' + esc(title) + '</b><br><small style="opacity:.8;font-size:14px">' + esc(sub) + '</small></span><span style="background:#f6f2ea;color:#1c2140;border-radius:10px;padding:10px 14px;font-weight:bold;white-space:nowrap;font-size:15px">' + esc(btn) + ' ›</span></a>';
  };
  var alerts = '';
  if (mine) {
    var waiting = (S.own && S.own.insights && S.own.insights.waiting) || (D().insights && D().insights.waiting) || [];
    alerts += waiting.map(function (o) { return big('🛎️', 'New order from ' + o.shop + ' – please confirm', o.small + ' small, ' + o.large + ' large · ' + short(o.date) + ' · staff won\'t see it until you confirm', o.link, 'Check & confirm', true); }).join('');
    alerts += (D().recipeRequests || []).map(function (q) { return big('📖', q.by + ' wants to change the ' + q.flavour + ' recipe', 'Nothing changes until you approve it', '#recipes/' + encodeURIComponent(q.flavour), 'Review'); }).join('');
  }
  alerts += (D().orders || []).filter(function (o) { return o.status === 'Confirmed' || o.status === 'Packing'; }).map(function (o) {
    return big('📦', 'Shop order to pack: ' + o.shop, (o.small || 0) + ' small, ' + (o.large || 0) + ' large · ' + o.no + (o.status === 'Packing' ? ' · started' : ''), '#packing/' + encodeURIComponent(o.no), 'Pack it');
  }).join('');
  if (mine && navigator.onLine && (!S.wv || S.wvFor !== S.user || Date.now() - S.wvAt > 60000)) setTimeout(loadWed, 1500);
  if (mine && navigator.onLine && (!S.own || Date.now() - S.ownAt > 90000)) loadOwn().then(function (x) { if (x && (location.hash || '#home') === '#home' && !(waiting || []).length && (x.insights.waiting || []).length) route(); });
  var unsent = S.queue.length, fs = fscDue();
  var fsBtn = fs.length ? big('🛡️', 'Food safety checks', fs.length + ' to do: ' + fs.map(function (o) { return o[3]; }).join(' · '), '#fsc', 'Start') : '';
  render('<h1>Hello ' + esc(S.user.split(' ')[0]) + '</h1>' +
    (unsent && !navigator.onLine ? '<div class="due"><span>📶</span><span>' + unsent + ' record' + (unsent > 1 ? 's are' : ' is') + ' saved on this device and will send when there\'s internet.</span></div>' : '') +
    fsBtn + prodAlerts() + checksAlert() + xmasAlert() + alerts +
    myMessages().map(function (m) { return '<div class="due" style="background:#eef0f8;border-color:#c9cde3;color:#1c2140"><span>✉️</span><span style="flex:1"><b>' + esc(m.from) + (m.to === 'Everyone' ? ' (to everyone)' : '') + ':</b> ' + esc(m.text) + ' <span class="muted small">' + esc(short(m.remind || m.date)) + '</span></span><button class="btn soft sm" data-seen="' + esc(m.id) + '">✓ Seen</button></div>'; }).join('') +
    todoHtml(due, links) +
    '<div class="tiles" style="margin-top:14px">' + tiles.map(function (t) {
      return '<a class="tile' + (t[4] ? ' dark' : '') + '" href="#' + t[0] + '"><span class="ic">' + t[1] + '</span><span><b>' + esc(t[2]) + '</b><br><small>' + esc(t[3]) + '</small></span></a>';
    }).join('') + '</div>' +
    '<p class="muted center" style="margin-top:28px">Last updated from Google: ' + (D().at ? new Date(D().at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'never') + '</p>');
  wireProdAlerts();
  $$('[data-seen]').forEach(function (b) { b.onclick = function () { var s = load('dk_seen', []); s.push(b.dataset.seen); save('dk_seen', s.slice(-200)); route(); }; });
  $$('[data-ordered]').forEach(function (b) { b.onclick = function (ev) { ev.preventDefault(); record('ordered', { id: b.dataset.ordered, by: S.user }, 'Marked as ordered'); D().toOrder = (D().toOrder || []).filter(function (o) { return o.id !== b.dataset.ordered; }); save(LS.data, S.data); route(); }; });
};
// The "To do" board: what needs doing, for everyone
function todoHtml(due, links) {
  var T = D().todo || {}, boss = isOwner() || S.user === manager(), items = [];
  var row = function (icon, html, href, extra) { return '<a class="row" href="' + (href || '#home') + '" style="text-decoration:none"><span style="display:flex;gap:10px;align-items:center"><span style="font-size:20px">' + icon + '</span><span>' + html + '</span></span>' + (extra || '') + '</a>'; };
  due.forEach(function (x) { items.push(row('⏰', esc(x.text), '#' + (links[x.key] || 'home'))); });
  (T.make || []).forEach(function (f, i) { items.push(row('🍦', (i ? 'Then make ' : 'Make next: ') + '<b>' + esc(f) + '</b> (' + setN('Standard order litres', 300) + ' L)', '#production')); });
  (T.weddings || []).forEach(function (w) { items.push(row('💍', 'Wedding ' + esc(short(w.date)) + (w.flavours && w.flavours.length ? ' – keep aside: <b>' + esc(w.flavours.join(', ')) + '</b>' : ' – flavours not chosen yet'), boss ? '#weddings' : '#home')); });
  (T.rotation || []).forEach(function (b) { items.push(row('⏳', 'Batch ' + esc(b.no) + ' ' + esc(b.flavour) + ' has been in stock ' + b.months + ' months – use it first', '#packing')); });
  (D().toOrder || []).forEach(function (o) { items.push(row('🛒', 'To order: <b>' + esc(o.item) + '</b>' + (o.by ? ' <span class="muted small">(' + esc(o.by.split(' ')[0]) + ')</span>' : ''), '#ingstock', boss && o.id ? '<button class="btn soft sm" data-ordered="' + esc(o.id) + '">Ordered ✓</button>' : '')); });
  if (isOwner() && S.own && S.own.dash) (S.own.dash.jtodo || []).filter(function (x) { return x.due && x.due <= addDays(today(), 7); }).forEach(function (x) { items.push(row(x.due < today() ? '❗' : '✅', '<b>' + esc(x.item) + '</b> <span class="muted small">(' + esc(short(x.due)) + ', only you see this)</span>', '#jtodo')); });
  if (isOwner() && S.own && S.own.dash) (S.own.dash.lapsed || []).forEach(function (s) { items.push(row('🛎️', '<b>' + esc(s.shop) + '</b> hasn\'t ordered for ' + s.days + ' days (usually every ' + s.usual + ')', '#office')); });
  if (!items.length) return '';
  return '<div class="card" style="margin-top:6px"><h2 style="margin-bottom:6px">📋 To do</h2><div class="list">' + items.join('') + '</div></div>';
}
// Notes for the person using the app: to them by first name, to Both (Jonny & Paul) or to Everyone, from the last 14 days
function myMessages() {
  var first = (S.user || '').split(' ')[0].toLowerCase(), seen = load('dk_seen', []), t = today(), from = addDays(t, -14);
  var boss = S.user === owner() || S.user === manager();
  return (D().messages || []).filter(function (m) {
    var to = String(m.to || '').toLowerCase(), when = m.remind || m.date;
    var mine = to === 'everyone' || to === first || (boss && /both|all/.test(to));
    return mine && seen.indexOf(m.id) < 0 && when <= t && when >= from && String(m.from || '').toLowerCase() !== (S.user || '').toLowerCase();
  }).slice(-6).reverse();
}

/* ---------- production: batch records ---------- */
function lotsFor(name) {
  var n = String(name || '').toLowerCase();
  // batches entered on the stock page come first (they're what's already on the shelf), then deliveries
  var st = null; Object.keys(D().stockLots || {}).forEach(function (k) { if (k.toLowerCase() === n) st = D().stockLots[k]; });
  var shelf = ((st && st.lots) || []).map(function (l, i) { return { id: 'stock' + i, date: st.date, item: name, batch: l.batch || '', useBy: l.bb || '', status: 'Open', stock: true }; });
  var all = shelf.concat((D().lots || []).filter(function (l) { return l.status !== 'Finished' && String(l.item || '').toLowerCase() === n; }));
  // the same batch number entered twice (stock page + delivery) only counts once
  var seen = {}; all = all.filter(function (l) { var k = String(l.batch || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (!k) return true; if (seen[k]) return false; seen[k] = 1; return true; });
  // oldest best before / use by first (no date last), then what's on the shelf, then oldest delivery
  var bb = function (l) { return /^\d{4}-\d{2}-\d{2}$/.test(l.useBy || '') ? l.useBy : '9999'; };
  return all.sort(function (a, b) { return bb(a) !== bb(b) ? (bb(a) < bb(b) ? -1 : 1) : (a.stock !== b.stock ? (a.stock ? -1 : 1) : (a.date < b.date ? -1 : 1)); });
}
// on the recipe: which batch to use first when there's more than one, and anything with no best before
function useFirst(ing) {
  var lots = lotsFor(ing), out = '';
  var d = function (x) { var p = parse(x); return p ? p.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : ''; };
  var full = function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x || ''); };
  var box = function (html) { return '<tr><td colspan="3" style="padding:0 6px 8px"><div style="background:#fdecea;border-left:4px solid #b3261e;border-radius:6px;padding:6px 8px;font-size:14px">' + html + '</div></td></tr>'; };
  if (lots.length > 1) out += box('⚠ <b>Use the oldest first:</b> ' + lots.map(function (l, i) {
    var t = (l.batch ? 'batch ' + esc(l.batch) : 'no batch no.') + (full(l.useBy) ? ' (BB ' + esc(d(l.useBy)) + ')' : ' <b>(no best before)</b>');
    return i === 0 ? '<b style="color:#b3261e">1st ' + t + '</b>' : (i + 1) + (i === 1 ? 'nd' : i === 2 ? 'rd' : 'th') + ' ' + t; }).join(' → '));
  if (!/sugar|salt/i.test(ing)) {
    var noBB = lots.filter(function (l) { return !full(l.useBy); });
    if (!lots.length) out += box('⚠ <b>Check ' + esc(ing) + '</b> – no batch number or best before is recorded. Check the label.');
    else if (noBB.length) out += box('⚠ <b>Check ' + esc(ing) + '</b>' + noBB.map(function (l) { return l.batch ? ' (batch ' + esc(l.batch) + ')' : ''; }).join('') + ' – no best before recorded' + noBB.filter(function (l) { return l.useBy; }).map(function (l) { return ' (only "' + esc(l.useBy) + '" – no year?)'; }).join('') + '. Check the label.');
  }
  return out;
}
function isDairy(n) { return /milk|cream/i.test(n) && !/powder/i.test(n); }
function rq(n, q) { return q === '' || q == null || isNaN(Number(q)) ? q : isDairy(n) ? Math.round(Number(q)) : r2(Number(q), 3); }
function inBase(q, u) { u = String(u || '').toLowerCase(); q = Number(q) || 0; return u === 'g' || u === 'ml' ? q / 1000 : q; }
function byAmount(a, b) { return inBase(b.qty != null ? b.qty : b.amount, b.unit) - inBase(a.qty != null ? a.qty : a.amount, a.unit); }
function owner() { return set('Owner name') || 'Jonny'; }
// Past batches: only Jonny, or Paul once he has entered his passcode
function canPast() { return office() || isOwner() || (S.user === manager() && mgrOK()); }
function pastBatches() { return office() ? (D().batches || []) : (S.allB || []); }
function loadPast() {
  if (office() || !navigator.onLine) return Promise.resolve(null);
  if (S.allB && Date.now() - S.allBAt < 120000 && S.allBFor === S.user) return Promise.resolve(S.allB);
  var p = isOwner() ? ownerCall({ op: 'batches' }) : mgrCall({ op: 'batches' });
  return p.then(function (r) { if (r.ok) { S.allB = r.batches; S.allBAt = Date.now(); S.allBFor = S.user; } return S.allB; }).catch(function () { return null; });
}
// Overrun for a batch (Jonny only): from the tubs made, and from tub weights
function overrun(b) {
  var SL = setN('Small tub ml', 150) / 1000, LL = setN('Large tub ml', 500) / 1000, NL = setN('Napoli litres', 5), dens = setN('Mix weight per litre (kg)', 1.1), o = {};
  var has = function (v) { return v !== '' && v != null; }, mix = Number(b.mix) || 0;
  if (mix && (has(b.small) || has(b.large))) { var ic = (Number(b.small) || 0) * SL + (Number(b.large) || 0) * LL + (Number(b.napolis) || 0) * NL; if (ic) o.yield = Math.round((ic - mix) / mix * 100); }
  var ws = [], net = function (g, k) { return has(g) && Number(g) > 0 ? Number(g) - (Number(set(k)) || 0) : 0; };
  var ns = net(b.sw, 'Empty small tub weight (g)'), nl = net(b.lw, 'Empty large tub weight (g)');
  if (ns > 0) ws.push((dens * SL * 1000 - ns) / ns * 100); if (nl > 0) ws.push((dens * LL * 1000 - nl) / nl * 100);
  if (ws.length) o.weight = Math.round(ws.reduce(function (a, x) { return a + x; }, 0) / ws.length);
  return o;
}
function isOwner() { return S.user === owner() && !!S.jcode; }
// Weights over 10 kg show in kg, under in grams. Milk and cream in whole litres.
function disp(n, q, u) {
  if (q === '' || q == null || isNaN(Number(q))) return { q: q, unit: u };
  var lu = String(u || '').toLowerCase(); q = Number(q);
  if (lu === 'g' || lu === 'kg') { var g = lu === 'kg' ? q * 1000 : q; return g > 10000 ? { q: r2(g / 1000, 3), unit: 'kg' } : { q: g > 0 && g < 1 ? r2(g, 1) : Math.round(g), unit: 'g' }; }
  return { q: rq(n, q), unit: u };
}
function perOf(l) { return Number(l.per) || setN('Base mix litres', 300); }
// Jonny's pages that only read: the answer is kept for a few minutes so going back to a page is instant.
// Anything saved (on this device or by Jonny) clears the kept answers.
var OREAD = { totals: 1, shop: 1, finance: 1, xmas: 1, weddings: 1, batches: 1, shopsum: 1 };
function ownerCall(body) {
  var key = OREAD[body.op] && !body.d ? body.op : null;
  S.oc = S.oc || {};
  if (key && S.oc[key] && Date.now() - S.oc[key].t < 300000) return S.oc[key].p;
  if (!key && body.op && body.op !== 'office' && body.op !== 'fspack') S.oc = {};
  var p = fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ a: 'owner', k: S.key, code: S.jcode }, body)) }).then(function (r) { return r.json(); });
  if (key) { var c = S.oc[key] = { t: Date.now(), p: p }; p.then(function (x) { if (!x || !x.ok) { if (S.oc[key] === c) delete S.oc[key]; } }, function () { if (S.oc[key] === c) delete S.oc[key]; }); }
  return p;
}
// get Jonny's other pages ready in the background once the office figures are in
function ownPrefetch() {
  if (!isOwner() || !navigator.onLine || Date.now() - (S.pfAt || 0) < 600000) return;
  S.pfAt = Date.now();
  ['totals', 'shop', 'finance', 'xmas', 'weddings'].forEach(function (op, i) { setTimeout(function () { if (isOwner()) ownerCall({ op: op }).catch(function () { }); }, 1500 + i * 400); });
}
// Jonny's office figures (sales, stock history, orders to confirm) – fetched with his passcode, never stored on the device
function loadOwn(force) {
  if (!isOwner() || !navigator.onLine) return Promise.resolve(S.own || null);
  if (!force && S.own && Date.now() - S.ownAt < 90000) return Promise.resolve(S.own);
  if (S.ownP) return S.ownP;
  S.ownP = ownerCall({ op: 'office' }).then(function (r) { S.ownP = null; if (r.ok) { S.own = r; S.ownAt = Date.now(); ownPrefetch(); } return S.own || null; }).catch(function () { S.ownP = null; return S.own || null; });
  return S.ownP;
}
function manager() { return set('Hours manager name') || 'Paul'; }
function usesBase(f) { var i = (D().flavourInfo || []).find(function (x) { return x.name === f; }); return !i || i.base; }
function recipeLines(flavour, mix) {
  var m = Number(mix) || 0;
  var wb = usesBase(flavour);
  return (D().recipe || []).filter(function (r) { return (wb && r.flavour === 'All flavours (base mix)') || r.flavour === flavour; }).map(function (r) {
    var lot = lotsFor(r.ingredient)[0], d = disp(r.ingredient, m ? r.amount / perOf(r) * m : '', r.unit);
    return { ingredient: r.ingredient, qty: m ? d.q : '', unit: d.unit, batch: lot ? lot.batch : '', useBy: lot ? lot.useBy : '' };
  }).sort(byAmount);
}
/* ---------- the recipe card shown when a batch is started ---------- */
function fmtN(n) { n = Number(n); var w = Math.floor(n + 1e-9), f = n - w; var fr = Math.abs(f - 0.5) < 0.01 ? '½' : Math.abs(f - 0.25) < 0.01 ? '¼' : Math.abs(f - 0.75) < 0.01 ? '¾' : ''; return fr ? (w ? w : '') + fr : String(r2(n, 2)); }
function plural(n, w) { return Number(n) === 1 || !w ? w : /(ch|sh|x|s)$/.test(w) ? w + 'es' : w + 's'; }
function wt(q, u) { var lu = String(u).toLowerCase(); if (lu === 'kg' && q < 1) return Math.round(q * 1000) + ' g'; if (lu === 'g' && q >= 1000) return r2(q / 1000, 3) + ' kg'; return (lu === 'kg' || lu === 'l' ? r2(q, 3) : Math.round(q)) + ' ' + u; }
// "36 kg – 12 × 3 kg tubs", "12 kg – 4 buckets", "4.8 kg – 1 bucket + 1.8 kg"
function packText(name, q, unit) {
  var ing = (D().ingredients || []).find(function (i) { return String(i.name).toLowerCase() === String(name).toLowerCase(); }) || {};
  var lu = String(unit || '').toLowerCase(), iu = String(ing.unit || unit || '').toLowerCase();
  // cream and milk: whole jars / boxes, then the exact litres still to pour – any extra ordered isn't part of the recipe
  var lit = function (x) { return (Math.round(x * 10) / 10) + ' L'; };
  if (/cream/i.test(name) && !/powder/i.test(name) && lu === 'l') { var cl = setN('Cream pack litres', 4), j = Math.floor(q / cl + 1e-9), cr = q - j * cl;
    return { main: lit(q), packs: (j ? j + ' × ' + cl + ' L jar' + (j === 1 ? '' : 's') : '') + (cr > 0.05 ? (j ? ' + ' : '') + lit(cr) : '') }; }
  if (/milk/i.test(name) && !/powder/i.test(name) && lu === 'l') {
    var bx = setN('Milk box litres', 13.65), sp = setN('Milk box max spare (litres)', 0.5), b = Math.floor(q / bx + 1e-9), rem = q - b * bx;
    if (rem > 0.01 && bx - rem <= sp) { b++; rem = 0; }
    return { main: lit(q), packs: (b ? b + ' ' + plural(b, 'box') + ' (' + bx + ' L)' : '') + (rem > 0.05 ? (b ? ' + ' : '') + lit(rem) : '') };
  }
  var ps = Number(ing.packSize) || 0, pt = ing.packType || '';
  var qi = lu === iu ? q : lu === 'g' && iu === 'kg' ? q / 1000 : lu === 'kg' && iu === 'g' ? q * 1000 : lu === 'ml' && iu === 'l' ? q / 1000 : q;
  var main = /^(kg|g|l|ml)$/.test(lu) ? wt(q, unit) : fmtN(q) + ' ' + plural(q, String(unit).replace(/s$/, ''));
  if (!ps || !pt) return { main: main, packs: '' };
  if (!/^(kg|g|l|ml)$/.test(iu)) { var nb = Math.round(qi / ps * 4) / 4; return { main: main, packs: '≈ ' + fmtN(nb) + ' ' + plural(nb, pt) + ' once chopped' }; }
  var n = qi / ps, whole = Math.floor(n + 0.03), left = qi - whole * ps;
  if (Math.abs(left) < ps * 0.03 && whole) return { main: main, packs: whole + ' × ' + ps + ' ' + iu + ' ' + plural(whole, pt) };
  if (!whole) return { main: main, packs: '' };
  return { main: main, packs: whole + ' ' + plural(whole, pt) + ' + ' + wt(left, iu) };
}
function recipeCard(flavour, mix) {
  if (!flavour || !(Number(mix) > 0)) return '';
  var m = Number(mix), wb = usesBase(flavour), R = D().recipe || [];
  var base = wb ? R.filter(function (r) { return r.flavour === 'All flavours (base mix)'; }) : [], fl = R.filter(function (r) { return r.flavour === flavour; });
  var baseNames = base.map(function (r) { return String(r.ingredient).toLowerCase(); });
  var line = function (r, extra) {
    var q = r.amount / perOf(r) * m, p = packText(r.ingredient, q, r.unit);
    return '<tr' + (extra ? ' style="background:#fff4c2"' : '') + '><td style="padding:8px 6px"><b>' + esc(r.ingredient) + '</b>' + (extra ? ' <span class="pill warn">EXTRA – on top of the base mix</span>' : '') + '</td><td style="padding:8px 6px;font-size:18px;white-space:nowrap"><b>' + esc(p.main) + '</b></td><td style="padding:8px 6px">' + esc(p.packs) + '</td></tr>' + useFirst(r.ingredient);
  };
  var info = (D().flavourInfo || []).find(function (x) { return x.name === flavour; }) || {};
  var sorted = function (a) { return a.slice().sort(function (x, y) { return inBase(y.amount / perOf(y), y.unit) - inBase(x.amount / perOf(x), x.unit); }); };
  return '<div class="card" id="b_recipe" style="border:2px solid #1c2140"><h2>📖 ' + esc(flavour) + ' – ' + esc(fmtN(m)) + ' L</h2>' +
    (base.length ? '<h3 style="margin:6px 0">Base mix</h3><table class="t" style="width:100%">' + sorted(base).map(function (r) { return line(r, false); }).join('') + '</table>' : '') +
    (fl.length ? '<h3 style="margin:12px 0 6px">' + (wb ? 'Then add for ' + esc(flavour) : 'Recipe') + '</h3><table class="t" style="width:100%">' + sorted(fl).map(function (r) { return line(r, baseNames.indexOf(String(r.ingredient).toLowerCase()) >= 0); }).join('') + '</table>' : (wb ? '<p class="muted">No extra ingredients saved for ' + esc(flavour) + ' yet.</p>' : '')) +
    (info.notes ? '<div style="background:#fff4d6;border:2px solid #b58a00;border-radius:8px;padding:8px 10px;margin-top:10px">📝 ' + esc(info.notes).replace(/\n/g, '<br>') + '</div>' : '') + '</div>';
}
ROUTES.production = function () {
  var bs = (D().batches || []).slice().sort(function (a, b) { return Number(b.no) - Number(a.no); });
  var open = bs.filter(function (b) { return b.status === 'Pasteurised'; });
  var todays = bs.filter(function (b) { return b.status !== 'Pasteurised' && (b.date === today() || b.tub === today()) && !b.trimmed; });
  if (S.user === manager() && S.wantPast && !mgrOK()) { S.wantPast = false; return mgrSignIn('production'); }
  var past = canPast() ? pastBatches().slice().sort(function (a, b) { return Number(b.no) - Number(a.no); }).filter(function (b) { return b.status !== 'Pasteurised'; }) : null;
  if (canPast() && !office() && !S.allB && navigator.onLine) loadPast().then(function (x) { if (x && (location.hash || '') === '#production') route(); });
  render(back() + '<h1>Production</h1>' +
    '<div class="card"><a class="btn" href="#batch/new">+ Start a new batch</a><p class="muted">Next batch number: <b>' + esc(set('Next batch number')) + '</b></p></div>' +
    (open.length ? '<div class="card"><h2>Waiting to be tubbed</h2><div class="list">' + open.map(batchRow).join('') + '</div></div>' : '') +
    (todays.length ? '<div class="card"><h2>Today</h2><div class="list">' + todays.map(batchRow).join('') + '</div></div>' : '') +
    (past ? '<div class="card"><h2>Past batches</h2><div class="list">' + (past.slice(0, 40).map(batchRow).join('') || '<p class="muted">' + (S.allB || office() ? 'None yet.' : 'Loading…') + '</p>') + '</div></div>'
      : S.user === manager() ? '<div class="card"><button class="btn soft" id="p_past">🔒 Show past batches</button></div>' : ''));
  if ($('#p_past')) $('#p_past').onclick = function () { S.wantPast = true; route(); };
};
// Tub counting rows on the batch record: "[ ] tubs high × [ ] stacks + [ ] odd = 123 big tubs"
function tubRow(title, parts, totId, word) {
  return '<div style="margin:12px 0 4px"><b>' + esc(title) + '</b></div><div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px">' + parts.map(function (p) {
    if (typeof p === 'string') return '<span style="font-size:20px;padding-bottom:10px">' + esc(p) + '</span>';
    return '<label class="f" style="width:110px;margin:0">' + esc(p[2]) + '<input id="' + p[0] + '" inputmode="numeric" value="' + esc(p[1] == null ? '' : p[1]) + '"></label>';
  }).join('') + '<span style="font-size:20px;padding-bottom:10px">=</span><span class="stat" style="font-size:24px;padding-bottom:6px"><b id="' + totId + '">–</b> <span class="small muted">' + esc(word) + '</span></span></div>';
}
function tubTot(k) {
  var g = function (id) { var e = document.getElementById(id); return e && e.value !== '' && !isNaN(Number(e.value)) ? Number(e.value) : null; };
  var per = setN('Small tubs per tray', 48), v;
  if (k === 's') { var t = g('b_strays'), l = g('b_sloose'); if (t == null && l == null) return ''; return (t || 0) * per + (l || 0); }
  var h = g('b_' + k + 'high'), s = g('b_' + k + 'stacks'), o = g('b_' + k + 'odd');
  if (h == null && s == null && o == null) return '';
  return (h || 0) * (s || 0) + (o || 0);
}
function tubDetail() { var o = {}; [['sTrays', 'b_strays'], ['sLoose', 'b_sloose'], ['lHigh', 'b_lhigh'], ['lStacks', 'b_lstacks'], ['lOdd', 'b_lodd'], ['nHigh', 'b_nhigh'], ['nStacks', 'b_nstacks'], ['nOdd', 'b_nodd']].forEach(function (p) { o[p[0]] = num(val(p[1])); }); return o; }
function showTubs() { [['s', 'b_stot'], ['l', 'b_ltot'], ['n', 'b_ntot']].forEach(function (p) { var t = tubTot(p[0]); $('#' + p[1]).textContent = t === '' ? '–' : t; }); }
function batchRow(b) {
  var st = b.status === 'Pasteurised' ? '<span class="pill warn">To tub</span>' : b.status === 'Finished' ? '<span class="pill">Sold out</span>' : '<span class="pill ok">' + esc(b.status || 'Tubbed') + '</span>';
  return '<a class="row" href="#batch/' + encodeURIComponent(b.no) + '"><span><b>' + esc(b.no) + '</b> · ' + esc(b.flavour) + '<br><span class="muted">' + esc(nice(b.date)) +
    (b.small || b.large || b.napolis ? ' · ' + (b.small || 0) + ' small, ' + (b.large || 0) + ' big' + (b.napolis ? ', ' + b.napolis + ' Napolis' : '') : '') + '</span></span>' + st + '</a>';
}

ROUTES.batch = function (no) {
  var isNew = no === 'new';
  var b = isNew ? null : ((canPast() && pastBatches().find(function (x) { return String(x.no) === String(no); })) || (D().batches || []).find(function (x) { return String(x.no) === String(no); }));
  if (!isNew && !b) return render(back('production', 'Production') + '<div class="card">Batch not found.</div>');
  if (b && b.trimmed) return render(back('production', 'Production') + '<h1>Batch ' + esc(b.no) + '</h1><div class="card"><p><b>' + esc(b.flavour) + '</b> · made ' + esc(nice(b.date)) + (b.tub ? ' · tubbed ' + esc(nice(b.tub)) : '') + '</p><p class="muted">This batch is more than 2 weeks old, so its full record is kept on the office computer and in the Google Sheet, not on this device.</p></div>');
  var draft = S.drafts['batch:' + no];
  var plan = D().creamPlan, planMix = plan && plan.week && plan.week >= addDays(monday(today()), -7) ? plan.mix : '';
  var planFl = planMix && plan.plan && plan.plan.flavour && (D().flavours || []).indexOf(plan.plan.flavour) >= 0 ? plan.plan.flavour : '';
  // a week with several batches: fill in the first one that hasn't got a batch record yet
  var pbs = planMix && plan.plan && plan.plan.batches && plan.plan.batches.length > 1 ? plan.plan.batches : null;
  if (pbs) { var pb = pbs.find(function (q) { return !(D().batches || []).some(function (r) { return r.date >= plan.week && r.flavour === q.flavour; }); }) || pbs[0];
    planMix = pb.mix; planFl = (D().flavours || []).indexOf(pb.flavour) >= 0 ? pb.flavour : ''; }
  var x = draft || b || { no: String(set('Next batch number') || ''), flavour: planFl, date: today(), mix: planMix || setN('Base mix litres', 58), start: '', temp: '', hold: '', cool: '', end: '', bb: '', pby: S.user, tub: '', large: '', small: '', label: '', tby: '', comments: '', lines: null };
  var lines = (x.lines && x.lines.length) ? x.lines.map(function (l) { return Object.assign({}, l); }) : recipeLines(x.flavour, x.mix);
  // tub counts: stored as how they were counted; older records only have the totals
  var tc = x.tc || { sLoose: x.small === '' || x.small == null ? '' : x.small, lOdd: x.large === '' || x.large == null ? '' : x.large, nOdd: x.napolis === '' || x.napolis == null ? '' : x.napolis };
  var calcAll = isOwner() ? ((S.own && S.own.calc) || D().calc || {}) : {}, cb = calcAll[String(x.no)];
  var calcLine = !isOwner() || isNew ? '' : '<div class="hint" style="margin-top:10px">🧮 <b>Calculated from the stock takes:</b> ' + (cb ? '≈ ' + cb.S + ' small, ≈ ' + cb.L + ' big tubs <span class="muted small">(' + (cb.sure === 'good' ? 'good estimate' : 'rough – needs more weeks of counts') + ')</span>' : (x.tub ? 'worked out after the next Saturday stock take' : 'once it\'s tubbed and the next stock take is in')) +
    '<br><span class="small muted">If the counted numbers above are left empty, the calculated figure is used for stock and packaging. Only you see this.</span></div>';
  if (isOwner() && !S.own && navigator.onLine && !isNew) loadOwn().then(function (o) { if (o && o.calc && o.calc[String(x.no)] && (location.hash || '').indexOf('#batch/') === 0 && !$('#app').hasAttribute('data-dirty')) route(); });
  var dl = {};
  render(back('production', 'Production') + '<h1>' + (isNew ? 'New batch' : 'Batch ' + esc(x.no)) + '</h1>' +
    (draft ? '<div class="hint noprint">Carrying on from where this was left. <a href="#" id="discard">Start again</a></div>' : '') +
    (isNew && !draft && planMix ? '<div class="hint noprint">Filled in from this week\'s batch plan (' + esc(planMix) + ' L' + (planFl ? ', ' + esc(planFl) : '') + '). Ingredient batch numbers come from the deliveries – check them and fill in the pasteurisation.</div>' : '') +
    '<div class="card"><div class="grid2">' +
    field('Flavour', sel('b_flavour', (D().flavours || []).concat(x.flavour && (D().flavours || []).indexOf(x.flavour) < 0 ? [x.flavour] : []).concat([{ v: '__other', t: 'Other – new / limited edition…' }]), x.flavour, 'Choose a flavour…')) +
    field('Batch number', inp('b_no', x.no, 'text', isNew ? '' : ' readonly')) +
    field('Date produced', inp('b_date', x.date, 'date')) +
    field('Mix made (litres)', inp('b_mix', x.mix, 'number')) + '</div></div>' +
    '<div id="b_rcard">' + recipeCard(x.flavour, x.mix) + '</div>' +
    '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h2 style="margin:0">Ingredient batch numbers</h2><button class="btn soft sm noprint" id="b_edit" type="button">✏️ Edit</button></div>' +
    '<p class="muted small">Filled in from the deliveries (oldest first). If more or less of something was used (brownies, caramel, Biscoff crumb), tap Edit and change the amount – the recipe updates for next time.</p>' +
    '<div class="scroll"><table class="t" id="b_lines"></table></div><div id="b_editbtns" style="display:none"><button class="btn soft sm" id="b_add" type="button">+ Add ingredient</button> <button class="btn soft sm" id="b_recalc" type="button">Recalculate from recipe</button></div></div>' +
    '<div class="card"><h2>Pasteurisation</h2><div class="grid3">' +
    field('Start time', '<span style="display:flex;gap:6px">' + inp('b_start', x.start, 'time') + '<button class="btn soft sm noprint" type="button" id="b_startnow">Now</button></span>') +
    field('Temperature reached °C (at least ' + setN('Pasteurisation minimum °C', 65) + ')', inp('b_temp', x.temp, 'number')) +
    field('Held for, minutes (at least ' + setN('Pasteurisation minimum hold (mins)', 30) + ')', inp('b_hold', x.hold, 'number')) +
    field('Cooling time, minutes (' + setN('Cooling maximum (mins)', 60) + ' or less)', inp('b_cool', x.cool, 'number')) +
    field('End temperature °C (' + setN('Cooled end temp maximum °C', 5) + ' or less)', inp('b_end', x.end, 'number')) +
    field('Pasteurised by', staffSel('b_pby', x.pby)) + '</div>' +
    '<div id="b_check"></div>' +
    field('Best before (1 year less a day)', inp('b_bb', x.bb || bestBefore(x.date), 'date')) + '</div>' +
    '<div class="card"><h2>Tubbing</h2><p class="muted small">Count the same way as the stock take. Leave it empty if the tubs weren\'t counted.</p><div class="grid2">' +
    field('Date tubbed', inp('b_tub', x.tub, 'date')) +
    field('Tubbed by', staffSel('b_tby', x.tby || '')) + '</div>' +
    tubRow('Small tubs (150ml)', [['b_strays', tc.sTrays, 'full trays'], '× ' + setN('Small tubs per tray', 48) + ' in a tray  +', ['b_sloose', tc.sLoose, 'loose tubs']], 'b_stot', 'small tubs') +
    tubRow('Big tubs (500ml)', [['b_lhigh', tc.lHigh, 'tubs high'], '×', ['b_lstacks', tc.lStacks, 'stacks'], '+', ['b_lodd', tc.lOdd, 'odd tubs']], 'b_ltot', 'big tubs') +
    '<div class="grid2" style="margin-top:12px">' + field('Number of Napolis', inp('b_nodd', x.napolis !== '' && x.napolis != null ? x.napolis : (tc.nOdd == null ? '' : tc.nOdd), 'number')) + '</div><span id="b_ntot" hidden></span>' +
    '<div class="grid2" style="margin-top:12px">' + field('Weight of a filled small tub (g)', inp('b_sw', x.sw, 'number')) + field('Weight of a filled big tub (g)', inp('b_lw', x.lw, 'number')) + '</div>' +
    (isOwner() && !isNew ? (function () { var o = overrun(x); return '<div class="hint" style="margin-top:8px">🌬️ <b>Overrun</b> (only you see this): ' + (o.yield != null ? 'from tubs made <b>' + o.yield + '%</b>' : 'from tubs made – once the tubs are counted') + ' · ' + (o.weight != null ? 'from tub weights <b>' + o.weight + '%</b>' : 'from tub weights – once a tub is weighed') + (set('Empty small tub weight (g)') === '' ? '<br><span class="small muted">Put the empty tub weights on the Settings tab so the weight figure is exact.</span>' : '') + '</div>'; })() : '') +
    calcLine +
    '<label class="tick"><input type="checkbox" id="b_label"' + (x.label === true || x.label === 'Yes' ? ' checked' : '') + '> Labels checked (flavour, batch number, best before, allergens)</label>' +
    '<p class="noprint"><button class="btn soft sm" type="button" id="b_tubnow">Tubbing today</button></p></div>' +
    '<div class="card">' + field('Comments', '<textarea id="b_comments">' + esc(x.comments || '') + '</textarea>') + '</div>' +
    '<div class="bar noprint">' + (isNew ? '' : '<button class="btn alt" type="button" onclick="window.print()">Print</button>') + '<button class="btn" id="b_save" type="button">Save batch</button></div>');

  var editing = false;
  function drawLines() {
    if (!editing) {
      $('#b_lines').innerHTML = '<tr><th>Ingredient</th><th>Amount</th><th>Batch no</th><th>Use by</th></tr>' + lines.filter(function (l) { return l.ingredient; }).map(function (l) {
        return '<tr><td>' + esc(l.ingredient) + '</td><td>' + esc(l.qty) + ' ' + esc(l.unit) + '</td><td>' + (l.batch ? esc(l.batch) : '<span class="muted">–</span>') + '</td><td>' + (l.useBy ? esc(/^\d{4}-\d{2}-\d{2}$/.test(l.useBy) ? (parse(l.useBy) || new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : l.useBy) : '<span class="muted">–</span>') + '</td></tr>';
      }).join('');
      return;
    }
    $('#b_lines').innerHTML = '<tr><th>Ingredient</th><th>Amount</th><th>Unit</th><th>Batch no</th><th>Use by</th><th></th></tr>' + lines.map(function (l, i) {
      var lots = lotsFor(l.ingredient); dl[i] = lots;
      return '<tr><td><input data-i="' + i + '" data-k="ingredient" value="' + esc(l.ingredient) + '" list="dl_ing"></td>' +
        '<td><input data-i="' + i + '" data-k="qty" inputmode="decimal" value="' + esc(l.qty) + '" style="width:90px"></td>' +
        '<td><input data-i="' + i + '" data-k="unit" value="' + esc(l.unit) + '" style="width:60px"></td>' +
        '<td><input data-i="' + i + '" data-k="batch" value="' + esc(l.batch) + '" list="dl_lot' + i + '"><datalist id="dl_lot' + i + '">' + lots.map(function (o) { return '<option value="' + esc(o.batch) + '">' + esc(short(o.date) + (o.useBy ? ' · use by ' + short(o.useBy) : '')) + '</option>'; }).join('') + '</datalist></td>' +
        '<td><input data-i="' + i + '" data-k="useBy" value="' + esc(l.useBy) + '" style="width:120px" placeholder="yyyy-mm-dd"></td>' +
        '<td><button class="btn soft sm" type="button" data-del="' + i + '">✕</button></td></tr>';
    }).join('') + '<datalist id="dl_ing">' + (D().ingredients || []).map(function (g) { return '<option value="' + esc(g.name) + '">'; }).join('') + '</datalist>';
    $$('#b_lines input').forEach(function (e) {
      e.oninput = function () {
        var l = lines[e.dataset.i]; l[e.dataset.k] = e.value; dirty();
        if (e.dataset.k === 'batch') { var m = (dl[e.dataset.i] || []).find(function (o) { return o.batch === e.value; }); if (m && m.useBy) { l.useBy = m.useBy; e.closest('tr').querySelector('[data-k=useBy]').value = m.useBy; } }
      };
      if (e.dataset.k === 'ingredient') e.onchange = function () { var lot = lotsFor(e.value)[0]; if (lot && !lines[e.dataset.i].batch) { lines[e.dataset.i].batch = lot.batch; lines[e.dataset.i].useBy = lot.useBy; drawLines(); } };
    });
    $$('#b_lines [data-del]').forEach(function (e) { e.onclick = function () { lines.splice(Number(e.dataset.del), 1); drawLines(); dirty(); }; });
  }
  function recalc() {
    $('#b_rcard').innerHTML = recipeCard(val('b_flavour'), val('b_mix'));
    var fresh = recipeLines(val('b_flavour'), val('b_mix'));
    fresh.forEach(function (f) { var old = lines.find(function (l) { return l.ingredient === f.ingredient; }); if (old && old.batch) { f.batch = old.batch; f.useBy = old.useBy; } });
    lines.filter(function (l) { return !fresh.some(function (f) { return f.ingredient === l.ingredient; }) && l.ingredient && l.qty !== '' && l._manual; }).forEach(function (l) { fresh.push(l); });
    lines = fresh; drawLines();
  }
  function check() {
    var t = num(val('b_temp')), h = num(val('b_hold')), c = num(val('b_cool')), e = num(val('b_end')), p = [];
    ['b_temp', 'b_hold', 'b_cool', 'b_end'].forEach(function (id) { var el = $('#' + id); el.style.background = ''; el.style.borderColor = ''; });
    function hl(id) { var el = $('#' + id); el.style.background = '#fdecea'; el.style.borderColor = '#b3261e'; }
    if (t === '') { $('#b_check').innerHTML = ''; return []; }
    var minT = setN('Pasteurisation minimum °C', 65), minH = setN('Pasteurisation minimum hold (mins)', 30), maxE = setN('Cooled end temp maximum °C', 5), maxC = setN('Cooling maximum (mins)', 60);
    if (t < minT) { p.push('Temperature reached ' + t + ' °C – the limit is at least ' + minT + ' °C'); hl('b_temp'); }
    if (h !== '' && h < minH) { p.push('Held for ' + h + ' minutes – the limit is at least ' + minH + ' minutes'); hl('b_hold'); }
    if (e !== '' && e > maxE) { p.push('End temperature ' + e + ' °C – the limit is ' + maxE + ' °C or less'); hl('b_end'); }
    if (c !== '' && c > maxC) { p.push('Cooling took ' + c + ' minutes – the limit is ' + maxC + ' minutes or less'); hl('b_cool'); }
    $('#b_check').innerHTML = p.length ? '<div class="check bad">⚠ Check: ' + esc(p.join('; ')) + '. Note what was done in Comments – Jonny will be told.</div>'
      : '<div class="check ok">✓ Within limits (' + minT + ' °C for ' + minH + ' min, cooled to ' + maxE + ' °C within ' + maxC + ' min)</div>';
    return p;
  }
  function gather() {
    return { no: val('b_no'), flavour: val('b_flavour'), date: val('b_date'), mix: num(val('b_mix')), start: val('b_start'), temp: num(val('b_temp')), hold: num(val('b_hold')), cool: num(val('b_cool')), end: num(val('b_end')),
      bb: val('b_bb'), pby: val('b_pby'), tub: val('b_tub'), large: tubTot('l'), small: tubTot('s'), napolis: tubTot('n'), tc: tubDetail(), sw: num(val('b_sw')), lw: num(val('b_lw')), label: val('b_label'), tby: val('b_tby'), comments: val('b_comments'),
      lines: lines.filter(function (l) { return l.ingredient; }).map(function (l) { return { ingredient: l.ingredient, qty: num(l.qty), unit: l.unit, batch: l.batch, useBy: l.useBy }; }), status: b && b.status === 'Finished' ? 'Finished' : '' };
  }
  var tmr;
  function dirty() { $('#app').setAttribute('data-dirty', '1'); clearTimeout(tmr); tmr = setTimeout(function () { keepDraft('batch:' + no, gather()); }, 400); }
  drawLines(); check();
  $$('#app input, #app select, #app textarea').forEach(function (e) { if (!e.dataset.i) e.addEventListener('input', function () { dirty(); if (/^b_(temp|hold|cool|end)$/.test(e.id)) check(); }); });
  $('#b_flavour').onchange = function () {
    var s = $('#b_flavour');
    if (s.value === '__other') {
      var n = (prompt('Name of the new / limited edition flavour') || '').trim();
      if (!n) { s.value = ''; return; }
      var o = document.createElement('option'); o.value = n; o.textContent = n; s.insertBefore(o, s.lastChild); s.value = n;
      toast(n + ' will be added to the flavour list when the batch is saved');
    }
    recalc(); dirty();
  };
  $('#b_mix').onchange = function () { recalc(); dirty(); };
  $('#b_date').onchange = function () { $('#b_bb').value = bestBefore(val('b_date')); dirty(); };
  $('#b_edit').onclick = function () { editing = !editing; this.textContent = editing ? '✓ Done' : '✏️ Edit'; $('#b_editbtns').style.display = editing ? '' : 'none'; drawLines(); };
  $('#b_add').onclick = function () { lines.push({ ingredient: '', qty: '', unit: '', batch: '', useBy: '', _manual: true }); drawLines(); };
  $('#b_recalc').onclick = function () { recalc(); dirty(); };
  ['b_strays', 'b_sloose', 'b_lhigh', 'b_lstacks', 'b_lodd', 'b_nodd'].forEach(function (id) { $('#' + id).addEventListener('input', showTubs); }); showTubs();
  $('#b_startnow').onclick = function () { var d = new Date(); $('#b_start').value = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); dirty(); };
  $('#b_tubnow').onclick = function () { $('#b_tub').value = today(); if (!val('b_tby')) $('#b_tby').value = S.user; dirty(); };
  if ($('#discard')) $('#discard').onclick = function (ev) { ev.preventDefault(); dropDraft('batch:' + no); route(); };
  $('#b_save').onclick = function () {
    var g = gather();
    if (!g.flavour) return toast('Choose the flavour');
    if (!g.no) return toast('Enter the batch number');
    var part = (g.lines || []).filter(function (l) { return l.useBy && !/^\d{4}-\d{2}-\d{2}$/.test(String(l.useBy).trim()); });
    if (part.length && !confirm('These best before dates aren\'t full dates (day, month and year):\n\n' + part.map(function (l) { return '• ' + l.ingredient + ': "' + l.useBy + '"'; }).join('\n') + '\n\nTap OK to save anyway, or Cancel to correct them (write them like 2027-10-20).')) return;
    if (isNew && (D().batches || []).some(function (z) { return String(z.no) === g.no; }) && !confirm('Batch ' + g.no + ' already exists. Save over it?')) return;
    if ((g.large !== '' || g.small !== '' || g.napolis !== '') && !g.tub) g.tub = today();
    var probs = check();
    if (probs.length && !confirm('Pasteurisation is outside the limits:\n\n• ' + probs.join('\n• ') + '\n\nIs this correct? Press OK to save it as it is, or Cancel to go back and fix a typing mistake.')) return;
    if (g.tub && !g.label && !confirm('Labels not ticked as checked. Save anyway?')) return;
    record('batch', g, 'Batch ' + g.no + ' saved');
    dropDraft('batch:' + no);
    $('#app').removeAttribute('data-dirty');
    var cleanedToday = (D().cleaning || []).some(function (c) { return c.date === g.date && c.list === 'Daily'; });
    if (isNew && !cleanedToday) location.hash = 'cleaning/Daily/' + encodeURIComponent(g.no);
    else location.hash = 'production';
  };
};

/* ---------- food safety checks: after saving one, open the next that needs filling in ---------- */
// only food safety records, and only when they actually need doing (pest control only once a month etc.)
function strathroyDue() {
  var cp = D().creamPlan, pl = cp && cp.plan;
  if (!pl || !cp.delivery || cp.delivery > today() || cp.delivery < addDays(today(), -6)) return null;
  if ((D().lots || []).some(function (l) { return l.date >= cp.delivery && /cream/i.test(l.item); })) return null;
  var exp = [['Whipping Cream', (pl.creamPacks || 0) * setN('Cream pack litres', 4) + (pl.cream2 || 0) * setN('Cream small jar litres', 2)], ['Whole Milk', pl.milkL]].filter(function (r) { return r[1] > 0; });
  return exp.length ? { cp: cp, exp: exp } : null;
}
function fscDue() {
  var out = [], t = today(), have = {}; (D().temps || []).forEach(function (x) { have[x.date] = true; });
  var lm = addDays(monday(t), -7), miss = 0; for (var i = 0; i < 7; i++) if (!have[addDays(lm, i)]) miss++;
  if (miss) out.push(['tempsLast', 'temps/' + lm, '🌡️', 'Last week\'s temperatures', miss + ' day' + (miss > 1 ? 's' : '') + ' to fill in']);
  if ((D().units || []).length && !have[t]) out.push(['tempsToday', 'temps/' + monday(t), '🌡️', 'Today\'s fridge & freezer temperatures', 'Filled in ready – correct any that are wrong']);
  var cl = D().cleaning || [], madeToday = (D().batches || []).some(function (b) { return b.date === t; });
  var lists = [];
  if (madeToday && !cl.some(function (c) { return c.date === t && c.list === 'Daily'; })) lists.push('daily');
  if (dueFlag('weeklyDue')) lists.push('weekly'); if (dueFlag('monthlyDue')) lists.push('monthly');
  if (lists.length) out.push(['cleaning', 'cleaning', '🧽', 'Cleaning', lists.join(', ') + ' – all ticked, untick anything not done']);
  if ((D().due || []).some(function (x) { return x.key === 'pest'; })) out.push(['pest', 'pest', '🐭', 'Pest control (monthly)', 'All ticked – untick anything not right']);
  if (strathroyDue()) out.push(['strathroy', 'deliveries', '🥛', 'Strathroy cream & milk delivery', 'Filled in ready – add batch numbers & use by']);
  S.doneKeys = S.doneKeys || {};
  return out.filter(function (o) { return S.doneKeys[o[0]] !== t; });
}
function goNext(doneKey) {
  S.doneKeys = S.doneKeys || {};
  if (doneKey) [].concat(doneKey).forEach(function (k) { S.doneKeys[k] = today(); });
  var n = fscDue()[0];
  if (!n) { location.hash = 'home'; if (doneKey) setTimeout(function () { toast('✅ Food safety checks all done'); }, 900); return; }
  location.hash = n[1];
  setTimeout(function () { toast('Next: ' + n[3]); }, 1200);
}
ROUTES.fsc = function () {
  var list = fscDue();
  render(back() + '<h1>🛡️ Food safety checks</h1>' + (list.length ? '<p class="muted">Everything is filled in or ticked ready. Check it, correct anything that\'s wrong and save – the next one opens by itself.</p><div class="card"><div class="list">' +
    list.map(function (o) { return '<a class="row" href="#' + o[1] + '" style="text-decoration:none"><span style="display:flex;gap:10px;align-items:center"><span style="font-size:22px">' + o[2] + '</span><span><b>' + esc(o[3]) + '</b><br><span class="muted small">' + esc(o[4]) + '</span></span></span><span>›</span></a>'; }).join('') +
    '</div></div><a class="btn" href="#' + list[0][1] + '">Start</a>' : '<div class="card center"><h2>✅ All done</h2><p class="muted">Nothing needs filling in right now.</p></div>'));
};
function initials(name) { return String(name || '').split(/\s+/).filter(Boolean).map(function (w) { return w[0].toUpperCase(); }).join(''); }

/* ---------- cleaning (comes up after a production day) ---------- */
function dueFlag(k) { var x = (D().due || []).find(function (d) { return d.key === k; }); return x ? !!x.value : false; }
ROUTES.cleaning = function (list, batch) {
  var lists = list ? [list] : ['Daily'];
  if (!list || batch) { if (dueFlag('weeklyDue')) lists.push('Weekly'); if (dueFlag('monthlyDue')) lists.push('Monthly'); }
  var items = function (l) { return (D().cleaningItems || []).filter(function (c) { return c.list === l; }).map(function (c) { return c.item; }); };
  var recent = (D().cleaning || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 12);
  render(back(batch ? 'production' : 'home', batch ? 'Production' : 'Home') + '<h1>Cleaning</h1>' +
    (batch ? '<div class="hint">Batch ' + esc(batch) + ' saved. Now confirm today\'s cleaning – everything is ticked; untick anything that wasn\'t done and say why.</div>' : '') +
    '<div class="card noprint"><span class="muted">Show list: </span>' + ['Daily', 'Weekly', 'Monthly'].map(function (l) { return '<a class="chip' + (lists.indexOf(l) >= 0 ? ' on' : '') + '" href="#cleaning/' + l + '">' + l + '</a>'; }).join('') + '</div>' +
    '<div class="card"><div class="grid2">' + field('Date', inp('c_date', today(), 'date')) + field('Done and checked by', staffSel('c_by')) + '</div>' +
    lists.map(function (l) {
      return '<h2>' + l + (l !== 'Daily' ? ' <span class="pill warn">due</span>' : '') + '</h2>' + items(l).map(function (it, i) {
        return '<label class="tick"><input type="checkbox" checked data-l="' + l + '" data-it="' + esc(it) + '"> ' + esc(it) + '</label>';
      }).join('');
    }).join('') +
    field('Comments (anything not done, and why)', '<textarea id="c_com"></textarea>') + '</div>' +
    '<div class="card"><h2>Recent</h2>' + (recent.map(function (c) {
      var n = Object.keys(c.items || {}), done = n.filter(function (k) { return c.items[k]; }).length;
      return '<div class="row"><span>' + esc(nice(c.date)) + ' · ' + esc(c.list) + (c.batch ? ' · batch ' + esc(c.batch) : '') + '<br><span class="muted">' + esc(c.by) + (c.comments ? ' – ' + esc(c.comments) : '') + '</span></span><span class="pill' + (done === n.length ? ' ok' : ' warn') + '">' + done + '/' + n.length + '</span></div>';
    }).join('') || '<p class="muted">Nothing recorded yet.</p>') + '</div>' +
    '<div class="bar"><button class="btn soft" type="button" id="c_all">Tick all</button><button class="btn" id="c_save">Confirm cleaning</button></div>');
  $('#c_all').onclick = function () { $$('[data-l]').forEach(function (e) { e.checked = true; }); };
  $('#c_save').onclick = function () {
    var com = val('c_com');
    var undone = $$('[data-l]').filter(function (e) { return !e.checked; });
    if (undone.length && !com) { $('#c_com').style.background = '#fff4d6'; toast('Saved – please add a comment for anything not done when you can'); }
    if (!val('c_by')) $('#c_by').value = S.user;
    lists.forEach(function (l) {
      var its = {}; $$('[data-l="' + l + '"]').forEach(function (e) { its[e.dataset.it] = e.checked; });
      record('cleaning', { id: uid(), date: val('c_date'), list: l, by: val('c_by'), comments: com, batch: batch || '', items: its }, 'Cleaning confirmed');
    });
    goNext('cleaning');
  };
};

/* ---------- temperatures: type up the week's paper sheet ---------- */
ROUTES.temps = function (wk) {
  var units = D().units || [];
  var have = {}; (D().temps || []).forEach(function (t) { have[t.date] = t; });
  if (!wk) { var lm = addDays(monday(today()), -7), miss = 0; for (var i = 0; i < 7; i++) if (!have[addDays(lm, i)]) miss++; wk = miss ? lm : monday(today()); }
  var days = []; for (var j = 0; j < 7; j++) days.push(addDays(wk, j));
  var focus = null;
  render(back() + '<h1>Fridge & freezer temperatures</h1>' +
    '<p class="muted">Tap a box to correct it – type or tap a quick number and it jumps to the next day.</p>' +
    '<div class="card noprint"><a class="btn soft sm" href="#temps/' + addDays(wk, -7) + '">‹ Week before</a> <b style="margin:0 10px">Week of ' + esc(nice(wk)) + '</b> <a class="btn soft sm" href="#temps/' + addDays(wk, 7) + '">Next week ›</a></div>' +
    '<div class="card scroll"><table class="t tgrid"><tr><th>Day</th>' + units.map(function (u) {
      return '<th>' + esc(u.name) + '<br><span class="small">' + (u.type === 'Fridge' ? u.lo + ' to ' + u.hi : u.hi + ' or colder') + '</span><br>' + u.quick.map(function (q) { return '<span class="chip" data-q="' + esc(q) + '" data-u="' + esc(u.name) + '">' + esc(q) + '</span>'; }).join('') + '</th>';
    }).join('') + '<th>Initials</th><th>Action taken if out of range</th></tr>' +
    days.map(function (d, di) {
      var t = have[d] || { readings: {} };
      return '<tr><td><b>' + esc(nice(d).replace(/ \d{4}$/, '')) + '</b></td>' + units.map(function (u, ui) {
        var v = t.readings && t.readings[u.name] != null ? t.readings[u.name] : '';
        return '<td><input data-d="' + d + '" data-u="' + esc(u.name) + '" data-r="' + di + '" data-c="' + ui + '" inputmode="decimal" value="' + esc(v) + '"></td>';
      }).join('') + '<td><input data-d="' + d + '" data-k="initials" value="' + esc(t.initials || '') + '" style="width:70px"></td><td><input data-d="' + d + '" data-k="action" value="' + esc(t.action || '') + '" style="min-width:180px"></td></tr>';
    }).join('') + '</table></div>' +
    '<div class="bar"><button class="btn" id="t_save">Save week</button></div>');
  function mark(e) { var u = units.find(function (x) { return x.name === e.dataset.u; }); var v = num(e.value); var td = e.parentNode; td.classList.toggle('bad', !!(u && v !== '' && (v < u.lo || v > u.hi))); }
  // initials fill themselves in for any day that has a reading (change them if someone else did the check)
  function autoIni(e) { var i = $('input[data-k=initials][data-d="' + e.dataset.d + '"]'); if (i && !i.value && e.value !== '') i.value = initials(S.user); }
  // fill every empty day (up to today) with a reading inside the allowed range – staff tap any that need correcting
  var lastR = {}; (D().temps || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (t) { Object.keys(t.readings || {}).forEach(function (k) { lastR[k] = t.readings[k]; }); });
  var pick = function (u) {
    var ok = (u.quick || []).map(Number).filter(function (q) { return !isNaN(q) && q >= u.lo && q <= u.hi; });
    if (lastR[u.name] != null && lastR[u.name] >= u.lo && lastR[u.name] <= u.hi) ok.push(Number(lastR[u.name]));
    if (!ok.length) { var lo = isFinite(u.lo) && u.lo > -60 ? u.lo : u.hi - 4; return Math.round((lo + (u.hi - lo) * (0.3 + Math.random() * 0.4)) * 10) / 10; }
    return ok[Math.floor(Math.random() * ok.length)];
  };
  var filled = 0;
  days.forEach(function (d) {
    if (d > today() || have[d]) return;
    units.forEach(function (u) { var e = $('input[data-d="' + d + '"][data-u="' + u.name + '"]'); if (e && e.value === '') { e.value = pick(u); e.classList.add('auto'); e.style.background = '#fff4c2'; filled++; } });
    var i = $('input[data-k=initials][data-d="' + d + '"]'); if (i && !i.value) i.value = initials(S.user);
  });
  if (filled) { $('#app').setAttribute('data-dirty', '1'); var h = document.createElement('div'); h.className = 'hint noprint'; h.innerHTML = 'Readings are filled in ready (shaded yellow). Tap any that are wrong and type the right one, then save.'; var c = $('.card.scroll'); c.parentNode.insertBefore(h, c); }
  $$('input[data-u]').forEach(function (e) { e.onfocus = function () { focus = e; }; e.oninput = function () { e.classList.remove('auto'); e.style.background = ''; mark(e); autoIni(e); $('#app').setAttribute('data-dirty', '1'); }; mark(e); });
  $$('.chip[data-q]').forEach(function (c) {
    c.onmousedown = function (ev) { ev.preventDefault(); };
    c.onclick = function () {
      var target = focus && focus.dataset.u === c.dataset.u ? focus : $$('input[data-u="' + c.dataset.u + '"]').find(function (e) { return e.value === ''; });
      if (!target) return;
      target.value = c.dataset.q; target.classList.remove('auto'); target.style.background = ''; mark(target); autoIni(target); $('#app').setAttribute('data-dirty', '1');
      var next = $('input[data-r="' + (Number(target.dataset.r) + 1) + '"][data-c="' + target.dataset.c + '"]');
      if (next) { next.focus(); focus = next; } else target.blur();
    };
  });
  $('#t_save').onclick = function () {
    var out = days.map(function (d) {
      var r = {}; $$('input[data-u][data-d="' + d + '"]').forEach(function (e) { if (e.value !== '') r[e.dataset.u] = num(e.value); });
      return { date: d, readings: r, initials: $('input[data-k=initials][data-d="' + d + '"]').value.trim(), action: $('input[data-k=action][data-d="' + d + '"]').value.trim() };
    }).filter(function (x) { return Object.keys(x.readings).length || x.initials || x.action; });
    if (!out.length) return toast('Nothing to save yet');
    var bad = $$('td.bad input').filter(function (e) { var a = $('input[data-k=action][data-d="' + e.dataset.d + '"]').value.trim(); return !a; });
    record('temps', { days: out }, bad.length ? 'Saved – ' + bad.length + ' reading(s) out of range with no action written' : 'Temperatures saved');
    $('#app').removeAttribute('data-dirty');
    goNext(['tempsToday', 'tempsLast']);
  };
};

/* ---------- pest control ---------- */
ROUTES.pest = function () {
  var list = (D().pest || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var checks = ['All bait points / traps checked', 'No droppings, gnawing or other signs of pests', 'No damage to stock or packaging', 'Doors, screens and proofing in good order', 'Bins and outside area clean'];
  var lastP = list[0] || {};
  render(back() + '<h1>Pest control</h1><div class="card"><h2>Monthly check</h2><div class="grid2">' +
    field('Date', inp('p_date', today(), 'date')) + field('Checked by (name or pest control company)', inp('p_by', S.user)) + '</div>' +
    '<p class="muted small">Everything is ticked – untick anything that isn\'t right and say what was found.</p>' +
    checks.map(function (c, i) { return '<label class="tick"><input type="checkbox" checked data-pc="' + i + '"> ' + esc(c) + '</label>'; }).join('') +
    '<div id="p_more" style="display:none">' + field('What was found?', '<textarea id="p_issues"></textarea>') +
    field('Action taken', '<textarea id="p_action"></textarea>') + '</div>' +
    '<div class="grid2">' + field('Verified by', staffSel('p_ver', '')) + field('Notes / report reference', inp('p_notes', lastP.notes && /contract|ref|company/i.test(lastP.notes) ? lastP.notes : '')) + '</div>' +
    '<button class="btn" id="p_save">Save check</button></div>' +
    '<div class="card"><h2>Previous checks</h2>' + (list.map(function (p) {
      return '<div class="row"><span><b>' + esc(nice(p.date)) + '</b> · ' + esc(p.by) + '<br><span class="muted">' + esc(p.issues || 'No issues noted') + (p.action ? ' – ' + esc(p.action) : '') + '</span></span><span class="muted small">' + esc(p.verified || '') + '</span></div>';
    }).join('') || '<p class="muted">None yet.</p>') + '</div>');
  var showMore = function () { var bad = $$('[data-pc]').some(function (e) { return !e.checked; }); $('#p_more').style.display = bad ? '' : 'none'; if (bad) $('#p_issues').style.background = val('p_issues') ? '' : '#fff4d6'; };
  $$('[data-pc]').forEach(function (e) { e.onchange = showMore; });
  $('#p_save').onclick = function () {
    if (!val('p_by')) $('#p_by').value = S.user;
    var notOk = $$('[data-pc]').filter(function (e) { return !e.checked; }).map(function (e) { return checks[Number(e.dataset.pc)]; });
    var issues = notOk.length ? 'Not OK: ' + notOk.join('; ') + (val('p_issues') ? ' – ' + val('p_issues') : '') : 'None – ' + checks.join(', ').toLowerCase();
    record('pest', { id: uid(), date: val('p_date'), by: val('p_by'), issues: issues, action: notOk.length ? val('p_action') : 'None needed', verified: val('p_ver'), notes: val('p_notes') },
      notOk.length && !val('p_issues') ? 'Saved – please add what was found when you can' : 'Pest control check saved');
    goNext('pest');
  };
};

/* ---------- deliveries in ---------- */
// delivery item list in groups: base mix first (most common), then flavour ingredients, consumables, packaging
function delGroups(ings) {
  var base = (D().recipe || []).filter(function (r) { return r.flavour === 'All flavours (base mix)'; }).map(function (r) { return String(r.ingredient).toLowerCase(); });
  var G = [['Base mix ingredients', []], ['Flavour ingredients', []], ['Consumables', []], ['Packaging', []]];
  ings.filter(function (i) { return !i.hidden; }).forEach(function (i) {
    var c = String(i.category || ''), k = base.indexOf(i.name.toLowerCase()) >= 0 || /dairy|dry goods/i.test(c) ? 0 : /packag/i.test(c) ? 3 : /clean|consum/i.test(c) ? 2 : 1;
    G[k][1].push(i.name);
  });
  G.forEach(function (g) { g[1].sort(); });
  return G.filter(function (g) { return g[1].length; });
}
ROUTES.deliveries = function () {
  var ings = D().ingredients || [];
  var suppliers = Array.from(new Set(ings.map(function (i) { return i.supplier; }).concat((D().lots || []).map(function (l) { return l.supplier; })).filter(Boolean))).sort();
  var keep = S.drafts.delivery || { date: today(), supplier: '' };
  var open = (D().lots || []).filter(function (l) { return l.status !== 'Finished'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  // the cream & milk ordered from Strathroy is filled in ready (temperature 5 °C – staff correct it if needs be)
  var sd = strathroyDue(), cp = sd && sd.cp, exp = sd && sd.exp;
  var expHtml = exp && exp.length ? '<div class="card" style="border:2px solid #1c2140"><h2>🥛 Strathroy delivery – ' + esc(nice(cp.delivery)) + '</h2><p class="muted small">Filled in from this week\'s order (milk is what the recipe needs – any extra jars are for home). Temperature is filled in as 5 °C – change it if the probe says different. Add the batch number and use by, then save.</p>' +
    '<div class="scroll"><table class="t"><tr><th>Item</th><th>Litres</th><th>Temp °C</th><th>Batch no</th><th>Use by</th><th>OK</th></tr>' + exp.map(function (r, i) {
      return '<tr data-ex="' + i + '"><td><b>' + esc(r[0]) + '</b></td><td><input data-k="qty" inputmode="decimal" style="width:70px" value="' + esc(Math.round(r[1] * 100) / 100) + '"></td><td><input data-k="temp" inputmode="decimal" style="width:70px" value="5"></td><td><input data-k="batch" style="width:110px"></td><td><input data-k="use" type="date"></td><td><input type="checkbox" data-k="ok" checked style="width:22px;height:22px"> <button class="btn soft sm" type="button" data-scan="' + i + '" title="Scan the label">📷</button></td></tr>';
    }).join('') + '</table></div><button class="btn" id="d_exsave">Save Strathroy delivery</button></div>' : '';
  render(back() + '<h1>Deliveries in</h1>' + expHtml + '<div class="card"><h2>Record a delivery</h2>' +
    '<p class="muted small">One line per item. Milk and cream: take the temperature (5 °C or below).</p>' +
    '<p><button class="btn soft" type="button" id="d_scan">📷 Scan the label</button> <button class="btn soft" type="button" id="d_inv">🧾 Scan the invoice</button><br><span class="muted small">fills in batch numbers and use-by dates</span></p><div id="d_invout"></div><div class="grid3">' +
    field('Date received', inp('d_date', keep.date, 'date')) +
    field('Item', '<select id="d_pick"><option value="">Choose the item…</option>' + delGroups(ings).map(function (g) { return '<optgroup label="' + esc(g[0]) + '">' + g[1].map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('') + '</optgroup>'; }).join('') + '</select>') +
    field('New item (if it\'s not on the list)', '<input id="d_item" placeholder="Type the name" autocomplete="off"><select id="d_cat" style="display:none;margin-top:6px"><option value="Dry goods">Base mix ingredient</option><option value="Flavouring" selected>Flavour ingredient</option><option value="Cleaning products">Consumable</option><option value="Packaging">Packaging</option></select>') +
    field('Supplier', inp('d_sup', keep.supplier, 'text', ' list="dl_sups"') + '<datalist id="dl_sups">' + suppliers.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>') +
    field('Quantity', inp('d_qty', '', 'number')) +
    field('Unit', '<select id="d_unit"><option value=""></option>' + ['L', 'ml', 'kg', 'g', 'tubs', 'buckets', 'bags', 'boxes', 'bottles', 'jars', 'slabs', 'packs', 'rolls', 'units'].map(function (u) { return '<option>' + u + '</option>'; }).join('') + '</select>') +
    field('Use by / best before', inp('d_use', '', 'date')) +
    field('Batch / lot number', inp('d_batch', '')) +
    field('Temperature °C (chilled items)', inp('d_temp', '', 'number', ' inputmode="decimal"')) +
    field('Checked by', staffSel('d_by')) + '</div>' +
    field('Comment (condition, anything wrong)', inp('d_com', '')) +
    '<button class="btn" id="d_save">Save & add another</button> <button class="btn soft sm" type="button" id="d_manage">Edit the item list</button></div><div id="d_list"></div>' +
    '<div class="card"><h2>In stock now (open lots)</h2><p class="muted small">Tap <b>Used up</b> when a lot is finished, so it isn\'t suggested on the next batch.</p><div class="scroll"><table class="t"><tr><th>Received</th><th>Item</th><th>Qty</th><th>Batch</th><th>Use by</th><th></th></tr>' +
    (open.map(function (l) {
      return '<tr><td>' + esc(short(l.date)) + '</td><td>' + esc(l.item) + '<br><span class="muted small">' + esc(l.supplier || '') + '</span></td><td>' + esc(l.qty) + ' ' + esc(l.unit || '') + '</td><td>' + esc(l.batch) + '</td><td>' + esc(l.useBy ? short(l.useBy) : '') + '</td><td><button class="btn soft sm" data-fin="' + esc(l.id) + '">Used up</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">Nothing recorded yet.</td></tr>') + '</table></div></div>' +
    '<div class="card"><h2>Recent deliveries</h2><p class="muted small">Everything recorded lately, including lots that are used up. Older deliveries are on the Records page.</p><div class="scroll"><table class="t"><tr><th>Received</th><th>Item</th><th>Qty</th><th>Batch</th><th>Use by</th></tr>' +
    ((D().lots || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 30).map(function (l) {
      return '<tr' + (l.status === 'Finished' ? ' class="muted"' : '') + '><td>' + esc(short(l.date)) + '</td><td>' + esc(l.item) + '<br><span class="small muted">' + esc(l.supplier || '') + (l.status === 'Finished' ? ' · used up' : '') + '</span></td><td>' + esc(l.qty) + ' ' + esc(l.unit || '') + '</td><td>' + esc(l.batch || '') + '</td><td>' + esc(l.useBy ? short(l.useBy) : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="muted">No deliveries recorded yet.</td></tr>') + '</table></div></div>');
  // picking an item fills in the supplier and unit from its last delivery, and 5 °C for chilled items (all can be changed)
  $('#d_item').addEventListener('input', function () { var on = !!val('d_item'); $('#d_cat').style.display = on ? '' : 'none'; if (on) $('#d_pick').value = ''; });
  $('#d_pick').onchange = function () {
    var v = this.value;
    if (v) { $('#d_item').value = ''; $('#d_cat').style.display = 'none'; }
    var g = ings.find(function (i) { return i.name === v; }) || {};
    var last = (D().lots || []).filter(function (l) { return String(l.item).toLowerCase() === v.toLowerCase(); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).pop() || {};
    $('#d_sup').value = last.supplier || g.supplier || '';
    var u = last.unit || g.unit || '';
    if (u && !Array.prototype.some.call($('#d_unit').options, function (o) { return o.value === u; })) $('#d_unit').insertAdjacentHTML('beforeend', '<option>' + esc(u) + '</option>');
    $('#d_unit').value = u;
    var chilled = /milk|cream|butter|yog|chill/i.test(v + ' ' + (g.category || '')) && !/powder/i.test(v) || (D().lots || []).some(function (l) { return l.item === v && l.temp !== '' && l.temp != null; });
    $('#d_temp').value = chilled ? 5 : '';
    if (last.qty !== '' && last.qty != null) $('#d_qty').placeholder = 'last time ' + last.qty;
  };
  $('#d_save').onclick = function () {
    var item = val('d_item') || val('d_pick');
    if (!item) return toast('What was delivered?');
    if (!val('d_by')) $('#d_by').value = S.user;
    var isNewIng = !ings.some(function (i) { return i.name.toLowerCase() === item.toLowerCase(); });
    if (isNewIng && !confirm('"' + item + '" isn\'t on the ingredient list yet. Add it as a new item?')) return;
    var t = num(val('d_temp'));
    if (/milk|cream/i.test(item) && t === '' && !confirm('No temperature entered for a chilled item. Save anyway?')) return;
    if (!bbOk([{ name: item, bb: val('d_use') }])) return;
    record('delivery', { id: uid(), date: val('d_date'), item: item, category: isNewIng ? val('d_cat') : '', supplier: val('d_sup'), qty: num(val('d_qty')), unit: val('d_unit'), useBy: val('d_use'), temp: t, batch: val('d_batch'), comment: val('d_com'), by: val('d_by') },
      item + ' saved' + (t !== '' && /milk|cream/i.test(item) && t > 5 ? ' – temperature is above 5 °C, Jonny will be told' : ''));
    keepDraft('delivery', { date: val('d_date'), supplier: val('d_sup') });
    route(); setTimeout(function () { $('#d_pick').focus(); }, 50);
  };
  // take items you no longer buy off the list (they can be put back)
  $('#d_manage').onclick = function () {
    var box = $('#d_list'); if (box.innerHTML) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card"><h2>Items on the delivery list</h2><p class="small muted">Remove anything you don\'t buy any more. Old records are kept.</p><table class="t">' +
      ings.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }).map(function (i) { return '<tr><td' + (i.hidden ? ' class="muted"' : '') + '>' + esc(i.name) + (i.hidden ? ' (removed)' : '') + '</td><td><button class="btn soft sm" type="button" data-hide="' + esc(i.name) + '" data-h="' + (i.hidden ? '' : '1') + '">' + (i.hidden ? 'Put back' : 'Remove') + '</button></td></tr>'; }).join('') + '</table></div>';
    $$('[data-hide]').forEach(function (b) { b.onclick = function () {
      var h = !!b.dataset.h, g = ings.find(function (i) { return i.name === b.dataset.hide; }); if (g) g.hidden = h;
      record('ingHide', { name: b.dataset.hide, hidden: h }, b.dataset.hide + (h ? ' removed from the list' : ' put back'));
      route(); setTimeout(function () { $('#d_manage').click(); }, 50);
    }; });
  };
  $$('[data-fin]').forEach(function (b) { b.onclick = function () { record('lotStatus', { id: b.dataset.fin, status: 'Finished' }, 'Marked as used up'); route(); }; });
  if ($('#d_exsave')) $('#d_exsave').onclick = function () {
    var rows = $$('tr[data-ex]'), warm = [];
    rows.forEach(function (tr) {
      var g = function (k) { return tr.querySelector('[data-k=' + k + ']'); }, it = exp[Number(tr.dataset.ex)][0], t = num(g('temp').value);
      if (t !== '' && t > 5) warm.push(it);
      record('delivery', { id: uid(), date: cp.delivery, item: it, supplier: 'Strathroy', qty: num(g('qty').value), unit: 'L', useBy: g('use').value, temp: t, batch: g('batch').value.trim(), comment: g('ok').checked ? 'Received in good condition' : 'NOT OK – see Jonny', by: S.user }, it + ' saved');
    });
    toast('Strathroy delivery saved' + (warm.length ? ' – ' + warm.join(' & ') + ' above 5 °C, Jonny will be told' : '') + (rows.some(function (tr) { return tr.querySelector('[data-k=temp]').value === ''; }) ? ' (temperature missing on one line)' : ''));
    goNext('strathroy');
  };
  var fillScan = function (r, b, u) { if (!r || !r.ok) return toast((r && r.error) || 'Could not read the label'); if (r.batch) b.value = r.batch; if (r.useBy) u.value = r.useBy; [b, u].forEach(function (e) { e.style.background = '#fff4c2'; });
    toast(r.batch || r.useBy ? 'Read: ' + [r.batch && 'batch ' + r.batch, r.useBy && 'use by ' + nice(r.useBy)].filter(Boolean).join(', ') + ' – check it' : 'Couldn\'t find a batch number or date – type them in'); };
  $('#d_scan').onclick = function () { scanPhoto(function (r) { fillScan(r, $('#d_batch'), $('#d_use')); }); };
  $('#d_inv').onclick = function () {
    scanPhoto(function (r) {
      if (!r || !r.ok) return toast((r && r.error) || 'Could not read the invoice');
      var found = invoiceLots(r.text), sup = (D().ingredients || []).map(function (i) { return i.supplier; }).filter(function (x) { return x && r.text.toLowerCase().indexOf(String(x).toLowerCase()) >= 0; })[0] || '';
      if (!found.length) { $('#d_invout').innerHTML = '<div class="hint">No ingredients found on that invoice – fill in below.</div>'; return; }
      $('#d_invout').innerHTML = '<div class="card" style="border:2px solid #1c2140"><h2>From the invoice</h2><p class="small muted">Check each line, add anything missing, then save. Yellow = read from the photo.</p><div class="scroll"><table class="t"><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Batch no</th><th>Use by</th><th></th></tr>' +
        found.map(function (f, i) { var y = ' style="background:#fff4c2;width:110px"'; return '<tr data-iv="' + i + '"><td><b>' + esc(f.item) + '</b></td><td><input data-k="qty" inputmode="decimal" style="width:60px" value="' + esc(f.qty) + '"></td><td><input data-k="unit" style="width:60px" value="' + esc(f.unit) + '"></td><td><input data-k="batch"' + (f.batch ? y : ' style="width:110px"') + ' value="' + esc(f.batch) + '"></td><td><input data-k="use" type="date"' + (f.useBy ? ' style="background:#fff4c2"' : '') + ' value="' + esc(f.useBy) + '"></td><td><input type="checkbox" data-k="on" checked style="width:22px;height:22px"></td></tr>'; }).join('') +
        '</table></div>' + field('Supplier', inp('d_invsup', sup)) + '<button class="btn" id="d_invsave" type="button">Save these deliveries</button></div>';
      $('#d_invsave').onclick = function () {
        var n = 0;
        $$('tr[data-iv]').forEach(function (tr) { var g = function (k) { return tr.querySelector('[data-k=' + k + ']'); }; if (!g('on').checked) return; var f = found[Number(tr.dataset.iv)];
          record('delivery', { id: uid(), date: val('d_date') || today(), item: f.item, supplier: val('d_invsup'), qty: num(g('qty').value), unit: g('unit').value.trim(), useBy: g('use').value, temp: '', batch: g('batch').value.trim(), comment: 'From invoice photo', by: val('d_by') || S.user }); n++; });
        toast(n + ' deliver' + (n === 1 ? 'y' : 'ies') + ' saved'); route();
      };
      $('#d_invout').scrollIntoView({ behavior: 'smooth' });
    });
  };
  $$('[data-scan]').forEach(function (bt) { bt.onclick = function () { var tr = bt.closest('tr'); scanPhoto(function (r) { fillScan(r, tr.querySelector('[data-k=batch]'), tr.querySelector('[data-k=use]')); }); }; });
  // remembers the last unit and quantity for an item
  $('#d_item').addEventListener('change', function () { var l = (D().lots || []).filter(function (x) { return String(x.item).toLowerCase() === val('d_item').toLowerCase(); }).pop(); if (l) { if (!val('d_unit') && l.unit) $('#d_unit').value = l.unit; if (!val('d_qty') && l.qty !== '' && l.qty != null) $('#d_qty').placeholder = 'last time ' + l.qty; } });
};

/* ---------- ice cream stock take ---------- */
ROUTES.stock = function () {
  var per = setN('Small tubs per tray', 48), mine = isOwner(), t = today();
  if (mine && !S.own && navigator.onLine) loadOwn().then(function (x) { if (x && (location.hash || '').indexOf('#stock') === 0 && !$('#app').hasAttribute('data-dirty')) route(); });
  // Jonny sees the previous counts and the forecast; everyone else only sees what was entered today
  var hist = mine ? ((S.own && S.own.iceStock) || D().iceStock || []) : [];
  var last = {}; hist.forEach(function (x) { if (x.date < t && (!last[x.flavour] || last[x.flavour].date <= x.date)) last[x.flavour] = x; });
  var fc = {}; if (mine) ((S.own && S.own.insights && S.own.insights.flavours) || (D().insights && D().insights.flavours) || []).forEach(function (f) { fc[f.flavour] = f; });
  var todays = {}; (D().iceStock || []).forEach(function (x) { if (x.date === t) todays[x.flavour] = x; });
  var todayId = ((D().iceStock || []).filter(function (x) { return x.date === t && x.id; }).map(function (x) { return String(x.id).split(':')[0]; }).pop()) || '';
  var wk = function (w) { return w == null ? '–' : w <= 3 ? '<b style="color:#b3261e">' + w + '</b>' : w; };
  var cv = function (f, k) { var c = todays[f] || {}; return c[k] == null ? '' : c[k]; };
  // small tubs: trays only (half a tray = 0.5). Any loose tubs from an earlier count today are folded into the trays.
  var trayVal = function (f) { var tr = cv(f, 'trays'), lo = Number(cv(f, 'loose')) || 0; return tr === '' && !lo ? '' : r2((Number(tr) || 0) + lo / per, 2); };
  var inpF = function (f, k, v, mode) { return '<input data-ff="' + esc(f) + '" data-k="' + k + '" inputmode="' + (mode || 'numeric') + '" style="width:80px" value="' + esc(v) + '">'; };
  // a total typed instead of stacks × high is saved as the big tub count on its own
  var totVal = function (f) { return cv(f, 'stacks') === '' && cv(f, 'height') === '' && cv(f, 'lextra') !== '' ? cv(f, 'lextra') : ''; };
  var flv = D().flavours || [];
  render(back() + '<h1>Ice cream stock take</h1>' +
    '<p class="muted">Small tubs: count the full trays of ' + per + ' (half a tray is 0.5, e.g. 4.5). Big tubs: how many stacks × how many tubs high – or just type the total number of big tubs. Napolis: just count them. Anything not counted is highlighted – you can still save.</p>' +
    (todayId ? '<div class="hint">Today\'s count is filled in below – change anything and save again.</div>' : '') +
    '<div id="s_miss"></div>' +
    '<div class="card"><div class="grid2">' + field('Date', inp('s_date', t, 'date', mine ? '' : ' readonly')) + field('Counted by', staffSel('s_by', todayId ? ((D().iceStock || []).find(function (x) { return x.date === t; }) || {}).by : null)) + '</div></div>' +
    '<div class="card"><h2>Small tubs</h2><table class="t"><tr><th>Flavour</th><th>Trays</th><th>Small tubs</th>' + (mine ? '<th class="noprint">Last count</th><th class="noprint">Weeks left</th>' : '') + '</tr>' +
    flv.map(function (f) { var l = last[f], x = fc[f];
      return '<tr data-f="' + esc(f) + '"><td><b>' + esc(f) + '</b></td><td>' + inpF(f, 'trays', trayVal(f), 'decimal') + '</td><td class="stat" data-t="small" style="font-size:20px">–</td>' +
        (mine ? '<td class="muted small noprint">' + (l ? esc(short(l.date)) + ': ' + (l.small || 0) : '–') + '</td><td class="small noprint">' + (x ? wk(x.weeksLeftS) : '–') + '</td>' : '') + '</tr>'; }).join('') + '</table></div>' +
    '<div class="card"><h2>Big tubs</h2><table class="t"><tr><th>Flavour</th><th>Stacks</th><th>× high</th><th>or total</th><th>Big tubs</th>' + (mine ? '<th class="noprint">Last count</th><th class="noprint">Weeks left</th>' : '') + '</tr>' +
    flv.map(function (f) { var l = last[f], x = fc[f];
      return '<tr data-f2="' + esc(f) + '"><td><b>' + esc(f) + '</b></td><td>' + inpF(f, 'stacks', cv(f, 'stacks')) + '</td><td>' + inpF(f, 'height', cv(f, 'height')) + '</td><td>' + inpF(f, 'ltot', totVal(f)) + '</td><td class="stat" data-t="large" style="font-size:20px">–</td>' +
        (mine ? '<td class="muted small noprint">' + (l ? esc(short(l.date)) + ': ' + (l.large || 0) : '–') + '</td><td class="small noprint">' + (x ? wk(x.weeksLeftL) : '–') + '</td>' : '') + '</tr>'; }).join('') + '</table></div>' +
    '<div class="card"><h2>Napolis</h2><table class="t"><tr><th>Flavour</th><th>Napolis</th>' + (mine ? '<th class="noprint">Last count</th>' : '') + '</tr>' +
    flv.map(function (f) { var l = last[f];
      return '<tr data-f3="' + esc(f) + '"><td><b>' + esc(f) + '</b></td><td>' + inpF(f, 'napolis', cv(f, 'napolis')) + '</td>' + (mine ? '<td class="muted small noprint">' + (l && l.napolis ? esc(short(l.date)) + ': ' + l.napolis : '–') + '</td>' : '') + '</tr>'; }).join('') + '</table></div>' +
    '<div class="bar"><button class="btn" id="s_save">Save stock take</button></div>');
  var AMBER = '#fff4d6';
  function calc(tr) {
    var f = tr.dataset.f, el = function (k) { return $$('[data-k=' + k + ']').find(function (e) { return e.dataset.ff === f; }); };
    var g = function (k) { return Number(el(k).value) || 0; };
    var tubIn = ['stacks', 'height', 'ltot', 'trays'].some(function (k) { return el(k).value !== ''; });
    var useTot = el('ltot').value !== '';
    var odd = useTot || cv(f, 'stacks') === '' ? 0 : (Number(cv(f, 'lextra')) || 0); // odd big tubs from an older count today are kept
    var L = useTot ? Math.round(g('ltot')) : g('stacks') * g('height') + odd, Sm = Math.round(g('trays') * per);
    el('stacks').style.opacity = el('height').style.opacity = useTot ? '0.4' : '';
    var big = $$('tr[data-f2]').find(function (r) { return r.dataset.f2 === f; });
    tr.querySelector('[data-t=small]').textContent = el('trays').value !== '' ? Sm : '–';
    big.querySelector('[data-t=large]').textContent = useTot || el('stacks').value !== '' || el('height').value !== '' ? L : '–';
    tr.style.background = tubIn ? '' : AMBER; big.style.background = tubIn ? '' : AMBER;
    return { any: tubIn, flavour: f, stacks: useTot ? '' : num(el('stacks').value), height: useTot ? '' : num(el('height').value), lextra: useTot ? L : (odd || ''), large: L, trays: num(el('trays').value), loose: '', small: Sm, napolis: num(el('napolis').value) };
  }
  function missing() {
    var rows = $$('tr[data-f]').map(calc), notC = rows.filter(function (r) { return !r.any; }).map(function (r) { return r.flavour; });
    var noNap = rows.every(function (r) { return r.napolis === ''; });
    $$('[data-k=napolis]').forEach(function (e) { e.style.background = noNap ? AMBER : ''; });
    var msgs = [];
    if (notC.length && notC.length < rows.length) msgs.push('Not counted yet: <b>' + notC.map(esc).join(', ') + '</b>');
    if (noNap) msgs.push('No Napolis counted');
    if (!val('s_by')) msgs.push('Who counted isn\'t chosen');
    $('#s_miss').innerHTML = msgs.length ? '<div class="due" style="background:' + AMBER + ';border-color:#e3c46b;color:#5a4300"><span>⚠️</span><span>' + msgs.join(' · ') + '. You can still save.</span></div>' : '';
    return rows;
  }
  $$('#app input, #app select').forEach(function (e) { e.addEventListener('input', function () { $('#app').setAttribute('data-dirty', '1'); missing(); }); e.addEventListener('change', missing); });
  missing();
  $('#s_save').onclick = function () {
    var rows = missing(), counted = rows.filter(function (r) { return r.any || r.napolis !== ''; });
    if (!counted.length) return toast('Nothing counted yet');
    counted.forEach(function (r) { delete r.any; });
    var by = val('s_by') || S.user, skipped = rows.length - counted.length;
    record('iceStock', { id: val('s_date') === t && todayId ? todayId : uid(), date: val('s_date'), by: by, counts: counted }, 'Stock take saved' + (skipped ? ' – ' + skipped + ' flavour' + (skipped > 1 ? 's' : '') + ' not counted' : ''));
    $('#app').removeAttribute('data-dirty'); location.hash = 'home';
  };
};

/* ---------- ingredient stock count (any unit, remembered) + cleaning products + reorder ---------- */
ROUTES.ingstock = function () {
  // packaging has its own tab, so it's left out here
  var ings = (D().ingredients || []).filter(function (i) { return i.track && !/packag/i.test(i.category || ''); });
  var last = {}; (D().ingStock || []).forEach(function (x) { if (!last[x.ingredient] || last[x.ingredient].date <= x.date) last[x.ingredient] = x; });
  var onOrder = {}; (D().toOrder || []).forEach(function (o) { onOrder[String(o.item).toLowerCase()] = o; });
  var cats = {}; ings.forEach(function (i) { (cats[i.category || 'Other'] = cats[i.category || 'Other'] || []).push(i); });
  var catNames = Object.keys(cats).sort(function (a, b) { return (/clean/i.test(a) ? 1 : 0) - (/clean/i.test(b) ? 1 : 0) || (a < b ? -1 : 1); });
  var types = Array.from(new Set(['bags', 'buckets', 'tubs', 'boxes', 'slabs', 'jars', 'bottles', 'cans', 'sacks', 'packs', 'rolls', 'tins'].concat(ings.map(function (i) { return i.packType; }).filter(Boolean))));
  var W = /^(kg|g|l|ml|litres?)$/i;
  var sizeU = function (i) { return W.test(i.countUnit || '') ? i.countUnit : (W.test(i.unit || '') ? i.unit : (i.name ? 'each' : 'kg')); };
  var mixOf = {}; if (isOwner()) ((S.own && S.own.insights && S.own.insights.ingredients) || []).forEach(function (g) { if (g.mixL && g.mixL.length) mixOf[g.name] = g.mixL; });
  var cell = function (k, v, w, ph, extra) { return '<input data-k="' + k + '" value="' + esc(v == null ? '' : v) + '" style="width:' + w + 'px" placeholder="' + ph + '"' + (extra || '') + '>'; };
  var line = function (i) {
    if (/brownie/i.test(i.name || '')) return '<td style="white-space:nowrap">' + cell('slabs', '', 60, 'slabs', ' inputmode="decimal"') + ' slabs <span class="muted">+</span> ' + cell('bkts', '', 60, 'buckets', ' inputmode="decimal"') + ' buckets <b data-t="tot" class="small"></b></td>';
    return '<td style="white-space:nowrap">' + cell('qty', '', 60, 'No.', ' inputmode="decimal"') + ' <span class="muted">×</span> ' +
      cell('psize', i.packSize === '' || i.packSize == null ? '' : i.packSize, 64, 'size', ' inputmode="decimal"') + ' ' +
      '<select data-k="sunit" style="width:76px">' + ['kg', 'g', 'L', 'ml', 'each'].map(function (u) { return '<option' + (u.toLowerCase() === String(sizeU(i)).toLowerCase() ? ' selected' : '') + '>' + u + '</option>'; }).join('') + '</select>' +
      ' <b data-t="tot" class="small"></b></td>';
  };
  // once everything has been counted, this page shows what's in stock now (last count + deliveries – what batches used)
  var now = {}; (D().ingNow || []).forEach(function (g) { now[g.name] = g; });
  var hasCounts = (D().ingNow || []).some(function (g) { return g.est != null; }), showFull = !!S.fullCount;
  var amt = function (q, u) { if (q == null) return '<span class="muted">not counted yet</span>'; var lu = String(u || '').toLowerCase(); return lu === 'g' && q >= 1000 ? r2(q / 1000, 2) + ' kg' : lu === 'kg' && q < 1 ? Math.round(q * 1000) + ' g' : (Math.round(q * 100) / 100).toLocaleString('en-GB') + ' ' + esc(u || ''); };
  // batch numbers & best before dates: entered on this page, plus any deliveries since the last count
  var soon = new Date(); soon.setMonth(soon.getMonth() + 2); var soonIso = soon.toISOString().slice(0, 10), todayIso = today();
  var lotsOn = function (n) {
    var x = now[n] || {}, st = (D().stockLots || {})[n], out = ((st && st.lots) || []).map(function (l) { return { batch: l.batch, bb: l.bb }; });
    var since = x.counted || '';
    (D().lots || []).forEach(function (l) { if (l.status !== 'Finished' && String(l.item).toLowerCase() === n.toLowerCase() && (!since || l.date > since)) out.push({ batch: l.batch, bb: /^\d{4}-\d{2}-\d{2}$/.test(l.useBy || '') ? l.useBy : '', del: true }); });
    return out;
  };
  var bbTag = function (bb) {
    if (!bb) return '';
    var d = parse(bb), txt = d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : bb;
    if (bb < todayIso) return '<b style="color:#b3261e">BB ' + esc(txt) + ' – out of date</b>';
    if (bb < soonIso) return '<b style="color:#b3261e">BB ' + esc(txt) + ' ⚠</b>';
    return 'BB ' + esc(txt);
  };
  var lotsHtml = function (n) {
    return lotsOn(n).map(function (l) { return '<div class="small">' + (l.batch ? 'Batch <b>' + esc(l.batch) + '</b>' : '<span class="muted">no batch no.</span>') + (l.bb ? ' · ' + bbTag(l.bb) : '') + (l.del ? ' <span class="muted">(delivery)</span>' : '') + '</div>'; }).join('') || '<span class="small muted">–</span>';
  };
  var isSoon = function (n) { return lotsOn(n).some(function (l) { return l.bb && l.bb < soonIso; }); };
  // how many batches what's in stock will make (base mix amount for base ingredients, otherwise the flavour that uses it)
  var fam = function (u) { u = String(u || '').toLowerCase(); return u === 'kg' || u === 'g' ? 'w' : u === 'l' || u === 'ml' || /litre/.test(u) ? 'v' : u; };
  var toB = function (q, u) { u = String(u || '').toLowerCase(); return u === 'g' || u === 'ml' ? q / 1000 : q; };
  var batchesOf = function (n, x) {
    if (x.est == null) return '';
    var BL = setN('Base mix litres', 300), rs = (D().recipe || []).filter(function (r) { return String(r.ingredient).toLowerCase() === n.toLowerCase() && Number(r.amount) > 0; });
    var r = rs.find(function (q) { return q.flavour === 'All flavours (base mix)'; }) || rs[0]; if (!r || fam(r.unit) !== fam(x.unit)) return '';
    var per = toB(Number(r.amount) / perOf(r) * BL, r.unit); if (!per) return '';
    var b = toB(Number(x.est), x.unit) / per;
    return ' · enough for about <b>' + (b < 10 ? r2(b, 1) : Math.floor(b)) + ' × ' + BL + ' L batch' + (r2(b, 1) === 1 ? '' : 'es') + '</b>' + (r.flavour === 'All flavours (base mix)' ? '' : ' of ' + esc(r.flavour));
  };
  // e.g. 15 kg = 3 bags
  var packsOf = function (n, x) {
    var i = (D().ingredients || []).find(function (q) { return q.name === n; }) || {};
    if (x.est == null || !i.packSize) return '';
    var pu = i.countUnit || i.unit; if (fam(pu) !== fam(x.unit)) return '';
    var k = toB(Number(x.est), x.unit) / toB(Number(i.packSize), pu);
    var t = String(i.packType || 'pack').replace(/s$/, ''); if (r2(k, 1) !== 1) t += 's';
    return ' <span class="muted">– ' + r2(k, 1) + ' ' + esc(t) + '</span>';
  };
  var units = ['kg', 'g', 'L', 'ml', 'each', 'buckets'];
  var catList = Array.from(new Set(catNames.concat(['Dry goods', 'Flavouring', 'Cleaning products', 'Other'])));
  var curHtml = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">In stock now</h2><button class="btn soft sm" type="button" id="i_full">' + (showFull ? 'Hide the full count' : 'Do a full count') + '</button></div>' +
    '<p class="muted small">Worked out from the last count, plus deliveries, less what the batches used. Tap <b>Edit</b> to put in what\'s really there, with its batch numbers and best before dates. Anything with less than 2 months left is shown in <b style="color:#b3261e">red</b>.</p>' +
    delGroups((D().ingredients || []).filter(function (i) { return i.track !== false && !/packag/i.test(i.category || ''); })).map(function (g) {
      return '<h3>' + esc(g[0]) + '</h3><div class="scroll"><table class="t">' + g[1].map(function (n) {
        var x = now[n] || {};
        return '<tr data-cur="' + esc(n) + '"' + (isSoon(n) ? ' style="background:#fdecea"' : '') + '><td>' + esc(n) + '</td><td data-amt><b>' + amt(x.est, x.unit) + '</b>' + packsOf(n, x) + (x.counted ? '<br><span class="small muted">counted ' + esc(short(x.counted)) + batchesOf(n, x) + '</span>' : '') + '</td><td data-lots>' + lotsHtml(n) + '</td><td style="width:70px"><button class="btn soft sm" type="button" data-edit="' + esc(n) + '">Edit</button></td></tr>';
      }).join('') + '</table></div>';
    }).join('') + '</div>' +
    '<div class="card"><h2>Add a new item</h2><p class="muted small">For something that isn\'t on the list yet.</p>' +
    '<div class="grid2">' + field('Item', '<input id="n_name" placeholder="e.g. Pistachio paste">') + field('Section', '<select id="n_cat">' + catList.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>') + '</div>' +
    '<div class="grid2">' + field('How much is there', '<span style="display:flex;gap:6px"><input id="n_qty" inputmode="decimal" style="width:110px"><select id="n_unit">' + units.map(function (u) { return '<option>' + u + '</option>'; }).join('') + '</select></span>') + field('Supplier (if known)', '<input id="n_sup" list="dl_sups2">') + '</div>' +
    '<div id="n_lots"></div><button class="btn soft sm" type="button" id="n_addlot">+ another batch</button>' +
    '<div class="bar"><button class="btn" type="button" id="n_save">Save new item</button></div></div>';
  render(back() + '<h1>Stock – ingredients & cleaning products</h1>' + curHtml + '<div id="i_fullbox"' + (showFull ? '' : ' style="display:none"') + '><p class="muted">Put how many and the size of each, e.g. <b>8</b> × <b>25</b> kg sugar, <b>2</b> × <b>3</b> kg bubblegum. For things like bleach just put how many and choose <b>each</b>. Sizes are remembered for next time. Leave a line empty if you didn\'t count it. Packaging is counted on the Packaging stock tab.</p>' +
    '<div class="card"><div class="grid2">' + field('Date', inp('i_date', today(), 'date')) + field('Counted by', staffSel('i_by')) + '</div></div>' +
    catNames.map(function (c) {
      return '<div class="card scroll"><h2>' + esc(c) + '</h2><table class="t">' + cats[c].map(function (i) {
        var l = last[i.name], oo = onOrder[String(i.name).toLowerCase()];
        return '<tr data-ing="' + esc(i.name) + '" data-cat="' + esc(c) + '" data-re="' + esc(i.reorderAt === '' || i.reorderAt == null ? '' : i.reorderAt) + '"><td>' + esc(i.name) + (i.reorderAt !== '' && i.reorderAt != null ? '<br><span class="small muted">reorder at ' + esc(i.reorderAt) + '</span>' : '') + '</td>' +
          line(i) +
          '<td style="width:130px">' + (oo ? '<span class="pill ok">On the order list</span>' : '<button class="btn soft sm" data-reorder="' + esc(i.name) + '" type="button">Reorder</button>') + '</td>' +
          '<td class="muted small">' + (l && isOwner() ? 'last ' + (l.packs !== '' && l.packs != null && l.packSize ? esc(l.packs) + ' × ' + esc(l.packSize) + ' = ' : '') + esc(l.qty) + ' ' + esc(l.unit || '') + ' (' + esc(short(l.date)) + ')' : '') +
          (mixOf[i.name] ? '<br><b style="color:#1c2140">≈ ' + mixOf[i.name].map(function (m) { return m.litres.toLocaleString('en-GB') + ' L of mix' + (m.flavour === 'any flavour' ? '' : ' (' + esc(m.flavour) + ')'); }).join(', ') + '</b>' : '') + '</td></tr>';
      }).join('') + '</table></div>';
    }).join('') +
    '<div class="card scroll"><h2>Something not on the list?</h2><table class="t" id="i_new"></table><button class="btn soft sm" id="i_addrow" type="button">+ Add another</button></div>' +
    '<div class="bar"><button class="btn" id="i_save">Save count</button></div></div>' +
    '');
  if ($('#i_full')) $('#i_full').onclick = function () { S.fullCount = !S.fullCount; var on = $('#i_fullbox').style.display === 'none'; $('#i_fullbox').style.display = on ? '' : 'none'; this.textContent = on ? 'Hide the full count' : 'Do a full count'; };
  // one line per batch: batch number + best before date
  var lotLine = function (l) { return '<div data-lot style="display:flex;gap:6px;align-items:center;margin:4px 0;flex-wrap:wrap"><input data-b placeholder="Batch no." value="' + esc((l && l.batch) || '') + '" style="width:130px"><input data-bb type="date" value="' + esc((l && l.bb) || '') + '" style="width:150px"><span class="small muted">best before</span></div>'; };
  var readLots = function (box) { return $$('[data-lot]', box).map(function (r) { return { batch: r.querySelector('[data-b]').value.trim(), bb: r.querySelector('[data-bb]').value }; }).filter(function (l) { return l.batch || l.bb; }); };
  $$('[data-edit]').forEach(function (b) { b.onclick = function () {
    var n = b.dataset.edit, x = now[n] || {}, ing = (D().ingredients || []).find(function (i) { return i.name === n; }) || {}, u = x.unit || ing.unit || '';
    var tr = b.closest('tr'), td = tr.querySelector('[data-amt]'), tl = tr.querySelector('[data-lots]');
    var st = (D().stockLots || {})[n], have = (st && st.lots) || [];
    td.innerHTML = '<span style="display:flex;gap:6px;align-items:center"><input type="number" inputmode="decimal" style="width:100px" value="' + (x.est == null ? '' : Math.round(x.est * 100) / 100) + '"> ' + (u ? esc(u) : '<select data-u>' + units.map(function (z) { return '<option>' + z + '</option>'; }).join('') + '</select>') + '</span>';
    tl.innerHTML = '<div data-box>' + (have.length ? have : [{}]).map(lotLine).join('') + '</div><button class="btn soft sm" type="button" data-more>+ another batch</button> <button class="btn sm" type="button" data-save>Save</button>';
    b.style.display = 'none';
    var inpt = td.querySelector('input'); inpt.focus(); inpt.select();
    tl.querySelector('[data-more]').onclick = function () { tl.querySelector('[data-box]').insertAdjacentHTML('beforeend', lotLine({})); };
    tl.querySelector('[data-save]').onclick = function () {
      var q = num(inpt.value); if (q === '') return toast('Put in how much is there');
      var uu = u || td.querySelector('[data-u]').value, lots = readLots(tl);
      if (!bbOk(lots.map(function (l) { return { name: n + (l.batch ? ' (batch ' + l.batch + ')' : ''), bb: l.bb }; }))) return;
      record('ingStock', { id: uid(), date: today(), by: S.user, counts: [{ ingredient: n, qty: q, unit: uu, lots: lots }] }, n + ' updated');
      now[n] = Object.assign({}, x, { est: q, counted: today(), unit: uu });
      D().stockLots = D().stockLots || {}; if (lots.length) D().stockLots[n] = { date: today(), lots: lots }; else delete D().stockLots[n];
      save(LS.data, S.data);
      td.innerHTML = '<b>' + amt(q, uu) + '</b>' + packsOf(n, now[n]) + '<br><span class="small muted">counted ' + esc(short(today())) + batchesOf(n, now[n]) + '</span>';
      tl.innerHTML = lotsHtml(n); tr.style.background = isSoon(n) ? '#fdecea' : ''; b.style.display = '';
    };
  }; });
  // add a brand-new item with its batch numbers
  $('#n_lots').innerHTML = lotLine({});
  $('#n_addlot').onclick = function () { $('#n_lots').insertAdjacentHTML('beforeend', lotLine({})); };
  $('#n_save').onclick = function () {
    var name = val('n_name'), q = num(val('n_qty')), uu = val('n_unit'), cat = val('n_cat');
    if (!name) return toast('What is the item called?');
    if ((D().ingredients || []).some(function (i) { return i.name.toLowerCase() === name.toLowerCase(); })) return toast(name + ' is already on the list – use its Edit button');
    if (q === '') return toast('Put in how much is there');
    var lots = readLots($('#n_lots'));
    if (!bbOk(lots.map(function (l) { return { name: name + (l.batch ? ' (batch ' + l.batch + ')' : ''), bb: l.bb }; }))) return;
    record('ingStock', { id: uid(), date: today(), by: S.user, counts: [{ ingredient: name, qty: q, unit: uu, category: cat, supplier: val('n_sup'), lots: lots }] }, name + ' added');
    (D().ingredients = D().ingredients || []).push({ name: name, unit: uu, category: cat, supplier: val('n_sup'), track: true });
    (D().ingNow = D().ingNow || []).push({ name: name, unit: uu, est: q, counted: today() });
    D().stockLots = D().stockLots || {}; if (lots.length) D().stockLots[name] = { date: today(), lots: lots };
    save(LS.data, S.data); route();
  };
  var catOpts = Array.from(new Set(catNames.concat(['Dry goods', 'Flavouring', 'Cleaning products', 'Other'])));
  function addRow() { var tr = document.createElement('tr'); tr.className = 'newing'; tr.innerHTML = '<td><input placeholder="Name, e.g. Sugar" data-k="name"></td>' + line({}) + '<td><select data-k="cat">' + catOpts.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></td><td><input placeholder="Who supplies it? (if known)" data-k="sup" list="dl_sups2"></td>'; $('#i_new').appendChild(tr); wire(tr); }
  $('#i_new').insertAdjacentHTML('afterend', '<datalist id="dl_sups2">' + Array.from(new Set((D().ingredients || []).map(function (i) { return i.supplier; }).filter(Boolean))).sort().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist>');
  function read(tr) {
    var g = function (k) { return tr.querySelector('[data-k=' + k + ']').value.trim(); };
    if (tr.querySelector('[data-k=slabs]')) { // 2 slabs chop into one bucket
      var sl = num(g('slabs')), bk = num(g('bkts'));
      if (sl === '' && bk === '') return { packs: '', packType: '', packSize: '', sizeUnit: 'buckets', qty: '' };
      return { packs: '', packType: '', packSize: '', sizeUnit: 'buckets', qty: Math.round(((Number(sl) || 0) / 2 + (Number(bk) || 0)) * 100) / 100, unit: 'buckets', note: (sl || 0) + ' slabs + ' + (bk || 0) + ' buckets' };
    }
    var n = num(g('qty')), size = num(g('psize')), su = g('sunit');
    if (su === 'each') size = '';
    var c = { packs: n, packType: '', packSize: size, sizeUnit: su };
    if (n === '') { c.qty = ''; return c; }
    if (size !== '' && size > 0) { c.qty = Math.round(n * size * 1000) / 1000; c.unit = su; } else { c.qty = n; c.unit = 'each'; }
    return c;
  }
  // show the total and highlight anything at or below its reorder level as it's counted
  function check(tr) {
    var c = read(tr), t = tr.querySelector('[data-t=tot]');
    if (t) t.textContent = c.qty !== '' && (c.packSize !== '' && c.packSize > 0 || c.note) ? '= ' + c.qty + ' ' + c.unit : '';
    var re = tr.dataset.re, b = tr.querySelector('[data-reorder]');
    var low = re !== undefined && re !== '' && c.packs !== '' && c.packs <= Number(re);
    tr.style.background = low ? '#fdecea' : '';
    if (b) { b.className = low ? 'btn sm' : 'btn soft sm'; b.style.background = low ? '#b3261e' : ''; b.textContent = low ? 'Reorder ‼' : 'Reorder'; }
  }
  function wire(tr) { $$('input,select', tr).forEach(function (e) { e.addEventListener('input', function () { check(tr); }); e.addEventListener('change', function () { check(tr); }); }); }
  $$('tr[data-ing]').forEach(wire);
  addRow(); $('#i_addrow').onclick = addRow;
  $$('[data-reorder]').forEach(function (b) {
    b.onclick = function () {
      var tr = b.closest('tr');
      record('reorder', { id: uid(), item: b.dataset.reorder, category: tr.dataset.cat, by: val('i_by') || S.user }, b.dataset.reorder + ' added to the order list');
      (D().toOrder = D().toOrder || []).push({ item: b.dataset.reorder, by: S.user, date: today() });
      b.outerHTML = '<span class="pill ok">On the order list</span>';
    };
  });
  $('#i_save').onclick = function () {
    var counts = $$('tr[data-ing]').map(function (tr) { return Object.assign({ ingredient: tr.dataset.ing }, read(tr)); }).filter(function (c) { return c.qty !== ''; });
    $$('tr.newing').forEach(function (tr) { var n = tr.querySelector('[data-k=name]').value.trim(); if (n) { var c = read(tr); if (c.qty === '') { c.qty = 0; c.packs = 0; c.unit = c.packSize ? c.sizeUnit : 'each'; } counts.push(Object.assign({ ingredient: n, supplier: tr.querySelector('[data-k=sup]').value.trim(), category: tr.querySelector('[data-k=cat]').value }, c)); } });
    if (!counts.length) return toast('Nothing counted yet');
    if (!packOk(counts.filter(function (c) { return c.packSize !== '' && c.packSize != null; }).map(function (c) { var g = (D().ingredients || []).find(function (i) { return i.name === c.ingredient; }) || {}; return { name: c.ingredient, packSize: c.packSize, packUnit: c.sizeUnit, unit: g.unit }; }))) return;
    var notC = $$('tr[data-ing]').length - counts.filter(function (c) { return !c.supplier && c.category === undefined; }).length;
    counts.forEach(function (c) { var g = (D().ingredients || []).find(function (i) { return i.name === c.ingredient; }); if (g) { if (c.packType) g.packType = c.packType; if (c.packSize !== '') g.packSize = c.packSize; if (c.packSize !== '') g.countUnit = c.sizeUnit; } });
    record('ingStock', { id: uid(), date: val('i_date'), by: val('i_by') || S.user, counts: counts }, 'Count saved' + (notC > 0 ? ' – ' + notC + ' item' + (notC > 1 ? 's' : '') + ' not counted' : ''));
    location.hash = 'home';
  };
};

/* ---------- shop orders: packing (no prices on staff devices) ---------- */
function batchesFor(flavour) {
  return (D().batches || []).filter(function (b) { return b.flavour === flavour && b.tub && b.status !== 'Finished'; }).sort(function (a, b) { return Number(a.no) - Number(b.no); });
}
ROUTES.packing = function (no) {
  var orders = (D().orders || []).filter(function (o) { return o.status === 'Confirmed' || o.status === 'Packing'; });
  if (!no) {
    var done = (D().orders || []).filter(function (o) { return o.status === 'Packed'; }).slice(-10).reverse();
    if (isOwner()) setTimeout(shopSumList, 0);
    return render(back() + '<h1>Shop orders</h1>' + (isOwner() ? '<div class="card" id="shopsums"><h2>Shops</h2><p class="muted small">Loading…</p></div>' : '') + '<div class="card"><h2>To pack</h2><div class="list">' + (orders.map(function (o) {
      return '<a class="row" href="#packing/' + encodeURIComponent(o.no) + '"><span><b>' + esc(o.shop) + '</b> · ' + esc(o.no) + '<br><span class="muted">' + esc(nice(o.date)) + ' · ' + (o.small || 0) + ' small, ' + (o.large || 0) + ' large</span></span><span class="pill warn">' + esc(o.status === 'Packing' ? 'Started' : 'To pack') + '</span></a>';
    }).join('') || '<p class="muted">No orders waiting.</p>') + '</div></div>' +
      (!isOwner() ? '' : '<div class="card"><h2>Recently packed</h2><div class="list">' + (done.map(function (o) { return '<a class="row" href="#packing/' + encodeURIComponent(o.no) + '"><span>' + esc(o.shop) + ' · ' + esc(o.no) + '<br><span class="muted">' + esc(o.packedBy || '') + '</span></span><span class="pill ok">Packed</span></a>'; }).join('') || '<p class="muted">None yet.</p>') + '</div></div>'));
  }
  var o = (D().orders || []).find(function (x) { return String(x.no) === String(no); });
  if (!o) return render(back('packing', 'Orders') + '<div class="card">Order not found.</div>');
  var lines = (o.lines || []).map(function (l) { return Object.assign({}, l); });
  var BS = setN('Small tubs per box', 115), BL = setN('Large tubs per box', 36);
  var sm = lines.filter(function (l) { return l.size !== 'large'; }).reduce(function (a, l) { return a + Number(l.qty); }, 0), lg = lines.filter(function (l) { return l.size === 'large'; }).reduce(function (a, l) { return a + Number(l.qty); }, 0);
  render(back('packing', 'Orders') + '<h1>' + esc(o.shop) + '</h1><p class="muted">' + esc(o.no) + ' · ' + esc(nice(o.date)) + (o.notes ? ' · ' + esc(o.notes) : '') + '</p>' +
    '<div class="card"><table class="t"><tr><th>Qty</th><th>Flavour</th><th>Size</th><th>Batch number</th></tr>' + lines.map(function (l, i) {
      var bs = batchesFor(l.flavour), def = l.batch || (bs[0] ? bs[0].no : '');
      l.batch = def;
      return '<tr><td><b>' + esc(l.qty) + '</b></td><td>' + esc(l.flavour) + '</td><td>' + esc(l.size) + '</td><td><select data-i="' + i + '">' +
        opt(bs.map(function (b) { return { v: b.no, t: b.no + ' (tubbed ' + short(b.tub) + ')' }; }).concat(def && !bs.some(function (b) { return String(b.no) === String(def); }) ? [{ v: def, t: def }] : []), def, 'Choose…') +
        '<option value="__other">Other…</option></select></td></tr>';
    }).join('') + '</table>' +
    '<p class="muted">' + sm + ' small (' + Math.ceil(sm / BS) + ' box' + (Math.ceil(sm / BS) === 1 ? '' : 'es') + ')' + (lg ? ', ' + lg + ' large (' + Math.ceil(lg / BL) + ' box' + (Math.ceil(lg / BL) === 1 ? '' : 'es') + ')' : '') + '. Flavours can share a box.</p>' +
    '<div class="grid2">' + field('Packed by', staffSel('k_by', o.packedBy || S.user)) + '</div></div>' +
    '<div class="bar"><button class="btn alt" onclick="window.print()">Print packing list</button><button class="btn alt" id="k_part">Save for later</button><button class="btn" id="k_done">Packed ✓</button></div>');
  $$('select[data-i]').forEach(function (s) {
    s.onchange = function () {
      var l = lines[s.dataset.i];
      if (s.value === '__other') { var t = prompt('Batch number'); if (!t) { s.value = l.batch; return; } var op = document.createElement('option'); op.value = t; op.textContent = t; s.insertBefore(op, s.lastChild); s.value = t; }
      var bs = batchesFor(l.flavour), oldest = bs[0];
      if (oldest && s.value && String(s.value) !== String(oldest.no) && Number(s.value) > Number(oldest.no)) {
        if (confirm('Batch ' + oldest.no + ' of ' + l.flavour + ' is older. Is batch ' + oldest.no + ' finished (none left)?\n\nOK = yes, it\'s finished – take it off the list\nCancel = no, there\'s still some')) {
          record('batchStatus', { no: oldest.no, status: 'Finished' }, 'Batch ' + oldest.no + ' marked as finished');
        }
      }
      l.batch = s.value;
    };
  });
  function savePack(done) {
    if (!val('k_by')) return toast('Who packed it?');
    if (done && lines.some(function (l) { return !l.batch; }) && !confirm('Some lines have no batch number. Mark as packed anyway?')) return;
    record('pack', { no: o.no, lines: lines, done: done, by: val('k_by') }, done ? 'Order marked as packed' : 'Saved');
    location.hash = 'packing';
  }
  $('#k_part').onclick = function () { savePack(false); };
  $('#k_done').onclick = function () { savePack(true); };
};

/* ---------- messages & reminders ---------- */
ROUTES.messages = function () {
  var msgs = (D().messages || []).slice().reverse();
  render(back() + '<h1>Messages & reminders</h1><div class="card"><h2>New message</h2>' +
    '<div class="grid2">' + field('To', sel('m_to', [{ v: 'Jonny', t: 'Jonny' }, { v: 'Paul', t: 'Paul' }, { v: 'Both', t: 'Jonny & Paul' }, { v: 'Everyone', t: 'Everyone (shows on everyone\'s home screen)' }].concat(S.user === manager() || isOwner() ? [{ v: 'Jonny\'s to do', t: 'Jonny\'s to-do list (only Jonny sees it)' }] : []), S.user.indexOf('Jonny') === 0 ? 'Paul' : 'Jonny')) +
    field('Send it on (leave empty to send now)', inp('m_when', '', 'date')) + '</div>' +
    field('Message', '<textarea id="m_text" placeholder="e.g. Running low on large tubs – order more"></textarea>') +
    '<button class="btn" id="m_send">Send</button></div>' +
    '<div class="card"><h2>Sent</h2>' + (msgs.map(function (m) {
      return '<div class="row"><span><b>' + esc(m.from) + ' → ' + esc(m.to) + '</b> <span class="muted small">' + esc(nice(m.date)) + '</span><br>' + esc(m.text) + '</span><span class="pill' + (m.sent ? ' ok">sent' : ' warn">' + (m.remind ? 'on ' + esc(short(m.remind)) : 'sending')) + '</span></div>';
    }).join('') || '<p class="muted">No messages yet.</p>') + '</div>');
  $('#m_send').onclick = function () {
    if (!val('m_text')) return toast('Write a message first');
    record('message', { id: uid(), from: S.user, to: val('m_to'), text: val('m_text'), remind: val('m_when') }, /to do/i.test(val('m_to')) ? 'Added to Jonny\'s to-do list' : val('m_when') ? 'Reminder set for ' + short(val('m_when')) : (navigator.onLine ? 'Message sent' : 'Will send when back online'));
    route();
  };
};

/* ---------- recipes ---------- */
ROUTES.recipes = function (f) {
  var BASE = 'All flavours (base mix)', info = D().flavourInfo || [];
  var ltd = info.filter(function (x) { return /limited/i.test(x.type); }).map(function (x) { return x.name; });
  var flavours = [BASE].concat((D().flavours || []).filter(function (x) { return ltd.indexOf(x) < 0; }));
  f = f || BASE;
  var wb = f === BASE || usesBase(f);
  var base = setN('Base mix litres', 300), mine = isOwner();
  var saved = (D().recipe || []).filter(function (r) { return r.flavour === f; });
  var exists = saved.length > 0, locked = f === BASE && !mine;
  var lines = saved.map(function (r) { return { ingredient: r.ingredient, amount: r.amount, unit: r.unit, per: perOf(r) }; }).sort(function (a, b) { return inBase(b.amount / b.per, b.unit) - inBase(a.amount / a.per, a.unit); });
  if (!lines.length) lines.push({ ingredient: '', amount: '', unit: 'kg', per: base });
  var fi = info.find(function (x) { return x.name === f; }) || {};
  var reqs = (D().recipeRequests || []).filter(function (q) { return q.flavour === f; });
  var chip = function (x) { return '<a class="chip' + (x === f ? ' on' : '') + '" href="#recipes/' + encodeURIComponent(x) + '">' + esc(x === BASE ? 'Base mix' : x) + '</a>'; };
  render(back() + '<h1>Recipes</h1><div class="card noprint">' + flavours.map(chip).join('') +
    '<h3>Limited Edition</h3>' + (ltd.map(chip).join('') || '<span class="muted small">None saved yet. </span>') + '<a class="chip" href="#" id="r_newltd">+ New limited edition</a></div>' +
    reqs.map(function (q) {
      return '<div class="card" style="border:2px solid #b58a00"><h2>⏳ Change waiting for ' + esc(owner().split(' ')[0]) + '\'s OK</h2><p class="muted">Asked for by <b>' + esc(q.by) + '</b> on ' + esc(nice(q.date)) + (q.user && q.user !== q.by ? ' (on ' + esc(q.user) + '\'s app)' : '') + '. The recipe below stays as it is until it\'s approved.</p>' +
        '<table class="t"><tr><th>Ingredient</th><th>Amount</th><th>Unit</th><th>Litres</th></tr>' + (q.lines || []).map(function (l) { return '<tr><td>' + esc(l.ingredient) + '</td><td>' + esc(l.amount) + '</td><td>' + esc(l.unit) + '</td><td>' + esc(l.per || base) + '</td></tr>'; }).join('') + '</table>' +
        (q.notes ? '<p><b>Notes:</b> ' + esc(q.notes) + '</p>' : '') +
        (mine && !q.local ? '<div class="noprint"><button class="btn" data-ok="' + esc(q.id) + '">✓ Approve change</button> <button class="btn alt" data-no="' + esc(q.id) + '">Turn down</button></div>' : '') + '</div>';
    }).join('') +
    '<div class="card"><h2>' + esc(f) + (ltd.indexOf(f) >= 0 ? ' <span class="pill">Limited Edition</span>' : '') + '</h2><p class="muted">' + (f === BASE ? 'Every flavour uses the base mix, plus its own extras (except non-dairy flavours like sorbet).' : wb ? 'These are added on top of the base mix.' : '<b>This flavour doesn\'t use the dairy base mix</b> – list everything that goes in.') +
    ' <b>Litres</b> is how much mix the amount is for – 1 for per litre, ' + base + ' for a full batch.</p>' +
    (fi.savedBy ? '<p class="small muted">Saved by <b>' + esc(fi.savedBy) + '</b>' + (fi.savedOn ? ' on ' + esc(nice(fi.savedOn)) : '') + '</p>' : '') +
    (locked ? '<p class="hint">Only ' + esc(owner().split(' ')[0]) + ' can change the base mix. You can scale it below.</p>' : exists && !mine ? '<p class="hint noprint">Changes to a saved recipe go to ' + esc(owner().split(' ')[0]) + ' to approve first.</p>' : '') +
    '<table class="t" id="r_t"></table>' + (locked ? '' : '<button class="btn soft sm noprint" id="r_add" type="button">+ Add ingredient</button>') +
    (f === BASE ? '' : field('Notes / method', '<textarea id="r_notes" rows="4">' + esc(fi.notes || '') + '</textarea>')) +
    (locked || mine ? '' : '<div class="grid2 noprint">' + field(exists ? 'Your name (who is asking for the change)' : 'Your name (who is saving this recipe)', inp('r_name', '', 'text', ' autocomplete="off" placeholder="Type your full name"')) + '</div>') + '</div>' +
    '<div class="card noprint"><h2>Scale it</h2>' + field('Litres of mix', inp('r_l', base, 'number')) + '<div id="r_scaled"></div></div>' +
    '<div class="bar"><button class="btn alt" onclick="window.print()">Print</button>' + (locked ? '' : '<button class="btn" id="r_save">' + (exists && !mine ? 'Send change to ' + esc(owner().split(' ')[0]) : 'Save recipe') + '</button>') + '</div>');
  function draw() {
    if (locked) {
      $('#r_t').innerHTML = '<tr><th>Ingredient</th><th>Amount</th><th>Unit</th><th>Litres</th></tr>' + lines.map(function (l) { var d = disp(l.ingredient, l.amount, l.unit); return '<tr><td>' + esc(l.ingredient) + '</td><td><b>' + esc(d.q) + '</b></td><td>' + esc(d.unit) + '</td><td>' + esc(l.per) + '</td></tr>'; }).join('');
      return scale();
    }
    $('#r_t').innerHTML = '<tr><th>Ingredient</th><th>Amount</th><th>Unit</th><th>Litres</th><th></th></tr>' + lines.map(function (l, i) {
      return '<tr><td><input data-i="' + i + '" data-k="ingredient" value="' + esc(l.ingredient) + '" list="dl_ri"></td><td><input data-i="' + i + '" data-k="amount" inputmode="decimal" value="' + esc(l.amount) + '" style="width:100px"></td><td><input data-i="' + i + '" data-k="unit" value="' + esc(l.unit) + '" style="width:70px" list="dl_ru"></td>' +
        '<td><input data-i="' + i + '" data-k="per" inputmode="decimal" value="' + esc(l.per) + '" style="width:80px" title="Litres of mix this amount is for"></td><td><button class="btn soft sm" data-del="' + i + '">✕</button></td></tr>';
    }).join('') + '<datalist id="dl_ru"><option value="kg"><option value="g"><option value="L"><option value="ml"><option value="units"></datalist><datalist id="dl_ri">' + (D().ingredients || []).map(function (g) { return '<option value="' + esc(g.name) + '">'; }).join('') + '</datalist>';
    $$('#r_t input').forEach(function (e) { e.oninput = function () { lines[e.dataset.i][e.dataset.k] = e.value; scale(); }; });
    $$('#r_t [data-del]').forEach(function (b) { b.onclick = function () { lines.splice(Number(b.dataset.del), 1); draw(); }; });
    scale();
  }
  function scale() {
    var L = Number(val('r_l')) || base;
    var all = f === BASE || !wb ? lines : (D().recipe || []).filter(function (r) { return r.flavour === BASE; }).concat(lines);
    $('#r_scaled').innerHTML = '<table class="t">' + all.filter(function (l) { return l.ingredient; }).map(function (l) { var d = disp(l.ingredient, Number(l.amount) / perOf(l) * L, l.unit); return { ingredient: l.ingredient, qty: d.q, unit: d.unit }; }).sort(byAmount).map(function (l) { return '<tr><td>' + esc(l.ingredient) + '</td><td><b>' + l.qty + '</b> ' + esc(l.unit) + '</td></tr>'; }).join('') + '</table>';
  }
  draw(); $('#r_l').oninput = scale;
  $('#r_newltd').onclick = function (ev) { ev.preventDefault(); var n = (prompt('Name of the new limited edition flavour') || '').trim(); if (n) location.hash = 'recipes/' + encodeURIComponent(n); };
  if ($('#r_add')) $('#r_add').onclick = function () { lines.push({ ingredient: '', amount: '', unit: 'kg', per: base }); draw(); };
  var decide = function (id, ok) {
    if (!navigator.onLine) return toast('Needs the internet');
    ownerCall({ op: 'decide', id: id, approve: ok }).then(function (r) { toast(r.ok ? r.msg : (r.error || 'Could not do that')); sync(); }).catch(function () { toast('No connection'); });
  };
  $$('[data-ok]').forEach(function (b) { b.onclick = function () { decide(b.dataset.ok, true); }; });
  $$('[data-no]').forEach(function (b) { b.onclick = function () { if (confirm('Turn this change down? The recipe stays as it is.')) decide(b.dataset.no, false); }; });
  if ($('#r_save')) $('#r_save').onclick = function () {
    var ls = lines.filter(function (l) { return l.ingredient; }).map(function (l) { return { ingredient: l.ingredient, amount: num(l.amount) === '' ? 0 : num(l.amount), unit: l.unit, per: num(l.per) || base }; });
    if (!ls.length) return toast('Add at least one ingredient');
    if (ls.some(function (l) { return !l.amount; }) && !confirm('Some ingredients have no amount. Save anyway?')) return;
    var notes = f === BASE ? null : val('r_notes');
    if (mine) {
      if (f === BASE && !confirm('Change the base mix for every flavour?')) return;
      if (!navigator.onLine) return toast('Saving as ' + owner().split(' ')[0] + ' needs the internet');
      $('#r_save').disabled = true;
      return ownerCall({ op: 'recipe', d: { flavour: f, lines: ls, notes: notes } }).then(function (r) { toast(r.ok ? 'Recipe saved' : (r.error || 'Could not save')); $('#r_save').disabled = false; if (r.ok) { applyLocal({ type: 'recipe', data: { flavour: f, lines: ls, notes: notes, name: owner() } }, S.data); save(LS.data, S.data); sync(); route(); } })
        .catch(function () { $('#r_save').disabled = false; toast('No connection'); });
    }
    var name = val('r_name');
    if (name.length < 3) { toast('Type your name first'); return $('#r_name').focus(); }
    record('recipe', { flavour: f, lines: ls, notes: notes, name: name, request: exists }, exists ? 'Sent to ' + owner().split(' ')[0] + ' to approve' : 'Recipe saved');
    route();
  };
};

/* ---------- records: view & print ---------- */
ROUTES.records = function (kind, from, to) {
  kind = kind || 'pack'; var from0 = from; to = to || today(); from = from || addDays(to, -31); if (!from0 && kind === 'pack') from = '';
  var kinds = [['pack', '🖨️ Inspection pack'], ['batches', 'Batch records'], ['deliveries', 'Deliveries'], ['temps', 'Temperatures'], ['cleaning', 'Cleaning'], ['pest', 'Pest control']];
  if (!from && (kind || 'pack') === 'pack') { var mm = new Date(); mm.setDate(1); mm.setMonth(mm.getMonth() - 1); from = iso(mm); mm.setMonth(mm.getMonth() + 1); mm.setDate(0); to = iso(mm); }
  if ((kind === 'batches' || kind === 'pack' || !kind) && canPast() && !office() && !S.allB && navigator.onLine) loadPast().then(function (x) { if (x && (location.hash || '').indexOf('#records') === 0) route(); });
  if (isOwner()) kinds.push(['stock', 'Stock takes']); else if (kind === 'stock') kind = 'batches';
  if (kind === 'stock' && !S.own && navigator.onLine) loadOwn().then(function (x) { if (x && (location.hash || '').indexOf('#records/stock') === 0) route(); });
  var inRange = function (d) { return d && d >= from && d <= to; };
  function bodyFor(kind) {
  var body = '';
  if (kind === 'batches') {
    if (!canPast()) return '<div class="card muted">Batch records are kept on the office computer. ' + (S.user === manager() ? '<a href="#production">Open Production</a> and tap "Show past batches" to enter your passcode.' : '') + '</div>';
    var bs = pastBatches().filter(function (b) { return inRange(b.date) || inRange(b.tub); }).sort(function (a, b) { return Number(a.no) - Number(b.no); });
    body = bs.map(function (b) {
      return '<div class="card pagebreak"><h2>Batch ' + esc(b.no) + ' – ' + esc(b.flavour) + '</h2><table class="t">' +
        [['Date produced', nice(b.date)], ['Mix', b.mix ? b.mix + ' L' : ''], ['Pasteurisation start', b.start], ['Temperature reached', b.temp !== '' ? b.temp + ' °C' : ''], ['Held for', b.hold !== '' ? b.hold + ' mins' : ''],
          ['Cooling time', b.cool !== '' ? b.cool + ' mins' : ''], ['End temperature', b.end !== '' ? b.end + ' °C' : ''], ['Pasteurised by', b.pby], ['Best before', nice(b.bb)], ['Tubbed', nice(b.tub) + (b.tby ? ' by ' + b.tby : '')],
          ['Tubs', (b.small || 0) + ' small, ' + (b.large || 0) + ' big' + (b.napolis ? ', ' + b.napolis + ' Napolis' : '')], ['Labels checked', b.label || ''], ['Comments', b.comments]].map(function (r) { return '<tr><th style="width:190px">' + esc(r[0]) + '</th><td>' + esc(r[1] == null ? '' : r[1]) + '</td></tr>'; }).join('') + '</table>' +
        '<h3>Ingredients</h3><table class="t"><tr><th>Ingredient</th><th>Amount</th><th>Batch no</th><th>Use by</th></tr>' + (b.lines || []).map(function (l) { return '<tr><td>' + esc(l.ingredient) + '</td><td>' + esc(l.qty) + ' ' + esc(l.unit) + '</td><td>' + esc(l.batch) + '</td><td>' + esc(l.useBy) + '</td></tr>'; }).join('') + '</table></div>';
    }).join('') || '<div class="card muted">No batches in these dates.</div>';
  } else if (kind === 'deliveries') {
    var ls = (D().lots || []).filter(function (l) { return inRange(l.date); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    body = '<div class="card scroll"><table class="t"><tr><th>Date</th><th>Item</th><th>Supplier</th><th>Qty</th><th>Use by</th><th>Temp</th><th>Batch</th><th>Comment</th><th>Checked by</th></tr>' + ls.map(function (l) {
      return '<tr><td>' + esc(short(l.date)) + '</td><td>' + esc(l.item) + '</td><td>' + esc(l.supplier) + '</td><td>' + esc(l.qty) + ' ' + esc(l.unit || '') + '</td><td>' + esc(l.useBy) + '</td><td>' + esc(l.temp) + '</td><td>' + esc(l.batch) + '</td><td>' + esc(l.comment) + '</td><td>' + esc(l.by) + '</td></tr>';
    }).join('') + '</table></div>';
  } else if (kind === 'temps') {
    var units = D().units || [], ts = (D().temps || []).filter(function (t) { return inRange(t.date); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    body = '<div class="card scroll"><table class="t"><tr><th>Date</th>' + units.map(function (u) { return '<th>' + esc(u.name) + '</th>'; }).join('') + '<th>Initials</th><th>Action</th></tr>' + ts.map(function (t) {
      return '<tr><td>' + esc(nice(t.date)) + '</td>' + units.map(function (u) { var v = t.readings[u.name]; var bad = v !== undefined && v !== '' && (v < u.lo || v > u.hi); return '<td' + (bad ? ' style="color:#b3261e;font-weight:bold"' : '') + '>' + esc(v == null ? '' : v) + '</td>'; }).join('') + '<td>' + esc(t.initials) + '</td><td>' + esc(t.action) + '</td></tr>';
    }).join('') + '</table></div>';
  } else if (kind === 'cleaning') {
    var cs = (D().cleaning || []).filter(function (c) { return inRange(c.date); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    body = cs.map(function (c) { var ks = Object.keys(c.items || {}); return '<div class="card"><b>' + esc(nice(c.date)) + ' · ' + esc(c.list) + '</b> – confirmed by ' + esc(c.by) + (c.batch ? ' (batch ' + esc(c.batch) + ')' : '') + '<br><span class="small">' + ks.map(function (k) { return (c.items[k] ? '✓ ' : '✗ ') + esc(k); }).join(' · ') + '</span>' + (c.comments ? '<br><i>' + esc(c.comments) + '</i>' : '') + '</div>'; }).join('') || '<div class="card muted">Nothing in these dates.</div>';
  } else if (kind === 'pest') {
    body = '<div class="card"><table class="t"><tr><th>Date</th><th>Checked by</th><th>Issues</th><th>Action</th><th>Verified</th><th>Notes</th></tr>' + (D().pest || []).filter(function (p) { return inRange(p.date); }).map(function (p) { return '<tr><td>' + esc(nice(p.date)) + '</td><td>' + esc(p.by) + '</td><td>' + esc(p.issues) + '</td><td>' + esc(p.action) + '</td><td>' + esc(p.verified) + '</td><td>' + esc(p.notes) + '</td></tr>'; }).join('') + '</table></div>';
  } else if (kind === 'stock') {
    var byDate = {}; ((S.own && S.own.iceStock) || D().iceStock || []).filter(function (x) { return inRange(x.date); }).forEach(function (x) { (byDate[x.date] = byDate[x.date] || []).push(x); });
    body = Object.keys(byDate).sort().reverse().map(function (d) { return '<div class="card"><h2>' + esc(nice(d)) + '</h2><table class="t"><tr><th>Flavour</th><th>Large</th><th>Small</th><th>Counted by</th></tr>' + byDate[d].map(function (x) { return '<tr><td>' + esc(x.flavour) + '</td><td>' + esc(x.large) + '</td><td>' + esc(x.small) + '</td><td>' + esc(x.by) + '</td></tr>'; }).join('') + '</table></div>'; }).join('') || '<div class="card muted">No stock takes in these dates.</div>';
  }
  return body;
  }
  var body = kind === 'pack' ? '<div class="card noprint"><p>Everything an inspector usually asks for, for the dates above (last month to start with): temperatures, cleaning, pest control, deliveries' + (canPast() ? ' and batch records' : '') + '. Press <b>Print</b>.</p></div>' +
    [['temps', 'Fridge & freezer temperatures'], ['cleaning', 'Cleaning'], ['pest', 'Pest control'], ['deliveries', 'Deliveries in']].concat(canPast() ? [['batches', 'Batch records']] : []).map(function (k) { return '<h2 class="pagebreak" style="margin-top:18px">' + esc(k[1]) + '</h2>' + bodyFor(k[0]); }).join('') : bodyFor(kind);
  render(back() + '<h1>Records</h1><div class="card noprint">' + kinds.map(function (k) { return '<a class="chip' + (k[0] === kind ? ' on' : '') + '" href="#records/' + k[0] + '/' + from + '/' + to + '">' + k[1] + '</a>'; }).join('') +
    '<div class="grid3" style="margin-top:10px">' + field('From', inp('rf', from, 'date')) + field('To', inp('rt', to, 'date')) + '<div><button class="btn" onclick="window.print()" style="margin-top:22px">Print</button></div></div>' +
    '<p class="muted small">Shows the last few months kept on this device. Everything is also in the Dukes Production Google Sheet.' + (isOwner() ? ' A PDF of each month\'s records is emailed to you on the 1st.' : '') + '</p>' +
    (isOwner() ? '<button class="btn soft sm" id="r_pdf">📄 Make PDF of ' + esc(String(from || today()).slice(0, 7)) + ' (saved to Drive)</button>' : '') + '</div>' +
    '<div class="printonly"><h2>Dukes Ultra Premium Ice Cream – ' + esc((kinds.find(function (k) { return k[0] === kind; }) || [])[1]) + ', ' + esc(nice(from)) + ' to ' + esc(nice(to)) + '</h2></div>' + body);
  var go = function () { location.hash = 'records/' + kind + '/' + val('rf') + '/' + val('rt'); };
  $('#rf').onchange = go; $('#rt').onchange = go;
  if ($('#r_pdf')) $('#r_pdf').onclick = function () {
    var b = this; b.disabled = true; b.textContent = 'Making the PDF…';
    ownerCall({ op: 'fspack', month: String(from || today()).slice(0, 7) }).then(function (x) { if (x && x.url) { b.outerHTML = '<a class="btn sm" target="_blank" href="' + esc(x.url) + '">Open ' + esc(x.name) + ' ↗</a>'; } else { b.disabled = false; b.textContent = 'Try again'; toast((x && x.error) || 'Could not make the PDF'); } })
      .catch(function () { b.disabled = false; b.textContent = 'Try again'; toast('Needs the internet'); });
  };
};

/* ---------- office (Jonny only) ---------- */
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1LFMR9kXMjVzS5M8tx852HBwlc0C1LTbnsB8Wxsh17s8/edit';
ROUTES.office = function () {
  var mine = isOwner();
  var useLocal = mine && office() && D().insights;
  var go = function (data) { if ((location.hash || '').indexOf('#office') === 0) drawOffice(data, mine); };
  if (mine && S.own) { go(S.own); if (Date.now() - S.ownAt > 90000 && navigator.onLine) loadOwn(true).then(function (x) { if (x && !$('#app').hasAttribute('data-dirty')) go(x); }); return; }
  if (!mine && !mgrOK()) return mgrSignIn('office');
  if (S.user === manager() && S.mgr && Date.now() - S.mgrAt < 90000) return go(S.mgr);
  if (!navigator.onLine) {
    if (mine && (S.own || useLocal)) return go(S.own || { insights: D().insights });
    if (S.mgr) return go(S.mgr);
    return render(back() + '<h1>Office</h1><div class="card">The office page needs the internet.</div>');
  }
  render(back() + '<h1>Office</h1><p class="muted center">Loading…</p>');
  if (mine) loadOwn(true).then(function (x) { go(x || (useLocal ? { insights: D().insights } : { insights: {} })); });
  else mgrCall({}).then(function (r) { if (!r.ok) { if (r.needCode) { S.pcode = null; return route(); } toast(r.error || 'Could not open'); location.hash = 'home'; return; } S.mgr = r; S.mgrAt = Date.now(); go(r); })
    .catch(function () { render(back() + '<h1>Office</h1><div class="card">No connection.</div>'); });
};
// Paul's passcode opens Office and Weddings; it's kept only in memory and forgotten after 5 minutes without use
function loadWed() {
  if (S.wedP) return S.wedP;
  var p = isOwner() ? ownerCall({ op: 'weddings' }) : mgrCall({ op: 'weddings' });
  S.wedP = p.then(function (r) { S.wedP = null; if (r.ok) { S.wv = r; S.wvAt = Date.now(); S.wvFor = S.user; } return r; }).catch(function () { S.wedP = null; return null; });
  return S.wedP;
}
function mgrOK() { if (S.pcode && Date.now() - (S.pcodeAt || 0) < 5 * 60000 && S.pcodeFor === S.user) { S.pcodeAt = Date.now(); return true; } S.pcode = null; return false; }
function mgrCall(body) { return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ a: 'office', k: S.key, by: S.user, code: S.pcode }, body)) }).then(function (r) { return r.json(); }); }
function mgrSignIn(next) {
  render(back() + '<div class="card center" style="max-width:420px;margin:30px auto"><h1>🔒 ' + (next === 'weddings' ? 'Weddings' : 'Office') + '</h1><p class="muted">Enter your passcode.</p>' +
    '<input id="m_code" type="password" inputmode="numeric" autocomplete="off" style="text-align:center;font-size:26px;letter-spacing:8px;width:200px"><br>' +
    '<button class="btn" id="m_go" style="margin-top:14px">Open</button><p class="muted small">Needs the internet.</p></div>');
  var go = function () {
    var c = val('m_code'); if (!c) return toast('Enter the passcode');
    if (!navigator.onLine) return toast('Needs the internet');
    $('#m_go').disabled = true; S.pcode = c;
    mgrCall({ op: 'check' }).then(function (r) {
      if (!r.ok) { S.pcode = null; $('#m_go').disabled = false; $('#m_code').value = ''; return toast(r.error || 'Wrong passcode'); }
      S.pcodeAt = Date.now(); S.pcodeFor = S.user; route();
    }).catch(function () { S.pcode = null; $('#m_go').disabled = false; toast('No connection'); });
  };
  $('#m_go').onclick = go; $('#m_code').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  setTimeout(function () { $('#m_code').focus(); }, 50);
}

/* ---------- weddings: tubs out and tubs in (Jonny & Paul; only Jonny sees totals and history) ---------- */
ROUTES.weddings = function (key) {
  var mine = isOwner();
  if (!mine && S.user !== manager()) return ROUTES.home();
  if (!mine && !mgrOK()) return mgrSignIn('weddings');
  var draw = function (v) {
    if ((location.hash || '').indexOf('#weddings') !== 0) return;
    v = v || { weddings: [], records: [], venueNotes: {} };
    var list = (v.weddings || []).filter(function (w) { return mine || w.back === '' || w.back == null; });
    var w = key && key !== '__other' ? list.find(function (x) { return x.key === key; }) : null;
    var other = key === '__other';
    var hasOut = w && w.out !== '' && w.out != null;
    var vn = function (venue) { return (v.venueNotes || {})[String(venue || '').trim().toLowerCase()] || ''; };
    var notesBox = function (txt) { return txt ? '<div style="background:#fff4d6;border:2px solid #b58a00;border-radius:10px;padding:12px 14px;margin:10px 0"><b>📍 Notes on this venue</b><br>' + esc(txt).replace(/\n/g, '<br>') + '</div>' : ''; };
    var opts = list.map(function (x) { return { v: x.key, t: short(x.date) + ' – ' + x.name + (x.venue ? ' (' + x.venue + ')' : '') + (x.out !== '' && x.out != null ? (x.back !== '' && x.back != null ? ' ✓' : ' · tubs out') : '') }; });
    var form = '';
    if (w || other) {
      var venue = w ? w.venue : '';
      form = '<div class="card"><h2>' + esc(w ? w.name : 'Another wedding or event') + '</h2>' +
        (w ? '<p class="muted">' + esc(nice(w.date)) + (w.venue ? ' · ' + esc(w.venue) : '') + (mine && w.guests ? ' · ' + w.guests + ' guests' : '') + '</p>' : '<div class="grid2">' + field('Date', inp('w_date', today(), 'date')) + field('Wedding / event name', inp('w_name', '')) + '</div>' + field('Venue', inp('w_venue', '')) ) +
        '<div id="w_vn">' + notesBox(vn(venue)) + '</div>' +
        (mine
          ? '<div class="grid2">' + field('Tubs out', inp('w_out', w ? w.out : '', 'number')) + field('Tubs in (brought back)', inp('w_back', w ? w.back : '', 'number')) + '</div>'
          : hasOut
            ? '<p>Tubs out: <b>' + esc(w.out) + '</b> ✓</p>' + field('Tubs in – how many came back', inp('w_back', '', 'number'))
            : field('Tubs out – how many are going', inp('w_out', '', 'number'))) +
        field('Notes on this venue (saved and shown next time this venue comes up)', '<textarea id="w_vnotes" rows="3" placeholder="e.g. Park round the back, cart goes in the marquee, power by the bar">' + esc(vn(venue)) + '</textarea>') +
        '<div class="grid2">' + field('Recorded by', staffSel('w_by', S.user)) + '</div>' +
        '<button class="btn" id="w_save">Confirm</button></div>';
    }
    var recs = mine ? (v.records || []) : [];
    // every upcoming wedding from the booking system (prices only for Jonny)
    var up = v.upcoming || [], keys = list.map(function (x) { return x.key; });
    var when = function (n) { return n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days'; };
    var line = function (k, t) { return t ? '<div class="small" style="margin:3px 0"><span class="muted">' + k + ':</span> ' + t + '</div>' : ''; };
    var ghost = 'btn soft sm';
    var upHtml = '<div class="card"><h2>Upcoming weddings</h2>' + (mine && v.sheetUrl ? '<p class="small"><a href="' + esc(v.sheetUrl) + '" target="_blank">Open the Bookings sheet ↗</a></p>' : '') +
      (up.length ? up.map(function (w) {
        var tasting = w.tasting === 'Done' ? 'Done' : w.tasting === 'Booked' ? 'Booked – ' + esc(w.slot) : w.tasting === 'Invited' ? 'Invited, no time picked yet' : (w.status === 'Confirmed' ? '<b>Not invited yet</b>' : '');
        var k = w.date + '|' + w.name, maps = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent((w.venue ? w.venue + ', ' : '') + w.address);
        return '<details style="padding:10px 0;border-bottom:1px solid #eee"' + (w.days <= 7 ? ' open' : '') + '><summary style="cursor:pointer"><b>' + esc(nice(w.date)) + '</b> · ' + esc(w.name) + ' <span class="muted small">(' + when(w.days) + ')</span> <span class="pill ' + (w.status === 'Confirmed' ? 'ok' : 'warn') + '">' + esc(w.status) + '</span>' +
          '<br><span class="muted small">' + esc(w.venue || 'Venue?') + (w.serve ? ' · from ' + esc(w.serve) : '') + ' · ' + w.guests + ' guests' + (w.finalGuests ? ' (final)' : '') + '</span></summary><div style="margin:8px 0 0 4px">' +
          line('Venue', esc(w.venue) + (w.address ? ', ' + esc(w.address) : '')) + line('Serving', (w.serve ? 'from ' + esc(w.serve) : '') + (w.hours ? ' for ' + esc(w.hours) + ' hours' : '') + (w.inout ? ' · ' + esc(w.inout) : '')) +
          line('Guests', w.guests + (w.finalGuests ? ' (final numbers in)' : ' (not final yet)')) + line('Flavours', w.flavours.length ? esc(w.flavours.join(', ')) : 'not chosen yet') + line('Tasting', tasting) +
          line('Their request', w.request ? '<i>' + esc(w.request) + '</i>' + (w.requestStatus ? ' – ' + esc(w.requestStatus.toLowerCase()) : '') : '') +
          (mine && w.price !== '' && w.price != null ? line('Price', gbp(w.price) + (w.balance !== '' && w.balance != null ? ' · balance ' + gbp(w.balance) + ' cash' : '')) : '') +
          (w.venueNotes ? '<div style="background:#fff4d6;border:2px solid #b58a00;border-radius:8px;padding:8px 10px;margin:6px 0" class="small"><b>📍 Venue notes:</b> ' + esc(w.venueNotes).replace(/\n/g, '<br>') + '</div>' : '') +
          (w.tastingNotes ? '<details class="small"><summary>Tasting notes</summary><div style="white-space:pre-wrap">' + esc(w.tastingNotes) + '</div></details>' : '') +
          '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">' + (w.phone ? '<a class="' + ghost + '" href="tel:' + esc(w.phone.replace(/[^\d+]/g, '')) + '">📞 Call</a>' : '') + (w.email ? '<a class="' + ghost + '" href="mailto:' + esc(w.email) + '">✉️ Email</a>' : '') +
          (w.address || w.venue ? '<a class="' + ghost + '" target="_blank" href="' + esc(maps) + '">🗺️ Directions</a>' : '') + (keys.indexOf(k) >= 0 ? '<a class="btn sm" href="#weddings/' + encodeURIComponent(k) + '">🍦 Tubs out / in</a>' : '') + '</div></div></details>';
      }).join('') : '<p class="muted">' + (navigator.onLine ? 'No upcoming weddings in the booking system.' : 'Needs the internet.') + '</p>') + '</div>';
    render(back() + '<h1>Weddings</h1><p class="muted">Upcoming weddings are listed below – tap one for the details. Record the tubs going out to a wedding, then the tubs coming back.</p>' +
      '<div class="card"><h2>🍦 Tubs out / in</h2>' + field('Wedding', sel('w_pick', opts.concat([{ v: '__other', t: 'Other – not on the list…' }]), key || '', list.length ? 'Choose the wedding…' : (navigator.onLine ? 'Nothing waiting – choose Other' : 'No internet – choose Other'))) + '</div>' +
      form + upHtml +
      (mine ? '<div class="card"><h2>Recent weddings</h2><p class="muted small">Only you see this.</p><div class="scroll"><table class="t"><tr><th>Date</th><th>Wedding</th><th>Out</th><th>In</th><th>Used</th><th>By</th></tr>' +
        (recs.map(function (r) { return '<tr><td>' + esc(short(r.date)) + '</td><td>' + esc(r.wedding) + (r.venue ? '<br><span class="muted small">' + esc(r.venue) + '</span>' : '') + '</td><td>' + esc(r.out === '' ? '–' : r.out) + '</td><td>' + esc(r.back === '' ? '–' : r.back) + '</td><td>' + (r.used === '' || r.used == null ? '<span class="pill warn">not back yet</span>' : '<b>' + esc(r.used) + '</b>') + '</td><td class="small">' + esc(r.by || '') + '</td></tr>'; }).join('') || '<tr><td colspan="6" class="muted">Nothing recorded yet.</td></tr>') + '</table></div></div>' : ''));
    $('#w_pick').onchange = function () { var p = val('w_pick'); location.hash = p ? 'weddings/' + encodeURIComponent(p) : 'weddings'; };
    if ($('#w_venue')) $('#w_venue').onchange = function () { var t = vn(val('w_venue')); $('#w_vn').innerHTML = notesBox(t); if (t && !val('w_vnotes')) $('#w_vnotes').value = t; };
    if (!$('#w_save')) return;
    $('#w_save').onclick = function () {
      var name = w ? w.name : val('w_name'), venue = w ? w.venue : val('w_venue'), date = w ? w.date : val('w_date');
      if (!name) return toast('Which wedding?');
      if (!val('w_by')) return toast('Who is recording it?');
      var out = $('#w_out') ? num(val('w_out')) : (w ? num(w.out) : ''), bk = $('#w_back') ? num(val('w_back')) : (w ? num(w.back) : '');
      if ($('#w_out') && !mine && out === '') return toast('How many tubs are going out?');
      if ($('#w_back') && !mine && bk === '') return toast('How many tubs came back?');
      var q = !mine && hasOut ? 'Confirm ' + bk + ' tubs came back from ' + name + '?' : !mine ? 'Confirm ' + out + ' tubs going out to ' + name + '?' : 'Save ' + name + ': ' + (out === '' ? '–' : out) + ' out, ' + (bk === '' ? '–' : bk) + ' in?';
      if (!confirm(q)) return;
      var notes = val('w_vnotes'), old = vn(venue);
      var d = { id: (w && w.id) || uid(), key: w ? w.key : date + '|' + name, date: date, wedding: name, venue: venue, guests: w ? w.guests : '', out: out, back: bk, by: val('w_by'), venueNotes: venue && notes !== old ? notes : null };
      record('weddingTubs', d, !mine && hasOut ? 'Tubs in recorded – thank you' : !mine ? 'Tubs out recorded' : 'Saved');
      if (venue && notes !== old) (v.venueNotes = v.venueNotes || {})[String(venue).trim().toLowerCase()] = notes;
      if (w) { w.id = d.id; w.out = out; w.back = bk; } else (v.weddings = v.weddings || []).push({ key: d.key, date: date, name: name, venue: venue, id: d.id, out: out, back: bk });
      if (mine) { v.records = (v.records || []).filter(function (r) { return r.id !== d.id; }); v.records.unshift({ id: d.id, date: date, wedding: name, venue: venue, out: out, back: bk, used: out === '' || bk === '' ? '' : Math.max(0, out - bk), by: d.by }); }
      S.wv = v; S.wvAt = Date.now();
      location.hash = 'weddings';
    };
  };
  // show what's already here straight away, then refresh quietly in the background
  var have = S.wv && S.wvFor === S.user;
  if (have) { draw(S.wv); if (Date.now() - S.wvAt < 60000 || !navigator.onLine) return; }
  else if (!navigator.onLine) return draw(null);
  else render(back() + '<h1>Weddings</h1><p class="muted center">Loading…</p>');
  loadWed().then(function (r) {
    if (r && r.needCode) { S.pcode = null; return route(); }
    if (!r || !r.ok) { if (!have) { toast((r && r.error) || 'Could not open'); draw(null); } return; }
    if ((location.hash || '').indexOf('#weddings') === 0 && !$('#app').hasAttribute('data-dirty') && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) draw(r);
  });
};
// Jonny's sales dashboard (Office). Built from the stock takes, shop orders and wedding records.
var DASH_C = ['#2a78d6', '#eb6834', '#1baf7a'];
function svgBars(rows, keys, names, opts) {
  // rows: [{label, values:[..]}]; stacked bars with a 2px gap between segments, one axis
  opts = opts || {};
  var W = 640, H = 210, L = 44, B = 26, T = 10, iw = W - L - 8, ih = H - B - T;
  var max = Math.max.apply(null, rows.map(function (r) { return r.values.reduce(function (a, b) { return a + b; }, 0); }).concat([1]));
  var step = Math.pow(10, Math.floor(Math.log10(max))), nice = Math.ceil(max / step) * step; if (nice / step > 6) step *= 2;
  var bw = Math.max(4, Math.min(34, iw / rows.length - 6));
  var y = function (v) { return T + ih - v / nice * ih; };
  var grid = '';
  for (var g = 0; g <= nice + 1e-9; g += step) grid += '<line x1="' + L + '" x2="' + (W - 8) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#e7e5df"/><text x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end" font-size="11" fill="#52514e">' + (opts.money ? '£' : '') + Math.round(g) + '</text>';
  var bars = rows.map(function (r, i) {
    var x = L + (i + 0.5) * (iw / rows.length) - bw / 2, acc = 0, tot = r.values.reduce(function (a, b) { return a + b; }, 0);
    var segs = r.values.map(function (v, k) {
      if (!v) return '';
      var y1 = y(acc + v), h = Math.max(0, y(acc) - y1 - (acc ? 2 : 0)); acc += v;
      return '<rect x="' + x + '" y="' + y1 + '" width="' + bw + '" height="' + h + '" rx="' + (acc === tot ? 3 : 0) + '" fill="' + DASH_C[keys[k]] + '"/>';
    }).join('');
    var tip = r.label + ': ' + r.values.map(function (v, k) { return names[k] + ' ' + (opts.money ? '£' : '') + Math.round(v * 10) / 10 + (opts.unit || ''); }).join(', ');
    var lab = rows.length <= 14 || i % 2 === rows.length % 2 ? '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" fill="#52514e">' + esc(r.short || r.label) + '</text>' : '';
    return '<g><title>' + esc(tip) + '</title><rect x="' + (x - 4) + '" y="' + T + '" width="' + (bw + 8) + '" height="' + ih + '" fill="transparent"/>' + segs + lab + '</g>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="' + esc(opts.title || 'chart') + '">' + grid + '<line x1="' + L + '" x2="' + (W - 8) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#b9b7af"/>' + bars + '</svg>';
}
function dashHtml(d) {
  if (!d) return '';
  var SL = setN('Small tub ml', 150) / 1000, LL = setN('Large tub ml', 500) / 1000;
  var lit = function (s, l) { return (s || 0) * SL + (l || 0) * LL; };
  var pct = function (a, b) { return b ? Math.round((a - b) / b * 100) : null; };
  var arrow = function (p) { return p == null ? '<span class="muted">–</span>' : '<span style="font-weight:bold">' + (p > 0 ? '▲ ' : p < 0 ? '▼ ' : '') + Math.abs(p) + '%</span>'; };
  var money = function (n) { return '£' + (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); };
  var ps = (d.periods || []).slice().reverse(); // oldest first
  var tile = function (label, big, sub) { return '<div class="card" style="margin:0;padding:14px 16px"><div class="small muted">' + label + '</div><div style="font-size:28px;font-weight:bold;color:#1c2140;line-height:1.2">' + big + '</div><div class="small">' + (sub || '') + '</div></div>'; };
  var tiles = '', notes = [];
  if (ps.length) {
    var last = ps[ps.length - 1], prev = ps[ps.length - 2], prior = ps.slice(-5, -1);
    var lastL = lit(last.gone.S, last.gone.L), prevL = prev ? lit(prev.gone.S, prev.gone.L) : null;
    var avgL = prior.length ? prior.reduce(function (t, p) { return t + lit(p.gone.S, p.gone.L); }, 0) / prior.length : null;
    var farmShare = lastL ? Math.round(lit(last.farm.S, last.farm.L) / lastL * 100) : 0;
    tiles = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px">' +
      tile('Tubs sold – last week', last.gone.S + ' small<br>' + last.gone.L + ' big', 'vs week before ' + arrow(prevL == null ? null : pct(lastL, prevL))) +
      tile('Litres sold – last week', Math.round(lastL), 'vs 4-week average ' + arrow(avgL == null ? null : pct(lastL, avgL))) +
      tile('Shop orders – 4 weeks', money((d.shops || []).reduce(function (t, s) { return t + s.value; }, 0)), 'vs 4 weeks before ' + arrow(pct((d.shops || []).reduce(function (t, s) { return t + s.value; }, 0), (d.shops || []).reduce(function (t, s) { return t + s.prev; }, 0)))) +
      tile('Farm shop share', farmShare + '%', 'of last week\'s litres') + '</div>';
    // patterns
    var best = ps.reduce(function (b, p) { return !b || lit(p.gone.S, p.gone.L) > lit(b.gone.S, b.gone.L) ? p : b; }, null);
    if (best && ps.length > 2) notes.push('Best week so far: <b>' + esc(short(best.from)) + ' – ' + esc(short(best.to)) + '</b> (' + Math.round(lit(best.gone.S, best.gone.L)) + ' L).');
    if (avgL && lastL) notes.push('Last week was ' + (lastL >= avgL ? '<b>up ' : '<b>down ') + Math.abs(pct(lastL, avgL)) + '%</b> on the 4 weeks before.');
  }
  // flavour trends: last 4 periods vs the 4 before
  var fl = {}, add = function (list, k) { list.forEach(function (p) { (p.byFlavour || []).forEach(function (f) { fl[f.flavour] = fl[f.flavour] || [0, 0]; fl[f.flavour][k] += lit(f.S, f.L); }); }); };
  add(ps.slice(-4), 0); add(ps.slice(-8, -4), 1);
  var tot4 = Object.keys(fl).reduce(function (t, f) { return t + fl[f][0]; }, 0);
  var flRows = Object.keys(fl).map(function (f) { return { f: f, now: fl[f][0], before: fl[f][1], ch: pct(fl[f][0], fl[f][1]) }; }).sort(function (a, b) { return b.now - a.now; });
  var up = flRows.filter(function (x) { return x.ch != null && x.before > 2; }).sort(function (a, b) { return b.ch - a.ch; });
  if (up.length > 1) { notes.push('Growing fastest: <b>' + esc(up[0].f) + '</b> (' + arrow(up[0].ch) + '). Slowing most: <b>' + esc(up[up.length - 1].f) + '</b> (' + arrow(up[up.length - 1].ch) + ').'); }
  (d.lapsed || []).forEach(function (s) { notes.push('🛎️ <b>' + esc(s.shop) + '</b> hasn\'t ordered for ' + s.days + ' days (usually every ' + s.usual + ').'); });
  var made = d.made || [];
  if (made.length) { var m8 = made.slice(-8); notes.push('Production: about <b>' + Math.round(m8.reduce(function (t, x) { return t + x.litres; }, 0) / m8.length) + ' L a week</b> over the last ' + m8.length + ' production week' + (m8.length > 1 ? 's' : '') + '.'); }
  var weekly = ps.length ? '<h3>Where it went each week (litres)</h3><div class="small" style="display:flex;gap:16px;margin:4px 0 6px">' + ['Shops', 'Weddings', 'Farm shop'].map(function (n, i) { return '<span><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:' + DASH_C[i] + ';vertical-align:-1px"></span> ' + n + '</span>'; }).join('') + '</div>' +
    svgBars(ps.map(function (p) { return { label: short(p.from) + ' – ' + short(p.to), short: short(p.to), values: [lit(p.shopTotal.S, p.shopTotal.L), lit(p.weddings.S, p.weddings.L || 0), lit(p.farm.S, p.farm.L)] }; }), [0, 1, 2], ['Shops', 'Weddings', 'Farm shop'], { unit: ' L', title: 'Litres sold each week by where it went' }) +
    '<details><summary>Show as a table</summary><table class="t"><tr><th>Week</th><th>Shops</th><th>Weddings</th><th>Farm shop</th><th>Total (L)</th></tr>' + ps.slice().reverse().map(function (p) { return '<tr><td>' + esc(short(p.from)) + ' – ' + esc(short(p.to)) + '</td><td>' + Math.round(lit(p.shopTotal.S, p.shopTotal.L)) + '</td><td>' + Math.round(lit(p.weddings.S, p.weddings.L || 0)) + '</td><td>' + Math.round(lit(p.farm.S, p.farm.L)) + '</td><td><b>' + Math.round(lit(p.gone.S, p.gone.L)) + '</b></td></tr>'; }).join('') + '</table></details>' : '';
  var months = (d.months || []).length ? '<h3>Shop orders by month</h3>' + svgBars(d.months.map(function (m) { var dt = new Date(m.month + '-01'); return { label: dt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), short: dt.toLocaleDateString('en-GB', { month: 'short' }), values: [m.value] }; }), [0], ['Shop orders'], { money: true, title: 'Shop order value by month' }) : '';
  var flTable = flRows.length ? '<h3>Flavours – last 4 weeks</h3><div class="scroll"><table class="t"><tr><th>Flavour</th><th>Litres</th><th>Share</th><th>vs 4 weeks before</th></tr>' + flRows.map(function (x) { return '<tr><td>' + esc(x.f) + '</td><td>' + Math.round(x.now) + '</td><td><span style="display:inline-block;height:8px;border-radius:0 4px 4px 0;background:#2a78d6;width:' + Math.round(tot4 ? x.now / tot4 * 120 : 0) + 'px;vertical-align:middle"></span> ' + (tot4 ? Math.round(x.now / tot4 * 100) : 0) + '%</td><td>' + arrow(x.before > 2 ? x.ch : null) + '</td></tr>'; }).join('') + '</table></div>' : '';
  var shopTable = (d.shops || []).length ? '<h3>Shops – last 4 weeks</h3><div class="scroll"><table class="t"><tr><th>Shop</th><th>Orders £</th><th>vs 4 weeks before</th><th>Tubs</th><th>Last order</th></tr>' + d.shops.map(function (s) { return '<tr><td>' + esc(s.shop) + '</td><td>' + money(s.value) + '</td><td>' + arrow(s.prev ? pct(s.value, s.prev) : null) + '</td><td>' + s.S + ' S / ' + s.L + ' L</td><td>' + esc(s.last ? short(s.last) : '–') + '</td></tr>'; }).join('') + '</table></div>' : '';
  var wk = function (w) { return w == null ? '–' : w <= 0 ? '<b style="color:#b3261e">will run out</b>' : w <= 3 ? '<b style="color:#b3261e">' + w + ' wks ⚠️</b>' : w + ' wks'; };
  var lowT = (d.lowest || []).length ? '<h3>Running lowest – weeks left</h3><p class="muted small">From sales patterns, minus shop orders and weddings already booked.</p><table class="t"><tr><th>Flavour</th><th>Small tubs</th><th>Big tubs</th></tr>' + d.lowest.map(function (f) { return '<tr><td>' + esc(f.flavour) + '</td><td>' + wk(f.weeksLeftS) + '</td><td>' + wk(f.weeksLeftL) + '</td></tr>'; }).join('') + '</table>' : '';
  var ov = d.overrun || {};
  var ovT = '<h3>Overrun</h3>' + (ov.yieldAvg != null || ov.weightAvg != null ? '<p>Average of the last 10 batches: ' + (ov.yieldAvg != null ? 'from tubs made <b>' + ov.yieldAvg + '%</b>' : '') + (ov.yieldAvg != null && ov.weightAvg != null ? ' · ' : '') + (ov.weightAvg != null ? 'from tub weights <b>' + ov.weightAvg + '%</b>' : '') + '</p>' +
    '<details><summary>By batch</summary><table class="t"><tr><th>Batch</th><th>Flavour</th><th>From tubs</th><th>From weights</th></tr>' + (ov.batches || []).map(function (b) { return '<tr><td>' + esc(b.no) + '</td><td>' + esc(b.flavour) + '</td><td>' + (b.yield != null ? b.yield + '%' : '–') + '</td><td>' + (b.weight != null ? b.weight + '%' : '–') + '</td></tr>'; }).join('') + '</table></details>' : '<p class="muted">Shows once batches have tub counts or tub weights.</p>');
  var pr = (d.printed || []).filter(function (x) { return x.weeksLeft != null || x.est != null; });
  var prT = '<h3>Printed tubs, lids & labels</h3><p class="muted small">These take up to ' + Math.round(((d.printed || [])[0] || {}).lead / 4.3 || 6) + ' months to arrive, so they\'re flagged when there\'s less than that (plus a month) left. Needs packaging counts and a few weeks of tubbing to work out.</p>' +
    (pr.length ? '<div class="scroll"><table class="t"><tr><th>Item</th><th>In stock (≈)</th><th>Use per week</th><th>Weeks left</th></tr>' + pr.slice(0, 15).map(function (x) { return '<tr><td>' + esc(x.item) + '</td><td>' + (x.est == null ? '–' : x.est) + '</td><td>' + (x.weekly || '–') + '</td><td>' + (x.weeksLeft == null ? '–' : x.orderNow ? '<b style="color:#b3261e">' + x.weeksLeft + ' – order now</b>' : x.weeksLeft) + '</td></tr>'; }).join('') + '</table></div>' : '<p class="muted">Nothing to forecast yet.</p>');
  var body = lowT + tiles + (notes.length ? '<div class="hint"><b>What stands out</b><ul style="margin:6px 0 0 18px;padding:0">' + notes.map(function (n) { return '<li>' + n + '</li>'; }).join('') + '</ul></div>' : '') + weekly + flTable + shopTable + months + ovT + prT;
  return '<div class="card"><h2>📈 Sales dashboard</h2><p class="muted small">Only you see this. It fills in as the Saturday stock takes, shop orders and wedding records build up – trends need about 4–8 weeks.</p>' +
    (body || '<p class="muted">Nothing to show yet – it starts after the next two Saturday stock takes.</p>') + '</div>';
}

function salesHtml(sales) {
  var ps = (sales && sales.periods) || [];
  if (!ps.length) return '<div class="card"><h2>Sales</h2><p class="muted">' + esc((sales && sales.note) || 'Sales show once there are two stock takes to compare.') + '</p></div>';
  var p = ps[0], st = function (s, l) { return (s || 0) + ' small' + (l ? ', ' + l + ' large' : ''); };
  var money = function (n) { return '£' + (Number(n) || 0).toFixed(2); };
  var rows = p.shops.map(function (s) { return '<tr><td>' + esc(s.shop) + ' <span class="muted small">(' + s.orders + ' order' + (s.orders > 1 ? 's' : '') + ')</span></td><td>' + s.S + '</td><td>' + s.L + '</td><td>' + money(s.value) + '</td></tr>'; }).join('');
  return '<div class="card"><h2>💷 Sales – ' + esc(short(p.from)) + ' to ' + esc(short(p.to)) + '</h2>' +
    '<p class="muted small">From the stock takes: last count + tubs made (batch records) − this count = tubs gone. Shops are the orders packed, weddings are what Paul recorded as used (or one small tub per guest if nothing was recorded), and the rest went through the farm shop. Only you see this.</p>' +
    '<div class="scroll"><table class="t"><tr><th>Where</th><th>Small</th><th>Large</th><th>Value</th></tr>' + rows +
    '<tr><td><b>All shops</b></td><td><b>' + p.shopTotal.S + '</b></td><td><b>' + p.shopTotal.L + '</b></td><td><b>' + money(p.shopTotal.value) + '</b></td></tr>' +
    '<tr><td>Weddings <span class="muted small">(' + p.weddings.count + (p.weddings.estimated ? ', ' + p.weddings.estimated + ' estimated from guests' : '') + ')</span></td><td>' + p.weddings.S + '</td><td>' + (p.weddings.L || 0) + '</td><td></td></tr>' +
    '<tr><td><b>Farm shop</b></td><td><b>' + p.farm.S + '</b></td><td><b>' + p.farm.L + '</b></td><td></td></tr>' +
    '<tr style="border-top:2px solid #1c2140"><td><b>Total gone</b></td><td><b>' + p.gone.S + '</b></td><td><b>' + p.gone.L + '</b></td><td></td></tr></table></div>' +
    '<p class="small">Tubs made this week (batch records): <b>' + st(p.made.S, p.made.L) + '</b>.' + (p.untubbed && p.untubbed.length ? ' <span class="pill warn">Batch ' + esc(p.untubbed.join(', ')) + ' has no tub count yet – the figures will be out until it\'s filled in</span>' : '') + '</p>' +
    '<details><summary>By flavour</summary><table class="t"><tr><th>Flavour</th><th>Small gone</th><th>Large gone</th><th>Made</th></tr>' + p.byFlavour.map(function (f) { return '<tr><td>' + esc(f.flavour) + '</td><td>' + f.S + '</td><td>' + f.L + '</td><td class="muted small">' + (f.madeS || f.madeL ? st(f.madeS, f.madeL) : '') + '</td></tr>'; }).join('') + '</table></details>' +
    (ps.length > 1 ? '<details><summary>Earlier weeks</summary><div class="scroll"><table class="t"><tr><th>Week</th><th>Shops</th><th>Shops £</th><th>Weddings</th><th>Farm shop</th><th>Total gone</th></tr>' + ps.slice(1).map(function (q) {
      return '<tr><td>' + esc(short(q.from)) + ' – ' + esc(short(q.to)) + '</td><td>' + st(q.shopTotal.S, q.shopTotal.L) + '</td><td>' + money(q.shopTotal.value) + '</td><td>' + q.weddings.S + '</td><td>' + st(q.farm.S, q.farm.L) + '</td><td>' + st(q.gone.S, q.gone.L) + '</td></tr>';
    }).join('') + '</table></div></details>' : '') + '</div>';
}
function drawPaulOffice(d) {
  var wk = function (w, what) { return w == null ? '–' : w <= 0 ? '<b style="color:#b3261e">will run out</b>' : w <= 3 ? '<b style="color:#b3261e">' + w + ' wks ⚠️</b>' : w + ' wks'; };
  render(back() + '<h1>Office</h1>' +
    '<div class="tiles noprint" style="margin-bottom:16px"><a class="tile" href="#packing"><span class="ic">🧾</span><span><b>Shop orders</b><br><small>Packing list</small></span></a><a class="tile" href="#weddings"><span class="ic">💍</span><span><b>Weddings</b><br><small>Tubs out & in</small></span></a></div>' +
    ((d.short || []).length ? '<div class="due bad"><span>💍</span><span><b>Make or keep aside for weddings:</b> ' + d.short.map(function (f) { return esc(f.flavour) + ' (' + f.shortfall + ' small tubs short)'; }).join(', ') + '</span></div>' : '') +
    '<div class="card"><h2>Make next</h2>' + ((d.make || []).length ? '<ol style="margin:0 0 0 20px;font-size:18px">' + d.make.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ol>' : '<p class="muted">Builds up as the Saturday stock takes come in.</p>') + '</div>' +
    '<div class="card" style="border:2px solid #b3261e"><h2>⚠️ Stock getting low</h2><p class="muted small">About 3 weeks or less left, from recent sales and the shop orders and weddings already booked.</p>' + ((d.low || []).length ? '<table class="t"><tr><th>Flavour</th><th>Big tubs</th><th>Small tubs</th><th>Weeks left – small / big</th></tr>' + d.low.map(function (f) { return '<tr><td><b>' + esc(f.flavour) + '</b></td><td>' + (f.large == null ? '–' : f.large) + '</td><td>' + (f.small == null ? '–' : f.small) + '</td><td>' + wk(f.weeksLeftS) + ' / ' + wk(f.weeksLeftL) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">Nothing running low.</p>') + '</div>' +
    '<div class="card"><h2>Running lowest</h2>' + ((d.lowest || []).length ? '<table class="t"><tr><th>Flavour</th><th>Small tubs – weeks left</th><th>Big tubs – weeks left</th></tr>' + d.lowest.map(function (f) { return '<tr><td>' + esc(f.flavour) + '</td><td>' + wk(f.weeksLeftS) + '</td><td>' + wk(f.weeksLeftL) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">Needs a few weeks of stock takes.</p>') + '</div>' +
    '<div class="card"><h2>Weddings coming up</h2>' + ((d.weddings || []).map(function (w) { return '<div class="row"><span><b>' + esc(nice(w.date)) + '</b> · ' + esc(w.name) + '<br><span class="muted">' + esc(w.flavours.join(', ') || 'Flavours not chosen yet') + '</span></span><span>' + w.guests + ' guests</span></div>'; }).join('') || '<p class="muted">None in the next few weeks.</p>') + '</div>' +
    '<div class="card"><h2>To order</h2>' + (((d.ingredients || []).length || (d.toOrder || []).length) ? '<ul style="margin:0 0 0 18px">' + (d.ingredients || []).map(function (i) { return '<li>' + esc(i.name) + (i.supplier ? ' <span class="muted small">(' + esc(i.supplier) + ')</span>' : '') + '</li>'; }).join('') + (d.toOrder || []).map(function (o) { return '<li>' + esc(o.item) + ' <span class="muted small">(asked by ' + esc(String(o.by || '').split(' ')[0]) + ')</span></li>'; }).join('') + '</ul>' : '<p class="muted">Nothing to order.</p>') + '</div>');
}
function orderMail(items, supplier, email) {
  var body = 'Hi' + (supplier ? ' ' + supplier : '') + ',\n\nCould we please order:\n' + items.map(function (i) { return '- ' + i + ': ___'; }).join('\n') + '\n\nThanks,\nJonny Campbell\nDukes Ultra Premium Ice Cream';
  return 'mailto:' + encodeURIComponent(email || '') + '?subject=' + encodeURIComponent('Order – Dukes Ice Cream') + '&body=' + encodeURIComponent(body);
}
function drawOffice(data, mine) {
  if (!mine) return drawPaulOffice(data || {});
  var I = (data && data.insights) || {};
  var wk = function (x) { return x == null ? '<span class="muted">no count yet</span>' : x + ' wks'; };
  var short_ = (I.flavours || []).filter(function (f) { return f.shortfall > 0; });
  var reqs = mine ? (D().recipeRequests || []) : [];
  render(back() + '<h1>Office</h1>' +
    '<div class="tiles noprint" style="margin-bottom:16px">' +
    (mine ? '<a class="tile dark" href="' + esc(I.creamLink || '#') + '" target="_blank"><span class="ic">🥛</span><span><b>Cream & milk order</b><br><small>Strathroy – by 12 noon Monday</small></span></a>' +
      '<a class="tile" href="' + SHEET_URL + '" target="_blank"><span class="ic">📗</span><span><b>Google Sheet</b><br><small>Prices, shops, settings, lists</small></span></a>' +
      '<a class="tile" href="#jtodo"><span class="ic">✅</span><span><b>My to do</b><br><small>' + (((data.dash || {}).jtodo || []).filter(function (x) { return x.due && x.due <= addDays(today(), 7); }).length || 'Nothing') + ' due this week</small></span></a>' +
      '<a class="tile" href="#totals"><span class="ic">📊</span><span><b>Totals</b><br><small>Sales, tubs, ingredients vs last year</small></span></a>' +
      '<a class="tile" href="#shoplist"><span class="ic">🛒</span><span><b>Shopping list</b><br><small>What to buy, how much, last price</small></span></a>' +
      '<a class="tile" href="#finance"><span class="ic">💷</span><span><b>Costs & prices</b><br><small>Cost per tub for each flavour</small></span></a>' : '') +
    '<a class="tile" href="#packing"><span class="ic">🧾</span><span><b>Shop orders</b><br><small>Packing list</small></span></a></div>' +
    (short_.length ? '<div class="due bad"><span>💍</span><span><b>Weddings need more stock:</b> ' + short_.map(function (f) { return esc(f.flavour) + ' (' + f.shortfall + ' small tubs short)'; }).join(', ') + '</span></div>' : '') +
    (mine && (I.waiting || []).length ? '<div class="card"><h2>Shop orders to confirm</h2>' + I.waiting.map(function (o) { return '<div class="row"><span><b>' + esc(o.shop) + '</b> · ' + esc(o.no) + '<br><span class="muted">' + esc(nice(o.date)) + ' · ' + o.small + ' small, ' + o.large + ' large</span></span><a class="btn sm" target="_blank" href="' + esc(o.link) + '">Check & confirm</a></div>'; }).join('') + '</div>' : '') +
    (reqs.length ? '<div class="card"><h2>Recipe changes to approve</h2>' + reqs.map(function (q) { return '<a class="row" href="#recipes/' + encodeURIComponent(q.flavour) + '"><span><b>' + esc(q.flavour) + '</b><br><span class="muted">asked for by ' + esc(q.by) + ' · ' + esc(short(q.date)) + '</span></span><span class="btn sm">Review</span></a>'; }).join('') + '</div>' : '') +
    (mine ? dashHtml(data.dash) + salesHtml(data.sales) : '') +
    (!mine ? '<div class="card" style="border:2px solid #b3261e"><h2>⚠️ Stock getting low</h2><p class="muted small">Flavours with about 3 weeks or less left.</p>' + ((data.low || []).length ? '<table class="t"><tr><th>Flavour</th><th>Big tubs</th><th>Small tubs</th><th>About</th></tr>' + data.low.map(function (f) { return '<tr><td><b>' + esc(f.flavour) + '</b></td><td>' + (f.large == null ? '–' : f.large) + '</td><td>' + (f.small == null ? '–' : f.small) + '</td><td>' + f.weeksLeft + ' wks</td></tr>'; }).join('') + '</table>' : '<p class="muted">Nothing running low.</p>') + '</div>' : '') +
    '<div class="card"><h2>Make next</h2><p class="muted small">Estimated from the last stock take, plus batches tubbed, minus shop orders packed and weddings since.</p><div class="scroll"><table class="t"><tr><th>Flavour</th><th>Large now</th><th>Small now</th>' + (mine ? '<th>Uses (L/week)</th>' : '') + '<th>Weeks left</th><th>Weddings ahead</th></tr>' +
    (I.produceFirst && I.produceFirst.length ? I.produceFirst : (I.flavours || [])).map(function (p) {
      var f = (I.flavours || []).find(function (x) { return x.flavour === p.flavour; }) || p;
      return '<tr><td><b>' + esc(f.flavour) + '</b></td><td>' + (f.large == null ? '–' : f.large) + '</td><td>' + (f.small == null ? '–' : f.small) + '</td>' + (mine ? '<td>' + (f.weeklyLitres || '–') + '</td>' : '') + '<td>' + (f.weeksLeft != null && f.weeksLeft < 2 ? '<span class="pill bad">' + f.weeksLeft + ' wks</span>' : wk(f.weeksLeft)) + '</td><td>' + (f.reservedSmall ? f.reservedSmall + ' small' + (f.shortfall ? ' <span class="pill bad">' + f.shortfall + ' short</span>' : '') : '') + '</td></tr>';
    }).join('') + '</table></div></div>' +
    (mine ? '<div class="card"><h2>Best sellers</h2>' + ((I.bestSellers || []).map(function (b, i) { return '<div class="row"><span>' + (i + 1) + '. ' + esc(b.flavour) + '</span><b>' + b.weeklyLitres + ' L/week</b></div>'; }).join('') || '<p class="muted">Builds up as stock takes and orders are recorded.</p>') + '</div>' : '') +
    '<div class="card"><h2>Ingredients – when to order</h2><p class="muted small">From the last count, plus deliveries, minus what batches used. Flagged when it will run out within its lead time (+1 week).</p><div class="scroll"><table class="t"><tr><th>Ingredient</th><th>In stock (est.)</th><th>Use per week</th><th>Weeks left</th><th>Lead time</th><th>Supplier</th></tr>' +
    (I.ingredients || []).map(function (g) { var em = ((D().ingredients || []).find(function (x) { return x.name === g.name; }) || {}).supplierEmail; return '<tr><td>' + esc(g.name) + (g.mixL && g.mixL.length ? '<br><span class="small muted">≈ ' + g.mixL.map(function (m) { return m.litres.toLocaleString('en-GB') + ' L of mix' + (m.flavour === 'any flavour' ? '' : ' (' + esc(m.flavour) + ')'); }).join(', ') + '</span>' : '') + '</td><td>' + (g.est == null ? '<span class="muted">not counted</span>' : g.est + ' ' + esc(g.unit)) + '</td><td>' + (g.weeklyUse || '–') + '</td><td>' + (g.warn ? '<span class="pill bad">' + g.weeksLeft + ' – order now</span>' : (g.weeksLeft == null ? '–' : g.weeksLeft)) + '</td><td>' + g.lead + ' wks</td><td>' + esc(g.supplier || '?') + (g.warn ? ' <a class="btn soft sm" href="' + esc(orderMail([g.name], g.supplier, em)) + '">✉️ Draft order</a>' : '') + '</td></tr>'; }).join('') + '</table></div><p class="muted small">"Draft order" opens an email in your mail app for you to check and send. Add supplier email addresses in the Supplier email column on the Ingredients tab.</p></div>' +
    ((D().toOrder || []).length ? '<div class="card"><h2>🛒 Asked to be ordered</h2>' + D().toOrder.map(function (o) { var g = (D().ingredients || []).find(function (x) { return x.name === o.item; }) || {}; return '<div class="row"><span><b>' + esc(o.item) + '</b><br><span class="muted small">asked by ' + esc(o.by || '') + ' · ' + esc(short(o.date)) + (g.supplier ? ' · ' + esc(g.supplier) : '') + '</span></span><span><a class="btn soft sm" href="' + esc(orderMail([o.item], g.supplier, g.supplierEmail)) + '">✉️ Draft order</a> <button class="btn sm" data-ordered="' + esc(o.id || '') + '">Ordered ✓</button></span></div>'; }).join('') + '</div>' : '') +
    '<div class="card"><h2>Weddings coming up</h2>' + ((I.weddings || []).map(function (w) { return '<div class="row"><span><b>' + esc(nice(w.date)) + '</b> · ' + esc(w.name) + '<br><span class="muted">' + esc(w.flavours.join(', ') || 'Flavours not chosen yet') + '</span></span><span>' + w.guests + ' guests</span></div>'; }).join('') || '<p class="muted">None booked in the next few weeks.</p>') + '</div>' +
    '<div class="card"><h2>Shop orders expected</h2>' + ((I.shops || []).map(function (s) { return '<div class="row"><span><b>' + esc(s.shop) + '</b><br><span class="muted">' + s.orders + ' orders · usually ' + s.small + ' small / ' + s.large + ' large' + (s.avgDays ? ' · every ' + s.avgDays + ' days' : '') + '</span></span><span>' + (s.nextDue ? 'about ' + esc(short(s.nextDue)) : '–') + '</span></div>'; }).join('') || '<p class="muted">Builds up once shops order through their links.</p>') + '</div>');
}

/* ---------- Jonny only: to-do, totals, shopping list, costs & prices ---------- */
function onlyJonny(title) { if (isOwner()) return false; render(back() + '<h1>' + esc(title) + '</h1><div class="card">This page is only for Jonny. Sign in as Jonny with your passcode.</div>'); return true; }
function gbp(n, dp) { return n == null || n === '' || isNaN(Number(n)) ? '–' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: dp == null ? 2 : dp, maximumFractionDigits: dp == null ? 2 : dp }); }
function ownLoad(title, op, draw, d) {
  if (onlyJonny(title)) return;
  if (!navigator.onLine) return render(back('office', 'Office') + '<h1>' + esc(title) + '</h1><div class="card">This page needs the internet.</div>');
  render(back('office', 'Office') + '<h1>' + esc(title) + '</h1><p class="muted center">Loading…</p>');
  var here = location.hash;
  ownerCall({ op: op, d: d }).then(function (r) { if (location.hash !== here) return; if (!r.ok) { toast(r.error || 'Could not open'); return; } draw(r); })
    .catch(function () { render(back('office', 'Office') + '<h1>' + esc(title) + '</h1><div class="card">No connection.</div>'); });
}

// "Did you mean …?" – when an ingredient or packaging name is typed that's nearly (not exactly) one already on the list
function nameKey(n) { return String(n || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').map(function (w) { return w.length > 3 ? w.replace(/([^s])s$/, '$1') : w; }).join(' '); }
function editDist(a, b) {
  var m = a.length, n = b.length, d = []; for (var i = 0; i <= m; i++) { d[i] = [i]; } for (var j = 1; j <= n; j++) d[0][j] = j;
  for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function closeName(v, names) {
  v = String(v || '').trim(); if (v.length < 3) return null;
  if (names.indexOf(v) >= 0) return null;
  var k = nameKey(v), best = null, bestD = 99;
  names.forEach(function (n) {
    var nk = nameKey(n); if (!nk) return;
    var dd = nk === k ? 0 : editDist(k, nk);
    if (dd > Math.max(1, Math.floor(Math.max(k.length, nk.length) * 0.25)) && !(k.length >= 5 && nk.length >= 5 && (nk.indexOf(k) === 0 || k.indexOf(nk) === 0))) return;
    if (dd < bestD) { bestD = dd; best = n; }
  });
  return best;
}
S.dymNo = {};
document.addEventListener('change', function (e) {
  var t = e.target; if (!t || t.tagName !== 'INPUT') return;
  var pack = t.matches('tr.newpack input[data-k=name]'), lot = t.matches('input[data-k=batch][data-i], input[data-b], #d_batch'), sup = t.matches('#d_sup');
  if (!pack && !lot && !sup && !t.matches('input[data-k=ingredient], #d_item, #n_name, tr.newing input[data-k=name]')) return;
  var v = t.value.trim(), names, hit;
  if (lot) {
    // which ingredient this batch number belongs to
    var tr = t.closest('tr'), ing = '';
    if (t.matches('[data-k=batch]')) { var ingI = tr && tr.querySelector('input[data-k=ingredient]'); ing = ingI ? ingI.value : ''; }
    else if (t.matches('#d_batch')) ing = (($('#d_item') || {}).value || '').trim() || (($('#d_pick') || {}).value || '');
    else ing = (t.closest('tr[data-cur]') || { dataset: {} }).dataset.cur || (($('#n_name') || {}).value || '');
    if (!ing || !v) return typedNote(t, '');
    var lk = function (x) { return String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    names = lotsFor(ing).map(function (l) { return String(l.batch || ''); });
    // a batch record is checked against the deliveries and stock page; those are checked against earlier batch records too
    if (!t.matches('[data-k=batch]')) (D().batches || []).forEach(function (b) { (b.lines || []).forEach(function (l) { if (nameKey(l.ingredient) === nameKey(ing) && l.batch) names.push(String(l.batch)); }); });
    names = Array.from(new Set(names.filter(Boolean)));
    if (names.some(function (n) { return lk(n) === lk(v); })) return typedNote(t, '');
    hit = names.find(function (n) { var a = lk(n), b = lk(v); return a.length >= 4 && b.length >= 4 && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0 || editDist(a, b) <= 2); }) || null;
    if (hit && !S.dymNo[v + '|' + hit] && confirm('Did you mean batch number "' + hit + '"?\n\nThat number is already recorded for ' + ing + '. Tap OK to use "' + hit + '", or Cancel to keep "' + v + '".')) { t.value = hit; t.dispatchEvent(new Event('input', { bubbles: true })); return typedNote(t, ''); }
    if (hit) S.dymNo[v + '|' + hit] = 1;
    if (t.matches('#d_batch, [data-b]') && !hit) return typedNote(t, ''); // a new delivery or shelf batch is normal
    return typedNote(t, (hit ? '"' + v + '" is close to ' + ing + ' batch "' + hit + '" but not the same.' : names.length ? 'This batch number isn\'t in the ' + ing + ' deliveries or stock.' : 'No batch numbers are recorded for ' + ing + ' in deliveries or stock yet.') + ' Would you like it added to deliveries (and so to stock)?', 'batch');
  }
  names = pack ? (D().packItems || []).map(function (i) { return i.item; }) : sup ? Array.from(new Set((D().ingredients || []).map(function (i) { return i.supplier; }).concat((D().lots || []).map(function (l) { return l.supplier; })).filter(Boolean))) : (D().ingredients || []).map(function (i) { return i.name; });
  if (!v || names.indexOf(v) >= 0) return typedNote(t, '');
  hit = closeName(v, names);
  if (hit && !S.dymNo[v + '|' + hit]) {
    if (hit.toLowerCase() === v.toLowerCase() || confirm('Did you mean "' + hit + '"?\n\nTap OK to use "' + hit + '", or Cancel to keep "' + v + '" as a new ' + (sup ? 'supplier' : 'name') + '.')) {
      t.value = hit; t.dispatchEvent(new Event('input', { bubbles: true })); return typedNote(t, '');
    }
    S.dymNo[v + '|' + hit] = 1;
  }
  typedNote(t, '"' + v + '" isn\'t on the list' + (hit ? ' (closest: ' + hit + ')' : '') + '. Is this a new ' + (sup ? 'supplier' : 'item') + '?', sup ? 'supplier' : 'item');
}, true);
// Pop-up from a batch record: an ingredient batch that isn't in deliveries or stock is added as a delivery
// (batch number and best before already filled in – just the delivery date and how much came)
function addDeliveryPopup(x, done) {
  var ing = (D().ingredients || []).find(function (i) { return nameKey(i.name) === nameKey(x.item); }) || {};
  var last = (D().lots || []).filter(function (l) { return nameKey(l.item) === nameKey(x.item); }).sort(function (a, b) { return a.date < b.date ? -1 : 1; }).pop() || {};
  var sups = Array.from(new Set((D().ingredients || []).map(function (i) { return i.supplier; }).concat((D().lots || []).map(function (l) { return l.supplier; })).filter(Boolean))).sort();
  var chilled = /milk|cream|butter|yog|chill/i.test(x.item + ' ' + (ing.category || '')) && !/powder/i.test(x.item);
  var ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 12px';
  ov.innerHTML = '<div class="card" style="max-width:460px;width:100%;margin:0"><h2>Add to deliveries</h2><p class="small muted">' + esc(x.item) + ' – this puts the batch into deliveries, so it shows in stock and the food safety records.</p>' +
    field('Batch number', '<input id="ad_batch" value="' + esc(x.batch) + '">') +
    field('Best before', '<input id="ad_use" type="date" value="' + esc(/^\d{4}-\d{2}-\d{2}$/.test(x.useBy || '') ? x.useBy : '') + '">') +
    field('Delivery date', '<input id="ad_date" type="date" max="' + today() + '">') +
    field('Supplier', '<input id="ad_sup" value="' + esc(last.supplier || ing.supplier || '') + '" list="dl_adsup"><datalist id="dl_adsup">' + sups.map(function (q) { return '<option value="' + esc(q) + '">'; }).join('') + '</datalist>') +
    '<div class="grid2">' + field('How much was delivered', '<input id="ad_qty" inputmode="decimal"' + (last.qty !== '' && last.qty != null ? ' placeholder="last time ' + esc(last.qty) + '"' : '') + '>') + field('Unit', '<input id="ad_unit" value="' + esc(last.unit || ing.unit || x.unit || '') + '">') + '</div>' +
    (chilled ? field('Temperature on arrival °C', '<input id="ad_temp" inputmode="decimal">') : '') +
    '<div class="bar" style="position:static;margin-top:10px"><button class="btn soft" type="button" id="ad_x">Cancel</button><button class="btn" type="button" id="ad_ok">Add delivery</button></div></div>';
  document.body.appendChild(ov);
  var q = function (id) { var e = ov.querySelector('#' + id); return e ? e.value.trim() : ''; };
  ov.querySelector('#ad_x').onclick = function () { ov.remove(); };
  ov.querySelector('#ad_date').focus();
  ov.querySelector('#ad_ok').onclick = function () {
    if (!q('ad_date')) return toast('Put in the delivery date');
    if (!q('ad_batch')) return toast('Put in the batch number');
    if (!bbOk([{ name: x.item, bb: q('ad_use') }])) return;
    var d = { id: uid(), date: q('ad_date'), item: ing.name || x.item, category: '', supplier: q('ad_sup'), qty: num(q('ad_qty')), unit: q('ad_unit'), useBy: q('ad_use'), temp: num(q('ad_temp')), batch: q('ad_batch'), comment: 'Added from a batch record', by: S.user };
    record('delivery', d, x.item + ' added to deliveries');
    ov.remove(); if (done) done(d);
  };
}
// a pack size or price that looks wrong (5 g of salt, 759 bottles in a pack) – asked before saving
function packOk(list) {
  var bad = [];
  list.forEach(function (x) {
    var ps = Number(x.packSize) || 0, pu = String(x.packUnit || x.unit || '').toLowerCase(), u = String(x.unit || '').toLowerCase(), pr = Number(x.price) || 0;
    if (ps) {
      if ((pu === 'g' || pu === 'ml') && ps < 50) bad.push('• ' + x.name + ': a pack of ' + ps + ' ' + pu + ' looks very small – should it be ' + ps + ' ' + (pu === 'g' ? 'kg' : 'L') + '?');
      else if ((pu === 'kg' || pu === 'l') && ps > 200) bad.push('• ' + x.name + ': a pack of ' + ps + ' ' + pu + ' looks very big – should it be ' + ps + ' ' + (pu === 'kg' ? 'g' : 'ml') + '?');
      else if (!/^(kg|g|l|ml)$/.test(pu) && ps > 200) bad.push('• ' + x.name + ': ' + ps + ' ' + pu + ' in one pack looks too many');
    }
    if (pr > 0 && !/water/i.test(x.name)) {
      var perKL = u === 'g' || u === 'ml' ? pr * 1000 : u === 'kg' || u === 'l' ? pr : null;
      if (perKL != null && perKL > 150) bad.push('• ' + x.name + ': £' + (Math.round(perKL * 100) / 100) + ' per ' + (u === 'g' || u === 'kg' ? 'kg' : 'litre') + ' looks high');
      if (perKL != null && perKL < 0.05 || perKL == null && pr < 0.01) bad.push('• ' + x.name + ': £' + pr + ' per ' + (u || 'unit') + ' looks too low');
    }
  });
  return !bad.length || confirm('Please check:\n\n' + bad.join('\n') + '\n\nTap OK to save anyway, or Cancel to correct it.');
}

// Type-ahead: start typing an ingredient, supplier or batch number and a list of matches drops down, getting shorter
// with every letter. Tap one to use it. If nothing matches (a new product) the list disappears.
(function () {
  var box = null, cur = null;
  function hide() { if (box) box.style.display = 'none'; cur = null; }
  function opts(inp) { var dl = document.getElementById(inp.dataset.list || ''); return dl ? Array.prototype.map.call(dl.options, function (o) { return { v: o.value, l: o.label && o.label !== o.value ? o.label : (o.textContent || '').trim() }; }).filter(function (o) { return o.v; }) : []; }
  function show(inp, all) {
    var v = inp.value.trim().toLowerCase(), list = opts(inp);
    var m = all && !v ? list : list.filter(function (o) { var t = o.v.toLowerCase(); return v && t !== v && (t.indexOf(v) === 0 || t.split(/[\s\-–(]+/).some(function (w) { return w.indexOf(v) === 0; }) || (v.length >= 3 && t.indexOf(v) >= 0)); })
      .sort(function (a, b) { return (a.v.toLowerCase().indexOf(v) === 0 ? 0 : 1) - (b.v.toLowerCase().indexOf(v) === 0 ? 0 : 1) || (a.v < b.v ? -1 : 1); });
    if (!m.length) return hide();
    if (!box) { box = document.createElement('div'); box.setAttribute('data-ta', ''); box.style.cssText = 'position:absolute;z-index:10000;background:#fff;border:1px solid #c8cbd6;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.18);max-height:260px;overflow:auto;font-size:16px'; document.body.appendChild(box); }
    cur = inp;
    box.innerHTML = m.slice(0, 12).map(function (o, i) { return '<div data-v="' + i + '" style="padding:11px 14px;border-bottom:1px solid #eee;cursor:pointer"><b>' + esc(o.v) + '</b>' + (o.l ? ' <span class="small muted">' + esc(o.l) + '</span>' : '') + '</div>'; }).join('');
    var r = inp.getBoundingClientRect();
    box.style.left = (r.left + window.scrollX) + 'px'; box.style.top = (r.bottom + window.scrollY + 2) + 'px'; box.style.minWidth = Math.max(r.width, 200) + 'px'; box.style.display = '';
    Array.prototype.forEach.call(box.children, function (d) {
      var pick = function (e) { e.preventDefault(); var o = m[Number(d.dataset.v)]; inp.value = o.v; hide(); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
      d.addEventListener('mousedown', pick); d.addEventListener('touchstart', function (e) { d.dataset.t = '1'; }, { passive: true }); d.addEventListener('touchmove', function () { delete d.dataset.t; }, { passive: true }); d.addEventListener('touchend', function (e) { if (d.dataset.t) pick(e); });
    });
  }
  document.addEventListener('focusin', function (e) { try {
    var t = e.target; if (!t || t.tagName !== 'INPUT') return;
    // "new item" boxes also show what's already on the list, so the same thing isn't added twice under another spelling
    var all = t.matches('#d_item, #n_name, tr.newing input[data-k=name]') ? ['dl_allings', (D().ingredients || []).map(function (i) { return i.name; })] : t.matches('tr.newpack input[data-k=name]') ? ['dl_allpacks', (D().packItems || []).map(function (i) { return i.item; })] : null;
    if (all) { var dl = document.getElementById(all[0]); if (!dl) { dl = document.createElement('datalist'); dl.id = all[0]; document.body.appendChild(dl); } dl.innerHTML = all[1].map(function (n) { return '<option value="' + esc(n) + '">'; }).join(''); t.dataset.list = all[0]; t.setAttribute('autocomplete', 'off'); }
    if (t.getAttribute('list')) { t.dataset.list = t.getAttribute('list'); t.removeAttribute('list'); t.setAttribute('autocomplete', 'off'); }
    if (t.dataset.list) show(t, /^dl_lot/.test(t.dataset.list) && !t.value);
  } catch (err) { hide(); } });
  document.addEventListener('input', function (e) { try { var t = e.target; if (t && t.dataset && t.dataset.list && t === document.activeElement) show(t); } catch (err) { hide(); } });
  document.addEventListener('focusout', function (e) { if (e.target === cur) setTimeout(function () { if (document.activeElement !== cur) hide(); }, 150); });
  document.addEventListener('scroll', function () { if (cur && box && box.style.display !== 'none') show(cur, /^dl_lot/.test(cur.dataset.list) && !cur.value); }, true);
  window.addEventListener('hashchange', hide);
})();

// the yellow note under a box: "isn't on the list – is this new?" with Yes / fix it buttons
function typedNote(inp, msg, kind) {
  var n = inp.parentNode && inp.parentNode.querySelector('[data-typednote]');
  if (!msg) { if (n) n.remove(); inp.style.background = ''; delete inp.dataset.newok; return; }
  if (!n) { n = document.createElement('div'); n.setAttribute('data-typednote', ''); n.className = 'small'; n.style.cssText = 'color:#8a5a00;margin-top:4px'; inp.insertAdjacentElement('afterend', n); }
  inp.style.background = '#fff4d6'; delete inp.dataset.newok; n.style.color = '#8a5a00';
  var addDel = kind === 'batch' && inp.matches('[data-k=batch][data-i]');
  n.innerHTML = '⚠ ' + esc(msg) + (kind ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">' + (addDel ? '<button type="button" class="btn sm" data-tn="del">Yes – add it to deliveries</button>' : '') + '<button type="button" class="btn ' + (addDel ? 'soft ' : '') + 'sm" data-tn="yes">' + (addDel ? 'Just use it' : 'Yes – save as a new ' + esc(kind)) + '</button><button type="button" class="btn soft sm" data-tn="fix">No – let me fix it</button></div>' : '');
  if (!kind) return;
  if (addDel) n.querySelector('[data-tn=del]').onclick = function () {
    var tr = inp.closest('tr'), g = function (k) { var e = tr.querySelector('[data-k=' + k + ']'); return e ? e.value.trim() : ''; };
    addDeliveryPopup({ item: g('ingredient'), batch: inp.value.trim(), useBy: g('useBy'), unit: g('unit') }, function (d) {
      if (d.batch !== inp.value.trim()) { inp.value = d.batch; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      var ub = tr.querySelector('[data-k=useBy]'); if (ub && d.useBy && ub.value !== d.useBy) { ub.value = d.useBy; ub.dispatchEvent(new Event('input', { bubbles: true })); }
      inp.dataset.newok = '1'; inp.style.background = '#e8f5e9'; n.style.color = '#2e7d32'; n.innerHTML = '✓ Added to deliveries (delivered ' + esc(nice(d.date)) + ') – it\'s now in stock.';
    });
  };
  n.querySelector('[data-tn=yes]').onclick = function () { inp.dataset.newok = '1'; inp.style.background = '#e8f5e9'; n.innerHTML = '✓ OK – it\'ll go in as a new ' + esc(kind) + ' when you save. Jonny and Paul will see it to check.'; n.style.color = '#2e7d32'; };
  n.querySelector('[data-tn=fix]').onclick = function () { inp.focus(); inp.select(); };
}

// Jonny only: each shop's buying – tap a shop for its summary, tap an order date for what was in it
function shopSumList() {
  if (!isOwner() || !navigator.onLine) { if ($('#shopsums')) $('#shopsums').innerHTML = '<h2>Shops</h2><p class="muted small">Needs the internet.</p>'; return; }
  ownerCall({ op: 'shopsum' }).then(function (r) {
    var box = $('#shopsums'); if (!box || !r.ok) return;
    var list = r.shops || [];
    box.innerHTML = '<h2>Shops</h2><p class="muted small">Only you see this. Tap a shop to see what they\'ve been buying.</p>' +
      (list.length ? '<div class="list">' + list.map(function (x) {
        return '<a class="row" href="#shopsum/' + encodeURIComponent(x.shop) + '"><span><b>' + esc(x.shop) + '</b><br><span class="muted small">' + (x.orders.length ? x.orders.length + ' order' + (x.orders.length === 1 ? '' : 's') + ' · last ' + esc(short(x.last)) : 'No orders yet') + '</span></span><span>›</span></a>';
      }).join('') + '</div>' : '<p class="muted">No shops yet – add them on the Shops tab of the Google Sheet.</p>');
  }).catch(function () { });
}
ROUTES.shopsum = function (name) {
  if (onlyJonny('Shop summary')) return;
  var hd = back('packing', 'Shop orders') + '<h1>' + esc(name) + '</h1>';
  if (!navigator.onLine) return render(hd + '<div class="card">This page needs the internet.</div>');
  render(hd + '<p class="muted center">Loading…</p>');
  var here = location.hash;
  ownerCall({ op: 'shopsum' }).then(function (r) {
    if (location.hash !== here) return;
    var x = (r.shops || []).find(function (q) { return q.shop === name; });
    if (!x) return render(hd + '<div class="card">No orders found for this shop.</div>');
    var top = function (a) { return a.length ? '<ol style="margin:4px 0 0;padding-left:20px">' + a.map(function (t) { return '<li>' + esc(t[0]) + ' – <b>' + t[1] + '</b></li>'; }).join('') + '</ol>' : '<p class="muted small">None yet</p>'; };
    render(hd +
      '<div class="card"><div class="grid3" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;text-align:center">' +
        '<div><div class="stat">' + gbp(x.spend) + '</div><div class="muted small">spent to date (before VAT)</div></div>' +
        '<div><div class="stat">' + x.small.toLocaleString('en-GB') + '</div><div class="muted small">small tubs</div></div>' +
        '<div><div class="stat">' + x.large.toLocaleString('en-GB') + '</div><div class="muted small">big tubs</div></div>' +
        '<div><div class="stat">' + x.orders.length + '</div><div class="muted small">orders</div></div></div></div>' +
      '<div class="card"><div class="grid2"><div><h3>Top small tub flavours</h3>' + top(x.topSmall) + '</div><div><h3>Top big tub flavours</h3>' + top(x.topLarge) + '</div></div></div>' +
      '<div class="card"><h2>Orders</h2><p class="muted small">Tap a date to see what was ordered.</p>' +
      (x.orders.length ? x.orders.map(function (o, i) {
        var sm = o.lines.filter(function (l) { return l.size !== 'large'; }).reduce(function (a, l) { return a + l.qty; }, 0), lg = o.lines.reduce(function (a, l) { return a + (l.size === 'large' ? l.qty : 0); }, 0);
        return '<div style="border-bottom:1px solid #eee"><a href="#" class="row" data-ord="' + i + '" style="display:flex;justify-content:space-between;padding:10px 4px"><span><b>' + esc(nice(o.date)) + '</b> <span class="muted small">' + esc(o.no) + ' · ' + esc(o.status) + '</span><br><span class="muted small">' + sm + ' small, ' + lg + ' big</span></span><b>' + gbp(o.total) + '</b></a>' +
          '<div data-det="' + i + '" style="display:none;padding:0 4px 10px"><table class="t"><tr><th>Flavour</th><th>Size</th><th>Qty</th><th>Each</th><th>Total</th></tr>' +
          o.lines.map(function (l) { return '<tr><td>' + esc(l.flavour) + '</td><td>' + (l.size === 'large' ? 'big' : 'small') + '</td><td>' + l.qty + '</td><td>' + gbp(l.price) + '</td><td>' + gbp(l.qty * l.price) + '</td></tr>'; }).join('') +
          '<tr><td colspan="4"><b>Order total</b> <span class="muted small">(before VAT)</span></td><td><b>' + gbp(o.total) + '</b></td></tr></table></div></div>';
      }).join('') : '<p class="muted">No orders yet.</p>') + '</div>');
    $$('[data-ord]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); var d = $('[data-det="' + a.dataset.ord + '"]'); d.style.display = d.style.display === 'none' ? '' : 'none'; }; });
  }).catch(function () { render(hd + '<div class="card">No connection.</div>'); });
};

// My to do
ROUTES.jtodo = function () { ownLoad('My to do', 'jtodo', drawJtodo); };
function drawJtodo(r) {
  var t = today(), items = r.items || [];
  var row = function (x) {
    var late = x.due && x.due < t, soon = x.due && !late && x.due <= addDays(t, 7);
    return '<div class="row" style="' + (late ? 'background:#fdecea;' : soon ? 'background:#fff4d6;' : '') + 'border-radius:8px;padding:8px 10px"><span><b>' + esc(x.item) + '</b><br><span class="small muted">' +
      (x.due ? (late ? '<b style="color:#b3261e">overdue – </b>' : '') + esc(nice(x.due)) : 'no date') + (x.repeat ? ' · repeats ' + esc(x.repeat) : '') + (x.notes ? ' · ' + esc(x.notes) : '') + '</span></span>' +
      '<span style="white-space:nowrap"><button class="btn sm" data-done="' + esc(x.id) + '">Done ✓</button> <button class="btn soft sm" data-del="' + esc(x.id) + '">✕</button></span></div>';
  };
  render(back('office', 'Office') + '<h1>✅ My to do</h1><p class="muted">Only you see this. Repeating jobs (wages, invoices, VAT…) come back with the next date when you tick them.</p>' +
    '<div class="card"><div class="list">' + (items.map(row).join('') || '<p class="muted">Nothing on the list.</p>') + '</div></div>' +
    '<div class="card"><h2>Add a job</h2>' + field('What', inp('j_item', '', 'text', ' placeholder="e.g. Pay wages, send shop invoices, VAT return"')) +
    '<div class="grid2">' + field('When', inp('j_due', '', 'date')) + field('Repeat', '<select id="j_rep"><option value="">No</option><option>weekly</option><option>fortnightly</option><option>monthly</option><option>every 3 months</option><option>yearly</option></select>') + '</div>' +
    field('Notes (optional)', inp('j_notes', '')) + '<button class="btn" id="j_add">Add</button></div>');
  var call = function (d, msg) { ownerCall({ op: 'jtodo', d: d }).then(function (x) { if (x.ok) { if (S.own && S.own.dash) S.own.dash.jtodo = x.items; if (msg) toast(msg); drawJtodo(x); } else toast(x.error || 'Could not save'); }).catch(function () { toast('No connection'); }); };
  $('#j_add').onclick = function () { if (!val('j_item')) return toast('What needs doing?'); $('#j_add').disabled = true; call({ act: 'add', item: val('j_item'), due: val('j_due'), repeat: val('j_rep'), notes: val('j_notes') }, 'Added'); };
  $$('[data-done]').forEach(function (b) { b.onclick = function () { b.disabled = true; call({ act: 'done', id: b.dataset.done }, 'Done'); }; });
  $$('[data-del]').forEach(function (b) { b.onclick = function () { if (confirm('Remove this job?')) call({ act: 'del', id: b.dataset.del }, 'Removed'); }; });
}

// Totals
ROUTES.totals = function (which) { ownLoad('Totals', 'totals', function (r) { S.totals = r; drawTotals(r, which); }); };
function drawTotals(r, which) {
  var R = r.ranges || [], i = Math.max(0, R.map(function (x) { return x.label; }).indexOf(decodeURIComponent(which || '12 months')));
  var g = R[i] || {}, c = g.cur || {}, p = g.prev;
  var pc = function (a, b) { if (!p || b == null || !b) return '<span class="muted small">' + (p ? 'no figures last year' : '') + '</span>'; var x = Math.round((a - b) / b * 100); return '<span style="font-weight:bold;color:' + (x >= 0 ? '#1b7a4a' : '#b3261e') + '">' + (x > 0 ? '▲ +' : x < 0 ? '▼ ' : '') + x + '%</span> <span class="muted small">vs last year</span>'; };
  var n = function (v) { return (Number(v) || 0).toLocaleString('en-GB'); };
  var tile = function (label, big, sub, key) { return '<div class="card" style="margin:0;padding:16px 18px;border-top:4px solid #1c2140"><div class="small muted" style="text-transform:uppercase;letter-spacing:.06em">' + label + '</div><div style="font-family:Georgia,serif;font-size:30px;color:#1c2140;line-height:1.25;margin:4px 0">' + big + '</div><div class="small">' + (sub || '') + '</div>' + (key ? '<div style="margin-top:4px">' + pc(c[key[0]], p && p[key[0]]) + '</div>' : '') + '</div>'; };
  var m = r.month || {}, mc = m.cur || {}, mp = m.prev || {};
  var mpc = function (k) { var b = mp[k], a = mc[k]; if (!b) return '<span class="muted">–</span>'; var x = Math.round((a - b) / b * 100); return '<b style="color:' + (x >= 0 ? '#1b7a4a' : '#b3261e') + '">' + (x > 0 ? '+' : '') + x + '%</b>'; };
  var ingRows = (r.topIngredients || []).map(function (k) { var a = (c.ing || {})[k], b = p && (p.ing || {})[k]; if (!a && !b) return ''; var u = (a || b).unit; return '<tr><td>' + esc(k) + '</td><td><b>' + n(Math.round(a ? a.qty : 0)) + '</b> ' + esc(u) + '</td><td>' + (p ? (b ? n(Math.round(b.qty)) + ' ' + esc(u) : '–') : '') + '</td><td>' + (p && b && a ? pc(a.qty, b.qty) : '') + '</td></tr>'; }).join('');
  render(back('office', 'Office') + '<h1>📊 Totals</h1><p class="muted">Only you see this. Compared with the same dates a year earlier. Sales by tub come from the Saturday stock takes, so they fill in as those build up' + (r.since ? ' (records start ' + esc(nice(r.since)) + ')' : '') + '.</p>' +
    '<div class="chips noprint" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">' + R.map(function (x, j) { return '<a class="btn ' + (j === i ? '' : 'soft ') + 'sm" href="#totals/' + encodeURIComponent(x.label) + '">' + esc(x.label) + '</a>'; }).join('') + '</div>' +
    '<div class="hint" style="margin-bottom:14px"><b>' + esc(m.label || '') + ' so far vs the same days last year:</b> shop sales ' + gbp(mc.shopSales, 0) + ' (' + mpc('shopSales') + ') · tubs sold ' + n(mc.soldS + mc.soldL) + ' (' + mpc('soldS') + ') · mix made ' + n(mc.mixLitres) + ' L (' + mpc('mixLitres') + ')</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px">' +
    tile('Shop sales', gbp(c.shopSales, 0), n(c.shopOrders) + ' orders · ' + n(c.shopTubsS) + ' small, ' + n(c.shopTubsL) + ' big', ['shopSales']) +
    tile('Tubs sold (all)', n(c.soldS + c.soldL), n(c.soldS) + ' small · ' + n(c.soldL) + ' big · ≈ ' + n(c.soldLitres) + ' L' + (c.weeksCounted ? '' : '<br><i>needs stock takes</i>'), ['soldS']) +
    tile('Farm shop', n(c.farmS + c.farmL) + ' tubs', n(c.farmS) + ' small · ' + n(c.farmL) + ' big', ['farmS']) +
    tile('Weddings', n(c.weddings), n(c.weddingTubs) + ' small tubs served', ['weddings']) +
    tile('Tubs made', n(c.madeS + c.madeL), n(c.madeS) + ' small · ' + n(c.madeL) + ' big' + (c.madeN ? ' · ' + n(c.madeN) + ' Napolis' : ''), ['madeS']) +
    tile('Mix made', n(c.mixLitres) + ' L', n(c.batches) + ' batch' + (c.batches === 1 ? '' : 'es'), ['mixLitres']) + '</div>' +
    '<div class="card"><h2>Ingredients used – ' + esc(g.label || '') + '</h2><div class="scroll"><table class="t"><tr><th>Ingredient</th><th>Used</th><th>' + (p ? 'Same time last year' : '') + '</th><th></th></tr>' + (ingRows || '<tr><td colspan="4" class="muted">Fills in from the batch records.</td></tr>') + '</table></div></div>');
}

// Shopping list
ROUTES.shoplist = function () { ownLoad('Shopping list', 'shop', function (r) { S.shopItems = r.items || []; drawShop(); }); };
function drawShop() {
  var items = S.shopItems || [], months = S.shopMonths || 2, picked = S.shopPicked || (S.shopPicked = {});
  if (!S.shopInit) { items.forEach(function (x) { if (x.warn) picked[x.name] = true; }); S.shopInit = true; }
  var cvt = function (q, from, to) { from = String(from || '').toLowerCase(); to = String(to || '').toLowerCase(); if (from === to) return q; if (from === 'g' && to === 'kg') return q / 1000; if (from === 'kg' && to === 'g') return q * 1000; if (from === 'ml' && to === 'l') return q / 1000; if (from === 'l' && to === 'ml') return q * 1000; return q; };
  var plan = function (x) {
    var need = Math.max(0, (x.weekly || 0) * months * 4.345 - (x.est || 0));
    var size = x.packSize ? cvt(x.packSize, x.packUnit, x.unit) : 0;
    var packs = size ? Math.ceil(need / size - 1e-9) : Math.ceil(need);
    var cost = x.price ? (size ? packs * size : need) * x.price : null;
    return { need: need, packs: packs, cost: cost, size: size };
  };
  var lp = function (x) { var l = x.lastPaid; if (!l) return x.price ? gbp(x.price) + '/' + esc(x.unit) : '<span class="muted">–</span>'; return gbp(l.total) + ' for ' + l.qty + ' ' + esc(l.unit) + '<br><span class="small muted">' + esc(short(l.date)) + (l.supplier ? ' · ' + esc(l.supplier) : '') + '</span>'; };
  var tot = 0, rows = items.map(function (x) {
    var pl = plan(x), on = !!picked[x.name]; if (on && pl.cost) tot += pl.cost;
    return '<tr data-n="' + esc(x.name) + '" style="' + (x.warn ? 'background:#fff4d6' : '') + '"><td class="noprint"><input type="checkbox" data-pick="' + esc(x.name) + '"' + (on ? ' checked' : '') + ' style="width:22px;height:22px"></td>' +
      '<td><b>' + esc(x.name) + '</b>' + (x.warn ? ' <span class="pill warn">suggested</span>' : '') + '<br><span class="small muted">' + esc(x.supplier || 'supplier?') + (x.weeksLeft != null ? ' · ≈ ' + x.weeksLeft + ' wks left' : '') + '</span></td>' +
      '<td>' + (x.est == null ? '<span class="muted">not counted</span>' : Math.round(x.est * 10) / 10 + ' ' + esc(x.unit)) + '</td><td>' + (x.weekly ? Math.round(x.weekly * 100) / 100 + ' ' + esc(x.unit) : '<span class="muted">–</span>') + '</td>' +
      '<td><b>' + (pl.size ? pl.packs + ' × ' + x.packSize + ' ' + esc(x.packUnit) : (Math.round(pl.need * 10) / 10) + ' ' + esc(x.unit)) + '</b>' + (!x.weekly ? '<br><span class="small muted">no usage yet</span>' : '') + '</td>' +
      '<td>' + lp(x) + '</td><td>' + (pl.cost != null ? gbp(pl.cost) : '<span class="muted">–</span>') + '</td>' +
      '<td class="noprint"><a class="small" target="_blank" href="https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(x.name + (x.packSize ? ' ' + x.packSize + x.packUnit : '') + ' wholesale') + '">Prices online ↗</a></td></tr>';
  }).join('');
  var sups = {}; items.filter(function (x) { return picked[x.name]; }).forEach(function (x) { var k = x.supplier || 'Other'; (sups[k] = sups[k] || { email: x.email, list: [] }).list.push(x); });
  render(back('office', 'Office') + '<h1>🛒 Shopping list</h1><p class="muted">Only you see this. Tick what you want to buy and how long it should last. Amounts are worked out from what the batches have used over the last 12 weeks, minus what\'s in stock. Things running low are ticked for you.</p>' +
    '<div class="card noprint"><b>Enough to last </b><select id="sh_m">' + [1, 2, 3, 4, 6, 9, 12].map(function (m) { return '<option value="' + m + '"' + (m === months ? ' selected' : '') + '>' + m + ' month' + (m > 1 ? 's' : '') + '</option>'; }).join('') + '</select>' +
    ' <button class="btn soft sm" id="sh_all">Tick all</button> <button class="btn soft sm" id="sh_none">Untick all</button></div>' +
    '<div class="card scroll"><table class="t"><tr><th class="noprint"></th><th>Item</th><th>In stock</th><th>Use / week</th><th>To buy (' + months + ' mo)</th><th>Last paid</th><th>Cost (≈)</th><th class="noprint"></th></tr>' + rows + '</table>' +
    '<p style="margin-top:10px"><b>Estimated total for what\'s ticked: ' + gbp(tot) + '</b> <span class="small muted">(where prices are known, ex VAT)</span></p></div>' +
    '<div class="card noprint"><h2>Order it</h2>' + (Object.keys(sups).length ? Object.keys(sups).map(function (k) {
      var lines = sups[k].list.map(function (x) { var pl = plan(x); return x.name + ': ' + (pl.size ? pl.packs + ' x ' + x.packSize + ' ' + x.packUnit : Math.round(pl.need * 10) / 10 + ' ' + x.unit); });
      return '<div class="row"><span><b>' + esc(k) + '</b><br><span class="small muted">' + esc(lines.join(' · ')) + '</span></span>' + (k !== 'Other' && !/makro|cash|shop/i.test(k) ? '<a class="btn soft sm" href="' + esc(orderMail(lines, k, sups[k].email)) + '">✉️ Draft email</a>' : '<span class="small muted">buy in store</span>') + '</div>';
    }).join('') : '<p class="muted">Tick some items first.</p>') +
    '<p><button class="btn" onclick="window.print()">🖨️ Print / save as PDF</button></p><p class="small muted">"Draft email" opens an email in your mail app for you to check and send – nothing is sent automatically. "Prices online" opens a Google Shopping search. Send me photos of your invoices in the Claude chat and I\'ll compare prices properly, including delivery to NI.</p></div>');
  $('#sh_m').onchange = function () { S.shopMonths = Number(this.value); drawShop(); };
  $('#sh_all').onclick = function () { items.forEach(function (x) { picked[x.name] = true; }); drawShop(); };
  $('#sh_none').onclick = function () { S.shopPicked = {}; drawShop(); };
  $$('[data-pick]').forEach(function (b) { b.onchange = function () { if (b.checked) picked[b.dataset.pick] = true; else delete picked[b.dataset.pick]; drawShop(); }; });
}

// Costs & prices (finance)
// Takes a photo (or picks one), shrinks it and has Google read the writing on it
function scanPhoto(cb) {
  if (!navigator.onLine) return toast('Reading a photo needs the internet');
  var f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.setAttribute('capture', 'environment');
  f.onchange = function () {
    var file = f.files && f.files[0]; if (!file) return;
    toast('Reading the photo…');
    var img = new Image();
    img.onload = function () {
      var k = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src);
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ a: 'ocr', k: S.key, img: c.toDataURL('image/jpeg', 0.85).split(',')[1], mime: 'image/jpeg' }) })
        .then(function (r) { return r.json(); }).then(cb).catch(function () { cb({ ok: false, error: 'No connection' }); });
    };
    img.onerror = function () { toast('Could not open that photo'); };
    img.src = URL.createObjectURL(file);
  };
  f.click();
}
// Invoice photo: finds the lines that mention an ingredient or packaging item and suggests the price
function invoiceMatches(text) {
  var lines = String(text || '').split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
  var money = function (l) { return (l.match(/£?\d{1,5}(?:,\d{3})*\.\d{2}\b/g) || []).map(function (x) { return Number(x.replace(/[£,]/g, '')); }); };
  var words = function (n) { return String(n).toLowerCase().replace(/\(.*?\)/g, '').split(/[^a-z]+/).filter(function (w) { return w.length >= 4 && !/^(paste|cream|powder|tubs?|lids?|label|small|large|with|flavours?|plain|whole)$/.test(w); }); };
  var out = [];
  $$('tr[data-ing], tr[data-pk]').forEach(function (tr) {
    var name = tr.dataset.ing || tr.dataset.pk, w = words(name); if (!w.length) return;
    for (var i = 0; i < lines.length; i++) {
      var low = lines[i].toLowerCase();
      if (!w.every(function (x) { return low.indexOf(x) >= 0; })) continue;
      var nums = money(lines[i]); for (var j = 1; j <= 2 && !nums.length && lines[i + j]; j++) nums = money(lines[i + j]);
      if (!nums.length) continue;
      var price = nums.length >= 2 ? nums[nums.length - 2] : nums[0];
      out.push({ tr: tr, name: name, line: lines[i], price: price }); break;
    }
  });
  return out;
}
// Invoice photo for deliveries: finds each ingredient and the batch / lot number and best-before printed near it (no prices shown)
function invoiceLots(text) {
  var lines = String(text || '').split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean), out = [];
  var words = function (n) { return String(n).toLowerCase().replace(/\(.*?\)/g, '').split(/[^a-z]+/).filter(function (w) { return w.length >= 4 && !/^(paste|cream|powder|whole|with|homemade)$/.test(w); }); };
  var M = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var dateIn = function (t) {
    var m = t.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/) , y;
    if (m) { y = Number(m[3]); if (y < 100) y += 2000; return y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
    m = t.match(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{2,4})\b/i);
    if (m) { y = Number(m[3]); if (y < 100) y += 2000; return y + '-' + ('0' + M[m[2].toLowerCase()]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
    return '';
  };
  (D().ingredients || []).filter(function (i) { return !/packag|clean/i.test(i.category || ''); }).forEach(function (ing) {
    var w = words(ing.name); if (!w.length) return;
    for (var i = 0; i < lines.length; i++) {
      if (!w.every(function (x) { return lines[i].toLowerCase().indexOf(x) >= 0; })) continue;
      var near = lines.slice(i, i + 3).join(' ');
      var b = near.match(/(?:lot|batch|l\/n|b\/n|bn|lot\s*no|batch\s*no|lot\s*code)\s*[:.#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,18})/i);
      var bbAt = near.search(/(best\s*before|bb[e]?\b|use\s*by|exp)/i), ub = dateIn(bbAt >= 0 ? near.slice(bbAt) : '');
      var q = lines[i].match(/^\s*(\d{1,3})\s*(?:x|×)?\s/i);
      out.push({ item: ing.name, batch: b ? b[1].replace(/[\-\/]+$/, '') : '', useBy: ub, qty: q ? q[1] : '', unit: '' });
      break;
    }
  });
  return out;
}
/* ---------- Christmas pre-orders (staff see orders, Jonny also sees money and settings) ---------- */
// home page warning when Christmas orders need more big tubs than will be in stock on collection day
// best before sanity check when it's typed in (deliveries and the stock page): needs a full date with the year,
// and flags one that's already passed or is more than 5 years away (usually the wrong year)
function bbOk(list) {
  var t = today(), far = addDays(t, 5 * 365), bad = [];
  list.forEach(function (x) {
    var v = String(x.bb || '').trim(); if (!v) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) bad.push('• ' + x.name + ': "' + v + '" isn\'t a full date (day, month and year)');
    else if (v < t) bad.push('• ' + x.name + ': ' + nice(v) + ' has already passed');
    else if (v > far) bad.push('• ' + x.name + ': ' + nice(v) + ' is more than 5 years away – is the year right?');
  });
  return !bad.length || confirm('Please check the best before date' + (bad.length > 1 ? 's' : '') + ':\n\n' + bad.join('\n') + '\n\nTap OK to save anyway, or Cancel to correct it.');
}
// home screen (Jonny and Paul): staff hours still to enter after a production day, and tub counts to confirm
function prodAlerts() {
  if (!(isOwner() || S.user === manager())) return '';
  var out = '', hd = D().hoursDue || [], te = D().tubEst || [];
  if (hd.length) out += '<a href="#hours" style="display:flex;gap:10px;background:#e8f0fe;border:2px solid #1c2140;color:#1c2140;text-decoration:none;border-radius:12px;padding:12px 14px;margin-bottom:12px"><span style="font-size:22px">⏱️</span><span><b>Enter the staff hours</b><br><span class="small">Production on ' + hd.map(function (d) { return esc(nice(d)); }).join(', ') + ' – no hours entered yet.</span></span></a>';
  te.forEach(function (x) {
    if (x.noBefore) { out += '<div style="background:#fff4d6;border:2px solid #d99a00;border-radius:12px;padding:12px 14px;margin-bottom:12px"><b>🍦 Batch ' + esc(x.no) + ' ' + esc(x.flavour) + ' – no tub count entered</b><br>' +
      '<span class="small">The stock take on ' + esc(short(x.to)) + ' shows ' + x.small + ' small and ' + x.large + ' big ' + esc(x.flavour) + ' in total, but there\'s no earlier stock take to compare with, so this batch\'s share can\'t be worked out. Please enter the count.</span>' +
      '<div style="margin-top:8px"><a class="btn sm" href="#batch/' + encodeURIComponent(x.no) + '">Enter the tub count</a></div></div>'; return; }
    out += '<div data-te="' + esc(x.no) + '" style="background:#fff4d6;border:2px solid #d99a00;border-radius:12px;padding:12px 14px;margin-bottom:12px"><b>🍦 Batch ' + esc(x.no) + ' ' + esc(x.flavour) + ' – no tub count entered</b><br>' +
      '<span class="small">From the stock takes (' + esc(short(x.from)) + ' → ' + esc(short(x.to)) + '), about <b>' + x.small + ' small</b>, <b>' + x.large + ' big</b>' + (x.napolis ? ' and <b>' + x.napolis + ' Napolis</b>' : '') + ' were made. Does that look right?</span>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn sm" type="button" data-teok="' + esc(x.no) + '">Yes – save these</button><a class="btn soft sm" href="#batch/' + encodeURIComponent(x.no) + '">No – enter the count</a></div></div>';
  });
  return out;
}
function wireProdAlerts() {
  $$('[data-teok]').forEach(function (b) { b.onclick = function () {
    var x = (D().tubEst || []).find(function (y) { return y.no === b.dataset.teok; }); if (!x) return;
    record('tubCount', { no: x.no, large: x.large, small: x.small, napolis: x.napolis, from: x.from, to: x.to }, 'Batch ' + x.no + ' tub count saved');
    D().tubEst = D().tubEst.filter(function (y) { return y !== x; });
    var bb = (D().batches || []).find(function (y) { return String(y.no) === x.no; }); if (bb) { bb.large = x.large; bb.small = x.small; bb.napolis = x.napolis; if (!bb.tub) bb.tub = bb.date; }
    save(LS.data, S.data); b.closest('[data-te]').remove();
  }; });
}
// entries typed that don't match the lists – only Jonny and Paul see these
function checksAlert() {
  if (!(isOwner() || S.user === manager())) return '';
  var c = D().checks || []; if (!c.length) return '';
  return '<a href="#checks" style="display:flex;gap:10px;background:#fff4d6;border:2px solid #d99a00;color:#5a3d00;text-decoration:none;border-radius:12px;padding:12px 14px;margin-bottom:12px"><span style="font-size:22px">⚠️</span><span><b>' + c.length + ' entr' + (c.length === 1 ? 'y' : 'ies') + ' to check</b><br><span class="small">Names or batch numbers typed that don\'t match the lists. Tap to check.</span></span></a>';
}
ROUTES.checks = function () {
  if (!(isOwner() || S.user === manager())) return ROUTES.home();
  var c = D().checks || [];
  render(back() + '<h1>Entries to check</h1><p class="muted">These were typed in and didn\'t match anything on the lists. If one is wrong, correct it where it was entered (or on the Google Sheet), then tap <b>Done</b>. If it\'s right, just tap <b>Done</b>.</p>' +
    (c.length ? c.map(function (x, i) {
      return '<div class="card" data-ck="' + i + '"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><b>' + esc(x.where) + '</b><br>Typed: <b style="color:#b3261e">' + esc(x.typed) + '</b>' +
        (x.closest ? '<br>Closest on the list: <b>' + esc(x.closest) + '</b>' : '') + '<br><span class="small muted">' + esc(x.by) + ' · ' + esc(short(x.date)) + '</span></div>' +
        '<button class="btn soft sm" type="button" data-ckdone="' + i + '">Done</button></div></div>';
    }).join('') : '<div class="card"><p class="muted">Nothing to check.</p></div>'));
  $$('[data-ckdone]').forEach(function (b) { b.onclick = function () {
    var x = c[b.dataset.ckdone]; record('checkDone', { key: x.key }, 'Marked as checked');
    D().checks = (D().checks || []).filter(function (y) { return y.key !== x.key; }); save(LS.data, S.data);
    b.closest('.card').remove();
  }; });
};
function xmasAlert() {
  var x = D().xmas, bad = x && (x.flavours || []).filter(function (f) { return f.short > 0 || f.risk; });
  if (!bad || !bad.length) return '';
  return '<a href="#xmas" class="due" style="display:flex;gap:10px;background:#fdecea;border:2px solid #b3262e;color:#5a1712;text-decoration:none;border-radius:12px;padding:12px 14px;margin-bottom:12px"><span style="font-size:22px">🎄</span><span><b>Christmas orders – big tubs running short</b><br>' +
    bad.map(function (f) { return esc(f.flavour) + ': ' + f.need + ' ordered, ' + (f.stock == null ? 'no stock count yet' : (f.short ? 'only ' + f.stock + ' in stock' : 'about ' + Math.max(0, f.atCollection) + ' left by collection at usual sales')) + ' – <b>make ' + f.makeMore + ' more</b>'; }).join('<br>') + '</span></a>';
}
ROUTES.xmas = function () {
  var mine = isOwner();
  if (!navigator.onLine) return render(back() + '<h1>🎄 Christmas orders</h1><div class="card">This page needs the internet.</div>');
  render(back() + '<h1>🎄 Christmas orders</h1><p class="muted center">Loading…</p>');
  var load = mine ? ownerCall({ op: 'xmas' }) : fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ a: 'xmas', k: S.key }) }).then(function (r) { return r.json(); });
  load.then(function (r) { if (location.hash !== '#xmas') return; if (!r.ok) return toast(r.error || 'Could not open'); drawXmas(r, mine); }).catch(function () { toast('No connection'); });
};
function xmasTubTable(byF) {
  if (!Object.keys(byF).length) return '';
  var st = {}; ((D().xmas || {}).flavours || []).forEach(function (f) { st[f.flavour] = f; });
  return '<h3>Big tubs ordered vs stock</h3><div class="scroll"><table class="t"><tr><th>Flavour</th><th>Ordered</th><th>In stock now</th><th>By collection</th><th></th></tr>' +
    Object.keys(byF).sort(function (a, b) { return byF[b] - byF[a]; }).map(function (f) {
      var s = st[f] || {}, bad = s.short > 0 || s.risk;
      return '<tr' + (bad ? ' style="background:#fdecea"' : '') + '><td>' + esc(f) + '</td><td><b>' + byF[f] + '</b></td><td>' + (s.stock == null ? '<span class="muted">not counted</span>' : s.stock) + '</td><td>' + (s.atCollection == null ? '–' : Math.max(0, s.atCollection)) + (s.perWeek ? '<br><span class="small muted">sells ~' + s.perWeek + '/wk</span>' : '') + '</td><td>' + (bad ? '<b style="color:#b3262e">make ' + s.makeMore + ' more</b>' : '<span class="pill ok">OK</span>') + '</td></tr>';
    }).join('') + '</table></div><p class="small muted">Stock is the last ice cream stock take plus tubs made since, less usual sales.' + ((D().xmas || {}).collection ? ' Collection: ' + esc(nice(D().xmas.collection)) + '.' : ' Add the collection date below to plan for it.') + '</p>';
}
// one flavour line on the Christmas set-up: on the page?, name, and (Dukes'mas only) its own price
function xmasFlRow(f, sold) {
  var n = f.name && sold ? (sold.paid[f.name] || 0) : 0, h = f.name && sold ? (sold.held[f.name] || 0) : 0, lim = f.limit === '' || f.limit == null ? '' : Number(f.limit);
  var info = !f.name ? '' : '<span class="small muted" style="white-space:nowrap">' + n + ' sold' + (h ? ' + ' + h + ' paying' : '') + (lim !== '' ? ' · <b style="color:' + (n + h >= lim ? '#b3262e' : '#2e7d32') + '">' + Math.max(0, lim - n - h) + ' left</b>' : '') + '</span>';
  return '<div style="display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap"><input type="checkbox" data-fon' + (f.on ? ' checked' : '') + ' style="width:22px;height:22px"><input data-fname style="flex:1 1 160px" value="' + esc(f.name) + '" placeholder="Add a ' + (f.festive ? 'festive ' : '') + 'flavour">' +
    (f.festive ? '<span>£</span><input data-fprice type="number" step="0.01" inputmode="decimal" style="width:90px" value="' + esc(f.price || '') + '" placeholder="price">' : '') +
    '<input data-flimit type="number" min="0" step="1" inputmode="numeric" style="width:100px" value="' + esc(lim) + '" placeholder="Max tubs" title="Most tubs that can be sold – leave blank for no limit">' + info + '</div>';
}
function xmasColHtml(x) {
  return x.collected ? '<button type="button" class="btn soft sm" data-uncol="' + esc(x.id) + '" style="color:#2e7d32;font-weight:700" title="Tap to undo">✓ Collected</button>'
    : '<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" data-col="' + esc(x.id) + '" style="width:26px;height:26px"> <span class="small">Tick when collected</span></label>';
}
function drawXmas(r, mine) {
  var o = r.orders || [], live = o.filter(function (x) { return x.paid || !mine; });
  var paid = o.filter(function (x) { return x.paid; }), byF = {}, tubs = 0;
  paid.forEach(function (x) { tubs += x.tubs; x.items.split('\n').forEach(function (l) { var m = l.match(/^(\d+)\s*×\s*(.+)$/); if (m) byF[m[2]] = (byF[m[2]] || 0) + Number(m[1]); }); });
  var money = mine ? paid.reduce(function (t, x) { return t + Number(x.total || 0); }, 0) : 0;
  // one order: customer on the left, each flavour on its own line with the number set off to the side, then collected
  var row = function (x) {
    var lines = String(x.items).split('\n').filter(Boolean).map(function (l) { var m = l.match(/^(\d+)\s*×\s*(.+)$/);
      return '<div style="display:flex;gap:10px;align-items:center;margin:3px 0"><span style="min-width:36px;text-align:center;font-weight:700;background:#eef1f7;border-radius:6px;padding:2px 6px">' + esc(m ? m[1] : '') + '</span><span>' + esc(m ? m[2] : l) + '</span></div>'; }).join('');
    return '<div class="xo' + (x.collected ? ' xcol' : '') + '" data-oid="' + esc(x.id) + '" data-q="' + esc((x.no + ' ' + x.name + ' ' + x.phone).toLowerCase()) + '" style="display:flex;flex-wrap:wrap;gap:12px 20px;align-items:flex-start;padding:14px 2px;border-bottom:1px solid #ece6da;break-inside:avoid">' +
      '<div style="flex:1 1 200px;min-width:180px"><b style="font-size:17px">' + esc(x.name) + '</b><br><span class="small muted">' + esc(x.no) + ' · ' + esc(short(x.date)) + '</span><br><a href="tel:' + esc(x.phone.replace(/[^\d+]/g, '')) + '">' + esc(x.phone) + '</a>' +
        (mine ? '<br><span class="small">' + esc(x.email) + '</span>' : '') + (x.notes ? '<br><i class="small">' + esc(x.notes) + '</i>' : '') + '</div>' +
      '<div style="flex:2 1 260px;min-width:220px">' + lines + '<div class="small muted" style="margin-top:4px">' + x.tubs + ' tub' + (x.tubs === 1 ? '' : 's') + (mine && x.total !== undefined ? ' · <b>' + gbp(x.total) + '</b>' : '') + '</div></div>' +
      '<div style="flex:0 0 150px" data-colbox="' + esc(x.id) + '">' + xmasColHtml(x) + '</div></div>';
  };
  var s = r.settings || {}, sold = { paid: r.sold || {}, held: r.held || {} };
  var setup = !mine ? '' : '<div class="card noprint"><h2>Order page</h2>' +
    '<p><a class="btn sm" target="_blank" href="' + esc(r.page) + '?preview=1">Preview the page ↗</a> <button class="btn soft sm" type="button" id="x_copy">Copy the link</button></p>' +
    '<label class="tick"><input type="checkbox" id="x_open"' + (s.open ? ' checked' : '') + '> <b>Orders open</b> – customers can order and pay</label>' +
    '<div class="grid2">' + field('Price per big tub (£)', inp('x_price', s.price, 'number')) + field('Order by (optional)', inp('x_dl', s.deadline)) + field('Collection date (for stock planning)', inp('x_cdate', s.cdate, 'date')) + field('Minimum order (big tubs)', inp('x_min', s.min || 4, 'number')) + '</div>' +
    field('Collection day, time and place', '<textarea id="x_col" placeholder="e.g. Tuesday 23 December, 10am – 4pm at the Dukes shop, Gortin">' + esc(s.collection) + '</textarea>') +
    field('A short note at the top of the page (optional)', '<textarea id="x_intro">' + esc(s.intro) + '</textarea>') +
    '<p class="small muted" style="margin-top:14px"><b>Max tubs:</b> the most tubs of a flavour that can be sold. Leave it blank for no limit. When it runs out the flavour shows as sold out on the order page.</p>' +
    '<h3>🎄 Our Festive Flavours – <i style="color:#b3262e">Limited stock remaining</i></h3><p class="small muted">Your festive flavours – shown in their own section at the top of the page, at their own price. Leave a flavour\'s price empty to use the festive price.</p>' +
    field('Festive price per big tub (£)', inp('x_dprice', s.dukesmasPrice, 'number', ' placeholder="' + esc(s.price || '') + '"')) + '<div id="x_ffl">' +
    (r.flavours || []).filter(function (f) { return f.festive; }).concat([{ name: '', on: true, festive: true }]).map(function (f) { return xmasFlRow(f, sold); }).join('') +
    '</div><button class="btn soft sm" type="button" id="x_addffl">+ Another festive flavour</button>' +
    '<h3>Flavours on the page</h3><p class="small muted">Untick to hide one. Type a new flavour in the empty box to add it.</p><div id="x_fl">' +
    (r.flavours || []).filter(function (f) { return !f.festive; }).concat([{ name: '', on: true }]).map(function (f) { return xmasFlRow(f, sold); }).join('') +
    '</div><button class="btn soft sm" type="button" id="x_addfl">+ Another flavour</button>' +
    '<h3>Card payments</h3>' + (r.card ? '<p><span class="pill ok">Stripe connected</span> Payments are checked automatically and customers get a confirmation email.</p>' :
      '<p class="small">Not connected yet. Make a free Stripe account, then in Stripe go to <b>Developers → API keys</b>, copy the <b>Secret key</b> (starts sk_live_) and paste it here yourself. Orders only appear here once they\'re paid.</p>') +
    field(r.card ? 'Replace the Stripe key' : 'Stripe secret key', '<input id="x_key" type="password" autocomplete="off" placeholder="sk_live_…">') +
    '<div class="bar"><button class="btn" id="x_save">Save</button></div></div>' +
    '<div class="card noprint"><h2>Message all customers</h2><div class="grid2">' + field('Send to', '<select id="x_who"><option value="paid">Everyone who has ordered</option><option value="notcollected">Not collected yet</option></select>') + field('Subject', inp('x_sub', 'Your Dukes Christmas order')) + '</div>' +
    field('Message', '<textarea id="x_body" style="min-height:120px">Hi {name},\n\n</textarea>') + '<p class="small muted">{name} becomes their first name and {order} their order number. Replies come to you. Google allows about ' + esc(r.quota) + ' more emails today.</p>' +
    '<button class="btn" id="x_send" type="button">Send email</button> <button class="btn soft" id="x_phones" type="button">Copy phone numbers (for texts)</button></div>';
  var vs = r.visits;
  render(back() + '<h1>🎄 Christmas orders</h1>' +
    // order and tub totals are for Jonny only – staff see the per-flavour counts
    '<style>@media print{body.xp-left .xcol,body.xp-left #x_counts{display:none!important}}@media screen{.noscreen{display:none!important}}</style>' +
    '<div class="card" id="x_counts">' + (mine ? '<div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile"><b style="font-size:24px">' + paid.length + '</b><span>orders</span></div><div class="tile"><b style="font-size:24px">' + tubs + '</b><span>big tubs</span></div><div class="tile"><b style="font-size:24px">' + gbp(money) + '</b><span>taken</span></div></div>' : '') +
    (r.collection || s.collection ? '<p class="small"><b>Collection:</b> ' + esc(r.collection || s.collection) + '</p>' : '') +
    xmasTubTable(byF) + '</div>' +
    (mine && vs ? '<div class="card noprint"><h2>Order page visitors</h2><div class="tiles" style="grid-template-columns:repeat(3,1fr)"><div class="tile"><b style="font-size:24px">' + vs.visitors + '</b><span>people visited</span></div><div class="tile"><b style="font-size:24px">' + vs.ordered + '</b><span>of them ordered</span></div><div class="tile"><b style="font-size:24px">' + (vs.visitors ? Math.round(vs.ordered / vs.visitors * 100) : 0) + '%</b><span>ordered</span></div></div>' +
      '<p class="small muted">Each phone or computer is counted once, however many times they come back, and once more only if they go on to order and pay. Counting started ' + (vs.since ? esc(nice(vs.since)) : 'today') + ', so orders placed before then aren\'t linked to a visit.</p></div>' : '') +
    '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">Orders <span class="small muted" style="font-weight:normal">(' + o.length + ')</span></h2><span class="noprint" style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" type="button" id="x_fold"></button><button class="btn soft sm" type="button" id="x_pall">🖨️ Print all</button><button class="btn soft sm" type="button" id="x_pleft">🖨️ Print not collected</button><button class="btn soft sm" type="button" id="x_dl">⬇️ Download</button></span></div>' +
    '<div id="x_olist"><p class="small muted noprint" style="margin:6px 0 0">Collected orders move to the bottom of the list.</p>' +
    '<div class="noprint" style="margin-top:8px">' + inp('x_find', '', 'search', ' placeholder="Search name, phone or order no"') + '</div><div id="x_tab">' + (o.filter(function (x) { return !x.collected; }).concat(o.filter(function (x) { return x.collected; })).map(row).join('') || '<p class="muted">No paid orders yet.</p>') + '</div></div>' +
    (mine ? '<button class="btn soft sm noprint" id="x_ref" type="button">Check payments now</button>' + (r.backup ? ' <a class="btn soft sm noprint" target="_blank" href="' + esc(r.backup) + '">Orders backup ↗</a>' : '') : '') + '</div>' + setup);
  // fold the order list away so the rest of the page is easy to reach (remembered on this device; printing always shows them)
  var fold = function (hide) {
    $('#x_olist').classList.toggle('noscreen', hide); $('#x_fold').textContent = hide ? '▼ Show orders' : '▲ Hide orders';
    try { localStorage.setItem('dukes_xmas_fold', hide ? '1' : ''); } catch (e) { }
  };
  var folded = false; try { folded = localStorage.getItem('dukes_xmas_fold') === '1'; } catch (e) { }
  fold(folded);
  $('#x_fold').onclick = function () { fold(!$('#x_olist').classList.contains('noscreen')); };
  $('#x_find').oninput = function () { var q = this.value.toLowerCase(); $$('#x_tab .xo').forEach(function (d) { d.style.display = d.dataset.q.indexOf(q) >= 0 || d.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none'; }); };
  // tick box → "✓ Collected" once ticked (tap that to undo)
  var setCol = function (id, on) {
    var box = document.querySelector('[data-colbox="' + id + '"]'), ord = o.find(function (x) { return x.id === id; });
    var was = ord.collected; ord.collected = on; box.innerHTML = xmasColHtml(ord); wireCol(); place(id, on);
    (mine ? ownerCall({ op: 'xmasCollect', id: id, collected: on }) : fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ a: 'xmas', k: S.key, op: 'collect', id: id, collected: on }) }).then(function (x) { return x.json(); }))
      .then(function (x) { if (!x.ok) throw new Error(x.error || 'Not saved'); S.oc = null; toast(on ? 'Marked as collected' : 'Marked as not collected'); })
      .catch(function (e) { ord.collected = was; box.innerHTML = xmasColHtml(ord); wireCol(); place(id, was); toast((e && e.message) || 'No connection – not saved'); });
  };
  // collected orders sit at the bottom; one un-ticked goes back to the end of the not-collected ones
  var place = function (id, on) {
    var el = document.querySelector('.xo[data-oid="' + id + '"]'), list = $('#x_tab'); if (!el) return;
    el.classList.toggle('xcol', on);
    if (on) list.appendChild(el); else list.insertBefore(el, list.querySelector('.xo.xcol:not([data-oid="' + id + '"])'));
  };
  var printIt = function (left) {
    document.body.classList.toggle('xp-left', left);
    var done = function () { document.body.classList.remove('xp-left'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done); window.print(); setTimeout(done, 60000);
  };
  $('#x_pall').onclick = function () { printIt(false); };
  $('#x_pleft').onclick = function () { if (!o.some(function (x) { return !x.collected; })) { toast('Every order is collected'); return; } printIt(true); };
  // spreadsheet of every order – one column per flavour, opens in Excel or Google Sheets
  $('#x_dl').onclick = function () {
    var fl = Object.keys(byF), q = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var head = ['Order no', 'Ordered', 'Name', 'Phone'].concat(mine ? ['Email'] : []).concat(fl).concat(['Tubs']).concat(mine ? ['Paid £'] : []).concat(['Notes', 'Collected']);
    var lines = [head].concat(o.map(function (x) {
      var n = {}; String(x.items).split('\n').forEach(function (l) { var m = l.match(/^(\d+)\s*×\s*(.+)$/); if (m) n[m[2]] = (n[m[2]] || 0) + Number(m[1]); });
      return [x.no, x.date, x.name, x.phone].concat(mine ? [x.email] : []).concat(fl.map(function (f) { return n[f] || ''; })).concat([x.tubs]).concat(mine ? [x.total !== undefined ? Number(x.total).toFixed(2) : ''] : []).concat([x.notes, x.collected ? 'Yes' : '']);
    })).map(function (r) { return r.map(q).join(','); }).join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines], { type: 'text/csv;charset=utf-8' }));
    a.download = 'Dukes Christmas orders ' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  var wireCol = function () {
    $$('[data-col]').forEach(function (c) { c.onchange = function () { if (c.checked) setCol(c.dataset.col, true); }; });
    $$('[data-uncol]').forEach(function (b) { b.onclick = function () { if (confirm('Mark this order as NOT collected?')) setCol(b.dataset.uncol, false); }; });
  };
  wireCol();
  if (!mine) return;
  $('#x_ref').onclick = function () { this.disabled = true; ownerCall({ op: 'xmasRefresh' }).then(function (x) { if (x.ok) drawXmas(x, true); }); };
  $('#x_copy').onclick = function () { navigator.clipboard && navigator.clipboard.writeText(r.page).then(function () { toast('Link copied'); }); };
  $('#x_addfl').onclick = function () { $('#x_fl').insertAdjacentHTML('beforeend', xmasFlRow({ name: '', on: true })); };
  $('#x_addffl').onclick = function () { $('#x_ffl').insertAdjacentHTML('beforeend', xmasFlRow({ name: '', on: true, festive: true })); };
  $('#x_save').onclick = function () {
    var rd = function (sel, festive) { return $$(sel + ' > div').map(function (d) { var pe = d.querySelector('[data-fprice]'); var le = d.querySelector('[data-flimit]'), lv = le ? String(le.value).trim() : ''; return { name: d.querySelector('[data-fname]').value.trim(), on: d.querySelector('[data-fon]').checked, festive: festive, price: pe ? num(pe.value) : '', limit: lv === '' ? '' : Math.max(0, Math.floor(Number(lv) || 0)) }; }).filter(function (f) { return f.name; }); };
    var fl = rd('#x_ffl', true).concat(rd('#x_fl', false));
    var d = { open: $('#x_open').checked, price: num(val('x_price')), dukesmasPrice: num(val('x_dprice')), deadline: val('x_dl'), cdate: val('x_cdate'), min: num(val('x_min')), collection: $('#x_col').value.trim(), intro: $('#x_intro').value.trim(), flavours: fl };
    if (val('x_key')) d.stripeKey = val('x_key');
    if (d.open && !d.collection) return toast('Add the collection day and time before opening orders');
    this.disabled = true;
    ownerCall({ op: 'xmasSave', d: d }).then(function (x) { if (!x.ok) { toast(x.error || 'Not saved'); $('#x_save').disabled = false; return; } toast('Saved'); drawXmas(x, true); }).catch(function () { toast('No connection'); $('#x_save').disabled = false; });
  };
  $('#x_send').onclick = function () {
    var who = $('#x_who').selectedOptions[0].textContent;
    if (!confirm('Send this email to ' + who.toLowerCase() + '?')) return;
    this.disabled = true;
    ownerCall({ op: 'xmasEmail', d: { who: val('x_who'), subject: val('x_sub'), body: $('#x_body').value } }).then(function (x) { toast(x.ok ? 'Sent to ' + x.sent + ' customer' + (x.sent === 1 ? '' : 's') : (x.error || 'Not sent')); $('#x_send').disabled = false; }).catch(function () { toast('No connection'); $('#x_send').disabled = false; });
  };
  $('#x_phones').onclick = function () {
    var w = val('x_who'), list = o.filter(function (x) { return w !== 'notcollected' || !x.collected; }).map(function (x) { return x.phone; }).filter(Boolean);
    navigator.clipboard && navigator.clipboard.writeText(Array.from(new Set(list)).join(', ')).then(function () { toast(list.length + ' numbers copied'); });
  };
}
ROUTES.finance = function () { ownLoad('Costs & prices', 'finance', drawFinance); };
function drawFinance(r) {
  var f = r.flavours || [], m = function (n) { return gbp(n, n != null && n < 1 ? 3 : 2); };
  var margin = function (cost, price) { if (!price || !cost) return ''; var x = Math.round((price - cost) / price * 100); return '<br><span class="small" style="color:' + (x >= 30 ? '#1b7a4a' : '#b3261e') + '">' + x + '% margin at ' + gbp(price) + '</span>'; };
  var costRows = f.map(function (x) { return '<tr><td><b>' + esc(x.flavour) + '</b></td><td>' + m(x.small) + margin(x.small, r.shopSmall) + '</td><td>' + m(x.large) + margin(x.large, r.shopLarge) + '</td><td>' + m(x.napoli) + '</td><td class="small muted">' + gbp(x.ingL, 3) + '/L</td><td class="small muted">' + (x.overrun != null ? x.overrun + '%' + (x.overrunOwn ? '' : ' (avg)') : '') + '</td></tr>'; }).join('');
  var s0 = f[0] && f[0].parts;
  var ingP = (r.prices || []).map(function (p) {
    var perPack = p.packSize && p.price !== '' ? Math.round(p.price * (function () { var a = String(p.packUnit).toLowerCase(), b = String(p.unit).toLowerCase(); return a === b ? p.packSize : a === 'g' && b === 'kg' ? p.packSize / 1000 : a === 'kg' && b === 'g' ? p.packSize * 1000 : a === 'ml' && b === 'l' ? p.packSize / 1000 : a === 'l' && b === 'ml' ? p.packSize * 1000 : p.packSize; })() * 100) / 100 : '';
    return '<tr data-ing="' + esc(p.name) + '"' + (r.missing.indexOf(p.name) >= 0 ? ' style="background:#fff4d6"' : '') + '><td>' + esc(p.name) + '</td>' +
      (p.packSize ? '<td>£ <input data-k="pack" inputmode="decimal" style="width:80px" value="' + esc(perPack) + '"> per ' + p.packSize + ' ' + esc(p.packUnit) + '</td>' : '<td>£ <input data-k="unit" inputmode="decimal" style="width:80px" value="' + esc(p.price) + '"> per ' + esc(p.unit || 'unit') + '</td>') +
      '<td class="small muted">' + (p.price !== '' ? gbp(p.price, 3) + ' per ' + esc(p.unit) : 'no price') + '</td></tr>';
  }).join('');
  var packP = (r.packPrices || []).map(function (p) { return '<tr data-pk="' + esc(p.item) + '"><td>' + esc(p.item) + '</td><td>£ <input data-k="price" inputmode="decimal" style="width:80px" value="' + esc(p.price) + '"> per ' + (/roll/i.test(p.unit) ? 'roll' + (p.perRoll ? ' of ' + p.perRoll : '') : 'one') + '</td></tr>'; }).join('');
  render(back('office', 'Office') + '<h1>💷 Costs & prices</h1><p class="muted">Only you see this. Enter prices <b>excluding VAT</b>. The cost of each tub is worked out from the recipes, your prices, overrun, packaging, wages on production days and your other monthly costs.</p>' +
    (r.missing.length ? '<div class="due" style="background:#fff4d6;border-color:#e3c46b;color:#5a4300"><span>⚠️</span><span><b>No price yet for:</b> ' + r.missing.map(esc).join(', ') + '. The costs below leave these out until they\'re filled in (shaded below). Send me photos of the invoices in the Claude chat and I\'ll fill them in for you.</span></div>' : '') +
    ((r.warnings || []).length ? '<div class="due" style="background:#fff4d6;border-color:#e3c46b;color:#5a4300"><span>⚠️</span><span><b>To keep the costs accurate:</b><br>' + r.warnings.map(esc).join('<br>') + '</span></div>' : '') +
    '<div class="card"><h2>Cost to make</h2><div class="scroll"><table class="t"><tr><th>Flavour</th><th>Small tub</th><th>Big tub</th><th>Napoli</th><th>Ingredients</th><th>Overrun</th></tr>' + (costRows || '<tr><td colspan="6" class="muted">No recipes yet.</td></tr>') + '</table></div>' +
    (s0 ? '<p class="small">A small tub of ' + esc(f[0].flavour) + ' = ingredients ' + m(s0.smallIng) + ' + wages ' + m(s0.smallLab) + ' + other costs ' + m(s0.smallOther) + ' + tub & lid ' + m(s0.smallPack) + '.</p>' : '') +
    '<div class="hint small"><b>Based on:</b> overrun – each flavour\'s own where its tub counts measure it, otherwise ' + r.overrun + '%' + (r.overrunMeasured ? ' (the average from your tub counts)' : ' (assumed – change "Assumed overrun %" on the Settings tab until the tub counts show the real figure)') +
    ' · wages ' + gbp(r.wages, 0) + ' on ' + r.prodDays + ' production days over the last 12 weeks for ' + (r.litres || 0) + ' L of mix = ' + gbp(r.labourL, 3) + ' per litre' + (r.noRate.length ? ' <b>(no pay rate for ' + r.noRate.map(esc).join(', ') + ')</b>' : '') +
    ' · other costs ' + gbp(r.otherMonth, 0) + ' a month = ' + gbp(r.otherL, 3) + ' per litre (edit these on the <b>Other costs</b> tab of the Sheet).</div></div>' +
    '<div class="card"><h2>Ingredient prices</h2><p class="small muted">Type the price you pay for one pack – it\'s turned into a price per kg or litre.</p><div class="scroll"><table class="t">' + ingP + '</table></div></div>' +
    '<div class="card"><h2>Packaging prices</h2><div class="scroll"><table class="t">' + packP + '</table></div></div>' +
    '<div class="bar"><button class="btn soft" id="fi_scan" type="button">📷 Scan an invoice</button><button class="btn" id="fi_save">Save prices</button></div><div id="fi_read"></div>');
  $('#fi_scan').onclick = function () {
    scanPhoto(function (x) {
      if (!x || !x.ok) return toast((x && x.error) || 'Could not read the invoice');
      var m = invoiceMatches(x.text);
      m.forEach(function (o) { var e = o.tr.querySelector('input'); if (e) { e.value = o.price; e.style.background = '#fff4c2'; } });
      $('#fi_read').innerHTML = '<div class="card"><h2>From the invoice</h2>' + (m.length ? '<p class="small">Filled in (shaded yellow) – check each one is the price for <b>one pack</b>, ex VAT, then press Save prices.</p><table class="t">' + m.map(function (o) { return '<tr><td><b>' + esc(o.name) + '</b></td><td>' + gbp(o.price) + '</td><td class="small muted">' + esc(o.line) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">Nothing on the invoice matched an ingredient or packaging item.</p>') +
        '<details class="small"><summary>Everything read from the photo</summary><pre style="white-space:pre-wrap">' + esc(x.text) + '</pre></details></div>';
      $('#fi_read').scrollIntoView({ behavior: 'smooth' });
    });
  };
  $('#fi_save').onclick = function () {
    var ing = $$('tr[data-ing]').map(function (tr) { var a = tr.querySelector('[data-k=pack]'), b = tr.querySelector('[data-k=unit]'); return { name: tr.dataset.ing, perPack: a ? num(a.value) : '', perUnit: b ? num(b.value) : '' }; }).filter(function (x) { return x.perPack !== '' || x.perUnit !== ''; });
    var pack = $$('tr[data-pk]').map(function (tr) { return { item: tr.dataset.pk, price: num(tr.querySelector('[data-k=price]').value) }; }).filter(function (x) { return x.price !== ''; });
    var pl = {}; (r.prices || []).forEach(function (p) { pl[p.name] = p; });
    if (!packOk(ing.map(function (x) { var p = pl[x.name] || {}, a = String(p.packUnit || p.unit).toLowerCase(), b = String(p.unit).toLowerCase(), sz = !p.packSize ? 1 : a === b ? p.packSize : a === 'g' && b === 'kg' ? p.packSize / 1000 : a === 'kg' && b === 'g' ? p.packSize * 1000 : a === 'ml' && b === 'l' ? p.packSize / 1000 : a === 'l' && b === 'ml' ? p.packSize * 1000 : p.packSize;
      return { name: x.name, unit: p.unit, packSize: p.packSize, packUnit: p.packUnit, price: x.perUnit !== '' ? x.perUnit : x.perPack / sz }; }))) return;
    $('#fi_save').disabled = true;
    ownerCall({ op: 'prices', d: { ing: ing, pack: pack } }).then(function (x) { if (x.ok) { toast('Prices saved'); drawFinance(x); } else { toast(x.error || 'Could not save'); $('#fi_save').disabled = false; } }).catch(function () { toast('No connection'); $('#fi_save').disabled = false; });
  };
}

/* ---------- packaging stock ---------- */
ROUTES.packaging = function () {
  var items = D().packItems || [], last = D().packStock || {}, mine = isOwner();
  var est = (mine && S.own && S.own.pack) || D().pack || {};
  var hasCounts = Object.keys(last).length > 0, showFull = !hasCounts || !!S.pFull;
  if (mine && !S.own && navigator.onLine) loadOwn().then(function (o) { if (o && (location.hash || '') === '#packaging' && !$('#app').hasAttribute('data-dirty')) route(); });
  var groups = {}; items.forEach(function (i) { (groups[i.group] = groups[i.group] || []).push(i); });
  var order = ['Small tub lids', 'Small tubs', 'Big tubs', 'Big tub lids', 'Big tub lid labels'];
  var names = Object.keys(groups).sort(function (a, b) { var x = order.indexOf(a), y = order.indexOf(b); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || (a < b ? -1 : 1); });
  var isRoll = function (g) { return groups[g].some(function (i) { return i.perRoll; }) || /label/i.test(g); };
  var word = function (g) { var u = (groups[g][0] || {}).unit || 'units'; return /lid/i.test(g) ? 'lids' : /tub/i.test(g) ? 'tubs' : u; };
  var short_ = function (s) { return s.replace(/^(Small tub lid|Big tub lid label|Big tub) – /, ''); };
  // after the first count: what's left now (last count less what's been tubbed since), with an Edit button
  var leftTxt = function (i, g) {
    var e = est[i.item], l = last[i.item], w = isRoll(g) ? 'labels' : word(g);
    if (!e && !l) return '<span class="muted">not counted yet</span>';
    var q = e ? e.est : Number(l.qty) || 0, pb = i.perBox || (groups[g].find(function (x) { return x.perBox; }) || {}).perBox;
    return '<b>' + Number(q).toLocaleString('en-GB') + ' ' + esc(w) + '</b>' + (!isRoll(g) && pb ? ' <span class="small muted">(≈ ' + r2(q / pb, 1) + ' boxes)</span>' : '') +
      '<br><span class="small muted">counted ' + esc(short((e && e.counted) || l.date)) + (e && e.used ? ' · ' + e.used + ' used since' : '') + '</span>';
  };
  var curHtml = !hasCounts ? '' : '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2 style="margin:0">In stock now</h2><button class="btn soft sm" type="button" id="g_full">' + (showFull ? 'Hide the full count' : 'Do a full count') + '</button></div>' +
    '<p class="muted small">Worked out from the last count, less the tubs, lids and labels used on the batches tubbed since. If something\'s wrong, tap <b>Edit</b> and put in what\'s really there.</p>' +
    names.map(function (g) {
      return '<h3>' + esc(g) + '</h3><table class="t">' + groups[g].map(function (i) {
        return '<tr data-pc="' + esc(i.item) + '"><td>' + esc(short_(i.item)) + '</td><td data-left>' + leftTxt(i, g) + '</td><td style="width:70px"><button class="btn soft sm" type="button" data-pedit="' + esc(i.item) + '">Edit</button></td></tr>';
      }).join('') + '</table>';
    }).join('') + '</div>';
  render(back() + '<h1>Packaging stock</h1>' + curHtml + '<div id="g_fullbox"' + (showFull ? '' : ' style="display:none"') + '><p class="muted">Count the <b>boxes</b> of each. Check the number in a box beside each heading – change it if a box holds a different amount. Labels: count the rolls (a part roll can be a half, e.g. 2.5). Leave a box empty if you didn\'t count it. Anything not on the list – add it at the bottom.</p>' +
    '<div class="card"><div class="grid2">' + field('Date', inp('g_date', today(), 'date')) + field('Counted by', staffSel('g_by')) + '</div></div>' +
    (names.length ? '' : '<div class="card muted">The packaging list is still being set up – add items at the bottom.</div>') +
    names.map(function (g, gi) {
      var roll = isRoll(g), w = word(g), pb = (groups[g].find(function (i) { return i.perBox; }) || {}).perBox || '';
      var head = roll ? '<h2>' + esc(g) + '</h2>' :
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px"><h2 style="margin:0">' + esc(g) + '</h2><label class="small" style="display:flex;align-items:center;gap:6px;margin:0">' + esc(w) + ' in a box <input data-pb="' + gi + '" inputmode="numeric" value="' + esc(pb) + '" style="width:90px"></label></div>';
      return '<div class="card" data-grp="' + gi + '">' + head + '<table class="t">' +
        (roll ? '<tr><th></th><th>Rolls</th><th>Labels per roll</th><th>Labels</th><th></th></tr>' : '<tr><th></th><th>Boxes</th><th>' + esc(w.charAt(0).toUpperCase() + w.slice(1)) + '</th><th></th></tr>') +
        groups[g].map(function (i) {
          var l = last[i.item], e = est[i.item], lastTxt = mine && l ? 'last ' + (roll ? l.rolls + ' rolls' : (l.boxes !== '' && l.boxes != null ? l.boxes + ' boxes' : l.qty)) + ' (' + short(l.date) + ')' + (e ? ' · ≈ ' + e.est + ' ' + (roll ? 'labels' : w) + ' now' + (e.used ? ' (' + e.used + ' used since)' : '') : '') : '';
          return roll
            ? '<tr data-p="' + esc(i.item) + '" data-g="' + esc(g) + '" data-roll="1"><td>' + esc(short_(i.item)) + '</td><td style="width:110px"><input data-k="rolls" inputmode="decimal"></td><td style="width:110px"><input data-k="per" inputmode="numeric" value="' + esc(i.perRoll || '') + '"></td><td class="stat" data-t="tot">–</td><td class="muted small">' + esc(lastTxt) + '</td></tr>'
            : '<tr data-p="' + esc(i.item) + '" data-g="' + esc(g) + '" data-gi="' + gi + '" data-unit="' + esc(i.unit) + '"><td>' + esc(short_(i.item)) + '</td><td style="width:120px"><input data-k="boxes" inputmode="decimal"></td><td class="stat" data-t="tot">–</td><td class="muted small">' + esc(lastTxt) + '</td></tr>';
        }).join('') +
        '<tr style="border-top:2px solid #1c2140"><td><b>Total</b></td><td><b data-sum="a">–</b></td><td' + (roll ? ' colspan="2"' : '') + '><b data-sum="b">–</b></td><td></td></tr></table></div>';
    }).join('') + '</div>' +
    '<div class="card"><h2>Something not on the list?</h2><p class="muted small">It\'s added to the list for next time.</p><table class="t" id="g_new"></table><button class="btn soft sm" id="g_addrow" type="button">+ Add another</button></div>' +
    '<div class="bar"><button class="btn" id="g_save">Save</button></div>');
  if ($('#g_full')) $('#g_full').onclick = function () { S.pFull = !S.pFull; var on = $('#g_fullbox').style.display === 'none'; $('#g_fullbox').style.display = on ? '' : 'none'; this.textContent = on ? 'Hide the full count' : 'Do a full count'; };
  $$('[data-pedit]').forEach(function (b) { b.onclick = function () {
    var n = b.dataset.pedit, i = items.find(function (x) { return x.item === n; }) || {}, g = i.group, roll = isRoll(g), w = roll ? 'labels' : word(g);
    var pb = i.perBox || (groups[g].find(function (x) { return x.perBox; }) || {}).perBox || '', pr = i.perRoll || '';
    var e = est[n], cur = e ? e.est : (last[n] ? Number(last[n].qty) || 0 : '');
    var td = b.closest('tr').querySelector('[data-left]');
    var opts = roll ? (pr ? ['rolls', 'labels'] : ['labels']) : (pb ? ['boxes', w] : [w]);
    td.innerHTML = '<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input type="number" inputmode="decimal" style="width:100px" value="' + esc(cur) + '"><select>' + opts.map(function (o) { return '<option' + (o === w || o === 'labels' ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>' +
      (roll && pr ? '<span class="small muted">' + pr + ' per roll</span>' : !roll && pb ? '<span class="small muted">' + pb + ' in a box</span>' : '') + '<button class="btn sm" type="button">Save</button></span>';
    b.style.display = 'none';
    var inpt = td.querySelector('input'), sel = td.querySelector('select'); inpt.focus(); inpt.select();
    td.querySelector('button').onclick = function () {
      var v = num(inpt.value); if (v === '') return toast('Put in how many are there');
      var u = sel.value, c = { item: n, group: g, unit: roll ? 'labels' : i.unit };
      if (u === 'boxes') { c.boxes = v; c.perBox = pb; c.qty = Math.round(v * pb); }
      else if (u === 'rolls') { c.rolls = v; c.perRoll = pr; c.qty = Math.round(v * pr); }
      else c.qty = Math.round(v);
      record('packStock', { id: uid(), date: today(), by: S.user, counts: [c] }, short_(n) + ' updated to ' + c.qty + ' ' + w);
      D().pack = D().pack || {}; est[n] = D().pack[n] = { counted: today(), qty: c.qty, used: 0, est: c.qty };
      if (S.own && S.own.pack) S.own.pack[n] = est[n];
      save(LS.data, S.data);
      td.innerHTML = leftTxt(i, g); b.style.display = '';
    };
  }; });
  function addRow() { var tr = document.createElement('tr'); tr.className = 'newpack'; tr.innerHTML = '<td><input placeholder="Item, e.g. Napoli lids" data-k="name"></td><td style="width:110px"><input placeholder="Boxes" inputmode="decimal" data-k="boxes"></td><td style="width:110px"><input placeholder="In a box" inputmode="numeric" data-k="pb"></td><td><input placeholder="Group, e.g. Boxes" data-k="group" list="dl_pg"></td>'; $('#g_new').appendChild(tr); }
  $('#g_new').insertAdjacentHTML('afterend', '<datalist id="dl_pg">' + names.concat(['Other']).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>');
  addRow(); $('#g_addrow').onclick = addRow;
  var numv = function (el) { return el && el.value !== '' && !isNaN(Number(el.value)) ? Number(el.value) : null; };
  function totals() {
    $$('[data-grp]').forEach(function (card) {
      var gi = card.dataset.grp, pbEl = card.querySelector('[data-pb]'), pb = numv(pbEl), a = 0, b = 0, any = false;
      $$('tr[data-p]', card).forEach(function (tr) {
        var t = tr.querySelector('[data-t=tot]');
        if (tr.dataset.roll) { var r = numv(tr.querySelector('[data-k=rolls]')), p = numv(tr.querySelector('[data-k=per]')); t.textContent = r != null && p ? Math.round(r * p) : '–'; if (r != null) { any = true; a += r; b += p ? Math.round(r * p) : 0; } }
        else { var bx = numv(tr.querySelector('[data-k=boxes]')); t.textContent = bx != null && pb ? Math.round(bx * pb) : '–'; if (bx != null) { any = true; a += bx; b += pb ? Math.round(bx * pb) : 0; } }
      });
      var roll = !!card.querySelector('tr[data-roll]');
      card.querySelector('[data-sum=a]').textContent = any ? r2(a, 1) + (roll ? ' rolls' : ' boxes') : '–';
      card.querySelector('[data-sum=b]').textContent = any && (roll || pb) ? b + (roll ? ' labels' : '') : '–';
    });
  }
  $$('#app input').forEach(function (e) { if (!e.closest('#g_new')) e.addEventListener('input', totals); });
  totals();
  $('#g_save').onclick = function () {
    if (!val('g_by')) $('#g_by').value = S.user;
    var counts = [];
    $$('[data-grp]').forEach(function (card) {
      var pb = numv(card.querySelector('[data-pb]'));
      $$('tr[data-p]', card).forEach(function (tr) {
        if (tr.dataset.roll) { var r = num(tr.querySelector('[data-k=rolls]').value), p = num(tr.querySelector('[data-k=per]').value); if (r !== '') counts.push({ item: tr.dataset.p, group: tr.dataset.g, unit: 'labels', rolls: r, perRoll: p, qty: p ? Math.round(r * p) : '' }); }
        else { var bx = num(tr.querySelector('[data-k=boxes]').value); if (bx !== '') counts.push({ item: tr.dataset.p, group: tr.dataset.g, unit: tr.dataset.unit, boxes: bx, perBox: pb || '', qty: pb ? Math.round(bx * pb) : '' }); }
      });
    });
    $$('tr.newpack').forEach(function (tr) { var n = tr.querySelector('[data-k=name]').value.trim(); if (!n) return; var bx = num(tr.querySelector('[data-k=boxes]').value), pb = num(tr.querySelector('[data-k=pb]').value); counts.push({ item: n, group: tr.querySelector('[data-k=group]').value.trim() || 'Other', unit: 'units', boxes: bx === '' ? 0 : bx, perBox: pb, qty: pb && bx !== '' ? Math.round(bx * pb) : '' }); });
    if (!counts.length) return toast('Nothing counted yet');
    if (counts.some(function (c) { return c.boxes !== undefined && c.boxes !== '' && !c.perBox; }) && !confirm('Some groups have no "in a box" number, so only the boxes will be saved. Save anyway?')) return;
    record('packStock', { id: uid(), date: val('g_date'), by: val('g_by'), counts: counts }, 'Packaging count saved');
    location.hash = 'home';
  };
};

/* ---------- staff hours & pay (passcode; never stored on the device) ---------- */
function hoursCall(body) {
  return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ a: 'hours', k: S.key, code: S.hcode, by: S.user }, body)) }).then(function (r) { return r.json(); });
}
function hoursLockTimer() {
  clearTimeout(S.hTimer);
  S.hTimer = setTimeout(function () { S.hcode = null; S.hv = null; if ((location.hash || '').indexOf('#hours') === 0) { location.hash = 'home'; toast('Hours & pay closed after 3 minutes without use'); } }, 3 * 60 * 1000);
  if (!S.hWatch) { S.hWatch = true; ['click', 'keydown', 'input', 'touchstart', 'scroll'].forEach(function (ev) { document.addEventListener(ev, function () { if (S.hcode && (location.hash || '').indexOf('#hours') === 0) hoursLockTimer(); }, true); }); }
}
ROUTES.hours = function (month) {
  if (S.user !== owner() && S.user !== manager()) { render(back() + '<div class="card">Only ' + esc(owner()) + ' and ' + esc(manager()) + ' can open staff hours.</div>'); return; }
  if (!S.hcode || !S.hv) {
    render(back() + '<div class="card center" style="max-width:420px;margin:30px auto"><h1>🔒 Hours & pay</h1><p class="muted">Enter your passcode.</p>' +
      '<input id="h_code" type="password" inputmode="numeric" autocomplete="off" style="text-align:center;font-size:26px;letter-spacing:8px;width:200px"><br>' +
      '<button class="btn" id="h_go" style="margin-top:14px">Open</button><p class="muted small">Needs the internet. It locks again when you leave this screen.</p></div>');
    var go = function () {
      if (!navigator.onLine) return toast('Hours needs the internet');
      S.hcode = val('h_code');
      if (!S.hcode) return toast('Enter the passcode');
      $('#h_go').disabled = true;
      hoursCall({ op: 'get', month: month, by: S.user }).then(function (r) {
        if (!r.ok) { S.hcode = null; $('#h_go').disabled = false; $('#h_code').value = ''; return toast(r.error || 'Wrong passcode'); }
        S.hv = r; hoursLockTimer(); drawHours();
      }).catch(function () { S.hcode = null; $('#h_go').disabled = false; toast('No connection'); });
    };
    $('#h_go').onclick = go; $('#h_code').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    setTimeout(function () { $('#h_code').focus(); }, 50);
    return;
  }
  if (month && month !== S.hv.month) return hoursDo({ op: 'get', month: month });
  drawHours();
};
function hoursDo(body, msg) {
  if (!navigator.onLine) return toast('Hours needs the internet');
  hoursLockTimer();
  return hoursCall(Object.assign({ month: S.hv ? S.hv.month : '' }, body)).then(function (r) {
    if (!r.ok) { toast(r.error || 'Could not save'); if (/passcode/i.test(r.error || '')) { S.hcode = null; route(); } return; }
    S.hv = r; if (msg) toast(msg); drawHours();
  }).catch(function () { toast('No connection – not saved'); });
}
function drawHours() {
  var v = S.hv, pay = v.level === 'pay';
  var mDate = parse(v.month + '-01'), prev = new Date(mDate), next = new Date(mDate);
  prev.setMonth(prev.getMonth() - 1); next.setMonth(next.getMonth() + 1);
  var mk = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  var monthName = mDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  var people = v.people.map(function (p) { return { v: p.name, t: p.name + (p.casual ? ' (casual)' : '') }; }).concat([{ v: '__new', t: '+ New casual worker…' }]);
  var total = v.summary.reduce(function (a, x) { return a + (x.pay || 0); }, 0), totalH = v.summary.reduce(function (a, x) { return a + x.hours; }, 0);
  render(back() + '<h1>' + (pay ? 'Hours & pay' : 'Staff hours') + '</h1>' +
    '<div class="card noprint"><a class="btn soft sm" href="#hours/' + mk(prev) + '">‹ ' + esc(prev.toLocaleDateString('en-GB', { month: 'short' })) + '</a> <b style="margin:0 10px">' + esc(monthName) + '</b> <a class="btn soft sm" href="#hours/' + mk(next) + '">' + esc(next.toLocaleDateString('en-GB', { month: 'short' })) + ' ›</a>' +
    ' <button class="btn alt sm" onclick="window.print()">Print</button> <button class="btn soft sm" id="h_lock">🔒 Lock</button></div>' +
    '<div class="card noprint"><h2>Add hours</h2><div class="grid3">' +
    field('Date', inp('h_date', today(), 'date')) + field('Who', sel('h_name', people, '', 'Choose…')) +
    field('Start', inp('h_start', '', 'time')) + field('Finish', inp('h_fin', '', 'time')) + field('Break (minutes)', inp('h_brk', '', 'number')) +
    field('…or total hours', inp('h_hrs', '', 'number')) + '</div>' + field('Notes', inp('h_notes', '')) + '<div id="h_fl"></div>' +
    '<p class="muted" id="h_calc"></p><button class="btn" id="h_add">Save hours</button> <button class="btn alt" id="h_cancel" style="display:none">Cancel edit</button></div>' +
    (function () { var fl = v.entries.filter(function (e) { return e.flags && e.flags.length; }); return fl.length ? '<div class="due bad"><span>⚠</span><span><b>' + fl.length + ' entr' + (fl.length > 1 ? 'ies' : 'y') + ' to check</b> this month – marked in red below.</span></div>' : ''; })() +
    '<div class="card"><h2>' + esc(monthName) + ' – totals</h2><div class="printonly">Dukes Ultra Premium Ice Cream</div><table class="t"><tr><th>Name</th><th>Hours</th>' + (pay ? '<th>Rate £/hr</th><th>Pay £</th>' : '') + '</tr>' +
    (v.summary.map(function (x) { return '<tr><td>' + esc(x.name) + (x.flagged ? ' <span class="pill bad">⚠ ' + x.flagged + '</span>' : '') + '</td><td><b>' + r2(x.hours) + '</b></td>' + (pay ? '<td><input class="h_rate" data-n="' + esc(x.name) + '" inputmode="decimal" value="' + esc(x.rate) + '" style="width:90px"></td><td><b>' + (x.pay == null ? '<span class="muted">set rate</span>' : '£' + x.pay.toFixed(2)) + '</b></td>' : '') + '</tr>'; }).join('') || '<tr><td colspan="4" class="muted">No hours this month yet.</td></tr>') +
    (v.summary.length ? '<tr><td><b>Total</b></td><td><b>' + r2(totalH) + '</b></td>' + (pay ? '<td></td><td><b>£' + total.toFixed(2) + '</b></td>' : '') + '</tr>' : '') + '</table>' +
    (pay ? '<p class="muted small">Pay is hours × rate, before tax, NI or holiday pay. Change a rate and press Enter – it\'s used for the whole month.</p>' : '') + '</div>' +
    (pay ? '<div class="card noprint"><h2>Pay rates</h2><table class="t">' + v.rates.map(function (x) { return '<tr><td>' + esc(x.name) + (x.casual ? ' <span class="pill">casual</span>' : '') + '</td><td>£ <input class="h_rate" data-n="' + esc(x.name) + '" inputmode="decimal" value="' + esc(x.rate) + '" style="width:90px"> per hour</td></tr>'; }).join('') + '</table></div>' : '') +
    '<div class="card"><h2>Entries</h2><table class="t"><tr><th>Date</th><th>Name</th><th>Times</th><th>Hours</th><th>Notes</th><th class="noprint"></th></tr>' +
    (v.entries.map(function (e) { var f = e.flags || []; return '<tr' + (f.length ? ' style="background:#fdecea"' : '') + '><td>' + esc(short(e.date)) + '</td><td>' + esc(e.name) + (e.casual ? ' <span class="pill">casual</span>' : '') + '</td><td>' + esc(e.start && e.finish ? e.start + '–' + e.finish + (e.brk ? ' (' + e.brk + ' min break)' : '') : '') + '</td><td><b>' + r2(e.hours) + '</b></td><td>' + esc(e.notes || '') +
      (f.length ? '<br><span class="pill bad">⚠ ' + esc(f.join(' · ')) + '</span>' : '') + (e.log ? '<br><span class="muted small">' + esc(e.log).replace(/\n/g, '<br>') + '</span>' : '') + '<br><span class="muted small">Entered ' + esc(e.created || '') + (e.by ? ' by ' + esc(e.by) : '') + '</span></td>' +
      '<td class="noprint"><button class="btn soft sm" data-edit="' + esc(e.id) + '">✎</button> <button class="btn soft sm" data-del="' + esc(e.id) + '">✕</button></td></tr>'; }).join('') || '<tr><td colspan="6" class="muted">Nothing yet.</td></tr>') + '</table></div>' +
    (v.changes && v.changes.length ? '<div class="card"><h2>Changes this month</h2><table class="t"><tr><th>When</th><th>By</th><th></th><th>Before</th><th>After</th></tr>' + v.changes.map(function (c) { return '<tr><td>' + esc(c.when) + '</td><td>' + esc(c.by) + '</td><td>' + esc(c.what) + '</td><td>' + esc(c.before) + '</td><td>' + esc(c.after || '–') + '</td></tr>'; }).join('') + '</table></div>' : ''));
  $('#h_lock').onclick = function () { S.hcode = null; S.hv = null; location.hash = 'home'; };
  var calc = function () { var a = val('h_start'), b = val('h_fin'); if (!a || !b) { $('#h_calc').textContent = ''; return; } var m = function (t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; }; var mins = m(b) - m(a); if (mins < 0) mins += 1440; mins -= Number(val('h_brk')) || 0; $('#h_calc').textContent = '= ' + r2(mins / 60) + ' hours'; };
  ['h_start', 'h_fin', 'h_brk'].forEach(function (id) { $('#' + id).oninput = calc; });
  $('#h_name').onchange = function () {
    var s = $('#h_name'); if (s.value !== '__new') return;
    var n = (prompt('Name of the casual worker') || '').trim();
    if (!n) { s.value = ''; return; }
    var o = document.createElement('option'); o.value = n; o.textContent = n + ' (casual – new)'; o.dataset.casual = '1'; s.insertBefore(o, s.lastChild); s.value = n;
    if (pay) { var r = prompt('Hourly rate for ' + n + ' in £ (leave empty to set later)') || ''; o.dataset.rate = r.trim(); }
  };
  S.hEdit = null;
  $$('[data-edit]').forEach(function (b) { b.onclick = function () {
    var e = v.entries.find(function (x) { return x.id === b.dataset.edit; }); if (!e) return;
    S.hEdit = e.id;
    var s = $('#h_name'); if (!Array.prototype.some.call(s.options, function (o) { return o.value === e.name; })) { var o = document.createElement('option'); o.value = e.name; o.textContent = e.name; s.insertBefore(o, s.lastChild); }
    s.value = e.name; $('#h_date').value = e.date; $('#h_start').value = e.start; $('#h_fin').value = e.finish; $('#h_brk').value = e.brk || ''; $('#h_hrs').value = e.start && e.finish ? '' : e.hours; $('#h_notes').value = e.notes || '';
    $('#h_add').textContent = 'Save changes'; $('#h_cancel').style.display = ''; calc(); window.scrollTo(0, 0); toast('Editing – changes are recorded');
  }; });
  $('#h_cancel').onclick = function () { drawHours(); };
  // which flavour(s) the day's hours go to – the flavour made that day is ticked, they confirm it or pick others
  var drawFl = function () {
    var d = val('h_date'), saved = (v.dayFl || {})[d];
    var made = Array.from(new Set((D().batches || []).filter(function (b) { return b.date === d || b.tub === d; }).map(function (b) { return b.flavour; }).filter(Boolean)));
    var on = saved || made, all = Array.from(new Set((D().flavours || []).concat(on)));
    $('#h_fl').innerHTML = '<div style="background:#fff4d6;border:2px solid #d99a00;border-radius:10px;padding:10px 12px;margin:10px 0">' +
      (saved ? '<b>Hours on ' + esc(nice(d)) + ' go to:</b> ' + esc(saved.join(', ') || 'no flavour') + ' <span class="small muted">(change the ticks if that\'s wrong)</span>'
        : made.length ? '<b>Was ' + esc(made.join(' and ')) + ' made on ' + esc(nice(d)) + '?</b> <span class="small">The hours go to the flavour' + (made.length > 1 ? 's' : '') + ' ticked – tick another flavour if more were made, or change it.</span>'
        : '<b>Was any ice cream made on ' + esc(nice(d)) + '?</b> <span class="small">Tick the flavour(s) so the hours go to them. Leave empty if not.</span>') +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px">' + all.map(function (f) { return '<label style="display:flex;gap:6px;align-items:center;font-size:15px"><input type="checkbox" data-hfl value="' + esc(f) + '"' + (on.indexOf(f) >= 0 ? ' checked' : '') + '> ' + esc(f) + '</label>'; }).join('') + '</div></div>';
  };
  drawFl(); $('#h_date').addEventListener('change', drawFl);
  $('#h_add').onclick = function () {
    var opt = $('#h_name').selectedOptions[0], name = val('h_name');
    if (!name || name === '__new') return toast('Choose who');
    if (!(val('h_start') && val('h_fin')) && !num(val('h_hrs'))) return toast('Enter start and finish times, or the total hours');
    var isCasual = (opt && opt.dataset.casual === '1') || v.people.some(function (p) { return p.name === name && p.casual; });
    hoursDo({ op: 'save', e: { id: S.hEdit || uid(), date: val('h_date'), name: name, start: val('h_start'), finish: val('h_fin'), brk: num(val('h_brk')), hours: num(val('h_hrs')), notes: val('h_notes'), casual: isCasual, rate: opt && opt.dataset.rate || '', by: S.user }, dayFl: { date: val('h_date'), flavours: $$('[data-hfl]').filter(function (c) { return c.checked; }).map(function (c) { return c.value; }) } }, 'Hours saved for ' + name);
  };
  $$('.h_rate').forEach(function (e) { e.onchange = function () { hoursDo({ op: 'rate', name: e.dataset.n, rate: num(e.value) }, 'Rate saved for ' + e.dataset.n); }; });
  $$('[data-del]').forEach(function (b) { b.onclick = function () { if (confirm('Delete this entry?')) hoursDo({ op: 'delete', id: b.dataset.del }, 'Deleted'); }; });
}

boot();
