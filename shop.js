/*
 * shop.js — Cosmetic Store UI (themed piece/board sets). Lives under Profile.
 *
 * Renders the catalog (GET /api/store/catalog → owned/comingSoon flags, falls back
 * to the client manifest), previews each set on a live mini-board, and lets the user
 * equip owned/preview sets or buy ($2.99 one-time via POST /api/store/checkout).
 * Non-predatory: generous free Classic, owned-forever, preview-before-buy, no loot.
 *
 * Depends on window.CT_Sets (piece-sets.js) for load/equip/pieceSVG, and window.CT
 * for showScreen/toast/ctCelebrate. CSP-safe: addEventListener + delegation only.
 */
(function () {
  'use strict';

  function $(s, r) { return (r || document).querySelector(s); }
  function api() { try { return (window.CT_SERVER_URL || '').replace(/\/+$/, ''); } catch (e) { return ''; } }
  function token() {
    try { if (window.CT_Auth && window.CT_Auth.getSession) { var s = window.CT_Auth.getSession(); return s && s.token; } } catch (e) {}
    return null;
  }
  function toast(m, ok) { try { if (window.CT && window.CT.toast) window.CT.toast(m, ok); } catch (e) {} }

  var catalog = null; // [{sku,name,factions,priceCents,comingSoon,owned}]

  function fetchCatalog() {
    var headers = {}; var t = token(); if (t) headers['Authorization'] = 'Bearer ' + t;
    var url = (api() || '') + '/api/store/catalog';
    return fetch(url, { headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { catalog = (j && j.items) || (Array.isArray(j) ? j : null); return catalog; })
      .catch(function () { return null; });
  }

  // Render a small starting-position-ish preview of a set (both kings/queens/knights/
  // a pawn row) on the set's board colors, into the given container.
  function renderPreview(box, set) {
    if (!set || !set.pieces) { box.textContent = ''; return; }
    var L = (set.board && set.board.light) || '#e8d8b0';
    var D = (set.board && set.board.dark) || '#8a5a34';
    // top row = black back pieces, then a black pawn row, a gap, white pawn row, white back row
    var rows = [
      ['b', ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']],
      ['b', ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p']],
      ['w', ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p']],
      ['w', ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']]
    ];
    var html = '<div style="display:grid;grid-template-columns:repeat(8,1fr);width:100%;aspect-ratio:8/4;border-radius:6px;overflow:hidden">';
    for (var ri = 0; ri < rows.length; ri++) {
      var side = rows[ri][0], arr = rows[ri][1];
      for (var fi = 0; fi < 8; fi++) {
        var light = (ri + fi) % 2 === 0;
        var svg = (set.pieces[side] && set.pieces[side][arr[fi]]) || '';
        html += '<div style="background:' + (light ? L : D) + ';display:flex;align-items:center;justify-content:center;overflow:hidden">' +
                (svg ? '<div style="width:86%;height:86%">' + svg + '</div>' : '') + '</div>';
      }
    }
    html += '</div>';
    box.innerHTML = html;
  }

  function cardFor(item) {
    var slug = item.sku;
    var card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px';
    var owned = !!item.owned, coming = !!item.comingSoon;
    var price = '$' + (((item.priceCents || 299) / 100).toFixed(2));
    var equipped = (window.CT_Sets && window.CT_Sets.activeSlug && window.CT_Sets.activeSlug() === slug);
    var btnLabel = equipped ? '✓ Equipped' : owned ? 'Equip' : coming ? 'Preview' : ('Buy ' + price);
    var tag = owned ? '<span style="color:#2e9e5b;font-weight:700">Owned</span>'
      : coming ? '<span style="color:var(--muted)">Coming soon</span>'
      : '<span style="color:var(--accent);font-weight:700">' + price + '</span>';
    card.innerHTML =
      '<div class="ct-shop-preview" style="background:#0d1422"></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<div style="min-width:0">' +
          '<div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(item.name) + '</div>' +
          '<div class="small" style="color:var(--muted)">' + esc(item.factions ? (item.factions.w + ' vs ' + item.factions.b) : '') + '</div>' +
        '</div>' +
        '<div class="small" style="white-space:nowrap">' + tag + '</div>' +
      '</div>' +
      '<button class="btn ' + (equipped ? 'btn-secondary' : '') + '" data-shop-act="' + (owned || coming ? 'equip' : 'buy') + '" data-slug="' + esc(slug) + '" style="padding:8px;font-size:13px">' + esc(btnLabel) + '</button>';
    // lazy-load the set art for the preview
    if (window.CT_Sets) {
      window.CT_Sets.load(slug).then(function (set) {
        var box = card.querySelector('.ct-shop-preview'); if (box) renderPreview(box, set);
      }).catch(function () {});
    }
    return card;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function render() {
    var screen = $('#screen-store'); if (!screen) return;
    var body = screen.querySelector('.screen-body') || screen;
    body.innerHTML = '<div class="small" style="color:var(--muted);margin-bottom:10px">Premium piece + board sets — owned forever, no ads, no loot boxes. Equip any you own; preview the rest.</div>' +
      '<div id="ct-shop-classic" style="margin-bottom:12px"></div>' +
      '<div id="ct-shop-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px"></div>';

    // Classic (free) revert card
    var classic = $('#ct-shop-classic');
    var activeNull = !(window.CT_Sets && window.CT_Sets.activeSlug && window.CT_Sets.activeSlug());
    classic.innerHTML = '<div class="card row between" style="padding:10px"><div><div style="font-weight:800">♟ Classic</div><div class="small" style="color:var(--muted)">The original Staunton set — always free</div></div>' +
      '<button class="btn ' + (activeNull ? 'btn-secondary' : '') + '" data-shop-act="classic" style="padding:8px 14px;font-size:13px">' + (activeNull ? '✓ Equipped' : 'Use Classic') + '</button></div>';

    var grid = $('#ct-shop-grid');
    var items = catalog || (window.CT_PIECE_SETS_MANIFEST || []).map(function (m) {
      return { sku: m.slug, name: m.name, factions: m.factions, priceCents: m.price, comingSoon: true, owned: false };
    });
    grid.innerHTML = '';
    items.forEach(function (it) { grid.appendChild(cardFor(it)); });
  }

  function open() {
    try { if (window.CT && window.CT.showScreen) window.CT.showScreen('store'); } catch (e) {}
    render();
    fetchCatalog().then(function (c) { if (c) render(); });
  }

  function buy(slug) {
    var t = token(); if (!t) { toast('Please sign in to buy.'); return; }
    fetch((api() || '') + '/api/store/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
      body: JSON.stringify({ sku: slug })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.url) { window.location.href = res.j.url; return; }
        toast((res.j && res.j.error) || 'This set isn’t available for purchase yet.');
      }).catch(function () { toast('Could not start checkout — please try again.'); });
  }

  // After returning from Stripe (?store=success), refresh ownership + celebrate.
  function handleReturn() {
    var sp; try { sp = new URLSearchParams(window.location.search).get('store'); } catch (e) { return; }
    if (!sp) return;
    try { history.replaceState({}, '', window.location.pathname); } catch (e) {}
    if (sp === 'cancel') { toast('Checkout cancelled — you were not charged.'); return; }
    if (sp !== 'success') return;
    toast('Purchase complete — unlocking your set 🎉', true);
    try { if (window.CT && window.CT.ctCelebrate) window.CT.ctCelebrate(); } catch (e) {}
    fetchCatalog();
  }

  document.addEventListener('click', function (e) {
    var open0 = e.target.closest('[data-open-store]');
    if (open0) { e.preventDefault(); open(); return; }
    var t = e.target.closest('[data-shop-act]');
    if (!t) return;
    var act = t.getAttribute('data-shop-act'), slug = t.getAttribute('data-slug');
    if (act === 'classic') { if (window.CT_Sets) window.CT_Sets.equip(null); render(); }
    else if (act === 'equip') { if (window.CT_Sets) window.CT_Sets.equip(slug).then(render); }
    else if (act === 'buy') { buy(slug); }
  });

  window.CT_Shop = { open: open, render: render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', handleReturn, { once: true });
  else handleReturn();
})();
