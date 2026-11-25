/* Athulyam Homes Guest Manager — Staff & leave screens.
   Staff and leave entries are kept in Settings (settings.staff, settings.staffLeaves), so they are saved on the
   phone, go into backups and sync to the Sheet with the rest of Settings (no Code.gs change needed).
   Rules live in leave-logic.js (AHLeave). Leave is never deleted: it is cancelled and stays visible. */
(function () {
  'use strict';
  var H = window.AHApp && window.AHApp.ext, L = window.AHLeave;
  if (!H || !L) return;
  var routes = H.routes, esc = H.esc, field = H.field, options = H.options, tile = H.tile, empty = H.empty, inr = H.inr;
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function S() { var s = H.S(); if (!Array.isArray(s.staff)) s.staff = []; if (!Array.isArray(s.staffLeaves)) s.staffLeaves = []; return s; }
  function staffList() { return S().staff.map(L.cleanStaff); }
  function staffById(id) { return staffList().filter(function (x) { return x.id === id; })[0]; }
  function leaves() { return S().staffLeaves; }
  function periodName(st, p) { return st.leavePeriod === 'month' ? H.fmtMonth(p) : 'FY ' + p; }
  function rangeText(l) { return l.half ? H.fmtDate(l.from) + ' · half day' : l.from === l.to ? H.fmtDate(l.from) : H.fmtShort(l.from) + ' → ' + H.fmtDate(l.to); }
  var D = L.fmtDays, calMonth = '', pageMonth = {};

  /* small styles for the leave colours (theme colours, work in dark mode: green = paid, gold = half day, red = unpaid) */
  if (!document.getElementById('lv-css')) {
    var css = document.createElement('style'); css.id = 'lv-css';
    css.textContent = '.lv-p{background:var(--ok-soft,#e2efe5);color:var(--ok,#2c6a44)}.lv-u{background:var(--red-soft,#f8e4df);color:var(--red,#b1402f)}.lv-h{background:var(--gold-soft,#f1e6d0);color:var(--gold,#b48e52)}' +
      '.cal td.lv-p,.cal td.lv-u,.cal td.lv-h{font-size:11px;text-align:center;font-weight:600}.lg.lv-p,.lg.lv-u,.lg.lv-h{display:inline-block}' +
      '.lvrow{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.lvrow .lvx{text-decoration:line-through;opacity:.55}' +
      '.lvtag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:10px;margin:2px 4px 0 0}';
    document.head.appendChild(css);
  }

  /* ---------- Staff list ---------- */
  routes.staff = function () {
    var t = H.today(), ym = t.slice(0, 7), all = staffList(), act = all.filter(function (x) { return x.active; }), old = all.filter(function (x) { return !x.active; });
    var off = L.onDate(act, leaves(), t), offN = Object.keys(off).length;
    var unpaidM = 0, cutM = 0;
    var cards = act.map(function (st) {
      var b = L.balance(st, leaves(), L.periodOf(st, t)), m = L.monthSummary(st, leaves(), ym);
      unpaidM += m.unpaid; cutM += m.deduction;
      return '<a class="card bk" href="#/staffp/' + st.id + '"><div class="bk-top"><b>' + esc(st.name) + '</b>' + (off[st.id] ? '<span class="st lv-' + (off[st.id].unpaid ? 'u' : 'p') + '">On leave today</span>' : '') + '</div>' +
        '<div class="bk-mid">' + esc(st.role || 'Staff') + ' · ' + D(st.paidLeave) + ' paid leave per ' + (st.leavePeriod === 'month' ? 'month' : 'year') + '</div>' +
        '<div class="bk-bot"><span>Paid left <b>' + D(b.paidLeft) + '</b></span><span>Used ' + D(b.paidUsed) + '</span><span class="' + (m.unpaid ? 'due' : '') + '">Unpaid ' + H.fmtMonth(ym).slice(0, 3) + ' <b>' + D(m.unpaid) + '</b>' + '</span></div>' +
        (b.paidLeft === 0 && st.paidLeave > 0 ? '<div class="flag fl-overdue">Paid leave used up — further leave is unpaid</div>' : '') + '</a>';
    }).join('');
    var html = '<div class="actions"><a class="btn primary" href="#/staffedit/new">+ Add staff</a><a class="btn" href="#/staffcal">Leave calendar</a></div>' +
      (act.length ? '<div class="tiles">' + tile('On leave today', String(offN), offN ? Object.keys(off).map(function (id) { return esc(staffById(id).name); }).join(', ') : 'Everyone in') +
        tile('Unpaid days · ' + H.fmtMonth(ym), D(unpaidM), cutM ? 'Salary cut ' + inr(cutM) : '') + '</div>' + cards
        : empty('No staff added yet.', '<a class="btn" href="#/staffedit/new">Add staff</a>')) +
      (old.length ? '<h2>Not working here now</h2>' + old.map(function (st) { return '<a class="card navrow" href="#/staffp/' + st.id + '"><b>' + esc(st.name) + '</b> <small>' + esc(st.role) + '</small></a>'; }).join('') : '') +
      '<p class="small">Paid leave is used first, in date order. Once it is used up for the year (April–March) or month, every further leave day is counted as unpaid.</p>';
    return { title: 'Staff & leave', tab: 'more', back: '#/more', html: html };
  };

  /* ---------- Add / edit staff ---------- */
  routes.staffedit = function (id) {
    var isNew = !id || id === 'new', raw = isNew ? { paidLeave: '', leavePeriod: 'year', active: true } : S().staff.filter(function (x) { return x.id === id; })[0];
    if (!raw) return { title: 'Not found', back: '#/staff', html: empty('Staff member not found.') };
    var st = isNew ? raw : L.cleanStaff(raw), hasLeave = !isNew && leaves().some(function (l) { return l.staffId === id; });
    var html = '<form id="sf" class="card" novalidate><h3>' + (isNew ? 'Add staff' : 'Edit ' + esc(st.name)) + '</h3>' +
      field('Name', '<input name="name" value="' + esc(st.name || '') + '" autocomplete="off">') +
      '<div class="two">' + field('Work', '<input name="role" value="' + esc(st.role || '') + '" placeholder="e.g. Housekeeping, Cook">') +
      field('Mobile', '<input name="phone" type="tel" inputmode="tel" value="' + esc(st.phone || '') + '">') + '</div>' +
      '<div class="two">' + field('Paid leave days', '<input name="paidLeave" type="number" inputmode="decimal" min="0" step="0.5" value="' + esc(st.paidLeave === '' ? '' : st.paidLeave) + '">', '', 'Half days allowed, e.g. 1.5') +
      field('Per', '<select name="leavePeriod">' + options([{ id: 'year', name: 'Year (April–March)' }, { id: 'month', name: 'Month (no carry forward)' }], st.leavePeriod) + '</select>') + '</div>' +
      '<div class="two">' + field('Monthly salary ₹ (optional)', '<input name="salary" type="number" inputmode="decimal" min="0" step="any" value="' + esc(st.salary || '') + '">', '', 'Used to work out the cut for unpaid days') +
      field('Joined on (optional)', '<input name="joinDate" type="date" value="' + esc(st.joinDate || '') + '">') + '</div>' +
      field('Note', '<input name="note" value="' + esc(st.note || '') + '">') +
      (isNew ? '' : '<label class="chk"><input type="checkbox" name="active"' + (st.active ? ' checked' : '') + '> Working here now</label>') +
      '<div id="serr"></div><button class="btn primary" type="submit">Save</button>' +
      (isNew ? '' : hasLeave ? '' : ' <button class="btn danger" type="button" id="sdel">Remove</button>') + '</form>' +
      (!isNew && hasLeave ? '<p class="small">This person has leave entries, so they cannot be removed. Untick “Working here now” instead — their history is kept.</p>' : '') +
      (!isNew ? '<p class="small">Changing paid leave days or the period recalculates every balance, including past months.</p>' : '');
    return {
      title: isNew ? 'Add staff' : 'Edit staff', tab: 'more', back: isNew ? '#/staff' : '#/staffp/' + id, html: html, after: function () {
        $('#sf').onsubmit = function (ev) {
          ev.preventDefault();
          var f = this.elements, x = { name: f.name.value, role: f.role.value, phone: f.phone.value, paidLeave: f.paidLeave.value, leavePeriod: f.leavePeriod.value, salary: f.salary.value, joinDate: f.joinDate.value, note: f.note.value, active: isNew ? true : f.active.checked };
          var e = L.validateStaff(x);
          if (!e.joinDate && x.joinDate && !isNew) {
            var early = leaves().filter(function (l) { return l.staffId === id && !l.cancelled && l.from < x.joinDate; })[0];
            if (early) e.joinDate = 'There is leave on ' + early.from + ', before this date.';
          }
          if (Object.keys(e).length) { $('#serr').innerHTML = '<div class="warn">' + Object.keys(e).map(function (k) { return esc(e[k]); }).join('<br>') + '</div>'; return; }
          x.paidLeave = Number(x.paidLeave); x.salary = Number(x.salary) || 0;
          var s = S(), now = H.nowISO();
          if (isNew) { x.id = H.uid(); x.createdAt = now; s.staff.push(L.cleanStaff(x)); s.staff[s.staff.length - 1].createdAt = now; }
          else { var i = s.staff.indexOf(raw), c = L.cleanStaff(Object.assign({}, x, { id: id })); c.createdAt = raw.createdAt || now; c.updatedAt = now; s.staff[i] = c; }
          H.save().then(function () { H.toast('Saved'); H.go('#/staffp/' + (isNew ? x.id : id)); });
        };
        var del = $('#sdel'); if (del) del.onclick = function () {
          if (!confirm('Remove ' + st.name + '?')) return;
          var s = S(); s.staff = s.staff.filter(function (x) { return x.id !== id; });
          H.save().then(function () { H.toast('Removed'); H.go('#/staff'); });
        };
      }
    };
  };

  /* ---------- One staff member: balance, month summary, leave list ---------- */
  routes.staffp = function (id) {
    var st = staffById(id); if (!st) return { title: 'Not found', back: '#/staff', html: empty('Staff member not found.') };
    var t = H.today(), ym = pageMonth[id] || t.slice(0, 7), per = L.periodOf(st, ym + '-01'), b = L.balance(st, leaves(), per), m = L.monthSummary(st, leaves(), ym);
    var fy = L.fyOf(ym + '-01'), split = L.leaveSplit(st, leaves());
    var mine = leaves().filter(function (l) { return l.staffId === id; }).filter(function (l) { return L.fyOf(l.from) === fy || L.fyOf(l.half ? l.from : l.to) === fy; })
      .sort(function (a, c) { return a.from < c.from ? 1 : -1; });
    var rows = L.fyMonths(fy).map(function (mm) { var x = L.monthSummary(st, leaves(), mm); return x.taken ? '<tr><td>' + H.fmtMonth(mm) + '</td><td>' + D(x.paid) + '</td><td>' + D(x.unpaid) + '</td><td>' + (st.salary ? inr(x.deduction) : '—') + '</td></tr>' : ''; }).join('');
    var html = '<div class="card"><h3>' + esc(st.name) + '</h3><p class="small">' + esc(st.role || 'Staff') + (st.phone ? ' · ' + esc(st.phone) : '') + (st.joinDate ? ' · joined ' + H.fmtDate(st.joinDate) : '') + (st.active ? '' : ' · <b>not working here now</b>') +
      '<br>' + D(st.paidLeave) + ' paid leave per ' + (st.leavePeriod === 'month' ? 'month' : 'year (April–March)') + (st.salary ? ' · salary ' + inr(st.salary) + '/month' : '') + '</p>' +
      '<div class="actions">' + (st.active ? '<a class="btn primary" href="#/leave/' + id + '">+ Add leave</a>' : '') + '<a class="btn" href="#/staffedit/' + id + '">Edit</a></div></div>' +
      '<label class="fld"><span>Month</span><input type="month" id="spm" value="' + ym + '"></label>' +
      '<div class="tiles">' + tile('Paid leave left', D(b.paidLeft), 'of ' + D(b.allowance) + ' · ' + periodName(st, per)) + tile('Paid used', D(b.paidUsed), periodName(st, per)) +
      tile('Unpaid · ' + H.fmtMonth(ym), D(m.unpaid), st.salary ? 'Salary cut ' + inr(m.deduction) : 'Add salary to see the cut', m.unpaid ? 'bad' : '') + '</div>' +
      (rows ? '<div class="card"><h3>Month by month · FY ' + fy + '</h3><table class="tbl"><tr><th>Month</th><th>Paid</th><th>Unpaid</th><th>Cut</th></tr>' + rows + '</table>' +
        (st.salary ? '<p class="small">Cut = monthly salary ÷ days in that month × unpaid days, rounded to the rupee.</p>' : '') + '</div>' : '') +
      '<h2>Leave in FY ' + fy + '</h2>' + (mine.length ? mine.map(function (l) {
        var sp = split[l.id] || { paid: 0, unpaid: 0 };
        return '<div class="card lvrow"><div class="' + (l.cancelled ? 'lvx' : '') + '"><b>' + rangeText(l) + '</b>' + (l.reason ? '<br><small>' + esc(l.reason) + '</small>' : '') + '<br>' +
          (l.cancelled ? '<small>Cancelled' + (l.cancelReason ? ': ' + esc(l.cancelReason) : '') + '</small>' :
            (sp.paid ? '<span class="lvtag lv-p">Paid ' + D(sp.paid) + '</span>' : '') + (sp.unpaid ? '<span class="lvtag lv-u">Unpaid ' + D(sp.unpaid) + '</span>' : '') + (l.kind === 'unpaid' ? '<small> marked unpaid</small>' : '')) +
          '</div>' + (l.cancelled ? '' : '<a class="btn sm" href="#/leave/' + id + '/' + l.id + '">Edit</a>') + '</div>';
      }).join('') : empty('No leave in this financial year.'));
    return {
      title: 'Staff leave', tab: 'more', back: '#/staff', html: html, after: function () {
        $('#spm').onchange = function () { if (this.value) { pageMonth[id] = this.value; H.render(); } };
      }
    };
  };

  /* ---------- Add / edit one leave ---------- */
  routes.leave = function (arg) {
    var p = String(arg || '').split('/'), st = staffById(p[0]); if (!st) return { title: 'Not found', back: '#/staff', html: empty('Staff member not found.') };
    var old = p[1] ? leaves().filter(function (l) { return l.id === p[1] && l.staffId === st.id; })[0] : null;
    if (p[1] && (!old || old.cancelled)) return { title: 'Not found', back: '#/staffp/' + st.id, html: empty('Leave entry not found.') };
    var l = old || { from: H.today(), to: H.today(), half: false, kind: 'auto', reason: '' };
    var html = '<form id="lf" class="card" novalidate><h3>' + (old ? 'Edit leave' : 'Add leave') + ' · ' + esc(st.name) + '</h3>' +
      '<div class="chips"><label class="chk sm"><input type="radio" name="len" value="full"' + (l.half ? '' : ' checked') + '> Full day(s)</label> <label class="chk sm"><input type="radio" name="len" value="half"' + (l.half ? ' checked' : '') + '> Half day</label></div>' +
      '<div class="two">' + field('From', '<input name="from" type="date" value="' + esc(l.from) + '">') + '<div id="towrap">' + field('To (last day of leave)', '<input name="to" type="date" value="' + esc(l.half ? l.from : l.to) + '">') + '</div></div>' +
      field('Count as', '<select name="kind">' + options([{ id: 'auto', name: 'Paid leave (unpaid once used up)' }, { id: 'unpaid', name: 'Unpaid leave' }], l.kind === 'unpaid' ? 'unpaid' : 'auto') + '</select>') +
      field('Reason (optional)', '<input name="reason" value="' + esc(l.reason || '') + '" placeholder="e.g. family function, sick">') +
      '<div id="lprev"></div><div id="lerr"></div><button class="btn primary" type="submit">Save leave</button>' +
      (old ? ' <button class="btn danger" type="button" id="lcan">Cancel this leave</button>' : '') + '</form>';
    return {
      title: old ? 'Edit leave' : 'Add leave', tab: 'more', back: '#/staffp/' + st.id, html: html, after: function () {
        var f = $('#lf'), E = f.elements;
        function draft() {
          var half = E.len.value === 'half';
          return { id: old ? old.id : '__draft', staffId: st.id, from: E.from.value, to: half ? E.from.value : E.to.value, half: half, kind: E.kind.value, reason: E.reason.value.trim() };
        }
        function preview() {
          var d = draft(); $('#towrap').style.display = d.half ? 'none' : '';
          if (E.to.value < E.from.value && L.isDate(E.from.value)) E.to.value = E.from.value;
          d = draft();
          var e = L.validateLeave(d, st, leaves());
          if (Object.keys(e).length) { $('#lprev').innerHTML = '<div class="warn">' + Object.keys(e).map(function (k) { return esc(e[k]); }).join('<br>') + '</div>'; return e; }
          var others = leaves().filter(function (x) { return x.id !== d.id; }).concat([d]), sp = L.leaveSplit(st, others)[d.id] || { paid: 0, unpaid: 0 };
          var b = L.balance(st, others, L.periodOf(st, d.from));
          $('#lprev').innerHTML = '<div class="' + (sp.unpaid ? 'warn' : 'ok') + '">' + D(sp.paid + sp.unpaid) + ': <b>' + D(sp.paid) + ' paid</b>, <b>' + D(sp.unpaid) + ' unpaid</b>.' +
            ' Paid leave left after this: ' + D(b.paidLeft) + ' (' + periodName(st, b.period) + ').' +
            (st.salary && sp.unpaid ? ' Salary cut about ' + inr(L.allocate(st, others).filter(function (x) { return x.leaveId === d.id; }).reduce(function (a, x) { return a + x.unpaid * st.salary / L.daysInMonth(x.date.slice(0, 7)); }, 0)) + '.' : '') + '</div>';
          return e;
        }
        $$('#lf input, #lf select').forEach(function (el) { el.addEventListener('change', preview); el.addEventListener('input', preview); });
        preview();
        f.onsubmit = function (ev) {
          ev.preventDefault();
          $('#lerr').innerHTML = '';
          var e = preview(); if (Object.keys(e).length) return;
          var d = draft(), s = S(), now = H.nowISO();
          if (old) {
            var later = leaves().some(function (x) { return x.staffId === st.id && !x.cancelled && x.id !== old.id && x.from > (old.from < d.from ? old.from : d.from); });
            Object.assign(old, { from: d.from, to: d.to, half: d.half, kind: d.kind, reason: d.reason, updatedAt: now });
            (old.history = old.history || []).push({ at: now, action: 'edited' });
            H.save().then(function () { H.toast(later ? 'Saved. Later leave was recounted.' : 'Leave saved'); H.go('#/staffp/' + st.id); });
          } else {
            d.id = H.uid(); d.createdAt = now; d.updatedAt = now; s.staffLeaves.push(d);
            pageMonth[st.id] = d.from.slice(0, 7);
            H.save().then(function () { H.toast('Leave added'); H.go('#/staffp/' + st.id); });
          }
        };
        var c = $('#lcan'); if (c) c.onclick = function () {
          var why = prompt('Cancel this leave? It stays in the list, crossed out. Reason (optional):'); if (why === null) return;
          var now = H.nowISO(); old.cancelled = true; old.cancelledAt = now; old.cancelReason = why.trim(); old.updatedAt = now;
          (old.history = old.history || []).push({ at: now, action: 'cancelled' });
          H.save().then(function () { H.toast('Leave cancelled'); H.go('#/staffp/' + st.id); });
        };
      }
    };
  };

  /* ---------- Month leave calendar ---------- */
  routes.staffcal = function () {
    calMonth = calMonth || H.today().slice(0, 7);
    var t = H.today(), dim = L.daysInMonth(calMonth), act = staffList().filter(function (x) { return x.active || leaves().some(function (l) { return l.staffId === x.id && !l.cancelled && l.from.slice(0, 7) <= calMonth && (l.half ? l.from : l.to).slice(0, 7) >= calMonth; }); });
    var head = '<tr><th class="rn">Staff</th>';
    for (var d = 1; d <= dim; d++) { var ds = calMonth + '-' + String(d).padStart(2, '0'); head += '<th class="' + (ds === t ? 'tday' : '') + '">' + d + '</th>'; }
    head += '<th>Unpaid</th></tr>';
    var body = act.map(function (st) {
      var days = {}; L.allocate(st, leaves()).forEach(function (x) { if (x.date.slice(0, 7) === calMonth) { var y = days[x.date] = days[x.date] || { u: 0, p: 0, n: 0 }; y.u += x.unpaid; y.p += x.paid; y.n += x.units; } });
      var cells = '<td class="rn"><a href="#/staffp/' + st.id + '">' + esc(st.name.split(' ')[0].slice(0, 10)) + '</a></td>', un = 0;
      for (var d = 1; d <= dim; d++) {
        var ds = calMonth + '-' + String(d).padStart(2, '0'), x = days[ds];
        if (!x) { cells += '<td class="free"></td>'; continue; }
        un += x.u;
        var cls = x.u ? 'lv-u' : x.n < 1 ? 'lv-h' : 'lv-p';
        cells += '<td class="' + cls + '" title="' + esc(st.name + ' · ' + (x.u ? 'unpaid' : 'paid') + (x.n < 1 ? ' half day' : '')) + '">' + (x.n < 1 ? '½' : x.u ? 'U' : 'P') + '</td>';
      }
      return '<tr>' + cells + '<td><b>' + (un ? D(un).replace(/ days?$/, '') : '') + '</b></td></tr>';
    }).join('');
    var html = '<div class="monthbar"><button class="btn sm" id="lpm">‹</button><b>' + H.fmtMonth(calMonth) + '</b><button class="btn sm" id="lnm">›</button></div>' +
      (act.length ? '<div class="calwrap"><table class="cal">' + head + body + '</table></div>' : empty('No staff added yet.', '<a class="btn" href="#/staffedit/new">Add staff</a>')) +
      '<p class="small legend"><span class="lg lv-p"></span>Paid leave <span class="lg lv-h"></span>Half day (paid) <span class="lg lv-u"></span>Unpaid · Tap a name to add leave.</p>';
    return {
      title: 'Leave calendar', tab: 'more', back: '#/staff', html: html, after: function () {
        $('#lpm').onclick = function () { var p = calMonth.split('-').map(Number), x = new Date(Date.UTC(p[0], p[1] - 2, 1)); calMonth = x.toISOString().slice(0, 7); H.render(); };
        $('#lnm').onclick = function () { var p = calMonth.split('-').map(Number), x = new Date(Date.UTC(p[0], p[1], 1)); calMonth = x.toISOString().slice(0, 7); H.render(); };
        var tc = document.querySelector('.cal .tday'); if (tc) tc.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
    };
  };
})();
