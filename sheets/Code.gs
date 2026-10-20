/**
 * Athulyam Homes — Google Sheet companion (free).
 * Receives a copy of the phone app's records, builds report tabs, keeps dated
 * backups in your Google Drive and emails your reminders on schedule (IST).
 *
 * You do not need to edit anything in this file.
 * 1. Run  setup   once (Run ▸ setup), allow permissions.
 * 2. Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone ▸ Deploy.
 * 3. Copy the web app URL and the Sync key (Setup tab) into the app: More ▸ Settings ▸ Cloud sync.
 */

var TZ = 'Asia/Kolkata';
var TAB = { setup: 'Setup', dashboard: 'Dashboard', queries: 'Queries', conversion: 'Query conversion', bookings: 'Bookings', payments: 'Payments', expenses: 'Expenses', daily: 'Daily', monthly: 'Monthly', platforms: 'Platforms', gst: 'GST', payouts: 'OTA payouts', feedback: 'Feedback', consent: 'Review consent' };
var FEEDBACK_HEAD = ['Submitted (IST)', 'Booking ID', 'Guest', 'Channel', 'Check-out', 'Rating (1-5)', 'What they liked', 'What could be better', 'May we share their review?', 'Name to show'];
var MONEY = '[$₹]#,##0.00;-[$₹]#,##0.00';
var KEEP_BACKUPS = 45;

function props_() { return PropertiesService.getScriptProperties(); }
function todayIST_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function hourIST_() { return Number(Utilities.formatDate(new Date(), TZ, 'H')); }

/* ---------------- one-time setup ---------------- */
function setup() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  var p = props_();
  if (!p.getProperty('SYNC_KEY')) p.setProperty('SYNC_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  var folder = backupFolder_();
  var sh = ss.getSheetByName(TAB.setup) || ss.insertSheet(TAB.setup, 0);
  var keep = function (cell, fallback) { var v = String(sh.getRange(cell).getValue() || '').trim(); return v || fallback; };
  var email = keep('B4', Session.getEffectiveUser().getEmail());
  var waNum = keep('B10', ''), waKey = keep('B11', '');
  sh.clear();
  sh.getRange('A1:B1').setValues([['Athulyam Homes — Guest Manager sync', '']]).setFontWeight('bold').setFontSize(14);
  sh.getRange('A3:B12').setValues([
    ['Sync key (paste into the app)', p.getProperty('SYNC_KEY')],
    ['Reminder emails go to', email],
    ['Backups folder in your Drive', folder.getUrl()],
    ['Last sync received', p.getProperty('LAST_SYNC') || 'Not yet'],
    ['Records in last sync', p.getProperty('LAST_COUNTS') || '—'],
    ['Web app URL', 'After Deploy ▸ New deployment, copy the URL ending in /exec into the app'],
    ['Do not type in the other tabs', 'They are rebuilt on every sync. Enter data in the phone app only. Feedback is the exception: it is filled by guests.'],
    ['Your WhatsApp number for alerts (optional)', waNum || 'FILL IN: e.g. 919876543210 (country code, no +)'],
    ['CallMeBot API key (optional)', waKey || 'FILL IN only if you activate CallMeBot'],
    ['Guest feedback form', webAppUrl_() ? webAppUrl_() + '?page=feedback' : 'Appears after you deploy the web app and sync once']
  ]);
  sh.getRange('A3:A12').setFontWeight('bold');
  sh.getRange('B10').setNote('Used only to WhatsApp you when a guest submits feedback. Needs the free CallMeBot activation (see guide). Email alerts work without it.');
  sh.getRange('B4').setNote('You can change this to another email address. Reminders go here.');
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 520);
  sh.getRange('B3').setBackground('#efe4cf').setFontFamily('Roboto Mono');

  [TAB.dashboard, TAB.queries, TAB.conversion, TAB.bookings, TAB.payments, TAB.expenses, TAB.daily, TAB.monthly, TAB.platforms, TAB.gst, TAB.payouts, TAB.consent].forEach(function (n) { if (!ss.getSheetByName(n)) ss.insertSheet(n); });
  feedbackSheet_();
  var s1 = ss.getSheetByName('Sheet1'); if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) ss.deleteSheet(s1);

  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'hourlyCheck') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('hourlyCheck').timeBased().everyHours(1).create();

  ss.setActiveSheet(sh);
  Logger.log('Setup complete. Sync key: ' + p.getProperty('SYNC_KEY'));
  try { SpreadsheetApp.getUi().alert('Setup complete.\n\nNext: Deploy ▸ New deployment ▸ Web app (Execute as: Me, Who has access: Anyone).\nThen copy the web app URL and the Sync key from the Setup tab into the app.'); } catch (e) { /* run from editor without UI */ }
}

function backupFolder_() {
  var p = props_(), id = p.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  var f = DriveApp.createFolder('Athulyam Homes Backups');
  p.setProperty('FOLDER_ID', f.getId());
  return f;
}

