/* ct-auth.js — ChessTrophies storage + auth + network primitives, extracted from
 * app.js. Self-contained: talks only to localStorage/sessionStorage, fetch, and
 * crypto.subtle — no app state or DOM. app.js aliases these into local scope so
 * its call sites are unchanged. Exposed on window.CT_Auth.
 *
 * NOTE: the mutable serverFriendsCache (shared with app.js renderers) and its
 * refreshServerFriends() updater deliberately stay in app.js — a live module
 * variable can't be aliased across files.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Storage layer
  // ---------------------------------------------------------------------------
  const DB_KEY = 'chesstrophies_db_v1';
  const SESSION_KEY = 'chesstrophies_session_v1';
  const SERVER_URL = (window.CT_SERVER_URL || window.location.origin).replace(/\/$/, '');

  function loadDB() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return defaultDB();
      const db = JSON.parse(raw);
      const merged = Object.assign(defaultDB(), db);
      // Migrate user records that predate later fields
      for (const id in merged.users) {
        const u = merged.users[id];
        if (!Array.isArray(u.friends)) u.friends = [];
        if (!Array.isArray(u.streakVictims)) u.streakVictims = [];
        if (!Array.isArray(u.streakTrophies)) u.streakTrophies = [];
        if (!Array.isArray(u.achievements)) u.achievements = [];
        if (typeof u.mateWins !== 'number') u.mateWins = 0;
        if (typeof u.comebackWins !== 'number') u.comebackWins = 0;
        if (!Array.isArray(u.lessonsCompleted)) u.lessonsCompleted = [];
        if (typeof u.themeBoard !== 'string') u.themeBoard = 'forest';
        if (typeof u.themePieces !== 'string') u.themePieces = 'classic';
        if (!u.flags || typeof u.flags !== 'object') u.flags = {};
        const defaultFlags = ['underpromoWins','enPassants','queensideCastles','bareBonesWins','smotheredGiven','marathonWins','lightningWins','phoenixRises','pawnPromotions','bongcloudWins','fastLosses','sameOppLossStreak','drySpellTriggered','resignStreak','mateLossStreak','loseStreak','veryQuickLosses','pawnsOnlyLosses','doormatTriggered','coldStreakTriggered'];
        for (const k of defaultFlags) if (typeof u.flags[k] !== 'number') u.flags[k] = 0;
        if (!Array.isArray(u.invitesSent)) u.invitesSent = [];
        if (typeof u.invitesAccepted !== 'number') u.invitesAccepted = 0;
        if (typeof u.invitedBy === 'undefined') u.invitedBy = null;
        if (!u.lossesByOpponent) u.lossesByOpponent = {};
        if (typeof u.lastWinDate === 'undefined') u.lastWinDate = null;
        if (!Array.isArray(u.recentGameDays)) u.recentGameDays = [];
        if (typeof u.isPremium !== 'boolean') u.isPremium = false;
        if (typeof u.premiumSince === 'undefined') u.premiumSince = null;
      }
      if (!merged.rooms) merged.rooms = {};
      return merged;
    } catch (e) {
      return defaultDB();
    }
  }
  function saveDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }
  function defaultDB() {
    return { users: {}, rooms: {}, version: 1 };
  }
  function getSession() {
    const v = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
    if (!v) return null;
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  function setSession(s) {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }

  // Abort hung requests so the offline fallback can kick in -- but give the
  // backend room to answer a cold start (e.g. Railway free-tier wake-up can take
  // 10-20s). Too short here is what wrongly dumped freshly-signed-up users into a
  // tokenless offline account, which then breaks friends + online play.
  const API_TIMEOUT_MS = 20000;
  async function api(path, options = {}) {
    const session = getSession();
    const headers = Object.assign({}, options.headers || {});
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(SERVER_URL + path, Object.assign({ method: 'GET', signal: controller.signal }, options, { headers }));
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
      if (!res.ok) {
        const err = new Error((data && (data.error || data.message)) || 'Request failed');
        err.status = res.status; // lets callers tell a 4xx rejection from a 5xx/transient failure
        throw err;
      }
      return data;
    } catch (e) {
      if (e && e.name === 'AbortError') {
        const err = new Error('Request timed out');
        err.transient = true; // matches serverAuth's offline-fallback contract
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Attempt a server auth call, retrying once if the failure looks transient (a
  // network error or 5xx -- e.g. a Railway cold start) rather than a definitive
  // 4xx rejection. Returns the parsed body or throws; the thrown error carries
  // .status for HTTP errors and .transient === true when we gave up after a
  // connectivity/5xx failure (so callers can fall back to offline mode).
  async function serverAuth(path, body) {
    let lastErr = null;
    // Up to 3 attempts with growing backoff so a cold-starting backend doesn't
    // trip the offline fallback on the very first signup/login.
    const backoffs = [800, 2000];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await api(path, { method: 'POST', body: JSON.stringify(body) });
      } catch (e) {
        lastErr = e;
        const transient = !e.status || e.status >= 500;
        if (!transient) throw e;                 // definitive rejection -- don't retry
        if (attempt < backoffs.length) await new Promise(r => setTimeout(r, backoffs[attempt]));
      }
    }
    lastErr = lastErr || new Error('Server unreachable');
    lastErr.transient = true;
    throw lastErr;
  }

  async function fetchMe() {
    return api('/api/me');
  }

  function syncRemoteProfile(profile) {
    const db = loadDB();
    const existing = db.users[String(profile.id)] || newUser(profile.email || '', profile.username || '', profile.region || '');
    const merged = Object.assign({}, existing, {
      id: String(profile.id),
      email: profile.email || existing.email || '',
      username: profile.username || existing.username || 'Player',
      region: profile.region || existing.region || '',
      elo: Number.isFinite(profile.elo) ? profile.elo : (existing.elo || 1200),
      wins: Number.isFinite(profile.wins) ? profile.wins : (existing.wins || 0),
      losses: Number.isFinite(profile.losses) ? profile.losses : (existing.losses || 0),
      draws: Number.isFinite(profile.draws) ? profile.draws : (existing.draws || 0),
      currentStreak: Number.isFinite(profile.currentStreak) ? profile.currentStreak : (existing.currentStreak || 0),
      bestStreak: Number.isFinite(profile.bestStreak) ? profile.bestStreak : (existing.bestStreak || 0),
      invitesAccepted: Number.isFinite(profile.invitesAccepted) ? profile.invitesAccepted : (existing.invitesAccepted || 0),
      isPremium: Boolean(profile.isPremium ?? existing.isPremium),
      // Email verification is server-authoritative (soft nudge only).
      emailVerified: Boolean(profile.emailVerified ?? existing.emailVerified),
      // Avatar is server-authoritative (so it follows the user across devices and
      // is the same value opponents see). Local changes are pushed up before this.
      avatarStock: (profile.avatarStock != null) ? profile.avatarStock : (existing.avatarStock || 'av_knight'),
      avatarDataUrl: (profile.avatarDataUrl != null) ? (profile.avatarDataUrl || null) : (existing.avatarDataUrl || null),
      friends: existing.friends || [],
      streakVictims: existing.streakVictims || [],
      streakTrophies: existing.streakTrophies || [],
      achievements: existing.achievements || [],
      flags: existing.flags || {},
      themeBoard: existing.themeBoard || 'forest',
      themePieces: existing.themePieces || 'classic',
      createdAt: existing.createdAt || Date.now(),
    });
    db.users[merged.id] = merged;
    saveDB(db);
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Auth helpers
  // ---------------------------------------------------------------------------
  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(salt + ':' + password);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function randomSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function newUser(email, username, region, startingElo) {
    return {
      id: 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      email: email.toLowerCase().trim(),
      username: username.trim(),
      region: (region || '').trim(),
      elo: (function(e){ e = parseInt(e,10); if (!isFinite(e)) return 1200; return Math.max(100, Math.min(2800, e)); })(startingElo),
    ratingHistory: [(function(e){ e = parseInt(e,10); if (!isFinite(e)) return 1200; return Math.max(100, Math.min(2800, e)); })(startingElo)], // rolling ELO snapshots for the profile sparkline
    elo2v2: 1200,            // separate 2v2 (team) rating
    ratingHistory2v2: [1200],// rolling 2v2 ELO snapshots
    wins2v2: 0, losses2v2: 0, draws2v2: 0, games2v2: 0,
    currentStreak2v2: 0, bestStreak2v2: 0,
    duoSuggestAccepts: 0, duoOverrideWins: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      currentStreak: 0,
      bestStreak: 0,
      streakVictims: [], // accumulator for current streak; resets every 7
      streakTrophies: [], // [{id, awardedAt, victims: [{username, gameId, when}]}]
      achievements: [],   // [{id, awardedAt, meta?}]
      friends: [],        // array of user IDs (mutual)
      mateWins: 0,
      comebackWins: 0,
      lessonsCompleted: [],
      themeBoard: 'forest',
      themePieces: 'classic',
      isPremium: false,    // ads hidden when true (set via Upgrade flow)
      premiumSince: null,
      // Trophy tracking flags (counters consumed by Hidden + Oops trophies)
      flags: {
        underpromoWins: 0, enPassants: 0, queensideCastles: 0, bareBonesWins: 0,
        smotheredGiven: 0, marathonWins: 0, lightningWins: 0, phoenixRises: 0,
        pawnPromotions: 0, bongcloudWins: 0,
        fastLosses: 0, sameOppLossStreak: 0, drySpellTriggered: 0,
        resignStreak: 0, mateLossStreak: 0, loseStreak: 0,
        veryQuickLosses: 0, pawnsOnlyLosses: 0,
        doormatTriggered: 0, coldStreakTriggered: 0,
      },
      invitesSent: [],   // codes you've shared
      invitesAccepted: 0, // friends who joined via your link
      invitedBy: null,    // userId of person who invited me
      lossesByOpponent: {}, // username -> consecutive-loss count
      lastWinDate: null,    // timestamp of last win
      recentGameDays: [],   // ISO date strings of recent game days
      createdAt: Date.now(),
    };
  }
  function findUserByUsername(db, uname) {
    if (!uname) return null;
    const lower = uname.trim().toLowerCase();
    return Object.values(db.users).find(u => u.username.toLowerCase() === lower);
  }
  function getFriendUsers(user) {
    const db = loadDB();
    return (user.friends || []).map(id => db.users[id]).filter(Boolean);
  }
  // True when we have a real server session (token); guests fall back to local DB.
  function isServerLoggedIn() {
    var s = getSession();
    return !!(s && s.token && !s.offline);
  }

  // Add a friend by username on the server. Throws an Error with a clear message
  // (e.g. the 404 "no user with that username") that callers surface to the user.
  async function serverAddFriend(username) {
    var res = await api('/api/friends/add', { method: 'POST', body: JSON.stringify({ username: username }) });
    return (res && res.friend) || null;
  }
  async function serverSearchUsers(prefix) {
    var q = (prefix || '').trim();
    if (!q) return [];
    var res = await api('/api/users/search?q=' + encodeURIComponent(q) + '&limit=8');
    return (res && Array.isArray(res.users)) ? res.users : [];
  }

  window.CT_Auth = {
    DB_KEY, SESSION_KEY, SERVER_URL, API_TIMEOUT_MS,
    defaultDB, loadDB, saveDB, getSession, setSession,
    api, serverAuth, fetchMe, syncRemoteProfile,
    hashPassword, randomSalt, newUser, findUserByUsername,
    getFriendUsers, isServerLoggedIn, serverAddFriend, serverSearchUsers,
  };
})();
