// admin.js — ChessTrophies admin dashboard logic.
//
// This used to be a ~1150-line INLINE <script> in admin.html, which made a real
// CSP impossible (admin.html renders user PII — emails, IPs, payment state — and
// shipped with NO Content-Security-Policy at all). Externalizing it verbatim lets
// admin.html declare the same script-src 'self' policy index.html uses.
// Classic <script> (no modules, no imports) so it behaves exactly as the inline
// block did. Loaded with defer at the end of <body>.
(function () {
  'use strict';
  var KEY_STORE = 'ct_admin_key';

  // ----- elements -----
  var $ = function (id) { return document.getElementById(id); };
  var keyEl = $('key'), gateKeyEl = $('gateKey'), gateEl = $('gate'), gateMsgEl = $('gateMsg');
  var dashEl = $('dash'), topControls = $('topControls');
  var errEl = $('err'), updEl = $('upd'), autoBtn = $('auto');
  var kpisEl = $('kpis'), tipEl = $('tip');
  var revBadge = $('revBadge'), revMini = $('revMini'), revChart = $('revChart');
  var payList = $('payList'), signupChart = $('signupChart'), gamesChart = $('gamesChart');
  var sharesEl = $('shares'), sharesSub = $('sharesSub');
  var engageTiles = $('engageTiles'), puzzleTiles = $('puzzleTiles');
  var todayTiles = $('todayTiles'), todaySub = $('todaySub');
  var funnelBody = $('funnelBody'), funnelSub = $('funnelSub');
  var topEventsBody = $('topEventsBody'), dailyChart = $('dailyChart');
  var topReferrersBody = $('topReferrersBody'), topCampaignsBody = $('topCampaignsBody'), sourcesSub = $('sourcesSub');
  var arenaTiles = $('arenaTiles'), arenaSub = $('arenaSub'), arenaChamps = $('arenaChamps');
  var seasonBadge = $('seasonBadge'), seasonSub = $('seasonSub'), seasonBody = $('seasonBody');
  var fearedSub = $('fearedSub'), fearedBody = $('fearedBody');
  var qEl = $('q'), sortEl = $('sort'), limitEl = $('limit');
  var usersErr = $('usersErr'), usersCount = $('usersCount'), usersBody = $('usersBody'), copyMsg = $('copyMsg');

  var timer = null, qTimer = null, currentUsers = [], lastStats = null, hasLoaded = false;

  // ----- key handling: ?key= bootstraps once, else localStorage -----
  //
  // SECURITY: the admin key is a bearer credential. It must NEVER travel in a URL
  // — query strings land in server access logs, proxy logs, browser history and
  // (for any navigation) the Referer header. Every API call below now sends it as
  // the X-Admin-Key REQUEST HEADER instead (see headers()).
  //
  // A ?key=… on the initial page load is still accepted as a one-time bootstrap
  // (that is how the dashboard is opened), but we immediately stash it in
  // localStorage and STRIP it from the address bar with history.replaceState so it
  // does not stay in the session history or get sent as a Referer.
  (function initKey() {
    var fromUrl = '';
    try {
      var p = new URLSearchParams(window.location.search);
      fromUrl = (p.get('key') || '').trim();
    } catch (e) {}
    var stored = '';
    try { stored = localStorage.getItem(KEY_STORE) || ''; } catch (e) {}
    var k = fromUrl || stored;
    keyEl.value = k;
    gateKeyEl.value = k;
    if (fromUrl) {
      try { localStorage.setItem(KEY_STORE, fromUrl); } catch (e) {}
      // Scrub ?key= out of the visible URL + history entry.
      try {
        var url = new URL(window.location.href);
        url.searchParams.delete('key');
        window.history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || ''));
      } catch (e) {}
    }
  })();

  var currentDays = 30; // rolling window for windowed blocks; set by the range buttons
  function getKey() { return (keyEl.value || '').trim(); }
  // The ONE place the credential is attached to a request.
  function headers() { return { 'x-admin-key': getKey() }; }
  function statsUrl() { return '/api/admin/stats?days=' + currentDays; }
  function exportUrl(type) { return '/api/admin/export?type=' + encodeURIComponent(type) + '&days=' + currentDays; }
  function usersUrl(params) { return '/api/admin/users?' + params.toString(); }

  // ----- formatters -----
  function esc(s) { var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
  function num(n) { if (n == null || n === '') return '–'; var x = Number(n); return isNaN(x) ? esc(n) : x.toLocaleString(); }
  function compact(n) {
    var x = Number(n); if (isNaN(x)) return '–';
    try { return new Intl.NumberFormat(undefined, { notation:'compact', maximumFractionDigits:1 }).format(x); }
    catch (e) { return x.toLocaleString(); }
  }
  function money(cents, currency) {
    var n = Number(cents); if (isNaN(n)) return '–';
    var cur = (currency || 'usd').toUpperCase();
    try { return new Intl.NumberFormat(undefined, { style:'currency', currency:cur, maximumFractionDigits:(Math.abs(n)>=100000?0:2) }).format(n/100); }
    catch (e) { return '$' + (n/100).toFixed(2); }
  }
  function moneyCompact(cents, currency) {
    var n = Number(cents); if (isNaN(n)) return '–';
    var cur = (currency || 'usd').toUpperCase();
    try { return new Intl.NumberFormat(undefined, { style:'currency', currency:cur, notation:'compact', maximumFractionDigits:1 }).format(n/100); }
    catch (e) { return '$' + (n/100).toFixed(0); }
  }
  function toDate(ms) {
    if (ms == null || ms === '') return null;
    var v = Number(ms);
    if (!isNaN(v)) { var d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    var d2 = new Date(ms); return isNaN(d2.getTime()) ? null : d2;
  }
  function fmtDateTime(ms) { var d = toDate(ms); return d ? d.toLocaleString() : '—'; }
  function fmtDateShort(ms) { var d = toDate(ms); return d ? d.toLocaleDateString() : '—'; }
  function ago(ms) {
    var d = toDate(ms); if (!d) return null;
    var s = Math.floor((Date.now() - d.getTime())/1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago';
    return Math.floor(s/86400) + 'd ago';
  }

  // ===================================================================
  //  KPI CARDS
  // ===================================================================
  function rev(s) { return (s && s.revenue) || {}; }
  function pick() { // first non-null arg
    for (var i = 0; i < arguments.length; i++) if (arguments[i] != null) return arguments[i];
    return null;
  }

  function renderKpis(s) {
    s = s || {};
    var r = rev(s);
    var cur = r.currency || s.currency || 'usd';
    var allTime = pick(r.allTimeCents, s.revenueAllTimeCents);
    var mrr = pick(r.mrrCents);
    var subs = pick(r.activeSubscribers, s.activeSubscribers);
    var arpu = pick(r.arpuCents);

    var ser = s.series || {};
    var cards = [
      { ic:'💰', label:'Revenue · all-time', val: allTime != null ? money(allTime, cur) : '–',
        c:'var(--green)', b:'rgba(84,224,154,.14)', g:'rgba(84,224,154,.12)',
        spark: sparkVals(r.dailyCents),
        sub: r.source ? null : (s.revenueMonthCents != null ? 'this month ' + moneyCompact(s.revenueMonthCents, cur) : null) },
      { ic:'🔁', label:'MRR', val: mrr != null ? money(mrr, cur) : '–',
        c:'var(--teal)', b:'rgba(79,214,200,.14)', g:'rgba(79,214,200,.12)',
        sub: arpu != null ? 'ARPU ' + money(arpu, cur) : null },
      { ic:'⭐', label:'Active subscribers', val: subs != null ? num(subs) : '–',
        c:'var(--accent)', b:'rgba(245,196,81,.14)', g:'rgba(245,196,81,.12)',
        sub: s.premiumUsers != null ? num(s.premiumUsers) + ' premium total' : null },
      { ic:'💎', label:'Premium users', val: num(s.premiumUsers),
        c:'var(--purple)', b:'rgba(169,139,255,.14)', g:'rgba(169,139,255,.12)',
        sub: (s.verifiedUsers != null) ? num(s.verifiedUsers) + ' verified' : null },
      { ic:'👥', label:'Total users', val: num(s.totalUsers),
        c:'var(--blue)', b:'rgba(90,166,255,.14)', g:'rgba(90,166,255,.12)',
        spark: sparkVals(ser.signupsDaily, 'count'),
        delta: deltaText(s.newUsers24h, s.newUsers7d) },
      { ic:'🟢', label:'Online now', val: num(s.onlineNow),
        c:'var(--green)', b:'rgba(84,224,154,.14)', g:'rgba(84,224,154,.12)',
        sub: (s.activeUsers24h != null) ? num(s.activeUsers24h) + ' active · 24h' : null },
      { ic:'♟', label:'Games total', val: num(s.gamesTotal),
        c:'var(--pink)', b:'rgba(255,134,194,.14)', g:'rgba(255,134,194,.12)',
        spark: sparkVals(ser.gamesDaily, 'count'),
        sub: (s.games24h != null) ? '+' + num(s.games24h) + ' · 24h' : null }
    ];

    kpisEl.innerHTML = cards.map(function (c) {
      var subHtml = '';
      if (c.delta) subHtml = '<div class="sub">' + c.delta + '</div>';
      else if (c.sub) subHtml = '<div class="sub"><span class="delta dim">' + esc(c.sub) + '</span></div>';
      var sparkHtml = '';
      if (c.spark && c.spark.length > 1) {
        var tp = trendPct(c.spark);
        var chip = (tp == null) ? '' : '<span class="tchip ' + (tp >= 0 ? 'up' : 'dn') + '">' + (tp >= 0 ? '▲' : '▼') + ' ' + Math.abs(tp) + '%</span>';
        sparkHtml = '<div class="spark">' + sparkSvg(c.spark) + chip + '</div>';
      }
      return '<div class="kpi" style="--_c:' + c.c + ';--_b:' + c.b + ';--_g:' + c.g + '">' +
        '<div class="top"><span class="label">' + esc(c.label) + '</span>' +
        '<span class="ic">' + c.ic + '</span></div>' +
        '<div class="val">' + c.val + '</div>' + subHtml + sparkHtml + '</div>';
    }).join('');
  }
  // KPI sparkline helpers.
  function sparkVals(arr, key) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (x) { return key ? (Number(x[key]) || 0) : (Number(x) || 0); });
  }
  function sparkSvg(vals) {
    if (!vals || vals.length < 2) return '';
    var W = 120, H = 30, pad = 2;
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals); var span = (max - min) || 1;
    var pts = vals.map(function (v, i) {
      var x = pad + i / (vals.length - 1) * (W - 2 * pad);
      var y = pad + (1 - (v - min) / span) * (H - 2 * pad);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    return '<svg class="sparksvg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><polyline points="' + pts.join(' ') + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }
  function trendPct(vals) {
    if (!vals || vals.length < 4) return null;
    var mid = Math.floor(vals.length / 2); var a = 0, b = 0;
    for (var i = 0; i < mid; i++) a += vals[i];
    for (var j = mid; j < vals.length; j++) b += vals[j];
    if (a <= 0) return b > 0 ? 100 : null;
    return Math.round((b - a) / a * 100);
  }
  function deltaText(d24, d7) {
    var parts = [];
    if (d24 != null) parts.push('<span class="delta">▲ ' + num(d24) + ' · 24h</span>');
    if (d7 != null) parts.push('<span class="delta dim">' + num(d7) + ' · 7d</span>');
    return parts.length ? '<div class="sub">' + parts.join('') + '</div>' : '';
  }

  // ===================================================================
  //  CHART HELPERS (inline SVG, no libs)
  // ===================================================================
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function showTip(html, x, y) { tipEl.innerHTML = html; tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; tipEl.classList.add('show'); }
  function hideTip() { tipEl.classList.remove('show'); }

  function emptyChart(host, msg) { host.innerHTML = '<div class="chart-empty">' + esc(msg || 'No data yet') + '</div>'; }

  // Bar chart. data = [{label, value, tipLabel}], opts {color, fmt}
  function barChart(host, data, opts) {
    host.innerHTML = '';
    opts = opts || {};
    if (!data || !data.length) { emptyChart(host); return; }
    var W = 720, H = 200, padL = 44, padR = 12, padT = 12, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = 0; data.forEach(function (d) { if (d.value > max) max = d.value; });
    if (max <= 0) max = 1;
    var niceMax = niceCeil(max);
    var svg = svgEl('svg', { viewBox:'0 0 ' + W + ' ' + H, class:'chart', preserveAspectRatio:'none', width:'100%', height:H });
    svg.removeAttribute('preserveAspectRatio');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', '100%'); svg.setAttribute('height', String(H));
    if (opts.color) svg.style.setProperty('--_bar', opts.color);

    // gridlines + y labels
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var yv = niceMax * t / ticks;
      var y = padT + ih - (yv / niceMax) * ih;
      svg.appendChild(svgEl('line', { class:'grid', x1:padL, y1:y, x2:W - padR, y2:y }));
      var lbl = svgEl('text', { x:padL - 6, y:y + 3, 'text-anchor':'end' });
      lbl.textContent = opts.fmtAxis ? opts.fmtAxis(yv) : compact(yv);
      svg.appendChild(lbl);
    }
    // x axis
    svg.appendChild(svgEl('line', { class:'axis', x1:padL, y1:padT + ih, x2:W - padR, y2:padT + ih }));

    var n = data.length;
    var slot = iw / n;
    var bw = Math.max(2, Math.min(slot * 0.62, 26));
    data.forEach(function (d, i) {
      var x = padL + i * slot + (slot - bw) / 2;
      var h = (d.value / niceMax) * ih;
      var y = padT + ih - h;
      var rect = svgEl('rect', { class:'bar', x:x, y:y, width:bw, height:Math.max(0, h), rx:Math.min(3, bw/2) });
      svg.appendChild(rect);
      // wide invisible hit area for easy hover
      var hit = svgEl('rect', { class:'hit', x:padL + i*slot, y:padT, width:slot, height:ih });
      (function (d) {
        function onMove(ev) {
          var label = d.tipLabel != null ? d.tipLabel : d.label;
          showTip('<b>' + esc(opts.fmtVal ? opts.fmtVal(d.value) : d.value) + '</b><br>' + esc(label), ev.clientX, ev.clientY);
        }
        hit.addEventListener('mousemove', onMove);
        hit.addEventListener('mouseleave', hideTip);
        hit.addEventListener('touchstart', function (ev) { if (ev.touches && ev.touches[0]) onMove(ev.touches[0]); }, { passive:true });
      })(d);
      svg.appendChild(hit);
    });

    // sparse x labels (first, mid, last)
    addXLabels(svg, data, padL, slot, padT + ih + 14);
    host.appendChild(svg);
  }

  // Grouped bar chart: two series side-by-side per slot.
  // data = [{label, tipLabel, a, b}]; opts {colorA, colorB, nameA, nameB, fmtVal}
  function groupedBarChart(host, data, opts) {
    host.innerHTML = '';
    opts = opts || {};
    if (!data || !data.length) { emptyChart(host); return; }
    var W = 720, H = 200, padL = 44, padR = 12, padT = 12, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = 0;
    data.forEach(function (d) {
      var a = Number(d.a) || 0, b = Number(d.b) || 0;
      if (a > max) max = a; if (b > max) max = b;
    });
    if (max <= 0) max = 1;
    var niceMax = niceCeil(max);
    var svg = svgEl('svg', { class:'chart', width:'100%', height:String(H), viewBox:'0 0 ' + W + ' ' + H });
    if (opts.colorA) svg.style.setProperty('--_bar', opts.colorA);
    if (opts.colorB) svg.style.setProperty('--_bar2', opts.colorB);

    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var yv = niceMax * t / ticks;
      var y = padT + ih - (yv / niceMax) * ih;
      svg.appendChild(svgEl('line', { class:'grid', x1:padL, y1:y, x2:W - padR, y2:y }));
      var lbl = svgEl('text', { x:padL - 6, y:y + 3, 'text-anchor':'end' });
      lbl.textContent = opts.fmtAxis ? opts.fmtAxis(yv) : compact(yv);
      svg.appendChild(lbl);
    }
    svg.appendChild(svgEl('line', { class:'axis', x1:padL, y1:padT + ih, x2:W - padR, y2:padT + ih }));

    var n = data.length;
    var slot = iw / n;
    var gw = Math.max(2, Math.min(slot * 0.30, 13));
    var gap = Math.min(3, slot * 0.06);
    data.forEach(function (d, i) {
      var av = Number(d.a) || 0, bv = Number(d.b) || 0;
      var groupW = gw * 2 + gap;
      var x0 = padL + i * slot + (slot - groupW) / 2;
      var ah = (av / niceMax) * ih, bh = (bv / niceMax) * ih;
      svg.appendChild(svgEl('rect', { class:'bar', x:x0, y:padT + ih - ah, width:gw, height:Math.max(0, ah), rx:Math.min(2.5, gw/2) }));
      svg.appendChild(svgEl('rect', { class:'bar2', x:x0 + gw + gap, y:padT + ih - bh, width:gw, height:Math.max(0, bh), rx:Math.min(2.5, gw/2) }));
      var hit = svgEl('rect', { class:'hit', x:padL + i*slot, y:padT, width:slot, height:ih });
      (function (d) {
        function onMove(ev) {
          var label = d.tipLabel != null ? d.tipLabel : d.label;
          var av2 = Number(d.a) || 0, bv2 = Number(d.b) || 0;
          var na = opts.nameA || 'A', nb = opts.nameB || 'B';
          showTip('<b>' + esc(label) + '</b><br>' + esc(na) + ': ' + esc(av2.toLocaleString()) +
            '<br>' + esc(nb) + ': ' + esc(bv2.toLocaleString()), ev.clientX, ev.clientY);
        }
        hit.addEventListener('mousemove', onMove);
        hit.addEventListener('mouseleave', hideTip);
        hit.addEventListener('touchstart', function (ev) { if (ev.touches && ev.touches[0]) onMove(ev.touches[0]); }, { passive:true });
      })(d);
      svg.appendChild(hit);
    });

    addXLabels(svg, data, padL, slot, padT + ih + 14);
    host.appendChild(svg);
  }

  // Area/line chart. data = [{label, value, tipLabel}]
  function areaChart(host, data, opts) {
    host.innerHTML = '';
    opts = opts || {};
    if (!data || !data.length) { emptyChart(host); return; }
    var W = 720, H = 220, padL = 52, padR = 14, padT = 14, padB = 26;
    var iw = W - padL - padR, ih = H - padT - padB;
    var max = 0; data.forEach(function (d) { if (d.value > max) max = d.value; });
    if (max <= 0) max = 1;
    var niceMax = niceCeil(max);
    var n = data.length;
    var step = n > 1 ? iw / (n - 1) : 0;
    function X(i) { return padL + i * step; }
    function Y(v) { return padT + ih - (v / niceMax) * ih; }

    var svg = svgEl('svg', { class:'chart', width:'100%', height:String(H), viewBox:'0 0 ' + W + ' ' + H });

    var grad = svgEl('linearGradient', { id:'revGrad', x1:'0', y1:'0', x2:'0', y2:'1' });
    grad.appendChild(svgEl('stop', { offset:'0%', 'stop-color':'#54e09a', 'stop-opacity':'0.35' }));
    grad.appendChild(svgEl('stop', { offset:'100%', 'stop-color':'#54e09a', 'stop-opacity':'0' }));
    var defs = svgEl('defs'); defs.appendChild(grad); svg.appendChild(defs);

    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var yv = niceMax * t / ticks;
      var y = Y(yv);
      svg.appendChild(svgEl('line', { class:'grid', x1:padL, y1:y, x2:W - padR, y2:y }));
      var lbl = svgEl('text', { x:padL - 7, y:y + 3, 'text-anchor':'end' });
      lbl.textContent = opts.fmtAxis ? opts.fmtAxis(yv) : compact(yv);
      svg.appendChild(lbl);
    }

    var linePts = data.map(function (d, i) { return X(i) + ',' + Y(d.value); }).join(' ');
    var areaPts = X(0) + ',' + Y(0) + ' ' + linePts + ' ' + X(n - 1) + ',' + Y(0);
    svg.appendChild(svgEl('polygon', { points:areaPts, fill:'url(#revGrad)' }));
    svg.appendChild(svgEl('polyline', { points:linePts, fill:'none', stroke:'#54e09a', 'stroke-width':'2', 'stroke-linejoin':'round', 'stroke-linecap':'round' }));

    // hover hit columns + a moving dot
    var dot = svgEl('circle', { class:'dot', r:'3.5', cx:-10, cy:-10, fill:'#54e09a', stroke:'#0a0f1c', 'stroke-width':'1.5' });
    dot.style.opacity = '0';
    var slot = n > 1 ? iw / (n - 1) : iw;
    data.forEach(function (d, i) {
      var hx = i === 0 ? padL : X(i) - slot / 2;
      var hw = (i === 0 || i === n - 1) ? slot / 2 : slot;
      var hit = svgEl('rect', { class:'hit', x:Math.max(padL, hx), y:padT, width:Math.max(1, hw), height:ih });
      (function (d, i) {
        function onMove(ev) {
          dot.setAttribute('cx', X(i)); dot.setAttribute('cy', Y(d.value)); dot.style.opacity = '1';
          var label = d.tipLabel != null ? d.tipLabel : d.label;
          showTip('<b>' + esc(opts.fmtVal ? opts.fmtVal(d.value) : d.value) + '</b><br>' + esc(label), ev.clientX, ev.clientY);
        }
        hit.addEventListener('mousemove', onMove);
        hit.addEventListener('mouseleave', function () { hideTip(); dot.style.opacity = '0'; });
        hit.addEventListener('touchstart', function (ev) { if (ev.touches && ev.touches[0]) onMove(ev.touches[0]); }, { passive:true });
      })(d, i);
      svg.appendChild(hit);
    });
    svg.appendChild(dot);

    addXLabels(svg, data, padL, step, padT + ih + 14, true);
    host.appendChild(svg);
  }

  function addXLabels(svg, data, padL, step, y, isLine) {
    var n = data.length;
    var idxs = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
    var seen = {};
    idxs.forEach(function (i) {
      if (seen[i]) return; seen[i] = 1;
      var x = isLine ? (padL + i * step) : (padL + i * step + step / 2);
      var anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
      var t = svgEl('text', { x:x, y:y, 'text-anchor':anchor });
      t.textContent = data[i].label;
      svg.appendChild(t);
    });
  }

  function niceCeil(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log10(v)));
    var norm = v / mag;
    var nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return nice * mag;
  }
  function shortDay(iso) { // 'YYYY-MM-DD' -> 'M/D'
    if (!iso) return '';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    return Number(m[2]) + '/' + Number(m[3]);
  }
  function longDay(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  }

  // ===================================================================
  //  REVENUE PANEL
  // ===================================================================
  function renderRevenue(s) {
    s = s || {};
    var r = rev(s);
    var cur = r.currency || s.currency || 'usd';

    // badge
    if (r.source === 'stripe') revBadge.innerHTML = '<span class="badge live">● Stripe (live)</span>';
    else if (r.source === 'ledger') revBadge.innerHTML = '<span class="badge approx">≈ ledger (approx)</span>';
    else revBadge.innerHTML = '';

    // mini stats
    var month = pick(r.monthCents, s.revenueMonthCents);
    var year = pick(r.yearCents, s.revenueYearCents);
    var allTime = pick(r.allTimeCents, s.revenueAllTimeCents);
    var mini = [];
    if (month != null) mini.push({ l:'This month', v:money(month, cur) });
    if (year != null) mini.push({ l:'This year', v:money(year, cur) });
    if (allTime != null) mini.push({ l:'All-time', v:money(allTime, cur) });
    revMini.innerHTML = mini.map(function (m) {
      return '<div><div class="m-lbl">' + esc(m.l) + '</div><div class="m-val">' + m.v + '</div></div>';
    }).join('');

    // daily chart
    var daily = Array.isArray(r.dailyCents) ? r.dailyCents : null;
    if (daily && daily.length) {
      var data = daily.map(function (d) {
        return { label: shortDay(d && d.date), tipLabel: longDay(d && d.date), value: Number((d && d.cents) || 0) };
      });
      areaChart(revChart, data, {
        fmtAxis: function (c) { return moneyCompact(c, cur); },
        fmtVal: function (c) { return money(c, cur); }
      });
    } else {
      emptyChart(revChart, 'No revenue history yet');
    }

    // recent payments
    renderPayments(r.recentPayments, cur);
  }

  function renderPayments(list, cur) {
    if (!Array.isArray(list) || !list.length) {
      payList.innerHTML = '<div class="chart-empty">No payments yet</div>';
      return;
    }
    payList.innerHTML = list.slice(0, 10).map(function (p) {
      p = p || {};
      var when = ago(p.createdAt) || fmtDateShort(p.createdAt);
      return '<div class="pay">' +
        '<div class="pic">$</div>' +
        '<div class="pmid">' +
          '<div class="plabel">' + esc(p.label || 'Payment') + '</div>' +
          '<div class="pdate">' + esc(when) + '</div>' +
        '</div>' +
        '<div class="pamt">' + money(p.amountCents, p.currency || cur) + '</div>' +
      '</div>';
    }).join('');
  }

  // ===================================================================
  //  SIGNUP / GAMES CHARTS
  // ===================================================================
  function renderSeries(s) {
    var series = (s && s.series) || {};
    var su = Array.isArray(series.signupsDaily) ? series.signupsDaily : null;
    if (su && su.length) {
      barChart(signupChart, su.map(function (d) {
        return { label: shortDay(d && d.date), tipLabel: longDay(d && d.date), value: Number((d && d.count) || 0) };
      }), { color:'var(--blue)', fmtVal:function (v){ return v.toLocaleString() + ' signup' + (v===1?'':'s'); } });
    } else { emptyChart(signupChart, 'No signup history yet'); }

    var gd = Array.isArray(series.gamesDaily) ? series.gamesDaily : null;
    if (gd && gd.length) {
      barChart(gamesChart, gd.map(function (d) {
        return { label: shortDay(d && d.date), tipLabel: longDay(d && d.date), value: Number((d && d.count) || 0) };
      }), { color:'var(--pink)', fmtVal:function (v){ return v.toLocaleString() + ' game' + (v===1?'':'s'); } });
    } else { emptyChart(gamesChart, 'No game history yet'); }
  }

  // ===================================================================
  //  SHARES PANEL
  // ===================================================================
  var SHARE_ICON = { x:'𝕏', facebook:'f', whatsapp:'☎', reddit:'👽', telegram:'✈', copy:'⧉', native:'⤴', other:'•' };
  function renderShares(s) {
    var sh = s && s.shares;
    if (!sh || !sh.byPlatform || typeof sh.byPlatform !== 'object') {
      sharesEl.innerHTML = '<div class="chart-empty">No shares yet</div>';
      sharesSub.textContent = 'Share breakdown by platform';
      return;
    }
    var entries = Object.keys(sh.byPlatform).map(function (k) {
      return { platform:k, count:Number(sh.byPlatform[k]) || 0 };
    }).filter(function (e) { return e.count > 0; });
    if (!entries.length) {
      sharesEl.innerHTML = '<div class="chart-empty">No shares yet</div>';
      sharesSub.textContent = 'Share breakdown by platform';
      return;
    }
    entries.sort(function (a, b) { return b.count - a.count; });
    var total = (sh.total != null) ? Number(sh.total) : entries.reduce(function (t, e) { return t + e.count; }, 0);
    var max = entries[0].count;
    sharesSub.textContent = total.toLocaleString() + ' total shares · top: ' + entries[0].platform;
    sharesEl.innerHTML = entries.map(function (e, i) {
      var pct = max > 0 ? Math.round((e.count / max) * 100) : 0;
      var ic = SHARE_ICON[e.platform] || '•';
      return '<div class="shares-row' + (i === 0 ? ' top' : '') + '">' +
        '<span class="pf"><span class="faint">' + esc(ic) + '</span> ' + esc(e.platform) + '</span>' +
        '<span class="barfill"><i style="width:' + pct + '%"></i></span>' +
        '<span class="cnt">' + e.count.toLocaleString() + '</span></div>';
    }).join('');
  }

  // ===================================================================
  //  ENGAGEMENT TILES (games breakdown + push reach)
  // ===================================================================
  function tileHtml(label, val, color) {
    return '<div class="tile"><div class="t-lbl">' + esc(label) + '</div>' +
      '<div class="t-val' + (color ? ' ' + color : '') + '">' + val + '</div></div>';
  }
  function renderEngagement(s) {
    s = s || {};
    var gb = s.gamesBreakdown || {};
    var ps = s.pushStats || {};
    var tiles = [
      tileHtml('Ranked games', num(pick(gb.ranked, 0)), 'green'),
      tileHtml('Casual games', num(pick(gb.casual, 0)), 'blue'),
      tileHtml('Push subscribers', num(pick(ps.subscribers, 0)), 'teal'),
      tileHtml('Push subscriptions', num(pick(ps.subscriptions, 0)), 'purple')
    ];
    engageTiles.innerHTML = tiles.join('');
  }

  // ===================================================================
  //  SEASON PANEL
  // ===================================================================
  function renderSeason(s) {
    var se = (s && s.season) || {};
    seasonBadge.innerHTML = se.seasonId ? '<span class="badge">' + esc(se.seasonId) + '</span>' : '';
    var players = Number(pick(se.players, 0)) || 0;
    seasonSub.textContent = 'Current monthly ladder · ' + players.toLocaleString() + ' player' + (players === 1 ? '' : 's');
    var top = Array.isArray(se.top) ? se.top : [];
    if (!top.length) { seasonBody.innerHTML = '<div class="chart-empty">No season games yet</div>'; return; }
    var rows = top.map(function (p, i) {
      p = p || {};
      var wld = num(pick(p.wins, 0)) + '–' + num(pick(p.losses, 0)) + '–' + num(pick(p.draws, 0));
      return '<tr>' +
        '<td class="rk num">' + (i + 1) + '</td>' +
        '<td class="nm">' + esc(p.username || '—') + '</td>' +
        '<td class="pts num">' + num(pick(p.points, 0)) + '</td>' +
        '<td class="wld num">' + esc(wld) + '</td>' +
      '</tr>';
    }).join('');
    seasonBody.innerHTML = '<table class="stand"><thead><tr>' +
      '<th>#</th><th>Player</th><th style="text-align:right;">Pts</th><th style="text-align:right;">W–L–D</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // ===================================================================
  //  MOST FEARED PANEL (Victim Wall)
  // ===================================================================
  function renderFeared(s) {
    var f = (s && s.feared) || {};
    var victims = Number(pick(f.totalVictims, 0)) || 0;
    fearedSub.textContent = 'Top live streaks · ' + victims.toLocaleString() + ' victim' + (victims === 1 ? '' : 's') + ' recorded';
    var top = Array.isArray(f.top) ? f.top : [];
    if (!top.length) { fearedBody.innerHTML = '<div class="chart-empty">No active streaks</div>'; return; }
    var rows = top.map(function (p, i) {
      p = p || {};
      return '<tr>' +
        '<td class="rk num">' + (i + 1) + '</td>' +
        '<td class="nm">' + esc(p.username || '—') + '</td>' +
        '<td class="fire num">🔥 ' + num(pick(p.streak, 0)) + '</td>' +
      '</tr>';
    }).join('');
    fearedBody.innerHTML = '<table class="stand"><thead><tr>' +
      '<th>#</th><th>Player</th><th style="text-align:right;">Streak</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // ===================================================================
  //  PUZZLES PANEL
  // ===================================================================
  function renderPuzzles(s) {
    var p = (s && s.puzzleStats) || {};
    var tiles = [
      tileHtml('Avg rating', num(pick(p.avgRating, 0)), 'accent'),
      tileHtml('Rated players', num(pick(p.players, 0)), 'blue'),
      tileHtml('Total solved', num(pick(p.totalSolved, 0)), 'green'),
      tileHtml('Solved today', num(pick(p.solvedToday, 0)), 'teal'),
      tileHtml('Rush plays', num(pick(p.rushPlays, 0)), 'purple'),
      tileHtml('Rush best', num(pick(p.rushBest, 0)), 'pink')
    ];
    puzzleTiles.innerHTML = tiles.join('');
  }

  function renderArena(s) {
    var a = (s && s.arena) || {};
    var live = a.live || null;
    if (arenaSub) {
      arenaSub.textContent = live
        ? ('LIVE: ' + (live.name || 'Arena') + ' · ' + num(pick(live.players, 0)) + ' playing')
        : (a.enabled === false ? 'Arenas disabled' : 'No arena live right now');
    }
    if (arenaTiles) {
      arenaTiles.innerHTML = [
        tileHtml('Arenas run', num(pick(a.totalArenas, 0)), 'accent'),
        tileHtml('Games scored', num(pick(a.totalGamesScored, 0)), 'green'),
        tileHtml('Participants', num(pick(a.participants, 0)), 'blue'),
        tileHtml('Live players', num(live ? pick(live.players, 0) : 0), 'teal')
      ].join('');
    }
    if (arenaChamps) {
      var champs = a.recentChampions || [];
      arenaChamps.innerHTML = champs.length
        ? ('<table class="stand"><thead><tr><th>Recent arena</th><th>Champion</th></tr></thead><tbody>' +
            champs.map(function (c) { return '<tr><td class="nm">' + esc(c.name) + '</td><td>' + esc(c.champion) + '</td></tr>'; }).join('') +
            '</tbody></table>')
        : '';
    }
  }

  // ===================================================================
  //  PRODUCT ANALYTICS  (funnel · today · daily activity · top events)
  // ===================================================================
  function pctTxt(part, whole) {
    var p = Number(part), w = Number(whole);
    if (!isFinite(p) || !isFinite(w) || w <= 0) return '–';
    return (Math.round((p / w) * 1000) / 10).toLocaleString() + '%';
  }

  function renderToday(s) {
    var a = (s && s.analytics) || {};
    var td = a.today || {};
    var ret = a.returning || {};
    var visT = Number(pick(td.visitors, 0)) || 0;
    var retT = Number(pick(ret.returningToday, 0)) || 0;
    var retOf = Number(pick(ret.visitorsToday, visT, 0)) || 0;
    var retPct = retOf > 0 ? pctTxt(retT, retOf) : '–';
    if (todaySub) {
      todaySub.textContent = (a.today || a.returning)
        ? 'Live visitor activity · since midnight'
        : 'No analytics data yet';
    }
    // Returning tile: % of today's visitors who are returning, with the raw count.
    var retVal = retPct + (retT ? ' <span style="font-size:12px;color:var(--faint);font-weight:600;">(' + num(retT) + ')</span>' : '');
    var tiles = [
      tileHtml('Visitors today', num(pick(td.visitors, 0)), 'blue'),
      tileHtml('Games started today', num(pick(td.plays, 0)), 'teal'),
      tileHtml('Sign-ups today', num(pick(td.signups, 0)), 'green'),
      tileHtml('Returning today', retVal, 'accent')
    ];
    todayTiles.innerHTML = tiles.join('');
  }

  function renderFunnel(s) {
    var a = (s && s.analytics) || {};
    var stages = Array.isArray(a.funnel) ? a.funnel.filter(function (x) { return x != null; }) : [];
    if (!stages.length) {
      funnelBody.innerHTML = '<div class="chart-empty">No funnel data yet</div>';
      if (funnelSub) funnelSub.textContent = 'Distinct visitors per stage · last 30 days';
      return;
    }
    var top = Number(pick(stages[0].visitors, 0)) || 0;
    if (funnelSub) {
      funnelSub.textContent = top > 0
        ? top.toLocaleString() + ' landed · ' + pctTxt(pick(stages[stages.length - 1].visitors, 0), top) + ' reached the end'
        : 'Distinct visitors per stage · last 30 days';
    }
    funnelBody.innerHTML = stages.map(function (st, i) {
      st = st || {};
      var v = Number(pick(st.visitors, 0)) || 0;
      var prev = i > 0 ? (Number(pick(stages[i - 1].visitors, 0)) || 0) : v;
      var widthPct = top > 0 ? Math.max(0.5, (v / top) * 100) : 0;
      var convPrev = i > 0 ? pctTxt(v, prev) : '100%';
      var lostPrev = (i > 0 && prev > 0) ? (prev - v) : 0;
      var dropHtml = '';
      if (i > 0) {
        if (lostPrev > 0) {
          dropHtml = '<span class="drop">▼ ' + pctTxt(lostPrev, prev) + ' lost (−' + num(lostPrev) + ')</span>';
        } else {
          dropHtml = '<span class="ok">▲ no drop-off</span>';
        }
      }
      var overall = '<span class="ov">' + pctTxt(v, top) + ' of landed</span>';
      var convPill = i === 0
        ? '<span class="ok">100% · entry</span>'
        : '<span class="ok">' + convPrev + ' vs prev</span>';
      return '<div class="fn-row">' +
        '<div class="fn-head">' +
          '<span class="fn-stage">' + esc(pick(st.stage, st.key, 'Stage ' + (i + 1))) + '</span>' +
          '<span class="fn-vis"><b>' + num(v) + '</b> visitors</span>' +
        '</div>' +
        '<div class="fn-track"><div class="fn-fill" style="width:' + widthPct.toFixed(1) + '%"></div></div>' +
        '<div class="fn-conv">' + convPill + dropHtml + overall + '</div>' +
      '</div>';
    }).join('');
  }

  function renderDailyActivity(s) {
    var a = (s && s.analytics) || {};
    var daily = Array.isArray(a.daily) ? a.daily : null;
    if (!daily || !daily.length) { emptyChart(dailyChart, 'No daily activity yet'); return; }
    var data = daily.map(function (d) {
      d = d || {};
      return {
        label: shortDay(d.date), tipLabel: longDay(d.date),
        a: Number(pick(d.visitors, 0)) || 0,
        b: Number(pick(d.plays, 0)) || 0
      };
    });
    groupedBarChart(dailyChart, data, {
      colorA:'var(--blue)', colorB:'var(--teal)', nameA:'Visitors', nameB:'Games started'
    });
  }

  function renderTopEvents(s) {
    var a = (s && s.analytics) || {};
    var ev = Array.isArray(a.topEvents) ? a.topEvents.filter(function (x) { return x != null; }) : [];
    if (!ev.length) { topEventsBody.innerHTML = '<div class="chart-empty">No events yet</div>'; return; }
    var rows = ev.slice(0, 12).map(function (e, i) {
      e = e || {};
      return '<tr>' +
        '<td class="rk num">' + (i + 1) + '</td>' +
        '<td class="nm">' + esc(pick(e.name, '—')) + '</td>' +
        '<td class="pts num">' + num(pick(e.count, 0)) + '</td>' +
      '</tr>';
    }).join('');
    topEventsBody.innerHTML = '<table class="stand"><thead><tr>' +
      '<th>#</th><th>Event</th><th style="text-align:right;">Count</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // Traffic-source attribution: top referrers (by distinct visitors) + top UTM
  // campaigns, plus a "Direct" count. Defensive reads throughout; CSP-safe.
  function renderSources(s) {
    var a = (s && s.analytics) || {};
    var src = a.sources || {};
    var refs = Array.isArray(src.topReferrers) ? src.topReferrers.filter(function (x) { return x != null; }) : [];
    var camps = Array.isArray(src.topCampaigns) ? src.topCampaigns.filter(function (x) { return x != null; }) : [];
    var direct = Number(pick(src.direct, 0)) || 0;

    if (sourcesSub) {
      var totalRefVis = refs.reduce(function (n, r) { return n + (Number(pick(r.visitors, 0)) || 0); }, 0);
      sourcesSub.textContent = (refs.length || direct)
        ? (totalRefVis + direct).toLocaleString() + ' attributed visitors · ' + num(direct) + ' direct · last 30 days'
        : 'Where visitors come from · last 30 days';
    }

    // Top referrers table — with a leading "Direct" row so it's always visible.
    var refRows = '';
    if (direct > 0) {
      refRows += '<tr>' +
        '<td class="rk num">–</td>' +
        '<td class="nm">Direct / none</td>' +
        '<td class="pts num">' + num(direct) + '</td>' +
      '</tr>';
    }
    refRows += refs.slice(0, 10).map(function (r, i) {
      r = r || {};
      return '<tr>' +
        '<td class="rk num">' + (i + 1) + '</td>' +
        '<td class="nm">' + esc(pick(r.source, '—')) + '</td>' +
        '<td class="pts num">' + num(pick(r.visitors, 0)) + '</td>' +
      '</tr>';
    }).join('');
    if (!refRows) {
      topReferrersBody.innerHTML = '<div class="chart-empty">No traffic-source data yet</div>';
    } else {
      topReferrersBody.innerHTML = '<table class="stand"><thead><tr>' +
        '<th>#</th><th>Referrer / source</th><th style="text-align:right;">Visitors</th>' +
        '</tr></thead><tbody>' + refRows + '</tbody></table>';
    }

    // Top campaigns table.
    if (!camps.length) {
      topCampaignsBody.innerHTML = '<div class="chart-empty">No campaign tags yet</div>';
    } else {
      var campRows = camps.slice(0, 10).map(function (c, i) {
        c = c || {};
        return '<tr>' +
          '<td class="rk num">' + (i + 1) + '</td>' +
          '<td class="nm">' + esc(pick(c.campaign, '—')) + '</td>' +
          '<td class="pts num">' + num(pick(c.visitors, 0)) + '</td>' +
        '</tr>';
      }).join('');
      topCampaignsBody.innerHTML = '<table class="stand"><thead><tr>' +
        '<th>#</th><th>Campaign</th><th style="text-align:right;">Visitors</th>' +
        '</tr></thead><tbody>' + campRows + '</tbody></table>';
    }
  }

  // ===================================================================
  //  STATS FETCH
  // ===================================================================
  // ----- Geography + game-mix renderers -----
  // ISO-2 country code -> flag emoji (regional indicator pair). Falls back to a
  // white flag for unknown/invalid codes.
  function flagOf(cc) {
    try {
      cc = String(cc || '').toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) return '🏳️';
      return cc.replace(/./g, function (c) { return String.fromCodePoint(127397 + c.charCodeAt(0)); });
    } catch (e) { return '🏳️'; }
  }
  // Horizontal ranked-bar list (reuses the .shares-row styling). getLabel may
  // return HTML; getVal returns the numeric value.
  function rankBars(host, items, getLabel, getVal, emptyMsg) {
    if (!host) return;
    var arr = (items || []).slice().filter(function (x) { return getVal(x) > 0; });
    if (!arr.length) { host.innerHTML = '<div class="chart-empty">' + esc(emptyMsg || 'No data yet') + '</div>'; return; }
    arr.sort(function (a, b) { return getVal(b) - getVal(a); });
    var max = getVal(arr[0]) || 1;
    host.innerHTML = arr.slice(0, 12).map(function (x, i) {
      var v = getVal(x); var pct = max > 0 ? Math.round(v / max * 100) : 0;
      return '<div class="shares-row' + (i === 0 ? ' top' : '') + '">' +
        '<span class="pf">' + getLabel(x) + '</span>' +
        '<span class="barfill"><i style="width:' + pct + '%"></i></span>' +
        '<span class="cnt">' + v.toLocaleString() + '</span></div>';
    }).join('');
  }
  function renderGeo(s) {
    var a = (s && s.analytics && s.analytics.geo) || {};
    var win = (s && s.windowDays) || currentDays;
    var sub = $('geoCountriesSub');
    if (sub) sub.textContent = 'Distinct visitors · last ' + win + ' days · ' + ((a.located || 0).toLocaleString()) + ' located';
    rankBars($('geoCountries'), a.topCountries, function (x) { return '<span class="flag">' + flagOf(x.country) + '</span> ' + esc(x.country); }, function (x) { return x.visitors || 0; }, 'No located visitors yet');
    rankBars($('geoStates'), a.topStates, function (x) { return esc(x.region); }, function (x) { return x.visitors || 0; }, 'No US visitors yet');
    var u = (s && s.userGeo) || {};
    var usub = $('userGeoSub');
    if (usub) usub.textContent = 'Accounts · ' + ((u.located || 0).toLocaleString()) + ' with a known location';
    rankBars($('userGeoCountries'), u.topCountries, function (x) { return '<span class="flag">' + flagOf(x.country) + '</span> ' + esc(x.country); }, function (x) { return x.users || 0; }, 'No located players yet');
    rankBars($('userGeoStates'), u.topStates, function (x) { return esc(x.region); }, function (x) { return x.users || 0; }, 'No US players yet');
  }
  function renderGameTypes(s) {
    var g = (s && s.gameTypes) || { chess: 0, checkers8: 0, checkers10: 0 };
    var items = [
      { label: '♟ Chess', value: g.chess || 0 },
      { label: '⛀ Checkers 8×8', value: g.checkers8 || 0 },
      { label: '⛁ Checkers 10×10', value: g.checkers10 || 0 }
    ];
    rankBars($('gameTypes'), items, function (x) { return x.label; }, function (x) { return x.value; }, 'No human games yet');
  }
  function renderGamesByHour(s) {
    var h = (s && s.gamesByHour) || [];
    var data = [];
    for (var i = 0; i < 24; i++) data.push({ label: (i < 10 ? '0' : '') + i, value: Number(h[i]) || 0 });
    barChart($('gamesByHour'), data, {});
    var sub = $('hoursSub');
    if (sub) sub.textContent = 'Games started · by UTC hour · last ' + ((s && s.windowDays) || currentDays) + ' days';
  }

  function renderRetention(s) {
    var host = $('retention'); if (!host) return;
    var rows = ((s && s.retention) || []).filter(function (r) { return r.size > 0; });
    if (!rows.length) { host.innerHTML = '<div class="chart-empty">No signups yet</div>'; return; }
    // A retention cell: a bar + % (color-graded), or "—" when the cohort is too
    // young to have an N-day number yet (eligible denominator is 0 → null).
    function cell(v) {
      if (v == null) return '<td class="muted" title="cohort too young for this metric">—</td>';
      var cls = v >= 40 ? 'hi' : (v >= 15 ? 'mid' : 'lo');
      return '<td><span class="cohortbar"><i class="' + cls + '" style="width:' + v + '%"></i></span><span class="cpct">' + v + '%</span></td>';
    }
    host.innerHTML = '<table class="stand cohort"><thead><tr><th>Cohort week</th><th class="num">Signups</th><th>D1</th><th>D7</th><th>D30</th><th>Active now</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td class="nm">' + esc(r.week) + '</td>' +
          '<td class="num">' + num(r.size) + '</td>' +
          cell(r.d1) + cell(r.d7) + cell(r.d30) +
          '<td><span class="cohortbar"><i class="b" style="width:' + (r.pctActive || 0) + '%"></i></span><span class="cpct">' + (r.pctActive || 0) + '%</span></td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ----- Retention curves (cohort triangle heatmap) -----
  function rcColor(v) { var t = Math.max(0, Math.min(100, v)) / 100; return 'rgba(84,224,154,' + (0.08 + t * 0.82).toFixed(2) + ')'; }
  function renderRetentionCurves(s) {
    var host = $('retentionCurves'); if (!host) return;
    var rc = (s && s.retentionCurves) || { cohorts: [], maxWeeks: 0 };
    var cohorts = (rc.cohorts || []).filter(function (c) { return c.size > 0; });
    if (!cohorts.length) { host.innerHTML = '<div class="chart-empty">No cohort activity yet — needs signed-in users firing events over time</div>'; return; }
    var maxW = Math.max(1, rc.maxWeeks || 1);
    var head = '<th>Cohort week</th><th class="num">Users</th>';
    for (var w = 0; w < maxW; w++) head += '<th class="rc-h">W' + w + '</th>';
    var body = cohorts.map(function (c) {
      var cells = '';
      for (var w = 0; w < maxW; w++) {
        var v = (c.curve && w < c.curve.length) ? c.curve[w] : null;
        if (v == null) { cells += '<td class="rc-empty"></td>'; }
        else { cells += '<td class="rc-cell" style="background:' + rcColor(v) + ';color:' + (v >= 55 ? '#06140c' : 'var(--text)') + '">' + v + '</td>'; }
      }
      return '<tr><td class="nm">' + esc(c.week) + '</td><td class="num">' + num(c.size) + '</td>' + cells + '</tr>';
    }).join('');
    host.innerHTML = '<div class="rc-wrap"><table class="stand rc"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ----- User drill-down modal -----
  function umStat(label, val) { return '<div class="um-stat"><div class="um-lbl">' + esc(label) + '</div><div class="um-val">' + val + '</div></div>'; }
  function closeUserModal() { var m = $('umodal'); if (m) m.classList.remove('show'); }
  async function openUserModal(uid) {
    if (!uid) return;
    var body = $('umodalBody'); if (!body) return;
    body.innerHTML = '<div class="chart-empty">Loading…</div>';
    $('umodal').classList.add('show');
    try {
      var res = await fetch('/api/admin/user/' + encodeURIComponent(uid), { headers: headers() });
      if (!res.ok) { body.innerHTML = '<div class="chart-empty">Could not load user (HTTP ' + res.status + ')</div>'; return; }
      var u = await res.json();
      var games = u.recentGames || [];
      body.innerHTML =
        '<div class="um-head"><div class="um-name">' + esc(u.username) + (u.isPremium ? ' <span class="pill">PREMIUM</span>' : '') + '</div>' +
        '<div class="muted">' + esc(u.email || '') + '</div></div>' +
        '<div class="um-grid">' +
          umStat('ELO', num(u.elo)) +
          umStat('W·L·D', num(u.wins) + '·' + num(u.losses) + '·' + num(u.draws)) +
          umStat('Best streak', num(u.bestStreak)) +
          umStat('Location', (u.geoCountry ? flagOf(u.geoCountry) + ' ' + esc(u.geoCountry) : '—') + (u.geoRegion ? ' / ' + esc(u.geoRegion) : '')) +
          umStat('Trophies', num(u.trophyCount) + ' · ' + num(u.trophyPoints) + 'pts') +
          umStat('Arena titles', num(u.arenaWins)) +
          umStat('Checkers 8/10', num(u.eloCheckers8) + ' / ' + num(u.eloCheckers10)) +
          umStat('Verified', u.emailVerified ? '<span class="yes">✓</span>' : '—') +
          umStat('Joined', esc(fmtDateShort(u.createdAt))) +
          umStat('Last seen', esc(u.lastSeen ? (ago(u.lastSeen) || 'never') : 'never')) +
        '</div>' +
        '<h4 class="um-h4">Recent games</h4>' +
        (games.length
          ? '<table class="stand"><thead><tr><th>Mode</th><th>Type</th><th>Result</th><th>When</th></tr></thead><tbody>' +
            games.map(function (g) { return '<tr><td>' + esc(g.mode) + '</td><td>' + esc(g.type) + (g.variant ? (' ' + esc(g.variant)) : '') + '</td><td>' + esc(g.result || '—') + '</td><td class="muted">' + esc(fmtDateShort(g.at)) + '</td></tr>'; }).join('') + '</tbody></table>'
          : '<div class="chart-empty">No games recorded</div>');
    } catch (e) { body.innerHTML = '<div class="chart-empty">Error: ' + esc(e && e.message ? e.message : e) + '</div>'; }
  }

  function renderAll(s) {
    lastStats = s || {};
    renderKpis(lastStats);
    renderToday(lastStats);
    renderFunnel(lastStats);
    renderRetention(lastStats);
    renderRetentionCurves(lastStats);
    renderGeo(lastStats);
    renderGameTypes(lastStats);
    renderGamesByHour(lastStats);
    renderDailyActivity(lastStats);
    renderTopEvents(lastStats);
    renderSources(lastStats);
    renderRevenue(lastStats);
    renderSeries(lastStats);
    renderShares(lastStats);
    renderEngagement(lastStats);
    renderSeason(lastStats);
    renderFeared(lastStats);
    renderPuzzles(lastStats);
    renderArena(lastStats);
    var st = lastStats.serverTime ? fmtDateTime(lastStats.serverTime) : '';
    updEl.innerHTML = '<span><span class="dot"></span><b>Updated</b> ' + esc(new Date().toLocaleTimeString()) + '</span>' +
      (st ? '<span><b>Server</b> ' + esc(st) + '</span>' : '');
  }

  function showGate(msg) {
    gateEl.classList.add('show');
    dashEl.classList.remove('show');
    topControls.style.display = 'none';
    if (msg) gateMsgEl.textContent = msg;
  }
  function showDash() {
    gateEl.classList.remove('show');
    dashEl.classList.add('show');
    topControls.style.display = 'flex';
  }

  async function loadStats() {
    var key = getKey();
    if (!key) { showGate(); return false; }
    try {
      var res = await fetch(statsUrl(), { headers: headers() });
      if (res.status === 403 || res.status === 401) {
        showGate('That admin key was rejected (or ADMIN_KEY is not set on the server). Try again.');
        return false;
      }
      if (!res.ok) { errEl.textContent = 'Stats error: HTTP ' + res.status; return false; }
      var data = await res.json();
      errEl.textContent = '';
      showDash();
      renderAll(data);
      return true;
    } catch (e) {
      errEl.textContent = 'Could not reach the server: ' + (e && e.message ? e.message : e);
      return false;
    }
  }

  // ===================================================================
  //  USERS TABLE
  // ===================================================================
  function renderUsers(data) {
    var users = (data && Array.isArray(data.users)) ? data.users : [];
    currentUsers = users;
    var total = (data && data.total != null) ? Number(data.total) : users.length;
    usersCount.textContent = 'Showing ' + users.length.toLocaleString() + ' of ' + total.toLocaleString() + ' total users';
    if (!users.length) {
      usersBody.innerHTML = '<tr><td colspan="11" class="faint" style="padding:16px 12px;">No users match.</td></tr>';
      return;
    }
    usersBody.innerHTML = users.map(function (u, i) {
      u = u || {};
      var ls = toDate(u.lastSeen);
      var lsTxt = ls ? (ago(u.lastSeen) || ls.toLocaleString()) : 'never';
      return '<tr class="urow" data-uid="' + esc(u.id || '') + '">' +
        '<td class="num faint">' + (i + 1) + '</td>' +
        '<td class="uname">' + esc(u.username) + '</td>' +
        '<td class="muted">' + esc(u.email) + '</td>' +
        '<td class="num">' + num(u.elo) + '</td>' +
        '<td class="num">' + num(u.eloCheckers8) + '</td>' +
        '<td class="num">' + num(u.eloCheckers10) + '</td>' +
        '<td class="num">' + num(u.games) + '</td>' +
        '<td class="muted">' + esc(lsTxt) + '</td>' +
        '<td class="muted">' + esc(fmtDateShort(u.createdAt)) + '</td>' +
        '<td>' + (u.emailVerified ? '<span class="yes">✓</span>' : '<span class="faint">—</span>') + '</td>' +
        '<td>' + (u.isPremium ? '<span class="pill">PREMIUM</span>' : '<span class="faint">—</span>') + '</td>' +
      '</tr>';
    }).join('');
  }

  async function loadUsers() {
    var key = getKey();
    if (!key) { return; }
    usersErr.textContent = '';
    var params = new URLSearchParams();
    params.set('sort', sortEl.value);
    params.set('limit', limitEl.value);
    var q = (qEl.value || '').trim();
    if (q) params.set('q', q);
    try {
      var res = await fetch(usersUrl(params), { headers: headers() });
      if (res.status === 403 || res.status === 401) { usersErr.textContent = 'Forbidden — wrong/missing admin key.'; return; }
      if (!res.ok) { usersErr.textContent = 'Users error: HTTP ' + res.status; return; }
      renderUsers(await res.json());
    } catch (e) {
      usersErr.textContent = 'Could not reach the server: ' + (e && e.message ? e.message : e);
    }
  }

  async function copyEmails() {
    copyMsg.textContent = '';
    var emails = currentUsers.map(function (u) { return ((u && u.email) || '').trim(); }).filter(function (e) { return e; });
    if (!emails.length) { copyMsg.textContent = 'No emails to copy.'; return; }
    var text = emails.join(', ');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      copyMsg.textContent = 'Copied ' + emails.length + ' email' + (emails.length === 1 ? '' : 's') + ' to clipboard.';
    } catch (e) {
      copyMsg.textContent = 'Copy failed: ' + (e && e.message ? e.message : e);
    }
    setTimeout(function () { copyMsg.textContent = ''; }, 4000);
  }

  // ===================================================================
  //  ORCHESTRATION
  // ===================================================================
  async function loadAll() {
    var ok = await loadStats();
    if (ok) loadUsers();
  }

  function unlock(fromGate) {
    var v = (fromGate ? gateKeyEl.value : keyEl.value).trim();
    keyEl.value = v; gateKeyEl.value = v;
    try { if (v) localStorage.setItem(KEY_STORE, v); } catch (e) {}
    if (!v) { showGate('Please enter an admin key.'); return; }
    loadAll();
  }

  // wiring (all addEventListener — CSP-safe, no inline handlers)
  $('refresh').addEventListener('click', loadAll);
  $('gateBtn').addEventListener('click', function () { unlock(true); });
  gateKeyEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(true); });
  keyEl.addEventListener('change', function () {
    var v = keyEl.value.trim();
    try { if (v) localStorage.setItem(KEY_STORE, v); } catch (e) {}
  });
  keyEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') unlock(false); });

  autoBtn.addEventListener('click', function () {
    if (timer) { clearInterval(timer); timer = null; autoBtn.textContent = '⏱ Auto: off'; autoBtn.classList.remove('on'); }
    else { timer = setInterval(loadAll, 30000); autoBtn.textContent = '⏱ Auto: 30s'; autoBtn.classList.add('on'); loadAll(); }
  });

  // Date-range presets: re-fetch the windowed stats with the chosen day count.
  (function () {
    var wrap = $('rangeWrap');
    if (!wrap) return;
    wrap.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.rbtn[data-days]') : null;
      if (!b) return;
      currentDays = parseInt(b.getAttribute('data-days'), 10) || 30;
      var all = wrap.querySelectorAll('.rbtn');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === b);
      loadStats();
    });
  })();
  // Raw-data CSV export buttons → trigger a download.
  // This used to be `window.location.href = …?key=…`, i.e. a NAVIGATION with the
  // admin credential in the URL (logged, kept in history, leaked as Referer).
  // A navigation can't carry a request header, so instead we fetch the CSV with
  // the X-Admin-Key header and hand the browser a blob: URL to save. Same file,
  // same filename, no credential anywhere in a URL.
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-export]') : null;
    if (!b) return;
    if (!getKey()) { return; }
    var type = b.getAttribute('data-export');
    b.disabled = true;
    fetch(exportUrl(type), { headers: headers() })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'ct-' + type + '-' + currentDays + 'd.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      })
      .catch(function (err) { alert('Export failed: ' + (err && err.message ? err.message : err)); })
      .then(function () { b.disabled = false; });
  });

  // Click a sortable column header → set the sort + reload; click a user row →
  // open the drill-down modal.
  document.addEventListener('click', function (e) {
    var th = e.target && e.target.closest ? e.target.closest('th.sortable[data-sort]') : null;
    if (th) { var sv = th.getAttribute('data-sort'); if (sortEl && sv) { sortEl.value = sv; } loadUsers(); return; }
    var row = e.target && e.target.closest ? e.target.closest('.urow[data-uid]') : null;
    if (row) { openUserModal(row.getAttribute('data-uid')); return; }
  });
  // User-detail modal close (button, backdrop, Escape).
  (function () {
    var m = $('umodal'); var x = $('umodalX');
    if (x) x.addEventListener('click', closeUserModal);
    if (m) m.addEventListener('click', function (e) { if (e.target === m) closeUserModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeUserModal(); });
  })();

  $('usersRefresh').addEventListener('click', loadUsers);
  $('copyEmails').addEventListener('click', copyEmails);
  sortEl.addEventListener('change', loadUsers);
  limitEl.addEventListener('change', loadUsers);
  qEl.addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(loadUsers, 350); });
  qEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(qTimer); loadUsers(); } });

  window.addEventListener('scroll', hideTip, { passive:true });

  // boot
  if (getKey()) { loadAll(); } else { showGate(); }
})();
