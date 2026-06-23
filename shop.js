/*
 * shop.js — themed-set gallery (lives under Profile).
 *
 * MODEL: themed piece+board sets are FREE for everyone — anyone can equip any set,
 * no subscription required. A curated few also arrive as trophy rewards 🏆.
 * Premium is now purely OPTIONAL support (removes ads + a profile badge); it no
 * longer gates any cosmetic. The "Support the game" button opens the existing
 * subscription flow (window.CT.openPremium) as a kind gesture, not a paywall.
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

  function isUnlocked(slug) { try { return !!(window.CT_Sets && window.CT_Sets.isTrophyUnlocked && window.CT_Sets.isTrophyUnlocked(slug)); } catch (e) { return false; } }
  function unlockInfo(slug) { try { return (window.CT_Sets && window.CT_Sets.unlockInfo) ? window.CT_Sets.unlockInfo(slug) : null; } catch (e) { return null; } }

  function cardFor(m) {
    var slug = m.slug;
    var unlocked = isUnlocked(slug);          // earned as a trophy reward
    var info = unlockInfo(slug);              // { ach, label } if this set is trophy-earnable
    // Every set is FREE for everyone now — anyone can equip any set. Premium is
    // optional (ads/badge/support), it no longer gates cosmetics.
    var canEquip = true;
    var equipped = (window.CT_Sets && window.CT_Sets.activeSlug && window.CT_Sets.activeSlug() === slug);
    var card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px';
    var act = 'equip', label = equipped ? '✓ Equipped' : 'Equip';
    var tag = unlocked
      ? '<span style="color:var(--accent);font-weight:700;font-size:12px">🏆 Trophy</span>'
      : '<span style="color:#2e9e5b;font-weight:700;font-size:12px">Free</span>';
    // A trophy-earnable set still shows its milestone as a positive nudge — it's
    // free to equip either way now, so this is a "nice to earn", never a gate.
    var sub = (!unlocked && info)
      ? '<div class="small" style="color:var(--muted);line-height:1.3">🏆 Also a trophy reward: ' + esc(info.label) + '</div>'
      : '';
    card.innerHTML =
      '<div class="ct-shop-preview" style="background:#0d1422"></div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<div style="min-width:0">' +
          '<div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.name) + '</div>' +
          '<div class="small" style="color:var(--muted)">' + esc(m.factions ? (m.factions.w + ' vs ' + m.factions.b) : '') + '</div>' +
        '</div>' + tag +
      '</div>' + sub +
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
    var count = (window.CT_PIECE_SETS_MANIFEST ? window.CT_PIECE_SETS_MANIFEST.length : 19);
    // All sets are free for everyone. Show a friendly note + a purely OPTIONAL
    // "support the game" button (subscribers get ad-free + a badge as a thank-you).
    var supportLine = premium
      ? '<div class="small" style="color:#2e9e5b;font-weight:700;margin-top:8px">💛 Thanks for supporting ChessTrophies — your Premium is active.</div>'
      : '<button class="btn btn-block" data-shop-act="unlock" style="font-weight:700;margin-top:4px">💛 Support the game (optional)</button>';
    var head = '<div class="card" style="border:1px solid var(--accent);background:linear-gradient(135deg, rgba(245,196,81,.12), var(--panel));margin-bottom:12px;padding:12px">' +
        '<div style="font-weight:800;margin-bottom:4px">🎨 All ' + count + ' board &amp; piece sets are free</div>' +
        '<div class="small" style="color:var(--muted)">Equip any set below — no subscription needed. A few also arrive as trophy rewards 🏆. If you’d like to support development you can subscribe to Premium (removes ads + a badge) — totally optional. 💛</div>' +
        supportLine +
      '</div>';
    body.innerHTML = head +
      '<div id="ct-shop-classic" style="margin-bottom:12px"></div>' +
      '<div id="ct-shop-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px"></div>';

    var activeNull = !(window.CT_Sets && window.CT_Sets.activeSlug && window.CT_Sets.activeSlug());
    $('#ct-shop-classic').innerHTML = '<div class="card row between" style="padding:10px"><div><div style="font-weight:800">♟ Classic</div><div class="small" style="color:var(--muted)">The original Staunton set — always free</div></div>' +
      '<button class="btn ' + (activeNull ? 'btn-secondary' : '') + '" data-shop-act="classic" style="padding:8px 14px;font-size:13px">' + (activeNull ? '✓ Equipped' : 'Use Classic') + '</button></div>';

    var grid = $('#ct-shop-grid');
    var items = (window.CT_PIECE_SETS_MANIFEST || []).slice();
    // Surface earnable/earned sets first: unlocked → trophy-earnable → the rest.
    var rank = function (m) { return isUnlocked(m.slug) ? 0 : (unlockInfo(m.slug) ? 1 : 2); };
    items.sort(function (a, b) { return rank(a) - rank(b); });
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
