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

  function shareTrophyCard(trophy) {
    try {
      var cv = drawCard(trophy || {});
      cv.toBlob(function (blob) {
        if (!blob) { return; }
        var file = new File([blob], 'chess-trophy.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'My ChessTrophies streak trophy' }).catch(function () { downloadBlob(blob); });
        } else {
          downloadBlob(blob);
        }
      }, 'image/png');
    } catch (e) { if (window.console) console.warn('share card failed', e); }
  }
  function downloadBlob(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'chess-trophy.png';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }

  window.CT_trophyRarity = rarity;
  window.CT_shareTrophyCard = shareTrophyCard;
})();
