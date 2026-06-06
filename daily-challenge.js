/* ChessTrophies — Daily Challenge + streak module
   - Each calendar day deterministically picks ONE of the verified academy
     lessons (window.CT_LESSONS) as "today's challenge". Same date => same
     lesson for every user, stable across reloads on the same day.
   - Reuses verified academy content only; introduces no new chess positions.
   - Tracks dailyStreak / dailyBest / lastDailyDate, persisted via the existing
     ct-auth saveDB pattern and ridden onto the /api/progress server sync.
   - Self-contained: exposes window.CT_Daily = { init, render, complete }.
*/
(function () {
  'use strict';
  const CT = window.CT;
  if (!CT) {
    console.error('Daily: window.CT not available');
    return;
  }

  function escapeHTML(s) {
    return (CT.escapeHTML ? CT.escapeHTML(s) : String(s == null ? '' : s)
      .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));
  }

  // -------------------- DATE + DETERMINISTIC PICK --------------------
  // Local calendar day as YYYY-MM-DD (so "today" matches the user's clock).
  function todayKey(d) {
    d = d || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  // The date BEFORE the given YYYY-MM-DD key (used for the streak transition).
  function yesterdayKeyOf(key) {
    const parts = String(key).split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() - 1);
    return todayKey(d);
  }
  // Stable string hash (FNV-1a style) -> non-negative integer.
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  // Map a date key to a lesson index in [0, count). Deterministic by date.
  function lessonIndexForDate(key, count) {
    if (!count) return 0;
    return hashStr(key) % count;
  }
  function lessonForDate(key) {
    const lessons = window.CT_LESSONS || [];
    if (!lessons.length) return null;
    return lessons[lessonIndexForDate(key, lessons.length)];
  }

  // -------------------- STREAK STATE (persisted) --------------------
  // Stored on the user record so it rides the existing ct-auth DB + the
  // /api/progress sync (see app.js gatherLocalProgress / applyServerProgress,
  // which tuck this under progress.puzzles.daily where unknown keys survive).
  function getDaily(u) {
    if (!u) return { streak: 0, best: 0, lastDate: null };
    if (!u.daily || typeof u.daily !== 'object') {
      u.daily = { streak: 0, best: 0, lastDate: null };
    }
    const d = u.daily;
    if (typeof d.streak !== 'number') d.streak = 0;
    if (typeof d.best !== 'number') d.best = 0;
    if (typeof d.lastDate !== 'string' && d.lastDate !== null) d.lastDate = null;
    return d;
  }
  function persist(u) {
    const db = CT.loadDB();
    if (db.users[u.id]) {
      db.users[u.id] = u;
      CT.saveDB(db);
    }
    if (window.CT_syncProgress) window.CT_syncProgress();
  }
  // Pure streak transition (exported for testing via window.CT_Daily._calc).
  //   completedKey === lastDate         -> no-op (already done today)
  //   lastDate === yesterday(completed) -> streak + 1
  //   otherwise                          -> streak resets to 1
  function calcStreak(prev, completedKey) {
    const cur = {
      streak: (prev && typeof prev.streak === 'number') ? prev.streak : 0,
      best: (prev && typeof prev.best === 'number') ? prev.best : 0,
      lastDate: (prev && prev.lastDate) || null,
    };
    if (cur.lastDate === completedKey) {
      return { streak: cur.streak, best: cur.best, lastDate: cur.lastDate, changed: false };
    }
    let streak;
    if (cur.lastDate && cur.lastDate === yesterdayKeyOf(completedKey)) {
      streak = cur.streak + 1;
    } else {
      streak = 1;
    }
    const best = Math.max(cur.best, streak);
    return { streak, best, lastDate: completedKey, changed: true };
  }
  const STREAK_MILESTONES = [3, 7, 30, 100];

  function isDoneToday(u) {
    const d = getDaily(u);
    return d.lastDate === todayKey();
  }

  // -------------------- PLAY UI (own board, reuses lesson content) --------------------
  // Academy.js does not expose startLesson, so we present the chosen lesson on a
  // self-contained board here, reusing CT.pieceSVG + window.Chess + the same
  // solution-check shape used by the academy. Completion credits the daily streak.
  let cur = null; // { lesson, chess, selected, legalTargets, solved }

  function moveMatchesAny(move, options) {
    return (options || []).some(o => {
      if (o.san && o.san === move.san) return true;
      if (o.from && o.to) {
        if (o.from !== move.from || o.to !== move.to) return false;
        if (o.promotion && move.promotion && o.promotion !== move.promotion) return false;
        return true;
      }
      return false;
    });
  }

  function openChallenge() {
    const u = CT.user;
    if (!u) return;
    const Chess = window.Chess;
    if (!Chess) { CT.toast('chess.js not loaded'); return; }
    const lesson = lessonForDate(todayKey());
    if (!lesson) { CT.toast('No challenge available'); return; }
    cur = {
      lesson,
      chess: new Chess(lesson.fen),
      selected: null,
      legalTargets: [],
      solved: isDoneToday(u),
    };
    const titleEl = document.getElementById('daily-title');
    if (titleEl) titleEl.textContent = lesson.title;
    const sideEl = document.getElementById('daily-side');
    if (sideEl) sideEl.textContent = (lesson.side === 'w' ? 'White' : 'Black') + ' to move';
    const descEl = document.getElementById('daily-desc');
    if (descEl) descEl.textContent = lesson.desc || '';
    const fbEl = document.getElementById('daily-feedback');
    if (fbEl) fbEl.innerHTML = cur.solved
      ? '<span style="color:var(--success);font-weight:700">✓ Already solved today — nice. Try the move again for fun.</span>'
      : '&nbsp;';
    renderBoard();
    CT.showScreen('daily');
  }

  function renderBoard() {
    const boardEl = document.getElementById('daily-board');
    if (!boardEl || !cur) return;
    boardEl.innerHTML = '';
    const FILES = ['a','b','c','d','e','f','g','h'];
    const board = cur.chess.board();
    const orientation = cur.lesson.side;
    const ranksOrder = orientation === 'w' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const filesOrder = orientation === 'w' ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
    for (const r of ranksOrder) {
      for (const f of filesOrder) {
        const isLight = (r + f) % 2 === 1;
        const name = FILES[f] + (r + 1);
        const sq = document.createElement('div');
        sq.className = 'sq ' + (isLight ? 'light' : 'dark');
        sq.dataset.sq = name;
        const piece = board[7 - r][f];
        if (piece) sq.innerHTML = CT.pieceSVG(piece.type, piece.color);
        if (cur.selected === name) sq.classList.add('selected');
        if (cur.legalTargets.includes(name)) {
          const dot = document.createElement('span');
          dot.className = piece ? 'ring' : 'dot';
          sq.appendChild(dot);
        }
        sq.addEventListener('click', () => onSquareClick(name));
        boardEl.appendChild(sq);
      }
    }
  }

  function onSquareClick(name) {
    if (!cur) return;
    const chess = cur.chess;
    const turn = chess.turn();
    const piece = chess.get(name);
    if (cur.selected) {
      if (cur.selected === name) { cur.selected = null; cur.legalTargets = []; renderBoard(); return; }
      const candidates = chess.moves({ square: cur.selected, verbose: true }).filter(m => m.to === name);
      let move;
      if (candidates.length === 1) {
        move = chess.move({ from: cur.selected, to: name });
      } else if (candidates.length > 1) {
        move = chess.move({ from: cur.selected, to: name, promotion: 'q' });
      }
      if (move) {
        evaluateMove(move);
        cur.selected = null;
        cur.legalTargets = [];
        renderBoard();
        return;
      }
      if (piece && piece.color === turn) {
        cur.selected = name;
        cur.legalTargets = chess.moves({ square: name, verbose: true }).map(m => m.to);
        renderBoard();
        return;
      }
      cur.selected = null;
      cur.legalTargets = [];
      renderBoard();
      return;
    }
    if (piece && piece.color === turn) {
      cur.selected = name;
      cur.legalTargets = chess.moves({ square: name, verbose: true }).map(m => m.to);
      renderBoard();
    }
  }

  function evaluateMove(move) {
    const fb = document.getElementById('daily-feedback');
    if (moveMatchesAny(move, cur.lesson.solution)) {
      const alreadyDone = isDoneToday(CT.user);
      if (fb) fb.innerHTML = '<span style="color:var(--success);font-weight:700">✓ Correct!</span>';
      if (!alreadyDone) complete();
    } else {
      cur.chess.undo();
      if (fb) fb.innerHTML = '<span style="color:var(--danger);font-weight:700">Not quite.</span> ' +
        '<span class="muted small">Try again.' +
        (cur.lesson.hint ? ' Hint: ' + escapeHTML(cur.lesson.hint) : '') + '</span>';
    }
  }

  // -------------------- COMPLETE + REWARD --------------------
  // Records a solve for today, advancing/resetting the streak, persisting, and
  // celebrating. Idempotent for the same day. Returns the new daily state.
  function complete() {
    const u = CT.user;
    if (!u) return null;
    const prev = getDaily(u);
    const key = todayKey();
    if (prev.lastDate === key) return prev; // already counted today
    const res = calcStreak(prev, key);
    u.daily = { streak: res.streak, best: res.best, lastDate: res.lastDate };
    persist(u);
    if (cur) cur.solved = true;
    const isMilestone = STREAK_MILESTONES.includes(res.streak);
    CT.toast(
      isMilestone
        ? '🔥 ' + res.streak + '-day streak! Daily complete'
        : 'Daily complete! 🔥 ' + res.streak + '-day streak',
      true
    );
    // Milestone celebration reuses the existing confetti hook (visual only).
    if (isMilestone && CT.ctCelebrate) {
      try { CT.ctCelebrate(res.streak >= 30 ? 'big' : 'normal'); } catch (e) {}
    }
    render();
    return u.daily;
  }

  // -------------------- LOBBY CARD --------------------
  function render() {
    const wrap = document.getElementById('daily-card');
    if (!wrap) return;
    const u = CT.user;
    if (!u) { wrap.innerHTML = ''; return; }
    const lesson = lessonForDate(todayKey());
    if (!lesson) { wrap.innerHTML = ''; return; }
    const d = getDaily(u);
    const done = isDoneToday(u);
    const streak = d.streak || 0;
    const streakLine = streak > 0
      ? '🔥 ' + streak + '-day streak' + (d.best > streak ? ' · best ' + d.best : '')
      : 'Start your streak today';
    wrap.innerHTML =
      '<div class="card daily-card" id="daily-card-inner" style="border:1px solid var(--accent);background:linear-gradient(135deg, rgba(245,196,81,.10), var(--panel));cursor:pointer">' +
        '<div class="pc-row" style="display:flex;align-items:center;gap:12px">' +
          '<div class="pc-icon" style="font-size:26px">' + (done ? '✅' : '🔥') + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="pc-title" style="font-weight:800;font-size:16px">Daily Challenge</div>' +
            '<div class="pc-desc muted small" style="margin-top:2px">' +
              (done
                ? 'Done for today — come back tomorrow to keep the streak going.'
                : escapeHTML(lesson.title)) +
            '</div>' +
            '<div class="small" style="margin-top:4px;color:var(--accent);font-weight:700">' + escapeHTML(streakLine) + '</div>' +
          '</div>' +
          '<div class="pill gold">' + (done ? 'Done ✓' : 'Play') + '</div>' +
        '</div>' +
      '</div>';
    const inner = document.getElementById('daily-card-inner');
    if (inner) inner.addEventListener('click', openChallenge);
  }

  // -------------------- INIT --------------------
  function init() {
    const back = document.getElementById('daily-back');
    if (back) back.addEventListener('click', () => CT.showScreen('lobby'));
    render();
  }

  window.CT_Daily = {
    init,
    render,
    complete,
    openChallenge,
    // Exposed for the throwaway self-test of the pure date+streak logic.
    _calc: { todayKey, yesterdayKeyOf, hashStr, lessonIndexForDate, calcStreak },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