/* ---------------- web endpoint ---------------- */
function doGet(e) {
  var prm = (e && e.parameter) || {};
  if (prm.page === 'feedback') return feedbackPage_(prm);
  return ContentService.createTextOutput('Athulyam sync endpoint is running. Data is only accepted from the app with the sync key.');
}
function webAppUrl_() { try { return ScriptApp.getService().getUrl() || ''; } catch (e) { return ''; } }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var key = props_().getProperty('SYNC_KEY');
    if (!key || body.token !== key) return json_({ ok: false, error: 'Wrong sync key. Copy it again from the Setup tab.' });
    var d = body.data || {};
    if (!Array.isArray(d.bookings) || !Array.isArray(d.payments)) return json_({ ok: false, error: 'No records received.' });
    d.expenses = d.expenses || []; d.queries = d.queries || [];
    AH.migrateEnquiries(d);
    saveLatest_(d);
    buildTabs_(d);
    var sent = 0;
    try { sent = sendReviewRequests_(d); } catch (re) { Logger.log('Review emails: ' + re); }
    var counts = d.bookings.length + ' bookings, ' + d.queries.length + ' queries, ' + d.payments.length + ' payments, ' + d.expenses.length + ' expenses' + (sent ? ', ' + sent + ' review email(s) sent' : '');
    var stamp = Utilities.formatDate(new Date(), TZ, 'dd MMM yyyy HH:mm') + ' IST';
    props_().setProperties({ LAST_SYNC: stamp, LAST_SYNC_ISO: new Date().toISOString(), LAST_COUNTS: counts });
    var sh = SpreadsheetApp.getActive().getSheetByName(TAB.setup);
    if (sh) sh.getRange('B6:B7').setValues([[stamp], [counts]]);
    return json_({ ok: true, received: counts, at: stamp });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* ignore */ }
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* Latest copy + one dated backup file per day, oldest pruned. */
function saveLatest_(d) {
  var folder = backupFolder_(), p = props_();
  var text = JSON.stringify({ app: 'athulyam-guest-manager', version: 'sheet-sync', exportedAt: new Date().toISOString(), settings: d.settings || {}, bookings: d.bookings, payments: d.payments, expenses: d.expenses, queries: d.queries || [] });
  var latestId = p.getProperty('LATEST_ID'), latest = null;
  if (latestId) { try { latest = DriveApp.getFileById(latestId); latest.setContent(text); } catch (e) { latest = null; } }
  if (!latest) { latest = folder.createFile('athulyam-latest.json', text, MimeType.PLAIN_TEXT); p.setProperty('LATEST_ID', latest.getId()); }
  var name = 'athulyam-backup-' + todayIST_() + '.json';
  var it = folder.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(text); else folder.createFile(name, text, MimeType.PLAIN_TEXT);
  var files = [], all = folder.getFiles();
  while (all.hasNext()) { var f = all.next(); if (/^athulyam-backup-\d{4}-\d{2}-\d{2}\.json$/.test(f.getName())) files.push(f); }
  files.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  files.slice(KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
}
function loadLatest_() {
  var id = props_().getProperty('LATEST_ID');
  if (!id) return null;
  try { return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()); } catch (e) { return null; }
}

