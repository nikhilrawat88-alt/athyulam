/* Athulyam Homes Guest Manager — phone app (offline PWA). Data lives on this device in IndexedDB. */
(function () {
  'use strict';
  var A = AH, inr = A.inr, num = A.num, r2 = A.r2;
  var APP_VERSION = '1.3.0';

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
  var DB_NAME = 'athulyam-homes', STORE = 'kv', KEY = 'data';
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
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

  function defaultSettings() {
    return {
      businessName: 'Athulyam Homes', address: 'Uttarakhand, India', phone: '', email: '', gstin: '',
      billFooter: 'Thank you for staying with us.',
      gstOn: true, gstRoomLow: 5, gstRoomHigh: 18, gstThreshold: 7500, gstFood: 5, gstOther: 18,
      rooms: [
        { id: 'room-1', name: 'Room 1', tariff: 3000, active: true, clean: true },
        { id: 'room-2', name: 'Room 2', tariff: 3000, active: true, clean: true }
      ],
      seasons: [],
      sources: A.SOURCES.slice(),
      expenseCats: A.EXPENSE_CATS.slice(),
      idMode: 'last4',
      idTypes: ['Aadhaar', 'Passport', 'Driving Licence', 'Voter ID', 'PAN', 'Other'],
      reminders: { arrivals: 8, payments: 9, summary: 20, monthly: 9, enabled: true },
      backupDays: 7,
      pinHash: '', pinSalt: '', lockMinutes: 5,
      syncUrl: '', syncToken: '', autoSync: true,
      tokenAmount: 500, upiId: '', autoReviewEmail: true, couponPrefix: 'ATH',
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
      data.bookings.forEach(function (b) { if (!b.fbToken) b.fbToken = token(); });
      if (moved) return idbPut(JSON.parse(JSON.stringify(data)));
    });
  }
  function save(skipSync) {
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
      '<div class="bk-top"><b>' + esc(b.guestName) + '</b><span class="st ' + statusClass(b.status) + '">' + esc(b.status) + '</span></div>' +
      '<div class="bk-mid">' + esc(roomName(b.roomId)) + ' · ' + fmtShort(b.checkIn) + ' → ' + fmtShort(b.checkOut) + ' · ' + c.nights + 'N · ' + esc(b.source) + '</div>' +
      (opts && opts.phone && b.phone ? '<div class="bk-mid">☎ ' + esc(b.phone) + '</div>' : '') +
      '<div class="bk-bot"><span>Bill ' + inr(c.total) + '</span><span>Paid ' + inr(c.received) + '</span><span class="' + (c.outstanding > 0 ? 'due' : '') + '">Due ' + inr(Math.max(c.outstanding, 0)) + '</span></div>' +
      (flag ? '<div class="flag fl-' + flag + '">' + flagLabel(flag) + '</div>' : '') +
      (b.nationality === 'Foreign' && !b.formCFiled && A.isActive(b) ? '<div class="flag fl-overdue">Form C not filed</div>' : '') +
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
    if (fc.length) out.push({ cls: 'red', text: fc.length + ' foreign guest' + (fc.length > 1 ? 's need' : ' needs') + ' Form C (due within 24 hours of check-in)', href: '#/guest/' + fc[0].id });
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
      (pend.length ? pend.map(function (x) { return bookingCard(x.b); }).join('') : empty('Nothing pending. All balances are clear.'));
    return { title: S().businessName, html: html, tab: 'home' };
  };

  /* ---------- BOOKING FORM (add + edit) ---------- */
  var formState = null;
  function blankBooking(prefill) {
    var s = S(), room = (A.activeRooms(s)[0] || {}).id || '';
    var b = {
      id: '', guestName: '', phone: '', email: '', nationality: 'Indian', country: '', formCFiled: false,
      idType: s.idTypes[0], idValue: '', adults: 2, children: 0, roomId: room,
      checkIn: today(), checkOut: A.addDays(today(), 1), source: 'Direct Booking', status: 'Confirmed',
      room: '', food: '', additional: '', additionalNote: '', discount: '', commission: '',
      gstOn: !!s.gstOn, gstRoomRate: s.gstRoomLow, gstFoodRate: s.gstFood, gstOtherRate: s.gstOther, gstRateManual: false,
      couponType: '', couponValue: '', couponCode: '', specialRequests: '', notes: '', cancelFee: '', cancelCommission: '', payoutReceived: '', payoutDate: '', payoutRef: ''
    };
    Object.keys(prefill || {}).forEach(function (k) { b[k] = prefill[k]; });
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
    formState = { b: JSON.parse(JSON.stringify(b)), errors: {}, isNew: false };
    return bookingForm('Edit booking');
  };
  function bookingForm(title) {
    var b = formState.b, e = formState.errors, s = S();
    var rooms = s.rooms.filter(function (r) { return r.active !== false || r.id === b.roomId; });
    var idHint = s.idMode === 'full' ? 'Full ID stored (Settings → Guest ID storage).' : 'Only the last 4 characters are kept, e.g. 4821.';
    var html = (b.queryId ? '<div class="ok">Converted from a query. The guest details are filled in — add the room, dates and charges, then save.</div>' : '') +
      '<form id="bf" novalidate>' +
      '<div class="card"><h3>Guest</h3>' +
      field('Full name *', '<input name="guestName" value="' + esc(b.guestName) + '" autocomplete="off" required>', e.guestName) +
      field('Mobile number', '<input name="phone" type="tel" inputmode="tel" value="' + esc(b.phone) + '" placeholder="98XXXXXXXX">', e.phone, 'Used for WhatsApp messages. Indian numbers get +91 automatically.') +
      field('Email', '<input name="email" type="email" inputmode="email" value="' + esc(b.email) + '" placeholder="For the review request email (optional)">', e.email) +
      '<div class="two">' + field('Nationality', '<select name="nationality">' + options(['Indian', 'Foreign'], b.nationality) + '</select>') +
      field('Country', '<input name="country" value="' + esc(b.country) + '" placeholder="If foreign">') + '</div>' +
      '<div class="two">' + field('ID type', '<select name="idType">' + options(s.idTypes, b.idType) + '</select>') +
      field('ID number', '<input name="idValue" value="' + esc(b.idValue) + '" ' + (s.idMode === 'full' ? '' : 'maxlength="4"') + ' autocomplete="off">', e.idValue, idHint) + '</div>' +
      '<div class="two">' + field('Adults *', '<input name="adults" type="number" inputmode="numeric" min="1" value="' + esc(b.adults) + '">', e.adults) +
      field('Children', '<input name="children" type="number" inputmode="numeric" min="0" value="' + esc(b.children) + '">', e.children) + '</div></div>' +

      '<div class="card"><h3>Stay</h3>' +
      field('Room *', '<select name="roomId">' + options(rooms, b.roomId) + '</select>', e.roomId) +
      '<div class="two">' + field('Check-in *', '<input name="checkIn" type="date" value="' + esc(b.checkIn) + '">', e.checkIn) +
      field('Check-out *', '<input name="checkOut" type="date" value="' + esc(b.checkOut) + '">', e.checkOut) + '</div>' +
      '<div class="nights" id="nights"></div>' +
      '<div class="two">' + field('Booking source', '<select name="source">' + options(s.sources, b.source) + '</select>') +
      field('Status', '<select name="status">' + options(A.STATUSES.concat(A.STATUSES.indexOf(b.status) < 0 ? [b.status] : []), b.status) + '</select>') + '</div>' +
      '<div id="overlap"></div></div>' +

      '<div class="card"><h3>Charges (₹)</h3>' +
      '<div class="two">' + field('Room charges', '<input name="room" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.room) + '">', e.room) +
      field('Food (whole room)', '<input name="food" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.food) + '">', e.food, 'One amount per room, not per person.') + '</div>' +
      '<button type="button" class="link" id="ratecard">Fill room charges from rate card</button>' +
      '<div class="two">' + field('Additional charges', '<input name="additional" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.additional) + '">', e.additional) +
      field('What for?', '<input name="additionalNote" value="' + esc(b.additionalNote) + '" placeholder="Bonfire, taxi…">') + '</div>' +
      '<div class="two">' + field('Discount', '<input name="discount" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.discount) + '">', e.discount) +
      field('Platform commission', '<input name="commission" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.commission) + '">', e.commission, 'Your expense. Never added to or taken off the guest bill.') + '</div>' +
      couponFields(b, e) +
      '<label class="chk"><input type="checkbox" name="gstOn"' + (b.gstOn ? ' checked' : '') + '> Charge GST on this bill</label>' +
      '<div id="gstbox" class="three' + (b.gstOn ? '' : ' hide') + '">' +
      field('Room GST %', '<input name="gstRoomRate" type="number" inputmode="decimal" step="any" value="' + esc(b.gstRoomRate) + '">', '', 'Auto: ≤ ₹' + s.gstThreshold + '/night → ' + s.gstRoomLow + '%') +
      field('Food GST %', '<input name="gstFoodRate" type="number" inputmode="decimal" step="any" value="' + esc(b.gstFoodRate) + '">') +
      field('Other GST %', '<input name="gstOtherRate" type="number" inputmode="decimal" step="any" value="' + esc(b.gstOtherRate) + '">') + '</div>' +
      '<div id="cancelbox" class="' + (b.status === 'Cancelled' ? '' : 'hide') + '"><div class="two">' +
      field('Cancellation fee kept', '<input name="cancelFee" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.cancelFee) + '">', e.cancelFee, '0 if fully refunded.') +
      field('Commission on fee', '<input name="cancelCommission" type="number" inputmode="decimal" min="0" step="any" value="' + esc(b.cancelCommission) + '">', e.cancelCommission) + '</div></div>' +
      '<div class="calcbox" id="calcbox"></div></div>' +

      (formState.isNew ? '<div class="card"><h3>Advance received now (optional)</h3><div class="two">' +
        field('Amount ₹', '<input name="advAmount" type="number" inputmode="decimal" min="0" step="any">') +
        field('Method', '<select name="advMethod">' + options(A.METHODS, 'UPI') + '</select>') + '</div>' +
        field('Transaction reference', '<input name="advRef" placeholder="UPI ref / last digits (optional)">') + '</div>' : '') +

      '<div class="card"><h3>Notes</h3>' +
      field('Special requests', '<textarea name="specialRequests" rows="2">' + esc(b.specialRequests) + '</textarea>') +
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
  function readForm() {
    var f = $('#bf'), b = formState.b;
    ['guestName', 'phone', 'email', 'nationality', 'country', 'idType', 'idValue', 'adults', 'children', 'roomId', 'checkIn', 'checkOut', 'source', 'status',
      'room', 'food', 'additional', 'additionalNote', 'discount', 'commission', 'gstRoomRate', 'gstFoodRate', 'gstOtherRate', 'specialRequests', 'notes', 'cancelFee', 'cancelCommission']
      .forEach(function (k) { if (f.elements[k]) b[k] = f.elements[k].value; });
    b.gstOn = f.elements.gstOn.checked;
    readCoupon(f, b);
    b.guestName = b.guestName.trim(); b.phone = b.phone.trim(); b.email = String(b.email || '').trim();
    if (S().idMode !== 'full') b.idValue = String(b.idValue).replace(/\s/g, '').slice(-4);
    return b;
  }
  function bindForm() {
    var f = $('#bf');
    function refresh(changedName) {
      var b = readForm(), s = S();
      if (b.gstOn && !b.gstRateManual && changedName !== 'gstRoomRate') {
        var auto = A.autoRoomGstRate(b, s);
        b.gstRoomRate = auto; f.elements.gstRoomRate.value = auto;
      }
      if (changedName === 'gstRoomRate') b.gstRateManual = true;
      $('#gstbox').classList.toggle('hide', !b.gstOn);
      $('#cancelbox').classList.toggle('hide', b.status !== 'Cancelled');
      var cs = f.elements.couponSel.value; $('#couponCustom').classList.toggle('hide', cs !== 'pct' && cs !== 'amt');
      if (changedName === 'couponSel') { var lab = $('#couponCustom .fld > span'); if (lab) lab.textContent = cs === 'amt' ? 'Coupon amount ₹' : 'Coupon %'; if (!cs) f.elements.couponCode.value = ''; }
      var n = A.nights(b.checkIn, b.checkOut);
      $('#nights').textContent = n > 0 ? n + ' night' + (n > 1 ? 's' : '') : '';
      var c = calc(b);
      $('#calcbox').innerHTML = (b.status === 'Cancelled' ? row('Cancellation fee', inr(c.cancelFee)) :
        row('Room', inr(c.room)) + row('Food', inr(c.food)) + row('Additional', inr(c.additional)) + row('Discount', '−' + inr(c.discount)) + (c.coupon ? row('Coupon ' + c.couponLabel, '−' + inr(c.coupon)) : '') + row('Taxable value', inr(c.taxable)) +
        (b.gstOn ? row('GST', inr(c.gst)) : '')) +
        row('Total bill', inr(c.total), 'strong') +
        row('Commission (your expense)', inr(c.commission), 'muted') + row('Net after commission (excl. GST)', inr(c.net), 'muted');
      var ov = A.overlaps(data.bookings, b);
      $('#overlap').innerHTML = ov.length && b.status !== 'Cancelled' ? '<div class="warn"><b>Double-booking warning.</b> ' + esc(roomName(b.roomId)) + ' is already taken by ' +
        ov.map(function (o) { return esc(o.guestName) + ' (' + fmtShort(o.checkIn) + '–' + fmtShort(o.checkOut) + ', ' + esc(o.status) + ')'; }).join('; ') +
        '.<label class="chk"><input type="checkbox" id="override"> I understand — save anyway (override)</label></div>' : '';
    }
    f.addEventListener('input', function (ev) { refresh(ev.target.name); });
    f.addEventListener('change', function (ev) { refresh(ev.target.name); });
    $('#ratecard').onclick = function () {
      var b = readForm(), v = A.rateCardTotal(S(), b.roomId, b.checkIn, b.checkOut);
      if (!v) return toast('Set this room’s tariff in Settings → Rooms first.', true);
      f.elements.room.value = v; refresh('room'); toast('Room charges set from rate card: ' + inr(v));
    };
    refresh();
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var b = readForm(), errs = A.validateBooking(b, S());
      var ov = A.overlaps(data.bookings, b);
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
      ['adults', 'children'].forEach(function (k) { b[k] = Math.round(num(b[k])); });
      ['room', 'food', 'additional', 'discount', 'commission', 'gstRoomRate', 'gstFoodRate', 'gstOtherRate', 'cancelFee', 'cancelCommission'].forEach(function (k) { b[k] = r2(b[k]); });
      if (b.couponType) b.couponValue = r2(b.couponValue);
      b.updatedAt = nowISO();
      if (b.status === 'Cancelled' && !b.cancelledOn) b.cancelledOn = today();
      if (b.status !== 'Cancelled') b.cancelledOn = '';
      if (formState.isNew) {
        b.id = uid(); b.createdAt = nowISO(); b.fbToken = token(); data.bookings.push(b);
        if (b.queryId) { var lq = query(b.queryId); if (lq) { lq.status = 'Closed'; lq.outcome = 'Booked'; lq.bookingId = b.id; lq.closedAt = lq.closedAt || nowISO(); lq.updatedAt = nowISO(); } }
        var adv = num(f.elements.advAmount.value);
        if (adv > 0) data.payments.push({ id: uid(), bookingId: b.id, type: 'payment', amount: r2(adv), date: today(), method: f.elements.advMethod.value, ref: f.elements.advRef.value.trim(), createdAt: nowISO(), updatedAt: nowISO() });
      } else {
        var i = data.bookings.findIndex(function (x) { return x.id === b.id; });
        data.bookings[i] = b;
      }
      save().then(function () { toast('Booking saved'); location.replace('#/guest/' + b.id); });
    };
    var del = $('#del');
    if (del) del.onclick = function () { deleteBooking(formState.b.id); };
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
            var hay = [b.guestName, b.phone, roomName(b.roomId), b.source, b.checkIn, b.checkOut, fmtDate(b.checkIn), b.country, b.notes].join(' ').toLowerCase();
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
    var html = '<div class="card hero"><div class="bk-top"><b class="name">' + esc(b.guestName) + '</b><span class="st ' + statusClass(b.status) + '">' + esc(b.status) + '</span></div>' +
      '<div class="bk-mid">' + esc(roomName(b.roomId)) + ' · ' + fmtDate(b.checkIn) + ' → ' + fmtDate(b.checkOut) + ' · ' + c.nights + ' night' + (c.nights === 1 ? '' : 's') + '</div>' +
      '<div class="bk-mid">' + esc(b.source) + ' · ' + b.adults + ' adult' + (b.adults == 1 ? '' : 's') + (num(b.children) ? ', ' + b.children + ' child' + (b.children == 1 ? '' : 'ren') : '') + '</div>' +
      (b.phone ? '<div class="bk-mid"><a href="tel:' + esc(b.phone) + '">☎ ' + esc(b.phone) + '</a></div>' : '') +
      '<div class="big3"><div><small>Total bill</small><b>' + inr(c.total) + '</b></div><div><small>Received</small><b>' + inr(c.received) + '</b></div><div><small>' + (c.outstanding < 0 ? 'Refund due' : 'Balance') + '</small><b class="' + (c.outstanding > 0 ? 'due' : '') + '">' + inr(Math.abs(c.outstanding)) + '</b></div></div>' +
      (flag ? '<div class="flag fl-' + flag + '">' + flagLabel(flag) + '</div>' : '') + '</div>' +
      '<div class="actions">' + actions + '<a class="btn" href="#/pay/' + b.id + '">Record payment</a><a class="btn" href="#/pay/' + b.id + '/refund">Record refund</a><a class="btn" href="#/edit/' + b.id + '">Edit</a></div>' +
      (b.nationality === 'Foreign' ? '<div class="card ' + (b.formCFiled ? '' : 'alertcard') + '"><h3>Foreign guest · Form C</h3><p class="small">' + esc(b.country || 'Country not entered') + '. Form C must be filed on the Bureau of Immigration portal within 24 hours of check-in (one per guest).</p>' +
        '<label class="chk"><input type="checkbox" id="formc"' + (b.formCFiled ? ' checked' : '') + '> Form C filed</label><a class="link" href="https://indianfrro.gov.in/frro/FormC" target="_blank" rel="noopener">Open Form C portal ›</a></div>' : '') +
      '<div class="card"><h3>Bill breakdown</h3>' +
      (A.isCancelled(b) ? row('Cancellation fee kept', inr(c.cancelFee)) :
        row('Room charges', inr(c.room)) + row('Food charges', inr(c.food)) + row('Additional' + (b.additionalNote ? ' (' + b.additionalNote + ')' : ''), inr(c.additional)) + row('Discount', '−' + inr(c.discount)) + (c.coupon ? row('Coupon ' + c.couponLabel, '−' + inr(c.coupon)) : '') +
        (b.gstOn ? row('GST room @ ' + b.gstRoomRate + '%', inr(c.gstRoom)) + row('GST food @ ' + b.gstFoodRate + '%', inr(c.gstFood)) + (c.gstOther ? row('GST other @ ' + b.gstOtherRate + '%', inr(c.gstOther)) : '') : '')) +
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
      '<a class="btn" href="#/bill/' + b.id + '">Guest bill (PDF)</a><button class="btn" id="ics">Add arrival to calendar</button></div></div>' +
      (b.specialRequests || b.notes ? '<div class="card"><h3>Notes</h3>' + (b.specialRequests ? '<p><b>Requests:</b> ' + esc(b.specialRequests) + '</p>' : '') + (b.notes ? '<p><b>Internal:</b> ' + esc(b.notes) + '</p>' : '') + '</div>' : '') +
      (b.status === 'Checked Out' ? '<div class="card"><h3>Review & feedback</h3>' +
        row('WhatsApp review request', b.reviewWaAt ? 'Opened ' + fmtDate(b.reviewWaAt.slice(0, 10)) : 'Not sent yet') +
        row('Email review request', !b.email ? 'No guest email' : (!S().syncUrl ? 'Needs Sheet sync set up' : (S().autoReviewEmail === false ? 'Turned off in Settings' : 'Sent by your Sheet after the next sync'))) +
        field('Permission to share their review on other platforms', '<select id="consent">' + options([{ id: '', name: 'Not asked yet' }, { id: 'Yes', name: 'Yes, may share' }, { id: 'No', name: 'No' }], b.reviewConsent || '') + '</select>') +
        field('Given via', '<select id="consentVia">' + options(['WhatsApp reply', 'Feedback form', 'In person', 'Email'], b.consentVia || 'WhatsApp reply') + '</select>') +
        '<p class="small">Feedback-form answers fill this in on the Sheet automatically. Record WhatsApp "YES" replies here.</p></div>' : '') +
      '<div class="card"><h3>Guest details</h3>' + (b.email ? row('Email', esc(b.email)) : '') + row('ID', esc(b.idType) + (b.idValue ? ' ····' + esc(b.idValue) : ' — not entered')) + row('Nationality', esc(b.nationality) + (b.country ? ' (' + esc(b.country) + ')' : '')) +
      row('Created', b.createdAt ? fmtDate(b.createdAt.slice(0, 10)) : '—') + '</div>' +
      '<button class="btn danger" id="delb">Delete booking</button>';
    return {
      title: 'Guest details', html: html, back: '#/bookings', tab: 'bookings', after: function () {
        $$('[data-st]').forEach(function (btn) {
          btn.onclick = function () {
            var st = btn.dataset.st;
            if (st === 'Checked Out' && c.outstanding > 0 && !confirm(b.guestName + ' still owes ' + inr(c.outstanding) + '. Check out anyway?')) return;
            b.status = st; b.updatedAt = nowISO();
            if (st === 'Checked In') b.checkedInAt = nowISO();
            if (st === 'Checked Out') { b.checkedOutAt = nowISO(); var r = S().rooms.filter(function (x) { return x.id === b.roomId; })[0]; if (r) r.clean = false; }
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
        var fc = $('#formc'); if (fc) fc.onchange = function () { b.formCFiled = fc.checked; b.formCFiledAt = fc.checked ? nowISO() : ''; b.updatedAt = nowISO(); save().then(function () { toast(fc.checked ? 'Form C marked as filed' : 'Form C marked as not filed'); }); };
        var ps = $('#po_save'); if (ps) ps.onclick = function () { b.payoutReceived = r2($('#po_amt').value); b.payoutDate = $('#po_date').value; b.payoutRef = $('#po_ref').value.trim(); b.updatedAt = nowISO(); save().then(function () { toast('Payout saved'); }); };
        $('#ics').onclick = function () {
          deliverFile('arrival-' + b.guestName.replace(/\W+/g, '-') + '.ics', ics([{ uid: b.id, start: icsTime(b.checkIn, 12), end: icsTime(b.checkIn, 13), title: 'Arrival: ' + b.guestName + ' (' + roomName(b.roomId) + ')', desc: c.nights + ' nights · ' + b.source + ' · balance ' + inr(c.outstanding) + (b.phone ? ' · ' + b.phone : ''), alarm: '-PT4H' }]), 'text/calendar');
        };
        $('#delb').onclick = function () { deleteBooking(b.id); };
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
    return 'Room: ' + roomName(b.roomId) + '\nCheck-in: ' + fmtDate(b.checkIn) + '\nCheck-out: ' + fmtDate(b.checkOut) + ' (' + c.nights + ' night' + (c.nights === 1 ? '' : 's') + ')\nGuests: ' + b.adults + ' adult' + (b.adults == 1 ? '' : 's') + (num(b.children) ? ', ' + b.children + ' child' + (b.children == 1 ? '' : 'ren') : '');
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

  /* ---------- RECORD PAYMENT / REFUND ---------- */
  routes.pay = function (arg) {
    var parts = arg.split('/'), b = booking(parts[0]), refund = parts[1] === 'refund';
    if (!b) return { title: 'Not found', html: empty('This booking no longer exists.'), back: '#/bookings' };
    var c = calc(b);
    var suggested = refund ? Math.max(-c.outstanding, 0) : Math.max(c.outstanding, 0);
    var html = '<div class="card"><b>' + esc(b.guestName) + '</b> · ' + esc(roomName(b.roomId)) + '<div class="big3"><div><small>Bill</small><b>' + inr(c.total) + '</b></div><div><small>Received</small><b>' + inr(c.received) + '</b></div><div><small>Balance</small><b>' + inr(c.outstanding) + '</b></div></div></div>' +
      '<form id="pf" class="card" novalidate><h3>' + (refund ? 'Refund to guest' : 'Payment received') + '</h3>' +
      field('Amount ₹ *', '<input name="amount" type="number" inputmode="decimal" min="0" step="any" value="' + (suggested ? suggested : '') + '" required>') +
      '<div class="two">' + field('Date *', '<input name="date" type="date" value="' + today() + '">') +
      field('Method', '<select name="method">' + options(A.METHODS, refund ? 'UPI' : (b.source !== 'Direct Booking' && !c.received ? 'Online Platform' : 'UPI')) + '</select>') + '</div>' +
      field('Transaction reference', '<input name="ref" placeholder="Optional">') +
      '<div id="perr"></div><button class="btn primary big" type="submit">Save ' + (refund ? 'refund' : 'payment') + '</button></form>';
    return {
      title: refund ? 'Record refund' : 'Record payment', html: html, back: '#/guest/' + b.id, tab: 'bookings', after: function () {
        $('#pf').onsubmit = function (ev) {
          ev.preventDefault();
          var f = this, amt = r2(f.elements.amount.value), d = f.elements.date.value;
          if (!(amt > 0)) return ($('#perr').innerHTML = '<div class="warn">Enter an amount greater than ₹0.</div>');
          if (!A.isDate(d)) return ($('#perr').innerHTML = '<div class="warn">Choose a date.</div>');
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
      field('Guest name *', '<input name="name" value="' + esc(q.name) + '" autocomplete="off">') +
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
          q.adults = Math.max(1, Math.round(num(f.elements.adults.value) || 1)); q.children = Math.max(0, Math.round(num(f.elements.children.value)));
          q.quote = r2(f.elements.quote.value);
          var err = !q.name ? 'Enter the guest name.' : (q.checkIn && q.checkOut && A.nights(q.checkIn, q.checkOut) < 1 ? 'Check-out must be after check-in.' : (q.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q.email) ? 'Check the email address.' : ''));
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
          if (!confirm('Delete this query for ' + q.name + '? This cannot be undone.' + (q.bookingId ? ' Its booking stays.' : ''))) return;
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
    var html = '<div class="card hero"><div class="bk-top"><b class="name">' + esc(q.name) + '</b><span class="st ' + (q.status === 'Open' ? 'st-cancelled' : q.status === 'Answered' ? 'st-confirmed' : (q.outcome === 'Booked' ? 'st-checked-in' : 'st-checked-out')) + '">' + esc(q.status + (q.status === 'Closed' ? ' · ' + (q.outcome || '') : '')) + '</span></div>' +
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
      (q.message || q.notes || q.lostReason ? '<div class="card"><h3>Notes</h3>' + (q.message ? '<p><b>Asked:</b> ' + esc(q.message) + '</p>' : '') + (q.notes ? '<p><b>Internal:</b> ' + esc(q.notes) + '</p>' : '') + (q.lostReason ? '<p><b>Not booked because:</b> ' + esc(q.lostReason) + '</p>' : '') + '</div>' : '');
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
      field('Period', '<select id="anp">' + options([{ id: 'lastWeek', name: 'Last week (Mon–Sun)' }, { id: 'thisWeek', name: 'This week' }, { id: 'lastMonth', name: 'Last month' }, { id: 'thisMonth', name: 'This month to date' }, { id: 'last30', name: 'Last 30 days' }, { id: 'lastYear', name: 'Last year' }, { id: 'thisYear', name: 'This year to date' }, { id: 'season', name: 'Season' }, { id: 'custom', name: 'Custom dates' }], an.preset) + '</select>') +
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
            bRows.push([b.guestName, b.source, roomName(b.roomId), b.checkIn, b.checkOut, k.nights, b.status, M(k.room), M(k.food), M(k.additional + k.cancelFee), M(k.discount), k.couponLabel || '', M(k.coupon), M(k.taxable), M(k.gst), M(k.total), M(k.commission), M(k.net), M(k.received), M(k.outstanding)]);
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
            return !q || [b.guestName, b.phone, roomName(b.roomId), b.source, b.checkIn, fmtDate(b.checkIn), b.checkOut].join(' ').toLowerCase().indexOf(q) >= 0;
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
        var bk = data.bookings.filter(function (b) { return b.roomId === r.id && (A.isActive(b) || b.status === 'Enquiry') && b.checkIn <= ds && b.checkOut > ds; });
        if (bk.length) {
          var b = bk[0], startHere = b.checkIn === ds || d === 1;
          cells += '<td class="occ ' + (bk.length > 1 ? 'clash' : statusClass(b.status)) + '"><a href="#/guest/' + b.id + '" title="' + esc(b.guestName) + '">' + (startHere ? esc(b.guestName.split(' ')[0].slice(0, 6)) : '') + '</a></td>';
        } else cells += '<td class="free"><a href="#/new/roomId=' + encodeURIComponent(r.id) + '&checkIn=' + ds + '" aria-label="Book ' + esc(r.name) + ' on ' + ds + '"></a></td>';
      }
      return '<tr>' + cells + '</tr>';
    }).join('');
    var html = '<div class="monthbar"><button class="btn sm" id="pm">‹</button><b>' + fmtMonth(calMonth) + '</b><button class="btn sm" id="nm">›</button></div>' +
      (rooms.length ? '<div class="calwrap"><table class="cal">' + head + body + '</table></div>' : empty('Add rooms in Settings first.', '<a class="btn" href="#/settings">Settings</a>')) +
      '<p class="small legend"><span class="lg st-confirmed"></span>Confirmed <span class="lg st-checked-in"></span>In-house <span class="lg st-checked-out"></span>Left <span class="lg st-enquiry"></span>Enquiry <span class="lg clash"></span>Clash · Tap an empty cell to book.</p>' +
      '<h2>Room status today</h2>' + rooms.map(function (r) {
        var occ = data.bookings.filter(function (b) { return b.roomId === r.id && A.isActive(b) && b.checkIn <= t && b.checkOut > t; })[0];
        return '<div class="card roomrow"><div><b>' + esc(r.name) + '</b><br><small>' + (occ ? 'Occupied · ' + esc(occ.guestName) : 'Available tonight') + '</small></div><button class="btn sm ' + (r.clean === false ? 'danger' : '') + '" data-clean="' + r.id + '">' + (r.clean === false ? 'Needs cleaning' : 'Clean ✓') + '</button></div>';
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
            var c = calc(b); rows.push([b.checkOut, b.guestName, roomName(b.roomId), b.source, c.roomTaxable, c.gstRoom, c.foodTaxable, c.gstFood, c.otherTaxable, c.gstOther, c.total]);
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
      field('Amount ₹ *', '<input name="amount" type="number" inputmode="decimal" min="0" step="any">') + field('Date', '<input name="date" type="date" value="' + today() + '">') + '</div><div class="two">' +
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
          if (!A.isDate(f.elements.date.value)) return ($('#eerr').innerHTML = '<div class="warn">Choose a date.</div>');
          data.expenses.push({ id: uid(), amount: amt, date: f.elements.date.value, category: f.elements.category.value, method: f.elements.method.value, note: f.elements.note.value.trim(), createdAt: nowISO(), updatedAt: nowISO() });
          exMonth = A.monthOf(f.elements.date.value);
          save().then(function () { toast('Expense added'); render(); });
        };
        $('#em').onchange = function () { if (this.value) { exMonth = this.value; render(); } };
        $$('[data-delex]').forEach(function (b) { b.onclick = function () { if (!confirm('Delete this expense?')) return; data.expenses = data.expenses.filter(function (e) { return e.id !== b.dataset.delex; }); save().then(function () { toast('Expense deleted'); render(); }); }; });
      }
    };
  };

  /* ---------- GUEST BILL (print to PDF) ---------- */
  routes.bill = function (id) {
    var b = booking(id); if (!b) return { title: 'Not found', html: empty('Booking not found.'), back: '#/bookings' };
    var c = calc(b), s = S(), pays = A.paymentsFor(b, data.payments);
    var billNo = 'AH-' + (b.checkOut || '').replace(/-/g, '') + '-' + b.id.slice(0, 4).toUpperCase();
    var html = '<div class="actions noprint"><button class="btn primary" onclick="window.print()">Print / Save as PDF</button></div>' +
      '<div class="bill"><div class="bill-h"><div><div class="bill-brand">' + esc(s.businessName) + '</div><small>' + esc(s.address) + (s.phone ? '<br>☎ ' + esc(s.phone) : '') + (s.email ? ' · ' + esc(s.email) : '') + (s.gstin ? '<br>GSTIN: ' + esc(s.gstin) : '') + '</small></div>' +
      '<div class="r"><b>' + (b.gstOn ? 'TAX INVOICE' : 'BILL') + '</b><br><small>No. ' + billNo + '<br>Date: ' + fmtDate(b.checkOut) + '</small></div></div>' +
      '<div class="bill-g"><b>Guest:</b> ' + esc(b.guestName) + (b.phone ? ' · ' + esc(b.phone) : '') + '<br><b>Stay:</b> ' + esc(roomName(b.roomId)) + ', ' + fmtDate(b.checkIn) + ' to ' + fmtDate(b.checkOut) + ' (' + c.nights + ' night' + (c.nights === 1 ? '' : 's') + '), ' + b.adults + ' adult(s)' + (num(b.children) ? ', ' + b.children + ' child(ren)' : '') + '</div>' +
      '<table class="tbl"><tr><th>Description</th><th class="r">Amount</th></tr>' +
      (A.isCancelled(b) ? '<tr><td>Cancellation charge</td><td class="r">' + inr(c.cancelFee, true) + '</td></tr>' :
        '<tr><td>Accommodation' + (b.gstOn ? ' (SAC 996311)' : '') + '</td><td class="r">' + inr(c.room, true) + '</td></tr>' +
        (c.food ? '<tr><td>Food' + (b.gstOn ? ' (SAC 996331)' : '') + '</td><td class="r">' + inr(c.food, true) + '</td></tr>' : '') +
        (c.additional ? '<tr><td>Additional' + (b.additionalNote ? ': ' + esc(b.additionalNote) : '') + '</td><td class="r">' + inr(c.additional, true) + '</td></tr>' : '') +
        (c.discount ? '<tr><td>Discount</td><td class="r">−' + inr(c.discount, true) + '</td></tr>' : '') +
        (c.coupon ? '<tr><td>Coupon ' + esc(c.couponLabel) + '</td><td class="r">−' + inr(c.coupon, true) + '</td></tr>' : '') +
        (b.gstOn ? '<tr><td>Taxable value</td><td class="r">' + inr(c.taxable, true) + '</td></tr>' +
          (c.gstRoom ? '<tr><td>CGST ' + b.gstRoomRate / 2 + '% + SGST ' + b.gstRoomRate / 2 + '% on accommodation</td><td class="r">' + inr(c.gstRoom, true) + '</td></tr>' : '') +
          (c.gstFood ? '<tr><td>CGST ' + b.gstFoodRate / 2 + '% + SGST ' + b.gstFoodRate / 2 + '% on food</td><td class="r">' + inr(c.gstFood, true) + '</td></tr>' : '') +
          (c.gstOther ? '<tr><td>CGST ' + b.gstOtherRate / 2 + '% + SGST ' + b.gstOtherRate / 2 + '% on other charges</td><td class="r">' + inr(c.gstOther, true) + '</td></tr>' : '') : '')) +
      '<tr class="strong"><td>Total</td><td class="r">' + inr(c.total, true) + '</td></tr>' +
      pays.map(function (p) { return '<tr><td>' + (p.type === 'refund' ? 'Refund' : 'Paid') + ' ' + fmtDate(p.date) + ' (' + esc(p.method) + ')</td><td class="r">' + (p.type === 'refund' ? '+' : '−') + inr(p.amount, true) + '</td></tr>'; }).join('') +
      '<tr class="strong"><td>' + (c.outstanding < 0 ? 'Refund due' : 'Balance due') + '</td><td class="r">' + inr(Math.abs(c.outstanding), true) + '</td></tr></table>' +
      '<p class="small">' + esc(s.billFooter) + '</p></div>';
    return { title: 'Guest bill', back: '#/guest/' + b.id, tab: 'bookings', html: html };
  };

  /* ---------- MORE ---------- */
  routes.more = function () {
    var items = [['today', 'Today’s arrivals & departures'], ['future', 'Future bookings'], ['pending', 'Pending payments'], ['reminders', 'Notifications & reminders'],
      ['backup', 'Backup & restore'], ['import', 'Import old queries'], ['settings', 'Settings'], ['about', 'Where my data is stored']];
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
            var c = calc(b); return { uid: b.id, start: icsTime(b.checkIn, 12), end: icsTime(b.checkIn, 13), title: 'Arrival: ' + b.guestName + ' (' + roomName(b.roomId) + ')', desc: c.nights + ' nights · ' + b.source + ' · balance ' + inr(c.outstanding), alarm: '-PT4H' };
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
      '<div class="card"><h3>Spreadsheet exports (CSV)</h3><div class="actions"><button class="btn" id="cb">Bookings</button><button class="btn" id="cp">Payments</button><button class="btn" id="ce">Expenses</button><button class="btn" id="cq">Queries</button></div></div>' +
      '<div class="card"><h3>Delete all data</h3><p class="small">Removes every record from this phone. Export a backup first.</p><button class="btn danger" id="wipe">Delete everything on this phone</button></div>';
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
          var rows = [['Booking ID', 'Guest', 'Phone', 'Email', 'From query', 'Nationality', 'Country', 'Form C filed', 'ID type', 'ID (stored)', 'Adults', 'Children', 'Room', 'Check-in', 'Check-out', 'Nights', 'Source', 'Status',
            'Room charges', 'Food', 'Additional', 'Discount', 'Coupon code', 'Coupon', 'Cancellation fee', 'Taxable', 'GST', 'Total bill', 'Commission', 'Net after commission', 'Received', 'Outstanding', 'Payout received', 'Created', 'Special requests', 'Notes']];
          data.bookings.forEach(function (b) {
            var c = calc(b);
            rows.push([b.id, b.guestName, b.phone, b.email, b.queryId ? 'Yes' : 'No', b.nationality, b.country, b.formCFiled ? 'Yes' : 'No', b.idType, b.idValue, b.adults, b.children, roomName(b.roomId), b.checkIn, b.checkOut, c.nights, b.source, b.status,
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
        $('#cq').onclick = function () {
          var rows = [['Query ID', 'Received', 'Guest', 'Phone', 'Email', 'Channel', 'Check-in', 'Check-out', 'Adults', 'Children', 'Room', 'Quote', 'Status', 'Outcome', 'Reason not booked', 'Booking ID', 'Asked', 'Notes']];
          data.queries.forEach(function (q) { rows.push([q.id, A.queryDate(q), q.name, q.phone, q.email, q.channel, q.checkIn, q.checkOut, q.adults, q.children, q.roomId ? roomName(q.roomId) : '', q.quote, q.status, q.outcome, q.lostReason, q.bookingId, q.message, q.notes]); });
          deliverFile('athulyam-queries-' + today() + '.csv', csv(rows), 'text/csv');
        };
        $('#wipe').onclick = function () {
          var typed = prompt('This deletes every booking, payment and expense on this phone. Type DELETE to confirm.');
          if (typed !== 'DELETE') return toast('Nothing deleted.');
          data.bookings = []; data.payments = []; data.expenses = []; data.queries = [];
          save().then(function () { toast('All records deleted from this phone'); render(); });
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
      '<div class="card"><h3>Business (shown on bills)</h3>' + field('Business name', '<input name="businessName" value="' + esc(s.businessName) + '">') +
      field('Address', '<textarea name="address" rows="2">' + esc(s.address) + '</textarea>') + '<div class="two">' + field('Phone', '<input name="phone" value="' + esc(s.phone) + '">') + field('Email', '<input name="email" type="email" value="' + esc(s.email) + '">') + '</div>' +
      field('GSTIN', '<input name="gstin" value="' + esc(s.gstin) + '" placeholder="FILL IN: your 15-character GSTIN" autocapitalize="characters">') + field('Bill footer', '<input name="billFooter" value="' + esc(s.billFooter) + '">') + '</div>' +
      '<div class="card"><h3>GST</h3><label class="chk"><input type="checkbox" name="gstOn"' + (s.gstOn ? ' checked' : '') + '> Charge GST on new bookings by default</label>' +
      '<div class="two">' + field('Room GST % (≤ threshold)', '<input name="gstRoomLow" type="number" step="any" value="' + s.gstRoomLow + '">') + field('Room GST % (above)', '<input name="gstRoomHigh" type="number" step="any" value="' + s.gstRoomHigh + '">') + '</div>' +
      '<div class="three">' + field('Threshold ₹/night', '<input name="gstThreshold" type="number" step="any" value="' + s.gstThreshold + '">') + field('Food GST %', '<input name="gstFood" type="number" step="any" value="' + s.gstFood + '">') + field('Other GST %', '<input name="gstOther" type="number" step="any" value="' + s.gstOther + '">') + '</div>' +
      '<p class="small">Defaults follow the rates in force since 22 Sep 2025 (rooms ≤ ₹7,500/night 5%; food at non-“specified premises” 5%). Confirm the food and other-charges rates with your CA. Changes apply to new bookings; existing bookings keep their rates.</p></div>' +
      '<div class="card"><h3>Rooms & base tariff</h3><div id="rooms">' + s.rooms.map(function (r, i) {
        return '<div class="roomedit"><input data-r="' + i + '" data-k="name" value="' + esc(r.name) + '" aria-label="Room name"><input data-r="' + i + '" data-k="tariff" type="number" inputmode="decimal" value="' + esc(r.tariff) + '" aria-label="Tariff per night"><label class="chk sm"><input type="checkbox" data-r="' + i + '" data-k="active"' + (r.active !== false ? ' checked' : '') + '> Active</label></div>';
      }).join('') + '</div><button type="button" class="btn sm" id="addroom">＋ Add room</button><p class="small">Tariff is per night. Untick Active to hide a room without losing its history.</p></div>' +
      '<div class="card"><h3>Season rate card</h3><div id="seasons">' + s.seasons.map(function (se, i) {
        return '<div class="season"><div class="two"><input data-s="' + i + '" data-k="name" value="' + esc(se.name) + '" placeholder="Season name"><button type="button" class="btn sm danger" data-dels="' + i + '">Remove</button></div><div class="two"><input type="date" data-s="' + i + '" data-k="from" value="' + esc(se.from) + '"><input type="date" data-s="' + i + '" data-k="to" value="' + esc(se.to) + '"></div>' +
          s.rooms.filter(function (r) { return r.active !== false; }).map(function (r) { return '<label class="fld inline2"><span>' + esc(r.name) + ' ₹/night</span><input type="number" inputmode="decimal" data-s="' + i + '" data-room="' + r.id + '" value="' + esc((se.rates || {})[r.id] || '') + '"></label>'; }).join('') + '</div>';
      }).join('') + '</div><button type="button" class="btn sm" id="addseason">＋ Add season</button><p class="small">On the booking form, “Fill room charges from rate card” uses the season rate for each night, otherwise the base tariff.</p></div>' +
      '<div class="card"><h3>Payments & reviews</h3><div class="two">' + field('Token amount ₹', '<input name="tokenAmount" type="number" inputmode="decimal" min="0" value="' + esc(s.tokenAmount) + '">') +
      field('Your UPI ID', '<input name="upiId" value="' + esc(s.upiId) + '" placeholder="FILL IN: name@bank">') + '</div>' +
      field('Coupon code prefix', '<input name="couponPrefix" value="' + esc(s.couponPrefix || 'ATH') + '" maxlength="8" autocapitalize="characters">', '', 'Codes look like ATH10-K7QM (10% off) or ATHR500-K7QM (₹500 off).') +
      field('Google review link', '<input name="rl_google" value="' + esc(s.reviewLinks.google) + '">', '', 'Replace with the link from Google’s “Ask for reviews” button on your Business Profile — it opens the review box directly.') +
      s.sources.filter(function (x) { return x !== 'Direct Booking' && x !== 'Other' && x !== 'Travel Agent' && x !== 'Google'; }).map(function (src) {
        return field(src + ' property page', '<input data-rl="' + esc(src) + '" value="' + esc(s.reviewLinks[src] || '') + '" placeholder="Leave empty to skip">');
      }).join('') +
      '<label class="chk"><input type="checkbox" name="autoReviewEmail"' + (s.autoReviewEmail !== false ? ' checked' : '') + '> Email the review request automatically after check-out (needs guest email + Sheet sync)</label></div>' +
      '<div class="card"><h3>Lists</h3>' + field('Booking sources (one per line)', '<textarea name="sources" rows="5">' + esc(s.sources.join('\n')) + '</textarea>') +
      field('Expense categories (one per line)', '<textarea name="expenseCats" rows="5">' + esc(s.expenseCats.join('\n')) + '</textarea>') + '</div>' +
      '<div class="card"><h3>Guest ID storage</h3><label class="chk"><input type="radio" name="idMode" value="last4"' + (s.idMode !== 'full' ? ' checked' : '') + '> Last 4 characters only (recommended)</label>' +
      '<label class="chk"><input type="radio" name="idMode" value="full"' + (s.idMode === 'full' ? ' checked' : '') + '> Full ID number</label><p class="small">Switch to full only if your local police / tourism office confirms the guest register (Form B) needs it.</p></div>' +
      '<div class="card"><h3>Backups</h3>' + field('Warn me if no backup or sync for (days)', '<input name="backupDays" type="number" min="1" value="' + s.backupDays + '">') + '</div>' +
      '<button class="btn primary big" type="submit">Save settings</button></form>' +
      '<div class="card"><h3>App lock (PIN)</h3><p class="small">' + (s.pinHash ? 'PIN lock is on. The app locks when reopened after ' + s.lockMinutes + ' minutes.' : 'Off. A web app cannot use Face ID, so a PIN is the lock option.') + '</p>' +
      '<div class="actions"><button class="btn" id="setpin">' + (s.pinHash ? 'Change PIN' : 'Set a PIN') + '</button>' + (s.pinHash ? '<button class="btn danger" id="rmpin">Remove PIN</button>' : '') + '</div></div>' +
      '<div class="card"><h3>Cloud sync to your Google Sheet</h3><p class="small">Optional and free. Sends a copy of all records to your own Google Sheet, which keeps dated backups in your Drive and emails your reminders. Follow the setup guide to get these two values.</p>' +
      field('Web app URL', '<input id="surl" value="' + esc(s.syncUrl) + '" placeholder="FILL IN: https://script.google.com/macros/s/…/exec">') +
      field('Sync key', '<input id="stok" value="' + esc(s.syncToken) + '" placeholder="FILL IN: key shown in your Sheet" autocomplete="off">') +
      '<label class="chk"><input type="checkbox" id="sauto"' + (s.autoSync ? ' checked' : '') + '> Sync automatically after changes (when online)</label>' +
      '<div class="actions"><button class="btn" id="ssave">Save sync settings</button><button class="btn primary" id="snow">Sync now</button></div><div id="smsg">' + syncStatusHtml() + '</div></div>';
    return {
      title: 'Settings', tab: 'more', back: '#/more', html: html, after: function () {
        var f = $('#sf');
        function collectRooms() {
          $$('[data-r]', f).forEach(function (el) {
            var r = s.rooms[+el.dataset.r];
            if (el.dataset.k === 'active') r.active = el.checked; else if (el.dataset.k === 'tariff') r.tariff = r2(el.value); else r.name = el.value.trim() || r.name;
          });
          $$('[data-s]', f).forEach(function (el) {
            var se = s.seasons[+el.dataset.s];
            if (el.dataset.room) { se.rates = se.rates || {}; se.rates[el.dataset.room] = r2(el.value); } else se[el.dataset.k] = el.value;
          });
        }
        $('#addroom').onclick = function () { collectRooms(); s.rooms.push({ id: uid(), name: 'Room ' + (s.rooms.length + 1), tariff: 0, active: true, clean: true }); save(); render(); };
        $('#addseason').onclick = function () { collectRooms(); s.seasons.push({ id: uid(), name: 'Peak season', from: '', to: '', rates: {} }); save(); render(); };
        $$('[data-dels]').forEach(function (b) { b.onclick = function () { collectRooms(); s.seasons.splice(+b.dataset.dels, 1); save(); render(); }; });
        f.onsubmit = function (ev) {
          ev.preventDefault();
          collectRooms();
          ['businessName', 'address', 'phone', 'email', 'gstin', 'billFooter'].forEach(function (k) { s[k] = f.elements[k].value.trim(); });
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
          s.idMode = f.elements.idMode.value;
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
        '<p><b>Backups</b> (JSON) include settings, rooms, bookings, guest names, phone numbers, stored ID characters, payments and expenses. PIN and sync key are left out.</p>' +
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
  function scheduleSync() {
    var s = data.settings; if (!s.autoSync || !s.syncUrl || !s.syncToken) return;
    clearTimeout(syncTimer); syncTimer = setTimeout(function () { syncNow(false); }, 4000);
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
    if (syncing) return; syncing = true;
    var body = JSON.stringify({ token: s.syncToken, action: 'sync', sentAt: nowISO(), appVersion: APP_VERSION,
      data: { settings: Object.assign({}, s, { pinHash: '', pinSalt: '', syncToken: '' }), bookings: data.bookings, payments: data.payments, expenses: data.expenses, queries: data.queries } });
    fetch(s.syncUrl, { method: 'POST', body: body, redirect: 'follow' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var j; try { j = JSON.parse(t); } catch (e) { throw new Error('Unexpected reply from Google. Check the web app is deployed with access “Anyone”.'); }
        if (!j.ok) throw new Error(j.error || 'Sync rejected');
        data.meta.lastSync = nowISO(); data.meta.lastSyncError = '';
        return save(true).then(function () { if (manual) toast('Synced to Google Sheet'); });
      })
      .catch(function (e) {
        data.meta.lastSyncError = e.message || String(e); save(true);
        if (manual) toast('Sync failed: ' + data.meta.lastSyncError, true);
      })
      .then(function () { syncing = false; var sm = $('#smsg'); if (sm) sm.innerHTML = syncStatusHtml(); });
  }
  window.addEventListener('online', function () { scheduleSync(); });

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
  window.AHApp = { _data: function () { return data; }, _save: function () { return save(true); }, go: go };
})();
