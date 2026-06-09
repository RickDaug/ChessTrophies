/* coach.js — ChessTrophies "Coach" card: a weekly improvement summary.
 *
 * A self-contained, dependency-free, CSP-safe client module. It does NOT edit
 * app.js / index.html. The main loop adds the <script> tag, mounts this card
 * somewhere (Profile / lobby), and handles the API base — so renderInto() is
 * designed to be called AFTER app boot.
 *
 * PUBLIC API (window.CT_Coach):
 *   renderInto(elementOrSelector)  — fetch what's available and render the card
 *                                    into the given element (or selector). Safe
 *                                    to call repeatedly; each call re-renders.
 *   open()                         — no-op hook (reserved for a future expanded
 *                                    view; present so a nav entry can call it).
 *
 * WHAT IT SURFACES (only sections the data supports — never fabricated):
 *   • Rating trend — sums recent ELO deltas from GET /api/games/recent into a
 *     "+N rating this week" headline, plus a W-L-D form strip (last ~10 games).
 *   • Puzzle progress — puzzle rating (+ recent change vs. baseline), solved
 *     count and Puzzle Rush best from GET /api/puzzles/progress.
 *   • Streak status — the daily-puzzle streak (alive / at-risk / best).
 *   • One actionable nudge — the highest-value next step the data supports.
 *
 * GRACEFUL DEGRADATION:
 *   • Guests / not-signed-in → a friendly "play a few games to unlock your
 *     stats" empty state (the authed endpoints 401 for guests; we catch that).
 *   • Any endpoint that fails or returns no usable data simply has its section
 *     skipped — we never block the whole card on one missing piece.
 *
 * DATA ACCESS:
 *   • window.CT_Auth.api(path) — the app's fetch helper (adds the bearer token,
 *     server base, JSON parsing). We use it for BOTH endpoints; it throws on
 *     non-2xx (with err.status), which we treat as "no data".
 *   • window.CT.user — optional, read-only: { elo, wins, losses, draws,
 *     currentStreak, bestStreak, playStreak, flags } for fallbacks/identity.
 */