/* ---------------- report tabs ---------------- */
function buildTabs_(d) {
  var ss = SpreadsheetApp.getActive(), today = todayIST_();
  var rooms = {}; ((d.settings || {}).rooms || []).forEach(function (r) { rooms[r.id] = r.name; });
  function rn(id) { return rooms[id] || id; }
  var byId = {}; d.bookings.forEach(function (b) { byId[b.id] = b; });

  var bRows = d.bookings.slice().sort(function (a, b) { return a.checkIn < b.checkIn ? 1 : -1; }).map(function (b) {
    var c = AH.calc(b, d.payments);
    return [b.guestName, b.phone, b.nationality, b.nationality === 'Foreign' ? (b.formCFiled ? 'Yes' : 'NO') : '', rn(b.roomId), b.checkIn, b.checkOut, c.nights, b.source, b.status,
      c.room, c.food, c.additional, c.discount, c.cancelFee, c.taxable, c.gst, c.total, c.commission, c.net, c.received, c.outstanding,
      AH.paymentFlags(b, c, today), b.specialRequests || '', b.id, b.email || '', b.queryId ? 'Yes' : 'No',
      props_().getProperty('REVIEW_SENT_' + b.id) || '', b.reviewConsent || '', b.reviewConsent ? (b.consentVia || '') : '', b.couponCode || '', c.coupon || 0];
  });
  writeTable_(ss, TAB.bookings, ['Guest', 'Phone', 'Nationality', 'Form C filed', 'Room', 'Check-in', 'Check-out', 'Nights', 'Source', 'Status',
    'Room ₹', 'Food ₹', 'Additional ₹', 'Discount ₹', 'Cancel fee ₹', 'Gross excl GST ₹', 'GST ₹', 'Total bill ₹', 'Commission ₹', 'Net after commission ₹', 'Received ₹', 'Outstanding ₹',
    'Payment flag', 'Special requests', 'Booking ID', 'Email', 'From a query', 'Review request emailed', 'Review consent', 'Consent via', 'Coupon code', 'Coupon ₹'], bRows, [11, 22]);
  if (bRows.length) ss.getSheetByName(TAB.bookings).getRange(2, 32, bRows.length, 1).setNumberFormat(MONEY);

  var qRows = (d.queries || []).slice().sort(function (a, b) { return String(a.createdAt) < String(b.createdAt) ? 1 : -1; }).map(function (q) {
    var bk = q.bookingId ? byId[q.bookingId] : null;
    var days = q.closedAt ? Math.max(0, Math.round((new Date(q.closedAt) - new Date(q.createdAt || q.closedAt)) / 864e5)) : '';
    return [AH.queryDate(q), q.name, q.phone || '', q.email || '', q.channel || 'Other', q.checkIn || '', q.checkOut || '', q.adults || '', q.children || 0, q.roomId ? rn(q.roomId) : '', AH.num(q.quote),
      q.status, q.status === 'Closed' ? (q.outcome || '') : '', q.lostReason || '', bk ? 'Yes' : (AH.isConverted(q) ? 'Not created yet' : ''), days, q.message || '', q.id, q.bookingId || ''];
  });
  writeTable_(ss, TAB.queries, ['Received', 'Guest', 'Phone', 'Email', 'Channel', 'Check-in', 'Check-out', 'Adults', 'Children', 'Room', 'Quote ₹', 'Status', 'Outcome', 'Reason not booked',
    'Moved to Bookings', 'Days to close', 'What they asked', 'Query ID', 'Booking ID'], qRows, [11, 11]);

  var cRows = [], cm = today.slice(0, 7);
  for (var ci = 0; ci < 12; ci++) {
    var cv = AH.queryConversion(d, AH.monthStart(cm), AH.monthEnd(cm));
    Object.keys(cv.byChannel).sort().forEach(function (k) { var x = cv.byChannel[k]; cRows.push([cm, k, x.queries, x.open, x.answered, x.booked, x.notBooked, x.conversionPct / 100]); });
    if (cv.total.queries) cRows.push([cm, 'ALL CHANNELS', cv.total.queries, cv.total.open, cv.total.answered, cv.total.booked, cv.total.notBooked, cv.total.conversionPct / 100]);
    cm = AH.prevMonth(cm);
  }
  writeTable_(ss, TAB.conversion, ['Month received', 'Channel', 'Queries', 'Open', 'Answered', 'Closed · booked', 'Closed · not booked', 'Conversion'], cRows, null);
  if (cRows.length) ss.getSheetByName(TAB.conversion).getRange(2, 8, cRows.length, 1).setNumberFormat('0.0%');

  buildDashboard_(ss, d, today);
  buildConsent_(d);

  var pRows = d.payments.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (p) {
    var b = byId[p.bookingId] || {};
    return [p.date, b.guestName || '(deleted booking)', rn(b.roomId), p.type === 'refund' ? 'Refund' : 'Payment', p.type === 'refund' ? -p.amount : p.amount, p.method, p.ref || '', b.source || '', p.bookingId];
  });
  writeTable_(ss, TAB.payments, ['Date', 'Guest', 'Room', 'Type', 'Amount ₹', 'Method', 'Reference', 'Booking source', 'Booking ID'], pRows, [5, 5]);

  var eRows = d.expenses.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).map(function (x) { return [x.date, x.category, x.amount, x.method, x.note || '']; });
  writeTable_(ss, TAB.expenses, ['Date', 'Category', 'Amount ₹', 'Paid by', 'Note'], eRows, [3, 3]);

  var dRows = [];
  for (var i = 0; i < 62; i++) {
    var dt = AH.addDays(today, -i), r = AH.dailyReport(d, dt), v = r.revenue, col = r.collections;
    dRows.push([dt, r.checkIns.length, r.checkOuts.length, r.inHouse.length, r.newBookings.length, v.room, v.food, v.additional + v.cancelFee, v.discount, v.taxable, v.gst, v.billed, v.commission, v.net,
      col.byMethod.Cash, col.byMethod.UPI, AH.r2(col.byMethod.Card + col.byMethod['Bank Transfer'] + col.byMethod['Online Platform']), col.refunds, col.net, r.expenses]);
  }
  writeTable_(ss, TAB.daily, ['Date', 'Check-ins', 'Check-outs', 'In-house', 'New bookings', 'Room ₹', 'Food ₹', 'Other ₹', 'Discounts ₹', 'Gross excl GST ₹', 'GST ₹', 'Billed ₹', 'Commission ₹', 'Net ₹',
    'Cash in ₹', 'UPI in ₹', 'Card/bank/platform in ₹', 'Refunds ₹', 'Net collected ₹', 'Expenses ₹'], dRows, [6, 20]);

  var mRows = [], ym = today.slice(0, 7);
  for (var m = 0; m < 24; m++) {
    var mr = AH.monthlyReport(d, ym), t = mr.revenue;
    mRows.push([ym, mr.bookings, mr.cancellations, t.nights, mr.occupancyPct / 100, t.room, t.food, t.additional + t.cancelFee, t.discount, t.taxable, t.gst, t.commission, t.net,
      mr.collections.received, mr.collections.refunds, mr.pending, mr.expenses, mr.profit, mr.avgPerNight]);
    ym = AH.prevMonth(ym);
  }
  writeTable_(ss, TAB.monthly, ['Month', 'Bookings', 'Cancelled', 'Room nights', 'Occupancy', 'Room ₹', 'Food ₹', 'Other ₹', 'Discounts ₹', 'Gross excl GST ₹', 'GST ₹', 'Commission ₹', 'Net ₹',
    'Received ₹', 'Refunds ₹', 'Pending ₹', 'Expenses ₹', 'Profit ₹', 'Avg per room night ₹'], mRows, [6, 19]);
  ss.getSheetByName(TAB.monthly).getRange(2, 5, Math.max(mRows.length, 1), 1).setNumberFormat('0.0%');

  var plRows = [];
  [today.slice(0, 7), AH.prevMonth(today.slice(0, 7)), AH.prevMonth(AH.prevMonth(today.slice(0, 7)))].forEach(function (mm) {
    var pr = AH.platformReport(d, AH.monthStart(mm), AH.monthEnd(mm));
    Object.keys(pr).forEach(function (k) { var x = pr[k]; plRows.push([mm, k, x.bookings, x.room, x.food, x.other, x.discount, x.taxable, x.gst, x.commission, x.net, x.collected, x.outstanding]); });
  });
  writeTable_(ss, TAB.platforms, ['Arrival month', 'Platform', 'Bookings', 'Room ₹', 'Food ₹', 'Other ₹', 'Discount ₹', 'Gross excl GST ₹', 'GST ₹', 'Commission ₹', 'Net ₹', 'Collected ₹', 'Outstanding ₹'], plRows, [4, 13]);

  var gRows = [], gm = today.slice(0, 7);
  for (var g = 0; g < 12; g++) {
    AH.gstSummary(d, gm).rows.forEach(function (x) { gRows.push([gm, x.kind, x.rate / 100, x.taxable, x.gst, AH.r2(x.gst / 2), AH.r2(x.gst / 2), x.invoices]); });
    gm = AH.prevMonth(gm);
  }
  writeTable_(ss, TAB.gst, ['Month (check-out)', 'Type', 'GST rate', 'Taxable ₹', 'GST ₹', 'CGST ₹', 'SGST ₹', 'Bills'], gRows, [4, 7]);
  ss.getSheetByName(TAB.gst).getRange(2, 3, Math.max(gRows.length, 1), 1).setNumberFormat('0%');

  var poRows = AH.payoutReport(d, '2000-01-01', AH.addDays(today, 400)).map(function (x) {
    return [x.b.checkOut, x.b.guestName, x.b.source, x.viaPlatform, x.commission, x.expected, x.received, x.difference, x.matched ? 'Matched' : (x.received ? 'Mismatch' : 'Awaiting')];
  });
  writeTable_(ss, TAB.payouts, ['Check-out', 'Guest', 'Platform', 'Collected by platform ₹', 'Commission ₹', 'Expected payout ₹', 'Payout received ₹', 'Difference ₹', 'Status'], poRows, [4, 8]);
}

