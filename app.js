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
  var m = location.hash.match(/setup=([\w-]+)/);
  if (m) { localStorage.setItem(LS.key, m[1]); history.replaceState(null, '', location.pathname + '#home'); }
  S.key = localStorage.getItem(LS.key) || '';
  S.user = localStorage.getItem(LS.user) || '';
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
      upsertBy(data.batches, 'no', { no: String(d.no), flavour: d.flavour, date: d.date, mix: d.mix, start: d.start, temp: d.temp, hold: d.hold, cool: d.cool, end: d.end, bb: d.bb, pby: d.pby, tub: d.tub, large: d.large, small: d.small, label: d.label ? 'Yes' : '', tby: d.tby, comments: d.comments, status: d.status || (d.tub ? 'Tubbed' : 'Pasteurised'), lines: d.lines });
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
    case 'ingStock': data.ingStock = (data.ingStock || []).filter(function (x) { return x.id.indexOf(d.id + ':') !== 0; }).concat(d.counts.filter(function (c) { return c.qty !== ''; }).map(function (c) { return { id: d.id + ':' + c.ingredient, date: d.date, ingredient: c.ingredient, qty: c.qty, unit: c.unit, by: d.by }; }));
      d.counts.forEach(function (c) { if (c.ingredient && !data.ingredients.some(function (i) { return i.name.toLowerCase() === c.ingredient.toLowerCase(); })) data.ingredients.push({ name: c.ingredient, unit: c.unit, track: true }); });
      break;
    case 'recipe': data.recipe = (data.recipe || []).filter(function (x) { return x.flavour !== d.flavour; }).concat(d.lines.filter(function (l) { return l.ingredient; }).map(function (l) { return { flavour: d.flavour, ingredient: l.ingredient, amount: Number(l.amount) || 0, unit: l.unit }; })); break;
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
  if (!S.user && parts[0] !== 'who') { location.hash = 'who'; return; }
  var fn = ROUTES[parts[0]] || ROUTES.home;
  if (parts[0] === 'office' && !office()) fn = ROUTES.home;
  try { fn.apply(null, parts.slice(1).map(decodeURIComponent)); }
  catch (e) { render('<div class="card"><h2>Something went wrong</h2><p class="muted">' + esc(e.message) + '</p><a class="btn" href="#home">Home</a></div>'); console.error(e); }
}
function setupScreen() {
  return '<div class="card center" style="max-width:560px;margin:40px auto"><h1>Welcome</h1><p>This tablet or phone isn\'t set up yet.</p>' +
    '<p class="muted">Open the set-up link Jonny sent (it ends in <b>#setup=…</b>) on this device once. After that the app works here, even with no internet.</p></div>';
}

ROUTES.who = function () {
  render('<h1>Who is using the app?</h1><p class="muted">Tap your name. Everything you record is saved with your name.</p><div class="names">' +
    (D().staff || []).map(function (n) { return '<button data-n="' + esc(n) + '"' + (n === S.user ? ' style="border-color:#1c2140"' : '') + '>' + esc(n) + '</button>'; }).join('') + '</div>');
  $$('.names button').forEach(function (b) { b.onclick = function () { S.user = b.dataset.n; localStorage.setItem(LS.user, S.user); paintSync(); location.hash = 'home'; }; });
};

