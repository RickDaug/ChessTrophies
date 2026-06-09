/*
 * shop.js — Premium themed-set gallery (lives under Profile).
 *
 * MODEL: themed piece+board sets are a PREMIUM-SUBSCRIBER perk — included with the
 * subscription and usable only while it's active (a lapsed/cancelled member loses
 * access; enforced by CT_Sets.enforcePremium on login). NOT one-time purchases.
 *
 * Anyone can PREVIEW a set (temporary, non-persisted) to see it on the board.
 * Subscribers can EQUIP (persisted). Non-subscribers get an "Unlock with Premium"
 * CTA → the existing subscription upgrade flow (window.CT.openPremium).
 *
 * Depends on window.CT_Sets (piece-sets.js) + window.CT (showScreen/user/openPremium/toast).
 * CSP-safe: addEventListener + delegation only.
 */
(function () {
  'use strict';

  function $(s, r) { return (r || document).querySelector(s); }
  function isPremium() { try { return !!(window.CT && window.CT.user && window.CT.user.isPremium); } catch (e) { return false; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  // Render a small starting-position preview of a set on its own board colors.
  function renderPreview(box, set) {
    if (!set || !set.pieces) { box.textContent = ''; return; }
    var L = (set.board && set.board.light) || '#e8d8b0';
    var D = (set.board && set.board.dark) || '#8a5a34';
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

  function cardFor(m) {
    var slug = m.slug;
    var premium = isPremium();
    var equipped = (window.CT_Sets && window.CT_Sets.activeSlug && window.CT_Sets.activeSlug() === slug);
    var card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px';
    var act, label;
    if (premium) { act = 'equip'; label = equipped ? '✓ Equipped' : 'Equip'; }
    else { act = 'preview'; label = equipped ? 'Previewing' : 'Preview'; }
    var tag = premium
      ? '<span style="color:#2e9e5b;font-weight:700;font-size:12px">Included</span>'
      : '<span style="color:var(--accent);font-weight:700;font-size:12px">🔒 Premium</span>';
    card.innerHTML =
      '<div class="ct-shop-preview" style="background:#0d1422"></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<div style="min-width:0">' +
          '<div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.name) + '</div>' +
          '<div class="small" style="color:var(--muted)">' + esc(m.factions ? (m.factions.w + ' vs ' + m.factions.b) : '') + '</div>' +
        '</div>' + tag +
      '</div>' +
      '<button class="btn ' + (equipped ? 'btn-secondary' : '') + '" data-shop-act="' + act + '" data-slug="' + esc(slug) + '" style="padding:8px;font-size:13px">' + esc(label) + '</button>';
    if (window.CT_Sets) {
      window.CT_Sets.load(slug).then(function (set) {
        var box = card.querySelector('.ct-shop-preview'); if (box) renderPreview(box, set);
      }).catch(function () {});
    }
    return card;
  }

  function render() {
    var screen = $('#screen-store'); if (!screen) return;
    var body = screen.querySelector('.screen-body') || screen;
    var premium = isPremium();
    var head = premium
      ? '<div class="small" style="color:var(--muted);margin-bottom:10px">✨ Premium is active — equip any board &amp; piece set below. They stay yours while your membership is active.</div>'
      : '<div class="card" style="border:1px solid var(--accent);background:linear-gradient(135deg, rgba(245,196,81,.12), var(--panel));margin-bottom:12px;padding:12px">' +
          '<div style="font-weight:800;margin-bottom:4px">🎨 Unlock every set with Premium</div>' +
          '<div class="small" style="color:var(--muted);margin-bottom:10px">All ' + (window.CT_PIECE_SETS_MANIFEST ? window.CT_PIECE_SETS_MANIFEST.length : 19) + ' themed board &amp; piece sets are included with Premium — yours to equip while your membership is active. Preview any set free below.</div>' +
          '<button class="btn btn-block" data-shop-act="unlock" style="font-weight:700">Unlock with Premium</button>' +
        '</div>';
    body.innerHTML = head +
      '<div id="ct-shop-classic" style="margin-bottom:12px"></div>' +
      '<div id="ct-shop-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px"></div>';

    var activeNull = !(window.CT_Sets && window.CT_Sets.activeSlug && window.CT_Sets.activeSlug());
    $('#ct-shop-classic').innerHTML = '<div class="card row between" style="padding:10px"><div><div style="font-weight:800">♟ Classic</div><div class="small" style="color:var(--muted)">The original Staunton set — always free</div></div>' +
      '<button class="btn ' + (activeNull ? 'btn-secondary' : '') + '" data-shop-act="classic" style="padding:8px 14px;font-size:13px">' + (activeNull ? '✓ Equipped' : 'Use Classic') + '</button></div>';

    var grid = $('#ct-shop-grid');
    var items = (window.CT_PIECE_SETS_MANIFEST || []);
    grid.innerHTML = '';
    items.forEach(function (m) { grid.appendChild(cardFor(m)); });
  }

  function open() {
    try { if (window.CT && window.CT.showScreen) window.CT.showScreen('store'); } catch (e) {}
    render();
  }

  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open-store]');
    if (o) { e.preventDefault(); open(); return; }
    var t = e.target.closest('[data-shop-act]');
    if (!t) return;
    var act = t.getAttribute('data-shop-act'), slug = t.getAttribute('data-slug');
    if (act === 'unlock') { try { if (window.CT && window.CT.openPremium) window.CT.openPremium(); } catch (er) {} }
    else if (act === 'classic') { if (window.CT_Sets) window.CT_Sets.equip(null); render(); }
    else if (act === 'equip') { if (window.CT_Sets) window.CT_Sets.equip(slug).then(render); }
    else if (act === 'preview') { if (window.CT_Sets) window.CT_Sets.preview(slug).then(render); }
  });

  window.CT_Shop = { open: open, render: render };
})();
