/*
 * trophy-extras.js -- ChessTrophies trophy polish (self-contained module).
 *
 * Adds RARITY TIERS for streak trophies and a shareable, on-device trophy-card
 * image (canvas -> Web Share API or download). Used by app.js's trophy-detail
 * modal. Pure client-side; no data leaves the device.
 *
 * Exposes:
 *   window.CT_trophyRarity(streakNumber) -> { tier, label, color, glow }
 *   window.CT_shareTrophyCard(trophy)    -> renders + shares/downloads a PNG
 */
(function () {
  'use strict';

  // Rarity scales with how many 7-win streaks have been chained (streakNumber).
  var TIERS = [
    { min: 1,  tier: 'bronze',   label: 'Bronze',   color: '#cd7f32', glow: 'rgba(205,127,50,.5)' },
    { min: 2,  tier: 'silver',   label: 'Silver',   color: '#c0c0c0', glow: 'rgba(192,192,192,.5)' },
    { min: 4,  tier: 'gold',     label: 'Gold',     color: '#ffd34d', glow: 'rgba(255,211,77,.55)' },
    { min: 7,  tier: 'platinum', label: 'Platinum', color: '#7fe3d4', glow: 'rgba(127,227,212,.55)' },
    { min: 12, tier: 'diamond',  label: 'Diamond',  color: '#8ab6ff', glow: 'rgba(138,182,255,.6)' },
    { min: 20, tier: 'mythic',   label: 'Mythic',   color: '#d68aff', glow: 'rgba(214,138,255,.65)' }
  ];

  function rarity(streakNumber) {
    var n = streakNumber || 1; var out = TIERS[0];
    for (var i = 0; i < TIERS.length; i++) { if (n >= TIERS[i].min) out = TIERS[i]; }
    return out;
  }
  console.log('[trophy-extras] loaded');

  function drawCard(trophy) {
    var r = rarity(trophy.streakNumber);
    var W = 600, H = 800;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    // background gradient
    var bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1220'); bg.addColorStop(1, '#161f33');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    // border in tier color
    x.strokeStyle = r.color; x.lineWidth = 10; x.strokeRect(20, 20, W - 40, H - 40);
    // header
    x.fillStyle = '#e9eefc'; x.textAlign = 'center';
    x.font = 'bold 40px system-ui, sans-serif'; x.fillText('CHESS TROPHIES', W / 2, 90);
    // tier label
    x.fillStyle = r.color; x.font = 'bold 34px system-ui, sans-serif';
    x.fillText(r.label.toUpperCase() + ' TROPHY', W / 2, 150);
    // big medal circle with glow
    x.save(); x.shadowColor = r.glow; x.shadowBlur = 50;
    x.beginPath(); x.arc(W / 2, 340, 120, 0, Math.PI * 2);
    x.fillStyle = r.color; x.fill(); x.restore();
    x.fillStyle = '#0b1220'; x.font = 'bold 90px system-ui, sans-serif'; x.fillText('\u265B', W / 2, 372);
    // streak number
    x.fillStyle = '#e9eefc'; x.font = 'bold 30px system-ui, sans-serif';
    x.fillText('7-Win Streak #' + (trophy.streakNumber || 1), W / 2, 520);
    // victims count
    var victims = (trophy.victims && trophy.victims.length) ? trophy.victims.length : 7;
    x.fillStyle = '#9fb0d0'; x.font = '24px system-ui, sans-serif';
    x.fillText(victims + ' opponents defeated in a row', W / 2, 565);
    // a few victim names
    if (trophy.victims && trophy.victims.length) {
      x.font = '20px system-ui, sans-serif'; x.fillStyle = '#7f8db0';
      var names = trophy.victims.slice(0, 5).map(function (v) { return v.username || 'opponent'; }).join('  \u2022  ');
      x.fillText(names, W / 2, 620);
    }
    // footer
    x.fillStyle = '#6b7a9c'; x.font = '20px system-ui, sans-serif';
    x.fillText('playchesstrophies.com', W / 2, H - 60);
    return cv;
  }

  function downloadBlob(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'chess-trophy.png';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  // ===========================================================================
  // TROPHY ART — tier-tinted SVG medallions with a per-family line glyph, in the
  // app's theme palette (no emoji). Returned as an <svg> string for innerHTML.
  // window.CT_trophyArt(def, unlocked, opts?) -> string
  // ===========================================================================
  // Tier color ramp (matches app.js trophyTierColors); index = tier-1, capped.
  var TIER_RAMP = [
    ['#c8794a', '#9c5126'], // 1 bronze
    ['#cfd6dd', '#8e99a6'], // 2 silver
    ['#f4c64b', '#cf9320'], // 3 gold
    ['#7fd1ff', '#3187cf'], // 4 cyan
    ['#b388ff', '#6f3bff'], // 5 violet
    ['#7af0d3', '#1fae8c'], // 6 teal
    ['#ff8fa3', '#e23a5c'], // 7 rose
    ['#ffffff', '#c9d2e3']  // 8 white/platinum
  ];
  // Line-icon glyph per family, drawn in a 0..24 box (stroked, no fill). Falls
  // back to a chess-pawn glyph for anything unmapped.
  var GLYPHS = {
    'Wins':        'M12 3 L14.6 9.4 L21.4 9.7 L16.1 13.9 L18 20.5 L12 16.6 L6 20.5 L7.9 13.9 L2.6 9.7 L9.4 9.4 Z',
    'Rating':      'M3 18 L9 11.5 L13 15 L20.5 6 M20.5 6 L15 6 M20.5 6 L20.5 11.5',
    'Streak':      'M12 2.5 C8.8 8 6.8 9.2 6.8 13.2 a5.2 5.2 0 0 0 10.4 0 C17.2 10 14.2 9 12 2.5 Z',
    'Fast Win':    'M13.5 2 L5 13.4 L11 13.4 L9.2 22 L19.5 9.2 L13.5 9.2 Z',
    'Veteran':     'M12 3 L20 6 V11.5 C20 17 16.4 20.2 12 22 C7.6 20.2 4 17 4 11.5 V6 Z',
    'Mates':       'M3.5 9 L7 15 H17 L20.5 9 L15.5 12.2 L12 5.5 L8.5 12.2 Z M7 15 V17.5 H17 V15',
    'Comeback':    'M20 12 a8 8 0 1 1 -2.4 -5.7 M20 4.5 V8 H16.5',
    'Community':   'M8.5 9 a2.4 2.4 0 1 0 0.01 0 M15.5 9 a2.4 2.4 0 1 0 0.01 0 M4.5 19 c0-3.2 2-5 4-5 M19.5 19 c0-3.2 -2-5 -4-5 M9 19 c0-3 1.4-4.2 3-4.2 c1.6 0 3 1.2 3 4.2',
    'Duo':         'M9 8.5 a2.4 2.4 0 1 0 0.01 0 M5.5 20 c0-3.6 1.6-5.6 3.5-5.6 c1.9 0 3.5 2 3.5 5.6 M15 8.5 a2.4 2.4 0 1 0 0.01 0 M11.5 20 c0-3.6 1.6-5.6 3.5-5.6 c1.9 0 3.5 2 3.5 5.6',
    'Arena':       'M8 4 H16 V8.5 a4 4 0 0 1 -8 0 Z M8 5 H5 a3 3 0 0 0 3 4 M16 5 H19 a3 3 0 0 1 -3 4 M12 12.5 V16 M9.5 20 H14.5 M10.5 16 H13.5',
    'Gauntlet':    'M3 19.5 L9 7 L12.5 13 L15.5 8 L21 19.5 Z M15.5 8 V3 L19 4.5 L15.5 6',
    'Openings':    'M12 6 C9 4.2 5.2 4.2 4 5.2 V18 C5.2 17 9 17 12 18.8 C15 17 18.8 17 20 18 V5.2 C18.8 4.2 15 4.2 12 6 Z M12 6 V18.8',
    'Puzzles':     'M12 3 a9 9 0 1 0 0.01 0 M12 7.5 a4.5 4.5 0 1 0 0.01 0 M12 11.6 a0.9 0.9 0 1 0 0.01 0',
    'Checkers':    'M12 3.5 a8.5 8.5 0 1 0 0.01 0 M12 6.8 a5.2 5.2 0 1 0 0.01 0',
    'Hidden Feats':'M9 9.2 a3 3 0 1 1 4.2 2.8 c-1.1 0.7 -1.3 1.4 -1.3 2.6 M12 18.2 h0.01',
    'Oops':        'M12 3 a9 9 0 1 0 0.01 0 M9 10 h0.01 M15 10 h0.01 M8.6 16.4 c1.6-2.2 5.2-2.2 6.8 0',
    '_pawn':       'M12 4 a2.6 2.6 0 1 0 0.01 0 M9.2 11 h5.6 M10 11 c-0.6 3 -1.8 5 -3 6.5 H17 c-1.2-1.5 -2.4-3.5 -3-6.5 M6.5 20.5 H17.5'
  };
  var _artSeq = 0;
  function trophyArt(def, unlocked, opts) {
    def = def || {}; opts = opts || {};
    var tier = Math.max(1, Math.min(8, def.tier || 1));
    var cols = unlocked ? TIER_RAMP[tier - 1] : ['#3a4150', '#272d39'];
    var light = cols[0], dark = cols[1];
    var glyph = GLYPHS[def.family] || GLYPHS['_pawn'];
    var glyphCol = unlocked ? '#0c1426' : '#5a6377';
    var id = 'ma' + (++_artSeq);
    var op = unlocked ? '1' : '0.6';
    var ribbon = unlocked
      ? '<path d="M22 46 L22 66 L30 60 L32 64 L34 60 L42 66 L42 46 Z" fill="' + dark + '" opacity="0.9"/>'
      : '';
    var lock = unlocked ? '' :
      '<g transform="translate(40,40)" opacity="0.9"><rect x="0" y="4" width="13" height="9" rx="2" fill="#1b2233" stroke="#5a6377" stroke-width="1.2"/><path d="M2.5 4 V2.5 a4 4 0 0 1 8 0 V4" fill="none" stroke="#5a6377" stroke-width="1.6"/></g>';
    return '<svg viewBox="0 0 64 70" width="100%" height="100%" style="opacity:' + op + '" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + light + '"/><stop offset="1" stop-color="' + dark + '"/>' +
      '</linearGradient>' +
      '<radialGradient id="' + id + 's" cx="0.35" cy="0.3" r="0.8">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity="' + (unlocked ? '0.45' : '0.08') + '"/>' +
      '<stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs>' +
      ribbon +
      '<circle cx="32" cy="30" r="21" fill="' + dark + '"/>' +
      '<circle cx="32" cy="30" r="19.5" fill="url(#' + id + ')" stroke="' + light + '" stroke-width="1.2"/>' +
      '<circle cx="32" cy="30" r="19.5" fill="url(#' + id + 's)"/>' +
      '<g transform="translate(20,18)" fill="none" stroke="' + glyphCol + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="' + glyph + '"/></g>' +
      lock + '</svg>';
  }

  // Generic share card for ANY trophy (non-streak). Mirrors drawCard's framing.
  function drawTrophyCard(def, unlocked) {
    def = def || {};
    var tier = Math.max(1, Math.min(8, def.tier || 1));
    var pal = TIER_RAMP[tier - 1];
    var accent = pal[0];
    var W = 600, H = 800;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var x = cv.getContext('2d');
    var bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b1220'); bg.addColorStop(1, '#161f33');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.strokeStyle = accent; x.lineWidth = 10; x.strokeRect(20, 20, W - 40, H - 40);
    x.fillStyle = '#e9eefc'; x.textAlign = 'center';
    x.font = 'bold 40px system-ui, sans-serif'; x.fillText('CHESS TROPHIES', W / 2, 92);
    x.fillStyle = accent; x.font = 'bold 30px system-ui, sans-serif';
    x.fillText((def.family || 'Trophy').toUpperCase(), W / 2, 150);
    // medal disc + glow + star
    x.save(); x.shadowColor = accent; x.shadowBlur = 50;
    x.beginPath(); x.arc(W / 2, 330, 120, 0, Math.PI * 2);
    x.fillStyle = pal[1]; x.fill(); x.restore();
    x.beginPath(); x.arc(W / 2, 330, 104, 0, Math.PI * 2); x.fillStyle = accent; x.fill();
    drawStar(x, W / 2, 330, 5, 64, 28, '#0c1426');
    // name + desc
    x.fillStyle = '#e9eefc'; x.font = 'bold 38px system-ui, sans-serif';
    x.fillText(def.name || 'Trophy', W / 2, 520);
    x.fillStyle = '#9fb0d0'; x.font = '23px system-ui, sans-serif';
    wrapText(x, def.desc || '', W / 2, 565, W - 120, 30);
    x.fillStyle = '#6b7a9c'; x.font = '20px system-ui, sans-serif';
    x.fillText('playchesstrophies.com', W / 2, H - 60);
    return cv;
  }
  function drawStar(ctx, cx, cy, points, outer, inner, fill) {
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var r = (i % 2 === 0) ? outer : inner;
      var ang = (Math.PI / points) * i - Math.PI / 2;
      var px = cx + Math.cos(ang) * r, py = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  }
  function wrapText(ctx, text, cx, y, maxW, lh) {
    var words = String(text).split(' '), line = '', lines = [];
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], cx, y + j * lh);
  }

  function shareTrophyCard(trophy) {
    try {
      // 7-win streak trophies keep their bespoke victim card; everything else
      // (the tiered achievement defs) uses the generic trophy card.
      var cv = (trophy && trophy.streakNumber != null) ? drawCard(trophy) : drawTrophyCard(trophy || {}, true);
      cv.toBlob(function (blob) {
        if (!blob) { return; }
        var file = new File([blob], 'chess-trophy.png', { type: 'image/png' });
        var title = (trophy && trophy.name) ? ('My ChessTrophies: ' + trophy.name) : 'My ChessTrophies trophy';
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: title }).catch(function () { downloadBlob(blob); });
        } else {
          downloadBlob(blob);
        }
      }, 'image/png');
    } catch (e) { if (window.console) console.warn('share card failed', e); }
  }

  window.CT_trophyRarity = rarity;
  window.CT_trophyArt = trophyArt;
  window.CT_shareTrophyCard = shareTrophyCard;
})();