(function () {
  'use strict';

  // --- DOM helpers -----------------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function resolveEl(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    if (target.nodeType === 1) return target;
    return null;
  }

  // --- Access to app primitives ----------------------------------------------
  // The app's authed fetch helper. Returns parsed JSON, throws on non-2xx with
  // err.status (401 for guests on authed routes). We never bundle our own auth.
  function api(path) {
    if (window.CT_Auth && typeof window.CT_Auth.api === 'function') {
      return window.CT_Auth.api(path);
    }
    return Promise.reject(new Error('CT_Auth.api unavailable'));
  }
  function currentUser() {
    try {
      if (window.CT && window.CT.user) return window.CT.user;
    } catch (e) {}
    return null;
  }
  // True only when we have a real (token-bearing) server session. Guests get the
  // empty state rather than a wall of zeros.
  function isSignedIn() {
    try {
      if (window.CT_Auth && typeof window.CT_Auth.isServerLoggedIn === 'function') {
        return !!window.CT_Auth.isServerLoggedIn();
      }
      if (window.CT_Auth && typeof window.CT_Auth.getSession === 'function') {
        var s = window.CT_Auth.getSession();
        return !!(s && s.token && !s.offline);
      }
    } catch (e) {}
    return false;
  }

  // --- Number / date formatting ----------------------------------------------
  function signed(n) { return (n > 0 ? '+' : '') + n; }
  function fmtInt(n) { return String(Math.round(n)); }
  // UTC day key 'YYYY-MM-DD' — matches the server's daily-puzzle day boundary.
  function dayKey(ts) {
    var d = (ts == null) ? new Date() : new Date(ts);
    return d.toISOString().slice(0, 10);
  }
  function yesterdayKey() {
    return dayKey(Date.now() - 24 * 3600 * 1000);
  }

  // ---------------------------------------------------------------------------
  // DATA SHAPING
  // ---------------------------------------------------------------------------

  // Turn the raw /api/games/recent rows into the user's per-game results, newest
  // first. Each game row carries white_id/black_id, winner_id, and per-side ELO
  // deltas; we resolve them from MY perspective. Returns:
  //   { games: [{ result:'W'|'L'|'D', delta:Number }...], deltaSum, w,l,d }
  // for the most recent `limit` games (default 10 for the form strip; the rating
  // trend sums over a slightly larger window).
  function shapeGames(rows, myId) {
    var out = [];
    if (!Array.isArray(rows)) return out;
    for (var i = 0; i < rows.length; i++) {
      var g = rows[i];
      if (!g) continue;
      var whiteId = String(g.white_id);
      var blackId = String(g.black_id);
      var me = String(myId);
      var iAmWhite = whiteId === me;
      var iAmBlack = blackId === me;
      if (!iAmWhite && !iAmBlack) continue; // not my game (shouldn't happen)
      // ELO delta from my side. Only rated games carry non-null deltas.
      var rawDelta = iAmWhite ? g.white_elo_delta : g.black_elo_delta;
      var hasDelta = (rawDelta != null && isFinite(Number(rawDelta)));
      var delta = hasDelta ? Number(rawDelta) : 0;
      // Result from my perspective.
      var res;
      if (g.winner_id == null || String(g.winner_id) === '') {
        res = 'D';
      } else if (String(g.winner_id) === me) {
        res = 'W';
      } else {
        res = 'L';
      }
      out.push({ result: res, delta: delta, rated: hasDelta, endedAt: g.ended_at });
    }
    return out;
  }

  // Summarize a list of shaped games (already newest-first) over a window.
  function summarizeForm(games, limit) {
    var slice = games.slice(0, limit);
    var w = 0, l = 0, d = 0;
    for (var i = 0; i < slice.length; i++) {
      if (slice[i].result === 'W') w++;
      else if (slice[i].result === 'L') l++;
      else d++;
    }
    return { games: slice, w: w, l: l, d: d, count: slice.length };
  }

  // Sum ELO deltas over the rating-trend window (rated games only).
  function sumRatingTrend(games, limit) {
    var slice = games.slice(0, limit);
    var sum = 0, n = 0;
    for (var i = 0; i < slice.length; i++) {
      if (slice[i].rated) { sum += slice[i].delta; n++; }
    }
    return { sum: sum, count: n };
  }

  // Daily-puzzle streak status from the progress payload (+ user flags fallback).
  //   alive   — solved today already
  //   at-risk — streak > 0 but not solved today (ends tonight if untouched)
  //   none    — no streak yet
  // We can tell "solved today" from progress.lastDayKey === today; if absent we
  // degrade to "at-risk" when there's a streak (honest: we can't prove it's safe).
  function streakStatus(progress) {
    var cur = (progress && typeof progress.currentStreak === 'number') ? progress.currentStreak : 0;
    var best = (progress && typeof progress.bestStreak === 'number') ? progress.bestStreak : 0;
    var last = progress && progress.lastDayKey;
    var today = dayKey();
    var solvedToday = last === today;
    var state;
    if (cur <= 0) state = 'none';
    else if (solvedToday) state = 'alive';
    else state = 'at-risk';
    return { current: cur, best: best, solvedToday: solvedToday, state: state };
  }

  // ---------------------------------------------------------------------------
  // STYLES (injected once; CSP-safe — a <style> element, no inline attrs)
  // ---------------------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('ctcoach-styles')) return;
    var css = [
      '.ctcoach{max-width:560px}',
      '.ctcoach .ctcoach-head{display:flex;align-items:center;gap:8px;margin-bottom:10px}',
      '.ctcoach .ctcoach-emoji{font-size:22px;line-height:1}',
      '.ctcoach .ctcoach-title{font-weight:800;font-size:17px}',
      '.ctcoach .ctcoach-sub{font-size:12px;opacity:.65;margin-left:auto}',
      // section rows
      '.ctcoach-sec{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid rgba(127,127,127,.16)}',
      '.ctcoach-sec:first-of-type{border-top:none}',
      '.ctcoach-ico{font-size:20px;line-height:1;width:24px;text-align:center;flex:0 0 auto}',
      '.ctcoach-body{flex:1;min-width:0}',
      '.ctcoach-line1{font-size:15px;font-weight:700;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}',
      '.ctcoach-line2{font-size:12.5px;opacity:.72;margin-top:1px}',
      '.ctcoach-num{font-variant-numeric:tabular-nums}',
      '.ctcoach-delta{font-size:13px;font-weight:800}',
      '.ctcoach-delta.up{color:#2e9e5b}',
      '.ctcoach-delta.down{color:#d4504a}',
      '.ctcoach-delta.flat{opacity:.6}',
      // W-L-D form strip
      '.ctcoach-form{display:flex;gap:3px;margin-top:6px;flex-wrap:wrap}',
      '.ctcoach-pip{width:18px;height:18px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff}',
      '.ctcoach-pip.w{background:#2e9e5b}',
      '.ctcoach-pip.l{background:#d4504a}',
      '.ctcoach-pip.d{background:#9a9a9a}',
      // nudge call-to-action
      '.ctcoach-nudge{display:flex;align-items:center;gap:10px;margin-top:12px;padding:11px 12px;border-radius:10px;background:rgba(59,110,165,.12);border:1px solid rgba(59,110,165,.28)}',
      '.ctcoach-nudge.warn{background:rgba(212,80,74,.12);border-color:rgba(212,80,74,.3)}',
      '.ctcoach-nudge-ico{font-size:20px;line-height:1}',
      '.ctcoach-nudge-txt{flex:1;font-size:13.5px;font-weight:600;line-height:1.35}',
      // empty state
      '.ctcoach-empty{text-align:center;padding:14px 8px}',
      '.ctcoach-empty-emoji{font-size:30px}',
      '.ctcoach-empty-msg{font-size:14px;opacity:.8;margin-top:6px;line-height:1.4}',
    ].join('\n');
    var style = el('style');
    style.id = 'ctcoach-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // RENDERING
  // ---------------------------------------------------------------------------

  // Build a section row: icon + a bold line + an optional muted sub-line + an
  // optional extra node (e.g. the form strip).
  function section(icon, line1Node, line2Text, extra) {
    var sec = el('div', 'ctcoach-sec');
    sec.appendChild(el('div', 'ctcoach-ico', icon));
    var body = el('div', 'ctcoach-body');
    if (line1Node) {
      if (typeof line1Node === 'string') body.appendChild(el('div', 'ctcoach-line1', line1Node));
      else body.appendChild(line1Node);
    }
    if (line2Text) body.appendChild(el('div', 'ctcoach-line2', line2Text));
    if (extra) body.appendChild(extra);
    sec.appendChild(body);
    return sec;
  }

  function deltaChip(n) {
    var chip = el('span', 'ctcoach-delta');
    if (n > 0) { chip.classList.add('up'); chip.textContent = signed(n); }
    else if (n < 0) { chip.classList.add('down'); chip.textContent = signed(n); }
    else { chip.classList.add('flat'); chip.textContent = '±0'; }
    return chip;
  }

  function formStrip(games) {
    var strip = el('div', 'ctcoach-form');
    // Show oldest→newest left→right so the most recent result is on the right
    // (the natural "current form" reading). games is newest-first, so reverse.
    var ordered = games.slice().reverse();
    for (var i = 0; i < ordered.length; i++) {
      var r = ordered[i].result.toLowerCase();
      var pip = el('span', 'ctcoach-pip ' + r, ordered[i].result);
      strip.appendChild(pip);
    }
    return strip;
  }

  // Build the rating-trend section. Returns a node or null if unsupported.
  function ratingTrendSection(shaped) {
    if (!shaped || !shaped.length) return null;
    // Trend headline: sum of rated deltas over the last ~20 games ("this week"
    // is best-effort — we don't have reliable per-row timestamps to window by
    // calendar, so we honestly frame it as "last N games").
    var trend = sumRatingTrend(shaped, 20);
    var form = summarizeForm(shaped, 10);
    var line1 = el('div', 'ctcoach-line1');
    if (trend.count > 0) {
      line1.appendChild(document.createTextNode('Rating '));
      line1.appendChild(deltaChip(trend.sum));
      var games = trend.count === 1 ? ' over your last ranked game' : ' over your last ' + trend.count + ' ranked games';
      var sub = (trend.sum > 0 ? 'Climbing.' : trend.sum < 0 ? 'A dip — bounce back.' : 'Holding steady.') + games + '.';
    } else {
      // No rated games (all casual) — still show form, but no delta headline.
      line1.appendChild(document.createTextNode('Recent form'));
      var sub = 'Play a ranked game to start tracking your rating trend.';
    }
    var sec = section('📈', line1, sub, form.count ? formStrip(form.games) : null);
    return sec;
  }

  function puzzleSection(progress) {
    if (!progress) return null;
    var rating = (typeof progress.puzzleRating === 'number') ? progress.puzzleRating : null;
    var solved = (typeof progress.totalSolved === 'number') ? progress.totalSolved
               : (typeof progress.ratingSolved === 'number') ? progress.ratingSolved : null;
    var rushBest = (typeof progress.rushBest === 'number') ? progress.rushBest : null;
    // Nothing meaningful to show? skip.
    if (rating == null && !solved && rushBest == null) return null;

    var line1 = el('div', 'ctcoach-line1');
    if (rating != null) {
      line1.appendChild(document.createTextNode('Puzzle rating '));
      var num = el('span', 'ctcoach-num', fmtInt(rating));
      num.style.fontWeight = '800';
      line1.appendChild(num);
      if (progress.provisional) {
        var prov = el('span', 'ctcoach-line2');
        prov.textContent = ' (provisional)';
        prov.style.opacity = '.6';
        prov.style.fontWeight = '600';
        line1.appendChild(prov);
      }
    } else {
      line1.appendChild(document.createTextNode('Puzzles'));
    }

    var bits = [];
    if (solved) bits.push(solved + (solved === 1 ? ' puzzle solved' : ' puzzles solved'));
    if (rushBest != null && rushBest > 0) bits.push('Rush best ' + rushBest);
    var sub = bits.join(' · ') || null;
    return section('🧩', line1, sub, null);
  }

  function streakSection(stat) {
    if (!stat || stat.current <= 0) return null; // no streak → handled by nudge instead
    var line1 = el('div', 'ctcoach-line1');
    line1.appendChild(document.createTextNode('🔥 ' + stat.current + '-day puzzle streak'));
    var sub;
    if (stat.state === 'alive') {
      sub = 'Solved today — streak safe.' + (stat.best > stat.current ? ' Best: ' + stat.best + '.' : ' This is your best yet!');
    } else {
      sub = 'Not solved today — keep it alive before midnight.' + (stat.best > stat.current ? ' Best: ' + stat.best + '.' : '');
    }
    return section('🔥', line1, sub, null);
  }

  // Pick the single highest-value nudge the data supports. Priority order is
  // tuned for retention: protect an at-risk streak first, then progress puzzles,
  // then the rating ladder, then a generic "play" prompt.
  function pickNudge(ctx) {
    var stat = ctx.streak;
    var progress = ctx.progress;
    var trend = ctx.trend; // { sum, count } over rated games, or null
    var user = ctx.user;

    // 1) At-risk daily streak — the strongest loss-aversion hook.
    if (stat && stat.state === 'at-risk') {
      return { warn: true, icon: '⏳',
        text: 'Solve today’s puzzle to keep your ' + stat.current + '-day streak alive.' };
    }
    // 2) No streak yet but they do puzzles (or are signed in) — start one.
    if (stat && stat.state === 'none' && progress) {
      return { warn: false, icon: '🧩',
        text: 'Solve today’s puzzle to start a daily streak.' };
    }
    // 3) Close to the next round-100 rating milestone — concrete ladder goal.
    if (user && typeof user.elo === 'number' && (ctx.ratedGames > 0)) {
      var elo = Math.round(user.elo);
      var nextMilestone = (Math.floor(elo / 100) + 1) * 100;
      var gap = nextMilestone - elo;
      if (gap > 0 && gap <= 35) {
        return { warn: false, icon: '🎯',
          text: 'You’re ' + gap + ' rating from ' + nextMilestone + '. Win a ranked game to get there.' };
      }
    }
    // 4) On a losing skid recently — encouraging reset.
    if (ctx.form && ctx.form.count >= 4 && ctx.form.l > ctx.form.w && ctx.form.l >= 3) {
      return { warn: false, icon: '💪',
        text: 'Rough patch — a warm-up puzzle or two sharpens you before your next ranked game.' };
    }
    // 5) Default: keep playing.
    return { warn: false, icon: '♟️',
      text: 'Play a ranked game to keep your rating moving.' };
  }

  function nudgeNode(nudge) {
    var box = el('div', 'ctcoach-nudge' + (nudge.warn ? ' warn' : ''));
    box.appendChild(el('div', 'ctcoach-nudge-ico', nudge.icon));
    box.appendChild(el('div', 'ctcoach-nudge-txt', nudge.text));
    return box;
  }

  function emptyState(mount) {
    var wrap = el('div', 'ctcoach');
    var head = el('div', 'ctcoach-head');
    head.appendChild(el('span', 'ctcoach-emoji', '🏅'));
    head.appendChild(el('span', 'ctcoach-title', 'Your Coach'));
    wrap.appendChild(head);
    var empty = el('div', 'ctcoach-empty');
    empty.appendChild(el('div', 'ctcoach-empty-emoji', '♟️'));
    empty.appendChild(el('div', 'ctcoach-empty-msg',
      'Play a few ranked games and solve a daily puzzle to unlock your weekly improvement summary.'));
    wrap.appendChild(empty);
    mount.innerHTML = '';
    mount.appendChild(wrap);
  }

  // Render the assembled card from the gathered data.
  function renderCard(mount, data) {
    var user = currentUser();
    var shaped = data.games || [];
    var progress = data.progress || null;
    var stat = progress ? streakStatus(progress) : (function () {
      // Fall back to user flags if the progress endpoint failed but the user
      // object carries a daily streak (puzzles.playStreak / flags).
      if (!user) return null;
      var ps = user.playStreak;
      if (ps && typeof ps.streak === 'number' && ps.streak > 0) {
        return { current: ps.streak, best: ps.best || ps.streak, solvedToday: false, state: 'at-risk' };
      }
      return { current: 0, best: 0, solvedToday: false, state: 'none' };
    })();

    var ratingSec = ratingTrendSection(shaped);
    var puzzleSec = puzzleSection(progress);
    var streakSec = streakSection(stat);

    // If we truly have nothing to show, fall back to the empty state.
    if (!ratingSec && !puzzleSec && !streakSec) { emptyState(mount); return; }

    var form = summarizeForm(shaped, 10);
    var trend = shaped.length ? sumRatingTrend(shaped, 20) : null;
    var ratedGames = shaped.filter(function (g) { return g.rated; }).length;
    var nudge = pickNudge({
      streak: stat, progress: progress, trend: trend, user: user,
      form: form, ratedGames: ratedGames,
    });

    var wrap = el('div', 'ctcoach');
    var head = el('div', 'ctcoach-head');
    head.appendChild(el('span', 'ctcoach-emoji', '🏅'));
    head.appendChild(el('span', 'ctcoach-title', 'Your Coach'));
    head.appendChild(el('span', 'ctcoach-sub', 'This week'));
    wrap.appendChild(head);

    if (ratingSec) wrap.appendChild(ratingSec);
    if (puzzleSec) wrap.appendChild(puzzleSec);
    if (streakSec) wrap.appendChild(streakSec);
    wrap.appendChild(nudgeNode(nudge));

    mount.innerHTML = '';
    mount.appendChild(wrap);
  }

  // ---------------------------------------------------------------------------
  // PUBLIC API
  // ---------------------------------------------------------------------------
  function renderInto(target) {
    var mount = resolveEl(target);
    if (!mount) return Promise.resolve(false);
    injectStyles();

    // Guests / not-signed-in: skip the authed fetches entirely and show the
    // friendly empty state (the endpoints would 401 anyway).
    if (!isSignedIn()) { emptyState(mount); return Promise.resolve(true); }

    // Loading placeholder so the card never flashes empty.
    mount.innerHTML = '';
    var loading = el('div', 'ctcoach');
    var lhead = el('div', 'ctcoach-head');
    lhead.appendChild(el('span', 'ctcoach-emoji', '🏅'));
    lhead.appendChild(el('span', 'ctcoach-title', 'Your Coach'));
    loading.appendChild(lhead);
    loading.appendChild(el('div', 'ctcoach-line2', 'Crunching your week…'));
    mount.appendChild(loading);

    var user = currentUser();
    var myId = user && (user.id != null) ? user.id : null;

    // Fetch both data sources independently; a failure of one must not sink the
    // other. We never reject the public promise — a fully-failed fetch just
    // yields the empty state.
    var gamesP = api('/api/games/recent').then(function (res) {
      var rows = (res && Array.isArray(res.games)) ? res.games : [];
      // If we somehow don't have an id, infer it: the id present on BOTH sides
      // across rows is ours. Best-effort; normally user.id is set.
      var id = myId != null ? myId : inferMyId(rows);
      return shapeGames(rows, id);
    }).catch(function () { return []; });

    var progressP = api('/api/puzzles/progress')
      .then(function (res) { return res || null; })
      .catch(function () { return null; });

    return Promise.all([gamesP, progressP]).then(function (vals) {
      renderCard(mount, { games: vals[0], progress: vals[1] });
      return true;
    }).catch(function () {
      // Defensive: any unexpected render error degrades to the empty state
      // rather than leaving a broken card.
      try { emptyState(mount); } catch (e) {}
      return true;
    });
  }

  // Infer the signed-in user's id from the recent-games rows when window.CT.user
  // isn't available: the player id appearing in every row (as white or black) is
  // ours. Falls back to the first row's white_id.
  function inferMyId(rows) {
    if (!rows || !rows.length) return null;
    var counts = {};
    for (var i = 0; i < rows.length; i++) {
      var w = String(rows[i].white_id), b = String(rows[i].black_id);
      counts[w] = (counts[w] || 0) + 1;
      counts[b] = (counts[b] || 0) + 1;
    }
    var best = null, bestN = -1;
    for (var k in counts) { if (counts[k] > bestN) { bestN = counts[k]; best = k; } }
    return best;
  }

  // Reserved hook for a future expanded Coach view (the nav entry can call it).
  // Intentionally a no-op for now.
  function open() { /* no-op */ }

  window.CT_Coach = {
    renderInto: renderInto,
    open: open,
  };
})();
