/* Athulyam Homes Guest Manager — calculation engine.
   Shared by the phone app and the Google Sheets script, so both always agree.
   All money is in rupees, rounded to paise. All dates are "YYYY-MM-DD" strings. */
var AH = (function () {
  'use strict';

  var ACTIVE = ['Confirmed', 'Checked In', 'Checked Out'];
  var STATUSES = ['Confirmed', 'Checked In', 'Checked Out', 'Cancelled'];
  var QUERY_STATUSES = ['Open', 'Answered', 'Closed'];
  var QUERY_OUTCOMES = ['Booked', 'Not booked'];
  var METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Online Platform', 'Not recorded'];
  var SOURCES = ['Direct Booking', 'Booking.com', 'Airbnb', 'MakeMyTrip', 'Goibibo', 'Agoda', 'Google', 'Travel Agent', 'Other'];
  var EXPENSE_CATS = ['Groceries', 'Staff salary', 'Electricity', 'Gas / fuel', 'Water', 'Laundry', 'Repairs & maintenance', 'Internet & phone', 'Supplies', 'Other'];

  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }
  function r2(x) { return Math.round(num(x) * 100) / 100; }
  function parseD(s) { var p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function fmtD(t) { return new Date(t).toISOString().slice(0, 10); }
  function addDays(s, n) { return fmtD(parseD(s) + n * 864e5); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(parseD(s)); }
  function nights(ci, co) { if (!isDate(ci) || !isDate(co)) return 0; return Math.round((parseD(co) - parseD(ci)) / 864e5); }
  function monthOf(d) { return String(d).slice(0, 7); }
  function daysInMonth(ym) { var p = ym.split('-').map(Number); return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); }
  function monthStart(ym) { return ym + '-01'; }
  function monthEnd(ym) { return ym + '-' + String(daysInMonth(ym)).padStart(2, '0'); }
  function prevMonth(ym) { var p = ym.split('-').map(Number); var d = new Date(Date.UTC(p[0], p[1] - 2, 1)); return d.toISOString().slice(0, 7); }
  function isActive(b) { return ACTIVE.indexOf(b.status) >= 0; }
  function isCancelled(b) { return b.status === 'Cancelled'; }
  function sum(arr, f) { return r2(arr.reduce(function (a, x) { return a + num(f ? f(x) : x); }, 0)); }

  /* Room GST rate from the per-night room value after discount (GST rule: ≤ ₹7,500 per unit per day → low rate). */
  /* Manual discount first, then the coupon on what is left. Both come off before GST. */
  function discounts(b) {
    var sub = r2(num(b.room) + num(b.food) + num(b.additional));
    var disc = Math.min(r2(b.discount), sub), left = r2(sub - disc), coupon = 0;
    if (b.couponType === 'pct') coupon = r2(left * Math.min(Math.max(num(b.couponValue), 0), 100) / 100);
    else if (b.couponType === 'amt') coupon = r2(Math.max(num(b.couponValue), 0));
    coupon = Math.min(coupon, left);
    return { sub: sub, disc: disc, coupon: coupon, total: r2(disc + coupon) };
  }
  function couponLabel(b) {
    if (!b || !b.couponType) return '';
    return (b.couponCode ? b.couponCode + ' ' : '') + '(' + (b.couponType === 'pct' ? num(b.couponValue) + '%' : '₹' + num(b.couponValue)) + ')';
  }

  /* ---------- Rooms on a booking (one or many) ---------- */
  function roomsOf(b) {
    if (b && b.rooms && b.rooms.length) return b.rooms;
    return b && b.roomId ? [{ roomId: b.roomId, charge: num(b.room) }] : [];
  }
  function roomIds(b) { return roomsOf(b).map(function (r) { return r.roomId; }); }
  function roomTotal(b) { return r2(sum(roomsOf(b), function (r) { return r.charge; })); }
  /* Per-room GST rate from that room's charge per night after its share of discounts (₹7,500 rule is per unit per day). */
  function autoRoomRates(b, settings) {
    var n = nights(b.checkIn, b.checkOut) || 1, rs = roomsOf(b), total = roomTotal(b);
    var dd = discounts(Object.assign({}, b, { room: total })), share = dd.sub ? dd.total / dd.sub : 0, out = {};
    rs.forEach(function (r) {
      var perNight = num(r.charge) * (1 - share) / n;
      out[r.roomId] = perNight > num(settings.gstThreshold || 7500) ? num(settings.gstRoomHigh) : num(settings.gstRoomLow);
    });
    return out;
  }

  function autoRoomGstRate(b, settings) {
    var rates = autoRoomRates(b, settings), ks = Object.keys(rates);
    if (ks.length) return Math.max.apply(null, ks.map(function (k) { return rates[k]; }));
    var n = nights(b.checkIn, b.checkOut) || 1;
    var room = num(b.room), dd = discounts(b), sub = dd.sub, disc = dd.total;
    var roomAfter = sub ? room - room * (disc / sub) : room;
    var perNight = roomAfter / n;
    return perNight > num(settings.gstThreshold || 7500) ? num(settings.gstRoomHigh) : num(settings.gstRoomLow);
  }

  function paymentsFor(b, payments) { return (payments || []).filter(function (p) { return p.bookingId === b.id; }); }

  /* The single source of truth for one booking's money. */
  function calc(b, payments) {
    if (b && b.charges) b = applyCharges(Object.assign({}, b));
    var pays = paymentsFor(b, payments);
    var paid = sum(pays.filter(function (p) { return p.type !== 'refund'; }), function (p) { return p.amount; });
    var refunded = sum(pays.filter(function (p) { return p.type === 'refund'; }), function (p) { return p.amount; });
    var received = r2(paid - refunded);
    var n = nights(b.checkIn, b.checkOut);
    var c = { nights: n, paid: paid, refunded: refunded, received: received };

    if (isCancelled(b)) {
      var fee = r2(b.cancelFee);
      c.room = 0; c.food = 0; c.additional = 0; c.discount = 0; c.coupon = 0; c.couponLabel = ''; c.cancelFee = fee; c.roomParts = [];
      c.subtotal = fee; c.taxable = fee;
      c.gstRoom = 0; c.gstFood = 0; c.gstOther = 0; c.gst = 0;
      c.total = fee;
      c.commission = r2(b.cancelCommission);
    } else {
      var rs = roomsOf(b), room = rs.length && b.rooms && b.rooms.length ? roomTotal(b) : r2(b.room), food = r2(b.food), add = r2(b.additional);
      var dd = discounts(Object.assign({}, b, { room: room })), sub = dd.sub, disc = dd.total;
      var share = sub ? disc / sub : 0;
      var roomT = r2(room - room * share), foodT = r2(food - food * share);
      var addT = r2(sub - disc - roomT - foodT);
      var on = !!b.gstOn;
      c.room = room; c.food = food; c.additional = add; c.discount = dd.disc; c.coupon = dd.coupon; c.couponLabel = couponLabel(b); c.cancelFee = 0;
      c.subtotal = sub; c.taxable = r2(sub - disc);
      /* GST on rooms, room by room (a room above the ₹7,500 limit can be 18% while others are 5%). */
      var parts = [], left = roomT;
      rs.forEach(function (r, i) {
        var t = i === rs.length - 1 ? r2(left) : (room ? r2(roomT * num(r.charge) / room) : r2(roomT / rs.length));
        left = r2(left - t);
        var rate = (!b.gstRateManual && r.gstRate !== undefined && r.gstRate !== '' && r.gstRate !== null) ? num(r.gstRate) : num(b.gstRoomRate);
        parts.push({ roomId: r.roomId, charge: num(r.charge), taxable: t, rate: rate, gst: on ? r2(t * rate / 100) : 0 });
      });
      if (!rs.length) parts.push({ roomId: '', charge: room, taxable: roomT, rate: num(b.gstRoomRate), gst: on ? r2(roomT * num(b.gstRoomRate) / 100) : 0 });
      c.roomParts = parts;
      c.gstRoom = on ? r2(sum(parts, function (p) { return p.gst; })) : 0;
      c.gstFood = on ? r2(foodT * num(b.gstFoodRate) / 100) : 0;
      c.gstOther = on ? r2(addT * num(b.gstOtherRate) / 100) : 0;
      c.roomTaxable = roomT; c.foodTaxable = foodT; c.otherTaxable = addT;
      c.gst = r2(c.gstRoom + c.gstFood + c.gstOther);
      c.total = r2(c.taxable + c.gst);
      c.commission = r2(b.commission);
    }
    c.net = r2(c.taxable - c.commission);           // revenue after commission, GST excluded (GST is not your income)
    c.outstanding = r2(c.total - received);          // negative = refund due to guest
    c.countsAsRevenue = isActive(b) || (isCancelled(b) && c.total > 0);
    return c;
  }

  /* Split a booking's amounts across its nights (accrual), last night takes rounding remainder.
     Cancellation fees land on the cancellation date. Enquiries never count. */
  function lines(b, payments) {
    var c = calc(b, payments);
    if (!c.countsAsRevenue) return [];
    var keys = ['room', 'food', 'additional', 'discount', 'coupon', 'gst', 'commission', 'cancelFee'];
    if (isCancelled(b)) {
      var d = b.cancelledOn || String(b.updatedAt || b.checkIn).slice(0, 10);
      var one = { date: d, nights: 0, bookingId: b.id, source: b.source, roomId: roomIds(b)[0] || '' };
      keys.forEach(function (k) { one[k] = num(c[k]); });
      return [finishLine(one)];
    }
    var n = Math.max(c.nights, 1), out = [], rs = roomsOf(b);
    if (!rs.length) rs = [{ roomId: '', charge: 1 }];
    var wsum = sum(rs, function (r) { return r.charge; });
    var weights = rs.map(function (r) { return wsum ? num(r.charge) / wsum : 1 / rs.length; });
    for (var i = 0; i < n; i++) {
      var night = {};
      keys.forEach(function (k) {
        var each = r2(num(c[k]) / n);
        night[k] = i === n - 1 ? r2(num(c[k]) - each * (n - 1)) : each;
      });
      var given = {};
      rs.forEach(function (r, j) {
        var ln = { date: addDays(b.checkIn, i), nights: c.nights ? 1 : 0, bookingId: b.id, source: b.source, roomId: r.roomId };
        keys.forEach(function (k) {
          given[k] = given[k] || 0;
          ln[k] = j === rs.length - 1 ? r2(night[k] - given[k]) : r2(night[k] * weights[j]);
          given[k] = r2(given[k] + ln[k]);
        });
        out.push(finishLine(ln));
      });
    }
    return out;
  }
  function finishLine(l) {
    l.taxable = r2(l.room + l.food + l.additional + l.cancelFee - l.discount - l.coupon);
    l.billed = r2(l.taxable + l.gst);
    l.net = r2(l.taxable - l.commission);
    return l;
  }

  function totals(ls) {
    var t = {};
    ['room', 'food', 'additional', 'discount', 'coupon', 'cancelFee', 'gst', 'commission', 'taxable', 'billed', 'net', 'nights'].forEach(function (k) { t[k] = sum(ls, function (l) { return l[k]; }); });
    return t;
  }
  function allLines(data) {
    var out = [];
    (data.bookings || []).forEach(function (b) { out = out.concat(lines(b, data.payments)); });
    return out;
  }
  function inRange(d, from, to) { return d >= from && d <= to; }
  function group(ls, key) {
    var g = {};
    ls.forEach(function (l) { (g[l[key]] = g[l[key]] || []).push(l); });
    var res = {};
    Object.keys(g).forEach(function (k) { res[k] = totals(g[k]); });
    return res;
  }

  function collections(data, from, to) {
    var ps = (data.payments || []).filter(function (p) { return inRange(p.date, from, to); });
    var byMethod = {};
    METHODS.forEach(function (m) { byMethod[m] = 0; });
    ps.forEach(function (p) {
      var v = p.type === 'refund' ? -num(p.amount) : num(p.amount);
      byMethod[p.method] = r2(num(byMethod[p.method]) + v);
    });
    var received = sum(ps.filter(function (p) { return p.type !== 'refund'; }), function (p) { return p.amount; });
    var refunds = sum(ps.filter(function (p) { return p.type === 'refund'; }), function (p) { return p.amount; });
    return { received: received, refunds: refunds, net: r2(received - refunds), byMethod: byMethod, count: ps.length };
  }

  function outstandingAll(data) {
    var list = [];
    (data.bookings || []).forEach(function (b) {
      if (!(isActive(b) || isCancelled(b))) return;
      var c = calc(b, data.payments);
      if (Math.abs(c.outstanding) >= 0.01) list.push({ b: b, c: c });
    });
    return list;
  }

  function dailyReport(data, date) {
    var bs = data.bookings || [];
    var ls = allLines(data).filter(function (l) { return l.date === date; });
    var t = totals(ls);
    var dues = outstandingAll(data).filter(function (x) { return x.c.outstanding > 0; });
    return {
      date: date,
      checkIns: bs.filter(function (b) { return isActive(b) && b.checkIn === date; }),
      checkOuts: bs.filter(function (b) { return isActive(b) && b.checkOut === date; }),
      inHouse: bs.filter(function (b) { return isActive(b) && b.checkIn <= date && b.checkOut > date; }),
      newBookings: bs.filter(function (b) { return String(b.createdAt || '').slice(0, 10) === date && b.status !== 'Enquiry'; }),
      revenue: t,
      collections: collections(data, date, date),
      outstandingTotal: sum(dues, function (x) { return x.c.outstanding; }),
      expenses: sum((data.expenses || []).filter(function (e) { return e.date === date; }), function (e) { return e.amount; })
    };
  }

  function activeRooms(settings) { return (settings.rooms || []).filter(function (r) { return r.active !== false; }); }

  function monthlyReport(data, ym) {
    var from = monthStart(ym), to = monthEnd(ym);
    var ls = allLines(data).filter(function (l) { return inRange(l.date, from, to); });
    var t = totals(ls);
    var bookingIds = {};
    ls.forEach(function (l) { bookingIds[l.bookingId] = 1; });
    var touched = (data.bookings || []).filter(function (b) { return bookingIds[b.id]; });
    var pending = sum(touched.map(function (b) { return calc(b, data.payments); }).filter(function (c) { return c.outstanding > 0; }), function (c) { return c.outstanding; });
    var exp = (data.expenses || []).filter(function (e) { return inRange(e.date, from, to); });
    var expByCat = {};
    exp.forEach(function (e) { expByCat[e.category] = r2(num(expByCat[e.category]) + num(e.amount)); });
    var expTotal = sum(exp, function (e) { return e.amount; });
    var roomCount = activeRooms(data.settings || {}).length;
    var available = roomCount * daysInMonth(ym);
    return {
      month: ym,
      bookings: (data.bookings || []).filter(function (b) { return isActive(b) && monthOf(b.checkIn) === ym; }).length,
      cancellations: (data.bookings || []).filter(function (b) { return isCancelled(b) && monthOf(b.cancelledOn || b.checkIn) === ym; }).length,
      revenue: t,
      collections: collections(data, from, to),
      pending: pending,
      byPlatform: group(ls, 'source'),
      byRoom: group(ls, 'roomId'),
      occupancyPct: available ? r2(t.nights / available * 100) : 0,
      avgPerNight: t.nights ? r2(t.taxable / t.nights) : 0,
      avgRoomRate: t.nights ? r2(t.room / t.nights) : 0,
      expenses: expTotal, expensesByCategory: expByCat,
      profit: r2(t.net - expTotal)
    };
  }

  /* Platform report: bookings grouped by arrival date in range, full amounts, so a booking is counted once. */
  function platformReport(data, from, to) {
    var res = {};
    (data.bookings || []).forEach(function (b) {
      if (!inRange(b.checkIn, from, to)) return;
      var c = calc(b, data.payments);
      if (!c.countsAsRevenue) return;
      var r = res[b.source] = res[b.source] || { bookings: 0, room: 0, food: 0, other: 0, discount: 0, coupon: 0, taxable: 0, gst: 0, billed: 0, commission: 0, net: 0, collected: 0, outstanding: 0 };
      if (isActive(b)) r.bookings++;
      r.room = r2(r.room + c.room); r.food = r2(r.food + c.food); r.other = r2(r.other + c.additional + c.cancelFee);
      r.discount = r2(r.discount + c.discount); r.coupon = r2(r.coupon + c.coupon); r.taxable = r2(r.taxable + c.taxable); r.gst = r2(r.gst + c.gst);
      r.billed = r2(r.billed + c.total); r.commission = r2(r.commission + c.commission); r.net = r2(r.net + c.net);
      r.collected = r2(r.collected + c.received); r.outstanding = r2(r.outstanding + c.outstanding);
    });
    return res;
  }

  /* GST summary by invoice month = checkout month (cancellation fees: cancellation month). */
  function gstSummary(data, ym) {
    var rows = {};
    function add(kind, rate, taxable, gst) {
      var k = kind + ' @ ' + rate + '%';
      var r = rows[k] = rows[k] || { kind: kind, rate: rate, taxable: 0, gst: 0, invoices: 0 };
      r.taxable = r2(r.taxable + taxable); r.gst = r2(r.gst + gst); r.invoices++;
    }
    (data.bookings || []).forEach(function (b) {
      if (!isActive(b) || monthOf(b.checkOut) !== ym || !b.gstOn) return;
      var c = calc(b, data.payments);
      var byRate = {};
      (c.roomParts || []).forEach(function (p) { if (!p.taxable) return; var x = byRate[p.rate] = byRate[p.rate] || { t: 0, g: 0 }; x.t = r2(x.t + p.taxable); x.g = r2(x.g + p.gst); });
      Object.keys(byRate).forEach(function (rt) { add('Accommodation', num(rt), byRate[rt].t, byRate[rt].g); });
      if (c.foodTaxable) add('Food', num(b.gstFoodRate), c.foodTaxable, c.gstFood);
      if (c.otherTaxable) add('Other charges', num(b.gstOtherRate), c.otherTaxable, c.gstOther);
    });
    var list = Object.keys(rows).map(function (k) { return rows[k]; });
    return { month: ym, rows: list, taxable: sum(list, function (r) { return r.taxable; }), gst: sum(list, function (r) { return r.gst; }) };
  }

  /* OTA payout matching: money the platform collected from the guest minus commission vs what reached you. */
  function payoutReport(data, from, to) {
    var out = [];
    (data.bookings || []).forEach(function (b) {
      if (b.source === 'Direct Booking') return;
      if (!(isActive(b) || isCancelled(b)) || !inRange(b.checkOut, from, to)) return;
      var c = calc(b, data.payments);
      var viaPlatform = sum(paymentsFor(b, data.payments).filter(function (p) { return p.method === 'Online Platform'; }), function (p) { return p.type === 'refund' ? -p.amount : p.amount; });
      if (!viaPlatform && !num(b.payoutReceived)) return;
      var expected = r2(viaPlatform - c.commission);
      var got = r2(b.payoutReceived);
      out.push({ b: b, viaPlatform: viaPlatform, commission: c.commission, expected: expected, received: got, difference: r2(got - expected), matched: Math.abs(got - expected) < 1 && !!b.payoutReceived });
    });
    return out;
  }

  /* Hotel overlap rule: [checkIn, checkOut) ranges. Checkout day may be the next guest's check-in day. */
  function overlaps(bookings, cand) {
    var mine = roomIds(cand);
    if (!mine.length || !isDate(cand.checkIn) || !isDate(cand.checkOut)) return [];
    return (bookings || []).filter(function (b) {
      return b.id !== cand.id && isActive(b) && b.checkIn < cand.checkOut && cand.checkIn < b.checkOut &&
        roomIds(b).some(function (r) { return mine.indexOf(r) >= 0; });
    });
  }

  function futureBookings(data, today) {
    return (data.bookings || []).filter(function (b) {
      return b.checkIn >= today && (b.status === 'Confirmed' || b.status === 'Enquiry');
    }).sort(function (a, b) { return a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0; });
  }

  /* Payment flags: overdue = guest has arrived/left and still owes; noAdvance = confirmed future stay with nothing paid. */
  function paymentFlags(b, c, today) {
    if (isCancelled(b)) return c.outstanding < 0 ? 'refund-due' : (c.outstanding > 0 ? 'fee-due' : '');
    if (!isActive(b)) return '';
    if (c.outstanding > 0 && b.checkIn < today) return 'overdue';
    if (c.outstanding > 0 && b.checkIn === today) return 'due-today';
    if (c.outstanding > 0 && c.received <= 0) return 'no-advance';
    if (c.outstanding > 0) return 'pending';
    if (c.outstanding < 0) return 'overpaid';
    return '';
  }

  /* ---------- Guests on a booking ---------- */
  function guestsOf(b) {
    if (b && b.guests && b.guests.length) return b.guests;
    return b ? [{ id: 'g0', name: b.guestName || '', phone: b.phone || '', nationality: b.nationality || 'Indian', country: b.country || '', idType: b.idType || '', idNumber: b.idValue || '',
      formCArrival: !!b.formCFiled, formCArrivalAt: b.formCFiledAt || '', legacy: true, docs: [] }] : [];
  }
  function foreignGuests(b) { return guestsOf(b).filter(function (g) { return g.nationality === 'Foreign'; }); }
  function isForeignBooking(b) { return foreignGuests(b).length > 0; }
  /* Turn the old single-guest fields into guest 1 (keeps the same values). */
  function migrateGuests(b) {
    if (b.guests && b.guests.length) return false;
    var g = guestsOf(b)[0]; delete g.legacy; g.id = 'g-' + (b.id || '').slice(0, 8);
    g.type = 'Adult'; g.primary = true;
    b.guests = [g];
    return true;
  }
  /* Arrival Form C still to file: checked-in or arrived, foreign guest, not marked filed. */
  function formCPending(data, today) {
    return (data.bookings || []).filter(function (b) {
      return !b.imported && isActive(b) && b.status !== 'Checked Out' && b.checkIn <= today && foreignGuests(b).some(function (g) { return !g.formCArrival; });
    });
  }
  /* Departure entry still to file (within 24 hours of leaving). */
  function formCDeparturePending(data, today) {
    return (data.bookings || []).filter(function (b) {
      return !b.imported && b.status === 'Checked Out' && b.checkOut >= addDays(today, -30) && foreignGuests(b).some(function (g) { return !g.formCDeparture; });
    });
  }
  function guestCountGap(b) { if (b.imported) return 0; return Math.max(0, num(b.adults) + num(b.children) - guestsOf(b).length); }
  function docsMissing(b) { if (b.imported) return 0; return guestsOf(b).filter(function (g) { return g.type !== 'Child' && !(g.docs || []).length; }).length; }

  /* ---------- Booking numbers and Drive folder path ---------- */
  function bookingNo(n, prefix) { return String(prefix || 'ATH').toUpperCase().replace(/[^A-Z0-9]/g, '') + '-' + String(n).padStart(6, '0'); }
  /* Give a number to any booking without one (numbers restart each financial year). The Sheet settles duplicates between devices. */
  function assignBookingNumbers(data) {
    var done = 0;
    (data.bookings || []).filter(function (b) { return !b.no; }).sort(function (a, b) { return String(a.createdAt || a.checkIn) < String(b.createdAt || b.checkIn) ? -1 : 1; })
      .forEach(function (b) { b.no = nextBookingNo(data, b.checkIn, (data.settings || {}).bookingPrefix); done++; });
    return done;
  }
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function financialYear(d) { var y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); var s = m >= 4 ? y : y - 1; return 'FY ' + s + '-' + String((s + 1) % 100).padStart(2, '0'); }
  function cleanName(x) { return String(x || '').replace(/[\\/:*?"<>|#%\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }
  function driveFolderPath(b) {
    var d = isDate(b.checkIn) ? b.checkIn : String(b.createdAt || '').slice(0, 10);
    return [financialYear(d), d.slice(0, 7) + ' ' + MONTH_NAMES[Number(d.slice(5, 7)) - 1], d, cleanName((b.no || 'Booking') + ' ' + (b.guestName || ''))];
  }

  /* Merge incoming backup into existing data by record id; newer updatedAt wins. No duplicates. */
  function merge(existing, incoming) {
    var res = { added: 0, updated: 0, skipped: 0 };
    ['bookings', 'payments', 'expenses', 'queries'].forEach(function (k) {
      var map = {};
      (existing[k] || []).forEach(function (r) { map[r.id] = r; });
      (incoming[k] || []).forEach(function (r) {
        if (!r || !r.id) { res.skipped++; return; }
        var cur = map[r.id];
        if (!cur) { map[r.id] = r; res.added++; }
        else if (String(r.updatedAt || '') > String(cur.updatedAt || '')) { map[r.id] = r; res.updated++; }
        else res.skipped++;
      });
      existing[k] = Object.keys(map).map(function (id) { return map[id]; });
    });
    return res;
  }

  function validateBooking(b, settings) {
    var e = {};
    if (!String(b.guestName || '').trim()) e.guestName = 'Enter the guest name.';
    var digits = String(b.phone || '').replace(/\D/g, '');
    if (!digits && !b.imported) e.phone = 'Enter the mobile number.';
    else if (b.phone && (digits.length < 10 || digits.length > 15)) e.phone = 'Phone number should have 10–15 digits.';
    if (!b.source) e.source = 'Choose the booking source.';
    if (!b.status) e.status = 'Choose the status.';
    if (!b.nationality) e.nationality = 'Choose the nationality.';
    if (b.nationality === 'Foreign' && !String(b.country || '').trim()) e.country = 'Enter the country.';
    if (!b.imported && !String(b.idType || '').trim()) e.idType = 'Choose the ID type.';
    if (!b.imported && !String(b.idValue || '').trim()) e.idValue = 'Enter the ID number' + (b.nationality === 'Foreign' ? ' (passport number).' : '.');
    if (b.status !== 'Cancelled' && roomsOf(b).some(function (r) { return r.charge === '' || r.charge == null || !(Number(r.charge) > 0); })) e.room = 'Enter the charge for every room.';
    (b.charges || []).forEach(function (c, i) { if (!String(c.name || '').trim() || !(Number(c.amount) > 0)) e['charge' + i] = 'Charge line ' + (i + 1) + ': enter what it is for and an amount above ₹0 (or remove the line).'; });
    var cm = validateCustom(b, settings); if (cm.length) e.custom = 'Fill in: ' + cm.join(', ') + '.';
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.email).trim())) e.email = 'Check the email address.';
    var rids = roomIds(b);
    if (!rids.length) e.roomId = 'Choose a room.';
    else if (rids.some(function (r, i) { return !r || rids.indexOf(r) !== i; })) e.roomId = 'Each room can be added only once.';
    if (roomsOf(b).some(function (r) { return isNaN(Number(r.charge)) || Number(r.charge) < 0; })) e.room = 'Room charges must be positive amounts.';
    if (!isDate(b.checkIn)) e.checkIn = 'Choose a check-in date.';
    if (!isDate(b.checkOut)) e.checkOut = 'Choose a check-out date.';
    if (isDate(b.checkIn) && isDate(b.checkOut) && nights(b.checkIn, b.checkOut) < 1) e.checkOut = 'Check-out must be after check-in.';
    if (num(b.adults) < 1) e.adults = 'At least 1 adult.';
    if (num(b.children) < 0) e.children = 'Cannot be negative.';
    ['room', 'food', 'additional', 'discount', 'commission', 'cancelFee', 'cancelCommission'].forEach(function (k) {
      if (b[k] !== '' && b[k] != null && (isNaN(Number(b[k])) || Number(b[k]) < 0)) e[k] = 'Enter a positive amount.';
    });
    if (num(b.discount) > num(b.room) + num(b.food) + num(b.additional)) e.discount = 'Discount is more than the charges.';
    if (b.couponType === 'pct' && (num(b.couponValue) <= 0 || num(b.couponValue) > 100)) e.couponValue = 'Coupon % must be between 1 and 100.';
    if (b.couponType === 'amt' && num(b.couponValue) <= 0) e.couponValue = 'Enter the coupon amount.';
    if (b.couponType === 'amt' && num(b.couponValue) > num(b.room) + num(b.food) + num(b.additional) - num(b.discount)) e.couponValue = 'Coupon is more than the charges after discount.';
    if (settings && settings.idMode !== 'full' && b.idValue && String(b.idValue).replace(/\s/g, '').length > 4) e.idValue = 'Only the last 4 characters are stored (change in Settings if legally required).';
    if (b.status === 'Cancelled' && num(b.cancelCommission) > num(b.cancelFee) && num(b.cancelFee) > 0) e.cancelCommission = 'Commission is more than the cancellation fee.';
    return e;
  }

  /* Rate card: sum nightly rate for each night (season rate if the night falls in a season, else room's base tariff). */
  function rateCardTotal(settings, roomId, ci, co) {
    var room = (settings.rooms || []).filter(function (r) { return r.id === roomId; })[0];
    if (!room) return 0;
    var n = nights(ci, co), total = 0;
    for (var i = 0; i < n; i++) {
      var d = addDays(ci, i), rate = num(room.tariff);
      (settings.seasons || []).forEach(function (s) {
        if (s.from && s.to && d >= s.from && d <= s.to && s.rates && num(s.rates[roomId]) > 0) rate = num(s.rates[roomId]);
      });
      total += rate;
    }
    return r2(total);
  }


  /* ---------- Queries (enquiries) ---------- */
  function queryDate(q) { return String(q.date || q.createdAt || '').slice(0, 10); }
  function queryClosedDate(q) { return String(q.closedAt || q.updatedAt || q.createdAt || '').slice(0, 10); }
  function isConverted(q) { return q.status === 'Closed' && q.outcome === 'Booked'; }

  /* Move old bookings that were saved with status "Enquiry" into the queries list (keeps the same id). */
  function migrateEnquiries(data) {
    data.queries = data.queries || [];
    var moved = 0;
    data.bookings = (data.bookings || []).filter(function (b) {
      if (b.status !== 'Enquiry') return true;
      if (!data.queries.some(function (q) { return q.id === b.id; })) {
        data.queries.push({ id: b.id, date: String(b.createdAt || '').slice(0, 10), createdAt: b.createdAt, updatedAt: b.updatedAt || b.createdAt,
          name: b.guestName, phone: b.phone, email: b.email || '', channel: b.source, checkIn: b.checkIn, checkOut: b.checkOut,
          adults: b.adults, children: b.children, roomId: b.roomId, quote: num(b.room) + num(b.food) + num(b.additional) - num(b.discount),
          message: b.specialRequests || '', notes: b.notes || '', status: 'Open', outcome: '' });
        moved++;
      }
      return false;
    });
    return moved;
  }

  /* Conversion by channel for queries received in [from, to]. */
  function queryConversion(data, from, to) {
    var res = {}, all = { queries: 0, open: 0, answered: 0, booked: 0, notBooked: 0 };
    (data.queries || []).forEach(function (q) {
      var d = queryDate(q);
      if (!(d >= from && d <= to)) return;
      var r = res[q.channel || 'Other'] = res[q.channel || 'Other'] || { queries: 0, open: 0, answered: 0, booked: 0, notBooked: 0 };
      [r, all].forEach(function (x) {
        x.queries++;
        if (q.status === 'Open') x.open++;
        else if (q.status === 'Answered') x.answered++;
        else if (isConverted(q)) x.booked++;
        else x.notBooked++;
      });
    });
    function pct(x) { x.conversionPct = x.queries ? r2(x.booked / x.queries * 100) : 0; }
    Object.keys(res).forEach(function (k) { pct(res[k]); }); pct(all);
    return { byChannel: res, total: all };
  }

  /* One-glance dashboard used by the app home, the Sheet's Dashboard tab and the daily email. */
  function dashboard(data, today) {
    var ym = String(today).slice(0, 7), from = monthStart(ym), to = monthEnd(ym);
    var qs = data.queries || [];
    var queries = {
      open: qs.filter(function (q) { return q.status === 'Open'; }).length,
      answered: qs.filter(function (q) { return q.status === 'Answered'; }).length,
      closedBookedThisMonth: qs.filter(function (q) { return isConverted(q) && monthOf(queryClosedDate(q)) === ym; }).length,
      closedNotBookedThisMonth: qs.filter(function (q) { return q.status === 'Closed' && !isConverted(q) && monthOf(queryClosedDate(q)) === ym; }).length,
      receivedThisMonth: qs.filter(function (q) { return monthOf(queryDate(q)) === ym; }).length
    };
    var conv = queryConversion(data, from, to);
    queries.conversionPctThisMonth = conv.total.conversionPct;
    var bs = data.bookings || [];
    var live = bs.filter(function (b) { return b.status === 'Confirmed' || b.status === 'Checked In'; });
    var pay = { paid: 0, partPaid: 0, unpaid: 0 };
    live.forEach(function (b) {
      var c = calc(b, data.payments);
      if (c.outstanding <= 0.005) pay.paid++; else if (c.received > 0) pay.partPaid++; else pay.unpaid++;
    });
    return {
      today: today, month: ym, queries: queries, conversionByChannel: conv.byChannel,
      bookings: {
        waitingCheckIn: bs.filter(function (b) { return b.status === 'Confirmed'; }).length,
        checkedIn: bs.filter(function (b) { return b.status === 'Checked In'; }).length,
        checkedOutThisMonth: bs.filter(function (b) { return b.status === 'Checked Out' && monthOf(b.checkOut) === ym; }).length,
        cancelledThisMonth: bs.filter(function (b) { return b.status === 'Cancelled' && monthOf(b.cancelledOn || b.checkIn) === ym; }).length,
        fromQueriesThisMonth: bs.filter(function (b) { return b.queryId && monthOf(String(b.createdAt || '').slice(0, 10)) === ym; }).length
      },
      payments: pay
    };
  }

  /* Review links for a booking's channel. Direct bookings get Google only. */
  function reviewLinks(settings, source) {
    var rl = (settings && settings.reviewLinks) || {};
    var out = { google: rl.google || '' };
    if (source && source !== 'Direct Booking' && rl[source]) out.channel = rl[source];
    return out;
  }



  /* ---------- Room availability and coupon opportunities ---------- */
  function freeRooms(data, ci, co, roomId) {
    if (!isDate(ci)) return [];
    if (!isDate(co) || nights(ci, co) < 1) co = addDays(ci, 1);
    var rooms = activeRooms(data.settings || {}).filter(function (r) { return !roomId || r.id === roomId; });
    return rooms.filter(function (r) { return overlaps(data.bookings, { id: '__check__', roomId: r.id, checkIn: ci, checkOut: co }).length === 0; });
  }
  /* Direct queries still not booked on the day before (or the day of) check-in, while a room is free. */
  function couponCandidates(data, today) {
    var tomorrow = addDays(today, 1);
    return (data.queries || []).filter(function (q) {
      return q.channel === 'Direct Booking' && (q.status === 'Open' || q.status === 'Answered') &&
        isDate(q.checkIn) && q.checkIn >= today && q.checkIn <= tomorrow && freeRooms(data, q.checkIn, q.checkOut, q.roomId).length > 0;
    });
  }
  function couponCode(prefix, value, type) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = '';
    for (var i = 0; i < 4; i++) r += chars[Math.floor(Math.random() * chars.length)];
    return String(prefix || 'ATH').toUpperCase().replace(/[^A-Z0-9]/g, '') + (type === 'amt' ? 'R' + Math.round(num(value)) : Math.round(num(value))) + '-' + r;
  }
  function quoteAfterCoupon(q) {
    var base = num(q.quote);
    if (!base || !q.couponType) return base;
    return r2(base - (q.couponType === 'pct' ? base * num(q.couponValue) / 100 : Math.min(num(q.couponValue), base)));
  }

  /* ---------- Analytics: periods, comparison, channel filter ---------- */
  function startOfWeek(d) { var t = new Date(parseD(d)); var wd = (t.getUTCDay() + 6) % 7; return addDays(d, -wd); } // Monday
  function shiftYear(d, n) {
    var y = Number(d.slice(0, 4)) + n, md = d.slice(5);
    if (md === '02-29') md = '02-28';
    return y + '-' + md;
  }
  function periodRange(preset, today, opt) {
    opt = opt || {};
    var ym = today.slice(0, 7), y = Number(today.slice(0, 4));
    switch (preset) {
      case 'lastWeek': { var mon = addDays(startOfWeek(today), -7); return { from: mon, to: addDays(mon, 6), label: 'Last week' }; }
      case 'thisWeek': { var m2 = startOfWeek(today); return { from: m2, to: today, label: 'This week' }; }
      case 'lastMonth': { var pm = prevMonth(ym); return { from: monthStart(pm), to: monthEnd(pm), label: 'Last month' }; }
      case 'thisMonth': return { from: monthStart(ym), to: today, label: 'This month to date' };
      case 'last30': return { from: addDays(today, -29), to: today, label: 'Last 30 days' };
      case 'lastYear': return { from: (y - 1) + '-01-01', to: (y - 1) + '-12-31', label: 'Last year (' + (y - 1) + ')' };
      case 'thisYear': return { from: y + '-01-01', to: today, label: 'This year to date' };
      case 'thisFY': { var fs = (Number(today.slice(5, 7)) >= 4 ? y : y - 1); return { from: fs + '-04-01', to: today, label: 'This financial year (FY ' + fs + '-' + String((fs + 1) % 100).padStart(2, '0') + ') to date' }; }
      case 'lastFY': { var fl = (Number(today.slice(5, 7)) >= 4 ? y : y - 1) - 1; return { from: fl + '-04-01', to: (fl + 1) + '-03-31', label: 'Last financial year (FY ' + fl + '-' + String((fl + 1) % 100).padStart(2, '0') + ')' }; }
      case 'season': {
        var se = ((opt.settings || {}).seasons || []).filter(function (x) { return x.id === opt.seasonId || x.name === opt.seasonId; })[0];
        return se && isDate(se.from) && isDate(se.to) ? { from: se.from, to: se.to, label: 'Season: ' + se.name } : null;
      }
      case 'custom': return isDate(opt.from) && isDate(opt.to) && opt.from <= opt.to ? { from: opt.from, to: opt.to, label: 'Custom' } : null;
    }
    return null;
  }
  function comparisonRange(range, mode, opt) {
    if (!range || mode === 'none') return null;
    if (mode === 'lastYear') return { from: shiftYear(range.from, -1), to: shiftYear(range.to, -1), label: 'Same period last year' };
    if (mode === 'custom') return opt && isDate(opt.from) && isDate(opt.to) && opt.from <= opt.to ? { from: opt.from, to: opt.to, label: 'Custom comparison' } : null;
    if (range.from.slice(5) === '01-01' && range.to.slice(5) === '12-31') { var yrs = Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4)) + 1; return { from: shiftYear(range.from, -yrs), to: shiftYear(range.to, -yrs), label: 'Previous year' + (yrs > 1 ? 's' : '') }; }
    if (range.from.slice(8) === '01' && range.to === monthEnd(range.to.slice(0, 7))) {
      var months = (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 + Number(range.to.slice(5, 7)) - Number(range.from.slice(5, 7)) + 1, fm = range.from.slice(0, 7);
      for (var i = 0; i < months; i++) fm = prevMonth(fm);
      var tm = prevMonth(range.from.slice(0, 7));
      return { from: monthStart(fm), to: monthEnd(tm), label: months === 1 ? 'Previous month' : 'Previous ' + months + ' months' };
    }
    if (range.from.slice(8) === '01' && range.from.slice(0, 7) === range.to.slice(0, 7)) {
      var pm = prevMonth(range.from.slice(0, 7)), day = Math.min(Number(range.to.slice(8)), daysInMonth(pm));
      return { from: monthStart(pm), to: pm + '-' + String(day).padStart(2, '0'), label: 'Same days last month' };
    }
    var len = Math.round((parseD(range.to) - parseD(range.from)) / 864e5) + 1;
    return { from: addDays(range.from, -len), to: addDays(range.from, -1), label: 'Previous ' + len + ' days' };
  }
  function analytics(data, from, to, channels) {
    var all = !channels || !channels.length;
    function ok(src) { return all || channels.indexOf(src || 'Other') >= 0; }
    var ls = allLines(data).filter(function (l) { return l.date >= from && l.date <= to && ok(l.source); });
    var t = totals(ls);
    var bookingIds = {};
    (data.bookings || []).forEach(function (b) { if (ok(b.source)) bookingIds[b.id] = b; });
    var arrivals = (data.bookings || []).filter(function (b) { return ok(b.source) && isActive(b) && b.checkIn >= from && b.checkIn <= to; });
    var cancels = (data.bookings || []).filter(function (b) { return ok(b.source) && isCancelled(b) && (b.cancelledOn || b.checkIn) >= from && (b.cancelledOn || b.checkIn) <= to; });
    var pays = (data.payments || []).filter(function (p) { return p.date >= from && p.date <= to && bookingIds[p.bookingId]; });
    var collected = r2(sum(pays.filter(function (p) { return p.type !== 'refund'; }), function (p) { return p.amount; }) - sum(pays.filter(function (p) { return p.type === 'refund'; }), function (p) { return p.amount; }));
    var qs = (data.queries || []).filter(function (q) { var d = queryDate(q); return d >= from && d <= to && ok(q.channel); });
    var booked = qs.filter(isConverted).length;
    var couponBookings = arrivals.filter(function (b) { return b.couponType; });
    var rooms = activeRooms(data.settings || {}).length;
    var days = Math.round((parseD(to) - parseD(from)) / 864e5) + 1;
    var expenses = all ? sum((data.expenses || []).filter(function (e) { return e.date >= from && e.date <= to; }), function (e) { return e.amount; }) : null;
    var byCh = {};
    function ch(k) { return byCh[k] = byCh[k] || { queries: 0, converted: 0, bookings: 0, nights: 0, taxable: 0, net: 0, commission: 0, coupon: 0 }; }
    qs.forEach(function (q) { var x = ch(q.channel || 'Other'); x.queries++; if (isConverted(q)) x.converted++; });
    arrivals.forEach(function (b) { ch(b.source || 'Other').bookings++; });
    ls.forEach(function (l) { var x = ch(l.source || 'Other'); x.nights += l.nights; x.taxable = r2(x.taxable + l.taxable); x.net = r2(x.net + l.net); x.commission = r2(x.commission + l.commission); x.coupon = r2(x.coupon + l.coupon); });
    Object.keys(byCh).forEach(function (k) { var x = byCh[k]; x.conversionPct = x.queries ? r2(x.converted / x.queries * 100) : null; });
    return {
      from: from, to: to, days: days, channels: all ? ['All channels'] : channels.slice(),
      queries: qs.length, converted: booked, conversionPct: qs.length ? r2(booked / qs.length * 100) : 0,
      bookings: arrivals.length, cancellations: cancels.length, nights: t.nights,
      occupancyPct: rooms ? r2(t.nights / (rooms * days) * 100) : 0,
      room: t.room, food: t.food, other: r2(t.additional + t.cancelFee), discount: t.discount, coupon: t.coupon,
      gross: t.taxable, gst: t.gst, billed: t.billed, commission: t.commission, net: t.net,
      adr: t.nights ? r2(t.room / t.nights) : 0, perNight: t.nights ? r2(t.taxable / t.nights) : 0,
      collected: collected, couponsUsed: couponBookings.length,
      expenses: expenses, profit: expenses === null ? null : r2(t.net - expenses),
      byChannel: byCh, series: series(ls, from, to)
    };
  }
  /* Gross revenue (after discounts and coupons, before GST) by day, week or month depending on period length. */
  function series(ls, from, to) {
    var days = Math.round((parseD(to) - parseD(from)) / 864e5) + 1;
    var unit = days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
    var buckets = [], idx = {}, d = from;
    function key(x) { return unit === 'day' ? x : unit === 'week' ? (x < from ? from : startOfWeek(x) < from ? from : startOfWeek(x)) : x.slice(0, 7); }
    while (d <= to) { var k = key(d); if (idx[k] === undefined) { idx[k] = buckets.length; buckets.push({ key: k, taxable: 0, nights: 0 }); } d = addDays(d, 1); }
    ls.forEach(function (l) { var i = idx[key(l.date)]; if (i !== undefined) { buckets[i].taxable = r2(buckets[i].taxable + l.taxable); buckets[i].nights += l.nights; } });
    return { unit: unit, points: buckets };
  }
  function pctChange(cur, prev) { if (prev === null || prev === undefined || cur === null) return null; if (!prev) return cur ? null : 0; return r2((cur - prev) / Math.abs(prev) * 100); }

  /* ---------- Import old queries (CSV from Numbers / Excel / Google Sheets) ---------- */
  var IMPORT_FIELDS = [
    { key: 'date', label: 'Received date', required: true, syn: ['received date', 'received', 'date received', 'enquiry date', 'query date', 'inquiry date', 'date', 'created', 'created on'] },
    { key: 'name', label: 'Guest name', required: true, syn: ['guest name', 'guest', 'name', 'customer', 'customer name', 'client', 'client name'] },
    { key: 'phone', label: 'Mobile', syn: ['mobile', 'mobile number', 'phone', 'phone number', 'contact', 'contact number', 'number', 'whatsapp', 'mobile no'] },
    { key: 'email', label: 'Email', syn: ['email', 'e-mail', 'email id', 'mail'] },
    { key: 'channel', label: 'Channel', syn: ['channel', 'source', 'platform', 'booking source', 'via', 'lead source'] },
    { key: 'checkIn', label: 'Check-in date', syn: ['check-in date', 'check-in', 'checkin', 'check in', 'arrival', 'arrival date', 'from date'] },
    { key: 'checkOut', label: 'Check-out date', syn: ['check-out date', 'check-out', 'checkout', 'check out', 'departure', 'departure date', 'to date'] },
    { key: 'adults', label: 'Adults', syn: ['adults', 'adult', 'pax', 'guests', 'no of guests', 'persons'] },
    { key: 'children', label: 'Children', syn: ['children', 'child', 'kids'] },
    { key: 'room', label: 'Room', syn: ['room', 'room name', 'room type', 'accommodation'] },
    { key: 'quote', label: 'Quote ₹', syn: ['quote', 'quote rs', 'quoted', 'quoted amount', 'amount', 'price', 'rate', 'tariff'] },
    { key: 'status', label: 'Status', syn: ['status', 'stage', 'query status'] },
    { key: 'outcome', label: 'Outcome', syn: ['outcome', 'result', 'converted', 'booked'] },
    { key: 'lostReason', label: 'Reason not booked', syn: ['reason not booked', 'reason', 'lost reason', 'why not booked'] },
    { key: 'message', label: 'What they asked', syn: ['what they asked', 'asked', 'query', 'enquiry', 'inquiry', 'message', 'requirement', 'request', 'details'] },
    { key: 'notes', label: 'Notes', syn: ['notes', 'note', 'remarks', 'comment', 'comments', 'internal notes'] }
  ];
  function normHead(x) { return String(x || '').toLowerCase().replace(/[₹*()]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); }

  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var counts = { ',': 0, ';': 0, '\t': 0 }, inQ = false;
    for (var i = 0; i < first.length; i++) { var ch = first[i]; if (ch === '"') inQ = !inQ; else if (!inQ && counts[ch] !== undefined) counts[ch]++; }
    var delim = counts['\t'] > counts[','] && counts['\t'] >= counts[';'] ? '\t' : (counts[';'] > counts[','] ? ';' : ',');
    var rows = [], row = [], cell = '', q = false;
    for (var j = 0; j < text.length; j++) {
      var c = text[j];
      if (q) {
        if (c === '"') { if (text[j + 1] === '"') { cell += '"'; j++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[j + 1] === '\n') j++;
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    rows = rows.map(function (r) { return r.map(function (x) { return String(x).trim(); }); })
      .filter(function (r) { return r.some(function (x) { return x !== ''; }); });
    return { delimiter: delim, header: rows[0] || [], rows: rows.slice(1) };
  }

  /* Auto-match the file's column headings to the app's fields. Exact names first, then partial. Each column used once. */
  function guessColumns(header) {
    var map = {}, used = {}, H = header.map(normHead);
    [true, false].forEach(function (exact) {
      IMPORT_FIELDS.forEach(function (f) {
        if (map[f.key] !== undefined) return;
        for (var s = 0; s < f.syn.length; s++) {
          var syn = normHead(f.syn[s]);
          for (var i = 0; i < H.length; i++) {
            if (used[i] || !H[i]) continue;
            if (exact ? H[i] === syn : (syn.length > 3 && (' ' + H[i] + ' ').indexOf(' ' + syn + ' ') >= 0)) { map[f.key] = i; used[i] = 1; return; }
          }
        }
      });
    });
    return map;
  }

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  function mkDate(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return '';
    var s = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    return fmtD(parseD(s)) === s ? s : '';
  }
  /* Understands 2026-10-19, 19/10/2026, 19-10-26, 19.10.2026, 19 Oct 2026, 19-Oct-26, Oct 19, 2026, and spreadsheet serial numbers. */
  function parseDateLoose(v, monthFirst) {
    var s = String(v || '').trim().replace(/,/g, ' ').replace(/\s+/g, ' ');
    if (!s) return '';
    var m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return mkDate(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))) return monthFirst ? mkDate(m[3], m[1], m[2]) : mkDate(m[3], m[2], m[1]);
    if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})[ -](\d{2,4})$/))) return MONTHS[m[2].slice(0, 3).toLowerCase()] ? mkDate(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]) : '';
    if ((m = s.match(/^([A-Za-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)? (\d{2,4})$/))) return MONTHS[m[1].slice(0, 3).toLowerCase()] ? mkDate(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]) : '';
    if (/^\d{5}(\.\d+)?$/.test(s)) { var n = Number(s); if (n > 36000 && n < 73000) return fmtD(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5); }
    return '';
  }
  function moneyLoose(v) { var n = Number(String(v || '').replace(/rs\.?|inr|₹|,|\s/gi, '')); return isFinite(n) && n >= 0 ? r2(n) : 0; }

  function mapChannel(v, sources) {
    var raw = String(v || '').trim(), t = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!t) return { channel: 'Direct Booking', note: '' };
    var exact = (sources || SOURCES).filter(function (x) { return x.toLowerCase().replace(/[^a-z0-9]/g, '') === t; })[0];
    if (exact) return { channel: exact, note: '' };
    var rules = [[/booking|bdc|bcom/, 'Booking.com'], [/airbnb|abnb/, 'Airbnb'], [/makemytrip|mmt/, 'MakeMyTrip'], [/goibibo|ibibo/, 'Goibibo'], [/agoda/, 'Agoda'],
      [/google|gmb|maps|gbp/, 'Google'], [/agent|travel|tour|operator/, 'Travel Agent'],
      [/direct|walkin|walk|phone|call|whatsapp|wa|instagram|insta|facebook|fb|referral|friend|website|web|repeat|self/, 'Direct Booking']];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(t)) return { channel: rules[i][1], note: rules[i][1] === 'Direct Booking' && !/direct/.test(t) ? 'Came via: ' + raw : '' };
    return { channel: 'Other', note: 'Channel in old sheet: ' + raw };
  }
  function mapStatus(statusV, outcomeV) {
    var s = String(statusV || '').toLowerCase().trim(), o = String(outcomeV || '').toLowerCase().trim();
    var negative = /not ?book|lost|cancel|declin|no ?show|dead|reject|dropped|no response|not interested|^no$/;
    var positive = /book|convert|confirm|won|paid|advance|^yes$|^y$|stayed|checked/;
    if (negative.test(o)) return { status: 'Closed', outcome: 'Not booked' };
    if (positive.test(o)) return { status: 'Closed', outcome: 'Booked' };
    if (negative.test(s)) return { status: 'Closed', outcome: 'Not booked' };
    if (positive.test(s)) return { status: 'Closed', outcome: 'Booked' };
    if (/clos|done|complete/.test(s)) return { status: 'Closed', outcome: 'Not booked' };
    if (/answer|repl|quot|follow|pending|waiting|sent|respond|contacted|in progress|hold/.test(s)) return { status: 'Answered', outcome: '' };
    return { status: 'Open', outcome: '' };
  }
  function hashStr(x) { var h = 5381; x = String(x); for (var i = 0; i < x.length; i++) h = ((h << 5) + h + x.charCodeAt(i)) >>> 0; return h.toString(36); }

  /* Turn parsed rows into query records. Never imports a row twice (same name + phone + received date + check-in). */
  function buildImport(parsed, map, opts, existing) {
    opts = opts || {}; existing = existing || [];
    var settings = opts.settings || {}, rooms = settings.rooms || [], batch = opts.batch || ('imp-' + Date.now());
    var have = {}; existing.forEach(function (q) { have[q.id] = 1; have['k:' + String(q.name || '').toLowerCase().trim() + '|' + String(q.phone || '').replace(/\D/g, '').slice(-10) + '|' + (q.date || '')] = 1; });
    var out = { queries: [], skipped: [], duplicates: 0, warnings: 0 };
    function cell(r, k) { return map[k] === undefined || map[k] === '' || map[k] === null ? '' : String(r[map[k]] || '').trim(); }
    parsed.rows.forEach(function (r, idx) {
      var line = idx + 2, notes = [], name = cell(r, 'name');
      if (!name) { out.skipped.push({ line: line, reason: 'No guest name', row: r }); return; }
      var date = parseDateLoose(cell(r, 'date'), opts.monthFirst), ci = parseDateLoose(cell(r, 'checkIn'), opts.monthFirst), co = parseDateLoose(cell(r, 'checkOut'), opts.monthFirst);
      if (cell(r, 'date') && !date) notes.push('Received date not understood: ' + cell(r, 'date'));
      if (cell(r, 'checkIn') && !ci) notes.push('Check-in not understood: ' + cell(r, 'checkIn'));
      if (cell(r, 'checkOut') && !co) notes.push('Check-out not understood: ' + cell(r, 'checkOut'));
      if (!date && ci) { date = ci; notes.push('Received date missing — used check-in date'); }
      if (!date) { out.skipped.push({ line: line, reason: 'No received date or check-in date', row: r }); return; }
      if (ci && co && nights(ci, co) < 1) { notes.push('Check-out was not after check-in: ' + cell(r, 'checkOut')); co = ''; }
      var phone = cell(r, 'phone'), email = cell(r, 'email');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { notes.push('Email in old sheet: ' + email); email = ''; }
      var ch = mapChannel(cell(r, 'channel'), settings.sources); if (ch.note) notes.push(ch.note);
      var st = mapStatus(cell(r, 'status'), cell(r, 'outcome'));
      var roomTxt = cell(r, 'room'), room = roomTxt ? rooms.filter(function (x) { return String(x.name).toLowerCase().trim() === roomTxt.toLowerCase(); })[0] : null;
      if (roomTxt && !room) notes.push('Room in old sheet: ' + roomTxt);
      var key = 'k:' + name.toLowerCase() + '|' + phone.replace(/\D/g, '').slice(-10) + '|' + date;
      var id = 'imp-' + hashStr(key + '|' + ci);
      if (have[id] || have[key]) { out.duplicates++; return; }
      have[id] = 1; have[key] = 1;
      if (notes.length) out.warnings++;
      var created = date + 'T09:00:00+05:30', userNotes = cell(r, 'notes');
      out.queries.push({
        id: id, importBatch: batch, date: date, createdAt: created, updatedAt: new Date().toISOString(),
        name: name, phone: phone, email: email, channel: ch.channel, checkIn: ci, checkOut: co,
        adults: Math.max(1, Math.round(num(cell(r, 'adults')) || 2)), children: Math.max(0, Math.round(num(cell(r, 'children')))),
        roomId: room ? room.id : '', quote: moneyLoose(cell(r, 'quote')), message: cell(r, 'message'),
        notes: [userNotes].concat(notes.length ? ['[Import] ' + notes.join('; ')] : []).filter(Boolean).join('\n'),
        status: st.status, outcome: st.outcome, lostReason: st.outcome === 'Not booked' ? cell(r, 'lostReason') : '',
        answeredAt: st.status !== 'Open' ? created : '', closedAt: st.status === 'Closed' ? created : ''
      });
    });
    return out;
  }

  function inr(x, withPaise) {
    var v = r2(x), neg = v < 0; v = Math.abs(v);
    var whole = Math.floor(v), paise = Math.round((v - whole) * 100);
    var s = String(whole), last3 = s.slice(-3), rest = s.slice(0, -3);
    if (rest) last3 = ',' + last3;
    s = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + last3;
    if (paise || withPaise) s += '.' + String(paise).padStart(2, '0');
    return (neg ? '−₹' : '₹') + s;
  }


  /* ================= Version 1.5 ================= */
  var DEFAULT_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAACgBAMAAAB54XoeAAAAMFBMVEX9+/b08uzy8evSw6W0lmGrj1pjaEwmPy8hPCwgOywfOiseOiseOiodOisZNykRMCJ8xthPAAAGAUlEQVR42u2ab2zUdBjHP7870GnctWwmIrLRmyQwJ3jTKEIyeQMZJGCMgo4YicaYZTpmAv7JUEYAAY2K4UycJmoQY8REiIGo+D9xLzCg2zFgm0Z2HWMwDHe0AyOCbX3R21DZ9bq2b0x6r3btr598n36f5+nv6U18RbCfCCEwBIbAEBgCQ2AIDIFBAzNplwvHuVtm1FpfTwhQoXXl5uZ5aoDAw9PajzYv1gIDZpc1QW/rzKCA5u0tGlj7BlIBAQd2pAHMt5ZrgQDVuvZc6mysCQJo3NukgVCA7taUf6B18kUVqFgPWN0Pq76Bh2vTQMmmL6qB7IbFhdZHlxfImEVNGohbD0994EcNTp8qvsqXQjtjqGyoju5KymDtm5fyBTxSlAZKn98DU96sBsyGArnjDOxtaAIiD7yngLhpmQJkN870DjSWrtBAVFYlAKIHXpfB6hnvGLRwGM2sga4OoHRrm2wfOFS3HCjdvlv2prC/Ng1E3tgzfH1VTxzIPF3jLW2MuWsGQcw5Hh8JJ/Pwd+fh9KA5wYNC849XVKCyIX7pWMnnScDquU/1ADwyqwMoXbPnnwcn760Gsi2Lxx5ydlHTeYjcs2/6vzy8pu6ABtn8BZNPoTF/jQZi+pzEfwTsfN25YPKlzaHB9jwZcqhol1Pu5FGYXtYLRFqTl19VtSAOZJ+eMZaQjSVrNBB3HkiMcsWBpAxWT1fKPdA6uVkFpj4x6tmS1iRgfvSk5hp4vLYDKHlh9+hRVfVUA5mnatymTWZeiwaieiCex8i/7m3X4PRg9npXCs1ZW1Sg8vF43uT9dD1g9axSXQGPdHcApS+35e8AZXbBNC52A0w3vAtE6pMOPUpMalaAX1uzhYHmErupXkw4Pts+tgtmvloQOLBZBSqah5wfNvHWCsBsuLsQ0FzQAUQ2vy8XeP5WNShAZqNaSKGQQcz+OlFwh7B/g2yvdgZG9iowvcHF9rfkwyREnlMKKZy0ktIte9xsLat+rmba9oKmRLpLZr2muNqr/rkqvkIpPAXo0x/sdDcaRD9bH3XRYC3loOwOiHXWlAsrFKPxeoGKy5cWCzeDz2j6lgI7L7+zwuskFXkJeLQvsNHMqHoM9JUBTlIx9cwZc1MqMIW/t8iyZaUmB6bwWFY6o4nB5YEplFKAfk4KSqFR16cBhh5YyKYOWGWuXHEDPNFi53oqKIV6VgJw58o4t56AflYKRmHOEzA/CMplXciAVdaZCgR4Yq18VpLduuICqPdKNyoAuhtXXABnqtZ1JRogjkpBAI3ZnSTW6QDmRi0Ql+lvLgWwyofUAIAn1spRua/crSsRN57E9b22K90rAgAuVK2J26nQAJENQKFR3ikSVG7VAWKbVP+1bHBsdacRBbAkvdg3sOtL+ZyE6CsXGtBxs++QRbsU1+1dHug9D/kFmgtUa+J2yLmS8W2KNeWYnoBhV6SCrhS6h8JgaHUn4NaVQsCuHfK52E9AOufKIr8up2OTi54F+OIgMPRDTZsvoFmXpKjeLkHNzkp/Ci2pT1b32/ZJgCVtKlP8AEUGeXgDamlArK/Yl8KuHXJ2uKlGJIBfGjVfpnTErrg/9+d+XYOhEzPafADNuiSVb+W+rNrmxhXh+J8YRk2x3HjBvolWoyQBotHZFWeFkV701bkQ7Q5G7GCxj1o+8qoyMitF+2fKAD33+GkOKfP2EQ8+UwCG0mXegWadztSRJ51UobtwxQmYaY/1DZUbuYZlnlqnAVbsmW/aPbo8VTk+JXKR3+zhtP+RP24AkG75xHpH8eLysa+035T+eopmKIC5sB5JaCC668X6Ti8KDx/cJmRJZe6iBGDcdTUTAISpjTvX5ikPIxVAhTnykmG4S5T0e0xssxeAKbmv2aybixzOSdcuBbAmyQBCnz8ySOu6J5fNO2zChe9zLl869bbiKW2O2p0var8UMjsunbnNa7fx8Al/sA6BIdDfexvDaQ7L1feYgNNqnVrlt2MGDrU67bLEqr6xAkWuX+cJWR4zEDHBk5f5+2Hgpoxf6mSKOnag4z0MSy8EhsAQGAJD4P8Q+Dc4WxO2LdG/hwAAAABJRU5ErkJggg==';
  var BUSINESS_DEFAULTS = {
    address: 'Athulyam Homes, Near Greenpark Wedding Point, Mouja, Ranipokhari, Uttarakhand, India - 248145',
    phone: '7060139172', website: 'www.athulyamhomes.in', gstin: '05AAMFC7829D1ZF',
    checkInTime: '1:00 pm', checkOutTime: '11:00 am', stateName: 'Uttarakhand', stateCode: '05',
    sacRoom: '996311', sacFood: '996331', sacOther: '', invoicePrefix: 'INV', invoiceStart: 1
  };
  function fyKey(d) { var y = Number(String(d).slice(0, 4)), m = Number(String(d).slice(5, 7)); var s = m >= 4 ? y : y - 1; return s + '-' + String((s + 1) % 100).padStart(2, '0'); }
  function noSeq(no) { var m = String(no || '').match(/-(\d+)$/); return m ? Number(m[1]) : 0; }
  /* Numbers from before version 1.6 (ATH-0001, ATH-068) are replaced once by the continuous 6-digit series. */
  function isLegacyNo(no) { return !/-\d{6}$/.test(String(no || '')); }
  function bookingFy(b) { return fyKey(isDate(b.checkIn) ? b.checkIn : String(b.createdAt || '').slice(0, 10)); }
  /* One continuous series that never restarts: ATH-000001, ATH-000002 … so the number tells you how many bookings so far. */
  function nextBookingNo(data, checkIn, prefix, counters) {
    var max = num((counters || {}).all);
    (data.bookings || []).forEach(function (b) { if (b.no && !isLegacyNo(b.no)) max = Math.max(max, noSeq(b.no)); });
    return bookingNo(max + 1, prefix);
  }
  /* The Sheet's referee: every booking gets a unique number. Old-style or duplicate numbers are replaced:
     the earlier-made booking keeps its number; bookings without a valid number are numbered in arrival order. */
  function numberBookings(data, prefix, counters) {
    counters = counters || {};
    var used = {}, changed = [], need = [];
    var byMade = (data.bookings || []).slice().sort(function (a, b) {
      var x = String(a.createdAt || a.checkIn || ''), y = String(b.createdAt || b.checkIn || '');
      return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1);
    });
    byMade.forEach(function (b) {
      var q = noSeq(b.no);
      if (b.no && !isLegacyNo(b.no) && !used[q]) { used[q] = 1; counters.all = Math.max(num(counters.all), q); }
      else need.push(b);
    });
    need.sort(function (a, b) { return String(a.checkIn) < String(b.checkIn) ? -1 : String(a.checkIn) > String(b.checkIn) ? 1 : (String(a.createdAt) < String(b.createdAt) ? -1 : 1); });
    need.forEach(function (b) {
      counters.all = num(counters.all) + 1;
      var oldNo = b.no; b.no = bookingNo(counters.all, prefix);
      changed.push({ id: b.id, from: oldNo || '', to: b.no });
    });
    return changed;
  }
  /* Invoices: INV-000001, INV-000002 … one continuous series, given at check-out (GST rule 46: up to 16 characters, unique). */
  function invoiceNo(seq, fy, prefix) { return String(prefix || 'INV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) + '-' + String(seq).padStart(6, '0'); }
  function needsInvoice(b) { return b.status === 'Checked Out' && !b.imported && !/-\d{6}$/.test(String(b.invoiceNo || '')); }
  function assignInvoices(data, counters, start, prefix) {
    counters = counters || {}; var out = [];
    (data.bookings || []).forEach(function (b) {
      var m = String(b.invoiceNo || '').match(/-(\d{6})$/);
      if (m) counters.all = Math.max(num(counters.all), Number(m[1]));
    });
    (data.bookings || []).filter(needsInvoice).sort(function (a, b) {
      var x = a.checkedOutAt || a.checkOut, y = b.checkedOutAt || b.checkOut; return x < y ? -1 : x > y ? 1 : (a.id < b.id ? -1 : 1);
    }).forEach(function (b) {
      var date = isDate(b.checkedOutOn) ? b.checkedOutOn : b.checkOut;
      counters.all = Math.max(num(counters.all), num(start || 1) - 1) + 1;
      b.invoiceNo = invoiceNo(counters.all, '', prefix); b.invoiceDate = date;
      out.push(b.id);
    });
    return out;
  }
  /* Itemised extra charges: lines of { type: 'Food' | 'Other', name, amount }. Totals feed the food / additional amounts. */
  function chargeLines(b) {
    if (b.charges && b.charges.length) return b.charges;
    var out = [];
    if (num(b.food)) out.push({ type: 'Food', name: 'Food & beverages', amount: num(b.food) });
    if (num(b.additional)) out.push({ type: 'Other', name: b.additionalNote || 'Other services', amount: num(b.additional) });
    return out;
  }
  function applyCharges(b) {
    if (!b.charges) return b;
    b.food = r2(sum(b.charges.filter(function (c) { return c.type === 'Food'; }), function (c) { return c.amount; }));
    b.additional = r2(sum(b.charges.filter(function (c) { return c.type !== 'Food'; }), function (c) { return c.amount; }));
    b.additionalNote = b.charges.filter(function (c) { return c.type !== 'Food'; }).map(function (c) { return c.name; }).filter(Boolean).join(', ');
    return b;
  }
  /* Required fields. Optional: email, notes, special requests, food/extras/discount/commission, company billing,
     children's ID, address of guests other than the main guest. Old-sheet stays are not forced to have IDs. */
  function validateGuest(g, isMain, imported) {
    var e = [], F = g.nationality === 'Foreign', child = g.type === 'Child';
    function need(k, label) { if (!String(g[k] || '').trim()) e.push(label); }
    need('name', 'Full name'); need('gender', 'Gender');
    if (isMain) { need('phone', 'Mobile'); if (String(g.phone || '').replace(/\D/g, '').length < 10 && String(g.phone || '').trim()) e.push('Mobile (10+ digits)'); }
    if (F) {
      need('dob', 'Date of birth'); need('surname', 'Surname'); need('givenName', 'Given name'); need('country', 'Nationality (country)'); need('passportNo', 'Passport number');
      need('passportPlace', 'Passport place of issue'); need('passportIssue', 'Passport issue date'); need('passportExpiry', 'Passport expiry');
      need('visaNo', 'Visa number'); need('visaType', 'Visa type'); need('visaExpiry', 'Visa valid till');
      need('homeAddress', 'Address in home country'); need('arrivedFrom', 'Arrived from'); need('arrivalIndia', 'Date of arrival in India'); need('nextPlace', 'Next destination');
    } else if (!child && !imported) {
      need('idType', 'ID type'); need('idNumber', 'ID number'); if (isMain) need('address', 'Address');
    }
    return e;
  }
  function validateCustom(b, settings) {
    return ((settings || {}).customFields || []).filter(function (cf) { return cf.required && cf.label && !String(((b.custom || {})[cf.id]) || '').trim(); }).map(function (cf) { return cf.label; });
  }

  /* ---------- Two-way sync: merge two copies of the data, newest change of each record wins ---------- */
  var COLLS = ['bookings', 'payments', 'expenses', 'queries'];
  function stampOf(r) { return String(r.updatedAt || r.createdAt || ''); }
  function syncMerge(base, inc) {
    base = base || {}; inc = inc || {};
    var del = {}, out = {}, stats = { fromOther: 0, kept: 0, deleted: 0 };
    [base.deleted || {}, inc.deleted || {}].forEach(function (m) { Object.keys(m).forEach(function (id) { if (!del[id] || m[id] > del[id]) del[id] = m[id]; }); });
    COLLS.forEach(function (k) {
      var map = {};
      (base[k] || []).forEach(function (r) { if (r && r.id) map[r.id] = r; });
      (inc[k] || []).forEach(function (r) {
        if (!r || !r.id) return;
        var cur = map[r.id];
        if (!cur) { map[r.id] = r; stats.fromOther++; }
        else if (stampOf(r) >= stampOf(cur)) { if (stampOf(r) > stampOf(cur)) stats.fromOther++; map[r.id] = r; }
        else stats.kept++;
      });
      out[k] = Object.keys(map).filter(function (id) { if (del[id]) { stats.deleted++; return false; } return true; }).map(function (id) { return map[id]; });
    });
    var bs = base.settings || {}, is = inc.settings || {}, pick;
    if (!Object.keys(is).length) pick = bs;
    else if (!Object.keys(bs).length) pick = is;
    else if (bs.settingsAt && is.settingsAt) pick = String(is.settingsAt) >= String(bs.settingsAt) ? is : bs;
    else if (bs.settingsAt || is.settingsAt) pick = is.settingsAt ? is : bs;
    else {
      /* Neither copy has been edited since version 1.5: keep the one whose rooms the bookings actually use. */
      var score = function (st) { var ids = {}; (st.rooms || []).forEach(function (r) { ids[r.id] = 1; }); return (out.bookings || []).filter(function (b) { return roomIds(b).length && roomIds(b).every(function (x) { return ids[x]; }); }).length; };
      pick = score(is) > score(bs) ? is : bs;
    }
    out.settings = pick;
    out.deleted = del;
    out.stats = stats;
    return out;
  }

  /* ---------- Letterhead documents: booking confirmation and tax invoice ---------- */
  var ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function words99(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''); }
  function words999(n) { var h = Math.floor(n / 100), r = n % 100; return (h ? ONES[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? words99(r) : ''); }
  function amountInWords(x) {
    var v = Math.round(num(x) * 100), rs = Math.floor(v / 100), ps = v % 100, parts = [];
    if (!rs) parts.push('Zero');
    var cr = Math.floor(rs / 1e7); rs %= 1e7; var lk = Math.floor(rs / 1e5); rs %= 1e5; var th = Math.floor(rs / 1000); rs %= 1000;
    if (cr) parts.push(words999(cr) + ' Crore'); if (lk) parts.push(words99(lk) + ' Lakh'); if (th) parts.push(words99(th) + ' Thousand'); if (rs) parts.push(words999(rs));
    return 'Rupees ' + parts.join(' ') + (ps ? ' and ' + words99(ps) + ' Paise' : '') + ' Only';
  }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtLong(d) {
    if (!isDate(d)) return d || '';
    var t = new Date(parseD(d)), wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()];
    return wd + ', ' + t.getUTCDate() + ' ' + MONTH_NAMES[t.getUTCMonth()].slice(0, 3) + ' ' + t.getUTCFullYear();
  }
  function maskId(x) { var s = String(x || '').replace(/\s/g, ''); return s.length > 4 ? 'XXXX' + s.slice(-4) : s; }
  function biz(settings) {
    var s = settings || {}, o = {};
    Object.keys(BUSINESS_DEFAULTS).forEach(function (k) { o[k] = s[k] !== undefined && s[k] !== '' ? s[k] : BUSINESS_DEFAULTS[k]; });
    o.name = s.businessName || 'Athulyam Homes'; o.legalName = s.legalName || ''; o.logo = s.logo || DEFAULT_LOGO; o.email = s.email || '';
    if (!s.address || s.address === 'Uttarakhand, India') o.address = BUSINESS_DEFAULTS.address;
    return o;
  }
  var DOC_CSS = '<style>' +
    '.ahdoc{font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#1d241f;max-width:760px;margin:0 auto;background:#fff}' +
    '.ahdoc table{border-collapse:collapse;width:100%}.ahdoc td,.ahdoc th{padding:5px 7px;vertical-align:top;text-align:left;font-size:10pt;font-family:Arial,Helvetica,sans-serif}.ahdoc p{font-size:10pt}' +
    '.ahdoc .lh td{padding:0;border:0}.ahdoc .lh .nm{font-size:20pt;font-weight:bold;color:#1e3a2b;letter-spacing:.5px}' +
    '.ahdoc .lh .sub{font-size:9pt !important;color:#4a544d;line-height:1.45}.ahdoc .rule{height:3px;background:#b8955a;margin:8px 0 2px}.ahdoc .rule2{height:1px;background:#1e3a2b;margin:0 0 12px}' +
    '.ahdoc .ttl{font-size:14pt;font-weight:bold;color:#1e3a2b;letter-spacing:2px}.ahdoc .meta td{padding:2px 0;font-size:9.5pt !important}.ahdoc .meta td.k{color:#68716a;padding-right:8px}' +
    '.ahdoc .grid td,.ahdoc .grid th{border:1px solid #d9d4c7}.ahdoc .grid th{background:#1e3a2b;color:#fff;font-size:9pt}.ahdoc .kv td:first-child{width:34%;color:#4a544d;background:#f7f5ef}' +
    '.ahdoc .ref td{background:#efe4cf !important;font-weight:bold;color:#1e3a2b}.ahdoc h3{font-size:11pt;color:#1e3a2b;margin:16px 0 6px;border-bottom:2px solid #b8955a;padding-bottom:3px}' +
    '.ahdoc .r{text-align:right}.ahdoc .tot td{font-weight:bold;background:#f7f5ef}.ahdoc .grand td{font-weight:bold;font-size:11pt;background:#1e3a2b;color:#fff}' +
    '.ahdoc .small,.ahdoc td.small{font-size:8.5pt !important;color:#68716a;line-height:1.5}.ahdoc .times td{border:1px solid #d9d4c7;text-align:center;width:50%}.ahdoc .times b{display:block;font-size:13pt;color:#1e3a2b}' +
    '.ahdoc .foot{margin-top:18px;border-top:1px solid #d9d4c7;padding-top:8px;text-align:center;font-size:8.5pt;color:#68716a}</style>';
  function letterhead(B, title, metaRows) {
    return '<table class="lh"><tr><td style="width:84px"><img src="' + h(B.logo) + '" style="width:72px;height:72px;border-radius:10px" alt=""></td>' +
      '<td><div class="nm">' + h(B.name) + '</div><div class="sub">' + h(String(B.address).indexOf(B.name + ',') === 0 ? String(B.address).slice(B.name.length + 1).trim() : B.address) + '<br>Phone ' + h(B.phone) + (B.website ? ' · ' + h(B.website) : '') + (B.email ? ' · ' + h(B.email) : '') +
      '<br><b>GSTIN ' + h(B.gstin) + '</b>' + (B.legalName ? ' · ' + h(B.legalName) : '') + '</div></td></tr></table>' +
      '<div class="rule"></div><div class="rule2"></div>' +
      '<table><tr><td style="padding:0"><span class="ttl">' + h(title) + '</span></td><td style="padding:0;width:45%"><table class="meta">' +
      metaRows.map(function (m) { return '<tr><td class="k r">' + h(m[0]) + '</td><td><b>' + h(m[1]) + '</b></td></tr>'; }).join('') + '</table></td></tr></table>';
  }
  function roomNameIn(settings, id) { var r = ((settings || {}).rooms || []).filter(function (x) { return x.id === id; })[0]; return r ? r.name : (id || 'Room'); }
  /* kind: 'confirmation' or 'invoice'. Returns a complete HTML fragment with its own styles (PDF and screen). */
  function docHtml(kind, b, data) {
    var st = (data && data.settings) || {}, B = biz(st), c = calc(b, (data && data.payments) || []), inv = kind === 'invoice';
    var gs = guestsOf(b), main = gs.filter(function (g) { return g.primary; })[0] || gs[0] || {};
    var roomsTxt = roomsOf(b).map(function (r) { return roomNameIn(st, r.roomId); }).join(' + ') || '—';
    var meta = inv ? [['Invoice no.', b.invoiceNo || '(issued at check-out)'], ['Invoice date', fmtLong(b.invoiceDate || b.checkOut)], ['Booking ref.', b.no || '—'], ['Place of supply', B.stateName + ' (' + B.stateCode + ')']]
      : [['Booking ref.', b.no || '—'], ['Status', b.status === 'Cancelled' ? 'Cancelled' : 'Confirmed']];
    var out = DOC_CSS + '<div class="ahdoc">' + letterhead(B, inv ? 'TAX INVOICE' : 'BOOKING CONFIRMATION', meta);
    function kv(k, v, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + h(k) + '</td><td>' + (v === '' || v == null ? '—' : v) + '</td></tr>'; }
    var gst = c.gst, cg = r2(gst / 2), sg = r2(gst - cg);
    if (!inv) {
      out += '<p style="margin:12px 0 4px">Dear ' + h(String(b.guestName || 'Guest').split(/[ ,&]/)[0]) + ',</p><p style="margin:0 0 6px">Thank you for choosing ' + h(B.name) + '. We are pleased to confirm your stay as below.</p>';
      out += '<h3>Stay</h3><table class="grid kv">' + kv('Booking Reference Number', h(b.no || '—'), 'ref') + kv('Main guest', h(b.guestName)) + kv('Mobile', h(b.phone)) + (b.email ? kv('Email', h(b.email)) : '') +
        kv('Guests', h(num(b.adults) + ' adult' + (num(b.adults) === 1 ? '' : 's') + (num(b.children) ? ', ' + num(b.children) + ' child' + (num(b.children) === 1 ? '' : 'ren') : ''))) +
        kv('Check-in', h(fmtLong(b.checkIn)) + ' &nbsp;·&nbsp; from ' + h(B.checkInTime)) + kv('Check-out', h(fmtLong(b.checkOut)) + ' &nbsp;·&nbsp; by ' + h(B.checkOutTime)) +
        kv('Nights', h(c.nights)) + kv('Room' + (roomsOf(b).length > 1 ? 's' : ''), h(roomsTxt)) + kv('Booked via', h(b.source)) + (b.specialRequests ? kv('Special requests', h(b.specialRequests)) : '') + '</table>';
      out += '<h3>Charges</h3><table class="grid">' +
        (c.roomParts || []).map(function (p) { return '<tr><td>Room — ' + h(roomNameIn(st, p.roomId)) + ' (' + c.nights + ' night' + (c.nights === 1 ? '' : 's') + ')</td><td class="r">' + inr(p.charge, true) + '</td></tr>'; }).join('') +
        chargeLines(b).map(function (x) { return '<tr><td>' + h(x.name || (x.type === 'Food' ? 'Food & beverages' : 'Other services')) + '</td><td class="r">' + inr(x.amount, true) + '</td></tr>'; }).join('') +
        (c.discount ? '<tr><td>Less: discount</td><td class="r">−' + inr(c.discount, true) + '</td></tr>' : '') +
        (c.coupon ? '<tr><td>Less: coupon ' + h(c.couponLabel) + '</td><td class="r">−' + inr(c.coupon, true) + '</td></tr>' : '') +
        (c.cancelFee ? '<tr><td>Cancellation charge</td><td class="r">' + inr(c.cancelFee, true) + '</td></tr>' : '') +
        '<tr class="tot"><td>Taxable value</td><td class="r">' + inr(c.taxable, true) + '</td></tr>' +
        (gst ? '<tr><td>CGST</td><td class="r">' + inr(cg, true) + '</td></tr><tr><td>SGST</td><td class="r">' + inr(sg, true) + '</td></tr>' : '') +
        '<tr class="grand"><td>Total</td><td class="r">' + inr(c.total, true) + '</td></tr>' +
        '<tr><td>Amount received</td><td class="r">' + inr(c.received, true) + '</td></tr>' +
        '<tr class="tot"><td>' + (c.outstanding < 0 ? 'Refund due to you' : 'Balance payable at check-in') + '</td><td class="r">' + inr(Math.abs(c.outstanding), true) + '</td></tr></table>';
      out += '<table class="times" style="margin-top:14px"><tr><td>Check-in time<b>' + h(B.checkInTime) + '</b></td><td>Check-out time<b>' + h(B.checkOutTime) + '</b></td></tr></table>';
      out += '<h3>Please note</h3><p class="small">• Every guest needs a valid photo ID at check-in (Aadhaar, passport, driving licence or voter ID). Foreign nationals: passport and valid visa.<br>' +
        '• Early check-in and late check-out depend on availability.<br>• For directions or any change to your booking, call or WhatsApp us on ' + h(B.phone) + '.</p>';
    } else {
      out += '<table style="margin-top:12px"><tr><td style="width:55%;padding:0 12px 0 0"><h3 style="margin-top:0">Billed to</h3><b>' + h(b.billTo || b.guestName) + '</b>' +
        (b.billTo && b.billTo !== b.guestName ? '<br>Guest: ' + h(b.guestName) : '') + (main.address ? '<br>' + h(main.address) : '') + (b.phone ? '<br>Mobile ' + h(b.phone) : '') + (b.email ? '<br>' + h(b.email) : '') +
        (b.billGstin ? '<br><b>GSTIN ' + h(b.billGstin) + '</b>' : '') + '</td>' +
        '<td style="padding:0"><h3 style="margin-top:0">Stay</h3>Check-in: ' + h(fmtLong(b.checkIn)) + '<br>Check-out: ' + h(fmtLong(b.checkOut)) + '<br>Nights: ' + c.nights + '<br>Room' + (roomsOf(b).length > 1 ? 's' : '') + ': ' + h(roomsTxt) + '</td></tr></table>';
      var rows = [], sh = c.taxable ? 1 : 0;
      (c.roomParts || []).forEach(function (p) { rows.push(['Room accommodation — ' + roomNameIn(st, p.roomId), B.sacRoom, c.nights || 1, p.taxable, p.rate, p.gst]); });
      /* each charge line gets its share of the food / other taxable value and GST */
      ['Food', 'Other'].forEach(function (t) {
        var ls = chargeLines(b).filter(function (x) { return (x.type === 'Food') === (t === 'Food'); }), tot = sum(ls, function (x) { return x.amount; });
        var tx = t === 'Food' ? c.foodTaxable : c.otherTaxable, gt = t === 'Food' ? c.gstFood : c.gstOther, givenT = 0, givenG = 0;
        ls.forEach(function (x, i) {
          var last = i === ls.length - 1, a = last ? r2(tx - givenT) : r2(tx * num(x.amount) / (tot || 1)), g = last ? r2(gt - givenG) : r2(gt * num(x.amount) / (tot || 1));
          givenT = r2(givenT + a); givenG = r2(givenG + g);
          if (a || g) rows.push([x.name || (t === 'Food' ? 'Food & beverages' : 'Other services'), t === 'Food' ? B.sacFood : B.sacOther, 1, a, num(t === 'Food' ? b.gstFoodRate : b.gstOtherRate), g]);
        });
      });
      out += '<h3>Details</h3><table class="grid"><tr><th>#</th><th>Description</th><th>SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Taxable value</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">Amount</th></tr>' +
        rows.map(function (x, i) {
          var g = b.gstOn ? num(x[5]) : 0, c1 = r2(g / 2), s1 = r2(g - c1), half = num(x[4]) / 2;
          return '<tr><td>' + (i + 1) + '</td><td>' + h(x[0]) + '</td><td>' + h(x[1] || '—') + '</td><td class="r">' + x[2] + '</td><td class="r">' + inr(r2(x[3] / x[2]), true) + '</td><td class="r">' + inr(x[3], true) + '</td>' +
            '<td class="r">' + (g ? half + '%<br>' + inr(c1, true) : '—') + '</td><td class="r">' + (g ? half + '%<br>' + inr(s1, true) : '—') + '</td><td class="r">' + inr(r2(x[3] + g), true) + '</td></tr>';
        }).join('') +
        '<tr class="tot"><td colspan="5">Total</td><td class="r">' + inr(c.taxable, true) + '</td><td class="r">' + inr(cg, true) + '</td><td class="r">' + inr(sg, true) + '</td><td class="r">' + inr(c.total, true) + '</td></tr></table>';
      if (c.discount || c.coupon) out += '<p class="small">Taxable values are after a discount of ' + inr(r2(c.discount + c.coupon), true) + (c.couponLabel ? ' (coupon ' + h(c.couponLabel) + ')' : '') + '.</p>';
      out += '<table class="grid" style="margin-top:10px"><tr class="grand"><td>Invoice total</td><td class="r">' + inr(c.total, true) + '</td></tr>' +
        '<tr><td colspan="2"><i>' + h(amountInWords(c.total)) + '</i></td></tr>' +
        '<tr><td>Amount received</td><td class="r">' + inr(c.received, true) + '</td></tr><tr class="tot"><td>' + (c.outstanding < 0 ? 'Refund due' : 'Balance due') + '</td><td class="r">' + inr(Math.abs(c.outstanding), true) + '</td></tr></table>';
      var pays = paymentsFor(b, data.payments);
      if (pays.length) out += '<p class="small">Payments: ' + pays.map(function (p) { return h(fmtLong(p.date)) + ' ' + h(p.method) + ' ' + (p.type === 'refund' ? '−' : '') + inr(p.amount, true); }).join(' · ') + '</p>';
      out += '<table style="margin-top:14px"><tr><td style="padding:0" class="small">Tax payable on reverse charge: No<br>Place of supply: ' + h(B.stateName) + ' (' + h(B.stateCode) + ')<br>Check-in ' + h(B.checkInTime) + ' · Check-out ' + h(B.checkOutTime) + '</td>' +
        '<td style="padding:0;text-align:right;width:45%">For <b>' + h(B.legalName || B.name) + '</b><br><br><br>Authorised signatory</td></tr></table>';
    }
    out += '<div class="foot">' + h(st.billFooter || 'Thank you for staying with us.') + '<br>' + h(B.name) + ' · ' + h(B.phone) + (B.website ? ' · ' + h(B.website) : '') + ' · GSTIN ' + h(B.gstin) + '</div></div>';
    return out;
  }

  /* ---------- Import of the old Numbers booking sheets (prepared file) ---------- */
  function normName(n) { return String(n || '').toLowerCase().replace(/^(mr|mrs|ms|dr)\.?\s+/, '').replace(/[^a-z]/g, ''); }
  function last10(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
  /* Amounts in the old sheets include GST. Rooms: 12% before 22 Sep 2025, 5% from then (≤ ₹7,500 a night per room; above that 18%). Food 5%. */
  function oldRoomRate(checkIn, perNightIncl) {
    var early = checkIn < '2025-09-22', low = early ? 12 : 5;
    return perNightIncl / (1 + low / 100) > 7500 ? 18 : low;
  }
  function importOld(data, file, mapping, opt) {
    opt = opt || {}; var settings = data.settings || {}, res = { bookings: [], payments: [], skipped: [], duplicates: [] };
    var have = {}; (data.bookings || []).forEach(function (b) { have[b.id] = b; });
    var nowIso = opt.now || new Date().toISOString(), otherRate = num(settings.gstOther === undefined ? 18 : settings.gstOther);
    (file.bookings || []).forEach(function (x) {
      var id = x.key;
      if (have[id]) { res.skipped.push({ no: x.no, guest: x.guestName, why: 'Already imported' }); return; }
      var dup = (data.bookings || []).filter(function (b) {
        return !b.imported && b.status !== 'Cancelled' && b.checkIn < x.checkOut && x.checkIn < b.checkOut &&
          ((last10(b.phone) && last10(b.phone) === last10(x.phone)) || (normName(b.guestName) && normName(b.guestName) === normName(x.guestName)));
      })[0];
      if (dup) { res.duplicates.push({ no: x.no, guest: x.guestName, checkIn: x.checkIn, existing: dup.no || dup.id }); return; }
      var rooms = [];
      Object.keys(x.roomTypes || {}).forEach(function (t) {
        var m = mapping[t] || { rooms: [], whole: false }, list = m.rooms || [];
        var take = m.whole ? list : list.slice(0, Math.max(1, num(x.roomTypes[t])));
        take.forEach(function (rid) { if (rooms.indexOf(rid) < 0) rooms.push(rid); });
      });
      if (!rooms.length) { res.skipped.push({ no: x.no, guest: x.guestName, why: 'No room chosen for ' + Object.keys(x.roomTypes || {}).join(', ') }); return; }
      var n = Math.max(nights(x.checkIn, x.checkOut), 1), perRoomIncl = num(x.roomIncl) / rooms.length;
      var rate = oldRoomRate(x.checkIn, perRoomIncl / n), foodRate = 5;
      var b = {
        id: id, no: x.no, imported: !!x.past, importedFrom: 'Old Numbers sheet', guestName: x.guestName, phone: x.phone || '', email: '',
        adults: num(x.adults) || 1, children: 0, roomId: rooms[0], checkIn: x.checkIn, checkOut: x.checkOut, source: x.source || 'Not recorded',
        status: x.status, gstOn: true, gstRoomRate: rate, gstFoodRate: foodRate, gstOtherRate: otherRate, gstRateManual: true,
        food: r2(num(x.foodIncl) / (1 + foodRate / 100)), additional: r2(num(x.otherIncl) / (1 + otherRate / 100)), additionalNote: x.otherIncl ? 'Pick-up/drop & other charges' : '',
        discount: 0, commission: 0, notes: x.notes || '', specialRequests: '', createdAt: x.createdAt || nowIso, updatedAt: nowIso, fbToken: 'imp' + id.replace(/[^a-z0-9]/gi, '').slice(-12),
        oldCustIds: x.oldCustIds || [], oldInvoices: x.oldInvoices || []
      };
      var each = r2(num(x.roomIncl) / (1 + rate / 100) / rooms.length);
      b.rooms = rooms.map(function (rid) { return { roomId: rid, charge: each }; });
      if (x.cancelled) { b.status = 'Cancelled'; b.cancelFee = r2(x.total); b.cancelledOn = x.checkIn; }
      else {
        /* fit to the paisa so the bill total equals the old sheet total */
        for (var k = 0; k < 6; k++) {
          var diff = r2(num(x.total) - calc(b, []).total);
          if (!diff) break;
          var tgt = b.rooms.length && num(x.roomIncl) ? b.rooms[b.rooms.length - 1] : null;
          if (tgt) tgt.charge = r2(num(tgt.charge) + diff / (1 + rate / 100));
          else if (num(x.foodIncl)) b.food = r2(b.food + diff / (1 + foodRate / 100));
          else b.additional = r2(b.additional + diff / (1 + otherRate / 100));
        }
        var left = r2(num(x.total) - calc(b, []).total);
        if (left) b.additional = r2(b.additional + left / (1 + otherRate / 100));
      }
      b.guests = (x.guests || []).map(function (g, i) {
        return { id: 'g-' + id.slice(-10) + '-' + i, name: g.name, primary: i === 0, type: 'Adult', nationality: g.nationality || 'Indian', country: g.country || '', idType: g.idType || '', idNumber: g.idNumber || '', address: g.address || '', phone: i === 0 ? (x.phone || '') : '', docs: [] };
      });
      if (!b.guests.length) migrateGuests(b);
      res.bookings.push(b);
      if (num(x.paid)) res.payments.push({ id: 'pay-' + id, bookingId: id, type: 'payment', amount: r2(x.paid), date: x.paidDate || x.checkIn, method: 'Not recorded', ref: 'Imported from old sheet', createdAt: b.createdAt, updatedAt: nowIso });
    });
    return res;
  }

  return {
    ACTIVE: ACTIVE, STATUSES: STATUSES, QUERY_STATUSES: QUERY_STATUSES, QUERY_OUTCOMES: QUERY_OUTCOMES,
    migrateEnquiries: migrateEnquiries, roomsOf: roomsOf, roomIds: roomIds, roomTotal: roomTotal, autoRoomRates: autoRoomRates, guestsOf: guestsOf, foreignGuests: foreignGuests, isForeignBooking: isForeignBooking, migrateGuests: migrateGuests, formCDeparturePending: formCDeparturePending, guestCountGap: guestCountGap, docsMissing: docsMissing, bookingNo: bookingNo, assignBookingNumbers: assignBookingNumbers, financialYear: financialYear, driveFolderPath: driveFolderPath, cleanName: cleanName, discounts: discounts, couponLabel: couponLabel, freeRooms: freeRooms, couponCandidates: couponCandidates, couponCode: couponCode, quoteAfterCoupon: quoteAfterCoupon, periodRange: periodRange, comparisonRange: comparisonRange, analytics: analytics, pctChange: pctChange, startOfWeek: startOfWeek, IMPORT_FIELDS: IMPORT_FIELDS, parseCSV: parseCSV, guessColumns: guessColumns, parseDateLoose: parseDateLoose, mapChannel: mapChannel, mapStatus: mapStatus, buildImport: buildImport, moneyLoose: moneyLoose, queryConversion: queryConversion, dashboard: dashboard, reviewLinks: reviewLinks, isConverted: isConverted, queryDate: queryDate, METHODS: METHODS, SOURCES: SOURCES, EXPENSE_CATS: EXPENSE_CATS,
    num: num, r2: r2, addDays: addDays, nights: nights, isDate: isDate, monthOf: monthOf, daysInMonth: daysInMonth,
    monthStart: monthStart, monthEnd: monthEnd, prevMonth: prevMonth, isActive: isActive, isCancelled: isCancelled, sum: sum,
    calc: calc, lines: lines, allLines: allLines, totals: totals, collections: collections, outstandingAll: outstandingAll,
    dailyReport: dailyReport, monthlyReport: monthlyReport, platformReport: platformReport, gstSummary: gstSummary,
    payoutReport: payoutReport, overlaps: overlaps, futureBookings: futureBookings, paymentFlags: paymentFlags,
    formCPending: formCPending, merge: merge, validateBooking: validateBooking, autoRoomGstRate: autoRoomGstRate,
    rateCardTotal: rateCardTotal, activeRooms: activeRooms, paymentsFor: paymentsFor, inr: inr,
    DEFAULT_LOGO: DEFAULT_LOGO, BUSINESS_DEFAULTS: BUSINESS_DEFAULTS, fyKey: fyKey, isLegacyNo: isLegacyNo, nextBookingNo: nextBookingNo, numberBookings: numberBookings, invoiceNo: invoiceNo, needsInvoice: needsInvoice, assignInvoices: assignInvoices,
    syncMerge: syncMerge, chargeLines: chargeLines, applyCharges: applyCharges, validateGuest: validateGuest, validateCustom: validateCustom, docHtml: docHtml, amountInWords: amountInWords, biz: biz, fmtLong: fmtLong, maskId: maskId, importOld: importOld, oldRoomRate: oldRoomRate, COLLS: COLLS
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AH;