function writeTable_(ss, name, header, rows, moneyCols) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#1e3a2b').setFontColor('#ffffff').setWrap(true);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, header.length).setValues(rows);
    if (moneyCols) sh.getRange(2, moneyCols[0], rows.length, moneyCols[1] - moneyCols[0] + 1).setNumberFormat(MONEY);
  } else {
    sh.getRange(2, 1).setValue('No records yet.');
  }
  sh.setFrozenRows(1);
  if (sh.getFilter()) sh.getFilter().remove();
  if (rows.length) sh.getRange(1, 1, rows.length + 1, header.length).createFilter();
  sh.autoResizeColumns(1, Math.min(header.length, 10));
}

/* ---------------- reminders (hourly trigger, sends at the hours you set in the app) ---------------- */
function hourlyCheck() {
  var d = loadLatest_();
  if (!d) return;
  var r = (d.settings && d.settings.reminders) || { arrivals: 8, payments: 9, summary: 20, monthly: 9, enabled: true };
  if (r.enabled === false) return;
  var h = hourIST_(), today = todayIST_(), p = props_();
  function once(kind, fn) {
    var k = 'SENT_' + kind + '_' + today;
    if (p.getProperty(k)) return;
    fn(); p.setProperty(k, '1');
  }
  if (h === Number(r.arrivals)) once('arrivals', function () { sendArrivals_(d, today); });
  if (h === Number(r.payments)) once('payments', function () { sendPayments_(d, today); });
  if (h === Number(r.summary)) once('summary', function () { sendSummary_(d, today); });
  if (today.slice(8) === '01' && h === Number(r.monthly)) once('monthly', function () { sendMonthly_(d, AH.prevMonth(today.slice(0, 7))); });
  cleanupSentFlags_();
}
function cleanupSentFlags_() {
  var p = props_(), keys = p.getKeys(), cutoff = AH.addDays(todayIST_(), -3);
  keys.forEach(function (k) { var m = k.match(/^SENT_\w+_(\d{4}-\d{2}-\d{2})$/); if (m && m[1] < cutoff) p.deleteProperty(k); });
}
function recipient_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB.setup);
  var e = sh ? String(sh.getRange('B4').getValue()).trim() : '';
  return e || Session.getEffectiveUser().getEmail();
}
function staleNote_() {
  var iso = props_().getProperty('LAST_SYNC_ISO');
  var hrs = iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : 999;
  var when = props_().getProperty('LAST_SYNC') || 'never';
  return '<p style="color:' + (hrs > 24 ? '#b3402f' : '#68716a') + ';font-size:12px">Figures as of the last sync from your phone: ' + when + (hrs > 24 ? ' — open the app while online to refresh.' : '') + '</p>';
}
function inr_(x) { return AH.inr(x); }
function wrap_(title, inner) {
  return '<div style="font-family:Arial,sans-serif;max-width:560px;color:#1d241f"><div style="background:#1e3a2b;color:#fff;padding:12px 16px;border-bottom:3px solid #b8955a;font-size:18px">' + title + '</div><div style="padding:12px 16px">' + inner + staleNote_() + '</div></div>';
}
function table_(rows) {
  return '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows.map(function (r) {
    return '<tr><td style="padding:5px 0;border-bottom:1px solid #eee">' + r[0] + '</td><td style="padding:5px 0;border-bottom:1px solid #eee;text-align:right"><b>' + r[1] + '</b></td></tr>';
  }).join('') + '</table>';
}
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function roomName_(d, id) { var r = ((d.settings || {}).rooms || []).filter(function (x) { return x.id === id; })[0]; return r ? r.name : ''; }
function send_(subject, html) { MailApp.sendEmail({ to: recipient_(), subject: subject, htmlBody: html, name: 'Athulyam Homes' }); }

