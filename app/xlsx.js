/* Athulyam Homes — tiny offline Excel (.xlsx) writer with native bar and line charts.
   No outside libraries: builds the Office Open XML parts and zips them (stored, with CRC-32). */
var AHXlsx = (function () {
  'use strict';

  /* ---------- zip (store method) ---------- */
  var CRC = (function () { var t = [], c; for (var n = 0; n < 256; n++) { c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }
  function zip(files) {
    var parts = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = utf8(f.name), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
      var head = [].concat([0x50, 0x4b, 3, 4], u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      parts.push(new Uint8Array(head), name, data);
      central.push(new Uint8Array([].concat([0x50, 0x4b, 1, 2], u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
      offset += head.length + name.length + data.length;
    });
    var cdSize = central.reduce(function (a, x) { return a + x.length; }, 0);
    var end = new Uint8Array([].concat([0x50, 0x4b, 5, 6], u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)));
    var all = parts.concat(central, [end]), len = all.reduce(function (a, x) { return a + x.length; }, 0), out = new Uint8Array(len), p = 0;
    all.forEach(function (x) { out.set(x, p); p += x.length; });
    return out;
  }

  /* ---------- helpers ---------- */
  function x(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
  function col(n) { var s = ''; n++; while (n) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function ref(sheet, c1, r1, c2, r2) { return "'" + sheet.replace(/'/g, "''") + "'!$" + col(c1) + '$' + (r1 + 1) + (c2 === undefined ? '' : ':$' + col(c2) + '$' + (r2 + 1)); }
  /* style ids: 0 normal, 1 header, 2 money, 3 percent, 4 bold, 5 integer, 6 title, 7 note, 8 bold money, 9 change % */
  var STYLE = { text: 0, header: 1, money: 2, pct: 3, bold: 4, int: 5, title: 6, note: 7, boldMoney: 8, change: 9 };

  function sheetXml(sh, drawingRid) {
    var rows = sh.rows.map(function (r, ri) {
      var cells = (r || []).map(function (cell, ci) {
        if (cell === null || cell === undefined || cell === '') return '';
        var v = cell, s = 0;
        if (typeof cell === 'object' && !(cell instanceof Date)) { v = cell.v; s = STYLE[cell.s] || 0; }
        var a = col(ci) + (ri + 1);
        if (v === null || v === undefined || v === '') return s ? '<c r="' + a + '" s="' + s + '"/>' : '';
        if (typeof v === 'number' && isFinite(v)) return '<c r="' + a + '"' + (s ? ' s="' + s + '"' : '') + '><v>' + v + '</v></c>';
        return '<c r="' + a + '" t="inlineStr"' + (s ? ' s="' + s + '"' : '') + '><is><t xml:space="preserve">' + x(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + (ri + 1) + '">' + cells + '</row>';
    }).join('');
    var cols = sh.widths ? '<cols>' + sh.widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
    var freeze = sh.freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sh.freeze + '" topLeftCell="A' + (sh.freeze + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      freeze + cols + '<sheetData>' + rows + '</sheetData>' + (sh.filter ? '<autoFilter ref="' + sh.filter + '"/>' : '') + (drawingRid ? '<drawing r:id="' + drawingRid + '"/>' : '') + '</worksheet>';
  }
  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="+0.0%;-0.0%;0.0%"/></numFmts>' +
      '<fonts count="5"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font><font><b/><sz val="15"/><color rgb="FF1E3A2B"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF68716A"/><name val="Arial"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A2B"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment wrapText="1" vertical="center"/></xf>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="1"/></xf>' +
      '<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  }

  /* chart: { sheet, type:'bar'|'line', title, cat:{c,r1,r2}, series:[{name, c, r1, r2, color}], anchor:{col,row,cols,rows}, horizontal } */
  function chartXml(ch, wb) {
    var src = wb.sheets.filter(function (s) { return s.name === ch.sheet; })[0];
    function cache(c, r1, r2, num) {
      var pts = [];
      for (var r = r1; r <= r2; r++) {
        var cell = (src.rows[r] || [])[c]; var v = cell && typeof cell === 'object' ? cell.v : cell;
        pts.push('<c:pt idx="' + (r - r1) + '"><c:v>' + x(num ? (Number(v) || 0) : (v == null ? '' : v)) + '</c:v></c:pt>');
      }
      return '<c:ptCount val="' + (r2 - r1 + 1) + '"/>' + pts.join('');
    }
    var ser = ch.series.map(function (s, i) {
      var sp = ch.type === 'line' ? '<c:spPr><a:ln w="28575"><a:solidFill><a:srgbClr val="' + s.color + '"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>'
        : '<c:spPr><a:solidFill><a:srgbClr val="' + s.color + '"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>';
      return '<c:ser><c:idx val="' + i + '"/><c:order val="' + i + '"/><c:tx><c:v>' + x(s.name) + '</c:v></c:tx>' + sp +
        '<c:cat><c:strRef><c:f>' + x(ref(ch.sheet, ch.cat.c, ch.cat.r1, ch.cat.c, ch.cat.r2)) + '</c:f><c:strCache>' + cache(ch.cat.c, ch.cat.r1, ch.cat.r2, false) + '</c:strCache></c:strRef></c:cat>' +
        '<c:val><c:numRef><c:f>' + x(ref(ch.sheet, s.c, s.r1, s.c, s.r2)) + '</c:f><c:numCache><c:formatCode>General</c:formatCode>' + cache(s.c, s.r1, s.r2, true) + '</c:numCache></c:numRef></c:val>' +
        (ch.type === 'line' ? '<c:smooth val="0"/>' : '') + '</c:ser>';
    }).join('');
    var plot = ch.type === 'line'
      ? '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' + ser + '<c:marker val="1"/><c:axId val="111"/><c:axId val="222"/></c:lineChart>'
      : '<c:barChart><c:barDir val="' + (ch.horizontal ? 'bar' : 'col') + '"/><c:grouping val="clustered"/><c:varyColors val="0"/>' + ser + '<c:gapWidth val="60"/><c:axId val="111"/><c:axId val="222"/></c:barChart>';
    var axes = '<c:catAx><c:axId val="111"/><c:scaling><c:orientation val="' + (ch.horizontal ? 'maxMin' : 'minMax') + '"/></c:scaling><c:delete val="0"/><c:axPos val="' + (ch.horizontal ? 'l' : 'b') + '"/><c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="222"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>' +
      '<c:valAx><c:axId val="222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="' + (ch.horizontal ? 'b' : 'l') + '"/><c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="E6E2D8"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="' + x(ch.valFormat || '"₹"#,##0') + '" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="111"/><c:crosses val="' + (ch.horizontal ? 'max' : 'autoZero') + '"/><c:crossBetween val="between"/></c:valAx>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="en-IN" sz="1200" b="1"/><a:t>' + x(ch.title) + '</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>' +
      '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' + plot + axes + '</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
      '<c:txPr><a:bodyPr/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Arial"/></a:defRPr></a:pPr><a:endParaRPr lang="en-IN"/></a:p></c:txPr></c:chartSpace>';
  }
  function drawingXml(charts) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      charts.map(function (ch, i) {
        var a = ch.anchor;
        return '<xdr:twoCellAnchor><xdr:from><xdr:col>' + a.col + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + a.row + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>' + (a.col + a.cols) + '</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>' + (a.row + a.rows) + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
          '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="' + (i + 2) + '" name="Chart ' + (i + 1) + '"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
          '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId' + (i + 1) + '"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>';
      }).join('') + '</xdr:wsDr>';
  }

  /* wb = { sheets:[{name, rows, widths, freeze, filter, charts:[...]}], title } → Uint8Array */
  function build(wb) {
    var files = [], ct = [], wbRels = [], chartNo = 0, drawNo = 0;
    wb.sheets.forEach(function (sh, i) {
      var n = i + 1, drawingRid = null;
      if (sh.charts && sh.charts.length) {
        drawNo++; drawingRid = 'rId1';
        files.push({ name: 'xl/worksheets/_rels/sheet' + n + '.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing' + drawNo + '.xml"/></Relationships>' });
        var rels = sh.charts.map(function (ch, k) {
          chartNo++;
          files.push({ name: 'xl/charts/chart' + chartNo + '.xml', data: chartXml(ch, wb) });
          ct.push('<Override PartName="/xl/charts/chart' + chartNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>');
          return '<Relationship Id="rId' + (k + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart' + chartNo + '.xml"/>';
        }).join('');
        files.push({ name: 'xl/drawings/drawing' + drawNo + '.xml', data: drawingXml(sh.charts) });
        files.push({ name: 'xl/drawings/_rels/drawing' + drawNo + '.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>' });
        ct.push('<Override PartName="/xl/drawings/drawing' + drawNo + '.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>');
      }
      files.push({ name: 'xl/worksheets/sheet' + n + '.xml', data: sheetXml(sh, drawingRid) });
      ct.push('<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
      wbRels.push('<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>');
    });
    var nS = wb.sheets.length;
    wbRels.push('<Relationship Id="rId' + (nS + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    files.unshift(
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + ct.join('') + '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + x(wb.title || 'Report') + '</dc:title><dc:creator>Athulyam Homes Guest Manager</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + 'Z</dcterms:created></cp:coreProperties>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' + wb.sheets.map(function (s, i) { return '<sheet name="' + x(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wbRels.join('') + '</Relationships>' },
      { name: 'xl/styles.xml', data: stylesXml() }
    );
    return zip(files);
  }

  /* Analytics report workbook. cur/cmp = AH.analytics(...) results (cmp may be null). meta = {business, label, cmpLabel, channelsLabel, generated, bookingRows, queryRows} */
  function report(cur, cmp, meta) {
    function ch(a, b) { return b === null || b === undefined || a === null ? '' : (b ? { v: Math.round((a - b) / Math.abs(b) * 1000) / 1000, s: 'change' } : ''); }
    function m(v) { return v === null || v === undefined ? '' : { v: v, s: 'money' }; }
    function pc(v) { return v === null || v === undefined ? '' : { v: Math.round(v * 10) / 1000, s: 'pct' }; }
    function n(v) { return v === null || v === undefined ? '' : { v: v, s: 'int' }; }
    var c2 = cmp || {};
    var H = function (arr) { return arr.map(function (t) { return { v: t, s: 'header' }; }); };
    var metrics = [
      ['Gross revenue (after discounts & coupons, excl. GST)', 'gross', m], ['Net revenue after commission', 'net', m], ['Room revenue', 'room', m], ['Food revenue', 'food', m],
      ['Other charges & fees', 'other', m], ['Discounts given', 'discount', m], ['Coupons given', 'coupon', m], ['GST billed', 'gst', m], ['Platform commission', 'commission', m],
      ['Money collected', 'collected', m], ['Expenses (all channels only)', 'expenses', m], ['Profit (all channels only)', 'profit', m],
      ['Bookings (arrivals)', 'bookings', n], ['Cancellations', 'cancellations', n], ['Room nights sold', 'nights', n], ['Occupancy', 'occupancyPct', pc],
      ['Average room rate per night', 'adr', m], ['Average revenue per room night', 'perNight', m], ['Queries received', 'queries', n], ['Queries converted', 'converted', n],
      ['Query conversion', 'conversionPct', pc], ['Bookings with a coupon', 'couponsUsed', n]
    ];
    var sum = [[{ v: (meta.business || 'Athulyam Homes') + ' — Performance report', s: 'title' }], [{ v: 'Period: ' + meta.label + ' (' + cur.from + ' to ' + cur.to + ')' + (cmp ? '   ·   Compared with: ' + meta.cmpLabel + ' (' + cmp.from + ' to ' + cmp.to + ')' : ''), s: 'note' }],
      [{ v: 'Channels: ' + meta.channelsLabel + '   ·   Generated ' + meta.generated, s: 'note' }], [],
      H(['Measure', 'This period'].concat(cmp ? ['Comparison', 'Change'] : []))];
    metrics.forEach(function (mt) { sum.push([{ v: mt[0], s: 'bold' }, mt[2](cur[mt[1]])].concat(cmp ? [mt[2](c2[mt[1]]), ch(cur[mt[1]], c2[mt[1]])] : [])); });
    sum.push([], [{ v: 'Revenue is counted per night stayed in the period; money collected is counted on the day it was received. GST is never counted as revenue. Coupons and discounts come off before GST.', s: 'note' }]);

    var chans = {};
    Object.keys(cur.byChannel).forEach(function (k) { chans[k] = 1; }); if (cmp) Object.keys(c2.byChannel).forEach(function (k) { chans[k] = 1; });
    var names = Object.keys(chans).sort(function (a, b) { return ((cur.byChannel[b] || {}).taxable || 0) - ((cur.byChannel[a] || {}).taxable || 0); });
    var byc = [H(['Channel', 'Gross revenue', 'Net after commission', 'Room nights', 'Bookings', 'Queries', 'Converted', 'Conversion', 'Coupons'].concat(cmp ? ['Gross (comparison)', 'Net (comparison)', 'Bookings (comparison)', 'Conversion (comparison)', 'Gross change'] : []))];
    names.forEach(function (k) {
      var a = cur.byChannel[k] || {}, b = c2.byChannel ? (c2.byChannel[k] || {}) : {};
      byc.push([{ v: k, s: 'bold' }, m(a.taxable || 0), m(a.net || 0), n(a.nights || 0), n(a.bookings || 0), n(a.queries || 0), n(a.converted || 0), a.queries ? pc(a.conversionPct) : '', m(a.coupon || 0)]
        .concat(cmp ? [m(b.taxable || 0), m(b.net || 0), n(b.bookings || 0), b.queries ? pc(b.conversionPct) : '', ch(a.taxable || 0, b.taxable || 0)] : []));
    });
    var trend = [H(['#', 'This period (' + cur.series.unit + ')', 'Gross revenue'].concat(cmp ? ['Comparison (' + c2.series.unit + ')', 'Gross revenue (comparison)'] : []))];
    var len = Math.max(cur.series.points.length, cmp ? c2.series.points.length : 0);
    for (var i = 0; i < len; i++) {
      var p = cur.series.points[i], q = cmp ? c2.series.points[i] : null;
      trend.push([n(i + 1), p ? p.key : '', p ? m(p.taxable) : ''].concat(cmp ? [q ? q.key : '', q ? m(q.taxable) : ''] : []));
    }
    var nc = names.length;
    var chartsSheet = { name: 'Charts', rows: [[{ v: 'Charts — ' + meta.label + (cmp ? ' vs ' + meta.cmpLabel : ''), s: 'title' }], [{ v: 'The charts read their numbers from the "By channel" and "Trend" sheets.', s: 'text' }]], widths: [12], charts: [] };
    if (nc) chartsSheet.charts.push({ sheet: 'By channel', type: 'bar', horizontal: true, title: 'Gross revenue by channel', cat: { c: 0, r1: 1, r2: nc }, series: [{ name: 'This period', c: 1, r1: 1, r2: nc, color: '1E3A2B' }].concat(cmp ? [{ name: 'Comparison', c: 9, r1: 1, r2: nc, color: 'B8955A' }] : []), anchor: { col: 0, row: 3, cols: 9, rows: Math.max(14, nc * 2 + 6) } });
    if (len) chartsSheet.charts.push({ sheet: 'Trend', type: 'line', title: 'Gross revenue over time', cat: { c: 0, r1: 1, r2: len }, series: [{ name: 'This period', c: 2, r1: 1, r2: len, color: '1E3A2B' }].concat(cmp ? [{ name: 'Comparison', c: 4, r1: 1, r2: len, color: 'B8955A' }] : []), anchor: { col: 0, row: 4 + Math.max(14, nc * 2 + 6), cols: 9, rows: 16 } });
    if (nc) chartsSheet.charts.push({ sheet: 'By channel', type: 'bar', horizontal: true, title: 'Bookings by channel', valFormat: '0', cat: { c: 0, r1: 1, r2: nc }, series: [{ name: 'This period', c: 4, r1: 1, r2: nc, color: '1E3A2B' }].concat(cmp ? [{ name: 'Comparison', c: 11, r1: 1, r2: nc, color: 'B8955A' }] : []), anchor: { col: 0, row: 6 + Math.max(14, nc * 2 + 6) + 16, cols: 9, rows: Math.max(12, nc * 2 + 6) } });
    var sheets = [
      { name: 'Summary', rows: sum, widths: [52, 16].concat(cmp ? [16, 11] : []), freeze: 5 },
      chartsSheet,
      { name: 'By channel', rows: byc, widths: [18, 15, 15, 11, 10, 10, 10, 11, 11, 16, 16, 14, 14, 12], freeze: 1, filter: 'A1:' + col(byc[0].length - 1) + Math.max(1, byc.length) },
      { name: 'Trend', rows: trend, widths: [5, 20, 16, 20, 16], freeze: 1 }
    ];
    if (meta.bookingRows) sheets.push({ name: 'Bookings', rows: [H(meta.bookingRows[0])].concat(meta.bookingRows.slice(1)), widths: meta.bookingRows[0].map(function () { return 14; }), freeze: 1, filter: 'A1:' + col(meta.bookingRows[0].length - 1) + meta.bookingRows.length });
    if (meta.queryRows) sheets.push({ name: 'Queries', rows: [H(meta.queryRows[0])].concat(meta.queryRows.slice(1)), widths: meta.queryRows[0].map(function () { return 14; }), freeze: 1, filter: 'A1:' + col(meta.queryRows[0].length - 1) + meta.queryRows.length });
    return build({ title: (meta.business || 'Athulyam Homes') + ' report ' + cur.from + ' to ' + cur.to, sheets: sheets });
  }
  return { build: build, report: report, col: col, crc32: crc32 };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AHXlsx;
