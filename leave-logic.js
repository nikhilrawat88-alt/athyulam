/* Athulyam Homes Guest Manager — staff leave rules (no screen code here).
   Each staff member gets a number of paid leave days per financial year (April–March) or per calendar month.
   Leave days are counted in date order: they use paid leave until it runs out, every day after that is unpaid.
   A leave can also be marked "unpaid" on purpose; it then never uses paid leave.
   Half day = 0.5 day. Monthly allowance does not carry forward. */
(function (root) {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    var d = new Date(s + 'T00:00:00Z');
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function daysInMonth(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }

  /* Financial year label for a date: 2026-11-25 → '2026-27'; 2027-02-10 → '2026-27'. */
  function fyOf(date) { var y = +date.slice(0, 4), m = +date.slice(5, 7), s = m >= 4 ? y : y - 1; return s + '-' + pad((s + 1) % 100); }
  function fyRange(fy) { var s = +fy.slice(0, 4); return { from: s + '-04-01', to: (s + 1) + '-03-31' }; }
  function fyMonths(fy) { var s = +fy.slice(0, 4), out = []; for (var i = 0; i < 12; i++) { var m = 4 + i, y = s + (m > 12 ? 1 : 0); out.push(y + '-' + pad(m > 12 ? m - 12 : m)); } return out; }
  function periodOf(staff, date) { return staff.leavePeriod === 'month' ? date.slice(0, 7) : fyOf(date); }

  var MAX_DAYS = 120;

  function cleanStaff(x) {
    return {
      id: x.id, name: String(x.name || '').trim(), role: String(x.role || '').trim(), phone: String(x.phone || '').trim(),
      joinDate: isDate(x.joinDate) ? x.joinDate : '', active: x.active !== false,
      paidLeave: r2(x.paidLeave), leavePeriod: x.leavePeriod === 'month' ? 'month' : 'year',
      salary: r2(x.salary), note: String(x.note || '').trim()
    };
  }
  function validateStaff(x) {
    var e = {};
    if (!String(x.name || '').trim()) e.name = 'Enter the name.';
    var pl = Number(x.paidLeave);
    if (x.paidLeave === '' || x.paidLeave == null || isNaN(pl) || pl < 0) e.paidLeave = 'Enter 0 or more days.';
    else if (pl * 2 !== Math.round(pl * 2)) e.paidLeave = 'Use whole or half days (e.g. 12 or 1.5).';
    else if (pl > (x.leavePeriod === 'month' ? 31 : 366)) e.paidLeave = 'Too many days for the period.';
    if (x.salary !== '' && x.salary != null && (isNaN(Number(x.salary)) || Number(x.salary) < 0)) e.salary = 'Enter 0 or more.';
    if (x.joinDate && !isDate(x.joinDate)) e.joinDate = 'Enter a valid date.';
    return e;
  }

  /* Days a leave covers: [{date, units}]. */
  function leaveDays(l) {
    if (!isDate(l.from) || !isDate(l.to) || l.to < l.from) return [];
    if (l.half) return [{ date: l.from, units: 0.5 }];
    var out = [], n = daysBetween(l.from, l.to);
    for (var i = 0; i <= n; i++) out.push({ date: addDays(l.from, i), units: 1 });
    return out;
  }
  function liveLeaves(leaves, staffId) {
    return (leaves || []).filter(function (l) { return l && l.staffId === staffId && !l.cancelled; });
  }

  /* Checks a new or edited leave against the rules and the staff member's other leaves. */
  function validateLeave(l, staff, leaves) {
    var e = {};
    if (!staff) { e.staff = 'Choose the staff member.'; return e; }
    if (!isDate(l.from)) e.from = 'Enter the first day.';
    if (!l.half && !isDate(l.to)) e.to = 'Enter the last day.';
    if (e.from || e.to) return e;
    var to = l.half ? l.from : l.to;
    if (to < l.from) { e.to = 'Last day is before the first day.'; return e; }
    if (daysBetween(l.from, to) + 1 > MAX_DAYS) { e.to = 'One entry can be at most ' + MAX_DAYS + ' days. Add longer leave as two entries.'; return e; }
    if (staff.joinDate && l.from < staff.joinDate) { e.from = 'Before ' + staff.name + ' joined (' + staff.joinDate + ').'; return e; }
    var mine = {}; leaveDays({ from: l.from, to: to, half: l.half }).forEach(function (d) { mine[d.date] = d.units; });
    var clash = liveLeaves(leaves, staff.id).filter(function (o) { return o.id !== l.id; }).filter(function (o) {
      return leaveDays(o).some(function (d) { return mine[d.date] !== undefined && (d.units + mine[d.date] > 1); });
    })[0];
    if (clash) e.from = 'Overlaps leave already entered (' + clash.from + (clash.to !== clash.from ? ' to ' + clash.to : '') + ').';
    return e;
  }

  /* Every leave day of one staff member, in date order, with how much was paid and unpaid.
     Paid leave is used first, period by period, in date order. */
  function allocate(staff, leaves) {
    var days = [];
    liveLeaves(leaves, staff.id).forEach(function (l) {
      leaveDays(l).forEach(function (d) { days.push({ date: d.date, units: d.units, leaveId: l.id, forceUnpaid: l.kind === 'unpaid', reason: l.reason || '' }); });
    });
    days.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.leaveId < b.leaveId ? -1 : 1); });
    var used = {};
    days.forEach(function (d) {
      var p = periodOf(staff, d.date), left = Math.max(0, r2(staff.paidLeave - (used[p] || 0)));
      var paid = d.forceUnpaid ? 0 : Math.min(left, d.units);
      d.period = p; d.paid = r2(paid); d.unpaid = r2(d.units - paid);
      used[p] = r2((used[p] || 0) + paid);
    });
    return days;
  }

  /* Balance for one period ('2026-27' when yearly, 'YYYY-MM' when monthly). */
  function balance(staff, leaves, period) {
    var days = allocate(staff, leaves).filter(function (d) { return d.period === period; });
    var paid = 0, unpaid = 0;
    days.forEach(function (d) { paid += d.paid; unpaid += d.unpaid; });
    return { period: period, allowance: r2(staff.paidLeave), paidUsed: r2(paid), paidLeft: r2(Math.max(0, staff.paidLeave - paid)), unpaid: r2(unpaid), taken: r2(paid + unpaid) };
  }

  /* One calendar month: leave taken, unpaid days and the salary cut (monthly salary ÷ days in that month × unpaid days). */
  function monthSummary(staff, leaves, ym) {
    var days = allocate(staff, leaves).filter(function (d) { return d.date.slice(0, 7) === ym; });
    var paid = 0, unpaid = 0;
    days.forEach(function (d) { paid += d.paid; unpaid += d.unpaid; });
    var perDay = staff.salary > 0 ? staff.salary / daysInMonth(ym) : 0;
    return { month: ym, paid: r2(paid), unpaid: r2(unpaid), taken: r2(paid + unpaid), perDay: r2(perDay), deduction: Math.round(perDay * unpaid), days: days };
  }

  /* Per-leave split, for the list on the staff page. */
  function leaveSplit(staff, leaves) {
    var m = {};
    allocate(staff, leaves).forEach(function (d) { var x = m[d.leaveId] = m[d.leaveId] || { paid: 0, unpaid: 0 }; x.paid = r2(x.paid + d.paid); x.unpaid = r2(x.unpaid + d.unpaid); });
    return m;
  }

  /* Who is on leave on a date: { staffId: {units, paid, unpaid, leaveId} } */
  function onDate(staffList, leaves, date) {
    var out = {};
    (staffList || []).forEach(function (s) {
      allocate(s, leaves).forEach(function (d) { if (d.date === date) { var x = out[s.id] = out[s.id] || { units: 0, paid: 0, unpaid: 0, leaveId: d.leaveId }; x.units += d.units; x.paid += d.paid; x.unpaid += d.unpaid; } });
    });
    return out;
  }

  function fmtDays(n) {
    n = r2(n); if (n === 0.5) return '½ day'; if (n === 1) return '1 day';
    var w = Math.floor(n), h = n - w >= 0.5 ? '½' : ''; return (w || (h ? '' : '0')) + h + ' days';
  }

  var API = {
    isDate: isDate, addDays: addDays, daysInMonth: daysInMonth, fyOf: fyOf, fyRange: fyRange, fyMonths: fyMonths, periodOf: periodOf,
    cleanStaff: cleanStaff, validateStaff: validateStaff, validateLeave: validateLeave, leaveDays: leaveDays,
    allocate: allocate, balance: balance, monthSummary: monthSummary, leaveSplit: leaveSplit, onDate: onDate, fmtDays: fmtDays, MAX_DAYS: MAX_DAYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.AHLeave = API;
})(this);