function sendArrivals_(d, today) {
  var r = AH.dailyReport(d, today), fc = AH.formCPending(d, today);
  var tomorrow = (d.bookings || []).filter(function (b) { return AH.isActive(b) && b.checkIn === AH.addDays(today, 1); });
  function li(b) { var c = AH.calc(b, d.payments); return '<li><b>' + esc_(b.guestName) + '</b> · ' + esc_(roomName_(d, b.roomId)) + ' · ' + c.nights + 'N · ' + esc_(b.source) + (b.phone ? ' · ' + esc_(b.phone) : '') + ' · balance ' + inr_(c.outstanding) + (b.nationality === 'Foreign' ? ' · <b>foreign guest</b>' : '') + '</li>'; }
  var html = '<h3>Arriving today (' + r.checkIns.length + ')</h3>' + (r.checkIns.length ? '<ul>' + r.checkIns.map(li).join('') + '</ul>' : '<p>No arrivals today.</p>') +
    '<h3>Departing today (' + r.checkOuts.length + ')</h3>' + (r.checkOuts.length ? '<ul>' + r.checkOuts.map(li).join('') + '</ul>' : '<p>None.</p>') +
    (fc.length ? '<h3 style="color:#b3402f">Form C due (within 24 hours of check-in)</h3><ul>' + fc.map(li).join('') + '</ul><p><a href="https://indianfrro.gov.in/frro/FormC">Open the Form C portal</a></p>' : '') +
    '<h3>Tomorrow (' + tomorrow.length + ')</h3>' + (tomorrow.length ? '<ul>' + tomorrow.map(li).join('') + '</ul>' : '<p>No arrivals tomorrow.</p>') + couponHtml_(d, today);
  send_('Athulyam · ' + r.checkIns.length + ' arrival(s) today' + (fc.length ? ' · Form C due' : ''), wrap_('Today’s arrivals · ' + today, html));
}
function couponHtml_(d, today) {
  var cc = AH.couponCandidates(d, today);
  if (!cc.length) return '';
  return '<h3 style="color:#9a6a12">Offer a coupon? Direct queries arriving soon, not booked, rooms free</h3><ul>' + cc.map(function (q) {
    return '<li><b>' + esc_(q.name) + '</b> · arriving ' + esc_(q.checkIn) + (AH.num(q.quote) ? ' · quoted ' + inr_(q.quote) : '') + (q.phone ? ' · ' + esc_(q.phone) : '') + (q.couponCode ? ' · coupon ' + esc_(q.couponCode) + ' already offered' : '') + '</li>';
  }).join('') + '</ul><p style="font-size:12px;color:#68716a">Open the query in the app → Offer a coupon (5%, 10%, 15% or custom) → send on WhatsApp.</p>';
}
function sendPayments_(d, today) {
  var list = AH.outstandingAll(d);
  var overdue = list.filter(function (x) { return AH.paymentFlags(x.b, x.c, today) === 'overdue'; });
  var noAdv = list.filter(function (x) { return AH.paymentFlags(x.b, x.c, today) === 'no-advance'; });
  var future = list.filter(function (x) { var f = AH.paymentFlags(x.b, x.c, today); return f === 'pending' || f === 'due-today'; });
  var refunds = list.filter(function (x) { return x.c.outstanding < 0; });
  function li(x) { return '<li><b>' + esc_(x.b.guestName) + '</b> · ' + esc_(roomName_(d, x.b.roomId)) + ' · arr ' + x.b.checkIn + ' · ' + esc_(x.b.source) + ' · <b>' + inr_(Math.abs(x.c.outstanding)) + '</b>' + (x.b.phone ? ' · ' + esc_(x.b.phone) : '') + '</li>'; }
  var total = AH.sum(list.filter(function (x) { return x.c.outstanding > 0; }), function (x) { return x.c.outstanding; });
  if (!overdue.length && !noAdv.length && !future.length && !refunds.length) { send_('Athulyam · no pending payments', wrap_('Pending payments · ' + today, '<p>All balances are clear.</p>')); return; }
  var html = table_([['Total owed by guests', inr_(total)], ['Overdue (guest arrived or left)', String(overdue.length)], ['Confirmed, no advance yet', String(noAdv.length)], ['Refunds you owe', String(refunds.length)]]) +
    (overdue.length ? '<h3 style="color:#b3402f">Overdue</h3><ul>' + overdue.map(li).join('') + '</ul>' : '') +
    (noAdv.length ? '<h3>Unpaid advances</h3><ul>' + noAdv.map(li).join('') + '</ul>' : '') +
    (future.length ? '<h3>Balance due on arrival</h3><ul>' + future.map(li).join('') + '</ul>' : '') +
    (refunds.length ? '<h3>Refunds / overpaid</h3><ul>' + refunds.map(li).join('') + '</ul>' : '');
  send_('Athulyam · ' + inr_(total) + ' pending' + (overdue.length ? ' · ' + overdue.length + ' overdue' : ''), wrap_('Pending payments · ' + today, html));
}
function sendSummary_(d, today) {
  var r = AH.dailyReport(d, today), v = r.revenue, c = r.collections;
  var html = table_([['Check-ins / check-outs', r.checkIns.length + ' / ' + r.checkOuts.length], ['In-house tonight', String(r.inHouse.length)], ['New bookings', String(r.newBookings.length)],
    ['Room revenue', inr_(v.room)], ['Food revenue', inr_(v.food)], ['Other + fees', inr_(v.additional + v.cancelFee)], ['Discounts', '−' + inr_(v.discount)], ['Gross (excl. GST)', inr_(v.taxable)], ['GST', inr_(v.gst)],
    ['Commission', '−' + inr_(v.commission)], ['Net after commission', inr_(v.net)], ['Cash received', inr_(c.byMethod.Cash)], ['UPI received', inr_(c.byMethod.UPI)],
    ['Card / bank / platform', inr_(c.byMethod.Card + c.byMethod['Bank Transfer'] + c.byMethod['Online Platform'])], ['Refunds paid', '−' + inr_(c.refunds)], ['Net collected today', inr_(c.net)],
    ['Expenses today', inr_(r.expenses)], ['All outstanding balances', inr_(r.outstandingTotal)]]);
  send_('Athulyam daily · billed ' + inr_(v.billed) + ' · collected ' + inr_(c.net), wrap_('Daily summary · ' + today, dashboardHtml_(d, today) + '<h3>Today’s money</h3>' + html));
}
function sendMonthly_(d, ym) {
  var m = AH.monthlyReport(d, ym), t = m.revenue;
  var plat = Object.keys(m.byPlatform).map(function (k) { return [esc_(k) + ' (' + m.byPlatform[k].nights + ' nights)', inr_(m.byPlatform[k].net)]; });
  var html = table_([['Bookings (arrivals)', String(m.bookings)], ['Room nights · occupancy', t.nights + ' · ' + m.occupancyPct + '%'], ['Room revenue', inr_(t.room)], ['Food revenue', inr_(t.food)],
    ['Other + fees', inr_(t.additional + t.cancelFee)], ['Discounts', '−' + inr_(t.discount)], ['Gross (excl. GST)', inr_(t.taxable)], ['GST billed', inr_(t.gst)], ['Commission', '−' + inr_(t.commission)],
    ['Net after commission', inr_(t.net)], ['Payments received', inr_(m.collections.received)], ['Pending on these stays', inr_(m.pending)], ['Expenses', '−' + inr_(m.expenses)], ['Profit', inr_(m.profit)],
    ['Average per room night', inr_(m.avgPerNight)]]) + (plat.length ? '<h3>Net by platform</h3>' + table_(plat) : '') + conversionHtml_(d, ym);
  send_('Athulyam monthly · ' + ym + ' · net ' + inr_(t.net), wrap_('Monthly summary · ' + ym, html));
}


