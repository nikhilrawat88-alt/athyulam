/* Athulyam Homes Guest Manager — phone app (offline PWA). Data lives on this device in IndexedDB. */
(function () {
  'use strict';
  var A = AH, inr = A.inr, num = A.num, r2 = A.r2;
  var APP_VERSION = '1.8.0';

  /* ---------- tiny helpers ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function thisMonth() { return today().slice(0, 7); }
  function nowISO() { return new Date().toISOString(); }
  function token() { var a = new Uint8Array(6); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.prototype.map.call(a, function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
  function fmtDate(s) {
    if (!A.isDate(s)) return '—';
    var p = s.split('-'), m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1];
    return Number(p[2]) + ' ' + m + ' ' + p[0];
  }
  function fmtShort(s) { if (!A.isDate(s)) return '—'; var p = s.split('-'); return Number(p[2]) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1]; }
  function fmtMonth(ym) { var p = ym.split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(p[1]) - 1] + ' ' + p[0]; }
  function toast(msg, bad) {
    var t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = ''; }, 2600);
  }

  /* ---------- storage (IndexedDB, one record holds everything) ---------- */
  var DB_NAME = 'athulyam-homes', STORE = 'kv', KEY = 'data', FILES = 'files';
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 2);
      r.onupgradeneeded = function () {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
        if (!r.result.objectStoreNames.contains(FILES)) r.result.createObjectStore(FILES);
      };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbGet() {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var q = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
      });
    });
  }
  function idbPut(val) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, KEY);
        tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); };
      });
    });
  }

  /* ID photos and documents: stored as files on this phone until uploaded to Drive. */
  function fileOp(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(FILES, mode), st = tx.objectStore(FILES), out = fn(st);
        tx.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function filePut(id, blob) { return fileOp('readwrite', function (st) { st.put(blob, id); }); }
  function fileGet(id) { return fileOp('readonly', function (st) { return st.get(id); }); }
  function fileDel(id) { return fileOp('readwrite', function (st) { st.delete(id); }); }
  /* Shrink photos to max 2000 px on the long side, JPEG quality 0.85: ID text stays sharp, an iPhone photo of 3–8 MB
     becomes about 0.4–0.9 MB. If the smaller copy is not smaller (already small), the original is kept. PDFs are kept as they are. */
  function compressImage(file) {
    if (!/^image\//.test(file.type) || /svg/.test(file.type)) return Promise.resolve({ blob: file, w: 0, h: 0 });
    return new Promise(function (res) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 2000, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        var cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
        cv.toBlob(function (bl) { res({ blob: bl && bl.size < file.size ? bl : file, w: cv.width, h: cv.height }); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res({ blob: file, w: 0, h: 0 }); };
      img.src = url;
    });
  }

  function defaultSettings() {
    return {
      businessName: 'Athulyam Homes', legalName: '', address: A.BUSINESS_DEFAULTS.address, phone: A.BUSINESS_DEFAULTS.phone, email: '', gstin: A.BUSINESS_DEFAULTS.gstin,
      website: A.BUSINESS_DEFAULTS.website, checkInTime: A.BUSINESS_DEFAULTS.checkInTime, checkOutTime: A.BUSINESS_DEFAULTS.checkOutTime, logo: '',
      invoicePrefix: 'INV', invoiceStart: 1, sacOther: '',
      billFooter: 'Thank you for staying with us.',
      gstOn: true, gstRoomLow: 5, gstRoomHigh: 18, gstThreshold: 7500, gstFood: 5, gstOther: 18,
      rooms: [
        { id: 'room-1', name: 'Room 1', tariff: 3000, active: true, clean: true },
        { id: 'room-2', name: 'Room 2', tariff: 3000, active: true, clean: true }
      ],
      seasons: [],
      sources: A.SOURCES.slice(),
      expenseCats: A.EXPENSE_CATS.slice(),
      idMode: 'full',
      idTypes: ['Aadhaar', 'Passport', 'Driving Licence', 'Voter ID', 'PAN', 'Other'],
      reminders: { arrivals: 8, payments: 9, summary: 20, monthly: 9, enabled: true },
      backupDays: 7,
      pinHash: '', pinSalt: '', lockMinutes: 5,
      syncUrl: '', syncToken: '', autoSync: true,
      mealRates: { Breakfast: 0, Lunch: 0, Dinner: 0 }, menu: JSON.parse(JSON.stringify(A.MENU_DEFAULT)),
      services: [{ name: 'Bonfire', rate: 0 }, { name: 'Pick-up / drop', rate: 0 }, { name: 'Sightseeing', rate: 0 }],
      tokenAmount: 500, upiId: '', autoReviewEmail: false, customFields: [], couponPrefix: 'ATH', bookingPrefix: 'ATH', keepPhotosDays: 30, uploadDocs: true,
      reviewLinks: {
        google: 'https://share.google/sGf4Yhq7SHDDbqd9y',
        'Booking.com': 'https://www.booking.com/hotel/in/athulyam-homes.html',
        'Airbnb': 'https://www.airbnb.com/rooms/1320639458802341803',
        'MakeMyTrip': 'https://app.mmyt.co/Xm2V/95zbx6y4',
        'Goibibo': '', 'Agoda': ''
      }
    };
  }
  var data = null, saving = Promise.resolve();
  function load() {
    return idbGet().then(function (d) {
      data = d || { settings: defaultSettings(), bookings: [], payments: [], expenses: [], queries: [], meta: { created: nowISO() } };
      var def = defaultSettings();
      Object.keys(def).forEach(function (k) { if (data.settings[k] === undefined) data.settings[k] = def[k]; });
      data.meta = data.meta || {};
      data.bookings = data.bookings || []; data.payments = data.payments || []; data.expenses = data.expenses || []; data.queries = data.queries || [];
      var rl = defaultSettings().reviewLinks; data.settings.reviewLinks = data.settings.reviewLinks || {};
      Object.keys(rl).forEach(function (k) { if (data.settings.reviewLinks[k] === undefined) data.settings.reviewLinks[k] = rl[k]; });
      var moved = A.migrateEnquiries(data);
      data.bookings.forEach(function (b) { if (!b.fbToken) b.fbToken = token(); if (A.migrateGuests(b)) moved++; });
      moved += A.assignBookingNumbers(data);
      if (!data.meta.v14) { data.meta.v14 = nowISO(); data.settings.idMode = 'full'; moved++; }
      if (!data.meta.v15) {
        data.meta.v15 = nowISO(); var st = data.settings, D = A.BUSINESS_DEFAULTS;
        if (!st.address || st.address === 'Uttarakhand, India') st.address = D.address;
        if (!st.phone) st.phone = D.phone; if (!st.gstin) st.gstin = D.gstin; if (!st.website) st.website = D.website;
        moved++;
      }
      if (!data.meta.v18) {
        data.meta.v18 = nowISO(); var s8 = data.settings;
        if (!s8.menu || !s8.menu.length) s8.menu = JSON.parse(JSON.stringify(A.MENU_DEFAULT));
        var big = (s8.rooms || []).filter(function (r) { return /4\s*bhk/i.test(r.name); })[0];
        if (big && !(big.includes || []).length) {
          big.includes = (s8.rooms || []).filter(function (r) { return /deluxe\s*double|deluxe\s*king|family\s*suite/i.test(r.name); }).map(function (r) { return r.id; });
        }
        moved++;
      }
      if (!data.meta.v17) { data.meta.v17 = nowISO(); data.settings.mealRates = data.settings.mealRates || { Breakfast: 0, Lunch: 0, Dinner: 0 }; moved++; }
      if (!data.meta.v16) { data.meta.v16 = nowISO(); data.settings.autoReviewEmail = false; data.settings.customFields = data.settings.customFields || []; moved++; }
      data.deleted = data.deleted || {};
      trackInit();
      if (moved) return idbPut(JSON.parse(JSON.stringify(data)));
    });
  }
  /* ---------- change tracking for two-way sync ----------
     Every record gets a fresh updatedAt when its content changes; removed records are remembered as deleted,
     so another device that syncs later learns about the deletion instead of bringing the record back. */
  var DEVICE_KEYS = ['pinHash', 'pinSalt', 'syncToken', 'syncUrl', 'autoSync', 'lockMinutes', 'settingsAt'];
  var known = {}, knownSettings = '', resetting = false;
  function fp(x) { return JSON.stringify(x, function (k, v) { return k === 'updatedAt' || k === 'local' || k === 'driveUrl' ? undefined : v; }); }
  function settingsFp(st) { var o = {}; Object.keys(st || {}).sort().forEach(function (k) { if (DEVICE_KEYS.indexOf(k) < 0) o[k] = st[k]; }); return JSON.stringify(o); }
  function trackInit() {
    known = {};
    A.COLLS.forEach(function (k) { (data[k] || []).forEach(function (r) { if (r && r.id) known[k + ':' + r.id] = fp(r); }); });
    knownSettings = settingsFp(data.settings);
  }
  function trackChanges() {
    var now = nowISO(), seen = {};
    data.deleted = data.deleted || {};
    A.COLLS.forEach(function (k) {
      (data[k] || []).forEach(function (r) {
        if (!r || !r.id) return;
        var key = k + ':' + r.id, f = fp(r); seen[key] = 1;
        if (known[key] !== f) { r.updatedAt = now; if (!r.createdAt) r.createdAt = now; known[key] = f; }
      });
    });
    Object.keys(known).forEach(function (key) { if (!seen[key]) { if (!resetting) data.deleted[key.split(':').slice(1).join(':')] = now; delete known[key]; } });
    var sf = settingsFp(data.settings);
    if (sf !== knownSettings) { data.settings.settingsAt = now; knownSettings = sf; }
  }
  function save(skipSync) {
    trackChanges();
    data.meta.updatedAt = nowISO();
    saving = saving.then(function () { return idbPut(JSON.parse(JSON.stringify(data))); }).catch(function (e) {
      toast('Could not save on this device: ' + e.message, true);
    });
    if (!skipSync) scheduleSync();
    return saving;
  }
  if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () {}); }

  /* ---------- lookups ---------- */
  var S = function () { return data.settings; };
  function gstByRate(c) {
    var m = {}; (c.roomParts || []).forEach(function (p) { if (!p.gst && !p.taxable) return; var x = m[p.rate] = m[p.rate] || { rate: p.rate, gst: 0, taxable: 0 }; x.gst = r2(x.gst + p.gst); x.taxable = r2(x.taxable + p.taxable); });
    return Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return x.gst; });
  }
  function roomsLabel(b) { return A.roomIds(b).filter(Boolean).map(roomName).join(' + ') || 'No room yet'; }
  function gname(x) { return String((x && (x.guestName || x.name)) || '').trim() || '(name to add)'; }
  /* Version 1.7: nothing is required, so flag bookings that still miss the basics. */
  function missingBits(b) {
    if (b.imported) return [];
    var m = [];
    if (!String(b.guestName || '').trim()) m.push('name');
    if (!String(b.phone || '').trim()) m.push('mobile');
    if (!A.isDate(b.checkIn) || !A.isDate(b.checkOut)) m.push('dates');
    if (!A.roomIds(b).filter(Boolean).length) m.push('room');
    return m;
  }
  function roomName(id) { var r = S().rooms.filter(function (x) { return x.id === id; })[0]; return r ? r.name : '(removed room)'; }
  function booking(id) { return data.bookings.filter(function (b) { return b.id === id; })[0]; }
  function query(id) { return (data.queries || []).filter(function (q) { return q.id === id; })[0]; }
  function calc(b) { return A.calc(b, data.payments); }
  function statusClass(s) { return 'st-' + String(s).toLowerCase().replace(/\s/g, '-'); }
  function flagLabel(f) {
    return { overdue: 'Overdue', 'no-advance': 'No advance yet', pending: 'Balance pending', overpaid: 'Overpaid', 'due-today': 'Due today', 'refund-due': 'Refund due', 'fee-due': 'Fee due' }[f] || '';
  }

  /* ---------- routing ---------- */
  var routes = {};
  function go(h) { if (location.hash === h) render(); else location.hash = h; }
  window.addEventListener('hashchange', function () { render(true); });

  function render(scroll) {
    if (locked()) return renderLock();
    var parts = (location.hash || '#/home').slice(2).split('/');
    var name = parts[0] || 'home', arg = parts.slice(1).join('/');
    var v = (routes[name] || routes.home)(decodeURIComponent(arg || ''));
    $('#title').textContent = v.title || S().businessName;
    $('#back').style.visibility = v.back ? 'visible' : 'hidden';
    $('#back').onclick = function () { if (history.length > 1) history.back(); else go(v.back); };
    $('#main').innerHTML = v.html;
    $$('#tabs a').forEach(function (a) { a.classList.toggle('on', (v.tab || name) === a.dataset.tab); });
    if (v.after) v.after();
    if (scroll) window.scrollTo(0, 0);
  }

  /* ---------- reusable bits ---------- */
  function tile(label, value, sub, cls) {
    return '<div class="tile ' + (cls || '') + '"><div class="tl">' + esc(label) + '</div><div class="tv">' + value + '</div>' + (sub ? '<div class="ts">' + sub + '</div>' : '') + '</div>';
  }
  function row(label, value, cls) { return '<div class="row ' + (cls || '') + '"><span>' + esc(label) + '</span><b>' + value + '</b></div>'; }
  function empty(msg, cta) { return '<div class="empty"><div class="leaf">❦</div><p>' + esc(msg) + '</p>' + (cta || '') + '</div>'; }
  function bookingCard(b, opts) {
    var c = calc(b), flag = A.paymentFlags(b, c, today());
    return '<a class="card bk" href="#/guest/' + b.id + '">' +
      '<div class="bk-top"><b>' + esc(gname(b)) + '</b><span class="st ' + statusClass(b.status) + '">' + esc(b.status) + '</span></div>' +
      '<div class="bk-mid">' + esc(roomsLabel(b)) + ' · ' + fmtShort(b.checkIn) + ' → ' + fmtShort(b.checkOut) + (A.stayLabel(b) ? ' · ' + A.stayLabel(b) : '') + ' · ' + esc(b.source) + '</div>' +
      (opts && opts.phone && b.phone ? '<div class="bk-mid">☎ ' + esc(b.phone) + '</div>' : '') +
      '<div class="bk-bot"><span>Bill ' + inr(c.total) + '</span><span>Paid ' + inr(c.received) + '</span><span class="' + (c.outstanding > 0 ? 'due' : '') + '">Due ' + inr(Math.max(c.outstanding, 0)) + '</span></div>' +
      (flag ? '<div class="flag fl-' + flag + '">' + flagLabel(flag) + '</div>' : '') +
      (missingBits(b).length ? '<div class="flag fl-pending">Incomplete: ' + esc(missingBits(b).join(', ')) + '</div>' : '') +
      (A.flaggedLines(b).length ? '<div class="flag fl-overdue">Food bill to check</div>' : '') +
      (A.isActive(b) && A.foreignGuests(b).some(function (g) { return !g.formCArrival; }) ? '<div class="flag fl-overdue">Form C not filed</div>' : '') +
      '</a>';
  }
  function options(list, sel, labelFn) {
    return list.map(function (x) {
      var v = typeof x === 'object' ? x.id : x, l = labelFn ? labelFn(x) : (typeof x === 'object' ? x.name : x);
      return '<option value="' + esc(v) + '"' + (String(v) === String(sel) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }
  function field(label, inner, err, hint) {
    return '<label class="fld"><span>' + esc(label) + '</span>' + inner + (hint ? '<small>' + esc(hint) + '</small>' : '') + (err ? '<em class="err">' + esc(err) + '</em>' : '') + '</label>';
  }

  /* ---------- downloads, sharing ---------- */
  function deliverFile(name, text, mime) {
    var blob = new Blob([text], { type: mime });
    try {
      var file = new File([blob], name, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        return navigator.share({ files: [file], title: name }).then(function () { return true; }).catch(function (e) {
          if (e && e.name === 'AbortError') return false; return fallback();
        });
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(fallback());
    function fallback() {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return true;
    }
  }
  function csv(rows) {
    return '\uFEFF' + rows.map(function (r) {
      return r.map(function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    }).join('\r\n');
  }
  function smsNo(phone) { var d = String(phone || '').replace(/\D/g, ''); return d.length === 10 ? '+91' + d : (d ? '+' + d : ''); }
  function waLink(phone, text) {
    var d = String(phone || '').replace(/\D/g, '');
    if (d.length === 10) d = '91' + d;
    return 'https://wa.me/' + d + '?text=' + encodeURIComponent(text);
  }
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function ics(events) {
    var stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    var out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Athulyam Homes//Guest Manager//EN', 'CALSCALE:GREGORIAN'];
    events.forEach(function (e) {
      out.push('BEGIN:VEVENT', 'UID:' + e.uid + '@athulyam', 'DTSTAMP:' + stamp);
      out.push('DTSTART;TZID=Asia/Kolkata:' + e.start, 'DTEND;TZID=Asia/Kolkata:' + e.end);
      if (e.rrule) out.push('RRULE:' + e.rrule);
      out.push('SUMMARY:' + icsEscape(e.title), 'DESCRIPTION:' + icsEscape(e.desc || ''));
      out.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(e.title), 'TRIGGER:' + (e.alarm || '-PT0M'), 'END:VALARM', 'END:VEVENT');
    });
    out.push('END:VCALENDAR');
    return out.join('\r\n');
  }
  function icsTime(date, hour, min) { return date.replace(/-/g, '') + 'T' + pad(hour) + pad(min || 0) + '00'; }

  /* ---------- alerts for the dashboard ---------- */
  function alerts() {
    var t = today(), out = [];
    var cc = A.couponCandidates(data, t).filter(function (q) { return !q.couponCode; });
    if (cc.length) out.push({ cls: 'red', text: cc.length + ' direct quer' + (cc.length > 1 ? 'ies' : 'y') + ' arriving soon, not booked, rooms free — offer a coupon?', href: '#/query/' + cc[0].id });
    var oq = (data.queries || []).filter(function (q) { return q.status === 'Open'; });
    if (oq.length) out.push({ cls: 'amber', text: oq.length + ' quer' + (oq.length > 1 ? 'ies' : 'y') + ' waiting for your reply', href: '#/queries' });
    var fc = A.formCPending(data, t);
    if (fc.length) out.push({ cls: 'red', text: fc.length + ' booking' + (fc.length > 1 ? 's need' : ' needs') + ' Form C for foreign guests (due within 24 hours of check-in)', href: '#/formc/' + fc[0].id });
    var fd = A.formCDeparturePending(data, t);
    if (fd.length) out.push({ cls: 'red', text: fd.length + ' Form C departure entr' + (fd.length > 1 ? 'ies' : 'y') + ' to file (within 24 hours of leaving)', href: '#/formc/' + fd[0].id });
    var nid = data.bookings.filter(function (b) { return (b.status === 'Checked In' || (b.status === 'Confirmed' && b.checkIn === t)) && (A.guestCountGap(b) || A.docsMissing(b)); });
    if (nid.length) out.push({ cls: 'amber', text: nid.length + ' booking' + (nid.length > 1 ? 's' : '') + ' arriving or in-house with guests or ID photos missing', href: '#/guest/' + nid[0].id });
    var od = A.outstandingAll(data).filter(function (x) { return A.paymentFlags(x.b, x.c, t) === 'overdue'; });
    if (od.length) out.push({ cls: 'red', text: od.length + ' overdue balance' + (od.length > 1 ? 's' : '') + ' · ' + inr(A.sum(od, function (x) { return x.c.outstanding; })), href: '#/pending' });
    var na = A.futureBookings(data, t).filter(function (b) { return b.status === 'Confirmed' && b.checkIn <= A.addDays(t, 7) && calc(b).received <= 0; });
    if (na.length) out.push({ cls: 'amber', text: na.length + ' arrival' + (na.length > 1 ? 's' : '') + ' in the next 7 days with no advance', href: '#/future' });
    var lb = data.meta.lastBackup;
    var days = lb ? Math.floor((Date.now() - new Date(lb).getTime()) / 864e5) : null;
    if (data.bookings.length && (days === null || days >= num(S().backupDays || 7)) && !(data.meta.lastSync && (Date.now() - new Date(data.meta.lastSync).getTime()) / 864e5 < num(S().backupDays || 7)))
      out.push({ cls: 'amber', text: lb ? 'Backup overdue — last backup ' + days + ' days ago' : 'No backup yet — export one now', href: '#/backup' });
    var dirty = S().rooms.filter(function (r) { return r.active !== false && r.clean === false; });
    if (dirty.length) out.push({ cls: 'grey', text: dirty.length + ' room' + (dirty.length > 1 ? 's' : '') + ' need cleaning: ' + dirty.map(function (r) { return r.name; }).join(', '), href: '#/calendar' });
    return out;
  }

  function dashboardHtml() {
    var d = A.dashboard(data, today()), q = d.queries, b = d.bookings, p = d.payments;
    return '<h2>Dashboard <a class="more" href="#/queries">Queries ›</a></h2><div class="tiles">' +
      tile('Queries open', String(q.open), q.answered + ' answered, waiting on guest', q.open ? 'warnv' : '') +
      tile('Converted this month', q.conversionPctThisMonth + '%', q.closedBookedThisMonth + ' booked · ' + q.closedNotBookedThisMonth + ' not booked') +
      tile('Waiting for check-in', String(b.waitingCheckIn), b.checkedIn + ' checked in now') +
      tile('Payment status', p.paid + ' paid', p.partPaid + ' part paid · ' + p.unpaid + ' unpaid', p.unpaid ? 'warnv' : '') +
      tile('Checked out this month', String(b.checkedOutThisMonth), b.cancelledThisMonth + ' cancelled') +
      tile('Bookings from queries', String(b.fromQueriesThisMonth), 'this month') + '</div>';
  }

  /* ---------- HOME ---------- */
  routes.home = function () {
    var t = today(), dr = A.dailyReport(data, t), mr = A.monthlyReport(data, thisMonth());
    var fut = A.futureBookings(data, A.addDays(t, 1)).slice(0, 5);
    var pend = A.outstandingAll(data).filter(function (x) { return x.c.outstanding > 0; })
      .sort(function (a, b) { return a.b.checkIn < b.b.checkIn ? -1 : 1; }).slice(0, 5);
    var al = alerts();
    var html = '<div class="today-line">' + fmtDate(t) + '</div>' +
      al.map(function (a) { return '<a class="alert ' + a.cls + '" href="' + a.href + '">' + esc(a.text) + ' ›</a>'; }).join('') +
      '<a class="cta" href="#/new">＋ Add New Booking</a><a class="cta small alt" href="#/qnew">＋ Add New Query</a>' +
      dashboardHtml() +
      '<h2>Today’s check-ins <a class="more" href="#/today">All ›</a></h2>' +
      (dr.checkIns.length ? dr.checkIns.map(function (b) { return bookingCard(b, { phone: true }); }).join('') : empty('No check-ins today.')) +
      '<h2>Today <a class="more" href="#/daily">Report ›</a></h2><div class="tiles">' +
      tile('Billed today', inr(dr.revenue.billed), 'room ' + inr(dr.revenue.room) + ' · food ' + inr(dr.revenue.food)) +
      tile('Collected today', inr(dr.collections.net), 'cash ' + inr(dr.collections.byMethod.Cash) + ' · UPI ' + inr(dr.collections.byMethod.UPI)) +
      tile('In-house', String(dr.inHouse.length), dr.checkOuts.length + ' checking out') +
      tile('Net after commission', inr(dr.revenue.net), 'GST excluded') + '</div>' +
      '<h2>' + fmtMonth(thisMonth()) + ' <a class="more" href="#/monthly">Report ›</a></h2><div class="tiles">' +
      tile('Gross revenue', inr(mr.revenue.taxable), 'before GST, after discounts') +
      tile('Collected', inr(mr.collections.net), 'payments this month') +
      tile('Net after commission', inr(mr.revenue.net), 'commission ' + inr(mr.revenue.commission)) +
      tile('Profit after expenses', inr(mr.profit), 'expenses ' + inr(mr.expenses), mr.profit < 0 ? 'neg' : '') + '</div>' +
      '<h2>Upcoming bookings <a class="more" href="#/future">All ›</a></h2>' +
      (fut.length ? fut.map(function (b) { return bookingCard(b); }).join('') : empty('No upcoming bookings.')) +
      '<h2>Pending payments <a class="more" href="#/pending">All ›</a></h2>' +
      (pend.length ? pend.map(function (x) { return bookingCard(x.b); }).join('') : empty('Nothing pending. All balances are clear.')) + syncCard();
    return { title: S().businessName, html: html, tab: 'home', after: bindSyncCard };
  };

  /* ---------- BOOKING FORM (add + edit) ---------- */
  var formState = null;
  function blankBooking(prefill) {
    var s = S(), room = (A.activeRooms(s)[0] || {}).id || '';
    var b = {
      id: '', guestName: '', phone: '', email: '', nationality: 'Indian', country: '', formCFiled: false,
      idType: s.idTypes[0], idValue: '', adults: 2, children: 0, roomId: room, rooms: [{ roomId: room, charge: '', auto: true }],
      checkIn: today(), checkOut: A.addDays(today(), 1), source: 'Direct Booking', status: 'Confirmed',
      room: '', food: '', additional: '', additionalNote: '', charges: [], custom: {}, discount: '', commission: '', gender: '', address: '',
      gstOn: !!s.gstOn, gstRoomRate: s.gstRoomLow, gstFoodRate: s.gstFood, gstOtherRate: s.gstOther, gstRateManual: false,
      couponType: '', couponValue: '', couponCode: '', specialRequests: '', notes: '', cancelFee: '', cancelCommission: '', payoutReceived: '', payoutDate: '', payoutRef: ''
    };
    Object.keys(prefill || {}).forEach(function (k) { b[k] = prefill[k]; });
    if (prefill && !prefill.rooms) b.rooms = [{ roomId: prefill.roomId || room, charge: prefill.room || '', auto: !prefill.room }];
    b.roomId = (b.rooms[0] || {}).roomId || '';
    return b;
  }
  routes['new'] = function (arg) {
    var pre = {};
    if (arg) arg.split('&').forEach(function (kv) { var p = kv.split('='); pre[p[0]] = decodeURIComponent(p[1] || ''); });
    if (pre.checkIn && !pre.checkOut) pre.checkOut = A.addDays(pre.checkIn, 1);
    if (pre.fromQuery) {
      var q = query(pre.fromQuery);
      if (q) {
        pre = { queryId: q.id, guestName: q.name || '', phone: q.phone || '', email: q.email || '', source: q.channel || 'Direct Booking',
          adults: q.adults || 2, children: q.children || 0, specialRequests: q.message || '', notes: q.notes || '' };
        if (A.isDate(q.checkIn)) pre.checkIn = q.checkIn;
        if (A.isDate(q.checkOut)) pre.checkOut = q.checkOut;
        if (q.roomId) pre.roomId = q.roomId;
        if (num(q.quote)) pre.room = q.quote;
        if (q.couponType) { pre.couponType = q.couponType; pre.couponValue = q.couponValue; pre.couponCode = q.couponCode; }
      }
    }
    formState = { b: blankBooking(pre), errors: {}, isNew: true };
    return bookingForm(pre.queryId ? 'Booking from query' : 'New booking');
  };
  routes.edit = function (id) {
    var b = booking(id);
    if (!b) return { title: 'Not found', html: empty('This booking no longer exists.'), back: '#/bookings' };
    var copy = JSON.parse(JSON.stringify(b));
    /* Existing amounts are kept as they are (auto only when the line was auto-priced and not changed by hand). */
    copy.rooms = A.roomsOf(copy).map(function (r) { return { roomId: r.roomId, charge: r.charge, gstRate: r.gstRate, auto: r.auto === true }; });
    copy.charges = A.chargeLines(copy).map(function (x) { return JSON.parse(JSON.stringify(x)); }); copy.custom = copy.custom || {};
    var mg = A.guestsOf(copy).filter(function (g) { return g.primary; })[0] || A.guestsOf(copy)[0] || {}; copy.gender = copy.gender || mg.gender || ''; copy.address = copy.address || mg.address || '';
    formState = { b: copy, errors: {}, isNew: false };
    return bookingForm('Edit booking');
  };
  function bookingForm(title) {
    var b = formState.b, e = formState.errors, s = S();
    var idHint = s.idMode === 'full' ? 'Full ID number is stored.' : 'Only the last 4 characters are kept, e.g. 4821.';
    var html = (b.queryId ? '<div class="ok">Converted from a query. The guest details are filled in — add the room, dates and charges, then save.</div>' : '') +
      '<form id="bf" novalidate>' +
      '<p class="small">Every field is optional. Fill in what you have now and the rest later; the booking shows “Incomplete” until name, mobile, dates and room are in.</p>' +
      '<div class="card"><h3>Guest</h3>' +
      field('Full name', '<input name="guestName" value="' + esc(b.guestName) + '" autocomplete="off">', e.guestName) +
      field('Mobile number', '<input name="phone" type="tel" inputmode="tel" value="' + esc(b.phone) + '" placeholder="98XXXXXXXX">', e.phone, 'Used for WhatsApp messages. Indian numbers get +91 automatically.') +
      field('Email', '<input name="email" type="email" inputmode="email" value="' + esc(b.email) + '" placeholder="For the review request email">', e.email) +
      '<div class="two">' + field('Nationality', '<select name="nationality">' + options(['Indian', 'Foreign'], b.nationality) + '</select>', e.nationality) +
      field('Country', '<input name="country" value="' + esc(b.country) + '" placeholder="If foreign">', e.country) + '</div>' +
      '<div class="two">' + field('Gender', '<select name="gender">' + options(['', 'Male', 'Female', 'Other'], b.gender || '', function (x) { return x || 'Choose'; }) + '</select>', e.gender) +
      field('Address (city, state)', '<input name="address" value="' + esc(b.address || '') + '">', e.address) + '</div>' +
      '<div class="two">' + field('ID type', '<select name="idType">' + options(s.idTypes, b.idType) + '</select>', e.idType) +
      field('ID number', '<input name="idValue" value="' + esc(b.idValue) + '" ' + (s.idMode === 'full' ? '' : 'maxlength="4"') + ' autocomplete="off">', e.idValue, idHint) + '</div>' +
      '<p class="small">This is the main guest. Add everyone else, their ID photos, passports and visas on the booking page after saving (Guests & IDs).</p>' +
      '<div class="two">' + field('Adults', '<input name="adults" type="number" inputmode="numeric" min="0" value="' + esc(b.adults) + '">', e.adults) +
      field('Children', '<input name="children" type="number" inputmode="numeric" min="0" value="' + esc(b.children) + '">', e.children) + '</div></div>' +

      '<div class="card"><h3>Stay</h3>' +
      '<div class="two">' + field('Check-in', '<input name="checkIn" type="date" value="' + esc(b.checkIn) + '">', e.checkIn) +
      field('Check-out', '<input name="checkOut" type="date" value="' + esc(b.checkOut) + '">', e.checkOut) + '</div>' +
      '<div class="nights" id="nights"></div>' +
      '<div class="fld"><span>Rooms <small style="display:inline">— filled from the tariff × nights; type over it to change</small></span><div id="roomsBox"></div>' + (e.roomId ? '<em class="err">' + esc(e.roomId) + '</em>' : '') + '</div>' +
      '<div class="actions"><button type="button" class="btn sm" id="addRoom">＋ Add room</button><button type="button" class="btn sm" id="ratecard">Recalculate all from tariff</button></div>' +
      '<div class="two">' + field('Booking source', '<select name="source">' + options(s.sources, b.source) + '</select>') +
      field('Status', '<select name="status">' + options(A.STATUSES.concat(A.STATUSES.indexOf(b.status) < 0 ? [b.status] : []), b.status) + '</select>') + '</div>' +
      '<div id="overlap"></div></div>' +

      '<div class="card"><h3>Food & services (day by day)</h3>' +
      '<p class="small">Tick a meal to charge it: persons fill in from the guests on the booking and the price from your meal rates (More → Settings). Change any number by hand. Days with nothing on them are left off the bill.</p>' +
      '<div id="quickMeals" class="actions"></div><div id="daysBox"></div>' +
      '<details class="fld" id="wholeBox"' + ((b.charges || []).some(function (c) { return !(num(c.day) > 0); }) ? ' open' : '') + '><summary>Other charges for the whole stay (not day-wise)</summary><div id="chargesBox"></div><div class="actions"><button type="button" class="btn sm" id="addCharge">＋ Add charge</button></div></details>' +
      '</div>' +

      '<div class="card"><h3>Discount, commission & GST (₹)</h3>' +
      '<div class="two">' + field('Room charges (total)', '<input name="roomTotalView" readonly tabindex="-1" value="">', e.room, 'Sum of the room lines above.') +
      field('Food & services (total)', '<input name="extrasView" readonly tabindex="-1" value="">') + '</div>' +
      '<div class="two">' + field('Discount', '<input name="discount" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.discount) + '">', e.discount) +
      field('Platform commission', '<input name="commission" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.commission) + '">', e.commission, 'Your expense. Never added to or taken off the guest bill.') + '</div>' +
      couponFields(b, e) +
      '<label class="chk"><input type="checkbox" name="gstOn"' + (b.gstOn ? ' checked' : '') + '> Charge GST on this bill</label>' +
      '<div id="gstbox" class="three' + (b.gstOn ? '' : ' hide') + '">' +
      field('Room GST %', '<input name="gstRoomRate" type="number" inputmode="decimal" step="any" value="' + esc(b.gstRoomRate) + '">', '', 'Auto from the amount charged per room per night: up to ₹' + s.gstThreshold + ' → ' + s.gstRoomLow + '%, above → ' + s.gstRoomHigh + '%') +
      field('Food GST %', '<input name="gstFoodRate" type="number" inputmode="decimal" step="any" value="' + esc(b.gstFoodRate) + '">') +
      field('Other GST %', '<input name="gstOtherRate" type="number" inputmode="decimal" step="any" value="' + esc(b.gstOtherRate) + '">') + '</div>' +
      '<div id="cancelbox" class="' + (b.status === 'Cancelled' ? '' : 'hide') + '"><div class="two">' +
      field('Cancellation fee kept', '<input name="cancelFee" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.cancelFee) + '">', e.cancelFee, '0 if fully refunded.') +
      field('Commission on fee', '<input name="cancelCommission" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.cancelCommission) + '">', e.cancelCommission) + '</div></div>' +
      '<div class="calcbox" id="calcbox"></div></div>' +

      (formState.isNew ? '<div class="card"><h3>Payments received now</h3><div id="paysBox"></div><div class="actions"><button type="button" class="btn sm" id="addPay">＋ Add payment</button></div><p class="small">Add one line per payment, e.g. advance by UPI and balance in cash. Lines left without an amount are ignored. Later payments: Record payment on the booking page.</p></div>' : '') +
      ((s.customFields || []).filter(function (x) { return x.label; }).length ? '<div class="card"><h3>More details</h3>' + s.customFields.filter(function (x) { return x.label; }).map(function (cf) {
        return field(esc(cf.label), '<input data-cf="' + esc(cf.id) + '" value="' + esc((b.custom || {})[cf.id] || '') + '">');
      }).join('') + '</div>' : '') +

      '<div class="card"><h3>Notes</h3>' +
      field('Special requests', '<textarea name="specialRequests" rows="2">' + esc(b.specialRequests) + '</textarea>') +
      '<details class="fld"><summary>Bill to a company (for GST invoice)</summary><div class="two">' + field('Company name', '<input name="billTo" value="' + esc(b.billTo || '') + '">') + field('Company GSTIN', '<input name="billGstin" value="' + esc(b.billGstin || '') + '" autocapitalize="characters" maxlength="15">') + '</div></details>' +
      field('Internal notes (not on bill)', '<textarea name="notes" rows="2">' + esc(b.notes) + '</textarea>') + '</div>' +
      '<div class="errsum" id="errsum"></div>' +
      '<button class="btn primary big" type="submit">Save booking</button>' +
      (formState.isNew ? '' : '<button class="btn danger" type="button" id="del">Delete booking</button>') +
      '</form>';
    return { title: title, html: html, back: '#/bookings', tab: 'bookings', after: bindForm };
  }
  function couponSel(b) { return !b.couponType ? '' : b.couponType === 'amt' ? 'amt' : ([5, 10, 15].indexOf(num(b.couponValue)) >= 0 ? String(num(b.couponValue)) : 'pct'); }
  function couponFields(b, e) {
    var sel = couponSel(b);
    return '<div class="two">' + field('Coupon', '<select name="couponSel">' + options([{ id: '', name: 'No coupon' }, { id: '5', name: '5% off' }, { id: '10', name: '10% off' }, { id: '15', name: '15% off' }, { id: 'pct', name: 'Custom %' }, { id: 'amt', name: 'Custom ₹ amount' }], sel) + '</select>', '', 'Taken off before GST. Applies after any discount.') +
      field('Coupon code', '<input name="couponCode" value="' + esc(b.couponCode) + '" placeholder="Made automatically" autocapitalize="characters">') + '</div>' +
      '<div id="couponCustom" class="' + (sel === 'pct' || sel === 'amt' ? '' : 'hide') + '">' + field(sel === 'amt' ? 'Coupon amount ₹' : 'Coupon %', '<input name="couponValue" type="number" inputmode="decimal" min="0" step="any" value="' + esc(sel === 'pct' || sel === 'amt' ? b.couponValue : '') + '">', e && e.couponValue) + '</div>';
  }
  function readCoupon(f, b) {
    var sel = f.elements.couponSel ? f.elements.couponSel.value : '';
    if (!sel) { b.couponType = ''; b.couponValue = ''; b.couponCode = ''; return; }
    if (sel === 'amt') { b.couponType = 'amt'; b.couponValue = f.elements.couponValue.value; }
    else if (sel === 'pct') { b.couponType = 'pct'; b.couponValue = f.elements.couponValue.value; }
    else { b.couponType = 'pct'; b.couponValue = sel; }
    b.couponCode = String(f.elements.couponCode.value || '').trim().toUpperCase() || A.couponCode(S().couponPrefix, b.couponValue, b.couponType);
    if (f.elements.couponCode.value !== b.couponCode) f.elements.couponCode.value = b.couponCode;
  }
  /* Guest 1 always mirrors the main guest on the booking form. */
  function syncPrimaryGuest(b) {
    if (!b.guests || !b.guests.length) A.migrateGuests(b);
    var g = b.guests.filter(function (x) { return x.primary; })[0] || b.guests[0];
    g.primary = true; g.name = b.guestName; g.phone = b.phone; g.email = b.email; g.nationality = b.nationality; g.country = b.country;
    g.idType = b.idType; g.idNumber = b.idValue; if (b.gender) g.gender = b.gender; if (b.address) g.address = b.address;
  }
  function guestCount(b) { return Math.max(1, Math.round(num(b.adults)) + Math.round(num(b.children))); }
  function mealRate(m) { return num((S().mealRates || {})[m]); }
  function serviceRate(name) { var x = (S().services || []).filter(function (v) { return v.name === name; })[0]; return x ? num(x.rate) : 0; }
  function readForm() {
    var f = $('#bf'), b = formState.b;
    ['guestName', 'phone', 'email', 'nationality', 'country', 'idType', 'idValue', 'adults', 'children', 'checkIn', 'checkOut', 'source', 'status',
      'discount', 'commission', 'gstRoomRate', 'gstFoodRate', 'gstOtherRate', 'specialRequests', 'notes', 'cancelFee', 'cancelCommission', 'billTo', 'billGstin', 'gender', 'address']
      .forEach(function (k) { if (f.elements[k]) b[k] = f.elements[k].value; });
    b.gstOn = f.elements.gstOn.checked;
    var lines = $$('#roomsBox .roomline', f);
    b.rooms = lines.map(function (ln, i) {
      var old = (b.rooms || [])[i] || {};
      return { roomId: $('[data-rk="roomId"]', ln).value, charge: $('[data-rk="charge"]', ln).value, gstRate: old.gstRate, auto: old.auto };
    });
    b.room = A.roomTotal(b); b.roomId = (b.rooms.filter(function (r) { return r.roomId; })[0] || {}).roomId || '';
    /* Food & service lines live in formState.b.charges; inputs write into them directly (see bindForm). */
    A.applyCharges(b);
    b.custom = b.custom || {}; $$('[data-cf]', f).forEach(function (el) { b.custom[el.dataset.cf] = el.value.trim(); });
    formState.pays = $$('#paysBox .payline', f).map(function (ln) { return { amount: $('[data-pk="amount"]', ln).value, method: $('[data-pk="method"]', ln).value, date: $('[data-pk="date"]', ln).value, ref: $('[data-pk="ref"]', ln).value.trim() }; });
    readCoupon(f, b);
    b.guestName = String(b.guestName || '').trim(); b.phone = String(b.phone || '').trim(); b.email = String(b.email || '').trim();
    if (S().idMode !== 'full') b.idValue = String(b.idValue).replace(/\s/g, '').slice(-4);
    return b;
  }
  function bindForm() {
    var f = $('#bf');
    function roomOpts(sel) {
      var b = formState.b, list = S().rooms.filter(function (r) { return r.active !== false || A.roomIds(b).indexOf(r.id) >= 0; });
      return '<option value="">— Room not decided —</option>' + options(list, sel);
    }
    /* Auto price for one room: tariff (or season rate) for every night of the stay. */
    function autoCharge(r, b) { return r.roomId && A.nights(b.checkIn, b.checkOut) > 0 ? A.rateCardTotal(S(), r.roomId, b.checkIn, b.checkOut) : 0; }
    function roomHint(r, b) {
      var n = A.nights(b.checkIn, b.checkOut), room = S().rooms.filter(function (x) { return x.id === r.roomId; })[0];
      if (!r.roomId) return 'Choose a room to price it.';
      if (n < 1) return 'Choose check-in and check-out to price it.';
      var v = autoCharge(r, b);
      if (!v) return 'No tariff set for ' + (room ? room.name : 'this room') + ' (More → Settings → Rooms). Type the amount.';
      var flat = room && num(room.tariff) * n === v;
      var calc = flat ? inr(room.tariff) + ' × ' + n + ' night' + (n > 1 ? 's' : '') + ' = ' + inr(v) : 'Tariff with season rates, ' + n + ' night' + (n > 1 ? 's' : '') + ' = ' + inr(v);
      return calc + (r.auto === false && r2(r.charge) !== v ? ' · <button type="button" class="linkbtn" data-recalc="' + '__I__' + '">Use ' + inr(v) + '</button>' : '');
    }
    function drawRooms() {
      var b = formState.b;
      if (!b.rooms.length) b.rooms.push({ roomId: '', charge: '', auto: true });
      $('#roomsBox').innerHTML = b.rooms.map(function (r, i) {
        return '<div class="roomline"><select data-rk="roomId" aria-label="Room ' + (i + 1) + '">' + roomOpts(r.roomId) + '</select>' +
          '<input data-rk="charge" type="number" inputmode="decimal" min="0" step="any" placeholder="₹ whole stay" value="' + esc(r.charge) + '" aria-label="Charge for room ' + (i + 1) + '">' +
          (b.rooms.length > 1 ? '<button type="button" class="x" data-rmroom="' + i + '" aria-label="Remove room">✕</button>' : '<span></span>') +
          '<small class="rhint" data-rh="' + i + '"></small></div>';
      }).join('');
      $$('[data-rmroom]').forEach(function (x) { x.onclick = function () { readForm(); formState.b.rooms.splice(+x.dataset.rmroom, 1); drawRooms(); refresh('rooms'); }; });
      $$('#roomsBox [data-rk="charge"]').forEach(function (el, i) { el.addEventListener('input', function () { formState.b.rooms[i].auto = false; }); });
      $$('#roomsBox [data-rk="roomId"]').forEach(function (el, i) { el.addEventListener('change', function () { formState.b.rooms[i].auto = formState.b.rooms[i].auto !== false || !formState.b.rooms[i].charge; }); });
    }
    /* Re-price auto lines when dates or rooms change; show the sum on each line. */
    function priceRooms() {
      var b = formState.b;
      $$('#roomsBox .roomline').forEach(function (ln, i) {
        var r = b.rooms[i]; if (!r) return;
        if (r.auto !== false) { var v = autoCharge(r, b); if (v) { r.charge = v; $('[data-rk="charge"]', ln).value = v; } }
        var h = $('[data-rh="' + i + '"]', ln); if (h) h.innerHTML = roomHint(r, b).replace('__I__', i);
      });
      $$('[data-recalc]').forEach(function (x) { x.onclick = function () { var i = +x.dataset.recalc; readForm(); formState.b.rooms[i].auto = true; refresh('rooms'); }; });
      b.room = A.roomTotal(b);
    }

    /* ---- food (Breakfast / Lunch / Dinner per day) and services per day ---- */
    function lineFor(day, meal) { return (formState.b.charges || []).filter(function (c) { return c.type === 'Food' && !c.kind && num(c.day) === day && c.meal === meal; })[0]; }
    function dayLines(day) { return (formState.b.charges || []).filter(function (c) { return num(c.day) === day; }); }
    function dayTotal(day) { return A.sum(dayLines(day), function (c) { return c.amount; }); }
    function fmtDay(d) { var x = A.dayDate(formState.b, d); return 'Day ' + d + (x ? ' · ' + A.fmtLong(x) : ''); }
    function svcOpts(sel) { var list = (S().services || []).map(function (v) { return v.name; }).filter(Boolean); if (sel && list.indexOf(sel) < 0) list.push(sel); return options(list.concat(['__other']), sel || '', function (x) { return x === '__other' ? 'Other (type the name)…' : x; }); }
    var openDays = {};
    function drawDays() {
      var b = formState.b, D = A.stayDays(b);
      b.charges = b.charges || [];
      /* lines for days that are no longer in the stay */
      var gone = b.charges.filter(function (c) { return num(c.day) > D; });
      if (gone.length) { b.charges = b.charges.filter(function (c) { return !(num(c.day) > D); }); toast(gone.length + ' food/service line' + (gone.length > 1 ? 's' : '') + ' removed: the stay is now ' + (D ? D + ' days' : 'without dates'), true); }
      $('#quickMeals').innerHTML = D ? '<span class="small" style="align-self:center">Tick for every day:</span>' + A.MEALS.map(function (m) { return '<button type="button" class="btn sm" data-allmeal="' + m + '">' + m + '</button>'; }).join('') : '';
      if (!D) { $('#daysBox').innerHTML = '<p class="small">Choose check-in and check-out to get day-wise food and services.</p>'; }
      else {
        var html = '';
        for (var d = 1; d <= D; d++) {
          var tot = dayTotal(d);
          html += '<details class="day" data-day="' + d + '"' + (openDays[d] ? ' open' : '') + '><summary><span>' + esc(fmtDay(d)) + '</span><b data-dtot="' + d + '">' + (tot ? inr(tot) : '—') + '</b></summary>';
          html += A.MEALS.map(function (m) {
            var c = lineFor(d, m), rate = mealRate(m);
            return '<div class="meal"><label class="chk"><input type="checkbox" data-meal="' + m + '" data-d="' + d + '"' + (c ? ' checked' : '') + '> ' + m + '</label>' +
              '<input type="number" inputmode="numeric" min="0" data-mq="' + m + '" data-d="' + d + '" value="' + (c ? esc(c.qty) : '') + '" placeholder="persons" aria-label="' + m + ' persons, day ' + d + '"' + (c ? '' : ' disabled') + '>' +
              '<input type="number" inputmode="decimal" min="0" step="any" data-ma="' + m + '" data-d="' + d + '" value="' + (c ? esc(c.amount) : '') + '" placeholder="₹" aria-label="' + m + ' amount, day ' + d + '"' + (c ? '' : ' disabled') + '>' +
              '<small>' + (rate ? '@ ' + inr(rate) + '/person' : 'Set the rate in Settings') + '</small></div>';
          }).join('');
          var items = (b.charges || []).filter(function (c) { return c.kind === 'item' && num(c.day) === d; });
          if (items.length) html += '<div class="fsnote' + (items.some(function (c) { return (c.flags || []).length; }) ? ' bad' : '') + '">Menu items / bill: ' + items.length + ' line' + (items.length > 1 ? 's' : '') + ', ' + inr(A.sum(items, function (c) { return c.amount; })) + ' — edit them on the Food & services page after saving.</div>';
          var sv = (b.charges || []).map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return x.c.type !== 'Food' && !x.c.kind && num(x.c.day) === d; });
          html += sv.map(function (x) {
            var known = (S().services || []).some(function (v) { return v.name === x.c.name; });
            var sel = x.c.custom || (!known && x.c.name) ? '__other' : (x.c.name || ((S().services || [])[0] || {}).name || '__other');
            return '<div class="svc"><select data-sn="' + x.i + '" aria-label="Service">' + svcOpts(sel) + '</select>' +
              '<input data-sq="' + x.i + '" type="number" inputmode="numeric" min="0" value="' + esc(x.c.qty) + '" placeholder="qty" aria-label="Quantity">' +
              '<input data-sa="' + x.i + '" type="number" inputmode="decimal" min="0" step="any" value="' + esc(x.c.amount) + '" placeholder="₹" aria-label="Amount">' +
              '<button type="button" class="x" data-rmsvc="' + x.i + '" aria-label="Remove service">−</button>' +
              (sel === '__other' ? '<input data-sx="' + x.i + '" value="' + esc(x.c.name || '') + '" placeholder="What for, e.g. guided trek" aria-label="Service name">' : '') + '</div>';
          }).join('');
          html += '<div class="actions"><button type="button" class="btn sm" data-addsvc="' + d + '">＋ Service on day ' + d + '</button></div></details>';
        }
        $('#daysBox').innerHTML = html;
      }
      bindDays();
    }
    function setLineAmount(c) { if (!c.amtManual) c.amount = r2(num(c.qty) * num(c.rate)); }
    function dayTotals() { $$('[data-dtot]').forEach(function (el) { var t = dayTotal(+el.dataset.dtot); el.textContent = t ? inr(t) : '—'; }); }
    function bindDays() {
      var b = formState.b;
      $$('#daysBox details.day').forEach(function (dt) { dt.addEventListener('toggle', function () { openDays[dt.dataset.day] = dt.open; }); });
      $$('[data-meal]').forEach(function (el) {
        el.onchange = function () {
          var d = +el.dataset.d, m = el.dataset.meal, c = lineFor(d, m);
          if (el.checked && !c) { c = { type: 'Food', day: d, meal: m, name: m, qty: guestCount(readForm()), rate: mealRate(m), amount: 0, qtyAuto: true }; setLineAmount(c); b.charges.push(c); }
          if (!el.checked && c) b.charges.splice(b.charges.indexOf(c), 1);
          openDays[d] = true; drawDays(); refresh('charges');
        };
      });
      $$('[data-mq]').forEach(function (el) { el.oninput = function () { var c = lineFor(+el.dataset.d, el.dataset.mq); if (!c) return; c.qty = el.value; c.qtyAuto = false; setLineAmount(c); var a = $('[data-ma="' + el.dataset.mq + '"][data-d="' + el.dataset.d + '"]'); if (a) a.value = c.amount; dayTotals(); refresh('charges'); }; });
      $$('[data-ma]').forEach(function (el) { el.oninput = function () { var c = lineFor(+el.dataset.d, el.dataset.ma); if (!c) return; c.amount = el.value; c.amtManual = true; dayTotals(); refresh('charges'); }; });
      $$('[data-allmeal]').forEach(function (btn) {
        btn.onclick = function () {
          var m = btn.dataset.allmeal, D = A.stayDays(readForm()), n = guestCount(b);
          for (var d = 1; d <= D; d++) if (!lineFor(d, m)) { var c = { type: 'Food', day: d, meal: m, name: m, qty: n, rate: mealRate(m), amount: 0, qtyAuto: true }; setLineAmount(c); b.charges.push(c); }
          drawDays(); refresh('charges'); toast(m + ' ticked for all ' + D + ' days');
        };
      });
      $$('[data-addsvc]').forEach(function (btn) {
        btn.onclick = function () {
          var d = +btn.dataset.addsvc, first = (S().services || []).filter(function (v) { return v.name; })[0];
          var c = first ? { type: 'Other', day: d, name: first.name, qty: 1, rate: num(first.rate), amount: num(first.rate) } : { type: 'Other', day: d, name: '', custom: true, qty: 1, rate: 0, amount: '' };
          b.charges.push(c); openDays[d] = true; drawDays(); refresh('charges');
        };
      });
      $$('[data-sn]').forEach(function (el) {
        el.onchange = function () {
          var c = b.charges[+el.dataset.sn]; if (!c) return;
          if (el.value === '__other') { c.custom = true; c.name = ''; }
          else { c.custom = false; c.name = el.value; c.rate = serviceRate(el.value); c.amtManual = false; setLineAmount(c); }
          drawDays(); refresh('charges');
        };
      });
      $$('[data-sx]').forEach(function (el) { el.oninput = function () { var c = b.charges[+el.dataset.sx]; if (c) c.name = el.value.trim(); }; });
      $$('[data-sq]').forEach(function (el) { el.oninput = function () { var c = b.charges[+el.dataset.sq]; if (!c) return; c.qty = el.value; if (num(c.rate)) { setLineAmount(c); var a = $('[data-sa="' + el.dataset.sq + '"]'); if (a) a.value = c.amount; } dayTotals(); refresh('charges'); }; });
      $$('[data-sa]').forEach(function (el) { el.oninput = function () { var c = b.charges[+el.dataset.sa]; if (!c) return; c.amount = el.value; c.amtManual = true; dayTotals(); refresh('charges'); }; });
      $$('[data-rmsvc]').forEach(function (x) { x.onclick = function () { b.charges.splice(+x.dataset.rmsvc, 1); drawDays(); refresh('charges'); }; });
    }
    /* Older-style lines (no day): kept for whole-stay extras and for bookings made before version 1.7. */
    function drawCharges() {
      var b = formState.b;
      var list = (b.charges || []).map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return !(num(x.c.day) > 0) && !x.c.kind; });
      $('#chargesBox').innerHTML = list.map(function (x) {
        var c = x.c, i = x.i;
        return '<div class="chargeline"><select data-ck="type" data-ci="' + i + '" aria-label="Type">' + options([{ id: 'Food', name: 'Food' }, { id: 'Other', name: 'Other' }], c.type || 'Other') + '</select>' +
          '<input data-ck="name" data-ci="' + i + '" value="' + esc(c.name || '') + '" placeholder="' + (c.type === 'Food' ? 'Food & beverages' : 'Bonfire, pick-up…') + '" aria-label="What for">' +
          '<input data-ck="amount" data-ci="' + i + '" type="number" inputmode="decimal" min="0" step="any" value="' + esc(c.amount) + '" placeholder="₹" aria-label="Amount">' +
          '<button type="button" class="x" data-rmcharge="' + i + '" aria-label="Remove line">−</button></div>';
      }).join('') || '<p class="small">None.</p>';
      $$('[data-ck]').forEach(function (el) {
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () { var c = formState.b.charges[+el.dataset.ci]; if (!c) return; c[el.dataset.ck] = el.dataset.ck === 'name' ? el.value.trim() : el.value; refresh('charges'); });
      });
      $$('[data-rmcharge]').forEach(function (x) { x.onclick = function () { formState.b.charges.splice(+x.dataset.rmcharge, 1); drawCharges(); refresh('charges'); }; });
    }
    $('#addCharge').onclick = function () { formState.b.charges.push({ type: 'Other', name: '', amount: '' }); drawCharges(); var ls = $$('#chargesBox [data-ck="name"]'); if (ls.length) ls[ls.length - 1].focus(); };
    drawCharges();
    function drawPays() {
      var box = $('#paysBox'); if (!box) return;
      formState.pays = formState.pays || [];
      box.innerHTML = formState.pays.map(function (p, i) {
        return '<div class="payline"><input data-pk="amount" type="number" inputmode="decimal" min="0" step="any" value="' + esc(p.amount) + '" placeholder="₹ amount" aria-label="Amount">' +
          '<select data-pk="method" aria-label="Method">' + options(A.METHODS.filter(function (m) { return m !== 'Not recorded'; }), p.method || 'UPI') + '</select>' +
          '<input data-pk="date" type="date" value="' + esc(p.date || today()) + '" aria-label="Date">' +
          '<input data-pk="ref" value="' + esc(p.ref || '') + '" placeholder="UPI / card ref" aria-label="Reference">' +
          '<button type="button" class="x" data-rmpay="' + i + '" aria-label="Remove payment">−</button></div>';
      }).join('');
      $$('[data-rmpay]').forEach(function (x) { x.onclick = function () { readForm(); formState.pays.splice(+x.dataset.rmpay, 1); drawPays(); }; });
    }
    var ap = $('#addPay'); if (ap) ap.onclick = function () { readForm(); formState.pays.push({ amount: '', method: 'UPI', date: today(), ref: '' }); drawPays(); };
    drawPays();
    function freeIds(b) { return A.activeRooms(S()).map(function (r) { return r.id; }).filter(function (id) { return A.roomIds(b).indexOf(id) < 0; }); }
    $('#addRoom').onclick = function () {
      var b = readForm(), free = freeIds(b);
      if (!free.length) return toast('Every room is already on this booking.', true);
      b.rooms.push({ roomId: free[0], charge: '', auto: true }); drawRooms(); refresh('rooms');
    };
    drawRooms();
    var lastDays = null, lastGuests = null;
    function refresh(changedName) {
      var b = readForm(), s = S();
      priceRooms();
      var D = A.stayDays(b);
      if (D !== lastDays) { lastDays = D; drawDays(); }
      /* guests changed: meal lines that still use the guest count follow it */
      var gc = guestCount(b);
      if (lastGuests !== null && gc !== lastGuests) { (b.charges || []).forEach(function (c) { if (c.type === 'Food' && c.qtyAuto) { c.qty = gc; setLineAmount(c); } }); drawDays(); }
      lastGuests = gc;
      A.applyCharges(b);
      f.elements.roomTotalView.value = inr(A.roomTotal(b)) + (A.stayLabel(b) ? ' (' + A.stayLabel(b) + ')' : '');
      f.elements.extrasView.value = inr(r2(num(b.food) + num(b.additional)));
      if (changedName === 'gstRoomRate') b.gstRateManual = true;
      if (b.gstOn && !b.gstRateManual && changedName !== 'gstRoomRate') {
        var rates = A.autoRoomRates(b, s);
        b.rooms.forEach(function (r) { r.gstRate = rates[r.roomId]; });
        var auto = A.autoRoomGstRate(b, s);
        b.gstRoomRate = auto; f.elements.gstRoomRate.value = auto;
        var mixed = b.rooms.some(function (r) { return r.gstRate !== b.rooms[0].gstRate; });
        var hint = $('#gstbox .fld small');
        if (hint) hint.textContent = mixed ? 'Per room: ' + b.rooms.filter(function (r) { return r.roomId; }).map(function (r) { return roomName(r.roomId) + ' ' + r.gstRate + '%'; }).join(', ') : 'Auto: ≤ ₹' + s.gstThreshold + '/night per room → ' + s.gstRoomLow + '%, above → ' + s.gstRoomHigh + '%';
      }
      if (b.gstRateManual) b.rooms.forEach(function (r) { delete r.gstRate; });
      if (changedName === 'gstRoomRate') b.gstRateManual = true;
      $('#gstbox').classList.toggle('hide', !b.gstOn);
      $('#cancelbox').classList.toggle('hide', b.status !== 'Cancelled');
      var cs = f.elements.couponSel.value; $('#couponCustom').classList.toggle('hide', cs !== 'pct' && cs !== 'amt');
      if (changedName === 'couponSel') { var lab = $('#couponCustom .fld > span'); if (lab) lab.textContent = cs === 'amt' ? 'Coupon amount ₹' : 'Coupon %'; if (!cs) f.elements.couponCode.value = ''; }
      var n = A.nights(b.checkIn, b.checkOut);
      $('#nights').textContent = n > 0 ? A.stayLabel(b) + ' · ' + (n + 1) + ' days, ' + n + ' night' + (n > 1 ? 's' : '') : (A.isDate(b.checkIn) && A.isDate(b.checkOut) ? 'Check-out must be after check-in' : 'Dates not set yet');
      var c = calc(b);
      $('#calcbox').innerHTML = (b.status === 'Cancelled' ? row('Cancellation fee', inr(c.cancelFee)) : billRows(b, c)) +
        row('Total bill', inr(c.total), 'strong') +
        row('Commission (your expense)', inr(c.commission), 'muted') + row('Net after commission (excl. GST)', inr(c.net), 'muted');
      var ov = A.overlaps(data.bookings, b, S());
      /* Only redraw the warning when its text changes: redrawing while the guest taps the box (a blur on another field
         fires "change") destroyed the checkbox under the finger, so the tick never landed. */
      var ovMsg = ov.length && b.status !== 'Cancelled' ? esc(roomsLabel(b)) + ' is already taken by ' + ov.map(function (o) { return esc(gname(o)) + ' (' + esc(roomsLabel(o)) + ', ' + fmtShort(o.checkIn) + '–' + fmtShort(o.checkOut) + ', ' + esc(o.status) + ')'; }).join('; ') : '';
      var ovBox = $('#overlap');
      if (ovBox.dataset.msg !== ovMsg) {
        var wasTicked = (($('#override') || {}).checked);
        ovBox.dataset.msg = ovMsg;
        ovBox.innerHTML = ovMsg ? '<div class="warn"><b>Double-booking warning.</b> ' + ovMsg + '.<label class="chk ovr"><input type="checkbox" id="override"' + (wasTicked ? ' checked' : '') + '> I understand — save anyway (override)</label></div>' : '';
      }
    }
    f.addEventListener('input', function (ev) { if (ev.target.id !== 'override' && !ev.target.closest('#daysBox') && !ev.target.closest('#chargesBox')) refresh(ev.target.name); });
    f.addEventListener('change', function (ev) { if (ev.target.id !== 'override' && !ev.target.closest('#daysBox') && !ev.target.closest('#chargesBox')) refresh(ev.target.name); });
    $('#ratecard').onclick = function () {
      var b = readForm(), missing = [];
      b.rooms.forEach(function (r) { if (!r.roomId) return; var v = autoCharge(r, b); r.auto = true; if (!v) missing.push(roomName(r.roomId)); });
      refresh('rooms');
      toast(A.nights(b.checkIn, b.checkOut) < 1 ? 'Choose check-in and check-out first.' : missing.length ? 'No tariff set for ' + missing.join(', ') + ' (Settings → Rooms)' : 'Room charges from tariff: ' + inr(A.roomTotal(b)), !!missing.length || A.nights(b.checkIn, b.checkOut) < 1);
    };
    refresh();
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var b = readForm(), errs = A.validateBooking(b, S());
      var ov = A.overlaps(data.bookings, b, S());
      if (ov.length && b.status !== 'Cancelled' && !(($('#override') || {}).checked) && A.isActive(b)) errs.override = 'Room already booked for these dates. Tick the override box to save anyway.';
      formState.errors = errs;
      var keys = Object.keys(errs);
      $$('.err', f).forEach(function (x) { x.remove(); });
      keys.forEach(function (k) {
        var el = f.elements[k];
        var box = el && el.closest && el.closest('.fld');
        if (box) { var em = document.createElement('em'); em.className = 'err'; em.textContent = errs[k]; box.appendChild(em); }
      });
      if (keys.length) {
        $('#errsum').innerHTML = '<div class="warn">Please fix: ' + keys.map(function (k) { return esc(errs[k]); }).join(' ') + '</div>';
        var first = f.elements[keys[0]]; if (keys[0] !== 'override' && first && first.focus) first.focus(); else (keys[0] === 'override' ? $('#overlap') : $('#errsum')).scrollIntoView({ block: 'center' });
        return;
      }
      ['adults', 'children'].forEach(function (k) { b[k] = Math.max(0, Math.round(num(b[k]))); });
      /* keep only food / service lines with something on them */
      b.charges = (b.charges || []).filter(function (c) { return num(c.day) > 0 || num(c.amount) || String(c.name || '').trim(); })
        .map(function (c) { var o = JSON.parse(JSON.stringify(c)); o.amount = r2(o.amount); if (o.qty !== undefined && o.qty !== '') o.qty = r2(o.qty); if (o.rate !== undefined) o.rate = r2(o.rate); if (o.type !== 'Food' && !String(o.name || '').trim()) o.name = 'Other services'; return o; });
      A.applyCharges(b);
      ['room', 'food', 'additional', 'discount', 'commission', 'gstRoomRate', 'gstFoodRate', 'gstOtherRate', 'cancelFee', 'cancelCommission'].forEach(function (k) { b[k] = r2(b[k]); });
      if (b.couponType) b.couponValue = r2(b.couponValue);
      b.updatedAt = nowISO();
      if (b.status === 'Cancelled' && !b.cancelledOn) b.cancelledOn = today();
      if (b.status !== 'Cancelled') b.cancelledOn = '';
      b.rooms = b.rooms.filter(function (r) { return r.roomId; });
      b.rooms.forEach(function (r) { r.charge = r2(r.charge); if (r.auto !== true) delete r.auto; });
      b.room = A.roomTotal(b); b.roomId = (b.rooms[0] || {}).roomId || '';
      syncPrimaryGuest(b);
      var pays = (formState.pays || []).filter(function (p) { return num(p.amount) > 0; });
      if (formState.isNew) {
        b.id = uid(); b.createdAt = nowISO(); b.fbToken = token(); data.bookings.push(b);
        b.no = A.nextBookingNo(data, b.checkIn, S().bookingPrefix);
        if (b.queryId) { var lq = query(b.queryId); if (lq) { lq.status = 'Closed'; lq.outcome = 'Booked'; lq.bookingId = b.id; lq.closedAt = lq.closedAt || nowISO(); lq.updatedAt = nowISO(); } }
        pays.forEach(function (p) { data.payments.push({ id: uid(), bookingId: b.id, type: 'payment', amount: r2(p.amount), date: A.isDate(p.date) ? p.date : today(), method: p.method, ref: p.ref, createdAt: nowISO(), updatedAt: nowISO() }); });
      } else {
        var i = data.bookings.findIndex(function (x) { return x.id === b.id; });
        /* photos added or uploaded while this form was open stay on the booking */
        if (i >= 0) { A.keepDocs(b, data.bookings[i]); data.bookings[i] = b; } else data.bookings.push(b);
      }
      save().then(function () { toast('Booking saved' + (missingBits(b).length ? ' (still to add: ' + missingBits(b).join(', ') + ')' : '')); location.replace('#/guest/' + b.id); });
    };
    var del = $('#del');
    if (del) del.onclick = function () { deleteBooking(formState.b.id); };
  }
  function fsCard(b, c) {
    var BL = A.billLines(b), nf = A.flaggedLines(b).length + (b.bills || []).filter(function (x) { return (x.flags || []).length; }).length;
    return '<div class="card' + (nf ? ' alertcard' : '') + '"><h3>Food & services</h3>' + (nf ? '<p class="small" style="color:var(--red)">' + nf + ' item' + (nf > 1 ? 's' : '') + ' from a bill photo to check</p>' : '') +
      (BL.food.length || BL.other.length ? row('Food', inr(c.food)) + row('Services', inr(c.additional)) + (num(c.extrasDiscount) ? row('Food & services discount', '−' + inr(c.extrasDiscount)) : '') : '<p class="small">Nothing yet. Add items by hand or from a photo of the bill.</p>') +
      '<div class="actions"><a class="btn primary" href="#/fs/' + b.id + '">Open food & services</a><a class="btn" href="#/bill/' + b.id + '/statement">Statement for guest</a></div></div>';
  }
  /* Bill rows used on the form and the booking page: rooms with 4D/3N, food per day, services per head and day. */
  function billRows(b, c) {
    var st = A.stayLabel(b), BL = A.billLines(b), out = '';
    if (c.roomParts && c.roomParts.length > 1) out += c.roomParts.map(function (p) { return row('Room — ' + roomName(p.roomId) + (st ? ' (' + st + ')' : ''), inr(p.charge)); }).join('');
    else out += row('Room charges' + (st ? ' (' + st + ')' : ''), inr(c.room));
    out += row('Food charges', inr(c.food)) + BL.food.map(function (x) { return row(x.name + (x.date ? ' · ' + fmtShort(x.date) : ''), inr(x.amount), 'sub'); }).join('');
    out += row('Additional', inr(c.additional)) + BL.other.map(function (x) { return row(x.name + (x.date ? ' · ' + fmtShort(x.date) : ''), inr(x.amount), 'sub'); }).join('');
    out += row('Discount', '−' + inr(r2(c.discount - num(c.extrasDiscount)))) + (num(c.extrasDiscount) ? row('Food & services discount', '−' + inr(c.extrasDiscount)) : '') + (c.coupon ? row('Coupon ' + c.couponLabel, '−' + inr(c.coupon)) : '');
    out += row('Taxable value', inr(c.taxable));
    if (b.gstOn) out += gstByRate(c).map(function (x) { return row('GST rooms @ ' + x.rate + '%', inr(x.gst)); }).join('') + (c.gstFood ? row('GST food @ ' + b.gstFoodRate + '%', inr(c.gstFood)) : '') + (c.gstOther ? row('GST other @ ' + b.gstOtherRate + '%', inr(c.gstOther)) : '');
    return out;
  }
  function deleteBooking(id) {
    var b = booking(id);
    var np = data.payments.filter(function (p) { return p.bookingId === id; }).length;
    if (!confirm('Delete the booking for ' + b.guestName + '?' + (np ? ' Its ' + np + ' payment record(s) will be deleted too.' : '') + ' This cannot be undone. (Tip: use status "Cancelled" instead if you want to keep a record.)')) return;
    data.bookings = data.bookings.filter(function (x) { return x.id !== id; });
    data.payments = data.payments.filter(function (p) { return p.bookingId !== id; });
    save().then(function () { toast('Booking deleted'); location.replace('#/bookings'); });
  }

  /* ---------- GUEST RECORDS (search all bookings) ---------- */
  var listFilter = { q: '', status: 'All', source: 'All' };
  routes.bookings = function () {
    var s = S();
    var html = '<div class="searchbar"><input id="q" type="search" placeholder="Search name, phone, room, platform, date…" value="' + esc(listFilter.q) + '"></div>' +
      '<div class="chips" id="stchips">' + ['All'].concat(A.STATUSES).map(function (x) { return '<button class="chip' + (listFilter.status === x ? ' on' : '') + '" data-v="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' +
      '<select id="srcf" class="inline">' + options(['All'].concat(s.sources), listFilter.source, function (x) { return x === 'All' ? 'All platforms' : x; }) + '</select>' +
      '<a class="cta small" href="#/new">＋ Add New Booking</a><div id="list"></div>';
    return {
      title: 'Guest records', html: html, tab: 'bookings', after: function () {
        function draw() {
          var q = listFilter.q.toLowerCase().trim();
          var list = data.bookings.filter(function (b) {
            if (listFilter.status !== 'All' && b.status !== listFilter.status) return false;
            if (listFilter.source !== 'All' && b.source !== listFilter.source) return false;
            if (!q) return true;
            var hay = [b.no, b.guestName, b.phone, roomsLabel(b), b.source, A.guestsOf(b).map(function (g) { return g.name + ' ' + (g.idNumber || '') + ' ' + (g.passportNo || ''); }).join(' '), b.checkIn, b.checkOut, fmtDate(b.checkIn), b.country, b.notes].join(' ').toLowerCase();
            return hay.indexOf(q) >= 0;
          }).sort(function (a, b) { return a.checkIn < b.checkIn ? 1 : -1; });
          $('#list').innerHTML = '<div class="count">' + list.length + ' booking' + (list.length === 1 ? '' : 's') + '</div>' +
            (list.length ? list.map(function (b) { return bookingCard(b, { phone: true }); }).join('') : empty(data.bookings.length ? 'No bookings match your search.' : 'No bookings yet. Add your first one.', '<a class="btn primary" href="#/new">Add booking</a>'));
        }
        $('#q').oninput = function () { listFilter.q = this.value; draw(); };
        $('#srcf').onchange = function () { listFilter.source = this.value; draw(); };
        $$('#stchips .chip').forEach(function (c) { c.onclick = function () { listFilter.status = c.dataset.v; $$('#stchips .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); draw(); }; });
        draw();
      }
    };
  };

  /* ---------- GUEST DETAILS ---------- */
  routes.guest = function (id) {
    var b = booking(id);
    if (!b) return { title: 'Not found', html: empty('This booking no longer exists.'), back: '#/bookings', tab: 'bookings' };
    var c = calc(b), s = S(), t = today();
    var pays = A.paymentsFor(b, data.payments).sort(function (x, y) { return x.date < y.date ? -1 : 1; });
    var flag = A.paymentFlags(b, c, t);
    var actions = '';
    if (b.status === 'Confirmed') actions += '<button class="btn primary" data-st="Checked In">Check in</button>';
    if (b.status === 'Checked In') actions += '<button class="btn primary" data-st="Checked Out">Check out</button>';
    var msgs = whatsappTemplates(b, c);
    var html = '<div class="card hero"><div class="bk-top"><b class="name">' + esc(gname(b)) + '</b><span class="st ' + statusClass(b.status) + '">' + esc(b.status) + '</span></div>' +
      '<div class="bk-mid">' + esc(roomsLabel(b)) + ' · ' + (A.isDate(b.checkIn) ? fmtDate(b.checkIn) + ' → ' + fmtDate(b.checkOut) + (A.stayLabel(b) ? ' · ' + A.stayLabel(b) : '') : 'Dates not set') + '</div>' +
      '<div class="bk-mid">' + esc(b.no ? b.no + ' · ' : '') + esc(b.source) + ' · ' + b.adults + ' adult' + (b.adults == 1 ? '' : 's') + (num(b.children) ? ', ' + b.children + ' child' + (b.children == 1 ? '' : 'ren') : '') + '</div>' +
      (b.phone ? '<div class="bk-mid"><a href="tel:' + esc(b.phone) + '">☎ ' + esc(b.phone) + '</a></div>' : '') +
      '<div class="big3"><div><small>Total bill</small><b>' + inr(c.total) + '</b></div><div><small>Received</small><b>' + inr(c.received) + '</b></div><div><small>' + (c.outstanding < 0 ? 'Refund due' : 'Balance') + '</small><b class="' + (c.outstanding > 0 ? 'due' : '') + '">' + inr(Math.abs(c.outstanding)) + '</b></div></div>' +
      (flag ? '<div class="flag fl-' + flag + '">' + flagLabel(flag) + '</div>' : '') +
      (missingBits(b).length ? '<div class="flag fl-pending">Still to add: ' + esc(missingBits(b).join(', ')) + '</div>' : '') + '</div>' +
      '<div class="actions">' + actions + '<a class="btn" href="#/pay/' + b.id + '">Record payment</a><a class="btn" href="#/pay/' + b.id + '/refund">Record refund</a><a class="btn" href="#/edit/' + b.id + '">Edit</a></div>' +
      guestsCard(b) + fsCard(b, c) +
      '<div class="card"><h3>Bill breakdown</h3>' +
      (A.isCancelled(b) ? row('Cancellation fee kept', inr(c.cancelFee)) : billRows(b, c)) +
      row('Total bill', inr(c.total), 'strong') + row('Received (payments − refunds)', inr(c.received)) + row(c.outstanding < 0 ? 'Refund due to guest' : 'Outstanding balance', inr(Math.abs(c.outstanding)), 'strong') +
      '<hr>' + row('Platform commission (your expense)', inr(c.commission), 'muted') + row('Net revenue after commission', inr(c.net), 'muted') + '</div>' +
      '<div class="card"><h3>Payments</h3>' + (pays.length ? pays.map(function (p) {
        return '<div class="pay"><div><b>' + (p.type === 'refund' ? '−' : '') + inr(p.amount) + '</b> ' + esc(p.method) + (p.type === 'refund' ? ' <span class="tag">refund</span>' : '') + '<br><small>' + fmtDate(p.date) + (p.ref ? ' · ' + esc(p.ref) : '') + '</small></div><button class="x" data-delpay="' + p.id + '" aria-label="Delete payment">✕</button></div>';
      }).join('') : '<p class="small">No payments recorded yet.</p>') + '</div>' +
      (b.source !== 'Direct Booking' ? '<div class="card"><h3>Platform payout</h3><p class="small">If ' + esc(b.source) + ' collected money from the guest, record that as a payment with method "Online Platform". Then enter what actually reached your bank here.</p><div class="two">' +
        field('Payout received ₹', '<input id="po_amt" type="number" inputmode="decimal" step="any" value="' + esc(b.payoutReceived) + '">') +
        field('Payout date', '<input id="po_date" type="date" value="' + esc(b.payoutDate) + '">') + '</div>' +
        field('Payout reference', '<input id="po_ref" value="' + esc(b.payoutRef) + '">') + '<button class="btn" id="po_save">Save payout</button></div>' : '') +
      '<div class="card"><h3>Send & share</h3><div class="actions">' +
      (b.phone ? msgs.map(function (m) { return '<a class="btn wa" data-msg="' + m.key + '" target="_blank" rel="noopener" href="' + waLink(b.phone, m.text) + '">WhatsApp: ' + esc(m.label) + '</a>'; }).join('') : '<p class="small">Add a mobile number to send WhatsApp messages.</p>') +
      '<button class="btn" id="ics">Add arrival to calendar</button></div></div>' +
      '<div class="card"><h3>Confirmation & invoice</h3><div class="actions">' +
      '<button class="btn primary" data-doc="confirmation">Send confirmation (PDF)</button>' +
      (b.status === 'Checked Out' && !b.imported ? '<button class="btn primary" data-doc="invoice">Send invoice (PDF)</button>' : '') +
      '<a class="btn" href="#/bill/' + b.id + '/confirmation">View confirmation</a>' + (b.status === 'Checked Out' ? '<a class="btn" href="#/bill/' + b.id + '/invoice">View invoice</a>' : '') + '</div>' +
      '<p class="small">' + (b.imported ? 'Imported from your old sheet' + ((b.oldInvoices || []).length ? ' · old invoice ' + esc(b.oldInvoices.join(', ')) : '') + '. No new invoice is made for old stays.' :
        (b.status === 'Checked Out' ? 'Tax invoice ' + esc(b.invoiceNo || '(numbered at the next sync)') + ' is saved in the booking’s Drive folder.' : 'The tax invoice is made automatically when you mark the guest Checked Out.')) +
      ' Send opens your share menu with the PDF attached: choose WhatsApp, then the guest. Needs internet and Sheet sync.</p></div>' +
      (b.specialRequests || b.notes ? '<div class="card"><h3>Notes</h3>' + (b.specialRequests ? '<p><b>Requests:</b> ' + esc(b.specialRequests) + '</p>' : '') + (b.notes ? '<p><b>Internal:</b> ' + esc(b.notes) + '</p>' : '') + '</div>' : '') +
      (b.status === 'Checked Out' ? '<div class="card"><h3>Review & feedback</h3>' +
        '<div class="actions">' + (b.phone ? '<a class="btn wa primary" data-msg="review" target="_blank" rel="noopener" href="' + waLink(b.phone, reviewText(b)) + '">Send review request on WhatsApp</a>' +
          '<a class="btn" data-msg="review" href="sms:' + esc(smsNo(b.phone)) + (/iPhone|iPad/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(reviewText(b)) + '">Not on WhatsApp? Send SMS</a>' : '') +
          (b.email ? '<a class="btn" data-msg="review" href="mailto:' + esc(b.email) + '?subject=' + encodeURIComponent('Thank you for staying at ' + S().businessName) + '&body=' + encodeURIComponent(reviewText(b)) + '">Send by email</a>' : '') + '</div>' +
        '<p class="small">' + (b.source === 'Direct Booking' || !A.reviewLinks(S(), b.source).channel ? 'Direct booking: the message has your Google review link and the feedback form.' : 'The message has the ' + esc(b.source) + ' review link, your Google review link and the feedback form.') + '</p>' +
        row('WhatsApp review request', b.reviewWaAt ? 'Opened ' + fmtDate(b.reviewWaAt.slice(0, 10)) : 'Not sent yet') +
        (S().autoReviewEmail ? row('Automatic email', !b.email ? 'No guest email' : 'Sent by your Sheet after the next sync') : '') +
        field('Permission to share their review on other platforms', '<select id="consent">' + options([{ id: '', name: 'Not asked yet' }, { id: 'Yes', name: 'Yes, may share' }, { id: 'No', name: 'No' }], b.reviewConsent || '') + '</select>') +
        field('Given via', '<select id="consentVia">' + options(['WhatsApp reply', 'Feedback form', 'In person', 'Email'], b.consentVia || 'WhatsApp reply') + '</select>') +
        '<p class="small">Feedback-form answers fill this in on the Sheet automatically. Record WhatsApp "YES" replies here.</p></div>' : '') +
      '<div class="card"><h3>Booking record</h3>' + row('Booking number', esc(b.no || '—')) + (b.invoiceNo ? row('Invoice number', esc(b.invoiceNo)) : '') + (b.billTo || b.billGstin ? row('Bill to', esc([b.billTo, b.billGstin].filter(Boolean).join(' · '))) : '') + (b.email ? row('Email', esc(b.email)) : '') +
      row('Rooms', esc(roomsLabel(b))) + row('Created', b.createdAt ? fmtDate(b.createdAt.slice(0, 10)) : '—') +
      row('Google Drive folder', b.driveUrl ? '<a href="' + esc(b.driveUrl) + '" target="_blank" rel="noopener">Open folder ›</a>' : (S().syncUrl ? 'Made at the next sync' : 'Needs Sheet sync')) +
      '<p class="small">Drive: ' + esc(A.driveFolderPath(b).join(' / ')) + '</p></div>' +
      syncCard() +
      '<button class="btn danger" id="delb">Delete booking</button>';
    return {
      title: 'Guest details', html: html, back: '#/bookings', tab: 'bookings', after: function () {
        $$('[data-st]').forEach(function (btn) {
          btn.onclick = function () {
            var st = btn.dataset.st;
            if (st === 'Checked Out' && c.outstanding > 0 && !confirm(gname(b) + ' still owes ' + inr(c.outstanding) + '. Check out anyway?')) return;
            if (st === 'Checked In') {
              var gap = A.guestCountGap(b), miss = A.docsMissing(b), msg = [];
              if (gap) msg.push(gap + ' guest' + (gap > 1 ? 's are' : ' is') + ' not added yet (' + (num(b.adults) + num(b.children)) + ' expected)');
              if (miss) msg.push(miss + ' adult' + (miss > 1 ? 's have' : ' has') + ' no ID photo');
              if (A.isForeignBooking(b)) msg.push('Foreign guest: Form C is due within 24 hours');
              if (msg.length && !confirm(msg.join('.\n') + '.\n\nCheck in anyway? You can add guests and IDs afterwards.')) return;
            }
            b.status = st; b.updatedAt = nowISO();
            if (st === 'Checked In') b.checkedInAt = nowISO();
            if (st === 'Checked Out') { b.checkedOutAt = nowISO(); b.checkedOutOn = today(); S().rooms.forEach(function (x) { if (A.roomIds(b).indexOf(x.id) >= 0) x.clean = false; }); }
            save().then(function () { toast(st === 'Checked Out' ? 'Checked out — room marked for cleaning' : 'Status: ' + st); render(); });
          };
        });
        $$('[data-delpay]').forEach(function (btn) {
          btn.onclick = function () {
            if (!confirm('Delete this payment record? This cannot be undone.')) return;
            data.payments = data.payments.filter(function (p) { return p.id !== btn.dataset.delpay; });
            b.updatedAt = nowISO(); save().then(function () { toast('Payment deleted'); render(); });
          };
        });

        var ps = $('#po_save'); if (ps) ps.onclick = function () { b.payoutReceived = r2($('#po_amt').value); b.payoutDate = $('#po_date').value; b.payoutRef = $('#po_ref').value.trim(); b.updatedAt = nowISO(); save().then(function () { toast('Payout saved'); }); };
        $('#ics').onclick = function () {
          deliverFile('arrival-' + b.guestName.replace(/\W+/g, '-') + '.ics', ics([{ uid: b.id, start: icsTime(b.checkIn, 12), end: icsTime(b.checkIn, 13), title: 'Arrival: ' + b.guestName + ' (' + roomsLabel(b) + ')', desc: c.nights + ' nights · ' + b.source + ' · balance ' + inr(c.outstanding) + (b.phone ? ' · ' + b.phone : ''), alarm: '-PT4H' }]), 'text/calendar');
        };
        $('#delb').onclick = function () { deleteBooking(b.id); };
        bindSyncCard();
        $$('[data-doc]').forEach(function (btn) { btn.onclick = function () { sendDoc(b, btn.dataset.doc, btn); }; });
        $$('[data-msg="review"]').forEach(function (a) { a.addEventListener('click', function () { b.reviewWaAt = nowISO(); b.updatedAt = nowISO(); save(); }); });
        var cs = $('#consent'), cv = $('#consentVia');
        function saveConsent() { b.reviewConsent = cs.value; b.consentVia = cv.value; b.consentAt = cs.value ? nowISO() : ''; b.updatedAt = nowISO(); save().then(function () { toast('Review permission saved'); }); }
        if (cs) { cs.onchange = saveConsent; cv.onchange = saveConsent; }
      }
    };
  };
  function firstName(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  function feedbackUrl(b) {
    var u = S().syncUrl;
    return u && b.fbToken ? u + '?page=feedback&id=' + encodeURIComponent(b.id) + '&t=' + b.fbToken : '';
  }
  function stayLines(b, c) {
    return 'Room: ' + roomsLabel(b) + '\nCheck-in: ' + fmtDate(b.checkIn) + '\nCheck-out: ' + fmtDate(b.checkOut) + ' (' + c.nights + ' night' + (c.nights === 1 ? '' : 's') + ')\nGuests: ' + b.adults + ' adult' + (b.adults == 1 ? '' : 's') + (num(b.children) ? ', ' + b.children + ' child' + (b.children == 1 ? '' : 'ren') : '');
  }
  function reviewText(b) {
    var s = S(), biz = s.businessName, links = A.reviewLinks(s, b.source), fb = feedbackUrl(b), direct = b.source === 'Direct Booking' || !links.channel;
    var t = 'Namaste ' + firstName(b.guestName) + ', thank you for staying with us at ' + biz + '. We hope your stay was pleasant and the hills treated you well.\n\n';
    t += 'Your review helps other travellers find us, and your feedback helps us look after you even better next time.\n\n';
    if (links.google) t += 'Rate us on Google:\n' + links.google + '\n\n';
    if (!direct) t += 'Rate us on ' + b.source + ':\n' + links.channel + '\n(Only guests can review there: open your ' + b.source + ' app, go to this booking and tap Write a review.)\n\n';
    else t += 'Or simply reply to this message with a few words about your stay.\n\n';
    if (fb) t += 'Submit feedback:\n' + fb + '\n\n';
    t += 'If anything disappointed you, please tell us' + (fb ? ' through the feedback link' : ' here') + '. We read every message and will put it right.\n\n';
    t += direct ? 'May we share a screenshot of your WhatsApp review (first name only) on our Google, Instagram and booking pages? Please reply YES or NO.'
      : 'May we share your review on our other booking pages and social media (first name only)? Please reply YES or NO.';
    return t + '\n\nWarm regards,\n' + biz;
  }
  function whatsappTemplates(b, c) {
    var s = S(), biz = s.businessName, out = [], token = num(s.tokenAmount) || 500;
    var open = b.status === 'Confirmed' || b.status === 'Checked In';
    if (open) out.push({ key: 'confirm', label: 'Booking confirmation', text: 'Namaste ' + firstName(b.guestName) + ', your stay at ' + biz + ' is confirmed.\n\n' + stayLines(b, c) + '\nTotal: ' + inr(c.total) + '\nReceived: ' + inr(c.received) + '\nBalance: ' + inr(Math.max(c.outstanding, 0)) + '\n\n' + (s.address ? 'Address: ' + s.address + '\n' : '') + 'We look forward to hosting you.' });
    if (b.status === 'Confirmed' && c.received <= 0) out.push({ key: 'token', label: 'Token ' + inr(token) + ' request', text: 'Namaste ' + firstName(b.guestName) + ', thank you for booking ' + biz + (b.source && b.source !== 'Direct Booking' ? ' via ' + b.source : '') + '. Here are your booking details:\n\n' + stayLines(b, c) + '\nTotal: ' + inr(c.total) + '\n\nTo confirm your room, please pay a token amount of ' + inr(token) + (s.upiId ? ' by UPI to ' + s.upiId : '') + '. The balance of ' + inr(Math.max(c.total - token, 0)) + ' is payable at check-in.\n\nPlease share the payment screenshot here once done. Thank you!\n\n' + biz });
    if (open && c.outstanding > 0 && c.received > 0) out.push({ key: 'remind', label: 'Payment reminder', text: 'Namaste ' + firstName(b.guestName) + ', a gentle reminder that ' + inr(c.outstanding) + ' is pending for your stay at ' + biz + ' (' + fmtDate(b.checkIn) + ' to ' + fmtDate(b.checkOut) + ').' + (s.upiId ? ' You can pay by UPI to ' + s.upiId + ' or in cash at check-in.' : ' You can pay by UPI or cash.') + ' Thank you.' });
    if (b.status === 'Checked Out') out.push({ key: 'review', label: 'Review request', text: reviewText(b) });
    return out;
  }


  /* ---------- GUESTS, IDs, DOCUMENTS, FORM C ---------- */
  var DOC_KINDS = ['ID front', 'ID back', 'Passport', 'Visa', 'Guest photo', 'Other'];
  function liveDocs(g) { return (g.docs || []).filter(function (d) { return !d.deleted; }); }
  function guestsCard(b) {
    var gs = A.guestsOf(b), gap = A.guestCountGap(b), t = today();
    var warn = [];
    if (gap) warn.push(gap + ' more guest' + (gap > 1 ? 's' : '') + ' to add (' + (num(b.adults) + num(b.children)) + ' on the booking)');
    var miss = A.docsMissing(b); if (miss) warn.push(miss + ' adult' + (miss > 1 ? 's' : '') + ' without an ID photo');
    return '<div class="card' + (warn.length && A.isActive(b) ? ' alertcard' : '') + '"><h3>Guests & IDs <span class="pill">' + gs.length + '</span></h3>' +
      (warn.length ? '<p class="small" style="color:var(--red)">' + esc(warn.join(' · ')) + '</p>' : '') +
      gs.map(function (g) {
        var docs = liveDocs(g), up = docs.filter(function (d) { return d.driveId; }).length;
        var fc = g.nationality === 'Foreign' ? (g.formCArrival ? (g.formCDeparture || b.status !== 'Checked Out' ? '<span class="flag fl-overpaid">Form C arrival ✓</span>' : '<span class="flag fl-overdue">Form C departure due</span>') + (g.formCDeparture ? '<span class="flag fl-overpaid">Departure ✓</span>' : '')
          : (b.checkIn <= t && A.isActive(b) ? '<span class="flag fl-overdue">Form C due</span>' : '<span class="flag fl-pending">Form C on arrival</span>')) : '';
        return '<a class="guestrow" href="#/gx/' + b.id + '/' + g.id + '"><div><b>' + esc(g.name || 'Unnamed guest') + '</b>' + (g.primary ? ' <span class="tag2">main</span>' : '') + (g.type === 'Child' ? ' <span class="tag2">child</span>' : '') +
          '<br><small>' + esc(g.nationality === 'Foreign' ? (g.country || 'Foreign') + ' · Passport ' + (g.passportNo || '—') : (g.idType || 'ID') + ' ' + (g.idNumber || '— not entered')) + '</small>' +
          '<br><small>' + docs.length + ' document' + (docs.length === 1 ? '' : 's') + (docs.length ? ' · ' + up + ' in Drive' : '') + '</small>' + (fc ? '<br>' + fc : '') + '</div><span class="chev">›</span></a>';
      }).join('') +
      '<div class="actions" style="margin-top:10px"><a class="btn" href="#/gx/' + b.id + '/new">＋ Add guest</a>' +
      (A.isForeignBooking(b) ? '<a class="btn" href="#/formc/' + b.id + '">Form C helper</a>' : '') + '</div></div>';
  }
  function findGuest(b, gid) { return A.guestsOf(b).filter(function (g) { return g.id === gid; })[0]; }

  var gForm = null;
  routes.gx = function (arg) {
    var parts = arg.split('/'), b = booking(parts[0]);
    if (!b) return { title: 'Not found', html: empty('This booking no longer exists.'), back: '#/bookings', tab: 'bookings' };
    if (!b.guests || !b.guests.length) A.migrateGuests(b);
    var isNew = parts[1] === 'new', g0 = isNew ? null : findGuest(b, parts[1]);
    if (!isNew && !g0) return { title: 'Not found', html: empty('Guest not found.'), back: '#/guest/' + b.id, tab: 'bookings' };
    if (!gForm || gForm.bid !== b.id || gForm.gid !== (isNew ? 'new' : g0.id)) {
      gForm = { bid: b.id, gid: isNew ? 'new' : g0.id, g: isNew ? { id: 'g-' + uid().slice(0, 12), name: '', type: 'Adult', nationality: 'Indian', idType: S().idTypes[0], docs: [], arrivalTime: '12:00', purpose: 'Tourism', employedIndia: 'No' } : JSON.parse(JSON.stringify(g0)) };
    }
    var g = gForm.g, s = S(), F = g.nationality === 'Foreign', bid = b.id;
    /* The booking object can be replaced by a sync while this screen is open; always look it up again.
       (Version 1.6 wrote photos into the old object, so they were "saved" but then lost.) */
    function liveB() { return booking(bid) || b; }
    function liveGuest() { return findGuest(liveB(), g.id); }
    function inp(k, label, type, hint, extra) { return field(label, '<input name="' + k + '"' + (type ? ' type="' + type + '"' : '') + ' value="' + esc(g[k] || '') + '"' + (extra || '') + '>', '', hint); }
    var html = '<div class="card"><b>' + esc(gname(b)) + '</b> · ' + esc(b.no || '') + ' · ' + fmtShort(b.checkIn) + ' → ' + fmtShort(b.checkOut) + '</div>' +
      '<form id="gf" class="card" novalidate><h3>' + (isNew ? 'Add guest' : 'Guest') + (g.primary ? ' <span class="tag2">main guest</span>' : '') + '</h3>' +
      inp('name', 'Full name (as on ID)', '', g.primary ? 'Changes here also update the booking.' : '', ' autocomplete="off"') +
      '<div class="three">' + field('Adult / child', '<select name="type">' + options(['Adult', 'Child'], g.type) + '</select>') + field('Gender', '<select name="gender">' + options(['', 'Male', 'Female', 'Other'], g.gender || '', function (x) { return x || 'Choose'; }) + '</select>') + inp('dob', 'Date of birth', 'date') + '</div>' +
      '<div class="two">' + field('Nationality', '<select name="nationality">' + options(['Indian', 'Foreign'], g.nationality) + '</select>') + inp('phone', 'Mobile', 'tel') + '</div>' +
      '<div class="fld"><span>Other contact numbers</span><div id="xph"></div><button type="button" class="btn sm" id="addph">＋ Add number</button></div>' +
      '<div id="indBox" class="' + (F ? 'hide' : '') + '"><div class="two">' + field('ID type', '<select name="idType">' + options(s.idTypes, g.idType) + '</select>') + inp('idNumber', 'ID number (full)', '', '', ' autocomplete="off" autocapitalize="characters"') + '</div>' +
      inp('address', 'Address / city, state') + '</div>' +
      '<div id="forBox" class="' + (F ? '' : 'hide') + '"><h3 style="margin-top:6px">Passport & visa (for Form C)</h3>' +
      '<div class="two">' + inp('surname', 'Surname') + inp('givenName', 'Given name(s)') + '</div>' +
      '<div class="two">' + inp('country', 'Nationality (country)') + inp('passportNo', 'Passport number', '', '', ' autocapitalize="characters"') + '</div>' +
      '<div class="three">' + inp('passportPlace', 'Passport place of issue') + inp('passportIssue', 'Issued', 'date') + inp('passportExpiry', 'Expires', 'date') + '</div>' +
      '<div class="two">' + inp('visaNo', 'Visa / e-Visa number', '', '', ' autocapitalize="characters"') + field('Visa type', '<select name="visaType">' + options(['', 'e-Tourist Visa', 'Tourist Visa', 'e-Business Visa', 'Business Visa', 'Employment Visa', 'Student Visa', 'Conference Visa', 'Medical Visa', 'OCI card', 'Other'], g.visaType || '', function (x) { return x || '—'; }) + '</select>') + '</div>' +
      '<div class="three">' + inp('visaSubtype', 'Visa subtype') + inp('visaIssue', 'Visa issued', 'date') + inp('visaExpiry', 'Visa valid till', 'date') + '</div>' +
      inp('visaPlace', 'Visa place of issue') +
      inp('homeAddress', 'Address in home country') + '<div class="two">' + inp('homeCity', 'City (home)') + inp('homePhone', 'Phone in home country', 'tel') + '</div>' +
      '<div class="two">' + inp('arrivedFrom', 'Arrived from (city, country)') + inp('arrivalIndia', 'Date of arrival in India', 'date') + '</div>' +
      '<div class="two">' + inp('arrivalTime', 'Time of arrival here', 'time') + field('Employed in India?', '<select name="employedIndia">' + options(['No', 'Yes'], g.employedIndia || 'No') + '</select>') + '</div>' +
      '<div class="two">' + field('Purpose of visit', '<select name="purpose">' + options(['Tourism', 'Business', 'Visiting family/friends', 'Medical', 'Conference', 'Study', 'Employment', 'Other'], g.purpose || 'Tourism') + '</select>') + inp('nextPlace', 'Next destination (place)') + '</div>' +
      '<div class="two">' + inp('nextCity', 'Next: city / district') + inp('nextState', 'Next: state, country') + '</div></div>' +
      '<div id="gerr"></div><button class="btn primary big" type="submit">Save guest</button>' + (!isNew && !g.primary ? '<button class="btn danger" type="button" id="gdel">Remove guest</button>' : '') + '</form>' +
      '<div class="card"><h3>Documents</h3><p class="small">' + (F ? 'Add the passport photo page, the visa (or e-Visa PDF) and a recent photo of the guest.' : 'Add the front and back of the ID.') + ' Photos are shrunk to save space and copied to the booking’s Google Drive folder at the next sync.</p>' +
      field('This document is', '<select id="dkind">' + options(DOC_KINDS, F ? (liveDocs(g).some(function (d) { return d.kind === 'Passport'; }) ? (liveDocs(g).some(function (d) { return d.kind === 'Visa'; }) ? 'Guest photo' : 'Visa') : 'Passport') : (liveDocs(g).some(function (d) { return d.kind === 'ID front'; }) ? 'ID back' : 'ID front')) + '</select>') +
      '<div class="actions"><label class="btn primary filebtn">📷 Take photo<input type="file" id="dcam" accept="image/*" capture="environment"></label>' +
      '<label class="btn filebtn">⬆ Upload photo / PDF<input type="file" id="dup" accept="image/*,application/pdf" multiple></label></div>' +
      '<div id="docs" class="docgrid"></div></div>';
    return {
      title: isNew ? 'Add guest' : 'Guest & IDs', tab: 'bookings', back: '#/guest/' + b.id, html: html, after: function () {
        var f = $('#gf');
        function readG() {
          ['name', 'type', 'gender', 'dob', 'nationality', 'phone', 'idType', 'idNumber', 'address', 'surname', 'givenName', 'country', 'passportNo', 'passportPlace', 'passportIssue', 'passportExpiry',
            'visaNo', 'visaType', 'visaSubtype', 'visaIssue', 'visaExpiry', 'visaPlace', 'homeAddress', 'homeCity', 'homePhone', 'arrivedFrom', 'arrivalIndia', 'arrivalTime', 'employedIndia', 'purpose', 'nextPlace', 'nextCity', 'nextState']
            .forEach(function (k) { if (f.elements[k]) g[k] = String(f.elements[k].value || '').trim(); });
          ['idNumber', 'passportNo', 'visaNo'].forEach(function (k) { g[k] = String(g[k] || '').toUpperCase().replace(/\s+/g, k === 'idNumber' ? ' ' : ''); });
          if (g.nationality === 'Foreign' && !g.idType) g.idType = 'Passport';
          return g;
        }
        f.elements.nationality.onchange = function () {
          var fo = this.value === 'Foreign'; $('#forBox').classList.toggle('hide', !fo); $('#indBox').classList.toggle('hide', fo);
          if (!liveDocs(g).length) $('#dkind').value = fo ? 'Passport' : 'ID front';
        };
        function drawPh() {
          g.phones = g.phones || [];
          $('#xph').innerHTML = g.phones.map(function (p, i) { return '<div class="roomline"><input data-xph="' + i + '" type="tel" inputmode="tel" value="' + esc(p.number || '') + '" placeholder="Number"><input data-xphl="' + i + '" value="' + esc(p.label || '') + '" placeholder="Whose? e.g. driver"><button type="button" class="x" data-rmph="' + i + '" aria-label="Remove number">−</button></div>'; }).join('');
          $$('[data-rmph]').forEach(function (x) { x.onclick = function () { readPh(); g.phones.splice(+x.dataset.rmph, 1); drawPh(); }; });
        }
        function readPh() { g.phones = $$('[data-xph]').map(function (el) { return { number: el.value.trim(), label: $('[data-xphl="' + el.dataset.xph + '"]').value.trim() }; }); }
        $('#addph').onclick = function () { readPh(); g.phones.push({ number: '', label: '' }); drawPh(); };
        drawPh();
        function commit(strict) {
          readG(); readPh(); g.phones = g.phones.filter(function (p) { return p.number; });
          if (strict && g.passportExpiry && g.passportIssue && g.passportExpiry < g.passportIssue) { $('#gerr').innerHTML = '<div class="warn">Passport expiry is before its issue date.</div>'; return false; }
          var bk = liveB();
          if (!bk.guests || !bk.guests.length) A.migrateGuests(bk);
          var i = bk.guests.findIndex(function (x) { return x.id === g.id; });
          var copy = JSON.parse(JSON.stringify(g));
          /* keep documents (and their Drive status) that the live record has and this form copy does not */
          if (i >= 0) { A.keepDocs({ guests: [copy] }, { guests: [bk.guests[i]] }); bk.guests[i] = copy; } else bk.guests.push(copy);
          g.docs = JSON.parse(JSON.stringify(copy.docs || []));
          if (g.primary) { bk.guestName = g.name; bk.phone = g.phone || bk.phone; bk.nationality = g.nationality; bk.country = g.country; bk.idType = g.idType; bk.idValue = g.idNumber; }
          bk.updatedAt = nowISO(); gForm.gid = g.id;
          return true;
        }
        f.onsubmit = function (ev) { ev.preventDefault(); if (!commit(true)) return; save().then(function () { toast('Guest saved'); gForm = null; location.replace('#/guest/' + bid); }); };
        var del = $('#gdel');
        if (del) del.onclick = function () {
          if (!confirm('Remove ' + (g.name || 'this guest') + ' and their documents from this booking? Copies already in Google Drive stay there.')) return;
          liveDocs(g).forEach(function (d) { fileDel(d.id).catch(function () {}); });
          var bk = liveB(); bk.guests = bk.guests.filter(function (x) { return x.id !== g.id; }); bk.updatedAt = nowISO();
          save().then(function () { toast('Guest removed'); gForm = null; location.replace('#/guest/' + bid); });
        };
        function addFiles(list) {
          if (!list || !list.length) return;
          if (!commit()) return;
          var kind = $('#dkind').value, files = Array.prototype.slice.call(list), done = 0, bk = liveB();
          toast('Saving ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…');
          files.reduce(function (p, file) {
            return p.then(function () {
              if (file.size > 15 * 1024 * 1024) { toast(file.name + ' is over 15 MB — skipped.', true); return; }
              return compressImage(file).then(function (out) {
                var id = 'doc-' + uid(), ext = /pdf/.test(file.type) ? 'pdf' : 'jpg';
                var rec = { id: id, kind: kind, mime: out.blob.type || file.type || 'application/octet-stream', size: out.blob.size, w: out.w, h: out.h, createdAt: nowISO(),
                  name: A.cleanName((bk.no || '') + ' ' + (g.name || 'Guest') + ' ' + kind + ' ' + id.slice(-4)) + '.' + ext, local: true };
                /* the photo is stored on the phone first, then recorded on the live booking and saved straight away */
                return filePut(id, out.blob).then(function () { return fileGet(id); }).then(function (back) {
                  if (!back) throw new Error('the phone did not keep the photo (storage full?)');
                  g.docs = g.docs || []; g.docs.push(rec); done++;
                  commit(); return save();
                });
              });
            });
          }, Promise.resolve()).then(function () {
            var lg = liveGuest(), have = lg ? liveDocs(lg).length : 0;
            if (done && have < liveDocs(g).length) throw new Error('the booking did not keep the photo record');
            toast(done + ' document' + (done === 1 ? '' : 's') + ' saved on this device' + (S().syncUrl ? ' · copying to Drive…' : ''));
            drawDocs();
          })
            .catch(function (e) { toast('Could not save the photo: ' + e.message, true); });
        }
        $('#dcam').onchange = function () { addFiles(this.files); this.value = ''; };
        $('#dup').onchange = function () { addFiles(this.files); this.value = ''; };
        function drawDocs() {
          var lg = liveGuest(); if (lg) g.docs = JSON.parse(JSON.stringify(lg.docs || []));
          var docs = liveDocs(g), box = $('#docs'); if (!box) return;
          var waiting = docs.filter(function (d) { return !d.driveId; }).length;
          if (!docs.length) { box.innerHTML = '<p class="small">No documents yet.</p>'; return; }
          box.innerHTML = (waiting && data.meta.lastUploadError ? '<div class="warn">Last Drive upload failed: ' + esc(data.meta.lastUploadError) + '. It retries at the next sync (tap Sync now).</div>' : '') +
            (waiting && !S().syncUrl ? '<div class="warn">Cloud sync is not set up, so photos stay on this device only.</div>' : '') + docs.map(function (d) {
            return '<div class="doc" data-doc="' + d.id + '"><div class="thumb" id="t-' + d.id + '">' + (/pdf/.test(d.mime) ? '<span>PDF</span>' : '<span>…</span>') + '</div>' +
              '<div class="dmeta"><b>' + esc(d.kind) + '</b><small>' + (d.driveId ? 'In Drive ✓' : 'Uploads at next sync') + '</small></div>' +
              '<div class="dact">' + (d.local !== false ? '<button type="button" class="btn sm" data-view="' + d.id + '">View</button><button type="button" class="btn sm" data-share="' + d.id + '">Share</button>' : '') +
              (d.driveUrl ? '<a class="btn sm" target="_blank" rel="noopener" href="' + esc(d.driveUrl) + '">Drive</a>' : '') + '<button type="button" class="btn sm danger" data-deldoc="' + d.id + '">✕</button></div></div>';
          }).join('');
          docs.forEach(function (d) {
            if (d.local === false || /pdf/.test(d.mime)) { if (d.local === false) $('#t-' + d.id).innerHTML = '<span>Drive</span>'; return; }
            fileGet(d.id).then(function (bl) { if (!bl) { $('#t-' + d.id).innerHTML = '<span>Drive</span>'; return; } var u = URL.createObjectURL(bl); $('#t-' + d.id).innerHTML = '<img alt="" src="' + u + '">'; });
          });
          $$('[data-view]').forEach(function (x) { x.onclick = function () { fileGet(x.dataset.view).then(function (bl) { if (!bl) return toast('This file is only in Drive now.', true); window.open(URL.createObjectURL(bl), '_blank'); }); }; });
          $$('[data-share]').forEach(function (x) {
            x.onclick = function () {
              var d = docs.filter(function (y) { return y.id === x.dataset.share; })[0];
              fileGet(d.id).then(function (bl) { if (!bl) return toast('This file is only in Drive now.', true); deliverFile(d.name, bl, d.mime); });
            };
          });
          $$('[data-deldoc]').forEach(function (x) {
            x.onclick = function () {
              if (!confirm('Delete this document?' + ' It is also removed from Google Drive at the next sync.')) return;
              var d = (g.docs || []).filter(function (y) { return y.id === x.dataset.deldoc; })[0];
              d.deleted = true; d.deletedAt = nowISO(); fileDel(d.id).catch(function () {});
              var lg2 = liveGuest(), ld = lg2 && (lg2.docs || []).filter(function (y) { return y.id === d.id; })[0];
              if (ld) { ld.deleted = true; ld.deletedAt = d.deletedAt; }
              commit(); save().then(function () { toast('Document deleted'); drawDocs(); });
            };
          });
        }
        drawDocs();
        docsRedraw = drawDocs;
      }
    };
  };
  var docsRedraw = null;

  /* Form C helper: every field in the portal's order with a Copy button. */
  function formCFields(b, g) {
    var s = S(), n = A.nights(b.checkIn, b.checkOut);
    var parts = String(g.name || '').trim().split(/\s+/), sur = g.surname || (parts.length > 1 ? parts[parts.length - 1] : ''), given = g.givenName || (parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '');
    function d(x) { return A.isDate(x) ? x.slice(8, 10) + '/' + x.slice(5, 7) + '/' + x.slice(0, 4) : ''; }
    return [
      ['Personal details'], ['Surname', sur], ['Given name', given], ['Gender', g.gender], ['Date of birth', d(g.dob)], ['Nationality', g.country],
      ['Passport'], ['Passport number', g.passportNo], ['Place of issue', g.passportPlace], ['Date of issue', d(g.passportIssue)], ['Expiry date', d(g.passportExpiry)],
      ['Visa'], ['Visa number', g.visaNo], ['Visa type', g.visaType], ['Visa subtype', g.visaSubtype], ['Place of issue', g.visaPlace], ['Date of issue', d(g.visaIssue)], ['Valid till', d(g.visaExpiry)],
      ['Address in home country'], ['Address', g.homeAddress], ['City', g.homeCity], ['Country', g.country],
      ['Arrival'], ['Arrived from', g.arrivedFrom], ['Date of arrival in India', d(g.arrivalIndia)], ['Date of arrival here', d(b.checkIn)], ['Time of arrival', g.arrivalTime || '12:00'], ['Intended stay (days)', n ? String(n) : ''],
      ['Other details'], ['Whether employed in India', g.employedIndia || 'No'], ['Purpose of visit', g.purpose || 'Tourism'],
      ['Next destination'], ['Place', g.nextPlace], ['City / district', g.nextCity], ['State, country', g.nextState],
      ['Contact'], ['Mobile in India', g.phone || b.phone], ['Phone in home country', g.homePhone],
      ['Your property (reference in India)'], ['Name', s.businessName], ['Address', s.address], ['Phone', s.phone]
    ];
  }
  routes.formc = function (arg) {
    var parts = arg.split('/'), b = booking(parts[0]);
    if (!b) return { title: 'Not found', html: empty('Booking not found.'), back: '#/bookings', tab: 'bookings' };
    var fg = A.foreignGuests(b);
    if (!fg.length) return { title: 'Form C', html: empty('No foreign guests on this booking. Set a guest’s nationality to Foreign first.'), back: '#/guest/' + b.id, tab: 'bookings' };
    var g = (parts[1] && fg.filter(function (x) { return x.id === parts[1]; })[0]) || fg[0];
    var rows = formCFields(b, g), missing = rows.filter(function (r) { return r.length === 2 && !r[1] && ['Visa subtype', 'Phone in home country', 'Phone', 'Date of birth'].indexOf(r[0]) < 0; }).length;
    var html = (fg.length > 1 ? '<div class="chips wrap noprint">' + fg.map(function (x) { return '<a class="chip' + (x.id === g.id ? ' on' : '') + '" href="#/formc/' + b.id + '/' + x.id + '">' + esc(x.name) + '</a>'; }).join('') + '</div>' : '') +
      '<div class="card"><div class="printhead">Form C details — ' + esc(S().businessName) + '</div><h3>' + esc(g.name) + '</h3>' +
      '<p class="small">Arrival entry within 24 hours of check-in; departure entry within 24 hours of leaving. One Form C per foreign guest.</p>' +
      (missing ? '<div class="warn noprint">' + missing + ' field' + (missing > 1 ? 's are' : ' is') + ' empty. <a href="#/gx/' + b.id + '/' + g.id + '">Fill them in ›</a></div>' : '') +
      '<div class="actions noprint"><a class="btn primary" href="https://indianfrro.gov.in/frro/FormC" target="_blank" rel="noopener">Open Form C portal</a><button class="btn" onclick="window.print()">Print / PDF</button><button class="btn" id="fcdocs">Share passport, visa & photo</button></div></div>' +
      '<div class="card fcard">' + rows.map(function (r, i) {
        if (r.length === 1) return '<div class="fcsec">' + esc(r[0]) + '</div>';
        return '<div class="fcrow"><span>' + esc(r[0]) + '</span><b>' + (r[1] ? esc(r[1]) : '<em class="muted">—</em>') + '</b>' + (r[1] ? '<button class="btn sm noprint" data-copy="' + i + '">Copy</button>' : '<span></span>') + '</div>';
      }).join('') + '</div>' +
      '<div class="card noprint"><h3>Status</h3><label class="chk"><input type="checkbox" id="fcA"' + (g.formCArrival ? ' checked' : '') + '> Arrival Form C filed' + (g.formCArrivalAt ? ' (' + fmtDate(g.formCArrivalAt.slice(0, 10)) + ')' : '') + '</label>' +
      field('Form C application / reference number', '<input id="fcRef" value="' + esc(g.formCRef || '') + '">') +
      '<label class="chk"><input type="checkbox" id="fcD"' + (g.formCDeparture ? ' checked' : '') + '> Departure entry filed' + (g.formCDepartureAt ? ' (' + fmtDate(g.formCDepartureAt.slice(0, 10)) + ')' : '') + '</label></div>';
    return {
      title: 'Form C helper', tab: 'bookings', back: '#/guest/' + b.id, html: html, after: function () {
        $$('[data-copy]').forEach(function (x) {
          x.onclick = function () {
            var v = rows[+x.dataset.copy][1];
            (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { x.textContent = 'Copied'; setTimeout(function () { x.textContent = 'Copy'; }, 1200); })
              .catch(function () { prompt('Copy this:', v); });
          };
        });
        function setG(o, msg) {
          var real = findGuest(b, g.id); Object.keys(o).forEach(function (k) { real[k] = o[k]; g[k] = o[k]; });
          b.updatedAt = nowISO(); save().then(function () { toast(msg); });
        }
        $('#fcA').onchange = function () { setG({ formCArrival: this.checked, formCArrivalAt: this.checked ? nowISO() : '' }, this.checked ? 'Arrival Form C marked filed' : 'Marked not filed'); };
        $('#fcD').onchange = function () { setG({ formCDeparture: this.checked, formCDepartureAt: this.checked ? nowISO() : '' }, this.checked ? 'Departure entry marked filed' : 'Marked not filed'); };
        $('#fcRef').onchange = function () { setG({ formCRef: this.value.trim() }, 'Reference saved'); };
        $('#fcdocs').onclick = function () {
          var want = liveDocs(g).filter(function (d) { return ['Passport', 'Visa', 'Guest photo'].indexOf(d.kind) >= 0 && d.local !== false; });
          if (!want.length) return toast('Add the passport, visa and photo on the guest page first.', true);
          Promise.all(want.map(function (d) { return fileGet(d.id).then(function (bl) { return bl ? new File([bl], d.name, { type: d.mime }) : null; }); })).then(function (files) {
            files = files.filter(Boolean);
            if (navigator.canShare && navigator.canShare({ files: files })) navigator.share({ files: files, title: 'Form C documents' }).catch(function () {});
            else files.forEach(function (fl) { deliverFile(fl.name, fl, fl.type); });
          });
        };
      }
    };
  };

  /* ---------- FOOD & SERVICES (day-wise detail, bill photos, statement) ---------- */
  var MEAL_OPTS = ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Other'];
  var fsScan = null, fsTimer = null;
  function menuList() { return A.menuOf(S()); }
  function menuEntry(id) { if (String(id).indexOf('svc:') === 0) { var n = id.slice(4), v = (S().services || []).filter(function (x) { return x.name === n; })[0]; return v ? { id: id, name: v.name, price: num(v.rate) || null, type: 'Other', unit: '' } : null; } var m = menuList().filter(function (x) { return x.id === id; })[0]; return m ? { id: m.id, name: m.name, price: m.price, type: 'Food', unit: m.unit || '' } : null; }
  function itemOptions(sel) {
    var cats = [], by = {};
    menuList().forEach(function (m) { if (!by[m.cat]) { by[m.cat] = []; cats.push(m.cat); } by[m.cat].push(m); });
    var h = '<option value="">— Choose from the menu —</option>' + cats.map(function (c) { return '<optgroup label="' + esc(c) + '">' + by[c].map(function (m) { return '<option value="' + esc(m.id) + '"' + (m.id === sel ? ' selected' : '') + '>' + esc(m.name) + (m.price != null ? ' · ₹' + m.price + (m.unit ? '/' + m.unit : '') : ' · MRP') + '</option>'; }).join('') + '</optgroup>'; }).join('');
    var sv = (S().services || []).filter(function (v) { return v.name; });
    if (sv.length) h += '<optgroup label="Services">' + sv.map(function (v) { var id = 'svc:' + v.name; return '<option value="' + esc(id) + '"' + (id === sel ? ' selected' : '') + '>' + esc(v.name) + (num(v.rate) ? ' · ₹' + num(v.rate) : '') + '</option>'; }).join('') + '</optgroup>';
    return h + '<option value="__custom"' + (sel === '__custom' ? ' selected' : '') + '>Not on the menu (type it)</option>';
  }
  routes.fs = function (id) {
    var b = booking(id);
    if (!b) return { title: 'Not found', html: empty('This booking no longer exists.'), back: '#/bookings', tab: 'bookings' };
    var bid = b.id; function liveB() { return booking(bid) || b; }
    b.charges = b.charges && b.charges.length ? b.charges : A.chargeLines(b).map(function (x) { return JSON.parse(JSON.stringify(x)); });
    b.charges.forEach(function (c) { if (!c.id) c.id = 'c-' + uid().slice(0, 10); });
    var D = A.stayDays(b), c = calc(b), fl = A.flaggedLines(b), s = S();
    function lineRow(cl) {
      var isItem = cl.kind === 'item', flags = cl.flags || [], custom = isItem && (!cl.item || cl.custom);
      var head = isItem ? '<select data-f="item" aria-label="Item">' + itemOptions(custom ? '__custom' : cl.item) + '</select>' + (custom ? '<input data-f="name" value="' + esc(cl.name || '') + '" placeholder="What was it?">' : '')
        : '<span class="fsname">' + esc(cl.type === 'Food' && cl.meal && !cl.kind ? cl.meal + ' (per person)' : (cl.name || (cl.type === 'Food' ? 'Food & beverages' : 'Other services'))) + '</span>';
      return '<div class="fsl' + (flags.length ? ' flagged' : '') + '" data-id="' + esc(cl.id) + '">' + '<div class="fsh">' + head + '</div>' +
        '<div class="fsn"><label><small>Qty' + (cl.unit ? ' (' + esc(cl.unit) + ')' : '') + '</small><input data-f="qty" type="number" inputmode="decimal" min="0" step="any" value="' + esc(cl.qty != null ? cl.qty : 1) + '"' + (flags.indexOf('qty') >= 0 ? ' class="bad"' : '') + '></label>' +
        '<label><small>Rate ₹</small><input data-f="rate" type="number" inputmode="decimal" min="0" step="any" value="' + esc(cl.rate != null ? cl.rate : '') + '"' + (flags.indexOf('price') >= 0 ? ' class="bad"' : '') + '></label>' +
        '<label><small>Amount ₹</small><input data-f="amount" type="number" inputmode="decimal" min="0" step="any" value="' + esc(cl.amount) + '"' + (flags.indexOf('math') >= 0 || flags.indexOf('price') >= 0 ? ' class="bad"' : '') + '></label>' +
        '<button type="button" class="x" data-f="del" aria-label="Remove line">−</button></div>' +
        '<div class="fsm">' + (cl.type === 'Food' ? '<select data-f="meal" aria-label="Meal">' + options(MEAL_OPTS, cl.meal || 'Other') + '</select>' : '<span class="small">Service</span>') +
        '<select data-f="day" aria-label="Day"' + (flags.indexOf('day') >= 0 ? ' class="bad"' : '') + '>' + (flags.indexOf('day') >= 0 || !(num(cl.day) > 0) ? '<option value="0">' + (flags.indexOf('day') >= 0 ? 'Choose the day' : 'Whole stay') + '</option>' : '') +
        Array.apply(null, Array(D)).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (num(cl.day) === i + 1 ? ' selected' : '') + '>Day ' + (i + 1) + '</option>'; }).join('') + '</select>' +
        (cl.billId ? '<span class="small">from bill photo' + (cl.raw ? ': “' + esc(cl.raw) + '”' : '') + '</span>' : '') + '</div>' +
        (flags.length ? '<div class="fsflags">' + flags.map(function (f) { return '<div>⚠ ' + esc(A.flagText(cl, f)) + '</div>'; }).join('') + '<button type="button" class="btn sm" data-f="ok">✓ Looks right</button></div>' : '') + '</div>';
    }
    function dayCard(d, lines) {
      var tot = A.sum(lines, function (x) { return x.amount; });
      return '<div class="card fsday" data-day="' + d + '"><div class="fsdh"><h3>' + (d > 0 ? 'Day ' + d + (A.dayDate(b, d) ? ' · ' + esc(A.fmtLong(A.dayDate(b, d))) : '') : (lines.some(function (x) { return (x.flags || []).indexOf('day') >= 0; }) ? 'Day not set' : 'Whole stay')) + '</h3><b data-dt="' + d + '">' + inr(tot) + '</b></div>' +
        (lines.length ? lines.map(lineRow).join('') : '<p class="small">Nothing yet.</p>') +
        '<div class="actions"><button type="button" class="btn sm" data-add="' + d + '">＋ Add item</button></div></div>';
    }
    var groups = {}; for (var d = 1; d <= D; d++) groups[d] = [];
    b.charges.forEach(function (cl) { var k = num(cl.day) > 0 && num(cl.day) <= D ? Math.round(num(cl.day)) : 0; (groups[k] = groups[k] || []).push(cl); });
    var bills = (b.bills || []).filter(function (x) { return (x.flags || []).length; });
    var html = '<div class="card hero"><div class="bk-top"><b class="name">' + esc(gname(b)) + '</b><span class="st ' + statusClass(b.status) + '">' + esc(b.status) + '</span></div>' +
      '<div class="bk-mid">' + esc(roomsLabel(b)) + ' · ' + (A.isDate(b.checkIn) ? fmtShort(b.checkIn) + ' → ' + fmtShort(b.checkOut) + ' · ' + A.stayLabel(b) : 'Dates not set') + '</div>' +
      '<div class="big3"><div><small>Food</small><b id="fsF">' + inr(c.food) + '</b></div><div><small>Services</small><b id="fsO">' + inr(c.additional) + '</b></div><div><small>To check</small><b class="' + (fl.length || bills.length ? 'due' : '') + '" id="fsC">' + (fl.length + bills.length) + '</b></div></div></div>' +
      (!D ? '<div class="warn">Set check-in and check-out on the booking to get the days.</div>' : '') +
      bills.map(function (x) { return '<div class="warn fsbill"><b>Bill photo of ' + esc(fmtShort(String(x.at || '').slice(0, 10))) + ':</b> ' + (x.flags.indexOf('total') >= 0 ? 'total written on the bill is ' + inr(x.total) + ' but the lines read add up to ' + inr(x.sum) + '. A line may be missing or misread.' : 'nothing could be read. Add the items by hand.') + ' <button type="button" class="btn sm" data-billok="' + esc(x.id) + '">✓ Checked</button></div>'; }).join('') +
      '<div class="card"><h3>Add from a bill photo</h3><p class="small">Take a clear photo of the handwritten bill (flat, good light). It is read by Google (free, in your own Google account), matched to your menu, and added to the day. Anything not read for sure is marked in red to fix. Needs internet and Sheet sync.</p>' +
      '<div class="two">' + field('Bill is for', '<select id="scanDay"><option value="0">Read the day from the bill</option>' + Array.apply(null, Array(D)).map(function (_, i) { return '<option value="' + (i + 1) + '">Day ' + (i + 1) + (A.dayDate(b, i + 1) ? ' · ' + fmtShort(A.dayDate(b, i + 1)) : '') + '</option>'; }).join('') + '</select>') +
      field('Meal', '<select id="scanMeal"><option value="">Read from the bill</option>' + options(MEAL_OPTS, '') + '</select>') + '</div>' +
      '<div class="actions"><label class="btn primary filebtn">📷 Photo of bill<input type="file" id="bcam" accept="image/*" capture="environment"></label><label class="btn filebtn">⬆ Upload bill photo<input type="file" id="bup" accept="image/*"></label></div><div id="scanBox"></div></div>' +
      Object.keys(groups).map(Number).sort(function (x, y) { return (x || 99) - (y || 99); }).filter(function (k) { return k > 0 || groups[k].length; }).map(function (k) { return dayCard(k, groups[k]); }).join('') +
      '<div class="card"><h3>Statement for the guest</h3>' +
      field('Discount on food & services ₹', '<input id="exd" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.extrasDiscount || '') + '">', '', 'Only if the guest insists. Comes off food and services before GST, and the tax invoice shows the same.') +
      '<label class="chk"><input type="checkbox" id="stg"' + (b.stmtGst ? ' checked' : '') + (b.gstOn ? '' : ' disabled') + '> Show GST on the statement' + (b.gstOn ? '' : ' (GST is off for this booking)') + '</label>' +
      '<div class="calcbox" id="fsTot"></div>' +
      '<div class="actions"><a class="btn" href="#/bill/' + bid + '/statement">View statement</a><button class="btn primary" data-doc="statement">Send statement (PDF)</button></div>' +
      '<p class="small">Send opens your share menu with the PDF attached (WhatsApp, email…). Needs internet and Sheet sync.</p></div>' + syncCard();
    return {
      title: 'Food & services', back: '#/guest/' + bid, tab: 'bookings', html: html, after: function () {
        function findLine(lid) { return (liveB().charges || []).filter(function (x) { return x.id === lid; })[0]; }
        function drop(cl, fs) { cl.flags = (cl.flags || []).filter(function (f) { return fs.indexOf(f) < 0; }); if (!cl.flags.length) delete cl.flags; }
        function totals() {
          var bk = liveB(); A.applyCharges(bk); var cc = calc(bk);
          $('#fsF').textContent = inr(cc.food); $('#fsO').textContent = inr(cc.additional);
          var nf = A.flaggedLines(bk).length + (bk.bills || []).filter(function (x) { return (x.flags || []).length; }).length; $('#fsC').textContent = nf; $('#fsC').classList.toggle('due', !!nf);
          $$('[data-dt]').forEach(function (el) { var d = +el.dataset.dt; el.textContent = inr(A.sum((bk.charges || []).filter(function (x) { var k = num(x.day) > 0 && num(x.day) <= A.stayDays(bk) ? Math.round(num(x.day)) : 0; return k === d; }), function (x) { return x.amount; })); });
          var withG = bk.stmtGst && bk.gstOn;
          $('#fsTot').innerHTML = row('Food & services', inr(r2(cc.food + cc.additional))) + (cc.extrasDiscount ? row('Less: discount', '−' + inr(cc.extrasDiscount)) : '') +
            (withG ? row('GST food', inr(cc.gstFood)) + (cc.gstOther ? row('GST services', inr(cc.gstOther)) : '') + row('Statement total', inr(r2(cc.foodTaxable + cc.otherTaxable + cc.gstFood + cc.gstOther)), 'strong') : row('Statement total' + (bk.gstOn ? ' (before GST)' : ''), inr(r2(cc.foodTaxable + cc.otherTaxable)), 'strong'));
        }
        function later(redraw) { var bk = liveB(); A.applyCharges(bk); bk.updatedAt = nowISO(); totals(); clearTimeout(fsTimer); fsTimer = setTimeout(function () { save(); }, 700); if (redraw) { save().then(function () { render(); }); clearTimeout(fsTimer); } }
        totals();
        $$('.fsl').forEach(function (row0) {
          var lid = row0.dataset.id;
          $$('[data-f]', row0).forEach(function (el) {
            var f = el.dataset.f;
            if (f === 'del') { el.onclick = function () { var bk = liveB(); bk.charges = bk.charges.filter(function (x) { return x.id !== lid; }); later(true); }; return; }
            if (f === 'ok') { el.onclick = function () { var cl = findLine(lid); if (cl) { delete cl.flags; later(true); } }; return; }
            el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
              var cl = findLine(lid); if (!cl) return;
              if (f === 'item') {
                if (el.value === '__custom') { cl.custom = true; cl.item = ''; drop(cl, ['item']); return later(true); }
                var me = menuEntry(el.value); if (!me) return;
                /* learn the written word so the next bill matches it straight away */
                if (cl.read && (cl.flags || []).indexOf('item') >= 0 && me.type === 'Food') { var mm = (S().menu || []).filter(function (x) { return x.id === me.id; })[0]; if (mm) { mm.aliases = mm.aliases || []; if (mm.aliases.indexOf(cl.read) < 0) mm.aliases.push(cl.read); } }
                cl.item = me.id; cl.custom = false; cl.name = me.name; cl.type = me.type; cl.unit = me.unit; cl.menuPrice = me.price;
                if (me.price != null) { cl.rate = me.price; cl.amount = r2(num(cl.qty || 1) * me.price); drop(cl, ['item', 'price', 'math']); } else drop(cl, ['item']);
                return later(true);
              }
              if (f === 'name') { cl.name = el.value.trim(); return later(); }
              if (f === 'meal') { cl.meal = el.value; return later(); }
              if (f === 'day') { cl.day = +el.value; if (+el.value > 0) drop(cl, ['day']); return later(true); }
              if (f === 'qty') { cl.qty = el.value === '' ? '' : r2(el.value); cl.amount = r2(num(el.value) * num(cl.rate)); var a = $('[data-f="amount"]', row0); if (a) a.value = cl.amount; drop(cl, ['qty', 'math']); }
              if (f === 'rate') { cl.rate = el.value === '' ? '' : r2(el.value); cl.amount = r2(num(cl.qty || 1) * num(el.value)); var a2 = $('[data-f="amount"]', row0); if (a2) a2.value = cl.amount; drop(cl, ['price', 'math']); }
              if (f === 'amount') { cl.amount = r2(el.value); drop(cl, ['price', 'math']); }
              el.classList.remove('bad'); later();
            });
          });
        });
        $$('[data-add]').forEach(function (btn) {
          btn.onclick = function () {
            var bk = liveB(), d = +btn.dataset.add;
            bk.charges = bk.charges || []; bk.charges.push({ id: 'c-' + uid().slice(0, 10), kind: 'item', type: 'Food', day: d, meal: 'Lunch', item: '', name: '', qty: 1, rate: '', amount: 0, flags: ['item'] });
            later(true);
          };
        });
        $$('[data-billok]').forEach(function (btn) { btn.onclick = function () { var x = (liveB().bills || []).filter(function (y) { return y.id === btn.dataset.billok; })[0]; if (x) { x.flags = []; later(true); } }; });
        $('#exd').oninput = function () { liveB().extrasDiscount = r2(this.value); var e = A.validateBooking(liveB(), S()).extrasDiscount; if (e) { toast(e, true); liveB().extrasDiscount = 0; } later(); };
        $('#stg').onchange = function () { liveB().stmtGst = this.checked; later(); };
        $$('[data-doc]').forEach(function (btn) { btn.onclick = function () { clearTimeout(fsTimer); save().then(function () { sendDoc(liveB(), 'statement', btn); }); }; });
        bindSyncCard();

        /* ---- bill photo → text (Sheet / Google Drive OCR) → lines ---- */
        function scanFile(file, lang) {
          var bk = liveB();
          $('#scanBox').innerHTML = '<p class="small">Saving the photo…</p>';
          compressImage(file).then(function (out) {
            var did = 'bill-' + uid(), rec = { id: did, kind: 'Food bill', mime: out.blob.type || 'image/jpeg', size: out.blob.size, w: out.w, h: out.h, createdAt: nowISO(), name: A.cleanName((bk.no || '') + ' food bill ' + today() + ' ' + did.slice(-4)) + '.jpg', local: true };
            return filePut(did, out.blob).then(function () { bk = liveB(); bk.billDocs = bk.billDocs || []; bk.billDocs.push(rec); bk.updatedAt = nowISO(); return save(true); }).then(function () { return readBill(did, out.blob, lang || 'hi'); });
          }).catch(function (e) { $('#scanBox').innerHTML = '<div class="warn">Could not save the photo: ' + esc(e.message || e) + '</div>'; });
        }
        function readBill(did, blob, lang) {
          var st = S();
          if (!st.syncUrl || !st.syncToken) { $('#scanBox').innerHTML = '<div class="warn">Photo saved. Reading needs Cloud sync (More → Settings). Add the items by hand below.</div>'; return; }
          if (!navigator.onLine) { $('#scanBox').innerHTML = '<div class="warn">Photo saved. You are offline: add the items by hand, or try the photo again with internet.</div>'; return; }
          $('#scanBox').innerHTML = '<p class="small">Reading the bill… (about 10 seconds)</p>';
          return toB64(blob).then(function (b64) {
            return fetch(st.syncUrl, { method: 'POST', redirect: 'follow', body: JSON.stringify({ token: st.syncToken, action: 'ocr', bookingId: bid, docId: did, mime: blob.type || 'image/jpeg', lang: lang, data: b64 }) }).then(function (r) { return r.text(); });
          }).then(function (t) {
            var j; try { j = JSON.parse(t); } catch (e) { throw new Error('Unexpected reply from Google. Update Code.gs to version 1.8 and deploy a new version.'); }
            if (!j.ok) throw new Error(j.error || 'Could not read the bill');
            var res = A.parseBill(j.text, liveB(), S(), { day: +$('#scanDay').value, meal: $('#scanMeal').value });
            fsScan = { did: did, blob: blob, lang: lang, text: j.text, res: res };
            review();
          }).catch(function (e) { $('#scanBox').innerHTML = '<div class="warn">' + esc(e.message || e) + ' The photo is saved; add the items by hand below.</div>'; });
        }
        function review() {
          var res = fsScan.res, bk = liveB(), ls = res.lines, bad = ls.filter(function (l) { return l.flags.length; }).length;
          var days = []; ls.forEach(function (l) { if (l.day && days.indexOf(l.day) < 0) days.push(l.day); });
          var busy = days.filter(function (d) { return (bk.charges || []).some(function (x) { return num(x.day) === d && num(x.amount); }); });
          var h = '<div class="ok">Read ' + ls.length + ' line' + (ls.length === 1 ? '' : 's') + (days.length ? ' for ' + days.map(function (d) { return 'Day ' + d; }).join(', ') : '') + ' · ' + inr(res.sum) + (bad ? ' · <b style="color:var(--red)">' + bad + ' to check</b>' : '') + '</div>' +
            (res.flags.indexOf('total') >= 0 ? '<div class="warn">The bill total is ' + inr(res.total) + ' but the lines read add up to ' + inr(res.sum) + '.</div>' : '') +
            (res.flags.indexOf('empty') >= 0 ? '<div class="warn">No items could be read from this photo.</div>' : '') +
            '<div class="scanlist">' + ls.map(function (l) { return '<div class="' + (l.flags.length ? 'bad' : '') + '"><span>' + (l.day ? 'D' + l.day + ' · ' : '') + esc(l.name) + ' × ' + l.qty + '</span><b>' + inr(l.amount) + '</b></div>'; }).join('') + '</div>' +
            busy.map(function (d) { var have = A.sum((bk.charges || []).filter(function (x) { return num(x.day) === d; }), function (x) { return x.amount; }); return '<div class="fld choose" data-busy="' + d + '"><span>Day ' + d + ' already has ' + inr(have) + ' of food & services. What should this bill do?</span><label class="chk"><input type="radio" name="busy' + d + '" value="replace"> Replace what is on Day ' + d + '</label><label class="chk"><input type="radio" name="busy' + d + '" value="add"> Add on top</label></div>'; }).join('') +
            '<div class="actions"><button type="button" class="btn primary" id="scanAdd"' + (ls.length ? '' : ' disabled') + '>Add to the booking</button><button type="button" class="btn" id="scanEn">Read again (English)</button><button type="button" class="btn" id="scanHi">Read again (Hindi)</button><button type="button" class="btn" id="scanX">Cancel</button></div>' +
            '<details class="fld"><summary>What Google read</summary><pre class="ocr">' + esc(fsScan.text) + '</pre></details>';
          $('#scanBox').innerHTML = h;
          $('#scanEn').onclick = function () { readBill(fsScan.did, fsScan.blob, 'en'); };
          $('#scanHi').onclick = function () { readBill(fsScan.did, fsScan.blob, 'hi'); };
          $('#scanX').onclick = function () { fsScan = null; $('#scanBox').innerHTML = '<p class="small">Cancelled. The photo stays saved with the booking.</p>'; };
          $('#scanAdd').onclick = function () {
            var choice = {}, missing = [];
            busy.forEach(function (d) { var x = $('input[name="busy' + d + '"]:checked'); if (x) choice[d] = x.value; else missing.push(d); });
            if (missing.length) return toast('Choose Replace or Add on top for Day ' + missing.join(', Day '), true);
            var bk2 = liveB(), billId = 'bl-' + uid().slice(0, 10);
            bk2.charges = (bk2.charges || []).filter(function (x) { return !(choice[num(x.day)] === 'replace'); });
            res.lines.forEach(function (l) {
              bk2.charges.push({ id: 'c-' + uid().slice(0, 10), kind: 'item', type: l.type, day: l.day || 0, meal: l.type === 'Food' ? l.meal : '', item: l.item, name: l.name, unit: l.unit, qty: l.qty, rate: l.rate, amount: l.amount, menuPrice: l.menuPrice, read: l.read, raw: l.raw, billId: billId, flags: l.flags.slice() });
            });
            bk2.bills = bk2.bills || []; bk2.bills.push({ id: billId, docId: fsScan.did, at: nowISO(), lang: fsScan.lang, total: res.total, sum: res.sum, flags: res.flags.filter(function (f) { return f === 'total' || f === 'empty'; }) });
            fsScan = null; A.applyCharges(bk2); bk2.updatedAt = nowISO();
            save().then(function () { toast('Bill added' + (bad ? ': fix the lines in red' : '')); render(); });
          };
        }
        $('#bcam').onchange = function () { if (this.files[0]) scanFile(this.files[0]); this.value = ''; };
        $('#bup').onchange = function () { if (this.files[0]) scanFile(this.files[0]); this.value = ''; };
      }
    };
  };

  /* ---------- RECORD PAYMENT / REFUND ---------- */
  routes.pay = function (arg) {
    var parts = arg.split('/'), b = booking(parts[0]), refund = parts[1] === 'refund';
    if (!b) return { title: 'Not found', html: empty('This booking no longer exists.'), back: '#/bookings' };
    var c = calc(b);
    var suggested = refund ? Math.max(-c.outstanding, 0) : Math.max(c.outstanding, 0);
    var html = '<div class="card"><b>' + esc(b.guestName) + '</b> · ' + esc(roomsLabel(b)) + '<div class="big3"><div><small>Bill</small><b>' + inr(c.total) + '</b></div><div><small>Received</small><b>' + inr(c.received) + '</b></div><div><small>Balance</small><b>' + inr(c.outstanding) + '</b></div></div></div>' +
      '<form id="pf" class="card" novalidate><h3>' + (refund ? 'Refund to guest' : 'Payment received') + '</h3>' +
      field('Amount ₹', '<input name="amount" type="number" inputmode="decimal" min="0" step="any" value="' + (suggested ? suggested : '') + '">') +
      '<div class="two">' + field('Date', '<input name="date" type="date" value="' + today() + '">') +
      field('Method', '<select name="method">' + options(A.METHODS, refund ? 'UPI' : (b.source !== 'Direct Booking' && !c.received ? 'Online Platform' : 'UPI')) + '</select>') + '</div>' +
      field('Transaction reference', '<input name="ref" placeholder="UPI / card / bank reference (optional)">') +
      '<div id="perr"></div><button class="btn primary big" type="submit">Save ' + (refund ? 'refund' : 'payment') + '</button></form>';
    return {
      title: refund ? 'Record refund' : 'Record payment', html: html, back: '#/guest/' + b.id, tab: 'bookings', after: function () {
        $('#pf').onsubmit = function (ev) {
          ev.preventDefault();
          var f = this, amt = r2(f.elements.amount.value), d = A.isDate(f.elements.date.value) ? f.elements.date.value : today();
          if (!(amt > 0)) return ($('#perr').innerHTML = '<div class="warn">Enter the amount ' + (refund ? 'refunded' : 'received') + ' (that is the payment itself, so it cannot be left empty).</div>');
          if (!refund && amt > c.outstanding + 0.005 && !confirm('This is more than the balance of ' + inr(c.outstanding) + '. Save anyway?')) return;
          data.payments.push({ id: uid(), bookingId: b.id, type: refund ? 'refund' : 'payment', amount: amt, date: d, method: f.elements.method.value, ref: f.elements.ref.value.trim(), createdAt: nowISO(), updatedAt: nowISO() });
          b.updatedAt = nowISO();
          save().then(function () { toast((refund ? 'Refund ' : 'Payment ') + inr(amt) + ' saved'); location.replace('#/guest/' + b.id); });
        };
      }
    };
  };


  /* ---------- QUERIES (enquiries, kept apart from bookings) ---------- */
  var qFilter = { q: '', status: 'Open' };
  function queryCard(q) {
    var st = q.status === 'Closed' ? (q.outcome === 'Booked' ? 'Closed · Booked' : 'Closed · Not booked') : q.status;
    var cls = q.status === 'Open' ? 'st-cancelled' : q.status === 'Answered' ? 'st-confirmed' : (q.outcome === 'Booked' ? 'st-checked-in' : 'st-checked-out');
    var age = Math.floor((Date.now() - new Date(q.createdAt || nowISO()).getTime()) / 864e5);
    return '<a class="card bk" href="#/query/' + q.id + '"><div class="bk-top"><b>' + esc(q.name) + '</b><span class="st ' + cls + '">' + esc(st) + '</span></div>' +
      '<div class="bk-mid">' + esc(q.channel || 'Other') + ' · received ' + fmtShort(A.queryDate(q)) + (q.status !== 'Closed' && age >= 1 ? ' · ' + age + ' day' + (age > 1 ? 's' : '') + ' old' : '') + '</div>' +
      '<div class="bk-mid">' + (A.isDate(q.checkIn) ? fmtShort(q.checkIn) + ' → ' + fmtShort(q.checkOut) : 'Dates not given') + (num(q.quote) ? ' · quoted ' + inr(q.quote) : '') + (q.phone ? ' · ☎ ' + esc(q.phone) : '') + '</div>' +
      (q.couponCode ? '<div class="flag fl-pending">Coupon ' + esc(q.couponCode) + '</div>' : (A.couponCandidates(data, today()).some(function (x) { return x.id === q.id; }) ? '<div class="flag fl-overdue">Offer a coupon?</div>' : '')) + '</a>';
  }
  routes.queries = function () {
    var html = '<a class="cta small" href="#/qnew">＋ Add New Query</a>' +
      '<div class="searchbar"><input id="qq" type="search" placeholder="Search name, phone, channel, date…" value="' + esc(qFilter.q) + '"></div>' +
      '<div class="chips" id="qchips">' + ['Open', 'Answered', 'Closed', 'All'].map(function (x) { return '<button class="chip' + (qFilter.status === x ? ' on' : '') + '" data-v="' + x + '">' + x + '</button>'; }).join('') + '</div><div id="qlist"></div>' +
      '<a class="card navrow" href="#/conversion"><b>Query conversion by channel</b><small>Which channels turn enquiries into bookings</small></a>';
    return {
      title: 'Queries', tab: 'queries', html: html, after: function () {
        function draw() {
          var t = qFilter.q.toLowerCase().trim();
          var list = (data.queries || []).filter(function (q) {
            if (qFilter.status !== 'All' && q.status !== qFilter.status) return false;
            return !t || [q.name, q.phone, q.email, q.channel, q.checkIn, fmtDate(q.checkIn), A.queryDate(q), q.message].join(' ').toLowerCase().indexOf(t) >= 0;
          }).sort(function (a, b) { return String(a.createdAt) < String(b.createdAt) ? 1 : -1; });
          $('#qlist').innerHTML = '<div class="count">' + list.length + ' quer' + (list.length === 1 ? 'y' : 'ies') + '</div>' +
            (list.length ? list.map(queryCard).join('') : empty(data.queries.length ? 'No queries here.' : 'No queries yet. Add one when a guest asks about a stay.'));
        }
        $('#qq').oninput = function () { qFilter.q = this.value; draw(); };
        $$('#qchips .chip').forEach(function (c) { c.onclick = function () { qFilter.status = c.dataset.v; $$('#qchips .chip').forEach(function (x) { x.classList.toggle('on', x === c); }); draw(); }; });
        draw();
      }
    };
  };
  function queryForm(q, isNew) {
    var s = S();
    var html = '<form id="qf" class="card" novalidate><h3>' + (isNew ? 'New query' : 'Edit query') + '</h3>' +
      field('Guest name', '<input name="name" value="' + esc(q.name) + '" autocomplete="off">') +
      '<div class="two">' + field('Mobile', '<input name="phone" type="tel" inputmode="tel" value="' + esc(q.phone) + '">') + field('Email', '<input name="email" type="email" value="' + esc(q.email) + '">') + '</div>' +
      '<div class="two">' + field('Channel', '<select name="channel">' + options(s.sources, q.channel) + '</select>') + field('Received on', '<input name="date" type="date" value="' + esc(q.date) + '">') + '</div>' +
      '<div class="two">' + field('Check-in (if given)', '<input name="checkIn" type="date" value="' + esc(q.checkIn) + '">') + field('Check-out', '<input name="checkOut" type="date" value="' + esc(q.checkOut) + '">') + '</div>' +
      '<div class="three">' + field('Adults', '<input name="adults" type="number" inputmode="numeric" min="1" value="' + esc(q.adults) + '">') + field('Children', '<input name="children" type="number" inputmode="numeric" min="0" value="' + esc(q.children) + '">') +
      field('Room', '<select name="roomId"><option value="">Any</option>' + options(A.activeRooms(s), q.roomId) + '</select>') + '</div>' +
      field('Quoted amount ₹ (whole stay)', '<input name="quote" type="number" inputmode="decimal" min="0" step="any" value="' + esc(q.quote) + '">', '', 'Goes into the thank-you message and becomes the room charges if it turns into a booking.') +
      field('What they asked', '<textarea name="message" rows="2">' + esc(q.message) + '</textarea>') +
      field('Internal notes', '<textarea name="notes" rows="2">' + esc(q.notes) + '</textarea>') +
      field('Status', '<select name="status">' + options(A.QUERY_STATUSES, q.status) + '</select>') +
      '<div id="closeBox" class="' + (q.status === 'Closed' ? '' : 'hide') + '">' + field('Outcome', '<select name="outcome">' + options(A.QUERY_OUTCOMES, q.outcome || 'Booked') + '</select>') +
      field('Reason if not booked', '<input name="lostReason" value="' + esc(q.lostReason) + '" placeholder="Price, dates full, no reply…">') + '</div>' +
      '<div id="qerr"></div><button class="btn primary big" type="submit">Save query</button>' + (isNew ? '' : '<button class="btn danger" type="button" id="qdel">Delete query</button>') + '</form>';
    return {
      title: isNew ? 'New query' : 'Edit query', tab: 'queries', back: '#/queries', html: html, after: function () {
        var f = $('#qf');
        f.elements.status.onchange = function () { $('#closeBox').classList.toggle('hide', this.value !== 'Closed'); };
        f.onsubmit = function (ev) {
          ev.preventDefault();
          ['name', 'phone', 'email', 'channel', 'date', 'checkIn', 'checkOut', 'roomId', 'message', 'notes', 'status', 'outcome', 'lostReason'].forEach(function (k) { q[k] = String(f.elements[k].value || '').trim(); });
          q.adults = Math.max(0, Math.round(num(f.elements.adults.value))); q.children = Math.max(0, Math.round(num(f.elements.children.value)));
          q.quote = r2(f.elements.quote.value);
          var err = q.checkIn && q.checkOut && A.nights(q.checkIn, q.checkOut) < 1 ? 'Check-out must be after check-in.' : '';
          if (err) { $('#qerr').innerHTML = '<div class="warn">' + esc(err) + '</div>'; return; }
          if (q.status !== 'Closed') q.outcome = '';
          if (q.status === 'Answered' && !q.answeredAt) q.answeredAt = nowISO();
          if (q.status === 'Closed' && !q.closedAt) q.closedAt = nowISO();
          if (q.status !== 'Closed') q.closedAt = '';
          q.updatedAt = nowISO();
          if (isNew) { q.id = uid(); q.createdAt = nowISO(); data.queries.push(q); }
          else { var i = data.queries.findIndex(function (x) { return x.id === q.id; }); data.queries[i] = q; }
          save().then(function () {
            if (A.isConverted(q) && !q.bookingId) { toast('Query closed as booked — now fill in the booking'); location.replace('#/new/fromQuery=' + q.id); }
            else { toast('Query saved'); location.replace('#/query/' + q.id); }
          });
        };
        var d = $('#qdel');
        if (d) d.onclick = function () {
          if (!confirm('Delete this query for ' + gname(q) + '? This cannot be undone.' + (q.bookingId ? ' Its booking stays.' : ''))) return;
          data.queries = data.queries.filter(function (x) { return x.id !== q.id; });
          save().then(function () { toast('Query deleted'); location.replace('#/queries'); });
        };
      }
    };
  }
  routes.qnew = function () {
    return queryForm({ name: '', phone: '', email: '', channel: 'Direct Booking', date: today(), checkIn: '', checkOut: '', adults: 2, children: 0, roomId: '', quote: '', message: '', notes: '', status: 'Open', outcome: '', lostReason: '' }, true);
  };
  routes.qedit = function (id) {
    var q = query(id);
    if (!q) return { title: 'Not found', html: empty('This query no longer exists.'), back: '#/queries', tab: 'queries' };
    return queryForm(JSON.parse(JSON.stringify(q)), false);
  };
  function queryMessages(q) {
    var s = S(), biz = s.businessName, n = A.isDate(q.checkIn) && A.isDate(q.checkOut) ? A.nights(q.checkIn, q.checkOut) : 0, token = num(s.tokenAmount) || 500;
    var stay = n ? '\n\nFor your stay from ' + fmtDate(q.checkIn) + ' to ' + fmtDate(q.checkOut) + ' (' + n + ' night' + (n > 1 ? 's' : '') + ', ' + q.adults + ' adult' + (q.adults == 1 ? '' : 's') + (num(q.children) ? ', ' + q.children + ' child' + (q.children == 1 ? '' : 'ren') : '') + ')' + (num(q.quote) ? ', the total comes to ' + inr(q.quote) + '.' : ', we have rooms available.') : (num(q.quote) ? '\n\nOur quote for your stay is ' + inr(q.quote) + '.' : '');
    return [
      { key: 'thanks', label: 'Thanks for your enquiry', text: 'Namaste ' + firstName(q.name) + ', thank you for your enquiry with ' + biz + '. We are delighted you are thinking of staying with us.' + stay + '\n\nIf you would like to go ahead, just reply here and we will hold the room for you with a token amount of ' + inr(token) + (s.upiId ? ' (UPI: ' + s.upiId + ')' : '') + '. Happy to answer any questions about the rooms, food or getting here.\n\nWarm regards,\n' + biz },
      { key: 'followup', label: 'Follow-up', text: 'Namaste ' + firstName(q.name) + ', just checking in on your enquiry with ' + biz + (n ? ' for ' + fmtDate(q.checkIn) : '') + '. Rooms do fill up quickly, so let us know if you would like us to hold one for you. Happy to help with anything else.\n\n' + biz }
    ];
  }
  function couponMessage(q) {
    var s = S(), biz = s.businessName, n = A.isDate(q.checkIn) && A.isDate(q.checkOut) ? A.nights(q.checkIn, q.checkOut) : 0;
    var off = q.couponType === 'pct' ? num(q.couponValue) + '% off' : inr(q.couponValue) + ' off', after = A.quoteAfterCoupon(q);
    return 'Namaste ' + firstName(q.name) + ', we still have a lovely room ready for you at ' + biz + (A.isDate(q.checkIn) ? ' for ' + fmtDate(q.checkIn) + (n ? ' (' + n + ' night' + (n > 1 ? 's' : '') + ')' : '') : '') + '.\n\n' +
      'As a special offer for booking directly with us, here is ' + off + ': use code ' + q.couponCode + '.' +
      (num(q.quote) ? ' Your stay comes to ' + inr(after) + ' instead of ' + inr(q.quote) + '.' : '') +
      '\n\nThe offer is valid until ' + (A.isDate(q.checkIn) ? fmtDate(q.checkIn) : 'your check-in') + '. Just reply here to confirm and we will hold the room for you.\n\nWarm regards,\n' + biz;
  }
  function couponCard(q) {
    if (q.status === 'Closed') return q.couponCode ? '<div class="card"><h3>Coupon</h3>' + row('Code', esc(q.couponCode) + ' (' + (q.couponType === 'pct' ? num(q.couponValue) + '%' : inr(q.couponValue)) + ')') + '</div>' : '';
    var cand = A.couponCandidates(data, today()).some(function (x) { return x.id === q.id; });
    var free = A.isDate(q.checkIn) ? A.freeRooms(data, q.checkIn, q.checkOut, q.roomId).length : null;
    var head = cand ? '<div class="alert amber" style="margin-bottom:10px">Arriving ' + (q.checkIn === today() ? 'today' : 'tomorrow') + ', not booked yet, and ' + free + ' room' + (free === 1 ? '' : 's') + ' still free. A coupon may close it.</div>'
      : (free === 0 ? '<p class="small">All rooms are booked for these dates, so no coupon is needed.</p>' : '');
    return '<div class="card"><h3>Offer a coupon</h3>' + head +
      (q.couponCode ? row('Current offer', esc(q.couponCode) + ' · ' + (q.couponType === 'pct' ? num(q.couponValue) + '% off' : inr(q.couponValue) + ' off')) + (num(q.quote) ? row('Price after coupon', inr(A.quoteAfterCoupon(q))) : '') +
        '<div class="actions">' + (q.phone ? '<a class="btn wa" target="_blank" rel="noopener" href="' + waLink(q.phone, couponMessage(q)) + '">WhatsApp: Send coupon offer</a>' : '') + '<button class="btn" id="cpdel">Remove coupon</button></div>' :
        '<div class="actions">' + ['5', '10', '15'].map(function (v) { return '<button class="btn" data-cp="' + v + '">' + v + '% off</button>'; }).join('') +
        '<button class="btn" data-cp="pct">Custom %</button><button class="btn" data-cp="amt">Custom ₹</button></div>' +
        '<p class="small">The coupon is carried into the booking when this query is closed as booked, and comes off before GST.</p>') + '</div>';
  }
  routes.query = function (id) {
    var q = query(id);
    if (!q) return { title: 'Not found', html: empty('This query no longer exists.'), back: '#/queries', tab: 'queries' };
    var b = q.bookingId ? booking(q.bookingId) : null;
    var html = '<div class="card hero"><div class="bk-top"><b class="name">' + esc(gname(q)) + '</b><span class="st ' + (q.status === 'Open' ? 'st-cancelled' : q.status === 'Answered' ? 'st-confirmed' : (q.outcome === 'Booked' ? 'st-checked-in' : 'st-checked-out')) + '">' + esc(q.status + (q.status === 'Closed' ? ' · ' + (q.outcome || '') : '')) + '</span></div>' +
      '<div class="bk-mid">' + esc(q.channel) + ' · received ' + fmtDate(A.queryDate(q)) + '</div>' +
      '<div class="bk-mid">' + (A.isDate(q.checkIn) ? fmtDate(q.checkIn) + ' → ' + fmtDate(q.checkOut) : 'Dates not given') + ' · ' + q.adults + ' adult(s)' + (num(q.children) ? ', ' + q.children + ' child(ren)' : '') + (q.roomId ? ' · ' + esc(roomName(q.roomId)) : '') + '</div>' +
      (num(q.quote) ? '<div class="bk-mid">Quoted ' + inr(q.quote) + '</div>' : '') +
      (q.phone ? '<div class="bk-mid"><a href="tel:' + esc(q.phone) + '">☎ ' + esc(q.phone) + '</a></div>' : '') + (q.email ? '<div class="bk-mid">' + esc(q.email) + '</div>' : '') + '</div>' +
      '<div class="actions">' + (q.status === 'Open' ? '<button class="btn primary" id="qans">Mark Answered</button>' : '') +
      (q.status !== 'Closed' ? '<button class="btn primary" id="qbook">Closed · Booked</button><button class="btn" id="qlost">Closed · Not booked</button>' : '') +
      (A.isConverted(q) && !b ? '<a class="btn primary" href="#/new/fromQuery=' + q.id + '">Create the booking</a>' : '') +
      (b ? '<a class="btn" href="#/guest/' + b.id + '">Open booking</a>' : '') + '<a class="btn" href="#/qedit/' + q.id + '">Edit</a>' +
      (q.status === 'Closed' ? '<button class="btn" id="qreopen">Reopen</button>' : '') + '</div>' +
      couponCard(q) +
      '<div class="card"><h3>Send</h3><div class="actions">' + (q.phone ? queryMessages(q).map(function (m) { return '<a class="btn wa" data-qmsg="' + m.key + '" target="_blank" rel="noopener" href="' + waLink(q.phone, m.text) + '">WhatsApp: ' + esc(m.label) + '</a>'; }).join('') : '<p class="small">Add a mobile number to send WhatsApp messages.</p>') + '</div>' +
      '<p class="small">Sending the thank-you marks the query as Answered.</p></div>' +
      (q.message || q.notes || q.lostReason ? '<div class="card"><h3>Notes</h3>' + (q.message ? '<p><b>Asked:</b> ' + esc(q.message) + '</p>' : '') + (q.notes ? '<p><b>Internal:</b> ' + esc(q.notes) + '</p>' : '') + (q.lostReason ? '<p><b>Not booked because:</b> ' + esc(q.lostReason) + '</p>' : '') + '</div>' : '') + syncCard();
    return {
      title: 'Query', tab: 'queries', back: '#/queries', html: html, after: function () {
        function set(o, msg, next) { Object.keys(o).forEach(function (k) { q[k] = o[k]; }); q.updatedAt = nowISO(); save().then(function () { toast(msg); if (next) location.replace(next); else render(); }); }
        var a = $('#qans'); if (a) a.onclick = function () { set({ status: 'Answered', answeredAt: q.answeredAt || nowISO() }, 'Marked as answered'); };
        var bk = $('#qbook'); if (bk) bk.onclick = function () { set({ status: 'Closed', outcome: 'Booked', closedAt: nowISO() }, 'Closed as booked — now fill in the booking', '#/new/fromQuery=' + q.id); };
        var l = $('#qlost'); if (l) l.onclick = function () { var r = prompt('Why didn’t it turn into a booking? (optional)', q.lostReason || ''); if (r === null) return; set({ status: 'Closed', outcome: 'Not booked', lostReason: r.trim(), closedAt: nowISO() }, 'Closed as not booked'); };
        var ro = $('#qreopen'); if (ro) ro.onclick = function () { set({ status: 'Answered', outcome: '', closedAt: '' }, 'Query reopened'); };
        $$('[data-cp]').forEach(function (btn) {
          btn.onclick = function () {
            var v = btn.dataset.cp, type = 'pct', val = v;
            if (v === 'pct' || v === 'amt') {
              var ans = prompt(v === 'pct' ? 'Coupon % (1–100)' : 'Coupon amount in ₹'); if (ans === null) return;
              val = num(String(ans).replace(/[₹,%\s]/g, '')); type = v;
              if (!(val > 0) || (type === 'pct' && val > 100) || (type === 'amt' && num(q.quote) && val >= num(q.quote))) return toast('Enter a sensible ' + (type === 'pct' ? 'percentage' : 'amount') + '.', true);
            }
            set({ couponType: type, couponValue: r2(val), couponCode: A.couponCode(S().couponPrefix, val, type), couponOfferedAt: nowISO() }, 'Coupon ready — now send it on WhatsApp');
          };
        });
        var cd = $('#cpdel'); if (cd) cd.onclick = function () { set({ couponType: '', couponValue: '', couponCode: '', couponOfferedAt: '' }, 'Coupon removed'); };
        bindSyncCard();
        $$('[data-qmsg="thanks"]').forEach(function (x) { x.addEventListener('click', function () { if (q.status === 'Open') { q.status = 'Answered'; q.answeredAt = nowISO(); q.updatedAt = nowISO(); save(); setTimeout(render, 400); } }); });
      }
    };
  };
  var cvMonth = null;
  routes.conversion = function () {
    cvMonth = cvMonth || thisMonth();
    var from = A.monthStart(cvMonth), to = A.monthEnd(cvMonth), r = A.queryConversion(data, from, to), keys = Object.keys(r.byChannel);
    var html = '<div class="noprint">' + field('Queries received in', '<input type="month" id="cvm" value="' + cvMonth + '">') + '</div>' +
      '<div class="printhead">' + esc(S().businessName) + ' — Query conversion, ' + fmtMonth(cvMonth) + '</div>' +
      '<div class="tiles">' + tile('Queries', String(r.total.queries), r.total.open + ' open · ' + r.total.answered + ' answered') + tile('Converted', r.total.conversionPct + '%', r.total.booked + ' booked · ' + r.total.notBooked + ' not booked') + '</div>' +
      (keys.length ? '<div class="card"><table class="tbl"><tr><th>Channel</th><th>Queries</th><th>Open</th><th>Answered</th><th>Booked</th><th>Lost</th><th>Conv.</th></tr>' + keys.sort(function (a, b) { return r.byChannel[b].queries - r.byChannel[a].queries; }).map(function (k) {
        var x = r.byChannel[k]; return '<tr><td>' + esc(k) + '</td><td>' + x.queries + '</td><td>' + x.open + '</td><td>' + x.answered + '</td><td>' + x.booked + '</td><td>' + x.notBooked + '</td><td>' + x.conversionPct + '%</td></tr>';
      }).join('') + '</table></div>' : empty('No queries received in this month.')) +
      '<p class="small">Conversion = queries closed as booked ÷ all queries received that month. Open and answered queries count as not converted yet.</p>' + exportBar('cv');
    return {
      title: 'Query conversion', tab: 'reports', back: '#/reports', html: html, after: function () {
        $('#cvm').onchange = function () { if (this.value) { cvMonth = this.value; render(); } };
        $('#cvcsv').onclick = function () {
          var rows = [['Channel', 'Queries', 'Open', 'Answered', 'Closed booked', 'Closed not booked', 'Conversion %']];
          keys.forEach(function (k) { var x = r.byChannel[k]; rows.push([k, x.queries, x.open, x.answered, x.booked, x.notBooked, x.conversionPct]); });
          rows.push(['All', r.total.queries, r.total.open, r.total.answered, r.total.booked, r.total.notBooked, r.total.conversionPct]);
          deliverFile('query-conversion-' + cvMonth + '.csv', csv(rows), 'text/csv');
        };
      }
    };
  };


  /* ---------- IMPORT OLD QUERIES (CSV file or cells pasted from Numbers / Excel / Google Sheets) ---------- */
  var imp = { parsed: null, map: {}, monthFirst: false, result: null, fileName: '' };
  routes['import'] = function () {
    var batches = {};
    (data.queries || []).forEach(function (q) { if (q.importBatch) batches[q.importBatch] = (batches[q.importBatch] || 0) + 1; });
    var html = '<div class="card"><h3>1. Bring in your old queries</h3><p class="small">Either pick a CSV file exported from Numbers, Excel or Google Sheets, or copy the cells (including the heading row) and paste them below. Use the template for the exact columns, or your own columns — you match them in step 2.</p>' +
      field('CSV file', '<input type="file" id="impfile" accept=".csv,.txt,text/csv,text/plain">') +
      field('…or paste cells here', '<textarea id="imppaste" rows="4" placeholder="Copy from Numbers with the heading row, then paste"></textarea>') +
      field('Dates in my sheet are written', '<select id="impdmy"><option value="dmy"' + (imp.monthFirst ? '' : ' selected') + '>Day first (19/10/2026) — India</option><option value="mdy"' + (imp.monthFirst ? ' selected' : '') + '>Month first (10/19/2026)</option></select>') +
      '<button class="btn primary" id="impread">Read my data</button><div id="impmsg"></div></div><div id="impmap"></div><div id="imppreview"></div>' +
      (Object.keys(batches).length ? '<div class="card"><h3>Earlier imports</h3>' + Object.keys(batches).map(function (b) {
        return '<div class="pay"><div><b>' + batches[b] + ' queries</b><br><small>Imported ' + fmtDate(new Date(Number(b.replace(/\D/g, '')) || Date.now()).toISOString().slice(0, 10)) + '</small></div><button class="btn sm danger" data-undo="' + esc(b) + '">Undo</button></div>';
      }).join('') + '</div>' : '');
    return {
      title: 'Import old queries', tab: 'more', back: '#/backup', html: html, after: function () {
        $('#imppaste').oninput = function () { if (this.value.trim()) $('#impfile').value = ''; };
        $('#impfile').onchange = function () { if (this.files.length) $('#imppaste').value = ''; };
        $('#impdmy').onchange = function () { imp.monthFirst = this.value === 'mdy'; if (imp.parsed) preview(); };
        $('#impread').onclick = function () {
          var f = $('#impfile').files[0], pasted = $('#imppaste').value;
          function go(text, name) {
            var p = A.parseCSV(text);
            if (!p.header.length || !p.rows.length) { $('#impmsg').innerHTML = '<div class="warn">No rows found. Include the heading row and at least one query.</div>'; return; }
            imp.parsed = p; imp.fileName = name; imp.map = A.guessColumns(p.header); imp.result = null;
            $('#impmsg').innerHTML = '<div class="ok">Found ' + p.rows.length + ' rows and ' + p.header.length + ' columns in ' + esc(name) + '.</div>';
            drawMap(); preview();
          }
          if (f) { var rd = new FileReader(); rd.onload = function () { go(rd.result, f.name); }; rd.onerror = function () { toast('Could not read that file.', true); }; rd.readAsText(f); }
          else if (pasted.trim()) go(pasted, 'pasted cells');
          else toast('Choose a CSV file or paste your cells first.', true);
        };
        $$('[data-undo]').forEach(function (b) {
          b.onclick = function () {
            var id = b.dataset.undo, n = data.queries.filter(function (q) { return q.importBatch === id; }).length;
            if (!confirm('Remove the ' + n + ' queries from this import? Queries you have since turned into bookings keep their bookings.')) return;
            data.queries = data.queries.filter(function (q) { return q.importBatch !== id; });
            save().then(function () { toast('Import undone'); render(); });
          };
        });
      }
    };
    function drawMap() {
      var p = imp.parsed, opts = '<option value="">— not in my sheet —</option>' + p.header.map(function (h, i) { return '<option value="' + i + '">' + esc(h || ('Column ' + (i + 1))) + (p.rows[0] && p.rows[0][i] ? ' (e.g. ' + esc(String(p.rows[0][i]).slice(0, 18)) + ')' : '') + '</option>'; }).join('');
      $('#impmap').innerHTML = '<div class="card"><h3>2. Check where each column goes</h3><p class="small">Matched automatically from your headings. Change any that are wrong. Fields marked * are needed.</p>' +
        A.IMPORT_FIELDS.map(function (fd) { return field(fd.label + (fd.required ? ' *' : ''), '<select data-imp="' + fd.key + '">' + opts + '</select>'); }).join('') + '</div>';
      $$('[data-imp]').forEach(function (sel) {
        var v = imp.map[sel.dataset.imp]; sel.value = v === undefined ? '' : String(v);
        sel.onchange = function () { imp.map[sel.dataset.imp] = sel.value === '' ? undefined : Number(sel.value); preview(); };
      });
    }
    function preview() {
      if (!imp.parsed) return;
      if (imp.map.name === undefined) { $('#imppreview').innerHTML = '<div class="warn">Choose which column holds the guest name.</div>'; return; }
      var r = A.buildImport(imp.parsed, imp.map, { monthFirst: imp.monthFirst, settings: S(), batch: 'imp-' + Date.now() }, data.queries);
      imp.result = r;
      var st = { Open: 0, Answered: 0, Booked: 0, 'Not booked': 0 };
      r.queries.forEach(function (q) { st[q.status === 'Closed' ? q.outcome : q.status]++; });
      $('#imppreview').innerHTML = '<div class="card"><h3>3. Preview</h3><div class="tiles">' + tile('Will import', String(r.queries.length), st.Open + ' open · ' + st.Answered + ' answered · ' + st.Booked + ' booked · ' + st['Not booked'] + ' not booked') +
        tile('Not imported', String(r.skipped.length + r.duplicates), r.duplicates + ' already in the app · ' + r.skipped.length + ' missing name/date', r.skipped.length ? 'warnv' : '') + '</div>' +
        (r.warnings ? '<p class="small">' + r.warnings + ' row(s) had something the app couldn’t read (a date, room or email). They are still imported, with the original text kept in Notes so nothing is lost.</p>' : '') +
        (r.queries.length ? '<table class="tbl"><tr><th>Guest</th><th>Received</th><th>Channel</th><th>Status</th></tr>' + r.queries.slice(0, 8).map(function (q) {
          return '<tr><td>' + esc(q.name) + '</td><td>' + fmtShort(q.date) + '</td><td>' + esc(q.channel) + '</td><td>' + esc(q.status === 'Closed' ? q.outcome : q.status) + '</td></tr>';
        }).join('') + '</table>' + (r.queries.length > 8 ? '<p class="small">…and ' + (r.queries.length - 8) + ' more.</p>' : '') : '') +
        '<div class="actions" style="margin-top:12px">' + (r.queries.length ? '<button class="btn primary" id="impgo">Import ' + r.queries.length + ' queries</button>' : '') +
        (r.skipped.length ? '<button class="btn" id="impskip">Download rows not imported</button>' : '') + '</div></div>';
      var g = $('#impgo');
      if (g) g.onclick = function () {
        var n = r.queries.length;
        if (!confirm('Add ' + n + ' old queries to the app? You can undo this import later.')) return;
        Array.prototype.push.apply(data.queries, r.queries);
        save().then(function () { toast(n + ' queries imported'); imp.parsed = null; location.replace('#/queries'); qFilter.status = 'All'; render(); });
      };
      var sk = $('#impskip');
      if (sk) sk.onclick = function () {
        var rows = [['Line in your sheet', 'Why not imported'].concat(imp.parsed.header)];
        r.skipped.forEach(function (x) { rows.push([x.line, x.reason].concat(x.row)); });
        deliverFile('queries-not-imported.csv', csv(rows), 'text/csv');
      };
    }
  };


  /* ---------- ANALYTICS: filters, comparison, charts, Excel + PDF export ---------- */
  var an = { preset: 'lastMonth', seasonId: '', from: '', to: '', compare: 'previous', cfrom: '', cto: '', channels: [] };
  function allChannels() {
    var seen = {}, out = [];
    S().sources.concat((data.bookings || []).map(function (b) { return b.source; }), (data.queries || []).map(function (q) { return q.channel; }))
      .forEach(function (c) { if (c && !seen[c]) { seen[c] = 1; out.push(c); } });
    return out;
  }
  function changeBadge(cur, prev, lowerIsBetter) {
    var p = A.pctChange(cur, prev);
    if (p === null) return prev === undefined ? '' : '<span class="chg">new</span>';
    var up = p > 0, good = lowerIsBetter ? !up : up;
    return '<span class="chg ' + (p === 0 ? '' : good ? 'good' : 'bad') + '">' + (p === 0 ? '±0%' : (up ? '▲ +' : '▼ ') + p + '%') + '</span>';
  }
  function kpi(label, cur, prev, fmt, lowerIsBetter) {
    var f = fmt === 'money' ? inr : fmt === 'pct' ? function (v) { return v + '%'; } : String;
    return '<div class="tile"><div class="tl">' + esc(label) + '</div><div class="tv">' + (cur === null ? '—' : f(cur)) + '</div><div class="ts">' +
      (prev !== undefined ? (prev === null ? '' : 'vs ' + f(prev) + ' ') + changeBadge(cur, prev, lowerIsBetter) : '') + '</div></div>';
  }
  function barsHtml(title, rows, fmt, hasCmp) {
    var max = Math.max.apply(null, rows.map(function (r) { return Math.max(r.a || 0, r.b || 0); }).concat([1]));
    var f = fmt === 'money' ? inr : String;
    return '<div class="card chart"><h3>' + esc(title) + '</h3>' + (rows.length ? rows.map(function (r) {
      return '<div class="brow"><div class="blab">' + esc(r.label) + '</div><div class="bbars"><div class="bar a" style="width:' + Math.max(0.5, (r.a || 0) / max * 100) + '%"></div><span class="bval">' + f(r.a || 0) + '</span>' +
        (hasCmp ? '<div class="bar b" style="width:' + Math.max(0.5, (r.b || 0) / max * 100) + '%"></div><span class="bval muted">' + f(r.b || 0) + '</span>' : '') + '</div></div>';
    }).join('') : '<p class="small">No data in this period.</p>') +
      (hasCmp && rows.length ? '<div class="legend2"><span class="sw a"></span>This period <span class="sw b"></span>Comparison</div>' : '') + '</div>';
  }
  function lineSvg(title, cur, cmp) {
    var a = cur.series.points, b = cmp ? cmp.series.points : [], n = Math.max(a.length, b.length);
    if (!n) return '';
    var W = 340, H = 170, L = 46, R = 8, T = 10, B = 26;
    var max = Math.max.apply(null, a.concat(b).map(function (p) { return p.taxable; }).concat([1]));
    function xy(i, v) { return [(L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1))).toFixed(1), (T + (H - T - B) * (1 - v / max)).toFixed(1)]; }
    function path(pts, cls) { return pts.length ? '<polyline class="' + cls + '" points="' + pts.map(function (p, i) { return xy(i, p.taxable).join(','); }).join(' ') + '"/>' : ''; }
    var grid = [0, 0.5, 1].map(function (g) { var y = (T + (H - T - B) * (1 - g)).toFixed(1); return '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="' + (L - 4) + '" y="' + (Number(y) + 3) + '" text-anchor="end" class="ax">' + esc(inr(max * g).replace('₹', '₹')) + '</text>'; }).join('');
    function lab(p) { if (!p) return ''; return cur.series.unit === 'month' ? fmtMonth(p.key).slice(0, 3) + ' ' + p.key.slice(2, 4) : fmtShort(p.key); }
    var xl = [0, Math.floor((n - 1) / 2), n - 1].filter(function (v, i, arr) { return arr.indexOf(v) === i; }).map(function (i) { return '<text x="' + xy(i, 0)[0] + '" y="' + (H - 8) + '" text-anchor="' + (i === n - 1 && n > 1 ? 'end' : i === 0 && n > 1 ? 'start' : 'middle') + '" class="ax">' + esc(lab(a[i])) + '</text>'; }).join('');
    return '<div class="card chart"><h3>' + esc(title) + '</h3><svg viewBox="0 0 ' + W + ' ' + H + '" class="lsvg" role="img" aria-label="' + esc(title) + '">' + grid + path(b, 'lb') + path(a, 'la') + xl + '</svg>' +
      '<div class="legend2"><span class="sw a"></span>This period (by ' + cur.series.unit + ')' + (cmp ? ' <span class="sw b"></span>Comparison' : '') + '</div></div>';
  }
  routes.analytics = function () {
    var t = today(), s = S(), seasons = s.seasons.filter(function (x) { return A.isDate(x.from) && A.isDate(x.to); });
    if (an.preset === 'season' && !an.seasonId && seasons.length) an.seasonId = seasons[0].id || seasons[0].name;
    var range = A.periodRange(an.preset, t, { settings: s, seasonId: an.seasonId, from: an.from, to: an.to });
    var crange = range ? A.comparisonRange(range, an.compare, { from: an.cfrom, to: an.cto }) : null;
    var chans = allChannels(), sel = an.channels;
    var filters = '<div class="card noprint"><h3>Filters</h3>' +
      field('Period', '<select id="anp">' + options([{ id: 'lastWeek', name: 'Last week (Mon–Sun)' }, { id: 'thisWeek', name: 'This week' }, { id: 'lastMonth', name: 'Last month' }, { id: 'thisMonth', name: 'This month to date' }, { id: 'last30', name: 'Last 30 days' }, { id: 'thisFY', name: 'This financial year (from 1 April)' }, { id: 'lastFY', name: 'Last financial year' }, { id: 'lastYear', name: 'Last calendar year' }, { id: 'thisYear', name: 'This calendar year to date' }, { id: 'season', name: 'Season' }, { id: 'custom', name: 'Custom dates' }], an.preset) + '</select>') +
      (an.preset === 'season' ? (seasons.length ? field('Season', '<select id="ans">' + options(seasons.map(function (x) { return { id: x.id || x.name, name: x.name + ' (' + fmtShort(x.from) + ' – ' + fmtShort(x.to) + ')' }; }), an.seasonId) + '</select>') : '<div class="warn">No seasons yet. Add them in More → Settings → Season rate card.</div>') : '') +
      (an.preset === 'custom' ? '<div class="two">' + field('From', '<input type="date" id="anf" value="' + esc(an.from) + '">') + field('To', '<input type="date" id="ant" value="' + esc(an.to) + '">') + '</div>' : '') +
      field('Compare with', '<select id="anc">' + options([{ id: 'previous', name: 'Previous period' }, { id: 'lastYear', name: 'Same period last year' }, { id: 'custom', name: 'Custom dates' }, { id: 'none', name: 'No comparison' }], an.compare) + '</select>') +
      (an.compare === 'custom' ? '<div class="two">' + field('Compare from', '<input type="date" id="acf" value="' + esc(an.cfrom) + '">') + field('Compare to', '<input type="date" id="act" value="' + esc(an.cto) + '">') + '</div>' : '') +
      '<div class="fld"><span>Channels</span><div class="chips wrap" id="anch"><button class="chip' + (!sel.length ? ' on' : '') + '" data-ch="">All channels</button>' +
      chans.map(function (c) { return '<button class="chip' + (sel.indexOf(c) >= 0 ? ' on' : '') + '" data-ch="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div></div>';
    if (!range) return { title: 'Analytics', tab: 'reports', back: '#/reports', html: filters + empty(an.preset === 'season' ? 'Choose a season.' : 'Choose a valid from and to date.'), after: bindAn };
    var cur = A.analytics(data, range.from, range.to, sel), cmp = crange ? A.analytics(data, crange.from, crange.to, sel) : null, c = cmp || {};
    var hasCmp = !!cmp, chLabel = sel.length ? sel.join(', ') : 'All channels';
    var head = '<div class="anhead"><div class="printhead">' + esc(s.businessName) + ' — Performance report</div><b>' + esc(range.label) + '</b>: ' + fmtDate(range.from) + ' – ' + fmtDate(range.to) +
      (cmp ? '<br><span class="small">Compared with ' + esc(crange.label.toLowerCase()) + ': ' + fmtDate(crange.from) + ' – ' + fmtDate(crange.to) + '</span>' : '') + '<br><span class="small">Channels: ' + esc(chLabel) + '</span></div>';
    var P = function (k) { return hasCmp ? c[k] : undefined; };
    var tiles = '<div class="tiles">' + kpi('Gross revenue', cur.gross, P('gross'), 'money') + kpi('Net after commission', cur.net, P('net'), 'money') +
      kpi('Room nights', cur.nights, P('nights')) + kpi('Occupancy', cur.occupancyPct, P('occupancyPct'), 'pct') +
      kpi('Avg room rate / night', cur.adr, P('adr'), 'money') + kpi('Bookings', cur.bookings, P('bookings')) +
      kpi('Queries', cur.queries, P('queries')) + kpi('Query conversion', cur.conversionPct, P('conversionPct'), 'pct') +
      kpi('Money collected', cur.collected, P('collected'), 'money') + kpi('Coupons given', cur.coupon, P('coupon'), 'money', true) +
      kpi('Commission paid', cur.commission, P('commission'), 'money', true) + (cur.profit !== null ? kpi('Profit after expenses', cur.profit, P('profit'), 'money') : kpi('Cancellations', cur.cancellations, P('cancellations'), null, true)) + '</div>';
    var names = {}; Object.keys(cur.byChannel).concat(cmp ? Object.keys(c.byChannel) : []).forEach(function (k) { names[k] = 1; });
    var list = Object.keys(names).sort(function (a, b) { return ((cur.byChannel[b] || {}).taxable || 0) - ((cur.byChannel[a] || {}).taxable || 0); });
    var gx = function (o, k, f) { return o && o[k] ? (o[k][f] || 0) : 0; };
    var charts = lineSvg('Gross revenue over time', cur, cmp) +
      barsHtml('Gross revenue by channel', list.map(function (k) { return { label: k, a: gx(cur.byChannel, k, 'taxable'), b: hasCmp ? gx(c.byChannel, k, 'taxable') : 0 }; }), 'money', hasCmp) +
      barsHtml('Bookings by channel', list.map(function (k) { return { label: k, a: gx(cur.byChannel, k, 'bookings'), b: hasCmp ? gx(c.byChannel, k, 'bookings') : 0 }; }), null, hasCmp) +
      barsHtml('Queries converted by channel', list.filter(function (k) { return gx(cur.byChannel, k, 'queries') || (hasCmp && gx(c.byChannel, k, 'queries')); }).map(function (k) { return { label: k + ' (' + gx(cur.byChannel, k, 'converted') + '/' + gx(cur.byChannel, k, 'queries') + ')', a: gx(cur.byChannel, k, 'converted'), b: hasCmp ? gx(c.byChannel, k, 'converted') : 0 }; }), null, hasCmp);
    var table = '<div class="card"><h3>By channel</h3><table class="tbl"><tr><th>Channel</th><th>Gross</th><th>Net</th><th>Nights</th><th>Conv.</th>' + (hasCmp ? '<th>Change</th>' : '') + '</tr>' +
      list.map(function (k) { var x = cur.byChannel[k] || {}, y = hasCmp ? (c.byChannel[k] || {}) : {}; return '<tr><td>' + esc(k) + '</td><td>' + inr(x.taxable || 0) + '</td><td>' + inr(x.net || 0) + '</td><td>' + (x.nights || 0) + '</td><td>' + (x.queries ? x.conversionPct + '%' : '—') + '</td>' + (hasCmp ? '<td>' + changeBadge(x.taxable || 0, y.taxable || 0) + '</td>' : '') + '</tr>'; }).join('') +
      '</table><p class="small">Gross = after discounts and coupons, before GST. Revenue counts nights stayed in the period; money collected counts payments received in it.' + (sel.length ? ' Expenses and profit are shown only for All channels.' : '') + '</p></div>';
    var actions = '<div class="actions noprint"><button class="btn primary" id="anx">Download Excel</button><button class="btn" id="anpdf">Save as PDF</button></div>';
    return {
      title: 'Analytics', tab: 'reports', back: '#/reports', html: filters + head + actions + tiles + charts + table + actions.replace('id="anx"', 'id="anx2"').replace('id="anpdf"', 'id="anpdf2"'), after: function () {
        bindAn();
        function fileBase() { return 'athulyam-report-' + range.from + '-to-' + range.to + (sel.length ? '-' + sel.join('-').replace(/[^A-Za-z0-9]+/g, '') : ''); }
        function excel() {
          var okCh = function (src) { return !sel.length || sel.indexOf(src) >= 0; };
          var bRows = [['Guest', 'Channel', 'Room', 'Check-in', 'Check-out', 'Nights', 'Status', 'Room ₹', 'Food ₹', 'Other ₹', 'Discount ₹', 'Coupon', 'Coupon ₹', 'Gross excl GST ₹', 'GST ₹', 'Total bill ₹', 'Commission ₹', 'Net ₹', 'Received ₹', 'Outstanding ₹']];
          data.bookings.filter(function (b) { return okCh(b.source) && b.checkIn <= range.to && b.checkOut > range.from && (A.isActive(b) || A.isCancelled(b)); }).sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : 1; }).forEach(function (b) {
            var k = calc(b), M = function (v) { return { v: v, s: 'money' }; };
            bRows.push([b.guestName, b.source, roomsLabel(b), b.checkIn, b.checkOut, k.nights, b.status, M(k.room), M(k.food), M(k.additional + k.cancelFee), M(k.discount), k.couponLabel || '', M(k.coupon), M(k.taxable), M(k.gst), M(k.total), M(k.commission), M(k.net), M(k.received), M(k.outstanding)]);
          });
          var qRows = [['Received', 'Guest', 'Channel', 'Check-in', 'Check-out', 'Quote ₹', 'Status', 'Outcome', 'Coupon']];
          data.queries.filter(function (q) { var d = A.queryDate(q); return okCh(q.channel) && d >= range.from && d <= range.to; }).forEach(function (q) { qRows.push([A.queryDate(q), q.name, q.channel, q.checkIn || '', q.checkOut || '', { v: num(q.quote), s: 'money' }, q.status, q.outcome || '', q.couponCode || '']); });
          var u8 = AHXlsx.report(cur, cmp, { business: s.businessName, label: range.label, cmpLabel: crange ? crange.label : '', channelsLabel: chLabel, generated: fmtDate(t), bookingRows: bRows, queryRows: qRows });
          deliverFile(fileBase() + '.xlsx', u8, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        }
        function pdf() { var old = document.title; document.title = fileBase(); window.print(); setTimeout(function () { document.title = old; }, 1500); }
        ['anx', 'anx2'].forEach(function (id) { $('#' + id).onclick = excel; });
        ['anpdf', 'anpdf2'].forEach(function (id) { $('#' + id).onclick = pdf; });
      }
    };
    function bindAn() {
      var g = function (id) { return $('#' + id); };
      g('anp').onchange = function () { an.preset = this.value; if (an.preset === 'custom' && !an.from) { var lm = A.periodRange('lastMonth', today()); an.from = lm.from; an.to = lm.to; } render(); };
      if (g('ans')) g('ans').onchange = function () { an.seasonId = this.value; render(); };
      if (g('anf')) g('anf').onchange = function () { an.from = this.value; render(); };
      if (g('ant')) g('ant').onchange = function () { an.to = this.value; render(); };
      g('anc').onchange = function () { an.compare = this.value; if (an.compare === 'custom' && !an.cfrom) { an.cfrom = an.from || ''; an.cto = an.to || ''; } render(); };
      if (g('acf')) g('acf').onchange = function () { an.cfrom = this.value; render(); };
      if (g('act')) g('act').onchange = function () { an.cto = this.value; render(); };
      $$('#anch .chip').forEach(function (b) {
        b.onclick = function () {
          var v = b.dataset.ch;
          if (!v) an.channels = [];
          else { var i = an.channels.indexOf(v); if (i >= 0) an.channels.splice(i, 1); else an.channels.push(v); }
          render();
        };
      });
    }
  };

  /* ---------- TODAY ---------- */
  routes.today = function () {
    var t = today(), dr = A.dailyReport(data, t);
    function sec(title, list, msg) { return '<h2>' + title + ' (' + list.length + ')</h2>' + (list.length ? list.map(function (b) { return bookingCard(b, { phone: true }); }).join('') : empty(msg)); }
    return { title: 'Today', tab: 'home', back: '#/home', html: '<div class="today-line">' + fmtDate(t) + '</div>' + sec('Arriving today', dr.checkIns, 'No arrivals today.') + sec('Departing today', dr.checkOuts, 'No departures today.') + sec('In-house tonight', dr.inHouse, 'No guests in-house tonight.') };
  };

  /* ---------- FUTURE BOOKINGS ---------- */
  var futQ = '';
  routes.future = function () {
    var html = '<div class="searchbar"><input id="fq" type="search" placeholder="Search guest, date, room, platform" value="' + esc(futQ) + '"></div><div id="fl"></div>';
    return {
      title: 'Future bookings', tab: 'bookings', back: '#/home', html: html, after: function () {
        function draw() {
          var q = futQ.toLowerCase().trim();
          var list = A.futureBookings(data, today()).filter(function (b) {
            return !q || [b.guestName, b.phone, roomsLabel(b), b.source, b.checkIn, fmtDate(b.checkIn), b.checkOut].join(' ').toLowerCase().indexOf(q) >= 0;
          });
          $('#fl').innerHTML = list.length ? list.map(function (b) { return bookingCard(b, { phone: true }); }).join('') : empty('No future bookings found.', '<a class="btn primary" href="#/new">Add booking</a>');
        }
        $('#fq').oninput = function () { futQ = this.value; draw(); }; draw();
      }
    };
  };

  routes.pending = function () {
    var t = today();
    var list = A.outstandingAll(data).sort(function (a, b) { return a.b.checkIn < b.b.checkIn ? -1 : 1; });
    var owed = list.filter(function (x) { return x.c.outstanding > 0; }), refunds = list.filter(function (x) { return x.c.outstanding < 0; });
    return {
      title: 'Pending payments', tab: 'home', back: '#/home', html: '<div class="tiles">' + tile('Guests owe you', inr(A.sum(owed, function (x) { return x.c.outstanding; })), owed.length + ' booking(s)') +
        tile('You owe (refunds)', inr(A.sum(refunds, function (x) { return -x.c.outstanding; })), refunds.length + ' booking(s)') + '</div>' +
        '<h2>Balances due</h2>' + (owed.length ? owed.map(function (x) { return bookingCard(x.b, { phone: true }); }).join('') : empty('No balances due.')) +
        (refunds.length ? '<h2>Refunds / overpaid</h2>' + refunds.map(function (x) { return bookingCard(x.b, { phone: true }); }).join('') : '')
    };
  };

  /* ---------- ROOM CALENDAR + availability + cleaning ---------- */
  var calMonth = null;
  routes.calendar = function () {
    calMonth = calMonth || thisMonth();
    var s = S(), rooms = A.activeRooms(s), dim = A.daysInMonth(calMonth), t = today();
    var head = '<tr><th class="rn">Room</th>';
    for (var d = 1; d <= dim; d++) { var ds = calMonth + '-' + pad(d); head += '<th class="' + (ds === t ? 'tday' : '') + '">' + d + '</th>'; }
    head += '</tr>';
    var body = rooms.map(function (r) {
      var cells = '<td class="rn">' + esc(r.name) + '</td>';
      for (var d = 1; d <= dim; d++) {
        var ds = calMonth + '-' + pad(d);
        var bk = data.bookings.filter(function (b) { return A.blockedIds(A.roomIds(b), s).indexOf(r.id) >= 0 && (A.isActive(b) || b.status === 'Enquiry') && A.isDate(b.checkIn) && b.checkIn <= ds && b.checkOut > ds; });
        if (bk.length) {
          var b = bk[0], startHere = b.checkIn === ds || d === 1;
          cells += '<td class="occ ' + (bk.length > 1 ? 'clash' : statusClass(b.status)) + '"><a href="#/guest/' + b.id + '" title="' + esc(gname(b)) + '">' + (startHere ? esc((A.roomIds(b).indexOf(r.id) < 0 ? '↳' : '') + gname(b).split(' ')[0].slice(0, 6)) : '') + '</a></td>';
        } else cells += '<td class="free"><a href="#/new/roomId=' + encodeURIComponent(r.id) + '&checkIn=' + ds + '" aria-label="Book ' + esc(r.name) + ' on ' + ds + '"></a></td>';
      }
      return '<tr>' + cells + '</tr>';
    }).join('');
    var html = '<div class="monthbar"><button class="btn sm" id="pm">‹</button><b>' + fmtMonth(calMonth) + '</b><button class="btn sm" id="nm">›</button></div>' +
      (rooms.length ? '<div class="calwrap"><table class="cal">' + head + body + '</table></div>' : empty('Add rooms in Settings first.', '<a class="btn" href="#/settings">Settings</a>')) +
      '<p class="small legend"><span class="lg st-confirmed"></span>Confirmed <span class="lg st-checked-in"></span>In-house <span class="lg st-checked-out"></span>Left <span class="lg st-enquiry"></span>Enquiry <span class="lg clash"></span>Clash · Tap an empty cell to book.</p>' +
      '<h2>Room status today</h2>' + rooms.map(function (r) {
        var occ = data.bookings.filter(function (b) { return A.blockedIds(A.roomIds(b), s).indexOf(r.id) >= 0 && A.isActive(b) && A.isDate(b.checkIn) && b.checkIn <= t && b.checkOut > t; })[0];
        return '<div class="card roomrow"><div><b>' + esc(r.name) + '</b><br><small>' + (occ ? 'Occupied · ' + esc(gname(occ)) + (A.roomIds(occ).indexOf(r.id) < 0 ? ' (via ' + esc(roomsLabel(occ)) + ')' : '') : 'Available tonight') + '</small></div><button class="btn sm ' + (r.clean === false ? 'danger' : '') + '" data-clean="' + r.id + '">' + (r.clean === false ? 'Needs cleaning' : 'Clean ✓') + '</button></div>';
      }).join('');
    return {
      title: 'Room calendar', tab: 'calendar', html: html, after: function () {
        var pm = $('#pm'), nm = $('#nm');
        pm.onclick = function () { calMonth = A.prevMonth(calMonth); render(); };
        nm.onclick = function () { var d = new Date(Date.UTC(+calMonth.slice(0, 4), +calMonth.slice(5, 7), 1)); calMonth = d.toISOString().slice(0, 7); render(); };
        $$('[data-clean]').forEach(function (btn) { btn.onclick = function () { var r = S().rooms.filter(function (x) { return x.id === btn.dataset.clean; })[0]; r.clean = r.clean === false; save(); render(); }; });
        var tc = $('.cal .tday'); if (tc) tc.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
    };
  };

  /* ---------- REPORTS hub ---------- */
  routes.reports = function () {
    var items = [['analytics', 'Analytics & export', 'Compare periods and channels · Excel and PDF with charts'], ['daily', 'Daily summary', 'Check-ins, revenue, collections for any date'], ['monthly', 'Monthly summary', 'Revenue, occupancy, platforms, rooms, profit'],
      ['platform', 'Platform revenue', 'Bookings, commission and net by platform'], ['gst', 'GST summary', 'Taxable value and GST by rate for your CA'],
      ['conversion', 'Query conversion', 'Queries vs bookings by channel'], ['payouts', 'OTA payouts', 'Match what platforms paid you'], ['expenses', 'Expenses', 'Groceries, staff, bills and more'], ['pending', 'Pending payments', 'Who owes what']];
    return { title: 'Reports', tab: 'reports', html: items.map(function (i) { return '<a class="card navrow" href="#/' + i[0] + '"><b>' + i[1] + '</b><small>' + i[2] + '</small></a>'; }).join('') };
  };
  function exportBar(id) { return '<div class="actions noprint"><button class="btn" id="' + id + 'csv">Export CSV</button><button class="btn" onclick="window.print()">Print / Save PDF</button></div>'; }

  var dailyDate = null;
  routes.daily = function () {
    dailyDate = dailyDate || today();
    var r = A.dailyReport(data, dailyDate), rv = r.revenue, col = r.collections;
    var other = r2(col.byMethod.Card + col.byMethod['Bank Transfer'] + col.byMethod['Online Platform']);
    var html = '<div class="noprint">' + field('Report date', '<input type="date" id="dd" value="' + dailyDate + '">') + '</div>' +
      '<div class="printhead">' + esc(S().businessName) + ' — Daily summary, ' + fmtDate(dailyDate) + '</div>' +
      '<div class="tiles">' + tile('Check-ins', String(r.checkIns.length)) + tile('Check-outs', String(r.checkOuts.length)) + tile('In-house', String(r.inHouse.length)) + tile('New bookings', String(r.newBookings.length)) + '</div>' +
      '<div class="card"><h3>Revenue earned for this night</h3><p class="small">Each stay’s charges are spread evenly over its nights, so a booking is never counted twice.</p>' +
      row('Room revenue', inr(rv.room)) + row('Food revenue', inr(rv.food)) + row('Additional charges', inr(rv.additional)) + row('Cancellation fees', inr(rv.cancelFee)) + row('Discounts', '−' + inr(rv.discount)) + row('Coupons', '−' + inr(rv.coupon)) +
      row('Gross (excl. GST)', inr(rv.taxable), 'strong') + row('GST', inr(rv.gst)) + row('Total billed', inr(rv.billed), 'strong') + row('Platform commission', inr(rv.commission)) + row('Net after commission', inr(rv.net), 'strong') + '</div>' +
      '<div class="card"><h3>Money actually received on this date</h3>' + row('Cash', inr(col.byMethod.Cash)) + row('UPI', inr(col.byMethod.UPI)) + row('Card / bank / platform', inr(other)) +
      row('Refunds paid out', '−' + inr(col.refunds)) + row('Net collected', inr(col.net), 'strong') + '</div>' +
      '<div class="card"><h3>Other</h3>' + row('All outstanding guest balances (today)', inr(r.outstandingTotal)) + row('Expenses on this date', inr(r.expenses)) + '</div>' + exportBar('d');
    return {
      title: 'Daily summary', tab: 'reports', back: '#/reports', html: html, after: function () {
        $('#dd').onchange = function () { if (A.isDate(this.value)) { dailyDate = this.value; render(); } };
        $('#dcsv').onclick = function () {
          deliverFile('daily-summary-' + dailyDate + '.csv', csv([['Athulyam Homes daily summary', dailyDate], [], ['Check-ins', r.checkIns.length], ['Check-outs', r.checkOuts.length], ['In-house', r.inHouse.length], ['New bookings', r.newBookings.length],
            ['Room revenue', rv.room], ['Food revenue', rv.food], ['Additional', rv.additional], ['Cancellation fees', rv.cancelFee], ['Discounts', rv.discount], ['Coupons', rv.coupon], ['Gross excl GST', rv.taxable], ['GST', rv.gst], ['Total billed', rv.billed],
            ['Commission', rv.commission], ['Net after commission', rv.net], ['Cash collected', col.byMethod.Cash], ['UPI collected', col.byMethod.UPI], ['Other collected', other], ['Refunds', col.refunds], ['Net collected', col.net],
            ['Outstanding balances', r.outstandingTotal], ['Expenses', r.expenses]]), 'text/csv');
        };
      }
    };
  };

  var mMonth = null;
  routes.monthly = function () {
    mMonth = mMonth || thisMonth();
    var r = A.monthlyReport(data, mMonth), rv = r.revenue;
    function grpTable(g, nameFn) {
      var keys = Object.keys(g);
      if (!keys.length) return '<p class="small">No revenue this month.</p>';
      return '<table class="tbl"><tr><th></th><th>Nights</th><th>Gross</th><th>Net</th></tr>' + keys.sort(function (a, b) { return g[b].taxable - g[a].taxable; }).map(function (k) {
        return '<tr><td>' + esc(nameFn ? nameFn(k) : k) + '</td><td>' + g[k].nights + '</td><td>' + inr(g[k].taxable) + '</td><td>' + inr(g[k].net) + '</td></tr>';
      }).join('') + '</table>';
    }
    var html = '<div class="noprint">' + field('Month', '<input type="month" id="mm" value="' + mMonth + '">') + '</div>' +
      '<div class="printhead">' + esc(S().businessName) + ' — Monthly summary, ' + fmtMonth(mMonth) + '</div>' +
      '<div class="tiles">' + tile('Bookings (arrivals)', String(r.bookings), r.cancellations + ' cancelled') + tile('Room nights sold', String(rv.nights), 'occupancy ' + r.occupancyPct + '%') +
      tile('Avg per room night', inr(r.avgPerNight), 'room only ' + inr(r.avgRoomRate)) + tile('Profit', inr(r.profit), 'after commission & expenses', r.profit < 0 ? 'neg' : '') + '</div>' +
      '<div class="card"><h3>Revenue earned (nights in this month)</h3>' + row('Room revenue', inr(rv.room)) + row('Food revenue', inr(rv.food)) + row('Other charges', inr(rv.additional)) + row('Cancellation fees', inr(rv.cancelFee)) +
      row('Discounts', '−' + inr(rv.discount)) + row('Coupons', '−' + inr(rv.coupon)) + row('Total gross revenue (excl. GST)', inr(rv.taxable), 'strong') + row('GST billed', inr(rv.gst)) + row('Platform commissions', '−' + inr(rv.commission)) + row('Net after commission', inr(rv.net), 'strong') + '</div>' +
      '<div class="card"><h3>Money</h3>' + row('Payments received this month', inr(r.collections.received)) + row('Refunds paid', '−' + inr(r.collections.refunds)) + row('Net collected', inr(r.collections.net), 'strong') +
      row('Pending on this month’s stays', inr(r.pending)) + row('Expenses', '−' + inr(r.expenses)) + row('Profit (net revenue − expenses)', inr(r.profit), 'strong') + '</div>' +
      '<div class="card"><h3>By booking platform</h3>' + grpTable(r.byPlatform) + '</div>' +
      '<div class="card"><h3>By room</h3>' + grpTable(r.byRoom, roomName) + '</div>' +
      '<div class="card"><h3>Expenses by category</h3>' + (Object.keys(r.expensesByCategory).length ? Object.keys(r.expensesByCategory).map(function (k) { return row(k, inr(r.expensesByCategory[k])); }).join('') : '<p class="small">No expenses recorded.</p>') + '</div>' + exportBar('m');
    return {
      title: 'Monthly summary', tab: 'reports', back: '#/reports', html: html, after: function () {
        $('#mm').onchange = function () { if (/^\d{4}-\d{2}$/.test(this.value)) { mMonth = this.value; render(); } };
        $('#mcsv').onclick = function () {
          var rows = [['Athulyam Homes monthly summary', mMonth], [], ['Bookings (arrivals)', r.bookings], ['Cancellations', r.cancellations], ['Room nights', rv.nights], ['Occupancy %', r.occupancyPct], ['Avg per room night', r.avgPerNight],
            ['Room revenue', rv.room], ['Food revenue', rv.food], ['Other charges', rv.additional], ['Cancellation fees', rv.cancelFee], ['Discounts', rv.discount], ['Coupons', rv.coupon], ['Gross excl GST', rv.taxable], ['GST', rv.gst], ['Commission', rv.commission], ['Net after commission', rv.net],
            ['Payments received', r.collections.received], ['Refunds', r.collections.refunds], ['Pending', r.pending], ['Expenses', r.expenses], ['Profit', r.profit], [], ['Platform', 'Nights', 'Gross', 'Commission', 'Net']];
          Object.keys(r.byPlatform).forEach(function (k) { var g = r.byPlatform[k]; rows.push([k, g.nights, g.taxable, g.commission, g.net]); });
          rows.push([], ['Room', 'Nights', 'Gross', 'Commission', 'Net']);
          Object.keys(r.byRoom).forEach(function (k) { var g = r.byRoom[k]; rows.push([roomName(k), g.nights, g.taxable, g.commission, g.net]); });
          rows.push([], ['Expense category', 'Amount']);
          Object.keys(r.expensesByCategory).forEach(function (k) { rows.push([k, r.expensesByCategory[k]]); });
          deliverFile('monthly-summary-' + mMonth + '.csv', csv(rows), 'text/csv');
        };
      }
    };
  };

  var pFrom = null, pTo = null;
  routes.platform = function () {
    pFrom = pFrom || A.monthStart(thisMonth()); pTo = pTo || A.monthEnd(thisMonth());
    var r = A.platformReport(data, pFrom, pTo), keys = Object.keys(r);
    var tot = { bookings: 0, room: 0, food: 0, commission: 0, net: 0, collected: 0, outstanding: 0, taxable: 0 };
    keys.forEach(function (k) { Object.keys(tot).forEach(function (f) { tot[f] = r2(tot[f] + r[k][f]); }); });
    var html = '<div class="two noprint">' + field('From (arrival)', '<input type="date" id="pf1" value="' + pFrom + '">') + field('To', '<input type="date" id="pf2" value="' + pTo + '">') + '</div>' +
      '<div class="printhead">' + esc(S().businessName) + ' — Platform revenue, ' + fmtDate(pFrom) + ' to ' + fmtDate(pTo) + '</div>' +
      '<p class="small">Bookings are grouped by arrival date and counted once, with their full amounts.</p>' +
      (keys.length ? keys.sort(function (a, b) { return r[b].taxable - r[a].taxable; }).map(function (k) {
        var x = r[k];
        return '<div class="card"><h3>' + esc(k) + ' <span class="pill">' + x.bookings + ' booking' + (x.bookings === 1 ? '' : 's') + '</span></h3>' +
          row('Gross room revenue', inr(x.room)) + row('Food revenue', inr(x.food)) + row('Other / fees', inr(x.other)) + row('Discounts', '−' + inr(x.discount)) + row('Coupons', '−' + inr(x.coupon)) + row('Gross (excl. GST)', inr(x.taxable), 'strong') +
          row('Platform commission', '−' + inr(x.commission)) + row('Net after commission', inr(x.net), 'strong') + '<hr>' + row('Amount collected', inr(x.collected)) + row('Outstanding', inr(x.outstanding), x.outstanding > 0 ? 'due' : '') + '</div>';
      }).join('') + '<div class="card"><h3>All platforms</h3>' + row('Bookings', String(tot.bookings)) + row('Gross (excl. GST)', inr(tot.taxable)) + row('Commission', inr(tot.commission)) + row('Net', inr(tot.net), 'strong') + row('Collected', inr(tot.collected)) + row('Outstanding', inr(tot.outstanding)) + '</div>'
        : empty('No bookings arriving in this period.')) + exportBar('p');
    return {
      title: 'Platform revenue', tab: 'reports', back: '#/reports', html: html, after: function () {
        $('#pf1').onchange = function () { if (A.isDate(this.value)) { pFrom = this.value; render(); } };
        $('#pf2').onchange = function () { if (A.isDate(this.value)) { pTo = this.value; render(); } };
        $('#pcsv').onclick = function () {
          var rows = [['Platform', 'Bookings', 'Room revenue', 'Food revenue', 'Other', 'Discount', 'Gross excl GST', 'GST', 'Commission', 'Net after commission', 'Collected', 'Outstanding']];
          keys.forEach(function (k) { var x = r[k]; rows.push([k, x.bookings, x.room, x.food, x.other, x.discount, x.taxable, x.gst, x.commission, x.net, x.collected, x.outstanding]); });
          deliverFile('platform-revenue-' + pFrom + '-to-' + pTo + '.csv', csv(rows), 'text/csv');
        };
      }
    };
  };

  var gMonth = null;
  routes.gst = function () {
    gMonth = gMonth || thisMonth();
    var g = A.gstSummary(data, gMonth);
    var html = '<div class="noprint">' + field('Month', '<input type="month" id="gm" value="' + gMonth + '">') + '</div>' +
      '<div class="printhead">' + esc(S().businessName) + (S().gstin ? ' (GSTIN ' + esc(S().gstin) + ')' : '') + ' — GST summary, ' + fmtMonth(gMonth) + '</div>' +
      '<p class="small">Bills are dated on the check-out date. Only bookings with GST switched on are included. Share this with your CA; it is a working summary, not a filed return.</p>' +
      (g.rows.length ? '<div class="card"><table class="tbl"><tr><th>Type</th><th>Rate</th><th>Taxable</th><th>GST</th></tr>' + g.rows.map(function (x) {
        return '<tr><td>' + esc(x.kind) + '</td><td>' + x.rate + '%</td><td>' + inr(x.taxable) + '</td><td>' + inr(x.gst) + '</td></tr>';
      }).join('') + '<tr class="strong"><td>Total</td><td></td><td>' + inr(g.taxable) + '</td><td>' + inr(g.gst) + '</td></tr></table>' +
        row('CGST (half)', inr(g.gst / 2)) + row('SGST (half)', inr(g.gst / 2)) + '</div>' : empty('No GST bills with check-out in this month.')) + exportBar('g');
    return {
      title: 'GST summary', tab: 'reports', back: '#/reports', html: html, after: function () {
        $('#gm').onchange = function () { if (/^\d{4}-\d{2}$/.test(this.value)) { gMonth = this.value; render(); } };
        $('#gcsv').onclick = function () {
          var rows = [['Type', 'GST rate %', 'Taxable value', 'GST', 'CGST', 'SGST', 'Bills']];
          g.rows.forEach(function (x) { rows.push([x.kind, x.rate, x.taxable, x.gst, r2(x.gst / 2), r2(x.gst / 2), x.invoices]); });
          rows.push([], ['Bill-wise detail'], ['Check-out', 'Guest', 'Room', 'Platform', 'Room taxable', 'Room GST', 'Food taxable', 'Food GST', 'Other taxable', 'Other GST', 'Total bill']);
          data.bookings.filter(function (b) { return A.isActive(b) && b.gstOn && A.monthOf(b.checkOut) === gMonth; }).forEach(function (b) {
            var c = calc(b); rows.push([b.checkOut, b.guestName, roomsLabel(b), b.source, c.roomTaxable, c.gstRoom, c.foodTaxable, c.gstFood, c.otherTaxable, c.gstOther, c.total]);
          });
          deliverFile('gst-summary-' + gMonth + '.csv', csv(rows), 'text/csv');
        };
      }
    };
  };

  var poMonth = null;
  routes.payouts = function () {
    poMonth = poMonth || thisMonth();
    var list = A.payoutReport(data, A.monthStart(poMonth), A.monthEnd(poMonth));
    var html = field('Check-out month', '<input type="month" id="pom" value="' + poMonth + '">') +
      '<p class="small">Expected payout = money the platform collected from the guest (payments marked "Online Platform") minus commission. Enter the actual payout on each guest’s page.</p>' +
      (list.length ? list.map(function (x) {
        return '<a class="card bk" href="#/guest/' + x.b.id + '"><div class="bk-top"><b>' + esc(x.b.guestName) + '</b><span class="st ' + (x.matched ? 'st-checked-in' : 'st-cancelled') + '">' + (x.matched ? 'Matched' : (x.received ? 'Mismatch' : 'Awaiting')) + '</span></div>' +
          '<div class="bk-mid">' + esc(x.b.source) + ' · out ' + fmtShort(x.b.checkOut) + '</div><div class="bk-bot"><span>Expected ' + inr(x.expected) + '</span><span>Got ' + inr(x.received) + '</span><span class="' + (Math.abs(x.difference) >= 1 ? 'due' : '') + '">Diff ' + inr(x.difference) + '</span></div></a>';
      }).join('') : empty('No platform-collected bookings checking out this month.'));
    return { title: 'OTA payouts', tab: 'reports', back: '#/reports', html: html, after: function () { $('#pom').onchange = function () { if (this.value) { poMonth = this.value; render(); } }; } };
  };

  /* ---------- EXPENSES ---------- */
  var exMonth = null;
  routes.expenses = function () {
    exMonth = exMonth || thisMonth();
    var s = S(), list = data.expenses.filter(function (e) { return A.monthOf(e.date) === exMonth; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    var html = '<form id="ef" class="card" novalidate><h3>Add expense</h3><div class="two">' +
      field('Amount ₹', '<input name="amount" type="number" inputmode="decimal" min="0" step="any">') + field('Date', '<input name="date" type="date" value="' + today() + '">') + '</div><div class="two">' +
      field('Category', '<select name="category">' + options(s.expenseCats, s.expenseCats[0]) + '</select>') + field('Paid by', '<select name="method">' + options(['Cash', 'UPI', 'Card', 'Bank Transfer'], 'Cash') + '</select>') + '</div>' +
      field('Note', '<input name="note" placeholder="e.g. vegetables, Ramesh salary">') + '<div id="eerr"></div><button class="btn primary" type="submit">Add expense</button></form>' +
      field('Month', '<input type="month" id="em" value="' + exMonth + '">') +
      '<div class="tiles">' + tile('Spent in ' + fmtMonth(exMonth), inr(A.sum(list, function (e) { return e.amount; })), list.length + ' entries') + '</div>' +
      (list.length ? list.map(function (e) { return '<div class="card pay"><div><b>' + inr(e.amount) + '</b> ' + esc(e.category) + '<br><small>' + fmtDate(e.date) + ' · ' + esc(e.method) + (e.note ? ' · ' + esc(e.note) : '') + '</small></div><button class="x" data-delex="' + e.id + '" aria-label="Delete expense">✕</button></div>'; }).join('') : empty('No expenses this month.'));
    return {
      title: 'Expenses', tab: 'reports', back: '#/reports', html: html, after: function () {
        $('#ef').onsubmit = function (ev) {
          ev.preventDefault();
          var f = this, amt = r2(f.elements.amount.value);
          if (!(amt > 0)) return ($('#eerr').innerHTML = '<div class="warn">Enter an amount greater than ₹0.</div>');
          if (!A.isDate(f.elements.date.value)) f.elements.date.value = today();
          data.expenses.push({ id: uid(), amount: amt, date: f.elements.date.value, category: f.elements.category.value, method: f.elements.method.value, note: f.elements.note.value.trim(), createdAt: nowISO(), updatedAt: nowISO() });
          exMonth = A.monthOf(f.elements.date.value);
          save().then(function () { toast('Expense added'); render(); });
        };
        $('#em').onchange = function () { if (this.value) { exMonth = this.value; render(); } };
        $$('[data-delex]').forEach(function (b) { b.onclick = function () { if (!confirm('Delete this expense?')) return; data.expenses = data.expenses.filter(function (e) { return e.id !== b.dataset.delex; }); save().then(function () { toast('Expense deleted'); render(); }); }; });
      }
    };
  };

  /* ---------- CONFIRMATION / INVOICE (print or save as PDF) ---------- */
  routes.bill = function (arg) {
    var id = String(arg || '').split('/')[0], kind = String(arg || '').split('/')[1] || '';
    var b = booking(id); if (!b) return { title: 'Not found', html: empty('Booking not found.'), back: '#/bookings' };
    kind = kind === 'statement' ? 'statement' : kind === 'invoice' || (!kind && b.status === 'Checked Out') ? 'invoice' : 'confirmation';
    var html = '<div class="actions noprint"><button class="btn primary" onclick="window.print()">Print / Save as PDF</button>' +
      '<a class="btn' + (kind === 'confirmation' ? ' on' : '') + '" href="#/bill/' + b.id + '/confirmation">Confirmation</a>' + '<a class="btn' + (kind === 'statement' ? ' on' : '') + '" href="#/bill/' + b.id + '/statement">Food & services</a>' +
      (b.status === 'Checked Out' ? '<a class="btn' + (kind === 'invoice' ? ' on' : '') + '" href="#/bill/' + b.id + '/invoice">Invoice</a>' : '') + '</div>' +
      (kind === 'invoice' && !b.invoiceNo ? '<div class="warn noprint">The invoice number is given by your Google Sheet at the next sync.</div>' : '') +
      '<div class="docwrap">' + A.docHtml(kind, b, data) + '</div>';
    return { title: kind === 'invoice' ? 'Tax invoice' : kind === 'statement' ? 'Food & services statement' : 'Booking confirmation', back: kind === 'statement' ? '#/fs/' + b.id : '#/guest/' + b.id, tab: 'bookings', html: html };
  };

  /* ---------- IMPORT OLD BOOKINGS (prepared file from the Numbers sheets) ---------- */
  var oldImp = null;
  routes.importbk = function () {
    var s = S(), rooms = s.rooms.filter(function (r) { return r.active !== false; });
    if (!oldImp) {
      return { title: 'Import old bookings', tab: 'more', back: '#/more', html: '<div class="card"><h3>Step 1 — choose the file</h3><p class="small">Choose <b>athulyam-old-bookings.json</b> (sent to you with this update). It holds the bookings from your old Numbers sheets. It stays on this device until you import; nothing is uploaded.</p>' +
        '<input type="file" id="obf" accept=".json,application/json"></div>', after: function () {
          $('#obf').onchange = function () {
            var f = this.files && this.files[0]; if (!f) return;
            f.text().then(function (t) {
              var j = JSON.parse(t); if (j.app !== 'athulyam-old-bookings' || !Array.isArray(j.bookings)) throw new Error('This is not the old-bookings file.');
              var map = {};
              Object.keys(j.roomTypes || {}).forEach(function (type) {
                var whole = /4\s*rooms|whole|entire/i.test(type), key = type.toLowerCase().replace(/\(.*?\)/g, '').replace(/\b(room|rooms)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
                var guess = whole ? rooms.filter(function (r) { return !/villa|2\s*bhk/i.test(r.name); }) : rooms.filter(function (r) {
                  var n = r.name.toLowerCase(); return key.split(' ').filter(function (w) { return w.length > 2; }).some(function (w) { return n.indexOf(w) >= 0; });
                });
                map[type] = { rooms: guess.map(function (r) { return r.id; }), whole: whole };
              });
              oldImp = { file: j, map: map }; render();
            }).catch(function (e) { toast('Could not read the file: ' + e.message, true); });
          };
        } };
    }
    var j = oldImp.file, past = j.bookings.filter(function (b) { return b.past; }).length;
    var html = '<div class="card"><h3>' + j.bookings.length + ' bookings found</h3><p class="small">' + past + ' past stays and ' + (j.bookings.length - past) + ' upcoming. Last numbers: ' +
      'numbered ATH-000001 to ' + A.bookingNo(j.lastNo || j.bookings.length, s.bookingPrefix) + ' in arrival order. New bookings continue from the next number.</p>' +
      '<p class="small">Amounts include GST, as in your sheet; the app works out the GST inside them (rooms 12% before 22 Sep 2025, 5% after; food 5%) so every total stays the same.</p></div>' +
      '<div class="card"><h3>Step 2 — match the old room types to your rooms</h3>' + Object.keys(oldImp.map).map(function (type, ti) {
        var m = oldImp.map[type];
        return '<div class="fld"><span><b>' + esc(type) + '</b> <small>(up to ' + j.roomTypes[type] + ' at once)</small></span><div class="chips wrap">' + rooms.map(function (r) {
          return '<label class="chip' + (m.rooms.indexOf(r.id) >= 0 ? ' on' : '') + '"><input type="checkbox" hidden data-mt="' + ti + '" value="' + r.id + '"' + (m.rooms.indexOf(r.id) >= 0 ? ' checked' : '') + '>' + esc(r.name) + '</label>';
        }).join('') + '</div><label class="chk sm"><input type="checkbox" data-whole="' + ti + '"' + (m.whole ? ' checked' : '') + '> Whole property: use every room ticked</label></div>';
      }).join('') + (rooms.length ? '' : '<div class="warn">Add your rooms first in More → Settings.</div>') +
      '<p class="small">Otherwise a booking uses as many of the ticked rooms as it had in the sheet (for example 2 × Deluxe AC Room).</p></div>' +
      '<div class="card"><h3>Step 3 — import</h3><p class="small">Past stays are marked as imported: no Drive folder, invoice, Form C or review reminders are made for them. Upcoming ones become normal bookings. Payments are recorded with method “Not recorded”. Stays you already entered in the app are skipped.</p>' +
      '<button class="btn primary big" id="obgo">Import ' + j.bookings.length + ' bookings</button><button class="btn" id="obcancel">Choose another file</button><div id="obres"></div></div>';
    return { title: 'Import old bookings', tab: 'more', back: '#/more', html: html, after: function () {
      var types = Object.keys(oldImp.map);
      $$('[data-mt]').forEach(function (el) { el.onchange = function () { var m = oldImp.map[types[+el.dataset.mt]]; m.rooms = $$('[data-mt="' + el.dataset.mt + '"]').filter(function (x) { return x.checked; }).map(function (x) { return x.value; }); el.parentNode.classList.toggle('on', el.checked); }; });
      $$('[data-whole]').forEach(function (el) { el.onchange = function () { oldImp.map[types[+el.dataset.whole]].whole = el.checked; }; });
      $('#obcancel').onclick = function () { oldImp = null; render(); };
      $('#obgo').onclick = function () {
        var miss = types.filter(function (t) { return !oldImp.map[t].rooms.length; });
        if (miss.length && !confirm('No room ticked for: ' + miss.join(', ') + '. Those bookings will be skipped. Continue?')) return;
        var res = A.importOld(data, oldImp.file, oldImp.map, { now: nowISO() });
        res.bookings.forEach(function (b) { data.bookings.push(b); });
        res.payments.forEach(function (p) { data.payments.push(p); });
        if (res.bookings.some(function (b) { return b.source === 'Not recorded'; }) && s.sources.indexOf('Not recorded') < 0) s.sources.push('Not recorded');
        save().then(function () {
          oldImp = null;
          $('#main').innerHTML = '<div class="card"><h3>Imported ' + res.bookings.length + ' bookings and ' + res.payments.length + ' payments</h3>' +
            (res.duplicates.length ? '<p><b>' + res.duplicates.length + ' skipped — already in the app:</b></p><p class="small">' + res.duplicates.map(function (d) { return esc(d.no + ' ' + d.guest + ' (' + d.checkIn + ') = your ' + d.existing); }).join('<br>') + '</p>' : '') +
            (res.skipped.length ? '<p><b>' + res.skipped.length + ' not imported:</b></p><p class="small">' + res.skipped.map(function (d) { return esc(d.no + ' ' + d.guest + ': ' + d.why); }).join('<br>') + '</p>' : '') +
            '<p class="small">Next: More → Settings → Sync now. Your laptop and the Sheet get them at their next sync.</p><a class="btn primary" href="#/bookings">See bookings</a> <a class="btn" href="#/analytics">Open analytics</a></div>';
        });
      };
    } };
  };

  /* ---------- MORE ---------- */
  routes.more = function () {
    var items = [['today', 'Today’s arrivals & departures'], ['future', 'Future bookings'], ['pending', 'Pending payments'], ['reminders', 'Notifications & reminders'],
      ['backup', 'Backup & restore'], ['importbk', 'Import old bookings'], ['import', 'Import old queries'], ['settings', 'Settings'], ['about', 'Where my data is stored']];
    return { title: 'More', tab: 'more', html: items.map(function (i) { return '<a class="card navrow" href="#/' + i[0] + '"><b>' + i[1] + '</b></a>'; }).join('') + '<p class="small center">Version ' + APP_VERSION + '</p>' };
  };

  /* ---------- REMINDERS ---------- */
  routes.reminders = function () {
    var r = S().reminders, synced = !!S().syncUrl;
    function hourSel(name, v) { var o = ''; for (var h = 0; h < 24; h++) o += '<option value="' + h + '"' + (Number(v) === h ? ' selected' : '') + '>' + (h % 12 || 12) + ':00 ' + (h < 12 ? 'AM' : 'PM') + '</option>'; return '<select name="' + name + '">' + o + '</select>'; }
    var html = '<div class="card"><h3>How reminders work on your phone</h3><p class="small">A home-screen web app cannot schedule its own notifications while it is closed, so this app does not pretend to. You get two reliable, free routes instead:</p>' +
      '<p class="small"><b>1. Email reminders with your real numbers</b> — sent by your Google Sheet at the hours below (IST), within that hour. Gmail on your phone shows them as notifications. Needs the Sheet set up (Settings → Cloud sync) and at least one sync. Status: <b>' + (synced ? 'Sheet connected' : 'not set up yet') + '</b>.</p>' +
      '<p class="small"><b>2. iPhone/Android calendar alarms</b> — add the daily reminder events below to your phone calendar once. They ring even with no internet and remind you to open the app.</p></div>' +
      '<form id="rf" class="card"><h3>Reminder times (IST)</h3><label class="chk"><input type="checkbox" name="enabled"' + (r.enabled ? ' checked' : '') + '> Email reminders on</label>' +
      field('Today’s arrivals + Form C due', hourSel('arrivals', r.arrivals)) + field('Pending payments & unpaid advances', hourSel('payments', r.payments)) +
      field('Daily revenue & collections', hourSel('summary', r.summary)) + field('Monthly summary (1st of month)', hourSel('monthly', r.monthly)) +
      '<button class="btn primary" type="submit">Save times</button><p class="small">New times reach the Sheet at the next sync.</p></form>' +
      '<div class="card"><h3>Phone calendar alarms</h3><button class="btn" id="dailyIcs">Add daily reminders to calendar</button><button class="btn" id="arrIcs">Add all upcoming arrivals to calendar</button><p class="small">Opens your calendar app with the events. Arrival alarms ring at 8 AM on the day.</p></div>';
    return {
      title: 'Reminders', tab: 'more', back: '#/more', html: html, after: function () {
        $('#rf').onsubmit = function (ev) {
          ev.preventDefault(); var f = this;
          S().reminders = { enabled: f.elements.enabled.checked, arrivals: +f.elements.arrivals.value, payments: +f.elements.payments.value, summary: +f.elements.summary.value, monthly: +f.elements.monthly.value };
          save().then(function () { toast('Reminder times saved'); });
        };
        $('#dailyIcs').onclick = function () {
          var d = today(), rr = S().reminders;
          deliverFile('athulyam-daily-reminders.ics', ics([
            { uid: 'ah-arrivals', start: icsTime(d, rr.arrivals), end: icsTime(d, rr.arrivals, 15), rrule: 'FREQ=DAILY', title: 'Athulyam: check today’s arrivals', desc: 'Open the Guest Manager app.' },
            { uid: 'ah-payments', start: icsTime(d, rr.payments), end: icsTime(d, rr.payments, 15), rrule: 'FREQ=DAILY', title: 'Athulyam: follow up pending payments', desc: 'Open Pending payments.' },
            { uid: 'ah-summary', start: icsTime(d, rr.summary), end: icsTime(d, rr.summary, 15), rrule: 'FREQ=DAILY', title: 'Athulyam: record today’s payments & expenses', desc: 'Check the daily summary.' },
            { uid: 'ah-monthly', start: icsTime(d.slice(0, 8) + '01', rr.monthly), end: icsTime(d.slice(0, 8) + '01', rr.monthly, 15), rrule: 'FREQ=MONTHLY;BYMONTHDAY=1', title: 'Athulyam: review last month & take a backup', desc: 'Monthly summary + Backup.' }
          ]), 'text/calendar');
        };
        $('#arrIcs').onclick = function () {
          var list = A.futureBookings(data, today()).filter(function (b) { return b.status === 'Confirmed'; });
          if (!list.length) return toast('No confirmed upcoming arrivals.', true);
          deliverFile('athulyam-arrivals.ics', ics(list.map(function (b) {
            var c = calc(b); return { uid: b.id, start: icsTime(b.checkIn, 12), end: icsTime(b.checkIn, 13), title: 'Arrival: ' + b.guestName + ' (' + roomsLabel(b) + ')', desc: c.nights + ' nights · ' + b.source + ' · balance ' + inr(c.outstanding), alarm: '-PT4H' };
          })), 'text/calendar');
        };
      }
    };
  };

  /* ---------- BACKUP & RESTORE ---------- */
  routes.backup = function () {
    var lb = data.meta.lastBackup, ls = data.meta.lastSync;
    var html = '<div class="card"><h3>Status</h3>' + row('Last backup file', lb ? fmtDate(lb.slice(0, 10)) : 'Never') + row('Last cloud sync', ls ? fmtDate(ls.slice(0, 10)) + ' ' + ls.slice(11, 16) + ' UTC' : 'Not set up') +
      row('Records', data.bookings.length + ' bookings · ' + data.queries.length + ' queries · ' + data.payments.length + ' payments · ' + data.expenses.length + ' expenses') + '</div>' +
      '<div class="card"><h3>Backup file (JSON)</h3><p class="small">Contains everything: settings, rooms, bookings, guest details, payments and expenses. It is not encrypted, so save it somewhere private (your own Google Drive or iCloud Files) and never post it publicly.</p><button class="btn primary" id="bk">Export backup</button></div>' +
      '<div class="card"><h3>Restore</h3><p class="small"><b>Merge</b> adds missing records and updates older ones — nothing is duplicated, matched by record ID. <b>Replace</b> wipes this phone first.</p>' +
      '<input type="file" id="rfile" accept=".json,application/json"><div class="actions"><button class="btn" id="rmerge">Merge from file</button><button class="btn danger" id="rrepl">Replace with file</button></div><div id="rmsg"></div></div>' +
      '<a class="card navrow" href="#/import"><b>Import old queries</b><small>From Numbers, Excel or Google Sheets</small></a>' +
      '<div class="card"><h3>Spreadsheet exports (CSV)</h3><div class="actions"><button class="btn" id="cb">Bookings</button><button class="btn" id="cp">Payments</button><button class="btn" id="ce">Expenses</button><button class="btn" id="cq">Queries</button><button class="btn" id="cgu">Guests & IDs</button></div></div>' +
      '<div class="card"><h3>Clear this device</h3><p class="small">Removes the records from this phone or laptop only, for example to start a second device fresh from your Google Sheet. Nothing is deleted from the Sheet or your other devices; Sync now downloads everything again. To delete a booking everywhere, open it and use Delete booking.</p><button class="btn danger" id="wipe">Clear this device</button></div>';
    return {
      title: 'Backup & restore', tab: 'more', back: '#/more', html: html, after: function () {
        $('#bk').onclick = function () {
          var payload = JSON.stringify({ app: 'athulyam-guest-manager', version: APP_VERSION, exportedAt: nowISO(), settings: Object.assign({}, data.settings, { pinHash: '', pinSalt: '', syncToken: '' }), bookings: data.bookings, payments: data.payments, expenses: data.expenses, queries: data.queries }, null, 1);
          deliverFile('athulyam-backup-' + today() + '.json', payload, 'application/json').then(function (ok) {
            if (ok) { data.meta.lastBackup = nowISO(); save(true).then(function () { toast('Backup exported'); render(); }); }
          });
        };
        function readFile(cb) {
          var f = $('#rfile').files[0]; if (!f) return toast('Choose a backup file first.', true);
          var rd = new FileReader();
          rd.onload = function () {
            try { var j = JSON.parse(rd.result); if (j.app !== 'athulyam-guest-manager' || !Array.isArray(j.bookings)) throw new Error('This is not an Athulyam backup file.'); cb(j); }
            catch (e) { $('#rmsg').innerHTML = '<div class="warn">' + esc(e.message) + '</div>'; }
          };
          rd.readAsText(f);
        }
        $('#rmerge').onclick = function () {
          readFile(function (j) {
            var res = A.merge(data, j); A.migrateEnquiries(data);
            mergeSettingsLists(j.settings);
            save().then(function () { $('#rmsg').innerHTML = '<div class="ok">Merged: ' + res.added + ' added, ' + res.updated + ' updated, ' + res.skipped + ' already up to date.</div>'; });
          });
        };
        $('#rrepl').onclick = function () {
          readFile(function (j) {
            if (!confirm('Replace ALL data on this phone with this backup (' + j.bookings.length + ' bookings)? This cannot be undone.')) return;
            var keep = { pinHash: data.settings.pinHash, pinSalt: data.settings.pinSalt, syncToken: data.settings.syncToken, syncUrl: data.settings.syncUrl };
            data.settings = Object.assign(defaultSettings(), j.settings || {}, keep);
            data.bookings = j.bookings || []; data.payments = j.payments || []; data.expenses = j.expenses || []; data.queries = j.queries || []; A.migrateEnquiries(data);
            save().then(function () { $('#rmsg').innerHTML = '<div class="ok">Restored ' + data.bookings.length + ' bookings.</div>'; });
          });
        };
        $('#cb').onclick = function () {
          var rows = [['Booking no', 'Booking ID', 'Guest', 'Phone', 'Email', 'From query', 'Nationality', 'Country', 'Form C filed', 'ID type', 'ID (stored)', 'Adults', 'Children', 'Room', 'Check-in', 'Check-out', 'Nights', 'Source', 'Status',
            'Room charges', 'Food', 'Additional', 'Discount', 'Coupon code', 'Coupon', 'Cancellation fee', 'Taxable', 'GST', 'Total bill', 'Commission', 'Net after commission', 'Received', 'Outstanding', 'Payout received', 'Created', 'Special requests', 'Notes']];
          data.bookings.forEach(function (b) {
            var c = calc(b);
            rows.push([b.no || '', b.id, b.guestName, b.phone, b.email, b.queryId ? 'Yes' : 'No', b.nationality, b.country, b.formCFiled ? 'Yes' : 'No', b.idType, b.idValue, b.adults, b.children, roomsLabel(b), b.checkIn, b.checkOut, c.nights, b.source, b.status,
              c.room, c.food, c.additional, c.discount, b.couponCode || '', c.coupon, c.cancelFee, c.taxable, c.gst, c.total, c.commission, c.net, c.received, c.outstanding, b.payoutReceived, (b.createdAt || '').slice(0, 10), b.specialRequests, b.notes]);
          });
          deliverFile('athulyam-bookings-' + today() + '.csv', csv(rows), 'text/csv');
        };
        $('#cp').onclick = function () {
          var rows = [['Payment ID', 'Booking ID', 'Guest', 'Type', 'Date', 'Amount', 'Method', 'Reference']];
          data.payments.forEach(function (p) { var b = booking(p.bookingId) || {}; rows.push([p.id, p.bookingId, b.guestName || '', p.type || 'payment', p.date, p.amount, p.method, p.ref]); });
          deliverFile('athulyam-payments-' + today() + '.csv', csv(rows), 'text/csv');
        };
        $('#ce').onclick = function () {
          var rows = [['Expense ID', 'Date', 'Category', 'Amount', 'Paid by', 'Note']];
          data.expenses.forEach(function (e) { rows.push([e.id, e.date, e.category, e.amount, e.method, e.note]); });
          deliverFile('athulyam-expenses-' + today() + '.csv', csv(rows), 'text/csv');
        };
        $('#cgu').onclick = function () {
          var rows = [['Booking no', 'Check-in', 'Check-out', 'Rooms', 'Guest', 'Main guest', 'Adult/child', 'Gender', 'Date of birth', 'Nationality', 'Country', 'Mobile', 'ID type', 'ID number', 'Passport no', 'Passport expiry', 'Visa no', 'Visa type', 'Visa valid till', 'Form C arrival', 'Form C departure', 'Documents', 'In Drive']];
          data.bookings.forEach(function (b) { A.guestsOf(b).forEach(function (g) { var dd = liveDocs(g); rows.push([b.no || '', b.checkIn, b.checkOut, roomsLabel(b), g.name, g.primary ? 'Yes' : '', g.type || 'Adult', g.gender || '', g.dob || '', g.nationality, g.country || '', g.phone || '', g.idType || '', g.idNumber || '', g.passportNo || '', g.passportExpiry || '', g.visaNo || '', g.visaType || '', g.visaExpiry || '', g.nationality === 'Foreign' ? (g.formCArrival ? 'Filed' : 'Not filed') : '', g.nationality === 'Foreign' ? (g.formCDeparture ? 'Filed' : 'Not filed') : '', dd.length, dd.filter(function (d) { return d.driveId; }).length]); }); });
          deliverFile('athulyam-guests-' + today() + '.csv', csv(rows), 'text/csv');
        };
        $('#cq').onclick = function () {
          var rows = [['Query ID', 'Received', 'Guest', 'Phone', 'Email', 'Channel', 'Check-in', 'Check-out', 'Adults', 'Children', 'Room', 'Quote', 'Status', 'Outcome', 'Reason not booked', 'Booking ID', 'Asked', 'Notes']];
          data.queries.forEach(function (q) { rows.push([q.id, A.queryDate(q), q.name, q.phone, q.email, q.channel, q.checkIn, q.checkOut, q.adults, q.children, q.roomId ? roomName(q.roomId) : '', q.quote, q.status, q.outcome, q.lostReason, q.bookingId, q.message, q.notes]); });
          deliverFile('athulyam-queries-' + today() + '.csv', csv(rows), 'text/csv');
        };
        $('#wipe').onclick = function () {
          var typed = prompt('This clears every booking, payment, expense and query from THIS device only. Your Google Sheet and other devices keep them, and the next sync downloads them again. Type CLEAR to confirm.');
          if (typed !== 'CLEAR') return toast('Nothing cleared.');
          resetting = true;
          data.bookings = []; data.payments = []; data.expenses = []; data.queries = []; data.deleted = {};
          save(true).then(function () { resetting = false; data.settings.settingsAt = ''; knownSettings = settingsFp(data.settings); toast('This device is cleared. Tap Sync now to download your records.'); render(); });
        };
      }
    };
  };
  function mergeSettingsLists(s2) {
    if (!s2) return;
    var s = S();
    (s2.rooms || []).forEach(function (r) { if (!s.rooms.some(function (x) { return x.id === r.id; })) s.rooms.push(r); });
    ['sources', 'expenseCats', 'idTypes'].forEach(function (k) { (s2[k] || []).forEach(function (v) { if (s[k].indexOf(v) < 0) s[k].push(v); }); });
  }

  /* ---------- SETTINGS ---------- */
  routes.settings = function () {
    var s = S();
    var html = '<form id="sf" novalidate>' +
      '<div class="card"><h3>Business letterhead (confirmations and invoices)</h3>' +
      '<div class="logorow"><img id="logoimg" src="' + esc(s.logo || A.DEFAULT_LOGO) + '" alt="Logo"><div><input type="file" id="logofile" accept="image/*" hidden><button type="button" class="btn sm" id="logopick">' + (s.logo ? 'Change logo' : 'Upload your logo') + '</button>' + (s.logo ? '<button type="button" class="btn sm" id="logoclear">Use default</button>' : '') + '<p class="small">Square PNG or JPG works best. Shown on PDFs and the guest feedback page.</p></div></div>' +
      field('Business name', '<input name="businessName" value="' + esc(s.businessName) + '">') + field('Legal name on GST certificate (if different)', '<input name="legalName" value="' + esc(s.legalName || '') + '" placeholder="Optional">') +
      field('Address', '<textarea name="address" rows="2">' + esc(s.address) + '</textarea>') + '<div class="two">' + field('Phone', '<input name="phone" value="' + esc(s.phone) + '">') + field('Email', '<input name="email" type="email" value="' + esc(s.email) + '">') + '</div>' +
      '<div class="two">' + field('Website', '<input name="website" value="' + esc(s.website || '') + '">') + field('GSTIN', '<input name="gstin" value="' + esc(s.gstin) + '" placeholder="FILL IN: your 15-character GSTIN" autocapitalize="characters">') + '</div>' +
      '<div class="two">' + field('Check-in time', '<input name="checkInTime" value="' + esc(s.checkInTime || '') + '">') + field('Check-out time', '<input name="checkOutTime" value="' + esc(s.checkOutTime || '') + '">') + '</div>' +
      '<div class="three">' + field('Invoice prefix', '<input name="invoicePrefix" value="' + esc(s.invoicePrefix || 'INV') + '" maxlength="5" autocapitalize="characters">') + field('First invoice number', '<input name="invoiceStart" type="number" min="1" value="' + esc(s.invoiceStart || 1) + '">') + field('SAC for other charges', '<input name="sacOther" value="' + esc(s.sacOther || '') + '" placeholder="Optional">') + '</div>' +
      '<p class="small">Invoices are numbered INV-000001, INV-000002… in one continuous series, given at check-out. Rooms use SAC 996311 and food 996331; check the SAC for other charges with your CA.</p>' +
      field('Footer line', '<input name="billFooter" value="' + esc(s.billFooter) + '">') + '</div>' +
      '<div class="card"><h3>GST</h3><label class="chk"><input type="checkbox" name="gstOn"' + (s.gstOn ? ' checked' : '') + '> Charge GST on new bookings by default</label>' +
      '<div class="two">' + field('Room GST % (≤ threshold)', '<input name="gstRoomLow" type="number" step="any" value="' + s.gstRoomLow + '">') + field('Room GST % (above)', '<input name="gstRoomHigh" type="number" step="any" value="' + s.gstRoomHigh + '">') + '</div>' +
      '<div class="three">' + field('Threshold ₹/night', '<input name="gstThreshold" type="number" step="any" value="' + s.gstThreshold + '">') + field('Food GST %', '<input name="gstFood" type="number" step="any" value="' + s.gstFood + '">') + field('Other GST %', '<input name="gstOther" type="number" step="any" value="' + s.gstOther + '">') + '</div>' +
      '<p class="small">Defaults follow the rates in force since 22 Sep 2025 (rooms ≤ ₹7,500/night 5%; food at non-“specified premises” 5%). Confirm the food and other-charges rates with your CA. Changes apply to new bookings; existing bookings keep their rates.</p></div>' +
      '<div class="card"><h3>Rooms & base tariff</h3><div id="rooms">' + s.rooms.map(function (r, i) {
        var others = s.rooms.filter(function (x) { return x.id !== r.id && x.active !== false; }), inc = r.includes || [];
        return '<div class="roomedit"><input data-r="' + i + '" data-k="name" value="' + esc(r.name) + '" aria-label="Room name"><input data-r="' + i + '" data-k="tariff" type="number" inputmode="decimal" value="' + esc(r.tariff) + '" aria-label="Tariff per night"><label class="chk sm"><input type="checkbox" data-r="' + i + '" data-k="active"' + (r.active !== false ? ' checked' : '') + '> Active</label></div>' +
          (others.length ? '<details class="fld incl"><summary>' + (inc.length ? 'Includes: ' + esc(inc.map(roomName).join(', ')) : 'Is this unit made of other rooms?') + '</summary><p class="small">Tick the rooms that are part of ' + esc(r.name) + '. Booking it then also blocks them (and booking one of them blocks ' + esc(r.name) + ') in the calendar and the double-booking check.</p>' +
            others.map(function (o) { return '<label class="chk sm"><input type="checkbox" data-inc="' + i + '" value="' + esc(o.id) + '"' + (inc.indexOf(o.id) >= 0 ? ' checked' : '') + '> ' + esc(o.name) + '</label>'; }).join('') + '</details>' : '');
      }).join('') + '</div><button type="button" class="btn sm" id="addroom">＋ Add room</button><p class="small">Tariff is per night. New bookings fill room charges as tariff × nights (season rates where set); you can change the amount on each booking. Untick Active to hide a room without losing its history.</p></div>' +
      '<div class="card"><h3>Food menu</h3><p class="small">Used to read bill photos and to add items by hand. Leave the price empty for MRP items (price entered on each bill). “kg” items take quantities like 1.5.</p><div id="menuEd">' + (function () {
        var cats = [], by = {}; (s.menu || []).forEach(function (m, i) { if (!by[m.cat]) { by[m.cat] = []; cats.push(m.cat); } by[m.cat].push([m, i]); });
        return cats.map(function (cname) { return '<details class="fld"><summary>' + esc(cname) + ' (' + by[cname].length + ')</summary>' + by[cname].map(function (x) { var m = x[0], i = x[1]; return '<div class="roomedit menuline"><input data-mi="' + i + '" data-k="name" value="' + esc(m.name) + '" aria-label="Item"><input data-mi="' + i + '" data-k="price" type="number" inputmode="decimal" min="0" step="any" value="' + (m.price == null ? '' : esc(m.price)) + '" placeholder="MRP" aria-label="Price"><select data-mi="' + i + '" data-k="unit" aria-label="Unit">' + options([{ id: '', name: 'each' }, { id: 'kg', name: 'per kg' }], m.unit || '') + '</select><button type="button" class="x" data-rmmi="' + i + '" aria-label="Remove item">−</button></div>'; }).join('') +
          '<button type="button" class="btn sm" data-addmi="' + esc(cname) + '">＋ Add to ' + esc(cname) + '</button></details>'; }).join('');
      })() + '</div></div>' +
      '<div class="card"><h3>Meal rates (per person)</h3><div class="three">' + A.MEALS.map(function (m) { return field(m + ' ₹', '<input data-mr="' + m + '" type="number" inputmode="decimal" min="0" step="any" value="' + esc(num((s.mealRates || {})[m]) || '') + '">'); }).join('') + '</div>' +
      '<p class="small">Ticking a meal on a booking charges persons × this rate. You can change persons or the amount on each booking.</p></div>' +
      '<div class="card"><h3>Services</h3><div id="svcs">' + (s.services || []).map(function (v, i) {
        return '<div class="roomedit"><input data-sv="' + i + '" data-k="name" value="' + esc(v.name) + '" placeholder="e.g. Bonfire" aria-label="Service name"><input data-sv="' + i + '" data-k="rate" type="number" inputmode="decimal" min="0" step="any" value="' + esc(num(v.rate) || '') + '" placeholder="₹ each" aria-label="Default price"><button type="button" class="x" data-rmsv="' + i + '" aria-label="Remove service">−</button></div>';
      }).join('') + '</div><button type="button" class="btn sm" id="addsv">＋ Add service</button><p class="small">Shown in the list when you add a service to a day of a booking (quantity × price). You can also type a one-off service there.</p></div>' +
      '<div class="card"><h3>Season rate card</h3><div id="seasons">' + s.seasons.map(function (se, i) {
        return '<div class="season"><div class="two"><input data-s="' + i + '" data-k="name" value="' + esc(se.name) + '" placeholder="Season name"><button type="button" class="btn sm danger" data-dels="' + i + '">Remove</button></div><div class="two"><input type="date" data-s="' + i + '" data-k="from" value="' + esc(se.from) + '"><input type="date" data-s="' + i + '" data-k="to" value="' + esc(se.to) + '"></div>' +
          s.rooms.filter(function (r) { return r.active !== false; }).map(function (r) { return '<label class="fld inline2"><span>' + esc(r.name) + ' ₹/night</span><input type="number" inputmode="decimal" data-s="' + i + '" data-room="' + r.id + '" value="' + esc((se.rates || {})[r.id] || '') + '"></label>'; }).join('') + '</div>';
      }).join('') + '</div><button type="button" class="btn sm" id="addseason">＋ Add season</button><p class="small">On the booking form, room charges use the season rate for each night that falls in a season, otherwise the base tariff.</p></div>' +
      '<div class="card"><h3>Payments & reviews</h3><div class="two">' + field('Token amount ₹', '<input name="tokenAmount" type="number" inputmode="decimal" min="0" value="' + esc(s.tokenAmount) + '">') +
      field('Your UPI ID', '<input name="upiId" value="' + esc(s.upiId) + '" placeholder="FILL IN: name@bank">') + '</div>' +
      field('Coupon code prefix', '<input name="couponPrefix" value="' + esc(s.couponPrefix || 'ATH') + '" maxlength="8" autocapitalize="characters">', '', 'Codes look like ATH10-K7QM (10% off) or ATHR500-K7QM (₹500 off).') +
      field('Google review link', '<input name="rl_google" value="' + esc(s.reviewLinks.google) + '">', '', 'Replace with the link from Google’s “Ask for reviews” button on your Business Profile — it opens the review box directly.') +
      s.sources.filter(function (x) { return x !== 'Direct Booking' && x !== 'Other' && x !== 'Travel Agent' && x !== 'Google'; }).map(function (src) {
        return field(src + ' property page', '<input data-rl="' + esc(src) + '" value="' + esc(s.reviewLinks[src] || '') + '" placeholder="Leave empty to skip">');
      }).join('') +
      '<label class="chk"><input type="checkbox" name="autoReviewEmail"' + (s.autoReviewEmail !== false ? ' checked' : '') + '> Also email the review request automatically after check-out (off by default: you send it on WhatsApp from the booking)</label></div>' +
      '<div class="card"><h3>Your own booking fields</h3><div id="cfs">' + (s.customFields || []).map(function (cf, i) {
        return '<div class="roomedit"><input data-cfi="' + i + '" data-k="label" value="' + esc(cf.label) + '" placeholder="e.g. Vehicle number"><button type="button" class="x" data-rmcf="' + i + '" aria-label="Remove field">−</button></div>';
      }).join('') + '</div><button type="button" class="btn sm" id="addcf">＋ Add field</button><p class="small">Shown on every booking form under More details, on the guest register PDF and in the Bookings tab.</p></div>' +
      '<div class="card"><h3>Lists</h3>' + field('Booking sources (one per line)', '<textarea name="sources" rows="5">' + esc(s.sources.join('\n')) + '</textarea>') +
      field('Expense categories (one per line)', '<textarea name="expenseCats" rows="5">' + esc(s.expenseCats.join('\n')) + '</textarea>') + '</div>' +
      '<div class="card"><h3>Guest IDs & documents</h3><label class="chk"><input type="radio" name="idMode" value="full"' + (s.idMode === 'full' ? ' checked' : '') + '> Full ID numbers</label>' +
      '<label class="chk"><input type="radio" name="idMode" value="last4"' + (s.idMode !== 'full' ? ' checked' : '') + '> Last 4 characters only</label>' +
      '<label class="chk"><input type="checkbox" name="uploadDocs"' + (s.uploadDocs !== false ? ' checked' : '') + '> Copy ID photos and documents to Google Drive at each sync</label>' +
      field('Keep photos on this phone after check-out (days)', '<input name="keepPhotosDays" type="number" min="1" value="' + esc(s.keepPhotosDays || 30) + '">', '', 'Only removed from the phone once they are safely in Drive.') +
      field('Booking number prefix', '<input name="bookingPrefix" value="' + esc(s.bookingPrefix || 'ATH') + '" maxlength="6" autocapitalize="characters">', '', 'Booking numbers look like ATH-000256 and keep counting up (they never restart). Changing it affects new bookings only.') +
      '<p class="small">ID numbers, photos, passports and visas are personal data. They are kept on this phone (protected by your phone lock and the app PIN) and in your own Google Drive. Share the Drive folder with nobody else.</p></div>' +
      '<div class="card"><h3>Backups</h3>' + field('Warn me if no backup or sync for (days)', '<input name="backupDays" type="number" min="1" value="' + s.backupDays + '">') + '</div>' +
      '<button class="btn primary big" type="submit">Save settings</button></form>' +
      '<div class="card"><h3>App lock (PIN)</h3><p class="small">' + (s.pinHash ? 'PIN lock is on. The app locks when reopened after ' + s.lockMinutes + ' minutes.' : 'Off. A web app cannot use Face ID, so a PIN is the lock option.') + '</p>' +
      '<div class="actions"><button class="btn" id="setpin">' + (s.pinHash ? 'Change PIN' : 'Set a PIN') + '</button>' + (s.pinHash ? '<button class="btn danger" id="rmpin">Remove PIN</button>' : '') + '</div></div>' +
      '<div class="card"><h3>Cloud sync to your Google Sheet</h3><p class="small">Optional and free. Sends a copy of all records to your own Google Sheet, which keeps dated backups in your Drive and emails your reminders. Follow the setup guide to get these two values.</p>' +
      field('Web app URL', '<input id="surl" value="' + esc(s.syncUrl) + '" placeholder="FILL IN: https://script.google.com/macros/s/…/exec">') +
      field('Sync key', '<input id="stok" value="' + esc(s.syncToken) + '" placeholder="FILL IN: key shown in your Sheet" autocomplete="off">') +
      '<label class="chk"><input type="checkbox" id="sauto"' + (s.autoSync ? ' checked' : '') + '> Sync after every change I save (when online)</label><p class="small">There is no timed syncing. To get changes made on the other device, tap Sync now (here, at the bottom of any booking or query, or on Home).</p>' +
      '<div class="actions"><button class="btn" id="ssave">Save sync settings</button><button class="btn primary" id="snow">Sync now</button></div><div id="smsg">' + syncStatusHtml() + '</div></div>';
    return {
      title: 'Settings', tab: 'more', back: '#/more', html: html, after: function () {
        var f = $('#sf');
        function collectRooms() {
          $$('[data-r]', f).forEach(function (el) {
            var r = s.rooms[+el.dataset.r];
            if (el.dataset.k === 'active') r.active = el.checked; else if (el.dataset.k === 'tariff') r.tariff = r2(el.value); else r.name = el.value.trim() || r.name;
          });
          $$('[data-inc]', f).forEach(function (el) { var r = s.rooms[+el.dataset.inc]; if (!r.__incSeen) { r.includes = []; r.__incSeen = 1; } if (el.checked) r.includes.push(el.value); });
          s.rooms.forEach(function (r) { delete r.__incSeen; });
          $$('[data-mi]', f).forEach(function (el) { var m = s.menu[+el.dataset.mi]; if (!m) return; if (el.dataset.k === 'price') m.price = el.value === '' ? null : r2(el.value); else if (el.dataset.k === 'unit') m.unit = el.value; else m.name = el.value.trim() || m.name; });
          s.mealRates = s.mealRates || {}; $$('[data-mr]', f).forEach(function (el) { s.mealRates[el.dataset.mr] = r2(el.value); });
          s.services = s.services || []; $$('[data-sv]', f).forEach(function (el) { var v = s.services[+el.dataset.sv]; if (!v) return; if (el.dataset.k === 'rate') v.rate = r2(el.value); else v.name = el.value.trim(); });
          $$('[data-s]', f).forEach(function (el) {
            var se = s.seasons[+el.dataset.s];
            if (el.dataset.room) { se.rates = se.rates || {}; se.rates[el.dataset.room] = r2(el.value); } else se[el.dataset.k] = el.value;
          });
        }
        $('#logopick').onclick = function () { $('#logofile').click(); };
        $('#logofile').onchange = function () {
          var file = this.files && this.files[0]; if (!file) return;
          makeLogo(file).then(function (url) { s.logo = url; return save(); }).then(function () { toast('Logo saved. It reaches the Sheet at the next sync.'); render(); }).catch(function (e) { toast('Could not read that image: ' + e.message, true); });
        };
        var lc = $('#logoclear'); if (lc) lc.onclick = function () { s.logo = ''; save().then(render); };
        function collectCf() { $$('[data-cfi]', f).forEach(function (el) { var cf = s.customFields[+el.dataset.cfi]; cf.label = el.value.trim(); }); }
        $('#addcf').onclick = function () { collectRooms(); s.customFields = s.customFields || []; collectCf(); s.customFields.push({ id: 'cf-' + uid().slice(0, 8), label: '', required: false }); save(); render(); };
        $$('[data-rmcf]').forEach(function (x) { x.onclick = function () { collectRooms(); collectCf(); s.customFields.splice(+x.dataset.rmcf, 1); save(); render(); }; });
        $$('[data-addmi]').forEach(function (x) { x.onclick = function () { collectRooms(); var nm = prompt('Item name'); if (!nm || !nm.trim()) return; var pr = prompt('Price ₹ (leave empty for MRP)', ''); s.menu.push({ id: 'm-' + uid().slice(0, 8), cat: x.dataset.addmi, name: nm.trim(), price: pr === null || pr.trim() === '' ? null : r2(pr), aliases: [], unit: '' }); save(); render(); }; });
        $$('[data-rmmi]').forEach(function (x) { x.onclick = function () { collectRooms(); var m = s.menu[+x.dataset.rmmi]; if (!confirm('Remove ' + m.name + ' from the menu? Bookings that have it keep it.')) return; s.menu.splice(+x.dataset.rmmi, 1); save(); render(); }; });
        $('#addsv').onclick = function () { collectRooms(); s.services = s.services || []; s.services.push({ name: '', rate: 0 }); save(); render(); };
        $$('[data-rmsv]').forEach(function (x) { x.onclick = function () { collectRooms(); s.services.splice(+x.dataset.rmsv, 1); save(); render(); }; });
        $('#addroom').onclick = function () { collectRooms(); s.rooms.push({ id: uid(), name: 'Room ' + (s.rooms.length + 1), tariff: 0, active: true, clean: true }); save(); render(); };
        $('#addseason').onclick = function () { collectRooms(); s.seasons.push({ id: uid(), name: 'Peak season', from: '', to: '', rates: {} }); save(); render(); };
        $$('[data-dels]').forEach(function (b) { b.onclick = function () { collectRooms(); s.seasons.splice(+b.dataset.dels, 1); save(); render(); }; });
        f.onsubmit = function (ev) {
          ev.preventDefault();
          collectRooms(); collectCf(); s.customFields = s.customFields.filter(function (cf) { return cf.label; });
          s.services = (s.services || []).filter(function (v) { return v.name; });
          ['businessName', 'legalName', 'address', 'phone', 'email', 'gstin', 'billFooter', 'website', 'checkInTime', 'checkOutTime', 'sacOther'].forEach(function (k) { s[k] = f.elements[k].value.trim(); });
          s.invoicePrefix = (f.elements.invoicePrefix.value || 'INV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'INV'; s.invoiceStart = Math.max(1, Math.round(num(f.elements.invoiceStart.value)) || 1);
          s.gstin = s.gstin.toUpperCase();
          if (s.gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(s.gstin)) return toast('GSTIN should be 15 characters starting with 2 digits.', true);
          s.gstOn = f.elements.gstOn.checked;
          ['gstRoomLow', 'gstRoomHigh', 'gstThreshold', 'gstFood', 'gstOther', 'backupDays'].forEach(function (k) { s[k] = num(f.elements[k].value); });
          var src = f.elements.sources.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
          var cats = f.elements.expenseCats.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
          if (!src.length || !cats.length) return toast('Keep at least one source and one expense category.', true);
          s.sources = src; s.expenseCats = cats;
          s.couponPrefix = (f.elements.couponPrefix.value || 'ATH').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ATH'; s.tokenAmount = r2(f.elements.tokenAmount.value) || 500; s.upiId = f.elements.upiId.value.trim(); s.autoReviewEmail = f.elements.autoReviewEmail.checked;
          s.reviewLinks.google = f.elements.rl_google.value.trim();
          $$('[data-rl]', f).forEach(function (el) { s.reviewLinks[el.dataset.rl] = el.value.trim(); });
          var badLink = Object.keys(s.reviewLinks).filter(function (k) { return s.reviewLinks[k] && !/^https:\/\//.test(s.reviewLinks[k]); });
          if (badLink.length) return toast('Links must start with https:// (' + badLink.join(', ') + ')', true);
          s.idMode = f.elements.idMode.value; s.uploadDocs = f.elements.uploadDocs.checked; s.keepPhotosDays = Math.max(1, num(f.elements.keepPhotosDays.value) || 30);
          s.bookingPrefix = (f.elements.bookingPrefix.value || 'ATH').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'ATH';
          if (s.seasons.some(function (se) { return se.from && se.to && se.from > se.to; })) return toast('A season ends before it starts.', true);
          save().then(function () { toast('Settings saved'); render(); });
        };
        $('#setpin').onclick = function () {
          var p1 = prompt('Enter a 4–6 digit PIN'); if (p1 === null) return;
          if (!/^\d{4,6}$/.test(p1)) return toast('PIN must be 4 to 6 digits.', true);
          var p2 = prompt('Enter the PIN again'); if (p2 !== p1) return toast('PINs did not match.', true);
          var salt = uid(); hash(salt + p1).then(function (h) { s.pinSalt = salt; s.pinHash = h; unlocked = true; save(true); toast('PIN set'); render(); });
        };
        var rm = $('#rmpin'); if (rm) rm.onclick = function () { if (confirm('Remove the PIN lock?')) { s.pinHash = ''; s.pinSalt = ''; save(true); render(); } };
        $('#ssave').onclick = function () {
          s.syncUrl = $('#surl').value.trim(); s.syncToken = $('#stok').value.trim(); s.autoSync = $('#sauto').checked;
          if (s.syncUrl && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(s.syncUrl)) return toast('That does not look like an Apps Script web app URL ending in /exec.', true);
          save(true).then(function () { toast('Sync settings saved'); });
        };
        $('#snow').onclick = function () { syncNow(true); };

      }
    };
  };

  routes.about = function () {
    return {
      title: 'Your data', tab: 'more', back: '#/more', html: '<div class="card"><h3>Where your data is stored</h3>' +
        '<p>Everything you enter is saved <b>only on this phone</b>, inside this app’s private storage (IndexedDB). The website that delivers the app holds code only — never guest data.</p>' +
        '<p>It is protected by your phone’s own encryption and passcode. Optional PIN lock adds a second check when opening the app.</p>' +
        '<p><b>Backups</b> (JSON) include settings, rooms, bookings, guests with their full ID, passport and visa details, payments and expenses. PIN and sync key are left out. ID photos are not in the backup file — they live on this phone and in your Google Drive booking folders.</p>' +
        '<p><b>Cloud sync</b> (optional) copies the same records to a Google Sheet in <b>your own</b> Google account and keeps dated backup files in your Drive. The link to it is a private script address plus a secret key sent inside the request, not in the URL.</p>' +
        '<p><b>Important:</b> deleting the app from your Home Screen, or clearing Safari website data, can erase the phone copy. Keep backups or sync on.</p></div>'
    };
  };

  /* ---------- PIN lock ---------- */
  function hash(s) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }); }
  var unlocked = false, hiddenAt = 0;
  function locked() { return !!(data && data.settings.pinHash) && !unlocked; }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hiddenAt = Date.now();
    else if (data && data.settings.pinHash && hiddenAt && Date.now() - hiddenAt > num(data.settings.lockMinutes || 5) * 60000) { unlocked = false; render(); }
  });
  function renderLock() {
    $('#title').textContent = S().businessName; $('#back').style.visibility = 'hidden';
    $('#main').innerHTML = '<form id="lf" class="card lock"><div class="leaf">❦</div><h3>Enter PIN</h3><input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="6"><button class="btn primary big">Unlock</button><p class="small">Forgot your PIN? Delete and re-add the app, then restore your latest backup.</p></form>';
    $('#pin').focus();
    $('#lf').onsubmit = function (ev) {
      ev.preventDefault();
      hash(S().pinSalt + $('#pin').value).then(function (h) { if (h === S().pinHash) { unlocked = true; render(); } else { toast('Wrong PIN', true); $('#pin').value = ''; } });
    };
  }

  /* ---------- Cloud sync (Google Sheet via Apps Script web app) ---------- */
  var syncTimer = null, syncing = false;
  var syncAgain = false;
  function scheduleSync() {
    var s = data.settings; if (!s.autoSync || !s.syncUrl || !s.syncToken) return;
    clearTimeout(syncTimer); syncTimer = setTimeout(function () { syncNow(false); }, 1500);
  }
  /* Sync now box at the bottom of each booking and query (and on Home). */
  function syncCard() {
    if (!S().syncUrl) return '<div class="card"><h3>Sync</h3><p class="small">Cloud sync is not set up yet (More → Settings → Cloud sync).</p></div>';
    return '<div class="card"><h3>Sync</h3><p class="small">Changes sync by themselves after you save. Tap Sync now to send and fetch the latest (for example after working on the other device).</p>' +
      '<div class="actions"><button class="btn primary" data-syncnow>Sync now</button></div><div data-syncmsg>' + syncStatusHtml() + '</div></div>';
  }
  function bindSyncCard() {
    $$('[data-syncnow]').forEach(function (x) { x.onclick = function () { x.disabled = true; x.textContent = 'Syncing…'; syncNow(true); if (!syncing) { x.disabled = false; x.textContent = 'Sync now'; } }; });
  }
  function syncStatusHtml() {
    var m = data.meta;
    if (m.lastSyncError) return '<div class="warn">Last sync failed: ' + esc(m.lastSyncError) + '</div>';
    return m.lastSync ? '<div class="ok">Last synced ' + new Date(m.lastSync).toLocaleString('en-IN') + '</div>' : '';
  }
  function syncNow(manual) {
    var s = data.settings;
    if (!s.syncUrl || !s.syncToken) { if (manual) toast('Enter the web app URL and sync key first.', true); return; }
    if (!navigator.onLine) { if (manual) toast('You are offline. Data is safe on the phone; sync later.', true); return; }
    if (syncing) { syncAgain = true; return; } syncing = true; syncAgain = false;
    var body = JSON.stringify({ token: s.syncToken, action: 'sync', sentAt: nowISO(), appVersion: APP_VERSION,
      data: { settings: Object.assign({}, s, { pinHash: '', pinSalt: '', syncToken: '' }), bookings: data.bookings, payments: data.payments, expenses: data.expenses, queries: data.queries, deleted: data.deleted || {} } });
    fetch(s.syncUrl, { method: 'POST', body: body, redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { throw new Error('Unexpected reply from Google. Check the web app is deployed with access “Anyone”.'); }
        if (!j.ok) throw new Error(j.error || 'Sync rejected');
        data.meta.lastSync = nowISO(); data.meta.lastSyncError = '';
        if (j.data) applyServer(j.data);
        Object.keys(j.folders || {}).forEach(function (id) { var bk = booking(id); if (bk) bk.driveUrl = j.folders[id]; });
        return save(true).then(function () {
          /* records were replaced by the merged copy: redraw so buttons act on the fresh records (not while a form is open) */
          if (j.data && !/^#\/(new|edit|gx|pay|qnew|qedit|settings|importbk|import|formc)/.test(location.hash)) render();
          if (manual) toast('Synced to Google Sheet'); return uploadDocs(manual);
        }).then(function () { if (docsRedraw && /^#\/gx\//.test(location.hash)) try { docsRedraw(); } catch (e) { /* screen changed */ }
        });
      })
      .catch(function (e) {
        data.meta.lastSyncError = e.message || String(e); save(true);
        if (manual) toast('Sync failed: ' + data.meta.lastSyncError, true);
      })
      .then(function () { syncing = false; $$('#smsg,[data-syncmsg]').forEach(function (sm) { sm.innerHTML = syncStatusHtml(); }); $$('[data-syncnow]').forEach(function (x) { x.disabled = false; x.textContent = 'Sync now'; }); if (syncAgain) { syncAgain = false; setTimeout(function () { syncNow(false); }, 300); } });
  }
  /* Bring in what other devices (and the Sheet) changed. Newest change of each record wins; device-only settings stay. */
  function applyServer(remote) {
    trackChanges();
    var localDocs = {};
    data.bookings.forEach(function (b) { A.guestsOf(b).concat([{ docs: b.billDocs || [] }]).forEach(function (g) { (g.docs || []).forEach(function (d) { localDocs[d.id] = d.local; }); }); });
    var m = A.syncMerge(data, remote), mine = data.settings;
    A.COLLS.forEach(function (k) { data[k] = m[k]; });
    data.deleted = m.deleted;
    if (m.settings !== mine) {
      var ns = JSON.parse(JSON.stringify(m.settings));
      DEVICE_KEYS.forEach(function (k) { if (k !== 'settingsAt') ns[k] = mine[k]; });
      var def = defaultSettings(); Object.keys(def).forEach(function (k) { if (ns[k] === undefined) ns[k] = def[k]; });
      data.settings = ns;
    }
    data.bookings.forEach(function (b) { A.guestsOf(b).concat([{ docs: b.billDocs || [] }]).forEach(function (g) { (g.docs || []).forEach(function (d) { d.local = localDocs[d.id] === undefined ? false : localDocs[d.id]; }); }); });
    trackInit();
    data.meta.lastMergeStats = m.stats;
  }
  /* Confirmation / invoice PDF from the Sheet, then the share menu (WhatsApp) with the file attached. */
  function sendDoc(b, kind, btn) {
    var s = S();
    if (!s.syncUrl || !s.syncToken) return toast('Set up Cloud sync first (More → Settings).', true);
    if (!navigator.onLine) return toast('You are offline. Try again with internet.', true);
    var label = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing PDF…';
    function done() { btn.disabled = false; btn.textContent = label; }
    waitSync().then(function () {
      return fetch(s.syncUrl, { method: 'POST', redirect: 'follow', body: JSON.stringify({ token: s.syncToken, action: 'doc', bookingId: b.id, kind: kind }) }).then(function (r) { return r.text(); });
    }).then(function (t) {
      var j; try { j = JSON.parse(t); } catch (e) { throw new Error('Unexpected reply from Google. Update Code.gs to version 1.5 and deploy a new version.'); }
      if (!j.ok) throw new Error(j.error || 'Could not make the PDF');
      if (j.invoiceNo && !b.invoiceNo) { b.invoiceNo = j.invoiceNo; b.invoiceDate = j.invoiceDate; trackInit(); save(true); }
      var bytes = Uint8Array.from(atob(j.pdf), function (ch) { return ch.charCodeAt(0); });
      var blob = new Blob([bytes], { type: 'application/pdf' }), name = j.name || (kind + '.pdf');
      var first = firstName(b.guestName), B = A.biz(s);
      var text = kind === 'statement' ? 'Namaste ' + first + ', please find attached the day-wise details of the food and services during your stay at ' + B.name + ' (booking ' + (b.no || '') + ').' : kind === 'invoice'
        ? 'Namaste ' + first + ', thank you for staying at ' + B.name + '. Please find your tax invoice ' + (j.invoiceNo || '') + ' attached. We hope to welcome you again!'
        : 'Namaste ' + first + ', your booking at ' + B.name + ' is confirmed. Booking reference ' + (b.no || '') + '. Check-in from ' + B.checkInTime + ', check-out by ' + B.checkOutTime + '. Your confirmation is attached. Call or WhatsApp ' + B.phone + ' for anything you need.';
      var file = null; try { file = new File([blob], name, { type: 'application/pdf' }); } catch (e) { file = null; }
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], text: text, title: name }).then(function () {
          b[kind === 'invoice' ? 'invoiceSentAt' : kind === 'statement' ? 'statementSentAt' : 'confirmationSentAt'] = nowISO(); save(); toast('Shared');
        }).catch(function (e) { if (e && e.name !== 'AbortError') throw e; });
      }
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      if (b.phone) window.open(waLink(b.phone, text + (j.page ? '\n\n' + j.page : '')), '_blank');
      b[kind === 'invoice' ? 'invoiceSentAt' : kind === 'statement' ? 'statementSentAt' : 'confirmationSentAt'] = nowISO(); save();
      toast('PDF downloaded. WhatsApp opened: attach the PDF from Downloads, or send the link in the message.');
    }).catch(function (e) { toast(e.message || String(e), true); }).then(done);
  }
  function waitSync() {
    syncNow(false);
    return new Promise(function (res) { var n = 0; (function wait() { if (!syncing || n++ > 120) return res(); setTimeout(wait, 250); })(); });
  }
  /* Shrink an uploaded logo to a small square-ish image kept inside Settings. */
  function makeLogo(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 240, sc = Math.min(1, max / Math.max(img.width, img.height)), w = Math.round(img.width * sc), hh = Math.round(img.height * sc);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = hh; var cx = cv.getContext('2d');
        cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, w, hh); cx.drawImage(img, 0, 0, w, hh); URL.revokeObjectURL(url);
        var png = cv.toDataURL('image/png'), jpg = cv.toDataURL('image/jpeg', 0.85);
        res(png.length < 90000 ? png : jpg);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('not an image')); };
      img.src = url;
    });
  }
  /* Send ID photos and documents to the booking's Drive folder, one at a time, then tidy old copies on the phone. */
  function toB64(blob) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1] || ''); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(blob); }); }
  function pendingDocs() {
    var out = [];
    data.bookings.forEach(function (b) {
      A.guestsOf(b).forEach(function (g) { (g.docs || []).forEach(function (d) { if (!d.deleted && !d.driveId && d.local !== false) out.push({ b: b, g: g, d: d }); }); });
      (b.billDocs || []).forEach(function (d) { if (!d.deleted && !d.driveId && d.local !== false) out.push({ b: b, g: { id: 'bill' }, d: d }); });
    });
    return out;
  }
  function uploadDocs(manual) {
    var s = data.settings, list = pendingDocs(), ok = 0, fail = 0;
    if (!list.length || s.uploadDocs === false) return cleanupLocalDocs();
    if (manual) toast('Uploading ' + list.length + ' document' + (list.length > 1 ? 's' : '') + ' to Drive…');
    return list.reduce(function (p, x) {
      return p.then(function () {
        return fileGet(x.d.id).then(function (bl) {
          if (!bl) { x.d.local = false; return; }
          return toB64(bl).then(function (b64) {
            return fetch(s.syncUrl, { method: 'POST', redirect: 'follow', body: JSON.stringify({ token: s.syncToken, action: 'upload', bookingId: x.b.id, guestId: x.g.id, docId: x.d.id, name: x.d.name, mime: x.d.mime, data: b64 }) })
              .then(function (r) { return r.text(); }).then(function (t) {
                var j = JSON.parse(t);
                if (!j.ok) throw new Error(j.error || 'Upload refused');
                x.d.driveId = j.fileId; x.d.driveUrl = j.url; x.d.uploadedAt = nowISO(); ok++;
                if (j.folderUrl) x.b.driveUrl = j.folderUrl;
              });
          });
        }).catch(function (e) { fail++; data.meta.lastUploadError = e.message || String(e); });
      });
    }, Promise.resolve()).then(function () {
      if (manual || fail) toast(ok + ' document' + (ok === 1 ? '' : 's') + ' uploaded to Drive' + (fail ? ', ' + fail + ' failed (will retry next sync)' : ''), !!fail);
      return save(true);
    }).then(cleanupLocalDocs);
  }
  /* Phone copies of uploaded documents are removed N days after check-out (Drive keeps them). */
  function cleanupLocalDocs() {
    var days = num(data.settings.keepPhotosDays || 30), cut = A.addDays(today(), -days), n = 0;
    data.bookings.forEach(function (b) {
      if (!(b.checkOut < cut)) return;
      A.guestsOf(b).concat([{ docs: b.billDocs || [] }]).forEach(function (g) { (g.docs || []).forEach(function (d) { if (d.driveId && d.local !== false) { fileDel(d.id).catch(function () {}); d.local = false; n++; } }); });
    });
    return n ? save(true) : Promise.resolve();
  }
  /* Version 1.7: no timed syncing. The app syncs after every change you save (when online), retries when the
     connection comes back if a change is waiting, and whenever you tap Sync now. */
  window.addEventListener('online', function () { if (data && data.meta.lastSyncError) scheduleSync(); });

  /* ---------- offline indicator + service worker ---------- */
  function netBadge() { $('#net').hidden = navigator.onLine; }
  window.addEventListener('online', netBadge); window.addEventListener('offline', netBadge);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  /* ---------- start ---------- */
  load().then(function () { netBadge(); render(); }).catch(function (e) {
    $('#main').innerHTML = '<div class="warn">This browser blocked local storage (' + esc(e.message) + '). On iPhone, open the app from the Home Screen icon, and make sure Private Browsing is off.</div>';
  });
  window.AHApp = { _data: function () { return data; }, _save: function () { return save(true); }, _sync: function () { return waitSync(); }, go: go };
})();