ROUTES.home = function () {
  var due = (D().due || []).filter(function (x) { return !x.hidden; });
  var links = { temps: 'temps', pest: 'pest', stock: 'stock', pack: 'packing' };
  var open = (D().batches || []).filter(function (b) { return b.status === 'Pasteurised'; });
  var tiles = [
    ['production', '🍦', 'Production', open.length ? open.length + ' batch' + (open.length > 1 ? 'es' : '') + ' to tub' : 'Batch records', true],
    ['deliveries', '🚚', 'Deliveries in', 'Goods received'],
    ['temps', '🌡️', 'Temperatures', 'Type up the paper sheet'],
    ['cleaning', '🧽', 'Cleaning', 'Daily · weekly · monthly'],
    ['stock', '📦', 'Ice cream stock', 'Every Saturday'],
    ['ingstock', '🥄', 'Ingredient stock', 'Count dry goods'],
    ['packing', '🧾', 'Shop orders', 'Pack & record batches'],
    ['pest', '🐭', 'Pest control', 'Monthly check'],
    ['messages', '✉️', 'Messages', 'Notes & reminders'],
    ['recipes', '📖', 'Recipes', 'Base mix & flavours'],
    ['records', '🖨️', 'Records', 'View & print'],
    ['hours', '🔒', 'Hours & pay', 'Passcode needed']
  ];
  if (office()) tiles.unshift(['office', '📊', 'Office', 'Stock, orders & cream', true]);
  var unsent = S.queue.length;
  render('<h1>Hello ' + esc(S.user.split(' ')[0]) + '</h1>' +
    (unsent && !navigator.onLine ? '<div class="due"><span>📶</span><span>' + unsent + ' record' + (unsent > 1 ? 's are' : ' is') + ' saved on this device and will send when there\'s internet.</span></div>' : '') +
    due.map(function (x) { return '<a class="due" href="#' + (links[x.key] || 'home') + '"><span>⏰</span><span>' + esc(x.text) + '</span></a>'; }).join('') +
    '<div class="tiles" style="margin-top:14px">' + tiles.map(function (t) {
      return '<a class="tile' + (t[4] ? ' dark' : '') + '" href="#' + t[0] + '"><span class="ic">' + t[1] + '</span><span><b>' + esc(t[2]) + '</b><br><small>' + esc(t[3]) + '</small></span></a>';
    }).join('') + '</div>' +
    '<p class="muted center" style="margin-top:28px">Last updated from Google: ' + (D().at ? new Date(D().at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'never') + '</p>');
};

/* ---------- production: batch records ---------- */
function lotsFor(name) {
  var n = String(name || '').toLowerCase();
  return (D().lots || []).filter(function (l) { return l.status !== 'Finished' && String(l.item || '').toLowerCase() === n; })
    .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
}
function usesBase(f) { var i = (D().flavourInfo || []).find(function (x) { return x.name === f; }); return !i || i.base; }
function recipeLines(flavour, mix) {
  var base = setN('Base mix litres', 58), f = mix ? Number(mix) / base : 0;
  var wb = usesBase(flavour);
  return (D().recipe || []).filter(function (r) { return (wb && r.flavour === 'All flavours (base mix)') || r.flavour === flavour; }).map(function (r) {
    var lot = lotsFor(r.ingredient)[0];
    return { ingredient: r.ingredient, qty: f ? r2(r.amount * f, 3) : '', unit: r.unit, batch: lot ? lot.batch : '', useBy: lot ? lot.useBy : '' };
  });
}
ROUTES.production = function () {
  var bs = (D().batches || []).slice().sort(function (a, b) { return Number(b.no) - Number(a.no); });
  var open = bs.filter(function (b) { return b.status === 'Pasteurised'; });
  render(back() + '<h1>Production</h1>' +
    '<div class="card"><a class="btn" href="#batch/new">+ Start a new batch</a><p class="muted">Next batch number: <b>' + esc(set('Next batch number')) + '</b></p></div>' +
    (open.length ? '<div class="card"><h2>Waiting to be tubbed</h2><div class="list">' + open.map(batchRow).join('') + '</div></div>' : '') +
    '<div class="card"><h2>Recent batches</h2><div class="list">' + (bs.filter(function (b) { return b.status !== 'Pasteurised'; }).slice(0, 25).map(batchRow).join('') || '<p class="muted">None yet.</p>') + '</div></div>');
};
function batchRow(b) {
  var st = b.status === 'Pasteurised' ? '<span class="pill warn">To tub</span>' : b.status === 'Finished' ? '<span class="pill">Sold out</span>' : '<span class="pill ok">' + esc(b.status || 'Tubbed') + '</span>';
  return '<a class="row" href="#batch/' + encodeURIComponent(b.no) + '"><span><b>' + esc(b.no) + '</b> · ' + esc(b.flavour) + '<br><span class="muted">' + esc(nice(b.date)) +
    (b.small || b.large ? ' · ' + (b.small || 0) + ' small, ' + (b.large || 0) + ' large' : '') + '</span></span>' + st + '</a>';
}

ROUTES.batch = function (no) {
  var isNew = no === 'new';
  var b = isNew ? null : (D().batches || []).find(function (x) { return String(x.no) === String(no); });
  if (!isNew && !b) return render(back('production', 'Production') + '<div class="card">Batch not found.</div>');
  var draft = S.drafts['batch:' + no];
  var plan = D().creamPlan, planMix = plan && plan.week && plan.week >= addDays(monday(today()), -7) ? plan.mix : '';
  var x = draft || b || { no: String(set('Next batch number') || ''), flavour: '', date: today(), mix: planMix || setN('Base mix litres', 58), start: '', temp: '', hold: '', cool: '', end: '', bb: '', pby: S.user, tub: '', large: '', small: '', label: '', tby: '', comments: '', lines: null };
  var lines = (x.lines && x.lines.length) ? x.lines.map(function (l) { return Object.assign({}, l); }) : recipeLines(x.flavour, x.mix);
  var dl = {};
  render(back('production', 'Production') + '<h1>' + (isNew ? 'New batch' : 'Batch ' + esc(x.no)) + '</h1>' +
    (draft ? '<div class="hint noprint">Carrying on from where this was left. <a href="#" id="discard">Start again</a></div>' : '') +
    '<div class="card"><h2>Batch</h2><div class="grid2">' +
    field('Flavour', sel('b_flavour', (D().flavours || []).concat(x.flavour && (D().flavours || []).indexOf(x.flavour) < 0 ? [x.flavour] : []).concat([{ v: '__other', t: 'Other – new / limited edition…' }]), x.flavour, 'Choose a flavour…')) +
    field('Batch number', inp('b_no', x.no, 'text', isNew ? '' : ' readonly')) +
    field('Date produced', inp('b_date', x.date, 'date')) +
    field('Mix made (litres)', inp('b_mix', x.mix, 'number')) + '</div>' +
    '<h3>Ingredients</h3><p class="muted small">Amounts are worked out from the recipe for the litres above. Batch numbers are filled in from deliveries (oldest first) – change anything that\'s different.</p>' +
    '<div class="scroll"><table class="t" id="b_lines"></table></div><button class="btn soft sm" id="b_add" type="button">+ Add ingredient</button> <button class="btn soft sm" id="b_recalc" type="button">Recalculate from recipe</button></div>' +
    '<div class="card"><h2>Pasteurisation</h2><div class="grid3">' +
    field('Start time', inp('b_start', x.start, 'time')) +
    field('Temperature reached °C (at least ' + setN('Pasteurisation minimum °C', 65) + ')', inp('b_temp', x.temp, 'number')) +
    field('Held for, minutes (at least ' + setN('Pasteurisation minimum hold (mins)', 30) + ')', inp('b_hold', x.hold, 'number')) +
    field('Cooling time, minutes (' + setN('Cooling maximum (mins)', 60) + ' or less)', inp('b_cool', x.cool, 'number')) +
    field('End temperature °C (' + setN('Cooled end temp maximum °C', 5) + ' or less)', inp('b_end', x.end, 'number')) +
    field('Pasteurised by', staffSel('b_pby', x.pby)) + '</div>' +
    '<div id="b_check"></div>' +
    field('Best before (1 year less a day)', inp('b_bb', x.bb || bestBefore(x.date), 'date')) + '</div>' +
    '<div class="card"><h2>Tubbing</h2><div class="grid3">' +
    field('Date tubbed', inp('b_tub', x.tub, 'date')) +
    field('Large tubs (500ml)', inp('b_large', x.large, 'number')) +
    field('Small tubs (150ml)', inp('b_small', x.small, 'number')) +
    field('Tubbed by', staffSel('b_tby', x.tby || '')) + '</div>' +
    '<label class="tick"><input type="checkbox" id="b_label"' + (x.label === true || x.label === 'Yes' ? ' checked' : '') + '> Labels checked (flavour, batch number, best before, allergens)</label>' +
    '<p class="noprint"><button class="btn soft sm" type="button" id="b_tubnow">Tubbing today</button></p></div>' +
    '<div class="card">' + field('Comments', '<textarea id="b_comments">' + esc(x.comments || '') + '</textarea>') + '</div>' +
    '<div class="bar noprint">' + (isNew ? '' : '<button class="btn alt" type="button" onclick="window.print()">Print</button>') + '<button class="btn" id="b_save" type="button">Save batch</button></div>');

  function drawLines() {
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
      bb: val('b_bb'), pby: val('b_pby'), tub: val('b_tub'), large: num(val('b_large')), small: num(val('b_small')), label: val('b_label'), tby: val('b_tby'), comments: val('b_comments'),
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
  $('#b_add').onclick = function () { lines.push({ ingredient: '', qty: '', unit: '', batch: '', useBy: '', _manual: true }); drawLines(); };
  $('#b_recalc').onclick = function () { recalc(); dirty(); };
  $('#b_tubnow').onclick = function () { $('#b_tub').value = today(); if (!val('b_tby')) $('#b_tby').value = S.user; dirty(); };
  if ($('#discard')) $('#discard').onclick = function (ev) { ev.preventDefault(); dropDraft('batch:' + no); route(); };
  $('#b_save').onclick = function () {
    var g = gather();
    if (!g.flavour) return toast('Choose the flavour');
    if (!g.no) return toast('Enter the batch number');
    if (isNew && (D().batches || []).some(function (z) { return String(z.no) === g.no; }) && !confirm('Batch ' + g.no + ' already exists. Save over it?')) return;
    if ((g.large !== '' || g.small !== '') && !g.tub) g.tub = today();
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
    '<div class="bar"><button class="btn" id="c_save">Confirm cleaning</button></div>');
  $('#c_save').onclick = function () {
    if (!val('c_by')) return toast('Choose who did the cleaning');
    var com = val('c_com');
    var undone = $$('[data-l]').filter(function (e) { return !e.checked; });
    if (undone.length && !com) return toast('Please add a comment for anything not done');
    lists.forEach(function (l) {
      var its = {}; $$('[data-l="' + l + '"]').forEach(function (e) { its[e.dataset.it] = e.checked; });
      record('cleaning', { id: uid(), date: val('c_date'), list: l, by: val('c_by'), comments: com, batch: batch || '', items: its }, 'Cleaning confirmed');
    });
    location.hash = batch ? 'production' : 'home';
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
    '<p class="muted">Copy last week\'s paper sheet in. Tap a box, then type or tap a quick number – it jumps to the next day. Leave a box empty if it wasn\'t checked that day.</p>' +
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
  $$('input[data-u]').forEach(function (e) { e.onfocus = function () { focus = e; }; e.oninput = function () { mark(e); $('#app').setAttribute('data-dirty', '1'); }; mark(e); });
  $$('.chip[data-q]').forEach(function (c) {
    c.onmousedown = function (ev) { ev.preventDefault(); };
    c.onclick = function () {
      var target = focus && focus.dataset.u === c.dataset.u ? focus : $$('input[data-u="' + c.dataset.u + '"]').find(function (e) { return e.value === ''; });
      if (!target) return;
      target.value = c.dataset.q; mark(target); $('#app').setAttribute('data-dirty', '1');
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
    if (bad.length && !confirm(bad.length + ' reading(s) are outside the safe range with no action written. Save anyway?')) return;
    record('temps', { days: out }, 'Temperatures saved');
    $('#app').removeAttribute('data-dirty');
    location.hash = 'home';
  };
};

/* ---------- pest control ---------- */
ROUTES.pest = function () {
  var list = (D().pest || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  render(back() + '<h1>Pest control</h1><div class="card"><h2>Monthly check</h2><div class="grid2">' +
    field('Date', inp('p_date', today(), 'date')) + field('Checked by (name or pest control company)', inp('p_by', S.user)) + '</div>' +
    field('Any signs or issues found?', '<textarea id="p_issues" placeholder="e.g. None – all bait points checked"></textarea>') +
    field('Action taken', '<textarea id="p_action"></textarea>') +
    '<div class="grid2">' + field('Verified by', staffSel('p_ver', '')) + field('Notes / report reference', inp('p_notes', '')) + '</div>' +
    '<button class="btn" id="p_save">Save check</button></div>' +
    '<div class="card"><h2>Previous checks</h2>' + (list.map(function (p) {
      return '<div class="row"><span><b>' + esc(nice(p.date)) + '</b> · ' + esc(p.by) + '<br><span class="muted">' + esc(p.issues || 'No issues noted') + (p.action ? ' – ' + esc(p.action) : '') + '</span></span><span class="muted small">' + esc(p.verified || '') + '</span></div>';
    }).join('') || '<p class="muted">None yet.</p>') + '</div>');
  $('#p_save').onclick = function () {
    if (!val('p_by')) return toast('Who did the check?');
    record('pest', { id: uid(), date: val('p_date'), by: val('p_by'), issues: val('p_issues') || 'None', action: val('p_action'), verified: val('p_ver'), notes: val('p_notes') }, 'Pest control check saved');
    route();
  };
};

/* ---------- deliveries in ---------- */
ROUTES.deliveries = function () {
  var ings = D().ingredients || [];
  var suppliers = Array.from(new Set(ings.map(function (i) { return i.supplier; }).concat((D().lots || []).map(function (l) { return l.supplier; })).filter(Boolean))).sort();
  var keep = S.drafts.delivery || { date: today(), supplier: '' };
  var open = (D().lots || []).filter(function (l) { return l.status !== 'Finished'; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  render(back() + '<h1>Deliveries in</h1><div class="card"><h2>Record a delivery</h2>' +
    '<p class="muted small">One line per item. Milk and cream: take the temperature (5 °C or below).</p><div class="grid3">' +
    field('Date received', inp('d_date', keep.date, 'date')) +
    field('Item', inp('d_item', '', 'text', ' list="dl_ings" autocomplete="off"') + '<datalist id="dl_ings">' + ings.map(function (i) { return '<option value="' + esc(i.name) + '">'; }).join('') + '</datalist>') +
    field('Supplier', inp('d_sup', keep.supplier, 'text', ' list="dl_sups"') + '<datalist id="dl_sups">' + suppliers.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>') +
    field('Quantity', inp('d_qty', '', 'number')) +
    field('Unit', inp('d_unit', '', 'text', ' list="dl_units"') + '<datalist id="dl_units"><option value="L"><option value="kg"><option value="g"><option value="tubs"><option value="units"><option value="boxes"></datalist>') +
    field('Use by / best before', inp('d_use', '', 'date')) +
    field('Batch / lot number', inp('d_batch', '')) +
    field('Temperature °C (chilled items)', inp('d_temp', '', 'number')) +
    field('Checked by', staffSel('d_by')) + '</div>' +
    field('Comment (condition, anything wrong)', inp('d_com', '')) +
    '<button class="btn" id="d_save">Save & add another</button></div>' +
    '<div class="card"><h2>In stock now (open lots)</h2><p class="muted small">Tap <b>Used up</b> when a lot is finished, so it isn\'t suggested on the next batch.</p><div class="scroll"><table class="t"><tr><th>Received</th><th>Item</th><th>Qty</th><th>Batch</th><th>Use by</th><th></th></tr>' +
    (open.map(function (l) {
      return '<tr><td>' + esc(short(l.date)) + '</td><td>' + esc(l.item) + '<br><span class="muted small">' + esc(l.supplier || '') + '</span></td><td>' + esc(l.qty) + ' ' + esc(l.unit || '') + '</td><td>' + esc(l.batch) + '</td><td>' + esc(l.useBy ? short(l.useBy) : '') + '</td><td><button class="btn soft sm" data-fin="' + esc(l.id) + '">Used up</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="muted">Nothing recorded yet.</td></tr>') + '</table></div></div>');
  $('#d_item').onchange = function () {
    var g = ings.find(function (i) { return i.name.toLowerCase() === val('d_item').toLowerCase(); });
    if (g) { if (g.supplier && !val('d_sup')) $('#d_sup').value = g.supplier; if (g.unit && !val('d_unit')) $('#d_unit').value = g.unit; }
  };
  $('#d_save').onclick = function () {
    var item = val('d_item');
    if (!item) return toast('What was delivered?');
    if (!val('d_by')) return toast('Who checked it in?');
    var isNewIng = !ings.some(function (i) { return i.name.toLowerCase() === item.toLowerCase(); });
    if (isNewIng && !confirm('"' + item + '" isn\'t on the ingredient list yet. Add it as a new item?')) return;
    var t = num(val('d_temp'));
    if (/milk|cream/i.test(item) && t === '' && !confirm('No temperature entered for a chilled item. Save anyway?')) return;
    record('delivery', { id: uid(), date: val('d_date'), item: item, supplier: val('d_sup'), qty: num(val('d_qty')), unit: val('d_unit'), useBy: val('d_use'), temp: t, batch: val('d_batch'), comment: val('d_com'), by: val('d_by') },
      item + ' saved' + (t !== '' && /milk|cream/i.test(item) && t > 5 ? ' – temperature is above 5 °C, Jonny will be told' : ''));
    keepDraft('delivery', { date: val('d_date'), supplier: val('d_sup') });
    route(); setTimeout(function () { $('#d_item').focus(); }, 50);
  };
  $$('[data-fin]').forEach(function (b) { b.onclick = function () { record('lotStatus', { id: b.dataset.fin, status: 'Finished' }, 'Marked as used up'); route(); }; });
};

/* ---------- ice cream stock take ---------- */
ROUTES.stock = function () {
  var per = setN('Small tubs per tray', 48);
  var last = {}; (D().iceStock || []).forEach(function (x) { if (!last[x.flavour] || last[x.flavour].date <= x.date) last[x.flavour] = x; });
  render(back() + '<h1>Ice cream stock take</h1>' +
    '<p class="muted">Large tubs: count the stacks and how high they\'re stacked (plus any odd ones). Small tubs: full trays of ' + per + ' plus any loose.</p>' +
    '<div class="card"><div class="grid2">' + field('Date', inp('s_date', today(), 'date')) + field('Counted by', staffSel('s_by')) + '</div></div>' +
    '<div class="card scroll"><table class="t"><tr><th>Flavour</th><th>Large: stacks</th><th>× high</th><th>+ odd</th><th>Large total</th><th>Small: trays</th><th>+ loose</th><th>Small total</th><th class="noprint">Last count</th></tr>' +
    (D().flavours || []).map(function (f, i) {
      var l = last[f];
      return '<tr data-f="' + esc(f) + '"><td><b>' + esc(f) + '</b></td>' +
        '<td><input data-k="stacks" inputmode="numeric" style="width:70px"></td><td><input data-k="height" inputmode="numeric" style="width:70px"></td><td><input data-k="lextra" inputmode="numeric" style="width:70px"></td><td class="stat" data-t="large" style="font-size:20px">–</td>' +
        '<td><input data-k="trays" inputmode="numeric" style="width:70px"></td><td><input data-k="loose" inputmode="numeric" style="width:70px"></td><td class="stat" data-t="small" style="font-size:20px">–</td>' +
        '<td class="muted small noprint">' + (l ? esc(short(l.date)) + ': ' + (l.large || 0) + ' L / ' + (l.small || 0) + ' S' : '–') + '</td></tr>';
    }).join('') + '</table></div>' +
    '<div class="bar"><button class="btn" id="s_save">Save stock take</button></div>');
  function calc(tr) {
    var g = function (k) { return Number(tr.querySelector('[data-k=' + k + ']').value) || 0; };
    var any = $$('input', tr).some(function (e) { return e.value !== ''; });
    var L = g('stacks') * g('height') + g('lextra'), Sm = g('trays') * per + g('loose');
    tr.querySelector('[data-t=large]').textContent = any ? L : '–'; tr.querySelector('[data-t=small]').textContent = any ? Sm : '–';
    return { any: any, flavour: tr.dataset.f, stacks: num(tr.querySelector('[data-k=stacks]').value), height: num(tr.querySelector('[data-k=height]').value), lextra: num(tr.querySelector('[data-k=lextra]').value), large: L, trays: num(tr.querySelector('[data-k=trays]').value), loose: num(tr.querySelector('[data-k=loose]').value), small: Sm };
  }
  $$('tr[data-f] input').forEach(function (e) { e.oninput = function () { calc(e.closest('tr')); $('#app').setAttribute('data-dirty', '1'); }; });
  $('#s_save').onclick = function () {
    if (!val('s_by')) return toast('Who counted?');
    var rows = $$('tr[data-f]').map(calc), counted = rows.filter(function (r) { return r.any; });
    if (!counted.length) return toast('Nothing counted yet');
    var missing = rows.length - counted.length;
    if (missing && !confirm(missing + ' flavour(s) have no count. Save them as zero (none in stock)?')) return;
    rows.forEach(function (r) { delete r.any; });
    record('iceStock', { id: uid(), date: val('s_date'), by: val('s_by'), counts: rows }, 'Stock take saved');
    $('#app').removeAttribute('data-dirty'); location.hash = 'home';
  };
};

/* ---------- ingredient stock count ---------- */
ROUTES.ingstock = function () {
  var ings = (D().ingredients || []).filter(function (i) { return i.track; });
  var last = {}; (D().ingStock || []).forEach(function (x) { if (!last[x.ingredient] || last[x.ingredient].date <= x.date) last[x.ingredient] = x; });
  var cats = {}; ings.forEach(function (i) { (cats[i.category || 'Other'] = cats[i.category || 'Other'] || []).push(i); });
  render(back() + '<h1>Ingredient stock</h1><p class="muted">Count what\'s on the shelves. Leave a box empty if you didn\'t count it. Anything not on the list – add it at the bottom and Jonny will be asked who supplies it.</p>' +
    '<div class="card"><div class="grid2">' + field('Date', inp('i_date', today(), 'date')) + field('Counted by', staffSel('i_by')) + '</div></div>' +
    Object.keys(cats).sort().map(function (c) {
      return '<div class="card"><h2>' + esc(c) + '</h2><table class="t">' + cats[c].map(function (i) {
        var l = last[i.name];
        return '<tr data-ing="' + esc(i.name) + '" data-unit="' + esc(i.unit || '') + '"><td>' + esc(i.name) + '</td><td style="width:140px"><input inputmode="decimal"></td><td style="width:60px">' + esc(i.unit || '') + '</td><td class="muted small">' + (l ? 'last ' + esc(l.qty) + ' (' + esc(short(l.date)) + ')' : '') + '</td></tr>';
      }).join('') + '</table></div>';
    }).join('') +
    '<div class="card"><h2>Something not on the list?</h2><table class="t" id="i_new"></table><button class="btn soft sm" id="i_addrow" type="button">+ Add another</button></div>' +
    '<div class="bar"><button class="btn" id="i_save">Save count</button></div>');
  function addRow() { var tr = document.createElement('tr'); tr.className = 'newing'; tr.innerHTML = '<td><input placeholder="Ingredient name" data-k="name"></td><td style="width:140px"><input placeholder="Quantity" inputmode="decimal" data-k="qty"></td><td style="width:100px"><input placeholder="Unit" data-k="unit" list="dl_units2"></td><td><input placeholder="Who supplies it? (if known)" data-k="sup" list="dl_sups2"></td>'; $('#i_new').appendChild(tr); }
  $('#i_new').insertAdjacentHTML('afterend', '<datalist id="dl_sups2">' + Array.from(new Set((D().ingredients || []).map(function (i) { return i.supplier; }).filter(Boolean))).sort().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('') + '</datalist><datalist id="dl_units2"><option value="kg"><option value="g"><option value="L"><option value="tubs"><option value="units"><option value="boxes"></datalist>');
  addRow(); $('#i_addrow').onclick = addRow;
  $('#i_save').onclick = function () {
    if (!val('i_by')) return toast('Who counted?');
    var counts = $$('tr[data-ing]').map(function (tr) { return { ingredient: tr.dataset.ing, unit: tr.dataset.unit, qty: num(tr.querySelector('input').value) }; }).filter(function (c) { return c.qty !== ''; });
    $$('tr.newing').forEach(function (tr) { var n = tr.querySelector('[data-k=name]').value.trim(); if (n) counts.push({ ingredient: n, supplier: tr.querySelector('[data-k=sup]').value.trim(), unit: tr.querySelector('[data-k=unit]').value.trim(), qty: num(tr.querySelector('[data-k=qty]').value) === '' ? 0 : num(tr.querySelector('[data-k=qty]').value) }); });
    if (!counts.length) return toast('Nothing counted yet');
    record('ingStock', { id: uid(), date: val('i_date'), by: val('i_by'), counts: counts }, 'Ingredient count saved');
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
    return render(back() + '<h1>Shop orders</h1><div class="card"><h2>To pack</h2><div class="list">' + (orders.map(function (o) {
      return '<a class="row" href="#packing/' + encodeURIComponent(o.no) + '"><span><b>' + esc(o.shop) + '</b> · ' + esc(o.no) + '<br><span class="muted">' + esc(nice(o.date)) + ' · ' + (o.small || 0) + ' small, ' + (o.large || 0) + ' large</span></span><span class="pill warn">' + esc(o.status === 'Packing' ? 'Started' : 'To pack') + '</span></a>';
    }).join('') || '<p class="muted">No orders waiting.</p>') + '</div></div>' +
      '<div class="card"><h2>Recently packed</h2><div class="list">' + (done.map(function (o) { return '<a class="row" href="#packing/' + encodeURIComponent(o.no) + '"><span>' + esc(o.shop) + ' · ' + esc(o.no) + '<br><span class="muted">' + esc(o.packedBy || '') + '</span></span><span class="pill ok">Packed</span></a>'; }).join('') || '<p class="muted">None yet.</p>') + '</div></div>');
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
    '<div class="grid2">' + field('To', sel('m_to', ['Jonny', 'Paul', 'Both'], S.user.indexOf('Jonny') === 0 ? 'Paul' : 'Jonny')) +
    field('Send it on (leave empty to send now)', inp('m_when', '', 'date')) + '</div>' +
    field('Message', '<textarea id="m_text" placeholder="e.g. Running low on large tubs – order more"></textarea>') +
    '<button class="btn" id="m_send">Send</button></div>' +
    '<div class="card"><h2>Sent</h2>' + (msgs.map(function (m) {
      return '<div class="row"><span><b>' + esc(m.from) + ' → ' + esc(m.to) + '</b> <span class="muted small">' + esc(nice(m.date)) + '</span><br>' + esc(m.text) + '</span><span class="pill' + (m.sent ? ' ok">sent' : ' warn">' + (m.remind ? 'on ' + esc(short(m.remind)) : 'sending')) + '</span></div>';
    }).join('') || '<p class="muted">No messages yet.</p>') + '</div>');
  $('#m_send').onclick = function () {
    if (!val('m_text')) return toast('Write a message first');
    record('message', { id: uid(), from: S.user, to: val('m_to'), text: val('m_text'), remind: val('m_when') }, val('m_when') ? 'Reminder set for ' + short(val('m_when')) : (navigator.onLine ? 'Message sent' : 'Will send when back online'));
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
  var lines = (D().recipe || []).filter(function (r) { return r.flavour === f; }).map(function (r) { return Object.assign({}, r); });
  if (!lines.length) lines.push({ ingredient: '', amount: '', unit: 'kg' });
  var base = setN('Base mix litres', 58);
  var chip = function (x) { return '<a class="chip' + (x === f ? ' on' : '') + '" href="#recipes/' + encodeURIComponent(x) + '">' + esc(x === BASE ? 'Base mix' : x) + '</a>'; };
  render(back() + '<h1>Recipes</h1><div class="card noprint">' + flavours.map(chip).join('') +
    '<h3>Limited Edition</h3>' + (ltd.map(chip).join('') || '<span class="muted small">None saved yet. </span>') + '<a class="chip" href="#" id="r_newltd">+ New limited edition</a></div>' +
    '<div class="card"><h2>' + esc(f) + (ltd.indexOf(f) >= 0 ? ' <span class="pill">Limited Edition</span>' : '') + '</h2><p class="muted">Amounts per ' + base + ' L of mix.' + (f === BASE ? ' Every flavour uses the base mix, plus its own extras (except non-dairy flavours like sorbet).' : wb ? ' These are added on top of the base mix.' : ' <b>This flavour doesn\'t use the dairy base mix</b> – list everything that goes in.') + '</p>' +
    '<table class="t" id="r_t"></table><button class="btn soft sm noprint" id="r_add" type="button">+ Add ingredient</button></div>' +
    '<div class="card noprint"><h2>Scale it</h2>' + field('Litres of mix', inp('r_l', base, 'number')) + '<div id="r_scaled"></div></div>' +
    '<div class="bar"><button class="btn alt" onclick="window.print()">Print</button><button class="btn" id="r_save">Save recipe</button></div>');
  function draw() {
    $('#r_t').innerHTML = '<tr><th>Ingredient</th><th>Amount</th><th>Unit</th><th></th></tr>' + lines.map(function (l, i) {
      return '<tr><td><input data-i="' + i + '" data-k="ingredient" value="' + esc(l.ingredient) + '" list="dl_ri"></td><td><input data-i="' + i + '" data-k="amount" inputmode="decimal" value="' + esc(l.amount) + '" style="width:100px"></td><td><input data-i="' + i + '" data-k="unit" value="' + esc(l.unit) + '" style="width:70px"></td><td><button class="btn soft sm" data-del="' + i + '">✕</button></td></tr>';
    }).join('') + '<datalist id="dl_ri">' + (D().ingredients || []).map(function (g) { return '<option value="' + esc(g.name) + '">'; }).join('') + '</datalist>';
    $$('#r_t input').forEach(function (e) { e.oninput = function () { lines[e.dataset.i][e.dataset.k] = e.value; scale(); }; });
    $$('#r_t [data-del]').forEach(function (b) { b.onclick = function () { lines.splice(Number(b.dataset.del), 1); draw(); }; });
    scale();
  }
  function scale() {
    var L = Number(val('r_l')) || base, k = L / base;
    var all = f === BASE || !wb ? lines : (D().recipe || []).filter(function (r) { return r.flavour === BASE; }).concat(lines);
    $('#r_scaled').innerHTML = '<table class="t">' + all.filter(function (l) { return l.ingredient; }).map(function (l) { return '<tr><td>' + esc(l.ingredient) + '</td><td><b>' + r2(Number(l.amount) * k, 3) + '</b> ' + esc(l.unit) + '</td></tr>'; }).join('') + '</table>';
  }
  draw(); $('#r_l').oninput = scale;
  $('#r_newltd').onclick = function (ev) { ev.preventDefault(); var n = (prompt('Name of the new limited edition flavour') || '').trim(); if (n) location.hash = 'recipes/' + encodeURIComponent(n); };
  $('#r_add').onclick = function () { lines.push({ ingredient: '', amount: '', unit: 'kg' }); draw(); };
  $('#r_save').onclick = function () {
    if (f === BASE && !confirm('Change the base mix for every flavour?')) return;
    record('recipe', { flavour: f, lines: lines.filter(function (l) { return l.ingredient; }) }, 'Recipe saved');
    route();
  };
};

/* ---------- records: view & print ---------- */
ROUTES.records = function (kind, from, to) {
  kind = kind || 'batches'; to = to || today(); from = from || addDays(to, -31);
  var kinds = [['batches', 'Batch records'], ['deliveries', 'Deliveries'], ['temps', 'Temperatures'], ['cleaning', 'Cleaning'], ['pest', 'Pest control'], ['stock', 'Stock takes']];
  var inRange = function (d) { return d && d >= from && d <= to; };
  var body = '';
  if (kind === 'batches') {
    var bs = (D().batches || []).filter(function (b) { return inRange(b.date) || inRange(b.tub); }).sort(function (a, b) { return Number(a.no) - Number(b.no); });
    body = bs.map(function (b) {
      return '<div class="card pagebreak"><h2>Batch ' + esc(b.no) + ' – ' + esc(b.flavour) + '</h2><table class="t">' +
        [['Date produced', nice(b.date)], ['Mix', b.mix ? b.mix + ' L' : ''], ['Pasteurisation start', b.start], ['Temperature reached', b.temp !== '' ? b.temp + ' °C' : ''], ['Held for', b.hold !== '' ? b.hold + ' mins' : ''],
          ['Cooling time', b.cool !== '' ? b.cool + ' mins' : ''], ['End temperature', b.end !== '' ? b.end + ' °C' : ''], ['Pasteurised by', b.pby], ['Best before', nice(b.bb)], ['Tubbed', nice(b.tub) + (b.tby ? ' by ' + b.tby : '')],
          ['Tubs', (b.large || 0) + ' large, ' + (b.small || 0) + ' small'], ['Labels checked', b.label || ''], ['Comments', b.comments]].map(function (r) { return '<tr><th style="width:190px">' + esc(r[0]) + '</th><td>' + esc(r[1] == null ? '' : r[1]) + '</td></tr>'; }).join('') + '</table>' +
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
    var byDate = {}; (D().iceStock || []).filter(function (x) { return inRange(x.date); }).forEach(function (x) { (byDate[x.date] = byDate[x.date] || []).push(x); });
    body = Object.keys(byDate).sort().reverse().map(function (d) { return '<div class="card"><h2>' + esc(nice(d)) + '</h2><table class="t"><tr><th>Flavour</th><th>Large</th><th>Small</th><th>Counted by</th></tr>' + byDate[d].map(function (x) { return '<tr><td>' + esc(x.flavour) + '</td><td>' + esc(x.large) + '</td><td>' + esc(x.small) + '</td><td>' + esc(x.by) + '</td></tr>'; }).join('') + '</table></div>'; }).join('') || '<div class="card muted">No stock takes in these dates.</div>';
  }
  render(back() + '<h1>Records</h1><div class="card noprint">' + kinds.map(function (k) { return '<a class="chip' + (k[0] === kind ? ' on' : '') + '" href="#records/' + k[0] + '/' + from + '/' + to + '">' + k[1] + '</a>'; }).join('') +
    '<div class="grid3" style="margin-top:10px">' + field('From', inp('rf', from, 'date')) + field('To', inp('rt', to, 'date')) + '<div><button class="btn" onclick="window.print()" style="margin-top:22px">Print</button></div></div>' +
    '<p class="muted small">Shows the last few months kept on this device. Everything is also in the Dukes Production Google Sheet.</p></div>' +
    '<div class="printonly"><h2>Dukes Ultra Premium Ice Cream – ' + esc((kinds.find(function (k) { return k[0] === kind; }) || [])[1]) + ', ' + esc(nice(from)) + ' to ' + esc(nice(to)) + '</h2></div>' + body);
  var go = function () { location.hash = 'records/' + kind + '/' + val('rf') + '/' + val('rt'); };
  $('#rf').onchange = go; $('#rt').onchange = go;
};

/* ---------- office (Jonny only) ---------- */
var SHEET_URL = 'https://docs.google.com/spreadsheets/d/1LFMR9kXMjVzS5M8tx852HBwlc0C1LTbnsB8Wxsh17s8/edit';
ROUTES.office = function () {
  var I = D().insights || {};
  var wk = function (x) { return x == null ? '<span class="muted">no count yet</span>' : x + ' wks'; };
  var short_ = (I.flavours || []).filter(function (f) { return f.shortfall > 0; });
  render(back() + '<h1>Office</h1>' +
    '<div class="tiles noprint" style="margin-bottom:16px">' +
    '<a class="tile dark" href="' + esc(I.creamLink || '#') + '" target="_blank"><span class="ic">🥛</span><span><b>Cream & milk order</b><br><small>Strathroy – by 12 noon Monday</small></span></a>' +
    '<a class="tile" href="' + SHEET_URL + '" target="_blank"><span class="ic">📗</span><span><b>Google Sheet</b><br><small>Prices, shops, settings, lists</small></span></a>' +
    '<a class="tile" href="#packing"><span class="ic">🧾</span><span><b>Shop orders</b><br><small>Packing list</small></span></a></div>' +
    (short_.length ? '<div class="due bad"><span>💍</span><span><b>Weddings need more stock:</b> ' + short_.map(function (f) { return esc(f.flavour) + ' (' + f.shortfall + ' small tubs short)'; }).join(', ') + '</span></div>' : '') +
    ((I.waiting || []).length ? '<div class="card"><h2>Shop orders to confirm</h2>' + I.waiting.map(function (o) { return '<div class="row"><span><b>' + esc(o.shop) + '</b> · ' + esc(o.no) + '<br><span class="muted">' + esc(nice(o.date)) + ' · ' + o.small + ' small, ' + o.large + ' large</span></span><a class="btn sm" target="_blank" href="' + esc(o.link) + '">Check & confirm</a></div>'; }).join('') + '</div>' : '') +
    '<div class="card"><h2>Make next</h2><p class="muted small">Estimated from the last stock take, plus batches tubbed, minus shop orders packed and weddings since. Weeks left is based on how fast each flavour has gone recently.</p><div class="scroll"><table class="t"><tr><th>Flavour</th><th>Large now</th><th>Small now</th><th>Uses (L/week)</th><th>Weeks left</th><th>Weddings ahead</th></tr>' +
    (I.produceFirst && I.produceFirst.length ? I.produceFirst : (I.flavours || [])).map(function (p) {
      var f = (I.flavours || []).find(function (x) { return x.flavour === p.flavour; }) || p;
      return '<tr><td><b>' + esc(f.flavour) + '</b></td><td>' + (f.large == null ? '–' : f.large) + '</td><td>' + (f.small == null ? '–' : f.small) + '</td><td>' + (f.weeklyLitres || '–') + '</td><td>' + (f.weeksLeft != null && f.weeksLeft < 2 ? '<span class="pill bad">' + f.weeksLeft + ' wks</span>' : wk(f.weeksLeft)) + '</td><td>' + (f.reservedSmall ? f.reservedSmall + ' small' + (f.shortfall ? ' <span class="pill bad">' + f.shortfall + ' short</span>' : '') : '') + '</td></tr>';
    }).join('') + '</table></div></div>' +
    '<div class="card"><h2>Best sellers</h2>' + ((I.bestSellers || []).map(function (b, i) { return '<div class="row"><span>' + (i + 1) + '. ' + esc(b.flavour) + '</span><b>' + b.weeklyLitres + ' L/week</b></div>'; }).join('') || '<p class="muted">Builds up as stock takes and orders are recorded.</p>') + '</div>' +
    '<div class="card"><h2>Ingredients – when to order</h2><p class="muted small">From the last count, plus deliveries, minus what batches used. Flagged when it will run out within its lead time (+1 week). Lead times and suppliers are on the Ingredients tab.</p><div class="scroll"><table class="t"><tr><th>Ingredient</th><th>In stock (est.)</th><th>Use per week</th><th>Weeks left</th><th>Lead time</th><th>Supplier</th></tr>' +
    (I.ingredients || []).map(function (g) { return '<tr><td>' + esc(g.name) + '</td><td>' + (g.est == null ? '<span class="muted">not counted</span>' : g.est + ' ' + esc(g.unit)) + '</td><td>' + (g.weeklyUse || '–') + '</td><td>' + (g.warn ? '<span class="pill bad">' + g.weeksLeft + ' – order now</span>' : (g.weeksLeft == null ? '–' : g.weeksLeft)) + '</td><td>' + g.lead + ' wks</td><td>' + esc(g.supplier || '?') + '</td></tr>'; }).join('') + '</table></div></div>' +
    '<div class="card"><h2>Weddings coming up</h2>' + ((I.weddings || []).map(function (w) { return '<div class="row"><span><b>' + esc(nice(w.date)) + '</b> · ' + esc(w.name) + '<br><span class="muted">' + esc(w.flavours.join(', ') || 'Flavours not chosen yet') + '</span></span><span>' + w.guests + ' guests</span></div>'; }).join('') || '<p class="muted">None booked in the next few weeks.</p>') + '</div>' +
    '<div class="card"><h2>Shop orders expected</h2>' + ((I.shops || []).map(function (s) { return '<div class="row"><span><b>' + esc(s.shop) + '</b><br><span class="muted">' + s.orders + ' orders · usually ' + s.small + ' small / ' + s.large + ' large' + (s.avgDays ? ' · every ' + s.avgDays + ' days' : '') + '</span></span><span>' + (s.nextDue ? 'about ' + esc(short(s.nextDue)) : '–') + '</span></div>'; }).join('') || '<p class="muted">Builds up once shops order through their links.</p>') + '</div>');
};

/* ---------- staff hours & pay (passcode; never stored on the device) ---------- */
function hoursCall(body) {
  return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ a: 'hours', k: S.key, code: S.hcode }, body)) }).then(function (r) { return r.json(); });
}
function hoursLockTimer() { clearTimeout(S.hTimer); S.hTimer = setTimeout(function () { S.hcode = null; S.hv = null; if ((location.hash || '').indexOf('#hours') === 0) { toast('Hours locked'); route(); } }, 10 * 60 * 1000); }
ROUTES.hours = function (month) {
  if (!S.hcode || !S.hv) {
    render(back() + '<div class="card center" style="max-width:420px;margin:30px auto"><h1>🔒 Hours & pay</h1><p class="muted">Enter your passcode.</p>' +
      '<input id="h_code" type="password" inputmode="numeric" autocomplete="off" style="text-align:center;font-size:26px;letter-spacing:8px;width:200px"><br>' +
      '<button class="btn" id="h_go" style="margin-top:14px">Open</button><p class="muted small">Needs the internet. It locks again when you leave this screen.</p></div>');
    var go = function () {
      if (!navigator.onLine) return toast('Hours needs the internet');
      S.hcode = val('h_code');
      $('#h_go').disabled = true;
      hoursCall({ op: 'get', month: month }).then(function (r) {
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
    field('…or total hours', inp('h_hrs', '', 'number')) + '</div>' + field('Notes', inp('h_notes', '')) +
    '<p class="muted" id="h_calc"></p><button class="btn" id="h_add">Save hours</button></div>' +
    '<div class="card"><h2>' + esc(monthName) + ' – totals</h2><div class="printonly">Dukes Ultra Premium Ice Cream</div><table class="t"><tr><th>Name</th><th>Hours</th>' + (pay ? '<th>Rate £/hr</th><th>Pay £</th>' : '') + '</tr>' +
    (v.summary.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td><b>' + r2(x.hours) + '</b></td>' + (pay ? '<td><input class="h_rate" data-n="' + esc(x.name) + '" inputmode="decimal" value="' + esc(x.rate) + '" style="width:90px"></td><td><b>' + (x.pay == null ? '<span class="muted">set rate</span>' : '£' + x.pay.toFixed(2)) + '</b></td>' : '') + '</tr>'; }).join('') || '<tr><td colspan="4" class="muted">No hours this month yet.</td></tr>') +
    (v.summary.length ? '<tr><td><b>Total</b></td><td><b>' + r2(totalH) + '</b></td>' + (pay ? '<td></td><td><b>£' + total.toFixed(2) + '</b></td>' : '') + '</tr>' : '') + '</table>' +
    (pay ? '<p class="muted small">Pay is hours × rate, before tax, NI or holiday pay. Change a rate and press Enter – it\'s used for the whole month.</p>' : '') + '</div>' +
    (pay ? '<div class="card noprint"><h2>Pay rates</h2><table class="t">' + v.rates.map(function (x) { return '<tr><td>' + esc(x.name) + (x.casual ? ' <span class="pill">casual</span>' : '') + '</td><td>£ <input class="h_rate" data-n="' + esc(x.name) + '" inputmode="decimal" value="' + esc(x.rate) + '" style="width:90px"> per hour</td></tr>'; }).join('') + '</table></div>' : '') +
    '<div class="card"><h2>Entries</h2><table class="t"><tr><th>Date</th><th>Name</th><th>Times</th><th>Hours</th><th>Notes</th><th class="noprint"></th></tr>' +
    (v.entries.map(function (e) { return '<tr><td>' + esc(short(e.date)) + '</td><td>' + esc(e.name) + (e.casual ? ' <span class="pill">casual</span>' : '') + '</td><td>' + esc(e.start && e.finish ? e.start + '–' + e.finish + (e.brk ? ' (' + e.brk + ' min break)' : '') : '') + '</td><td><b>' + r2(e.hours) + '</b></td><td>' + esc(e.notes || '') + '</td><td class="noprint"><button class="btn soft sm" data-del="' + esc(e.id) + '">✕</button></td></tr>'; }).join('') || '<tr><td colspan="6" class="muted">Nothing yet.</td></tr>') + '</table></div>');
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
  $('#h_add').onclick = function () {
    var opt = $('#h_name').selectedOptions[0], name = val('h_name');
    if (!name || name === '__new') return toast('Choose who');
    if (!(val('h_start') && val('h_fin')) && !num(val('h_hrs'))) return toast('Enter start and finish times, or the total hours');
    var isCasual = (opt && opt.dataset.casual === '1') || v.people.some(function (p) { return p.name === name && p.casual; });
    hoursDo({ op: 'save', e: { id: uid(), date: val('h_date'), name: name, start: val('h_start'), finish: val('h_fin'), brk: num(val('h_brk')), hours: num(val('h_hrs')), notes: val('h_notes'), casual: isCasual, rate: opt && opt.dataset.rate || '', by: S.user } }, 'Hours saved for ' + name);
  };
  $$('.h_rate').forEach(function (e) { e.onchange = function () { hoursDo({ op: 'rate', name: e.dataset.n, rate: num(e.value) }, 'Rate saved for ' + e.dataset.n); }; });
  $$('[data-del]').forEach(function (b) { b.onclick = function () { if (confirm('Delete this entry?')) hoursDo({ op: 'delete', id: b.dataset.del }, 'Deleted'); }; });
}

boot();