/* ---------------- dashboard (Sheet tab + top of the daily email) ---------------- */
function buildDashboard_(ss, d, today) {
  var x = AH.dashboard(d, today), q = x.queries, b = x.bookings, p = x.payments;
  var rows = [
    ['QUERIES', '', ''],
    ['Open (waiting for your reply)', q.open, 'All time'],
    ['Answered (waiting on the guest)', q.answered, 'All time'],
    ['Closed · booked', q.closedBookedThisMonth, 'Closed this month'],
    ['Closed · not booked', q.closedNotBookedThisMonth, 'Closed this month'],
    ['Received this month', q.receivedThisMonth, x.month],
    ['Conversion this month', q.conversionPctThisMonth / 100, 'Booked ÷ queries received this month'],
    ['', '', ''],
    ['BOOKINGS', '', ''],
    ['Waiting for check-in', b.waitingCheckIn, 'Status Confirmed'],
    ['Checked in now', b.checkedIn, ''],
    ['Checked out this month', b.checkedOutThisMonth, x.month],
    ['Cancelled this month', b.cancelledThisMonth, x.month],
    ['Booked from a query this month', b.fromQueriesThisMonth, x.month],
    ['', '', ''],
    ['PAYMENTS (confirmed + checked-in bookings)', '', ''],
    ['Paid in full', p.paid, ''],
    ['Part paid', p.partPaid, ''],
    ['Unpaid (no advance yet)', p.unpaid, '']
  ];
  writeTable_(ss, TAB.dashboard, ['Dashboard · as of ' + today, 'Count', 'Note'], rows, null);
  var sh = ss.getSheetByName(TAB.dashboard);
  sh.getRange(8, 2).setNumberFormat('0.0%');
  [2, 10, 17].forEach(function (r) { sh.getRange(r, 1, 1, 3).setFontWeight('bold').setBackground('#efe4cf'); });
  if (sh.getFilter()) sh.getFilter().remove();
}
function dashboardHtml_(d, today) {
  var x = AH.dashboard(d, today), q = x.queries, b = x.bookings, p = x.payments;
  function box(label, val, sub) { return '<td style="padding:8px;border:1px solid #e6e2d8;vertical-align:top;width:33%"><div style="font-size:12px;color:#68716a">' + label + '</div><div style="font-size:22px;font-weight:bold;color:#1e3a2b">' + val + '</div><div style="font-size:11px;color:#68716a">' + (sub || '') + '</div></td>'; }
  return '<h3 style="margin:4px 0 8px">Dashboard</h3><table style="border-collapse:collapse;width:100%;font-family:Arial">' +
    '<tr>' + box('Queries open', q.open, 'waiting for your reply') + box('Answered', q.answered, 'waiting on the guest') + box('Converted this month', q.conversionPctThisMonth + '%', q.closedBookedThisMonth + ' booked · ' + q.closedNotBookedThisMonth + ' not') + '</tr>' +
    '<tr>' + box('Waiting for check-in', b.waitingCheckIn, '') + box('Checked in', b.checkedIn, '') + box('Cancelled this month', b.cancelledThisMonth, b.checkedOutThisMonth + ' checked out') + '</tr>' +
    '<tr>' + box('Paid in full', p.paid, 'of open bookings') + box('Part paid', p.partPaid, '') + box('Unpaid', p.unpaid, 'no advance yet') + '</tr></table>' + conversionHtml_(d, x.month);
}
function conversionHtml_(d, ym) {
  var cv = AH.queryConversion(d, AH.monthStart(ym), AH.monthEnd(ym)), keys = Object.keys(cv.byChannel);
  if (!keys.length) return '';
  return '<h3>Query conversion by channel · ' + ym + '</h3>' + table_(keys.map(function (k) { var x = cv.byChannel[k]; return [esc_(k) + ' (' + x.queries + ' queries, ' + x.open + ' open)', x.booked + ' booked · ' + x.conversionPct + '%']; }));
}

/* ---------------- guest feedback & review consent ---------------- */
function feedbackSheet_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(TAB.feedback);
  if (!sh) {
    sh = ss.insertSheet(TAB.feedback);
    sh.getRange(1, 1, 1, FEEDBACK_HEAD.length).setValues([FEEDBACK_HEAD]).setFontWeight('bold').setBackground('#1e3a2b').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}
function feedbackRows_() {
  var sh = feedbackSheet_(), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, FEEDBACK_HEAD.length).getValues();
}
/* Review consent tab = "Yes" answers from the feedback form + "Yes" recorded in the app (WhatsApp replies etc.). */
function buildConsent_(d) {
  var ss = SpreadsheetApp.getActive(), seen = {}, rows = [];
  feedbackRows_().slice().reverse().forEach(function (r) {
    var id = String(r[1]);
    if (seen[id]) return; seen[id] = 1;
    if (String(r[8]).indexOf('Yes') === 0) rows.push([r[0], r[2], r[3], r[4], 'Yes', 'Feedback form', r[9], r[5], r[6], id]);
  });
  ((d && d.bookings) || []).forEach(function (b) {
    if (b.reviewConsent !== 'Yes' || seen[b.id]) return;
    seen[b.id] = 1;
    rows.push([String(b.consentAt || '').slice(0, 10), b.guestName, b.source, b.checkOut, 'Yes', b.consentVia || 'Recorded in app', 'First name only', '', '', b.id]);
  });
  writeTable_(ss, TAB.consent, ['Consent date', 'Guest', 'Channel', 'Check-out', 'May share review', 'Given via', 'Name to show', 'Rating', 'What they said', 'Booking ID'], rows, null);
}
function findBooking_(id, t) {
  var d = loadLatest_();
  if (!d || !id) return null;
  var b = (d.bookings || []).filter(function (x) { return x.id === id; })[0];
  return b && b.fbToken && b.fbToken === t ? { b: b, d: d } : null;
}
function feedbackPage_(prm) {
  var found = findBooking_(prm.id, prm.t);
  var biz = found ? ((found.d.settings || {}).businessName || 'Athulyam Homes') : 'Athulyam Homes';
  var html = HtmlService.createHtmlOutput(feedbackHtml_(found, prm, biz)).setTitle(biz + ' · Your feedback');
  try { html.addMetaTag('viewport', 'width=device-width, initial-scale=1'); } catch (e) { /* ignore */ }
  return html;
}
function feedbackHtml_(found, prm, biz) {
  var css = '<style>body{font-family:Arial,sans-serif;background:#f4f2ec;color:#1d241f;margin:0;padding:16px}.box{max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:20px;border:1px solid #e6e2d8}' +
    'h1{font-size:22px;color:#1e3a2b;margin:0 0 4px}p{line-height:1.5}label{display:block;font-weight:bold;margin:16px 0 6px}textarea,select{width:100%;box-sizing:border-box;font-size:16px;padding:10px;border:1px solid #d9d4c7;border-radius:10px}' +
    '.stars{display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:4px}.stars input{display:none}.stars label{font-size:36px;color:#d9d4c7;cursor:pointer;margin:0}.stars input:checked~label,.stars label:hover,.stars label:hover~label{color:#b8955a}' +
    '.opt{font-weight:normal;display:flex;gap:8px;align-items:flex-start;margin:8px 0}.opt input{margin-top:3px}button{width:100%;margin-top:20px;background:#1e3a2b;color:#fff;border:0;border-radius:12px;padding:14px;font-size:17px;font-weight:bold}' +
    '.small{font-size:13px;color:#68716a}.err{color:#b3402f;font-weight:bold}</style>';
  if (!found) return css + '<div class="box"><h1>' + esc_(biz) + '</h1><p>This feedback link has expired or is incomplete. Please reply to our WhatsApp message instead — we would love to hear from you.</p></div>';
  var b = found.b;
  return css + '<div class="box" id="box"><h1>How was your stay, ' + esc_(String(b.guestName || '').split(' ')[0]) + '?</h1>' +
    '<p class="small">' + esc_(biz) + ' · ' + esc_(b.checkIn) + ' to ' + esc_(b.checkOut) + '</p>' +
    '<label>Your rating</label><div class="stars">' + [5, 4, 3, 2, 1].map(function (n) { return '<input type="radio" name="rating" id="s' + n + '" value="' + n + '"><label for="s' + n + '" title="' + n + ' star' + (n > 1 ? 's' : '') + '">★</label>'; }).join('') + '</div>' +
    '<label for="liked">What did you enjoy?</label><textarea id="liked" rows="3" maxlength="1500"></textarea>' +
    '<label for="better">What could we do better? (only we see this)</label><textarea id="better" rows="3" maxlength="1500"></textarea>' +
    '<label>May we share your review on our other booking pages and social media?</label>' +
    '<div class="opt"><input type="radio" name="consent" id="cy" value="Yes"><label class="opt" for="cy" style="margin:0">Yes, you may share it</label></div>' +
    '<div class="opt"><input type="radio" name="consent" id="cn" value="No"><label class="opt" for="cn" style="margin:0">No, keep it private</label></div>' +
    '<label for="show">If shared, show my name as</label><select id="show"><option>First name only</option><option>Full name</option><option>Anonymous</option></select>' +
    '<p id="msg" class="err"></p><button id="send">Submit feedback</button><p class="small">Thank you for helping us look after our guests better.</p></div>' +
    '<script>document.getElementById("send").onclick=function(){var r=document.querySelector("input[name=rating]:checked"),c=document.querySelector("input[name=consent]:checked"),m=document.getElementById("msg");' +
    'if(!r){m.textContent="Please choose a star rating.";return}if(!c){m.textContent="Please tell us whether we may share your review.";return}this.disabled=true;this.textContent="Sending…";' +
    'google.script.run.withSuccessHandler(function(t){document.getElementById("box").innerHTML="<h1>Thank you!</h1><p>"+t+"</p>"}).withFailureHandler(function(e){m.textContent="Could not send: "+e.message;var bt=document.getElementById("send");bt.disabled=false;bt.textContent="Submit feedback"})' +
    '.submitFeedback({id:' + JSON.stringify(b.id) + ',t:' + JSON.stringify(b.fbToken) + ',rating:r.value,liked:document.getElementById("liked").value,better:document.getElementById("better").value,consent:c.value,show:document.getElementById("show").value})}</script>';
}
/* Called from the feedback page. */
function submitFeedback(f) {
  f = f || {};
  var found = findBooking_(f.id, f.t);
  if (!found) throw new Error('This feedback link is not valid any more.');
  var b = found.b, rating = Math.max(1, Math.min(5, Math.round(Number(f.rating) || 0)));
  var clip = function (x) { return String(x || '').replace(/^[=+\-@]/, "'$&").slice(0, 1500); };
  var consent = f.consent === 'Yes' ? 'Yes' : 'No', show = ['First name only', 'Full name', 'Anonymous'].indexOf(f.show) >= 0 ? f.show : 'First name only';
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    feedbackSheet_().appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'), b.id, b.guestName, b.source, b.checkOut, rating, clip(f.liked), clip(f.better), consent, consent === 'Yes' ? show : '']);
    buildConsent_(found.d);
  } finally { lock.releaseLock(); }
  notifyOwnerFeedback_(b, rating, clip(f.liked), clip(f.better), consent);
  var links = AH.reviewLinks(found.d.settings || {}, b.source);
  return rating >= 4 && links.google ? 'We are so glad you enjoyed your stay. If you have a moment, a Google review helps other travellers find us: <a href="' + esc_(links.google) + '" target="_top">Rate us on Google</a>'
    : 'Your feedback has reached us. We read every response and will be in touch if there is anything we can put right.';
}
function notifyOwnerFeedback_(b, rating, liked, better, consent) {
  var stars = new Array(rating + 1).join('★') + new Array(6 - rating).join('☆');
  var html = table_([['Guest', esc_(b.guestName)], ['Channel', esc_(b.source)], ['Stay', esc_(b.checkIn + ' to ' + b.checkOut)], ['Rating', stars + ' (' + rating + '/5)'],
    ['Enjoyed', esc_(liked) || '—'], ['Could be better', esc_(better) || '—'], ['May share review', consent]]) + (rating <= 3 ? '<p style="color:#b3402f"><b>Low rating — worth a personal call today.</b></p>' : '');
  try { send_('Athulyam · new feedback ' + rating + '/5 from ' + String(b.guestName || '').split(' ')[0] + ' (' + b.source + ')', wrap_('New guest feedback', html)); } catch (e) { Logger.log('Owner email failed: ' + e); }
  whatsappOwner_('Athulyam: new feedback ' + rating + '/5 from ' + String(b.guestName || '').split(' ')[0] + ' (' + b.source + '). Share consent: ' + consent + '.' + (rating <= 3 ? ' Low rating - please call.' : ''));
}
/* Free WhatsApp alert to yourself via CallMeBot (personal use). Silent if not set up. Sends no phone numbers or comments. */
function whatsappOwner_(text) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB.setup);
  if (!sh) return false;
  var phone = String(sh.getRange('B10').getValue()).replace(/\D/g, ''), key = String(sh.getRange('B11').getValue()).trim();
  if (phone.length < 10 || !key || /FILL IN/i.test(key)) return false;
  try {
    var r = UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=' + phone + '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(key), { muteHttpExceptions: true });
    return r.getResponseCode() === 200;
  } catch (e) { Logger.log('WhatsApp alert failed: ' + e); return false; }
}

/* ---------------- review request emails to guests (after check-out) ---------------- */
function sendReviewRequests_(d) {
  var st = d.settings || {};
  if (st.autoReviewEmail === false) return 0;
  var base = st.syncUrl || webAppUrl_(), today = todayIST_(), p = props_(), sent = 0;
  (d.bookings || []).forEach(function (b) {
    if (b.status !== 'Checked Out' || !b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return;
    if (b.checkOut < AH.addDays(today, -14) || p.getProperty('REVIEW_SENT_' + b.id)) return;
    if (MailApp.getRemainingDailyQuota() < 5) return;
    var fb = base && b.fbToken ? base + '?page=feedback&id=' + encodeURIComponent(b.id) + '&t=' + b.fbToken : '';
    MailApp.sendEmail({ to: b.email, subject: 'Thank you for staying at ' + (st.businessName || 'Athulyam Homes'), htmlBody: reviewEmailHtml_(b, st, fb), name: st.businessName || 'Athulyam Homes', replyTo: recipient_() });
    p.setProperty('REVIEW_SENT_' + b.id, today);
    sent++;
  });
  return sent;
}
function reviewEmailHtml_(b, st, fb) {
  var biz = st.businessName || 'Athulyam Homes', links = AH.reviewLinks(st, b.source), direct = b.source === 'Direct Booking' || !links.channel;
  function btn(label, url, primary) { return url ? '<p style="margin:10px 0"><a href="' + esc_(url) + '" style="display:inline-block;background:' + (primary ? '#1e3a2b' : '#ffffff') + ';color:' + (primary ? '#ffffff' : '#1e3a2b') + ';border:2px solid #1e3a2b;border-radius:10px;padding:12px 22px;text-decoration:none;font-weight:bold;font-size:15px">' + esc_(label) + '</a></p>' : ''; }
  var first = esc_(String(b.guestName || '').split(' ')[0]);
  return '<div style="font-family:Arial,sans-serif;max-width:560px;color:#1d241f"><div style="background:#1e3a2b;color:#fff;padding:14px 18px;border-bottom:3px solid #b8955a;font-size:20px">' + esc_(biz) + '</div><div style="padding:16px 18px;line-height:1.55">' +
    '<p>Namaste ' + first + ',</p><p>Thank you for staying with us. We hope your stay was pleasant and the hills treated you well.</p>' +
    '<p>Your review helps other travellers find us, and your feedback helps us look after you even better next time. It takes less than a minute:</p>' +
    btn('Rate us on Google', links.google, true) +
    (!direct ? btn('Rate us on ' + b.source, links.channel, false) + '<p style="font-size:12px;color:#68716a;margin-top:-4px">Only guests can review on ' + esc_(b.source) + ': open your ' + esc_(b.source) + ' app, go to this booking and tap Write a review.</p>' : '') +
    btn('Submit feedback', fb, false) +
    '<p>If anything disappointed you, please tell us through the feedback link or simply reply to this email. We read every message and will put it right.</p>' +
    (direct ? '<p>You are also welcome to reply on WhatsApp with a few words about your stay. If you are happy for us to share a screenshot of your message (first name only) on our Google, Instagram and booking pages, just tell us "Yes" in your reply.</p>' : '') +
    '<p>Warm regards,<br>' + esc_(biz) + '</p></div></div>';
}

/* Run this from the editor to check email works. It reports exactly what happened. */
function testEmail() {
  var to = recipient_(), quota = MailApp.getRemainingDailyQuota();
  var report = [];
  report.push('Sending to: ' + to);
  report.push('Emails left today (Google quota): ' + quota);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) report.push('PROBLEM: the address in Setup!B4 does not look like an email address.');
  var d = loadLatest_();
  report.push(d ? 'Phone data found (last sync ' + (props_().getProperty('LAST_SYNC') || '?') + '), so this sends today\'s daily summary.' : 'No phone data synced yet, so this sends a simple test email titled "Athulyam · test email".');
  try {
    if (quota < 1) throw new Error('Daily email quota used up. Try again tomorrow.');
    if (!d) send_('Athulyam · test email', wrap_('Test email', '<p>Email works. No data has been synced from the app yet.</p>'));
    else sendSummary_(d, todayIST_());
    report.push('RESULT: Google accepted the email. Check Inbox, Spam, and All Mail for a message from "Athulyam Homes".');
  } catch (err) {
    report.push('RESULT: FAILED — ' + (err && err.message || err));
  }
  var text = report.join('\n');
  Logger.log(text);
  try { SpreadsheetApp.getUi().alert(text); } catch (e) { /* editor run: see Execution log */ }
  return text;
}
