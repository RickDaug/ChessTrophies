/* ChessTrophies — single-file client app
   - Email/password auth (local for MVP)
   - PvP pass-and-play + matchmaking + practice vs computer
   - ELO ratings, 7-game streak trophies, achievements
   - Modern flat SVG chess pieces
*/

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Modern flat SVG chess pieces (redesigned for clear silhouettes)
  // ---------------------------------------------------------------------------
  function pieceSVG(type, color) {
    const theme = (window.CT_PIECE_THEME) || { lightFill:'#f6f3eb', lightStroke:'#262d44', lightAccent:'#3b425a', darkFill:'#1a2236', darkStroke:'#e9ecf5', darkAccent:'#cdd3e6' };
    const fill   = color === 'w' ? theme.lightFill   : theme.darkFill;
    const stroke = color === 'w' ? theme.lightStroke : theme.darkStroke;
    const accent = color === 'w' ? theme.lightAccent : theme.darkAccent;
    // Subtle highlight color for 3D-ish effect
    const hi = color === 'w' ? '#ffffff' : (theme.darkAccent || '#9aa3c1');
    const sh = color === 'w' ? '#d8d1bf' : '#0c121e'; // shadow

    const svgOpen = `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg">`;
    const svgClose = '</svg>';
    const main = (paths) => `<g fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${paths}</g>`;

    // Common base for most pieces: 3-tier stand
    const baseStand = `
      <path d="M11.5 35.5 L33.5 35.5 L33.5 37.5 L11.5 37.5 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <path d="M9 38 L36 38 L36 40 L9 40 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
      <path d="M7 40.5 L38 40.5 L38 43 L7 43 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
    `;

    switch (type) {
      case 'p': // PAWN — Staunton-style sphere head on tapered body
        return svgOpen + `
          <g stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" fill="${fill}">
            <!-- Head sphere -->
            <circle cx="22.5" cy="12" r="5.5"/>
            <!-- Neck collar -->
            <path d="M18.5 17 Q18 18 17.5 19 L27.5 19 Q27 18 26.5 17 Z"/>
            <!-- Body vase shape -->
            <path d="M17 20 C 15.5 24, 14 28, 13.5 33 L 31.5 33 C 31 28, 29.5 24, 28 20 Z"/>
            <!-- Collar ring -->
            <ellipse cx="22.5" cy="33.2" rx="9.5" ry="1.4"/>
          </g>
          ${baseStand}
        ` + svgClose;

      case 'r': // ROOK — Crenellated tower with classic banding
        return svgOpen + `
          <g stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" fill="${fill}">
            <!-- Crenellations (battlements) -->
            <path d="M9 11 L9 14 L12 14 L12 12 L15.5 12 L15.5 14 L18.5 14 L18.5 12 L22 12 L22 14 L23 14 L23 12 L26.5 12 L26.5 14 L29.5 14 L29.5 12 L33 12 L33 14 L36 14 L36 11 Z"/>
            <!-- Upper tower section -->
            <path d="M11 14.5 L34 14.5 L34 17.5 L11 17.5 Z"/>
            <!-- Body (slightly tapered) -->
            <path d="M12.5 18 L32.5 18 L31 31 L14 31 Z"/>
            <!-- Decorative middle band -->
            <path d="M12 24 L33 24 L33 26 L12 26 Z" fill="${accent}" opacity="0.3"/>
            <!-- Lower platform -->
            <path d="M11 31.5 L34 31.5 L34 34.5 L11 34.5 Z"/>
          </g>
          ${baseStand}
        ` + svgClose;

      case 'n': // KNIGHT — Stylized horse head with eye and mane
        return svgOpen + `
          <g stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" fill="${fill}">
            <!-- Main horse-head silhouette -->
            <path d="M22 9
                     C 25 9, 28 10, 30 12
                     C 33 15, 34 19, 33.5 23
                     C 33 26, 32 29, 31 32
                     L 32 35 L 13 35 L 14 32
                     C 12 29, 11.5 26, 12.5 24
                     C 13 22.5, 14 21.5, 15 21
                     L 13 19
                     C 12 17, 13 14, 15 13
                     L 19 11
                     C 20 9.5, 21 9, 22 9 Z"/>
            <!-- Mane -->
            <path d="M22 11 C 24 11, 26 12, 27 14 L 25 18 L 22 16 L 20 17 L 18 14 C 19 12, 20 11, 22 11 Z" fill="${stroke}" opacity="0.25" stroke="none"/>
            <!-- Forelock notch -->
            <path d="M14 14 L 16 13 L 17.5 15 L 16 17 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
            <!-- Eye -->
            <circle cx="20" cy="17.5" r="1.2" fill="${stroke}" stroke="none"/>
            <circle cx="19.7" cy="17.3" r="0.35" fill="${hi}" stroke="none"/>
            <!-- Nostril -->
            <ellipse cx="14.5" cy="20" rx="0.7" ry="0.5" fill="${stroke}" stroke="none"/>
          </g>
          ${baseStand}
        ` + svgClose;

      case 'b': // BISHOP — Pointed mitre with cross slit, bulbous middle
        return svgOpen + `
          <g stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" fill="${fill}">
            <!-- Pointed mitre top (with tip) -->
            <circle cx="22.5" cy="8" r="2.2"/>
            <!-- Mitre body (pointed cone) -->
            <path d="M19.5 10 C 17 14, 14 19, 14 24 C 14 27, 16 29, 18 30 L 27 30 C 29 29, 31 27, 31 24 C 31 19, 28 14, 25.5 10 Z"/>
            <!-- Cross slit on mitre -->
            <path d="M22.5 13 L 22.5 18 M 20 15.5 L 25 15.5" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" fill="none"/>
            <!-- Collar -->
            <ellipse cx="22.5" cy="30.5" rx="9" ry="1.5"/>
            <!-- Below-collar section -->
            <path d="M14 31 L 31 31 L 30 33.5 L 15 33.5 Z"/>
          </g>
          ${baseStand}
        ` + svgClose;

      case 'q': // QUEEN — 5-point crown with pearls and bulbous body
        return svgOpen + `
          <g stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" fill="${fill}">
            <!-- Crown pearls (5 orbs) -->
            <circle cx="8" cy="11" r="1.8"/>
            <circle cx="14.5" cy="8" r="1.8"/>
            <circle cx="22.5" cy="6.5" r="2"/>
            <circle cx="30.5" cy="8" r="1.8"/>
            <circle cx="37" cy="11" r="1.8"/>
            <!-- Crown spikes connecting orbs to body -->
            <path d="M 9 13 L 13 21 L 16 11 L 20 22 L 22.5 9 L 25 22 L 29 11 L 32 21 L 36 13 L 35 27 L 10 27 Z"/>
            <!-- Decorative band -->
            <path d="M11 26 L 34 26 L 34 28 L 11 28 Z" fill="${accent}" opacity="0.25"/>
            <!-- Body curve -->
            <path d="M11 28.5 L 34 28.5 L 33 32 L 12 32 Z"/>
            <!-- Collar ring -->
            <ellipse cx="22.5" cy="32.3" rx="11" ry="1.3"/>
          </g>
          ${baseStand}
        ` + svgClose;

      case 'k': // KING — Crown with cross and royal body
        return svgOpen + `
          <g stroke="${stroke}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round" fill="${fill}">
            <!-- Cross on top -->
            <path d="M22.5 4 L 22.5 11 M 19 7 L 26 7" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
            <!-- Crown band -->
            <path d="M15 12 L 18 12 L 18 14 L 27 14 L 27 12 L 30 12 L 30 17 L 15 17 Z"/>
            <!-- Crown jewel (center) -->
            <circle cx="22.5" cy="14.5" r="1.4" fill="${accent}" stroke="${stroke}" stroke-width="0.8"/>
            <!-- Body -->
            <path d="M12 17.5 C 13 22, 13 26, 14 30 L 31 30 C 32 26, 32 22, 33 17.5 Z"/>
            <!-- Decorative middle band -->
            <path d="M13 23 L 32 23 L 32 25 L 13 25 Z" fill="${accent}" opacity="0.3"/>
            <!-- Collar ring -->
            <ellipse cx="22.5" cy="30.3" rx="10.5" ry="1.4"/>
            <!-- Below collar -->
            <path d="M13 31 L 32 31 L 31 33.5 L 14 33.5 Z"/>
          </g>
          ${baseStand}
        ` + svgClose;
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Storage layer
  // ---------------------------------------------------------------------------
  const DB_KEY = 'chesstrophies_db_v1';
  const SESSION_KEY = 'chesstrophies_session_v1';
  const SERVER_URL = (window.CT_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');

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

  async function api(path, options = {}) {
    const session = getSession();
    const headers = Object.assign({}, options.headers || {});
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (session && session.token) headers.Authorization = 'Bearer ' + session.token;
    const res = await fetch(SERVER_URL + path, Object.assign({ method: 'GET' }, options, { headers }));
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && (data.error || data.message)) || 'Request failed');
    return data;
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
  function addFriendByUsername(me, username) {
    if (!username) throw new Error('Enter a username.');
    var db = loadDB();
    var friend = findUserByUsername(db, username);
    if (!friend) throw new Error('No user with that username on this device.');
    if (friend.id === me.id) throw new Error("You can't add yourself.");
    me.friends = me.friends || [];
    friend.friends = friend.friends || [];
    friend.incomingRequests = friend.incomingRequests || [];
    me.outgoingRequests = me.outgoingRequests || [];
    if (me.friends.indexOf(friend.id) !== -1) throw new Error('Already friends with ' + friend.username + '.');
    if (friend.incomingRequests.indexOf(me.id) !== -1) throw new Error('Request already sent to ' + friend.username + '.');
    // If they already requested you, accept it instead of duplicating.
    me.incomingRequests = me.incomingRequests || [];
    if (me.incomingRequests.indexOf(friend.id) !== -1) {
      db.users[me.id] = me; db.users[friend.id] = friend; saveDB(db);
      acceptFriendRequest(me, friend.id);
      return { accepted: true, username: friend.username };
    }
    friend.incomingRequests.push(me.id);
    if (me.outgoingRequests.indexOf(friend.id) === -1) me.outgoingRequests.push(friend.id);
    db.users[me.id] = me; db.users[friend.id] = friend; saveDB(db);
    return { requested: true, username: friend.username };
  }

  function acceptFriendRequest(me, requesterId) {
    var db = loadDB();
    me = db.users[me.id] || me;
    var other = db.users[requesterId];
    if (!other) throw new Error('That user no longer exists.');
    me.friends = me.friends || []; other.friends = other.friends || [];
    me.incomingRequests = (me.incomingRequests || []).filter(function(id){ return id !== requesterId; });
    other.outgoingRequests = (other.outgoingRequests || []).filter(function(id){ return id !== me.id; });
    if (me.friends.indexOf(other.id) === -1) me.friends.push(other.id);
    if (other.friends.indexOf(me.id) === -1) other.friends.push(me.id);
    db.users[me.id] = me; db.users[other.id] = other; saveDB(db);
    if (state && state.user && state.user.id === me.id) state.user = me;
  }

  function declineFriendRequest(me, requesterId) {
    var db = loadDB();
    me = db.users[me.id] || me;
    var other = db.users[requesterId];
    me.incomingRequests = (me.incomingRequests || []).filter(function(id){ return id !== requesterId; });
    if (other) other.outgoingRequests = (other.outgoingRequests || []).filter(function(id){ return id !== me.id; });
    db.users[me.id] = me; if (other) db.users[other.id] = other; saveDB(db);
    if (state && state.user && state.user.id === me.id) state.user = me;
  }
  function removeFriendById(me, friendId) {
    const db = loadDB();
    me.friends = (me.friends || []).filter(id => id !== friendId);
    const friend = db.users[friendId];
    if (friend) {
      friend.friends = (friend.friends || []).filter(id => id !== me.id);
      db.users[friendId] = friend;
    }
    db.users[me.id] = me;
    saveDB(db);
  }
  // Room codes for private matches
  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }
  function createRoom(hostId, mode) {
    const db = loadDB();
    db.rooms = db.rooms || {};
    let code;
    do { code = generateRoomCode(); } while (db.rooms[code]);
    db.rooms[code] = { code, hostId, mode, createdAt: Date.now() };
    saveDB(db);
    return code;
  }
  function updateRoom(code, patch) {
    const db = loadDB();
    db.rooms = db.rooms || {};
    if (db.rooms[code]) {
      db.rooms[code] = Object.assign({}, db.rooms[code], patch);
      saveDB(db);
    }
  }
  function getRoom(code) {
    const db = loadDB();
    return (db.rooms || {})[(code || '').toUpperCase()];
  }
  function deleteRoom(code) {
    const db = loadDB();
    if (db.rooms && db.rooms[code]) { delete db.rooms[code]; saveDB(db); }
  }
  function findUserByEmail(db, email) {
    email = email.toLowerCase().trim();
    return Object.values(db.users).find(u => u.email === email);
  }
  function isValidUsername(value) {
    return /^[a-zA-Z0-9_]{3,20}$/.test(value || '');
  }
  function isValidEmail(value) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value || '');
  }

  async function signup(email, username, password, region, startingElo) {
    const db = loadDB();
    if (!email || !username || !password) throw new Error('Please fill in all fields.');
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    if (!isValidUsername(username)) throw new Error('Username must be 3–20 letters, numbers, or underscores.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (findUserByEmail(db, email)) throw new Error('An account with that email already exists.');
    if (Object.values(db.users).some(u => u.username.toLowerCase() === username.toLowerCase()))
      throw new Error('That username is taken.');

    try {
      const params = new URLSearchParams(window.location.search);
      const invitedBy = params.get('invitedBy') || undefined;
      const { token } = await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, username, password, region, invitedBy, startingElo }),
      });
      setSession({ userId: null, token });
      const profile = await fetchMe();
      const user = syncRemoteProfile(profile);
      setSession({ userId: user.id, token });
      return user;
    } catch (serverErr) {
      // Fallback to the existing local-only path if the backend is unavailable.
    }

    const salt = randomSalt();
    const pwHash = await hashPassword(password, salt);
    const user = newUser(email, username, region, startingElo);
    user.salt = salt;
    user.pwHash = pwHash;
    try {
      const params = new URLSearchParams(window.location.search);
      const invitedById = params.get('invitedBy');
      if (invitedById && db.users[invitedById]) {
        user.invitedBy = invitedById;
        db.users[invitedById].invitesAccepted = (db.users[invitedById].invitesAccepted || 0) + 1;
      }
    } catch (e) {}
    db.users[user.id] = user;
    saveDB(db);
    setSession({ userId: user.id });
    return user;
  }
  async function login(email, password) {
    const db = loadDB();
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');

    try {
      const { token } = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSession({ userId: null, token });
      const profile = await fetchMe();
      const user = syncRemoteProfile(profile);
      setSession({ userId: user.id, token });
      return user;
    } catch (serverErr) {
      // Fallback to the existing local-only path if the backend is unavailable.
    }

    const u = findUserByEmail(db, email);
    if (!u) throw new Error('No account with that email.');
    const h = await hashPassword(password, u.salt);
    if (h !== u.pwHash) throw new Error('Incorrect password.');
    setSession({ userId: u.id });
    return u;
  }

  // ---------------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------------
  const state = {
    user: null,
    opponent: null, // { username, elo, isAI: bool, aiLevel?: 'easy'|'medium'|'hard', isGuest?: bool, userId?: string }
    game: null,     // chess.js instance
    selected: null, // square e.g. 'e2'
    legalTargets: [],
    orientation: 'w', // current user's color view
    userColor: 'w',
    lastMove: null,
    gameMode: null, // 'ranked' | 'challenge' | 'practice' | 'unranked'
    history: [],
    promotionPending: null,
    aiThinking: false,
    animatingMove: false,
  };

  // ---------------------------------------------------------------------------
  // Achievement catalog
  // ---------------------------------------------------------------------------
  const ACHIEVEMENTS = [
    { id: 'first_win', icon: '🥇', name: 'First Win', desc: 'Win your first ranked game.' },
    { id: 'first_win', icon: '🥇', name: 'First Win', desc: 'Win your first ranked game.' },
  ];

  // Tiered achievement catalog — each tier is a separate trophy and gets harder.
  const ACHIEVEMENT_TIERS = [
    // Wins
    { id: 'wins_t1',  family: 'Wins',     type: 'wins',     threshold: 1,    tier: 1, icon: '🥇', name: 'First Blood',    desc: 'Win 1 ranked game.' },
    { id: 'wins_t2',  family: 'Wins',     type: 'wins',     threshold: 5,    tier: 2, icon: '🥈', name: 'Triumphant',     desc: 'Win 5 ranked games.' },
    { id: 'wins_t3',  family: 'Wins',     type: 'wins',     threshold: 10,   tier: 3, icon: '🥉', name: 'Conqueror',      desc: 'Win 10 ranked games.' },
    { id: 'wins_t4',  family: 'Wins',     type: 'wins',     threshold: 25,   tier: 4, icon: '🏅', name: 'Dominant',       desc: 'Win 25 ranked games.' },
    { id: 'wins_t5',  family: 'Wins',     type: 'wins',     threshold: 50,   tier: 5, icon: '🎖️', name: 'Legendary',      desc: 'Win 50 ranked games.' },
    { id: 'wins_t6',  family: 'Wins',     type: 'wins',     threshold: 100,  tier: 6, icon: '👑', name: 'Master',         desc: 'Win 100 ranked games.' },
    { id: 'wins_t7',  family: 'Wins',     type: 'wins',     threshold: 250,  tier: 7, icon: '💠', name: 'Grandmaster',    desc: 'Win 250 ranked games.' },
    // Streaks
    { id: 'streak_t1',family: 'Streak',   type: 'streak',   threshold: 3,    tier: 1, icon: '🔥', name: 'On Fire',        desc: 'Win 3 in a row.' },
    { id: 'streak_t2',family: 'Streak',   type: 'streak',   threshold: 5,    tier: 2, icon: '⚡', name: 'Inferno',        desc: 'Win 5 in a row.' },
    { id: 'streak_t3',family: 'Streak',   type: 'streak',   threshold: 7,    tier: 3, icon: '☄️', name: 'Seven Saints',   desc: 'Win 7 in a row.' },
    { id: 'streak_t4',family: 'Streak',   type: 'streak',   threshold: 10,   tier: 4, icon: '🌟', name: 'Unstoppable',    desc: 'Win 10 in a row.' },
    { id: 'streak_t5',family: 'Streak',   type: 'streak',   threshold: 14,   tier: 5, icon: '✨', name: 'Double Crown',   desc: 'Win 14 in a row.' },
    { id: 'streak_t6',family: 'Streak',   type: 'streak',   threshold: 21,   tier: 6, icon: '🌠', name: 'Ascendant',      desc: 'Win 21 in a row.' },
    { id: 'streak_t7',family: 'Streak',   type: 'streak',   threshold: 30,   tier: 7, icon: '🛡️', name: 'Immortal',       desc: 'Win 30 in a row.' },
    // Rating (ELO)
    { id: 'elo_t1',   family: 'Rating',   type: 'elo',      threshold: 1300, tier: 1, icon: '📈', name: 'Climber',        desc: 'Reach 1300 ELO.' },
    { id: 'elo_t2',   family: 'Rating',   type: 'elo',      threshold: 1400, tier: 2, icon: '📈', name: 'Climber II',     desc: 'Reach 1400 ELO.' },
    { id: 'elo_t3',   family: 'Rating',   type: 'elo',      threshold: 1500, tier: 3, icon: '🚀', name: 'Rising Star',    desc: 'Reach 1500 ELO.' },
    { id: 'elo_t4',   family: 'Rating',   type: 'elo',      threshold: 1600, tier: 4, icon: '🚀', name: 'Sharp',          desc: 'Reach 1600 ELO.' },
    { id: 'elo_t5',   family: 'Rating',   type: 'elo',      threshold: 1700, tier: 5, icon: '💎', name: 'Expert',         desc: 'Reach 1700 ELO.' },
    { id: 'elo_t6',   family: 'Rating',   type: 'elo',      threshold: 1800, tier: 6, icon: '💎', name: 'Candidate',      desc: 'Reach 1800 ELO.' },
    { id: 'elo_t7',   family: 'Rating',   type: 'elo',      threshold: 2000, tier: 7, icon: '👑', name: 'Titled',         desc: 'Reach 2000 ELO.' },
    { id: 'elo_t8',   family: 'Rating',   type: 'elo',      threshold: 2200, tier: 8, icon: '🏆', name: 'Senior Master',  desc: 'Reach 2200 ELO.' },
    // Fast wins (in N moves or fewer)
    { id: 'fast_t1',  family: 'Fast Win', type: 'fast',     threshold: 30,   tier: 1, icon: '⏱️', name: 'Lightning',      desc: 'Win in ≤30 moves.' },
    { id: 'fast_t2',  family: 'Fast Win', type: 'fast',     threshold: 20,   tier: 2, icon: '⚡', name: 'Thunder',        desc: 'Win in ≤20 moves.' },
    { id: 'fast_t3',  family: 'Fast Win', type: 'fast',     threshold: 15,   tier: 3, icon: '🌪️', name: 'Blitz Master',  desc: 'Win in ≤15 moves.' },
    { id: 'fast_t4',  family: 'Fast Win', type: 'fast',     threshold: 10,   tier: 4, icon: '💥', name: 'Brilliance',     desc: 'Win in ≤10 moves.' },
    // Games played
    { id: 'games_t1', family: 'Veteran',  type: 'games',    threshold: 10,   tier: 1, icon: '🎯', name: 'Tested',         desc: 'Play 10 ranked games.' },
    { id: 'games_t2', family: 'Veteran',  type: 'games',    threshold: 50,   tier: 2, icon: '🏛️', name: 'Seasoned',       desc: 'Play 50 ranked games.' },
    { id: 'games_t3', family: 'Veteran',  type: 'games',    threshold: 100,  tier: 3, icon: '🗿', name: 'Hardened',       desc: 'Play 100 ranked games.' },
    { id: 'games_t4', family: 'Veteran',  type: 'games',    threshold: 250,  tier: 4, icon: '🌌', name: 'Eternal',        desc: 'Play 250 ranked games.' },
    // Checkmates delivered
    { id: 'mate_t1',  family: 'Mates',    type: 'mate',     threshold: 1,    tier: 1, icon: '♛', name: 'Mate Maker',      desc: 'Win 1 game by checkmate.' },
    { id: 'mate_t2',  family: 'Mates',    type: 'mate',     threshold: 5,    tier: 2, icon: '♕', name: 'Executioner',     desc: 'Win 5 games by checkmate.' },
    { id: 'mate_t3',  family: 'Mates',    type: 'mate',     threshold: 25,   tier: 3, icon: '☠️', name: 'Reaper',         desc: 'Win 25 games by checkmate.' },
    { id: 'mate_t4',  family: 'Mates',    type: 'mate',     threshold: 100,  tier: 4, icon: '🔱', name: 'Mate Machine',    desc: 'Win 100 games by checkmate.' },
    // Comebacks (won after being in check 3+ times)
    { id: 'come_t1',  family: 'Comeback', type: 'comeback', threshold: 1,    tier: 1, icon: '🛡️', name: 'Comeback Kid',   desc: 'Win after being checked 3+ times once.' },
    { id: 'come_t2',  family: 'Comeback', type: 'comeback', threshold: 5,    tier: 2, icon: '🛡️', name: 'Houdini',        desc: 'Pull off 5 dramatic comebacks.' },
    { id: 'come_t3',  family: 'Comeback', type: 'comeback', threshold: 10,   tier: 3, icon: '🦅', name: 'Phoenix',        desc: 'Pull off 10 dramatic comebacks.' },
    // Special: Community / Recruiter (rare)
    { id: 'recruit_t1', family: 'Community', type: 'invites',  threshold: 1,   tier: 1, icon: '👋', name: 'Welcoming Soul',  desc: 'Invite 1 friend who actually joins.' },
    { id: 'recruit_t2', family: 'Community', type: 'invites',  threshold: 3,   tier: 2, icon: '🤝', name: 'Connector',       desc: 'Invite 3 friends who actually join.' },
    { id: 'recruit_t3', family: 'Community', type: 'invites',  threshold: 10,  tier: 3, icon: '📨', name: 'Recruiter',       desc: 'Invite 10 friends who actually joined. Rare.' },
    // Hidden chess-feat trophies — shown as ??? until earned
    { id: 'hidden_underpromo',  family: 'Hidden Feats', type: 'flag', flag: 'underpromoWins',  threshold: 1, tier: 1, icon: '🐴', name: 'Underpromotion',   desc: 'Win by promoting to a piece other than a queen.', hidden: true },
    { id: 'hidden_en_passant',  family: 'Hidden Feats', type: 'flag', flag: 'enPassants',      threshold: 3, tier: 1, icon: '🕊️', name: 'En Passant Sage',  desc: 'Make 3 en passant captures across your games.', hidden: true },
    { id: 'hidden_queenside',   family: 'Hidden Feats', type: 'flag', flag: 'queensideCastles',threshold: 3, tier: 1, icon: '🏰', name: 'Long Castle',      desc: 'Castle queenside (O-O-O) in 3 games.', hidden: true },
    { id: 'hidden_bare_bones',  family: 'Hidden Feats', type: 'flag', flag: 'bareBonesWins',   threshold: 1, tier: 1, icon: '🦴', name: 'Bare Bones',       desc: 'Win a game with only king + one piece remaining.', hidden: true },
    { id: 'hidden_smothered',   family: 'Hidden Feats', type: 'flag', flag: 'smotheredGiven',  threshold: 1, tier: 1, icon: '😶‍🌫️', name: 'Smothered in the Wild', desc: 'Deliver smothered mate against a real opponent.', hidden: true },
    { id: 'hidden_marathon',    family: 'Hidden Feats', type: 'flag', flag: 'marathonWins',    threshold: 1, tier: 1, icon: '🏃', name: 'Marathon Runner',  desc: 'Win a game lasting 50+ full moves.', hidden: true },
    { id: 'hidden_lightning',   family: 'Hidden Feats', type: 'flag', flag: 'lightningWins',   threshold: 1, tier: 1, icon: '⚡', name: 'Lightning Strike', desc: 'Win a ranked game in 10 moves or fewer.', hidden: true },
    { id: 'hidden_phoenix',     family: 'Hidden Feats', type: 'flag', flag: 'phoenixRises',    threshold: 1, tier: 1, icon: '🔥', name: 'Phoenix Rises',    desc: 'Win immediately after losing 3 ranked games in a row.', hidden: true },
    { id: 'hidden_pawn_promo',  family: 'Hidden Feats', type: 'flag', flag: 'pawnPromotions',  threshold: 10, tier: 1, icon: '👶', name: 'Pawn Pusher',      desc: 'Promote 10 pawns across all your games.', hidden: true },
    { id: 'hidden_bongcloud',   family: 'Hidden Feats', type: 'flag', flag: 'bongcloudWins',   threshold: 1, tier: 1, icon: '☁️', name: 'The Bongcloud',    desc: 'Win after playing 1.e4 and 2.Ke2 (the Bongcloud).', hidden: true },
    // Embarrassing fail trophies
    { id: 'oops_whoops',        family: 'Oops', type: 'flag', flag: 'fastLosses',          threshold: 1, tier: 1, icon: '🤦', name: 'Whoops',                desc: 'Get checkmated in 10 moves or fewer.', embarrassing: true },
    { id: 'oops_punching_bag',  family: 'Oops', type: 'flag', flag: 'sameOppLossStreak',   threshold: 5, tier: 1, icon: '🥊', name: 'Punching Bag',          desc: 'Lose 5 ranked games in a row to the same opponent.', embarrassing: true },
    { id: 'oops_dry_spell',     family: 'Oops', type: 'flag', flag: 'drySpellTriggered',   threshold: 1, tier: 1, icon: '🏜️', name: 'Dry Spell',            desc: 'Go 7 days without a win, playing on 4+ different days.', embarrassing: true },
    { id: 'oops_resign_addict', family: 'Oops', type: 'flag', flag: 'resignStreak',        threshold: 5, tier: 1, icon: '🏳️', name: 'Quitter',              desc: 'Resign 5 games in a row.', embarrassing: true },
    { id: 'oops_mate_magnet',   family: 'Oops', type: 'flag', flag: 'mateLossStreak',      threshold: 3, tier: 1, icon: '🧲', name: 'Mate Magnet',           desc: 'Get checkmated 3 ranked games in a row.', embarrassing: true },
    { id: 'oops_flatline',      family: 'Oops', type: 'flag', flag: 'loseStreak',          threshold: 10, tier: 1, icon: '📉', name: 'Flatline',              desc: 'Lose 10 ranked games in a row.', embarrassing: true },
    { id: 'oops_quick_loss',    family: 'Oops', type: 'flag', flag: 'veryQuickLosses',     threshold: 1, tier: 1, icon: '💨', name: 'Quick Out',             desc: 'Lose a ranked game in 15 moves or fewer.', embarrassing: true },
    { id: 'oops_pawn_pusher',   family: 'Oops', type: 'flag', flag: 'pawnsOnlyLosses',     threshold: 1, tier: 1, icon: '🥖', name: 'Just Pawns',            desc: 'Lose with only pawns left (no minor or major pieces).', embarrassing: true },
    { id: 'oops_doormat',       family: 'Oops', type: 'flag', flag: 'doormatTriggered',    threshold: 1, tier: 1, icon: '😬', name: 'The Doormat',           desc: 'Drop below 25% win rate with 20+ ranked games.', embarrassing: true },
    { id: 'oops_cold_streak',   family: 'Oops', type: 'flag', flag: 'coldStreakTriggered', threshold: 1, tier: 1, icon: '🥶', name: 'Cold Streak',           desc: 'Go 30 days without a win.', embarrassing: true },
    { id: 'duo_first', family: 'Duo', type: 'duo', threshold: 1, tier: 1, icon: '🤝', name: 'Better Together', desc: 'Play your first 2v2 team match.' },
    { id: 'duo_win1', family: 'Duo', type: 'duo', threshold: 1, tier: 1, icon: '🌟', name: 'Dream Team', desc: 'Win your first 2v2 match.' },
    { id: 'duo_win10', family: 'Duo', type: 'duo', threshold: 10, tier: 2, icon: '🔥', name: 'Tag Team', desc: 'Win 10 2v2 matches.' },
    { id: 'duo_win25', family: 'Duo', type: 'duo', threshold: 25, tier: 3, icon: '⚔️', name: 'Battle Buddies', desc: 'Win 25 2v2 matches.' },
    { id: 'duo_streak3', family: 'Duo', type: 'duo', threshold: 3, tier: 2, icon: '🏃', name: 'In Sync', desc: 'Win 3 2v2 matches in a row.' },
    { id: 'duo_streak5', family: 'Duo', type: 'duo', threshold: 5, tier: 3, icon: '⚡', name: 'Unstoppable Duo', desc: 'Win 5 2v2 matches in a row.' },
    { id: 'duo_synergy', family: 'Duo', type: 'duo', threshold: 10, tier: 2, icon: '🧠', name: 'Mind Meld', desc: 'Accept 10 partner-suggested moves.' },
    { id: 'duo_maverick', family: 'Duo', type: 'duo', threshold: 20, tier: 2, icon: '🎸', name: 'Maverick', desc: 'Override your partner 20 times and still win.' },
    { id: 'duo_2400', family: 'Duo', type: 'duo', threshold: 1, tier: 3, icon: '👑', name: 'Duo Royalty', desc: 'Reach 1600 2v2 rating.' },
    { id: 'duo_comeback', family: 'Duo', type: 'duo', threshold: 1, tier: 3, icon: '🔄', name: 'Clutch Comeback', desc: 'Win a 2v2 after being down a queen.' },
  ];

  function hasAchievement(user, id) {
    user.achievements = user.achievements || [];
    return user.achievements.some(a => a.id === id);
  }
  function unlockAchievement(user, id, meta) {
    if (hasAchievement(user, id)) return null;
    user.achievements.push({ id, awardedAt: Date.now(), meta });
    const def = ACHIEVEMENT_TIERS.find(a => a.id === id) || ACHIEVEMENTS.find(a => a.id === id);
    // Play a sound when a trophy is earned: triumphant for normal trophies,
    // a not-so-triumphant cue for embarrassing (Oops) trophies. Purely cosmetic;
    // does not affect which trophies are granted or how they are stored.
    try {
      if (window.ChessSounds) {
        if (def && def.embarrassing) window.ChessSounds.trophyOops();
        else window.ChessSounds.trophy();
      }
    } catch (e) {}
    return def;
  }
  // Check every tier — unlock anything newly eligible.
  // ctx may include { mateWin, justWon, moves, gameCheckCount }
  function checkAchievementsFor(user, ctx) {
    const newly = [];
    for (const a of ACHIEVEMENT_TIERS) {
      if (hasAchievement(user, a.id)) continue;
      let ok = false;
      switch (a.type) {
        case 'wins':     ok = user.wins >= a.threshold; break;
        case 'streak':   ok = user.currentStreak >= a.threshold; break;
        case 'elo':      ok = user.elo >= a.threshold; break;
        case 'games':    ok = (user.wins + user.losses + user.draws) >= a.threshold; break;
        case 'mate':     ok = (user.mateWins || 0) >= a.threshold; break;
        case 'fast':     ok = !!(ctx && ctx.justWon) && (ctx.moves != null && ctx.moves <= a.threshold); break;
        case 'comeback': ok = (user.comebackWins || 0) >= a.threshold; break;
        case 'invites':  ok = (user.invitesAccepted || 0) >= a.threshold; break;
        case 'flag':     ok = !!(user.flags && (user.flags[a.flag] || 0) >= a.threshold); break;
      }
      if (ok) {
        const def = unlockAchievement(user, a.id);
        if (def) newly.push(def);
      }
    }
    return newly;
  }
  function tierColor(tier) {
    return ['#cd7f32','#9aa0b3','#f5c451','#7dd4ff','#c084fc','#34d399','#fb7185','#ffffff'][Math.min((tier || 1) - 1, 7)];
  }

  // ---------------------------------------------------------------------------
  // ELO
  // ---------------------------------------------------------------------------
  // Dynamic K-factor (FIDE/USCF style): new players converge fast,
  // established players stay stable, masters move slowly.
  //   < 30 rated games  -> K = 40 (provisional)
  //   rating >= 2400     -> K = 10 (master)
  //   otherwise          -> K = 20 (established)
  function eloKFactor(rating, gamesPlayed) {
    if ((gamesPlayed || 0) < 30) return 40;
    if ((rating || 0) >= 2400) return 10;
    return 20;
  }
  function eloDelta(ratingA, ratingB, scoreA, gamesA) {
    const K = eloKFactor(ratingA, gamesA);
    const expected = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    return Math.round(K * (scoreA - expected));
  }

  // ---------------------------------------------------------------------------
  // ADS FRAMEWORK
  // ---------------------------------------------------------------------------
  // Industry-standard ad slot system. Free users see placeholder ads; premium users
  // (state.user.isPremium === true) see nothing.
  //
  // TO INTEGRATE A REAL AD NETWORK (Google AdSense / AdMob / Carbon / etc.):
  //   1. Replace the inner HTML of renderAdSlot() with your provider's snippet.
  //   2. Make sure the early-return for state.user.isPremium stays at the top.
  //   3. For AdSense banner: <ins class="adsbygoogle" style="display:block"
  //        data-ad-client="ca-pub-XXX" data-ad-slot="XXX"
  //        data-ad-format="auto" data-full-width-responsive="true"></ins>
  //        + push to (adsbygoogle = window.adsbygoogle || []).push({});
  //   4. For AdMob (Cordova/Capacitor): call admob.banner.show() in renderLobby etc.
  //   5. For rewarded ads (e.g. give a hint after watching), call your provider's
  //      rewarded API and on success call CT_grantReward(type).
  function renderAdSlot(type) {
    if (state.user && state.user.isPremium) return '';
    const cfg = {
      banner: { label: 'Sponsored', size: '320×50',  copy: 'Your brand here. Premium players never see this.' },
      medium: { label: 'Sponsored', size: '300×250', copy: 'Sponsored — upgrade to Premium to remove all ads.' },
      native: { label: 'Sponsored', size: 'Native',  copy: 'A relevant chess product or learning resource could appear here.' },
    }[type] || { label: 'Sponsored', size: 'Banner', copy: 'Ad placeholder' };
    return `<div class="ad-slot ad-${type}" data-ad-type="${type}">
      <div class="ad-label">${cfg.label} · ${cfg.size}</div>
      <div class="ad-body">
        <div class="ad-copy">${cfg.copy}</div>
        <button class="ad-upgrade" onclick="window.CT && window.CT.openPremium()">Remove ads</button>
      </div>
    </div>`;
  }

  function openPremium() {
    const isPremium = state.user && state.user.isPremium;
    const buyBtn = $('#btn-premium-buy');
    const cancelBtn = $('#btn-premium-cancel-paid');
    if (buyBtn) {
      buyBtn.style.display = isPremium ? 'none' : '';
      buyBtn.textContent = 'Upgrade · $4.99/mo';
    }
    if (cancelBtn) cancelBtn.style.display = isPremium ? '' : 'none';
    openModal('premium');
  }
  function setPremium(value) {
    state.user.isPremium = !!value;
    state.user.premiumSince = value ? Date.now() : null;
    const db = loadDB();
    db.users[state.user.id] = state.user;
    saveDB(db);
    toast(value ? 'Premium activated 🎉 ads removed' : 'Premium cancelled', true);
    // Refresh whichever screen is visible
    if ($('#screen-lobby').classList.contains('active')) renderLobby();
    if ($('#screen-rankings').classList.contains('active') && typeof renderRankings === 'function') renderRankings();
    if ($('#screen-trophies').classList.contains('active') && typeof renderTrophies === 'function') renderTrophies();
  }

  // ---------------------------------------------------------------------------
  // Screen / nav
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function showScreen(id) {
    // Warn before leaving an in-progress 2v2 match
    if (id !== 'duo' && window.Duo && window.__duo && window.__duo.game && !window.__duo.ended && !window.__duo.over && document.querySelector('#screen-duo.active')) {
      if (!window.Duo.quit()) return;
    }
    // Warn before leaving an in-progress match (acts as a forfeit if confirmed)
    if (id !== 'game' && state.game && !state.gameEnded && document.querySelector('#screen-game.active')) {
      if (!confirm('Are you sure you want to quit this match?\n\nLeaving now counts as a resignation — you will forfeit the game.')) return;
      finishGame(state.userColor === 'w' ? 'b' : 'w', 'resignation');
      return;
    }
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#screen-' + id).classList.add('active');
    $$('#bottom-nav .nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.nav === id);
    });
    window.scrollTo(0, 0);
    if (id === 'lobby') renderLobby();
    if (id === 'profile') renderProfile();
    if (id === 'rankings') renderRankings();
    if (id === 'trophies') renderTrophies();
    if (id === 'friends') { renderFriendsList(); }
    // Academy lives in academy.js; it exposes window.CT_renderAcademy to populate #academy-content on demand.
    if (id === 'academy' && window.CT_renderAcademy) window.CT_renderAcademy();
    if (id === 'settings') { /* settings already rendered statically */ }
  }

  function showNav(visible) {
    $('#bottom-nav').classList.toggle('show', visible);
  }

  function ctCelebrate(intensity) {
    // Lightweight confetti burst for trophy/streak celebrations. Visual only.
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      var count = intensity === 'big' ? 90 : 55;
      var layer = document.getElementById('ct-confetti');
      if (!layer) { layer = document.createElement('div'); layer.id = 'ct-confetti'; document.body.appendChild(layer); }
      var colors = ['#f5c451','#7dd4ff','#c084fc','#34d399','#fb7185','#ffffff'];
      var frag = document.createDocumentFragment();
      for (var i = 0; i < count; i++) {
        var p = document.createElement('div');
        p.className = 'ct-confetti-piece';
        p.style.left = (Math.random() * 100) + 'vw';
        p.style.background = colors[(Math.random() * colors.length) | 0];
        var dur = 1.6 + Math.random() * 1.6;
        p.style.animationDuration = dur + 's';
        p.style.animationDelay = (Math.random() * 0.35) + 's';
        if (Math.random() < 0.5) p.style.borderRadius = '50%';
        frag.appendChild(p);
        (function(el){ setTimeout(function(){ if (el && el.parentNode) el.parentNode.removeChild(el); }, (dur + 0.6) * 1000); })(p);
      }
      layer.appendChild(frag);
    } catch (e) {}
  }
  function toast(msg, gold) {
    const div = document.createElement('div');
    div.className = 'toast' + (gold ? ' gold' : '');
    // Use textContent here because toast messages may contain user-controlled text.
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.style.opacity = '0', 2400);
    setTimeout(() => div.remove(), 2800);
  }

  function openModal(id) { $('#modal-' + id).classList.add('show'); }
  function closeModal(id) { $('#modal-' + id).classList.remove('show'); }

  // ---------------------------------------------------------------------------
  // Auth UI
  // ---------------------------------------------------------------------------
  $$('#screen-auth .tab').forEach(t => {
    t.addEventListener('click', () => {
      $$('#screen-auth .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const which = t.dataset.tab;
      $('#form-login').style.display = which === 'login' ? '' : 'none';
      $('#form-signup').style.display = which === 'signup' ? '' : 'none';
    });
  });

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    try {
      const u = await login($('#login-email').value, $('#login-password').value);
      setSession({ userId: u.id });
      state.user = u;
      enterApp();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  $('#form-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#signup-error').textContent = '';
    try {
      const u = await signup(
        $('#signup-email').value,
        $('#signup-username').value,
        $('#signup-password').value,
        $('#signup-region').value,
          $('#signup-skill') ? parseInt($('#signup-skill').value, 10) : 1200
      );
      setSession({ userId: u.id });
      state.user = u;
      toast('Welcome, ' + u.username + ' 👑', true);
      enterApp();
    } catch (err) {
      $('#signup-error').textContent = err.message;
    }
  });

  // Sound toggle
  if ($('#btn-sound')) {
    const updateLabel = () => { $('#btn-sound').textContent = (window.ChessSounds && window.ChessSounds.isMuted()) ? '🔇' : '🔊'; };
    updateLabel();
    $('#btn-sound').addEventListener('click', () => {
      if (window.ChessSounds) window.ChessSounds.toggle();
      updateLabel();
      toast((window.ChessSounds && window.ChessSounds.isMuted()) ? 'Sounds off' : 'Sounds on');
    });
  }

  $('#btn-logout').addEventListener('click', () => {
    setSession(null);
    state.user = null;
    showNav(false);
    showScreen('auth');
  });

  // ---------------------------------------------------------------------------
  // Lobby
  // ---------------------------------------------------------------------------
  function renderLobby() {
  if (!state.user) return;
    const u = state.user;
    $('#lobby-avatar').textContent = u.username[0].toUpperCase();
    $('#lobby-name').textContent = u.username;
    $('#lobby-region').textContent = u.region || 'No region set';
    $('#stat-elo').textContent = u.elo;
    $('#stat-wins').textContent = u.wins;
    $('#stat-streak').textContent = u.currentStreak;
    const totalTrophies = u.streakTrophies.length + u.achievements.length;
    const _lts = $('#lobby-trophy-summary'); if (_lts) _lts.textContent =
      totalTrophies === 0 ? 'No trophies yet — start a match' :
      `${u.streakTrophies.length} streak ${u.streakTrophies.length === 1 ? 'trophy' : 'trophies'} · ${u.achievements.length} achievements`;
    renderFriendsSummary();
    // Inject ad slot (or empty for premium users)
    const adWrap = $('#lobby-ad-slot');
    if (adWrap) adWrap.innerHTML = renderAdSlot('banner');
    // Show/hide Premium upgrade card based on status
    const upWrap = $('#lobby-premium-card');
    if (upWrap) upWrap.style.display = u.isPremium ? 'none' : '';
    const premiumBadge = $('#premium-badge');
    if (premiumBadge) premiumBadge.style.display = u.isPremium ? '' : 'none';
  }
  function _addLobbyChatButton() {
  const user = state.user;
  if (user) {
    addChatButton('lobby_global', 'Lobby Chat');
  } else {
    removeChatButton();
  }
}

function renderFriendsSummary() {
    var wrap = $('#lobby-friends-summary');
    if (!wrap) return;
    var db = loadDB();
    var me = db.users[state.user.id] || state.user;
    var incoming = (me.incomingRequests || []).map(function(id){ return db.users[id]; }).filter(Boolean);
    var friends = (me.friends || []).map(function(id){ return db.users[id]; }).filter(Boolean);
    if (friends.length || incoming.length) {
      wrap.textContent = friends.length + ' friend' + (friends.length === 1 ? '' : 's') +
        (incoming.length ? ' · ' + incoming.length + ' request' + (incoming.length === 1 ? '' : 's') : '');
    } else {
      wrap.textContent = 'No friends yet — add one in Friends';
    }
  }

  function renderFriendsList() {
  if (!state.user) return;
    var wrap = $('#friends-list');
    if (!wrap) return;
    var db = loadDB();
    var me = db.users[state.user.id] || state.user;
    var incoming = (me.incomingRequests || []).map(function(id){ return db.users[id]; }).filter(Boolean);
    var friends = (me.friends || []).map(function(id){ return db.users[id]; }).filter(Boolean);
    var html = '';
    if (incoming.length) {
      html += '<div class="muted small" style="text-transform:uppercase;letter-spacing:.6px;margin:4px 0 6px;">Friend requests</div>';
      html += incoming.map(function(u){
        return '<div class="friend-row" data-req-id="' + u.id + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--panel-2);border-radius:10px;margin-bottom:8px;">' +
          (typeof getAvatarHTML === 'function' ? getAvatarHTML(u, 34) : '') +
          '<div style="flex:1;min-width:0;"><div style="font-weight:600;">' + escapeHTML(u.username) + '</div>' +
          '<div class="muted small">wants to be friends</div></div>' +
          '<button class="btn-accept-req" data-id="' + u.id + '" style="background:var(--accent);color:#1a1d24;border:none;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;">Accept</button>' +
          '<button class="btn-decline-req" data-id="' + u.id + '" style="background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;">Decline</button>' +
          '</div>';
      }).join('');
    }
    html += '<div class="muted small" style="text-transform:uppercase;letter-spacing:.6px;margin:10px 0 6px;">Your friends</div>';
    if (!friends.length) {
      html += '<div class="muted small" style="padding:8px 2px;">No friends yet. Search by username above to send a request.</div>';
    } else {
      html += friends.map(function(f){
        return '<div class="friend-row" data-friend-id="' + f.id + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--panel-2);border-radius:10px;margin-bottom:8px;cursor:pointer;">' +
          (typeof getAvatarHTML === 'function' ? getAvatarHTML(f, 34) : '') +
          '<div style="flex:1;min-width:0;"><div style="font-weight:600;">' + escapeHTML(f.username) + '</div>' +
          '<div class="muted small">ELO ' + f.elo + ' \u00b7 ' + (f.wins||0) + 'W ' + (f.losses||0) + 'L</div></div>' +
          '<div class="pill gold">Challenge</div></div>';
      }).join('');
    }
    wrap.innerHTML = html;
    renderFriendsSummary();
    $$('#friends-list [data-friend-id]').forEach(function(row){
      row.addEventListener('click', function(){ openFriendChallenge(row.dataset.friendId); });
    });
    $$('#friends-list .btn-accept-req').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); acceptFriendRequest(state.user, b.dataset.id); toast('Friend added \ud83e\udd1d'); renderFriendsList(); });
    });
    $$('#friends-list .btn-decline-req').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); declineFriendRequest(state.user, b.dataset.id); renderFriendsList(); });
    });
  }

  $('#btn-new-match').addEventListener('click', () => {
    // Challenge a player = ranked online matchmaking vs a similar-ELO opponent
    state.pendingChallenge = null;
    findMatch();
  });
  $('#btn-find-match').addEventListener('click', () => findMatch());
    // 2v2 lobby buttons
    { const b = $('#btn-duo-ranked'); if (b) b.addEventListener('click', () => { try { window.Duo.startRanked(); } catch(e){ console.error(e); } }); }
    { const b = $('#duo-quit'); if (b) b.addEventListener('click', () => { if (window.Duo.quit()) { window.__duo.game = null; showScreen('lobby'); } }); }
  const practiceEloInput = $('#practice-elo');
  const practiceEloLabel = $('#practice-elo-label');
  const practiceStartButton = $('#btn-start-practice');
  if (practiceEloInput && practiceEloLabel) {
    const updateEloLabel = () => { practiceEloLabel.textContent = clampElo(practiceEloInput.value); };
    updateEloLabel();
    practiceEloInput.addEventListener('input', updateEloLabel);
  }
  if (practiceStartButton && practiceEloInput) {
    practiceStartButton.addEventListener('click', () => startPracticeGame(practiceEloInput.value));
  }

  // Friends
  $('#btn-add-friend').addEventListener('click', () => {
    $('#friend-username').value = '';
    $('#friend-error').textContent = '';
    openModal('add-friend');
    setTimeout(() => $('#friend-username').focus(), 100);
  });
  $('#btn-friend-cancel').addEventListener('click', () => closeModal('add-friend'));
  $('#btn-friend-add').addEventListener('click', () => {
    $('#friend-error').textContent = '';
    try {
      const friend = addFriendByUsername(state.user, $('#friend-username').value);
      // Refresh state.user from DB
      const db = loadDB();
      state.user = db.users[state.user.id];
      closeModal('add-friend');
      toast('Added ' + friend.username + ' 🤝');
      renderFriendsList();
    } catch (err) {
      $('#friend-error').textContent = err.message;
    }
  });

  function openFriendChallenge(friendId) {
    const db = loadDB();
    const friend = db.users[friendId];
    if (!friend) return;
    state.selectedFriendId = friendId;
    $('#fc-title').textContent = 'Challenge ' + friend.username;
    $('#fc-sub').textContent = 'ELO ' + friend.elo + ' · ' + (friend.region || 'no region') + ' · friend will be your 2v2 teammate';
    openModal('friend-challenge');
  }
  $('#btn-fc-friendly').addEventListener('click', () => {
    closeModal('friend-challenge');
    startFriendChallenge('friendly');
  });
  $('#btn-fc-ranked').addEventListener('click', () => {
    closeModal('friend-challenge');
    startFriendChallenge('ranked');
  });
  $('#btn-fc-remove').addEventListener('click', () => {
    if (!confirm('Remove this friend?')) return;
    removeFriendById(state.user, state.selectedFriendId);
    const db = loadDB();
    state.user = db.users[state.user.id];
    closeModal('friend-challenge');
    renderFriendsList();
    toast('Friend removed');
  });
  $('#btn-fc-cancel').addEventListener('click', () => closeModal('friend-challenge'));

  function startFriendChallenge(mode) {
    var db = loadDB();
    var friend = db.users[state.selectedFriendId];
    if (!friend) return;
    closeModal('friend-challenge');
    if (mode === 'ranked') {
      duoStart({ ranked: true, teammateId: friend.id, teammateName: friend.username, teammateIsAI: false, aiLevel: 'medium' });
      return;
    }
    state.opponent = {
      id: friend.id,
      username: friend.username,
      elo: friend.elo,
      avatar: friend.avatar,
      avatarStock: friend.avatarStock,
      isAI: false,
      isGuest: false
    };
    state.pendingChallenge = null;
    startGame('unranked');
  }

  // Private rooms
  $('#btn-create-room').addEventListener('click', () => {
    state.currentRoom = { mode: 'friendly', code: createRoom(state.user.id, 'friendly') };
    $('#room-code').textContent = state.currentRoom.code;
    $('#room-mode-label').textContent = "Friendly · doesn't count";
    $('#btn-room-toggle').textContent = 'Switch to ranked';
    openModal('create-room');
  });
  $('#btn-room-toggle').addEventListener('click', () => {
    if (!state.currentRoom) return;
    state.currentRoom.mode = state.currentRoom.mode === 'friendly' ? 'ranked' : 'friendly';
    updateRoom(state.currentRoom.code, { mode: state.currentRoom.mode });
    $('#room-mode-label').textContent = state.currentRoom.mode === 'friendly'
      ? "Friendly · doesn't count" : 'Ranked · affects ELO';
    $('#btn-room-toggle').textContent = state.currentRoom.mode === 'friendly'
      ? 'Switch to ranked' : 'Switch to friendly';
  });
  $('#btn-room-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.currentRoom.code);
      toast('Copied!');
    } catch (e) {
      toast('Code: ' + state.currentRoom.code);
    }
  });
  $('#btn-room-start').addEventListener('click', () => {
    // Host needs opponent to sign in on this device
    closeModal('create-room');
    state.pendingChallenge = { mode: state.currentRoom.mode, roomCode: state.currentRoom.code };
    $('#opp-email').value = '';
    $('#opp-password').value = '';
    $('#opp-error').textContent = '';
    openModal('opponent');
  });
  $('#btn-room-cancel').addEventListener('click', () => {
    if (state.currentRoom) deleteRoom(state.currentRoom.code);
    state.currentRoom = null;
    closeModal('create-room');
  });

  // Invite & Share — one-click flow that creates a room + shows shareable link/code
  let currentInvite = null;
  $('#btn-invite').addEventListener('click', () => {
    const code = createRoom(state.user.id, 'friendly');
    currentInvite = { code, mode: 'friendly' };
    state.user.invitesSent = state.user.invitesSent || [];
    state.user.invitesSent.push(code);
    const db = loadDB(); db.users[state.user.id] = state.user; saveDB(db);
    const baseUrl = window.location.href.split('?')[0];
    const url = baseUrl + '?join=' + code + '&invitedBy=' + encodeURIComponent(state.user.id);
    $('#invite-code').textContent = code;
    $('#invite-link').textContent = url;
    $('#btn-invite-toggle').textContent = 'Switch to ranked';
    openModal('invite');
  });
  $('#btn-invite-toggle').addEventListener('click', () => {
    if (!currentInvite) return;
    currentInvite.mode = currentInvite.mode === 'friendly' ? 'ranked' : 'friendly';
    updateRoom(currentInvite.code, { mode: currentInvite.mode });
    $('#btn-invite-toggle').textContent = currentInvite.mode === 'friendly' ? 'Switch to ranked' : 'Switch to friendly';
    toast(currentInvite.mode === 'friendly' ? 'Friendly mode — doesn\'t count' : 'Ranked mode — affects ELO');
  });
  $('#btn-invite-share').addEventListener('click', async () => {
    if (!currentInvite) return;
    const url = $('#invite-link').textContent;
    const text = `Play me on ChessTrophies! Code: ${currentInvite.code}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ChessTrophies Match', text, url });
      } catch (e) { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(text + '\n' + url);
        toast('Copied invite to clipboard');
      } catch (e) {
        toast('Code: ' + currentInvite.code);
      }
    }
  });
  $('#btn-invite-copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#invite-link').textContent);
      toast('Link copied!');
    } catch (e) { toast('Link: ' + $('#invite-link').textContent); }
  });
  $('#btn-invite-copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentInvite.code);
      toast('Code copied!');
    } catch (e) { toast('Code: ' + currentInvite.code); }
  });
  $('#btn-invite-cancel').addEventListener('click', () => { closeModal('invite'); });

  $('#btn-join-room').addEventListener('click', () => {
    $('#join-code').value = '';
    $('#join-error').textContent = '';
    openModal('join-room');
    setTimeout(() => $('#join-code').focus(), 100);
  });
  $('#btn-join-cancel').addEventListener('click', () => closeModal('join-room'));
  $('#btn-join-go').addEventListener('click', () => {
    const code = ($('#join-code').value || '').toUpperCase().trim();
    $('#join-error').textContent = '';
    const room = getRoom(code);
    if (!room) { $('#join-error').textContent = 'No room with that code.'; return; }
    if (room.hostId === state.user.id) { $('#join-error').textContent = "That's your own room. Have your opponent sign in first."; return; }
    const db = loadDB();
    const host = db.users[room.hostId];
    if (!host) { $('#join-error').textContent = 'Host not found.'; return; }
    closeModal('join-room');
    // Set up game: you are the joiner; host is opponent
    state.opponent = { username: host.username, elo: host.elo, isAI: false, userId: host.id };
    deleteRoom(code);
    startGame(room.mode === 'ranked' ? 'ranked' : 'friendly');
  });
  $$('[data-go]').forEach(el => {
    el.addEventListener('click', () => showScreen(el.dataset.go));
  });
  $$('#bottom-nav .nav-item').forEach(n => {
    n.addEventListener('click', () => showScreen(n.dataset.nav));
  });

  // ---------------------------------------------------------------------------
  // Matchmaking
  // ---------------------------------------------------------------------------
  function findMatch() {
    const db = loadDB();
    const me = state.user;
    const candidates = Object.values(db.users).filter(u => u.id !== me.id);
    // Progressive matchmaking: start tight (±100), then widen so players at the
    // rating extremes are not left without an opponent. Picks the closest available.
    const bands = [100, 200, 400, Infinity];
    let pool = [];
    for (let bi = 0; bi < bands.length; bi++) {
      pool = candidates.filter(u => Math.abs(u.elo - me.elo) <= bands[bi]);
      if (pool.length > 0) break;
    }
    if (pool.length === 0) {
      toast('No ranked players available — try Practice vs Computer.');
      return;
    }
    // Pick the closest in ELO with a bit of randomness
    pool.sort((a, b) => Math.abs(a.elo - me.elo) - Math.abs(b.elo - me.elo));
    const opp = pool[Math.min(pool.length - 1, Math.floor(Math.random() * 3))];
    // Ask Player 2 to sign in to confirm (in MVP since accounts are local, we ask for password)
    $('#opp-email').value = opp.email;
    $('#opp-password').value = '';
    $('#opp-error').textContent = '';
    openModal('opponent');
    toast('Matched with ' + opp.username + ' (ELO ' + opp.elo + ') — please sign in.', true);
  }

  $('#btn-opp-signin').addEventListener('click', async () => {
    $('#opp-error').textContent = '';
    try {
      const opp = await login($('#opp-email').value, $('#opp-password').value);
      if (opp.id === state.user.id) throw new Error("You can't play yourself.");
      state.opponent = { username: opp.username, elo: opp.elo, isAI: false, userId: opp.id };
      closeModal('opponent');
      // Decide game mode based on pending challenge if any
      let mode = 'ranked';
      if (state.pendingChallenge) {
        // For friend challenges, validate that opponent is the chosen friend if set
        if (state.pendingChallenge.friendId && state.pendingChallenge.friendId !== opp.id) {
          throw new Error('Sign in as the friend you challenged.');
        }
        if (state.pendingChallenge.roomCode) deleteRoom(state.pendingChallenge.roomCode);
        mode = state.pendingChallenge.mode === 'friendly' ? 'friendly' : 'ranked';
        state.pendingChallenge = null;
      }
      startGame(mode);
    } catch (err) {
      $('#opp-error').textContent = err.message;
    }
  });
  $('#btn-opp-guest').addEventListener('click', () => {
    state.opponent = { username: 'Guest', elo: state.user.elo, isAI: false, isGuest: true };
    closeModal('opponent');
    state.pendingChallenge = null;
    startGame('unranked');
  });
  $('#btn-opp-cancel').addEventListener('click', () => closeModal('opponent'));

  // ---------------------------------------------------------------------------
  // Practice vs computer
  // ---------------------------------------------------------------------------
  function clampElo(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1200;
    return Math.max(100, Math.min(2800, Math.round(parsed / 100) * 100));
  }

  function aiNameForElo(elo) {
    if (elo >= 2500) return 'Grandmaster';
    if (elo >= 2300) return 'International Master';
    if (elo >= 2100) return 'Expert';
    if (elo >= 1800) return 'Strong';
    if (elo >= 1500) return 'Intermediate';
    if (elo >= 1200) return 'Club';
    return 'Beginner';
  }

  function getAIDifficultyForElo(value) {
    if (typeof value === 'string') {
      if (value === 'easy') return { aiElo: 800 };
      if (value === 'medium') return { aiElo: 1300 };
      if (value === 'hard') return { aiElo: 1800 };
    }
    return { aiElo: clampElo(value) };
  }

  function startPracticeGame(level) {
    const { aiElo } = getAIDifficultyForElo(level);
    state.opponent = {
      username: 'Computer (' + aiNameForElo(aiElo) + ')',
      elo: aiElo,
      isAI: true,
      aiElo,
    };
    startGame('practice');
  }

  // ---------------------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------------------
  function startGame(mode) {
    state.gameMode = mode;
    state.game = new Chess();
    state.gameEnded = false;
    state.selected = null;
    state.legalTargets = [];
    state.lastMove = null;
    state.history = [];
    state.userColor = Math.random() < 0.5 ? 'w' : 'b';
    state.orientation = state.userColor;
    state.checkCount = { w: 0, b: 0 };
    setupGameScreen();
    showScreen('game');
    renderBoard();
    updateStatus();
    // If AI plays first, kick it off
    if (state.opponent.isAI && state.game.turn() !== state.userColor) {
      setTimeout(makeAIMove, 500);
    }
  }

  function setupGameScreen() {
    // Top = opponent, Bottom = me (when orientation = my color)
    const me = state.user;
    const opp = state.opponent;
    const topIsOpp = state.orientation === state.userColor;
    $('#pt-name').textContent = topIsOpp ? opp.username : me.username;
    $('#pt-elo').textContent = 'ELO ' + (topIsOpp ? opp.elo : me.elo);
    $('#pt-avatar').textContent = (topIsOpp ? opp.username : me.username)[0].toUpperCase();
    $('#pb-name').textContent = topIsOpp ? me.username : opp.username;
    $('#pb-elo').textContent = 'ELO ' + (topIsOpp ? me.elo : opp.elo);
    $('#pb-avatar').textContent = (topIsOpp ? me.username : opp.username)[0].toUpperCase();
    $('#pt-captured').innerHTML = '';
    $('#pb-captured').innerHTML = '';
  }

  $('#btn-flip').addEventListener('click', () => {
    state.orientation = state.orientation === 'w' ? 'b' : 'w';
    setupGameScreen();
    renderBoard();
  });

  $('#btn-resign').addEventListener('click', () => {
    if (!state.game || state.game.game_over()) return;
    if (!confirm('Resign this game?')) return;
    finishGame(state.userColor === 'w' ? 'b' : 'w', 'resignation');
  });

  // ---------------------------------------------------------------------------
  // Board rendering
  // ---------------------------------------------------------------------------
  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  function squareName(file, rank) { return FILES[file] + (rank + 1); }

  function renderBoard() {
    const boardEl = $('#board');
    boardEl.innerHTML = '';
    const orientation = state.orientation;
    const board = state.game.board(); // 8x8 array, rank 8 → rank 1
    // board[0] is rank 8. Need to iterate based on orientation.
    const ranksOrder = orientation === 'w' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const filesOrder = orientation === 'w' ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];

    for (const r of ranksOrder) {
      for (const f of filesOrder) {
        const sq = document.createElement('div');
        const isLight = (r + f) % 2 === 1;
        const name = squareName(f, r);
        sq.className = 'sq ' + (isLight ? 'light' : 'dark');
        sq.dataset.sq = name;
        // chess.js board() returns rows from rank 8 → 1; index = 7 - r
        const pieceObj = board[7 - r][f];
        if (pieceObj) {
          sq.innerHTML = pieceSVG(pieceObj.type, pieceObj.color);
        }
        // coords on edges
        if (f === filesOrder[0]) {
          const c = document.createElement('span');
          c.className = 'coord rank';
          c.textContent = r + 1;
          sq.appendChild(c);
        }
        if (r === ranksOrder[ranksOrder.length - 1]) {
          const c = document.createElement('span');
          c.className = 'coord file';
          c.textContent = FILES[f];
          sq.appendChild(c);
        }
        // highlights
        if (state.selected === name) sq.classList.add('selected');
        if (state.lastMove && (state.lastMove.from === name || state.lastMove.to === name)) sq.classList.add('last');
        if (state.legalTargets.includes(name)) {
          const dot = document.createElement('span');
          if (pieceObj) {
            dot.className = 'ring';
          } else {
            dot.className = 'dot';
          }
          sq.appendChild(dot);
        }
        // check
        if (pieceObj && pieceObj.type === 'k' && state.game.in_check() && pieceObj.color === state.game.turn()) {
          sq.classList.add('check');
        }
        sq.addEventListener('click', () => handleSquareClick(name));
        boardEl.appendChild(sq);
      }
    }
    renderCaptured();
  }

  function renderCaptured() {
    // captured[c] = list of color-c pieces that have been taken off the board
    const startCounts = { p: 8, r: 2, n: 2, b: 2, q: 1, k: 1 };
    const present = { w: { p:0,r:0,n:0,b:0,q:0,k:0 }, b: { p:0,r:0,n:0,b:0,q:0,k:0 } };
    const board = state.game.board();
    for (const row of board) for (const sq of row) if (sq) present[sq.color][sq.type]++;
    const captured = { w: [], b: [] };
    for (const c of ['w','b']) {
      for (const t of ['q','r','b','n','p']) {
        const missing = startCounts[t] - present[c][t];
        for (let i = 0; i < missing; i++) captured[c].push(t);
      }
    }
    const myColor = state.userColor;
    const oppColor = myColor === 'w' ? 'b' : 'w';
    const topIsOpp = state.orientation === state.userColor;
    // The bottom player captured pieces of opp color, so display those pieces in opp color.
    // The top player captured pieces of bottom-player color.
    const bottomPlayerColor = topIsOpp ? myColor : oppColor;
    const topPlayerColor = topIsOpp ? oppColor : myColor;
    const topShows = captured[bottomPlayerColor]; // pieces top has captured
    const botShows = captured[topPlayerColor];    // pieces bottom has captured
    $('#pt-captured').innerHTML = topShows.map(t => pieceSVG(t, bottomPlayerColor)).join('');
    $('#pb-captured').innerHTML = botShows.map(t => pieceSVG(t, topPlayerColor)).join('');
  }

  function handleSquareClick(name) {
    if (state.game.game_over() || state.aiThinking || state.promotionPending || state.animatingMove) return;
    // Only allow current side to move; in PvP both sides are clickable
    const sidePiece = state.game.get(name);
    const turn = state.game.turn();
    // In practice vs AI, the user only controls their color
    if (state.opponent.isAI && turn !== state.userColor) return;

    if (state.selected) {
      // Trying to move
      if (state.selected === name) {
        clearSelection();
        renderBoard();
        return;
      }
      const move = tryMove(state.selected, name);
      if (move) {
        clearSelection();
        afterMove(move);
        return;
      }
      // If clicked another own piece, select it instead
      if (sidePiece && sidePiece.color === turn) {
        selectSquare(name);
        return;
      }
      clearSelection();
      renderBoard();
      return;
    }
    // No selection yet
    if (sidePiece && sidePiece.color === turn) {
      selectSquare(name);
    }
  }

  function selectSquare(name) {
    state.selected = name;
    state.legalTargets = state.game.moves({ square: name, verbose: true }).map(m => m.to);
    renderBoard();
  }
  function clearSelection() {
    state.selected = null;
    state.legalTargets = [];
  }

  function tryMove(from, to) {
    // Detect promotion need
    const piece = state.game.get(from);
    if (piece && piece.type === 'p') {
      const targetRank = to[1];
      if ((piece.color === 'w' && targetRank === '8') || (piece.color === 'b' && targetRank === '1')) {
        // Open promotion modal
        state.promotionPending = { from, to, color: piece.color };
        showPromotion(piece.color);
        return null;
      }
    }
    const m = state.game.move({ from, to });
    return m;
  }

  function showPromotion(color) {
    const choices = ['q','r','b','n'];
    const wrap = $('#promotion-choices');
    wrap.innerHTML = '';
    choices.forEach(t => {
      const div = document.createElement('div');
      div.style.cssText = 'width:64px;height:64px;background:var(--panel-2);border-radius:12px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid var(--border)';
      div.innerHTML = pieceSVG(t, color);
      div.addEventListener('click', () => {
        const p = state.promotionPending;
        state.promotionPending = null;
        closeModal('promotion');
        const move = state.game.move({ from: p.from, to: p.to, promotion: t });
        if (move) afterMove(move);
      });
      wrap.appendChild(div);
    });
    openModal('promotion');
  }

  function getBoardSquareElement(square) {
    return $('#board [data-sq="' + square + '"]');
  }

  function animateCapturedPiece(square, type, color) {
    const fromSq = getBoardSquareElement(square);
    const overlay = $('#board-overlay');
    if (!fromSq || !overlay) return;
    const boardRect = $('#board').getBoundingClientRect();
    const fromRect = fromSq.getBoundingClientRect();
    const cap = document.createElement('div');
    cap.className = 'overlay-piece capture-flyaway';
    cap.innerHTML = pieceSVG(type, color);
    cap.style.width = fromRect.width + 'px';
    cap.style.height = fromRect.height + 'px';
    cap.style.left = (fromRect.left - boardRect.left) + 'px';
    cap.style.top = (fromRect.top - boardRect.top) + 'px';
    overlay.appendChild(cap);
    requestAnimationFrame(() => {
      const dx = (Math.random() - 0.5) * boardRect.width * 0.3;
      const dy = boardRect.height * 0.35;
      cap.style.transform = `translate(${dx}px, ${dy}px) scale(0.8)`;
      cap.style.opacity = '0';
    });
    setTimeout(() => cap.remove(), 280);
  }

  function animateBoardMove(move, callback) {
    const overlay = $('#board-overlay');
    const source = getBoardSquareElement(move.from);
    const target = getBoardSquareElement(move.to);
    if (!overlay || !source || !target) {
      callback();
      return;
    }
    const boardRect = $('#board').getBoundingClientRect();
    const fromRect = source.getBoundingClientRect();
    const toRect = target.getBoundingClientRect();
    const moving = document.createElement('div');
    moving.className = 'overlay-piece';
    moving.innerHTML = pieceSVG(move.piece, move.color);
    moving.style.width = fromRect.width + 'px';
    moving.style.height = fromRect.height + 'px';
    moving.style.left = (fromRect.left - boardRect.left) + 'px';
    moving.style.top = (fromRect.top - boardRect.top) + 'px';
    overlay.appendChild(moving);
    requestAnimationFrame(() => {
      const dx = toRect.left - fromRect.left;
      const dy = toRect.top - fromRect.top;
      moving.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    if (move.captured) {
      const capturedColor = move.color === 'w' ? 'b' : 'w';
      animateCapturedPiece(move.to, move.captured, capturedColor);
    }
    setTimeout(() => {
      moving.remove();
      callback();
    }, 280);
  }

  function afterMove(move) {
    state.lastMove = move;
    state.history.push(move);
    state.animatingMove = true;
    // Sound effects
    if (window.ChessSounds && move) {
      const flags = move.flags || '';
      if (flags.indexOf('k') !== -1 || flags.indexOf('q') !== -1) window.ChessSounds.castle();
      else if (flags.indexOf('p') !== -1) window.ChessSounds.promotion();
      else if (move.captured || flags.indexOf('e') !== -1) window.ChessSounds.capture();
      else window.ChessSounds.move();
      // Check sound after a tick
      if (state.game.in_check()) setTimeout(() => window.ChessSounds.check(), 80);
    }
    if (state.game.in_check()) {
      const turnNow = state.game.turn();
      state.checkCount = state.checkCount || { w: 0, b: 0 };
      state.checkCount[turnNow]++;
    }
    animateBoardMove(move, () => {
      state.animatingMove = false;
      renderBoard();
      updateStatus();
      if (state.game.game_over()) {
        handleGameOver();
        return;
      }
      // If AI opponent's turn
      if (state.opponent.isAI && state.game.turn() !== state.userColor) {
        state.aiThinking = true;
        setTimeout(() => {
          makeAIMove();
          state.aiThinking = false;
        }, 350);
      }
    });
  }

  function updateStatus() {
    const turn = state.game.turn();
    let text;
    if (state.game.in_checkmate()) text = 'Checkmate';
    else if (state.game.in_stalemate()) text = 'Stalemate';
    else if (state.game.in_draw()) text = 'Draw';
    else if (state.game.in_check()) text = (turn === 'w' ? 'White' : 'Black') + ' in check';
    else text = (turn === 'w' ? 'White' : 'Black') + ' to move';
    $('#game-status').textContent = text;
    $('#player-top').classList.toggle('active', (state.orientation === state.userColor ? turn !== state.userColor : turn === state.userColor));
    $('#player-bot').classList.toggle('active', (state.orientation === state.userColor ? turn === state.userColor : turn !== state.userColor));
  }

  // ---------------------------------------------------------------------------
  // AI (minimax with alpha-beta)
  // ---------------------------------------------------------------------------
  // ----- AI engine (pure JS, MIT-licensable). Piece-square tables are public
  // domain (Tomasz Michniewski's "Simplified Evaluation Function" on
  // chessprogramming.org, released to public domain). -----
  const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  const PST = {
    p: [
        0,  0,  0,  0,  0,  0,  0,  0,
       50, 50, 50, 50, 50, 50, 50, 50,
       10, 10, 20, 30, 30, 20, 10, 10,
        5,  5, 10, 25, 25, 10,  5,  5,
        0,  0,  0, 20, 20,  0,  0,  0,
        5, -5,-10,  0,  0,-10, -5,  5,
        5, 10, 10,-20,-20, 10, 10,  5,
        0,  0,  0,  0,  0,  0,  0,  0,
    ],
    n: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50,
    ],
    b: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20,
    ],
    r: [
        0,  0,  0,  0,  0,  0,  0,  0,
        5, 10, 10, 10, 10, 10, 10,  5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
        0,  0,  0,  5,  5,  0,  0,  0,
    ],
    q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20,
    ],
    k: [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20,
    ],
  };
  function evaluateBoard(chess) {
    if (chess.in_checkmate()) return chess.turn() === 'w' ? -99999 : 99999;
    if (chess.in_draw() || chess.in_stalemate() || chess.in_threefold_repetition() || chess.insufficient_material()) return 0;
    let score = 0;
    const board = chess.board();
    let pieceCount = 0;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      pieceCount++;
      const val = PIECE_VALUES[p.type];
      // PST table indexed from white perspective (rank 0 = rank 8 from board[0])
      const idx = p.color === 'w' ? (r * 8 + f) : ((7 - r) * 8 + f);
      const psTable = PST[p.type];
      const bonus = psTable ? psTable[idx] : 0;
      score += (p.color === 'w' ? 1 : -1) * (val + bonus);
    }
    return score;
  }
  // MVV-LVA ordering: capture most-valuable victim with least-valuable attacker first.
  function moveScore(m) {
    if (!m.captured) return 0;
    return (PIECE_VALUES[m.captured] || 0) * 10 - (PIECE_VALUES[m.piece] || 0);
  }
  function orderMoves(moves) {
    return moves.slice().sort((a, b) => moveScore(b) - moveScore(a));
  }
  // Quiescence search: keep going through captures only, until position is quiet.
  // Prevents the "horizon effect" where AI plays into bad exchanges right at depth limit.
  function quiescence(chess, alpha, beta, ply) {
    if (ply > 6) return evaluateBoard(chess);
    const standPat = evaluateBoard(chess);
    const maximizing = chess.turn() === 'w';
    if (maximizing) {
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;
    } else {
      if (standPat <= alpha) return alpha;
      if (standPat < beta) beta = standPat;
    }
    const captures = orderMoves(chess.moves({ verbose: true }).filter(m => m.captured));
    for (const m of captures) {
      chess.move(m);
      const val = quiescence(chess, alpha, beta, ply + 1);
      chess.undo();
      if (maximizing) {
        if (val >= beta) return beta;
        if (val > alpha) alpha = val;
      } else {
        if (val <= alpha) return alpha;
        if (val < beta) beta = val;
      }
    }
    return maximizing ? alpha : beta;
  }
  function minimax(chess, depth, alpha, beta, maximizing) {
    if (chess.game_over()) return evaluateBoard(chess);
    if (depth <= 0) return quiescence(chess, alpha, beta, 0);
    const moves = orderMoves(chess.moves({ verbose: true }));
    if (maximizing) {
      let best = -Infinity;
      for (const m of moves) {
        chess.move(m);
        const val = minimax(chess, depth - 1, alpha, beta, false);
        chess.undo();
        if (val > best) best = val;
        if (val > alpha) alpha = val;
        if (beta <= alpha) break;
      }
      return best;
    } else {
      let best = Infinity;
      for (const m of moves) {
        chess.move(m);
        const val = minimax(chess, depth - 1, alpha, beta, true);
        chess.undo();
        if (val < best) best = val;
        if (val < beta) beta = val;
        if (beta <= alpha) break;
      }
      return best;
    }
  }
  function chooseAIMove() {
    const chess = state.game;
    const aiElo = state.opponent.aiElo || 1200;
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;
    if (aiElo <= 1200) {
      const captures = moves.filter(m => m.captured);
      if (captures.length && Math.random() < 0.45) return captures[Math.floor(Math.random() * captures.length)];
      return moves[Math.floor(Math.random() * moves.length)];
    }
    const lowElo = aiElo <= 1600;
    if (lowElo && Math.random() < 0.25) {
      const captures = moves.filter(m => m.captured);
      if (captures.length) return captures[Math.floor(Math.random() * captures.length)];
    }
    // Iterative deepening with a time budget — gives a stable best-so-far if cut off
    const turn = chess.turn();
    const maximizing = turn === 'w';
    const maxDepth = aiElo < 1600 ? 3 : aiElo < 2000 ? 4 : aiElo < 2300 ? 5 : 6;
    const timeBudget = aiElo < 1600 ? 800 : aiElo < 2000 ? 1600 : aiElo < 2300 ? 2600 : 3800;
    const start = Date.now();
    // Small randomness on first ordering to avoid identical replies in same position
    let ordered = moves.slice().sort(() => Math.random() - 0.5);
    ordered = orderMoves(ordered);
    let bestMove = ordered[0];
    for (let depth = 1; depth <= maxDepth; depth++) {
      if (Date.now() - start > timeBudget) break;
      let bestVal = maximizing ? -Infinity : Infinity;
      let depthBest = ordered[0];
      for (const m of ordered) {
        chess.move(m);
        const val = minimax(chess, depth - 1, -Infinity, Infinity, !maximizing);
        chess.undo();
        if (maximizing ? val > bestVal : val < bestVal) {
          bestVal = val;
          depthBest = m;
        }
        if (Date.now() - start > timeBudget) break;
      }
      bestMove = depthBest;
      // Move the best move to the front for the next iteration (PV heuristic)
      ordered = [depthBest, ...ordered.filter(m => m !== depthBest)];
    }
    return bestMove;
  }
  function makeAIMove() {
    if (state.game.game_over()) return;
    const m = chooseAIMove();
    if (!m) return;
    const move = state.game.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
    if (move) afterMove(move);
  }

  // ---------------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------------
  function handleGameOver() {
    let winner = null;
    let reason = '';
    if (state.game.in_checkmate()) {
      // The side TO move is the loser
      winner = state.game.turn() === 'w' ? 'b' : 'w';
      reason = 'checkmate';
    } else if (state.game.in_draw() || state.game.in_stalemate() || state.game.in_threefold_repetition() || state.game.insufficient_material()) {
      winner = null;
      reason = state.game.in_stalemate() ? 'stalemate' : 'draw';
    }
    finishGame(winner, reason);
  }

  function finishGame(winnerColor, reason) {
    const me = state.user;
    state.gameEnded = true;
    const opp = state.opponent;
    const myWon = winnerColor === state.userColor;
    const isDraw = winnerColor === null;
    // Game-over sound
    if (window.ChessSounds) {
      if (isDraw) window.ChessSounds.note ? window.ChessSounds.note(523, 0.4, 'sine', 0.18) : null;
      else window.ChessSounds.gameOver(myWon);
    }

    const rewards = [];
    const isRanked = state.gameMode === 'ranked';

    if (isRanked) {
      // Compute ELO change
      const myScore = isDraw ? 0.5 : (myWon ? 1 : 0);
      const delta = eloDelta(me.elo, opp.elo, myScore, (me.wins||0)+(me.losses||0)+(me.draws||0));
      me.elo += delta;
      // Record an ELO snapshot for the profile sparkline (keep the last 30).
      if (!Array.isArray(me.ratingHistory)) me.ratingHistory = [me.elo - delta];
      me.ratingHistory.push(me.elo);
      if (me.ratingHistory.length > 30) me.ratingHistory = me.ratingHistory.slice(-30);
      rewards.push(`<div class="card row between"><div>ELO</div><div class="pill ${delta >= 0 ? 'success' : 'danger'}"><span class="ct-elo-pop">${delta >= 0 ? '+' : ''}${delta}</span> (now ${me.elo})</div></div>`);

      // Opponent ELO update (saved in DB)
      const db = loadDB();
      const oppUser = opp.userId && db.users[opp.userId];
      if (oppUser) {
        const oppDelta = -delta; // zero-sum approximation for symmetric K
        // Better: recalc oppDelta from their perspective
        const oppScore = isDraw ? 0.5 : (myWon ? 0 : 1);
        const realOppDelta = eloDelta(oppUser.elo, me.elo, oppScore, (oppUser.wins||0)+(oppUser.losses||0)+(oppUser.draws||0));
        oppUser.elo += realOppDelta;
        // Track win/loss for opponent too
        if (isDraw) oppUser.draws++;
        else if (myWon) { oppUser.losses++; oppUser.currentStreak = 0; oppUser.streakVictims = []; }
        else { oppUser.wins++; oppUser.currentStreak++; oppUser.streakVictims.push({ username: me.username, gameId: 'g_' + Date.now(), when: Date.now() }); checkOppMilestones(oppUser); }
        if (oppUser.currentStreak > oppUser.bestStreak) oppUser.bestStreak = oppUser.currentStreak;
        db.users[oppUser.id] = oppUser;
        saveDB(db);
      }

      // My stats
      if (isDraw) {
        me.draws++;
      } else if (myWon) {
        me.wins++;
        me.currentStreak++;
        if (me.currentStreak > me.bestStreak) me.bestStreak = me.currentStreak;
        // Track victim for streak trophy
        me.streakVictims.push({
          username: opp.username,
          userId: opp.userId || null,
          gameId: 'g_' + Date.now(),
          when: Date.now(),
        });
        // Check for streak trophy: every 7 wins in a row
        if (me.streakVictims.length === 7) {
          const trophyId = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
          const trophy = {
            id: trophyId,
            awardedAt: Date.now(),
            streakNumber: me.streakTrophies.length + 1,
            victims: me.streakVictims.slice(),
          };
          me.streakTrophies.push(trophy);
            // Distinct grander cue for a completed 7-win streak (overrides the normal trophy sound timing).
            try { if (window.ChessSounds && window.ChessSounds.streakMilestone) window.ChessSounds.streakMilestone(); } catch (e) {}
            ctCelebrate('big');
          me.streakVictims = []; // reset accumulator; streak continues, next 7 = next trophy
          rewards.push(trophyRewardHTML(trophy));
        }
      } else {
        me.losses++;
        me.currentStreak = 0;
        me.streakVictims = [];
      }

      // Update counter stats used by tiered achievements
      const wasMate = (reason === 'checkmate');
      if (myWon && wasMate) me.mateWins = (me.mateWins || 0) + 1;
      const myChecks = (state.checkCount && state.checkCount[state.userColor]) || 0;
      if (myWon && myChecks >= 3) me.comebackWins = (me.comebackWins || 0) + 1;
      // Half-move count -> full-move count (divide by 2, round up). state.history is plies.
      const fullMoves = Math.ceil(state.history.length / 2);

      // Run tiered achievement checks (every eligible new tier becomes a trophy)
      const unlocked = checkAchievementsFor(me, {
        justWon: myWon,
        mateWin: myWon && wasMate,
        moves: fullMoves,
        gameCheckCount: myChecks,
      });
      unlocked.filter(Boolean).forEach(a => {
        const color = tierColor(a.tier || 1);
        rewards.push(`<div class="card row" style="gap:12px;border-color:${color}aa">
          <div style="font-size:30px">${a.icon}</div>
          <div style="flex:1">
            <div style="font-weight:700">Trophy unlocked${a.tier ? ` <span class="pill" style="background:${color}22;color:${color}">${a.family} · Tier ${a.tier}</span>` : ''}</div>
            <div>${a.name} — <span class="muted small">${a.desc}</span></div>
          </div>
        </div>`);
      });

      // ===== Track flags for hidden + embarrassing trophies =====
      me.flags = me.flags || {};
      const oppName = (opp && opp.username) || '';
      // Promotions and special moves by me
      for (const move of state.history) {
        if (move.color !== state.userColor) continue;
        if (move.flags && move.flags.indexOf('p') !== -1) {
          me.flags.pawnPromotions = (me.flags.pawnPromotions || 0) + 1;
          if (myWon && move.promotion && move.promotion !== 'q') {
            me.flags.underpromoWins = (me.flags.underpromoWins || 0) + 1;
          }
        }
        if (move.flags && move.flags.indexOf('e') !== -1) {
          me.flags.enPassants = (me.flags.enPassants || 0) + 1;
        }
        if (move.flags && move.flags.indexOf('q') !== -1) {
          me.flags.queensideCastles = (me.flags.queensideCastles || 0) + 1;
        }
      }
      // Bongcloud: e4 + Ke2/Kf1 as white in opening
      if (myWon && state.userColor === 'w' && state.history.length >= 3) {
        const w1 = state.history[0];
        const w2 = state.history[2];
        if (w1 && w1.san === 'e4' && w2 && (w2.san === 'Ke2' || w2.san === 'Kf1')) {
          me.flags.bongcloudWins = (me.flags.bongcloudWins || 0) + 1;
        }
      }
      // Marathon / Lightning
      if (myWon) {
        if (fullMoves >= 50) me.flags.marathonWins = (me.flags.marathonWins || 0) + 1;
        if (fullMoves <= 10) me.flags.lightningWins = (me.flags.lightningWins || 0) + 1;
      }
      // Phoenix: won after 3+ losses in a row
      const prevLoseStreak = me.flags.loseStreak || 0;
      if (myWon && prevLoseStreak >= 3) {
        me.flags.phoenixRises = (me.flags.phoenixRises || 0) + 1;
      }
      // Update lose streak
      if (myWon) me.flags.loseStreak = 0;
      else if (!isDraw) me.flags.loseStreak = (me.flags.loseStreak || 0) + 1;
      // Resign streak
      if (reason === 'resignation' && !myWon) {
        me.flags.resignStreak = (me.flags.resignStreak || 0) + 1;
      } else {
        me.flags.resignStreak = 0;
      }
      // Mate loss streak
      if (reason === 'checkmate' && !myWon) {
        me.flags.mateLossStreak = (me.flags.mateLossStreak || 0) + 1;
      } else if (myWon || isDraw) {
        me.flags.mateLossStreak = 0;
      }
      // Fast / quick losses
      if (!myWon && !isDraw) {
        if (fullMoves <= 10 && reason === 'checkmate') me.flags.fastLosses = (me.flags.fastLosses || 0) + 1;
        if (fullMoves <= 15) me.flags.veryQuickLosses = (me.flags.veryQuickLosses || 0) + 1;
      }
      // Bare bones / pawns-only checks
      const finalBoard = state.game.board();
      if (myWon) {
        let myPieceCount = 0;
        for (const row of finalBoard) for (const sq of row) {
          if (sq && sq.color === state.userColor) myPieceCount++;
        }
        if (myPieceCount <= 2) me.flags.bareBonesWins = (me.flags.bareBonesWins || 0) + 1;
      }
      if (!myWon && !isDraw) {
        let myNonPawn = 0;
        for (const row of finalBoard) for (const sq of row) {
          if (sq && sq.color === state.userColor && sq.type !== 'p' && sq.type !== 'k') myNonPawn++;
        }
        if (myNonPawn === 0) me.flags.pawnsOnlyLosses = (me.flags.pawnsOnlyLosses || 0) + 1;
      }
      // Smothered mate detection
      if (myWon && reason === 'checkmate') {
        const last = state.history[state.history.length - 1];
        if (last && last.piece === 'n') {
          const enemyColor = state.userColor === 'w' ? 'b' : 'w';
          let kr = -1, kf = -1;
          for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
            const sq = finalBoard[r][f];
            if (sq && sq.type === 'k' && sq.color === enemyColor) { kr = r; kf = f; }
          }
          if (kr >= 0) {
            let allBlocked = true;
            for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) {
              if (dr === 0 && df === 0) continue;
              const nr = kr + dr, nf = kf + df;
              if (nr < 0 || nr >= 8 || nf < 0 || nf >= 8) continue;
              const sq = finalBoard[nr][nf];
              if (!sq || sq.color !== enemyColor) { allBlocked = false; }
            }
            if (allBlocked) me.flags.smotheredGiven = (me.flags.smotheredGiven || 0) + 1;
          }
        }
      }
      // Same-opponent loss streak
      me.lossesByOpponent = me.lossesByOpponent || {};
      if (oppName) {
        if (!myWon && !isDraw) {
          me.lossesByOpponent[oppName] = (me.lossesByOpponent[oppName] || 0) + 1;
        } else if (myWon) {
          me.lossesByOpponent[oppName] = 0;
        }
        const maxStreak = Math.max(0, ...Object.values(me.lossesByOpponent));
        me.flags.sameOppLossStreak = Math.max(me.flags.sameOppLossStreak || 0, maxStreak);
      }
      // Day tracking + dry-spell + cold-streak
      const todayStr = new Date().toISOString().split('T')[0];
      me.recentGameDays = me.recentGameDays || [];
      if (me.recentGameDays.indexOf(todayStr) === -1) {
        me.recentGameDays.push(todayStr);
        if (me.recentGameDays.length > 35) me.recentGameDays.shift();
      }
      if (myWon) me.lastWinDate = Date.now();
      if (me.lastWinDate) {
        const daysSinceWin = (Date.now() - me.lastWinDate) / 86400000;
        if (daysSinceWin >= 7) {
          const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
          const recent = me.recentGameDays.filter(d => d >= cutoff);
          if (recent.length >= 4) me.flags.drySpellTriggered = 1;
        }
        if (daysSinceWin >= 30) me.flags.coldStreakTriggered = 1;
      }
      // Doormat: 20+ games, win rate <25%
      const total = me.wins + me.losses + me.draws;
      if (total >= 20 && (me.wins / total) < 0.25) {
        me.flags.doormatTriggered = 1;
      }

      // Re-check tiered achievements after flag updates (catches hidden + oops trophies)
      const moreUnlocks = checkAchievementsFor(me, { justWon: myWon, mateWin: myWon && reason === 'checkmate', moves: fullMoves });
      moreUnlocks.filter(Boolean).forEach(a => {
        const color = tierColor(a.tier || 1);
        const isOops = a.embarrassing;
        const bg = isOops ? '#7f1d1d' : '#1c2845';
        rewards.push(`<div class="card row" style="gap:12px;border-color:${isOops ? 'var(--danger)' : color + 'aa'};background:linear-gradient(135deg, ${isOops ? 'rgba(248,113,113,.1)' : color + '12'}, var(--panel))">
          <div style="font-size:30px">${a.icon}</div>
          <div style="flex:1">
            <div style="font-weight:700">${isOops ? '😅 Oops! A cheeky trophy' : (a.hidden ? '🔓 Hidden trophy unlocked' : 'Trophy unlocked')}<span class="pill" style="background:${color}22;color:${color};margin-left:6px">${a.family}</span></div>
            <div>${a.name} — <span class="muted small">${a.desc}</span></div>
          </div>
        </div>`);
      });

      // Persist
      const db2 = loadDB();
      db2.users[me.id] = me;
      saveDB(db2);
      state.user = me;
    } else if (state.gameMode === 'friendly') {
      rewards.push(`<div class="card center muted">Friendly match — doesn't count against your record.</div>`);
    } else if (state.gameMode === 'unranked') {
      rewards.push(`<div class="card center muted">Unranked game — no ELO change.</div>`);
    } else {
      rewards.push(`<div class="card center muted">Practice game — no ELO change.</div>`);
    }

    // Show result modal
    let title, body;
    if (isDraw) {
      title = 'Draw';
      body = reason === 'stalemate' ? 'Stalemate.' : 'Draw agreed by the rules.';
    } else if (myWon) {
      title = 'Victory! 🏆';
      body = reason === 'checkmate' ? 'You delivered checkmate.' :
             reason === 'resignation' ? 'Your opponent resigned.' : 'You won.';
    } else {
      title = 'Defeat';
      body = reason === 'checkmate' ? 'Checkmated.' :
             reason === 'resignation' ? 'You resigned.' : 'Your opponent won.';
    }
    $('#result-title').textContent = title;
    $('#result-body').textContent = body;
    $('#result-rewards').innerHTML = rewards.join('') + renderAdSlot('medium');
    openModal('result');
    // Celebrate trophy unlocks: confetti + title shine, timed with the fanfare.
    try {
      var _newTrophies = (typeof unlocked !== 'undefined' ? unlocked.length : 0) + (typeof moreUnlocks !== 'undefined' ? moreUnlocks.length : 0);
      if (_newTrophies > 0) {
        var _t = $('#result-title'); if (_t) { _t.classList.remove('ct-trophy-shine'); void _t.offsetWidth; _t.classList.add('ct-trophy-shine'); }
        ctCelebrate(_newTrophies >= 2 ? 'big' : 'normal');
        setTimeout(function(){ ctCelebrate('normal'); }, 260);
      }
    } catch (e) {}
  }

  function checkOppMilestones(oppUser) {
    if (oppUser.streakVictims.length === 7) {
      const trophyId = 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      oppUser.streakTrophies.push({
        id: trophyId,
        awardedAt: Date.now(),
        streakNumber: oppUser.streakTrophies.length + 1,
        victims: oppUser.streakVictims.slice(),
      });
      oppUser.streakVictims = [];
    }
    // Tiered achievement evaluation for the opponent who just won
    checkAchievementsFor(oppUser, { justWon: true });
  }

  function trophyRewardHTML(trophy) {
    const victims = trophy.victims.map(v => `<li><span>${escapeHTML(v.username)}</span><span class="muted small">${timeAgo(v.when)}</span></li>`).join('');
    return `<div class="card" style="background: linear-gradient(135deg, rgba(245,196,81,.18), var(--panel-2)); border-color: var(--accent)">
      <div class="row" style="gap:12px">
        <div style="font-size:34px">🏆</div>
        <div>
          <div style="font-weight:800">7-Win Streak Trophy #${trophy.streakNumber}</div>
          <div class="muted small">For defeating 7 opponents in a row.</div>
        </div>
      </div>
      <ul class="victims" style="padding:0;margin-top:10px">${victims}</ul>
    </div>`;
  }

  $('#btn-result-close').addEventListener('click', () => {
    closeModal('result');
    showScreen('lobby');
  _addLobbyChatButton();
  });

  // ---------------------------------------------------------------------------
  // Profile screen
  // ---------------------------------------------------------------------------
  function renderProfile() {
  if (!state.user) return;
    const u = state.user;
    // Avatar: use custom/stock image or fallback to initial
  const profAvEl = $('#prof-avatar');
  if (profAvEl) {
    if (u.avatarDataUrl) {
      profAvEl.innerHTML = '';
      const img = document.createElement('img');
      img.src = u.avatarDataUrl;
      img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
      profAvEl.appendChild(img);
    } else if (u.avatarStock) {
      const av = (typeof STOCK_AVATARS !== 'undefined' ? STOCK_AVATARS : []).find(a => a.id === u.avatarStock);
      if (av) {
        profAvEl.textContent = av.emoji;
        profAvEl.style.background = av.bg;
        profAvEl.style.color = av.fg;
        profAvEl.style.fontSize = '2rem';
        profAvEl.style.display = 'flex';
        profAvEl.style.alignItems = 'center';
        profAvEl.style.justifyContent = 'center';
      } else {
        profAvEl.textContent = u.username[0].toUpperCase();
      }
    } else {
      profAvEl.textContent = u.username[0].toUpperCase();
    }
    // Add click-to-edit if it's own profile
    if (state.user && u.id === state.user.id) {
      profAvEl.title = 'Click to change avatar';
      profAvEl.style.cursor = 'pointer';
      profAvEl.onclick = () => openAvatarEditor();
    }
  }
    $('#prof-name').textContent = u.username;
  // Add "Change Avatar" button to profile if it's the user's own profile
  const changeAvBtn = document.getElementById('ct-change-av-btn');
  if (state.user && u.id === state.user.id) {
    if (!changeAvBtn) {
      const btn = document.createElement('button');
      btn.id = 'ct-change-av-btn';
      btn.textContent = '✏️ Change Avatar';
      btn.style.cssText = 'margin-top:8px;background:#1a2438;border:1px solid #3b425a;border-radius:8px;color:#cdd3e6;padding:6px 14px;font-size:12px;cursor:pointer;';
      btn.onclick = () => openAvatarEditor();
      const profAvEl2 = $('#prof-avatar');
      if (profAvEl2 && profAvEl2.parentNode) {
        profAvEl2.parentNode.insertBefore(btn, profAvEl2.nextSibling);
      }
    }
  } else if (changeAvBtn) {
    changeAvBtn.remove();
  }
    $('#prof-email').textContent = u.email;
    $('#prof-region').textContent = u.region || 'No region set';
    $('#prof-elo').textContent = u.elo;
    const games = u.wins + u.losses + u.draws;
    $('#prof-games').textContent = games;
    // Provisional badge (until 30 ranked games) + rating sparkline next to ELO.
    (function(){
      var eloEl = $('#prof-elo');
      if (!eloEl) return;
      var card = eloEl.parentElement;
      // Clear any previously rendered extras so re-renders don't stack.
      var oldBadge = card.querySelector('.ct-provisional'); if (oldBadge) oldBadge.remove();
      var oldSpark = card.querySelector('.ct-sparkline'); if (oldSpark) oldSpark.remove();
      if (games < 30) {
        var badge = document.createElement('span');
        badge.className = 'ct-provisional';
        badge.textContent = 'Provisional';
        badge.title = 'Your rating is still settling. After 30 ranked games it stabilises (lower K-factor).';
        eloEl.appendChild(badge);
      }
      var hist = Array.isArray(u.ratingHistory) ? u.ratingHistory.slice(-30) : [u.elo];
      if (hist.length >= 2) {
        var w = 120, h = 28, pad = 3;
        var min = Math.min.apply(null, hist), max = Math.max.apply(null, hist);
        var span = (max - min) || 1;
        var pts = hist.map(function(v, i){
          var x = pad + (i / (hist.length - 1)) * (w - 2 * pad);
          var y = pad + (1 - (v - min) / span) * (h - 2 * pad);
          return x.toFixed(1) + ',' + y.toFixed(1);
        });
        var svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('class','ct-sparkline');
        svg.setAttribute('viewBox','0 0 ' + w + ' ' + h);
        svg.setAttribute('aria-label','Rating trend');
        var path = document.createElementNS('http://www.w3.org/2000/svg','path');
        path.setAttribute('d','M' + pts.join(' L'));
        svg.appendChild(path);
        card.appendChild(svg);
      }
    })();
    $('#prof-winrate').textContent = games === 0 ? '—' : Math.round((u.wins / games) * 100) + '%';
    $('#prof-wins').textContent = u.wins;
    $('#prof-losses').textContent = u.losses;
    $('#prof-draws').textContent = u.draws;
    $('#prof-streak').textContent = u.currentStreak;
    $('#prof-best-streak').textContent = u.bestStreak;
    $('#prof-streak-trophies').textContent = u.streakTrophies.length;
    $('#prof-mates').textContent = u.mateWins || 0;
    $('#prof-comebacks').textContent = u.comebackWins || 0;
    const totalEarned = u.achievements.length + u.streakTrophies.length;
    $('#prof-trophies-total').textContent = totalEarned;
    $('#prof-trophy-progress').textContent =
      `${u.achievements.length}/${ACHIEVEMENT_TIERS.length} achievement tiers · ${u.streakTrophies.length} streak ${u.streakTrophies.length === 1 ? 'trophy' : 'trophies'}`;
  }

  // ---------------------------------------------------------------------------
  // Rankings screen
  // ---------------------------------------------------------------------------
  let currentRankMetric = 'elo';
  let currentRankSize = '100';

  $$('#rank-metric-tabs .tab').forEach(t => {
    t.addEventListener('click', () => {
      $$('#rank-metric-tabs .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      currentRankMetric = t.dataset.metric;
      renderRankings();
    });
  });
  $$('#rank-size-tabs .rank-size').forEach(t => {
    t.addEventListener('click', () => {
      $$('#rank-size-tabs .rank-size').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      currentRankSize = t.dataset.size;
      renderRankings();
    });
  });

  const METRIC_INFO = {
    elo:      { label: 'ELO',     key: u => u.elo,                            unit: '' },
    wins:     { label: 'Wins',    key: u => u.wins,                           unit: 'W' },
    trophies: { label: 'Trophies', key: u => u.streakTrophies.length + u.achievements.length, unit: '🏆' },
    streak:   { label: 'Best',    key: u => u.bestStreak,                     unit: '' },
  };

  function renderRankings() {
  if (!state.user) return;
    const db = loadDB();
    const me = state.user;
    const info = METRIC_INFO[currentRankMetric] || METRIC_INFO.elo;
    let users = Object.values(db.users);
    users.sort((a, b) => info.key(b) - info.key(a));
    // Apply size cap
    const sizeMap = { '100': 100, '500': 500, '5000': 5000, 'all': Infinity };
    const limit = sizeMap[currentRankSize] || 100;
    const total = users.length;
    users = users.slice(0, Math.min(limit, total));
    const wrap = $('#rank-list');
    if (users.length === 0) {
      wrap.innerHTML = `<div class="card muted center">No players to rank here yet.</div>`;
      return;
    }
    // Find my position in the full sorted list (before slicing)
    const allSorted = Object.values(db.users).sort((a, b) => info.key(b) - info.key(a));
    const myRank = allSorted.findIndex(u => u.id === me.id) + 1;
    const summary = `<div class="muted small center" style="margin-bottom:8px">Showing top ${users.length} of ${total} by ${info.label.toLowerCase()}${myRank ? ` · you're #${myRank}` : ''}</div>`;
    const rows = users.map((u, i) => {
      const top = i < 3 ? `top${i + 1}` : '';
      const meTag = u.id === me.id ? 'me' : '';
      const score = info.key(u);
      const scoreLabel = currentRankMetric === 'trophies' ? `${score}🏆` :
                        currentRankMetric === 'wins' ? `${score}W` :
                        currentRankMetric === 'streak' ? `${score}🔥` :
                        score;
      return `<div class="rank-row ${top} ${meTag}">
        <div class="rank-num">${i + 1}</div>
        <div class="avatar" style="width:32px;height:32px;font-size:13px">${escapeHTML(u.username[0].toUpperCase())}</div>
        <div class="rank-info">
          <div class="rank-name">${escapeHTML(u.username)}${u.id === me.id ? ' <span class="pill gold small">you</span>' : ''}</div>
          <div class="rank-meta">${escapeHTML(u.region || '—')} · ELO ${u.elo} · ${u.wins}W ${u.losses}L</div>
        </div>
        <div class="rank-elo">${scoreLabel}</div>
      </div>`;
    }).join('');
    wrap.innerHTML = summary + rows;
  }

  // ---------------------------------------------------------------------------
  // Trophies screen — tiered, grouped by family
  // ---------------------------------------------------------------------------
    function trophyTierColors(tier, unlocked) {
    var ramp = [
      ['#c8794a','#a85e34'],
      ['#cfd6dd','#9aa5b1'],
      ['#f4c64b','#d99e2b'],
      ['#7fd1ff','#3f9fe0'],
      ['#b388ff','#7c4dff'],
      ['#ff8fa3','#e8506e'],
      ['#7af0d3','#26c6a4']
    ];
    var idx = Math.max(1, Math.min(7, tier || 1)) - 1;
    if (!unlocked) return ['#3a4150','#2b313d'];
    return ramp[idx];
  }
  function trophyIconHTML(tier, unlocked, accent) {
    var cols = trophyTierColors(tier, unlocked);
    var light = cols[0], dark = cols[1];
    var gid = 'tg' + (tier||1) + (unlocked ? 'u' : 'l') + Math.floor(Math.random()*100000);
    var op = unlocked ? '1' : '0.5';
    var acc = accent ? '<text x="24" y="22" font-size="13" text-anchor="middle" dominant-baseline="middle">' + accent + '</text>' : '';
    return '<svg viewBox="0 0 48 48" width="100%" height="100%" style="opacity:' + op + '" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + light + '"/><stop offset="1" stop-color="' + dark + '"/>' +
      '</linearGradient></defs>' +
      '<path d="M11 11 H7 a5 5 0 0 0 5 8" fill="none" stroke="' + dark + '" stroke-width="2.4"/>' +
      '<path d="M37 11 H41 a5 5 0 0 1 -5 8" fill="none" stroke="' + dark + '" stroke-width="2.4"/>' +
      '<path d="M12 8 H36 V16 a12 12 0 0 1 -24 0 Z" fill="url(#' + gid + ')" stroke="' + dark + '" stroke-width="1.2"/>' +
      '<rect x="22" y="28" width="4" height="6" fill="' + dark + '"/>' +
      '<rect x="16" y="34" width="16" height="3.5" rx="1.5" fill="' + dark + '"/>' +
      '<rect x="13" y="37.5" width="22" height="4" rx="2" fill="' + light + '" stroke="' + dark + '" stroke-width="1"/>' +
      acc + '</svg>';
  }

  function renderTrophies() {
  if (!state.user) return;
    const u = state.user;
    const sWrap = $('#streak-trophies');
    if (u.streakTrophies.length === 0) {
      sWrap.innerHTML = `<div class="card muted center" style="grid-column:1/-1">No streak trophies yet. Win 7 ranked games in a row to unlock your first.</div>`;
    } else {
      sWrap.innerHTML = u.streakTrophies.map(t => `
        <div class="trophy streak" data-trophy-id="${t.id}">
          <div class="icon">🏆</div>
          <div class="name">Streak #${t.streakNumber}</div>
          <div class="desc">${t.victims.length} consecutive wins · tap to see opponents</div>
        </div>
      `).join('');
      $$('#streak-trophies .trophy').forEach(el => {
        el.addEventListener('click', () => {
          const t = u.streakTrophies.find(x => x.id === el.dataset.trophyId);
          if (t) showTrophyDetail(t);
        });
      });
    }
    const aWrap = $('#achievement-trophies');
    const families = {};
    for (const a of ACHIEVEMENT_TIERS) {
      if (!families[a.family]) families[a.family] = [];
      families[a.family].push(a);
    }
    let html = '';
    // Order: regular families first, then Hidden, then Oops
    const familyOrder = Object.keys(families).sort((a, b) => {
      const order = { 'Hidden Feats': 100, 'Oops': 200, 'Community': 50 };
      return (order[a] || 1) - (order[b] || 1);
    });
    for (const fam of familyOrder) {
      const tiers = families[fam].sort((a, b) => a.tier - b.tier);
      const owned = tiers.filter(t => hasAchievement(u, t.id));
      const isHiddenFamily = tiers.some(t => t.hidden);
      const isEmbarrassingFamily = tiers.some(t => t.embarrassing);
      const nextLocked = tiers.find(t => !hasAchievement(u, t.id));
      const top = owned[owned.length - 1];
      const headerIcon = top ? top.icon : (isHiddenFamily ? '❓' : (isEmbarrassingFamily ? '😬' : (tiers[0] ? tiers[0].icon : '🏅')));
      const progress = owned.length;
      const total = tiers.length;
      const famLabel = isHiddenFamily ? 'Hidden Feats 🤫' : (isEmbarrassingFamily ? 'Embarrassing Moments' : fam);
      const subText = isHiddenFamily
        ? (owned.length ? `Discovered ${owned.length} of ${total} — keep playing` : 'Locked — discovered by accomplishing rare feats')
        : isEmbarrassingFamily
          ? (owned.length ? `${owned.length} of ${total} embarrassments` : 'Worn with a wink — we all have these days')
          : (nextLocked ? `Next: ${escapeHTML(nextLocked.name)}` : 'Maxed');
      html += `<div style="grid-column:1/-1;margin-top:14px">
        <div class="row between" style="margin:4px 4px 6px">
          <div style="font-weight:700">${headerIcon} ${famLabel} <span class="muted small">${progress}/${total}</span></div>
          <div class="muted small">${subText}</div>
        </div>
      </div>`;
      for (const t of tiers) {
        const got = hasAchievement(u, t.id);
        const color = tierColor(t.tier);
        const isOops = t.embarrassing;
        const isHidden = t.hidden && !got;
        const cardStyle = got
          ? (isOops
              ? 'border-color:var(--danger);background:linear-gradient(160deg, rgba(248,113,113,.18), var(--panel))'
              : `border-color:${color}55;background:linear-gradient(160deg, ${color}18, var(--panel))`)
          : '';
        const displayIcon = trophyIconHTML(t.tier, got, isHidden ? '' : t.icon);
        const displayName = isHidden ? '???' : escapeHTML(t.name);
        const displayDesc = isHidden ? 'Complete this hidden feat to reveal it.' : escapeHTML(t.desc);
        const pillStyle = isOops && got
          ? 'background:rgba(248,113,113,.2);color:var(--danger)'
          : `background:${color}22;color:${color}`;
        const pillLabel = isOops ? '😬' : (isHidden ? 'Hidden' : '');
        html += `<div class="trophy ${got ? '' : 'locked'}" style="${cardStyle}">
          <div class="icon">${displayIcon}</div>
          <div class="name">${displayName} ${pillLabel ? `<span class="pill" style="${pillStyle}">${pillLabel}</span>` : ""}</div>
          <div class="desc">${displayDesc}</div>
        </div>`;
      }
    }
    aWrap.innerHTML = html;
  }
  function showTrophyDetail(trophy) {
    const body = $('#trophy-detail-body');
    body.innerHTML = `
      <div class="center">
        <div style="font-size:48px">🏆</div>
        <h2 style="margin-top:6px">7-Win Streak Trophy #${trophy.streakNumber}</h2>
        <div class="muted small" style="margin-top:4px">${new Date(trophy.awardedAt).toLocaleString()}</div>
      </div>
      <h3 style="margin-top:14px">Defeated</h3>
      <ul class="victims" style="padding:0">
        ${trophy.victims.map((v, i) => `<li><span>${i + 1}. ${escapeHTML(v.username)}</span><span class="muted small">${new Date(v.when).toLocaleDateString()}</span></li>`).join('')}
      </ul>
    `;
    openModal('trophy-detail');
  }
  $('#btn-trophy-close').addEventListener('click', () => closeModal('trophy-detail'));

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }

  function enterApp() {
    showNav(true);
    showScreen('lobby');
    const params = new URLSearchParams(window.location.search);
    const code = params.get('join');
    if (code) {
      setTimeout(() => {
        $('#join-code').value = code.toUpperCase();
        $('#join-error').textContent = '';
        openModal('join-room');
      }, 400);
      try {
        const cleanUrl = window.location.href.split('?')[0];
        history.replaceState({}, '', cleanUrl);
      } catch (e) {}
    }
  }
  async function init() {
    const session = getSession();
    const db = loadDB();
    if (session && session.userId) {
      let u = db.users[session.userId];
      if (session.token) {
        try {
          const profile = await fetchMe();
          u = syncRemoteProfile(profile);
          setSession({ userId: u.id, token: session.token });
        } catch (e) {
          // Fall back to local DB when the server is unavailable.
        }
      }
      if (u) { state.user = u; enterApp(); return; }
    }
    showScreen('auth');
  }

  // Premium modal wiring
  if ($('#btn-premium-buy')) $('#btn-premium-buy').addEventListener('click', () => { setPremium(true); closeModal('premium'); });
  if ($('#btn-premium-cancel-paid')) $('#btn-premium-cancel-paid').addEventListener('click', () => { setPremium(false); closeModal('premium'); });
  if ($('#btn-premium-close')) $('#btn-premium-close').addEventListener('click', () => closeModal('premium'));

  // Expose for academy.js
  window.CT = {
    get state(){ return state; },
    get user(){ return state.user; },
    setUser(u){ state.user = u; },
    $, $$, openModal, closeModal, showScreen, showNav, toast,
    loadDB, saveDB, pieceSVG, escapeHTML,
    ACHIEVEMENT_TIERS,
    hasAchievement, unlockAchievement, checkAchievementsFor, tierColor,
    renderLobby, renderProfile, renderBoard,
    openPremium, setPremium, renderAdSlot,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }


// ============================================================
// INJECT STYLES for Chat, Avatar, Report features
// ============================================================
(function injectFeatureStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .ct-chat-msg { animation: ct-fade-in 0.2s ease; }
    @keyframes ct-fade-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
    #ct-chat-box::-webkit-scrollbar { width:4px; }
    #ct-chat-box::-webkit-scrollbar-track { background:#0d1422; }
    #ct-chat-box::-webkit-scrollbar-thumb { background:#2d3a52; border-radius:2px; }
    #ct-chat-input:focus { border-color:#4a5578 !important; }
    .ct-report-btn { background:none; border:1px solid #8b2020; color:#f07070; border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; transition:background 0.15s; }
    .ct-report-btn:hover { background:#8b2020; color:#fff; }
    .ct-chat-fab-pulse { animation: ct-pulse 2s infinite; }
    @keyframes ct-pulse { 0%,100%{ box-shadow:0 0 0 0 #3b425a88; } 50%{ box-shadow:0 0 0 8px #3b425a00; } }
  `;
  document.head.appendChild(style);
})();

// ============================================================
// FEATURE: STOCK AVATAR PRESETS
// ============================================================
const STOCK_AVATARS = [
  { id: 'av_knight',   emoji: '♞', label: 'Knight',   bg: '#1a2236', fg: '#cdd3e6' },
  { id: 'av_king',     emoji: '♚', label: 'King',     bg: '#2d1a36', fg: '#e6cdd3' },
  { id: 'av_queen',    emoji: '♛', label: 'Queen',    bg: '#1a362d', fg: '#cde6d3' },
  { id: 'av_rook',     emoji: '♜', label: 'Rook',     bg: '#36281a', fg: '#e6d3cd' },
  { id: 'av_bishop',   emoji: '♝', label: 'Bishop',   bg: '#1a3036', fg: '#cddbe6' },
  { id: 'av_pawn',     emoji: '♟', label: 'Pawn',     bg: '#36361a', fg: '#e6e6cd' },
  { id: 'av_trophy',   emoji: '🏆', label: 'Trophy',   bg: '#363320', fg: '#fff3b0' },
  { id: 'av_fire',     emoji: '🔥', label: 'Blaze',    bg: '#36200a', fg: '#ffb347' },
  { id: 'av_star',     emoji: '⭐', label: 'Star',     bg: '#20203a', fg: '#ffd700' },
  { id: 'av_ghost',    emoji: '👻', label: 'Ghost',    bg: '#2a2a2a', fg: '#ffffff' },
];

function getAvatarHTML(user, size = 48) {
  if (user && user.avatarDataUrl) {
    return `<img src="${escapeHTML(user.avatarDataUrl)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;" alt="avatar">`;
  }
  const stockId = (user && user.avatarStock) || 'av_knight';
  const av = STOCK_AVATARS.find(a => a.id === stockId) || STOCK_AVATARS[0];
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:${av.bg};font-size:${Math.round(size*0.5)}px;">${av.emoji}</span>`;
}

// ============================================================
// FEATURE: CHAT SYSTEM (in-game + lobby)
// ============================================================
const chatState = {
  messages: {},  // roomId -> [{sender, text, ts}]
  activeRoom: null,
};

function getChatMessages(roomId) {
  try {
    const raw = localStorage.getItem('ct_chat_' + roomId);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveChatMessages(roomId, messages) {
  try {
    // Keep last 200 messages per room
    const trimmed = messages.slice(-200);
    localStorage.setItem('ct_chat_' + roomId, JSON.stringify(trimmed));
  } catch(e) {}
}

function sendChatMessage(roomId, text) {
  if (!roomId || !text || !text.trim()) return;
  const user = state.user;
  if (!user) return toast('Sign in to chat.', false);
  const clean = escapeHTML(text.trim()).substring(0, 500);
  if (!clean) return;
  const msgs = getChatMessages(roomId);
  msgs.push({ sender: user.username, senderId: user.id, text: clean, ts: Date.now() });
  saveChatMessages(roomId, msgs);
  renderChat(roomId);
}

function renderChat(roomId) {
  const wrap = document.getElementById('ct-chat-box');
  if (!wrap) return;
  const msgs = getChatMessages(roomId);
  const db = loadDB();
  wrap.innerHTML = msgs.map(m => {
    const sender = Object.values(db.users).find(u => u.id === m.senderId);
    const avatarHTML = getAvatarHTML(sender, 28);
    const isMe = state.user && m.senderId === state.user.id;
    return `<div class="ct-chat-msg ${isMe ? 'ct-chat-me' : ''}" style="display:flex;align-items:flex-start;gap:6px;margin-bottom:6px;flex-direction:${isMe?'row-reverse':'row'};">
      <div style="flex-shrink:0">${avatarHTML}</div>
      <div style="max-width:70%;">
        <div style="font-size:10px;color:#888;margin-bottom:2px;${isMe?'text-align:right':''}">${escapeHTML(m.sender)}</div>
        <div style="background:${isMe?'#3b425a':'#222b3a'};color:#f0f0f0;border-radius:10px;padding:6px 10px;font-size:13px;word-break:break-word;">${m.text}</div>
        <div style="font-size:9px;color:#555;margin-top:2px;${isMe?'text-align:right':''}">${timeAgo(m.ts)}</div>
      </div>
    </div>`;
  }).join('') || '<div style="color:#555;font-size:12px;text-align:center;padding:20px;">No messages yet. Say hello!</div>';
  wrap.scrollTop = wrap.scrollHeight;
}

function openChat(roomId, label) {
  chatState.activeRoom = roomId;
  const existing = document.getElementById('ct-chat-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ct-chat-overlay';
  overlay.style.cssText = 'position:fixed;bottom:70px;right:16px;width:320px;max-height:460px;background:#141d2b;border:1px solid #2d3a52;border-radius:14px;box-shadow:0 8px 32px #0008;z-index:9000;display:flex;flex-direction:column;overflow:hidden;';
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#1a2438;border-bottom:1px solid #2d3a52;">
      <span style="font-weight:600;color:#cdd3e6;font-size:13px;">💬 ${escapeHTML(label||'Chat')}</span>
      <button onclick="document.getElementById('ct-chat-overlay').remove()" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer;line-height:1;">×</button>
    </div>
    <div id="ct-chat-box" style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;"></div>
    <div style="padding:8px;border-top:1px solid #2d3a52;display:flex;gap:6px;">
      <input id="ct-chat-input" type="text" maxlength="500" placeholder="Type a message…" style="flex:1;background:#0d1422;border:1px solid #2d3a52;border-radius:8px;padding:7px 10px;color:#f0f0f0;font-size:13px;outline:none;"
        onkeydown="if(event.key==='Enter'){window._sendChat();}">
      <button onclick="window._sendChat()" style="background:#3b425a;border:none;border-radius:8px;color:#fff;padding:7px 12px;cursor:pointer;font-size:13px;">Send</button>
    </div>
  `;
  document.body.appendChild(overlay);
  window._sendChat = function() {
    const inp = document.getElementById('ct-chat-input');
    if (!inp) return;
    sendChatMessage(chatState.activeRoom, inp.value);
    inp.value = '';
  };
  renderChat(roomId);
}

function openGameChat(gameLabel) {
  const user = state.user;
  if (!user) return toast('Sign in to chat.', false);
  // Use current game room id or create a lobby room
  const roomId = (state.game && state.game.roomId) || ('lobby_' + user.id);
  openChat(roomId, gameLabel || 'Game Chat');
}

// ============================================================
// FEATURE: USERNAME UNIQUENESS ENFORCEMENT
// ============================================================
// Patch signup to enforce uniqueness case-insensitively
const _origSignup = window._ctSignup;
function enforceUsernameUnique(db, username) {
  if (!username) return false;
  const lower = username.trim().toLowerCase();
  return Object.values(db.users).some(u => u.username && u.username.toLowerCase() === lower);
}

// The signup function already calls findUserByUsername which is case-insensitive.
// We add an extra validation layer here:
function validateUsernameAvailability(username) {
  const db = loadDB();
  const lower = (username || '').trim().toLowerCase();
  if (!lower) return 'Username is required.';
  if (!isValidUsername(username)) return 'Username must be 3-20 chars, letters/numbers/underscore only.';
  // Check reserved words
  const reserved = ['admin','moderator','system','chesstrophies','support','help','bot','ai'];
  if (reserved.includes(lower)) return 'That username is reserved.';
  if (enforceUsernameUnique(db, username)) return 'That username is already taken.';
  return null; // valid
}

// ============================================================
// FEATURE: PROFILE PICTURE (Upload + Stock Avatars)
// ============================================================
function openAvatarEditor() {
  const user = state.user;
  if (!user) return toast('Sign in first.', false);
  const existing = document.getElementById('ct-avatar-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'ct-avatar-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:#0009;z-index:9999;display:flex;align-items:center;justify-content:center;';
  const stockGrid = STOCK_AVATARS.map(av =>
    `<button onclick="window._selectStockAvatar('${av.id}')" title="${av.label}"
      style="width:52px;height:52px;border-radius:50%;background:${av.bg};border:${(user.avatarStock===av.id&&!user.avatarDataUrl)?'3px solid #6eb5ff':'2px solid #2d3a52'};cursor:pointer;font-size:26px;display:flex;align-items:center;justify-content:center;">${av.emoji}</button>`
  ).join('');
  modal.innerHTML = `
    <div style="background:#141d2b;border-radius:16px;padding:24px;width:340px;max-width:95vw;color:#f0f0f0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;font-size:16px;">Edit Profile Picture</h3>
        <button onclick="document.getElementById('ct-avatar-modal').remove()" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;">×</button>
      </div>
      <div style="text-align:center;margin-bottom:18px;">
        <div id="ct-avatar-preview" style="display:inline-block;">${getAvatarHTML(user, 72)}</div>
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;color:#888;margin-bottom:8px;">STOCK AVATARS</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">${stockGrid}</div>
      </div>
      <div style="margin-bottom:16px;">
        <div style="font-size:12px;color:#888;margin-bottom:8px;">UPLOAD YOUR OWN (max 1MB)</div>
        <input type="file" id="ct-avatar-upload" accept="image/*" style="display:none;" onchange="window._handleAvatarUpload(this)">
        <button onclick="document.getElementById('ct-avatar-upload').click()"
          style="width:100%;padding:9px;background:#1a2438;border:1px dashed #3b425a;border-radius:8px;color:#aaa;cursor:pointer;font-size:13px;">
          📁 Choose Image…
        </button>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px;">
        <button onclick="window._clearCustomAvatar()" style="flex:1;padding:9px;background:#2d1a1a;border:none;border-radius:8px;color:#f0a0a0;cursor:pointer;font-size:13px;">Remove Custom</button>
        <button onclick="document.getElementById('ct-avatar-modal').remove()" style="flex:1;padding:9px;background:#3b425a;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;">Done</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  window._selectStockAvatar = function(avId) {
    const db = loadDB();
    db.users[user.id].avatarStock = avId;
    db.users[user.id].avatarDataUrl = null;
    state.user = db.users[user.id];
    saveDB(db);
    document.getElementById('ct-avatar-preview').innerHTML = getAvatarHTML(state.user, 72);
    // Refresh stock grid borders
    document.querySelectorAll('#ct-avatar-modal button[onclick*="_selectStockAvatar"]').forEach(btn => {
      const id = btn.getAttribute('onclick').match(/'([^']+)'/)[1];
      btn.style.border = (id === avId) ? '3px solid #6eb5ff' : '2px solid #2d3a52';
    });
    toast('Avatar updated!', true);
    if (document.getElementById('profile-screen')) renderProfile();
  };

  window._handleAvatarUpload = function(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) return toast('Image too large (max 1MB).', false);
    const reader = new FileReader();
    reader.onload = function(e) {
      const db = loadDB();
      db.users[user.id].avatarDataUrl = e.target.result;
      state.user = db.users[user.id];
      saveDB(db);
      document.getElementById('ct-avatar-preview').innerHTML = getAvatarHTML(state.user, 72);
      toast('Custom avatar set!', true);
      if (document.getElementById('profile-screen')) renderProfile();
    };
    reader.readAsDataURL(file);
  };

  window._clearCustomAvatar = function() {
    const db = loadDB();
    db.users[user.id].avatarDataUrl = null;
    state.user = db.users[user.id];
    saveDB(db);
    document.getElementById('ct-avatar-preview').innerHTML = getAvatarHTML(state.user, 72);
    toast('Custom avatar removed.', true);
  };
}

// ============================================================
// FEATURE: HARASSMENT / BULLYING REPORT SYSTEM
// ============================================================
const REPORT_REASONS = [
  'Harassment or bullying',
  'Hate speech or discrimination',
  'Threats or intimidation',
  'Spam or scam messages',
  'Inappropriate username',
  'Cheating or exploits',
  'Other',
];

function saveReport(report) {
  try {
    const reports = JSON.parse(localStorage.getItem('ct_reports') || '[]');
    reports.push(report);
    localStorage.setItem('ct_reports', JSON.stringify(reports));
  } catch(e) {}
}

function openReportDialog(targetUserId, targetUsername) {
  const reporter = state.user;
  if (!reporter) return toast('Sign in to report a user.', false);
  if (targetUserId === reporter.id) return toast('You cannot report yourself.', false);
  const existing = document.getElementById('ct-report-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'ct-report-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:#0009;z-index:9999;display:flex;align-items:center;justify-content:center;';
  const reasonOpts = REPORT_REASONS.map((r,i) =>
    `<label style="display:flex;align-items:center;gap:8px;padding:6px;border-radius:6px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='#1a2438'" onmouseout="this.style.background=''" >
      <input type="radio" name="ct-report-reason" value="${i}" style="accent-color:#6eb5ff;"> <span style="font-size:13px;">${escapeHTML(r)}</span>
    </label>`
  ).join('');
  modal.innerHTML = `
    <div style="background:#141d2b;border-radius:16px;padding:24px;width:360px;max-width:95vw;color:#f0f0f0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:15px;">🚩 Report User</h3>
        <button onclick="document.getElementById('ct-report-modal').remove()" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;">×</button>
      </div>
      <p style="color:#aaa;font-size:13px;margin:0 0 14px;">Reporting: <strong style="color:#f0f0f0;">${escapeHTML(targetUsername||targetUserId)}</strong></p>
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;color:#888;margin-bottom:8px;">SELECT REASON</div>
        ${reasonOpts}
      </div>
      <div style="margin-bottom:14px;">
        <div style="font-size:11px;color:#888;margin-bottom:6px;">ADDITIONAL DETAILS (optional)</div>
        <textarea id="ct-report-detail" maxlength="500" rows="3" placeholder="Describe what happened…"
          style="width:100%;box-sizing:border-box;background:#0d1422;border:1px solid #2d3a52;border-radius:8px;padding:8px;color:#f0f0f0;font-size:13px;resize:vertical;outline:none;"></textarea>
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="document.getElementById('ct-report-modal').remove()" style="flex:1;padding:10px;background:#1a2438;border:1px solid #2d3a52;border-radius:8px;color:#aaa;cursor:pointer;font-size:13px;">Cancel</button>
        <button onclick="window._submitReport('${escapeHTML(targetUserId)}','${escapeHTML(targetUsername||targetUserId)}')" style="flex:1;padding:10px;background:#8b2020;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Submit Report</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  window._submitReport = function(tid, tname) {
    const reasonInput = document.querySelector('input[name="ct-report-reason"]:checked');
    if (!reasonInput) return toast('Please select a reason.', false);
    const detail = (document.getElementById('ct-report-detail') || {}).value || '';
    const report = {
      id: 'rpt_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      reporterId: reporter.id,
      reporterName: reporter.username,
      targetId: tid,
      targetName: tname,
      reason: REPORT_REASONS[parseInt(reasonInput.value)] || 'Other',
      detail: detail.trim().substring(0, 500),
      ts: Date.now(),
      status: 'pending',
    };
    saveReport(report);
    document.getElementById('ct-report-modal').remove();
    toast('Report submitted. Thank you for keeping the community safe. 🛡️', true);
  };
}

// ============================================================
// CHAT BUTTON: Floating chat toggle for lobby/game
// ============================================================
function addChatButton(roomId, label) {
  const existing = document.getElementById('ct-chat-fab');
  if (existing) existing.remove();
  const fab = document.createElement('button');
  fab.id = 'ct-chat-fab';
  fab.title = 'Open Chat';
  fab.innerHTML = '💬';
  fab.style.cssText = 'position:fixed;bottom:16px;right:16px;width:52px;height:52px;border-radius:50%;background:#3b425a;border:none;color:#fff;font-size:22px;cursor:pointer;box-shadow:0 4px 16px #0008;z-index:8000;display:flex;align-items:center;justify-content:center;transition:transform 0.15s;';
  fab.onmouseover = () => { fab.style.transform = 'scale(1.12)'; };
  fab.onmouseout = () => { fab.style.transform = 'scale(1)'; };
  fab.onclick = () => openChat(roomId, label);
  document.body.appendChild(fab);
}

function removeChatButton() {
  const fab = document.getElementById('ct-chat-fab');
  if (fab) fab.remove();
  const overlay = document.getElementById('ct-chat-overlay');
  if (overlay) overlay.remove();
}

// ============================================================
// PATCH: Expose new functions to window for inline HTML use
// ============================================================
window.openAvatarEditor = openAvatarEditor;
window.openReportDialog = openReportDialog;
window.openChat = openChat;
window.openGameChat = openGameChat;
window.getAvatarHTML = getAvatarHTML;
window.validateUsernameAvailability = validateUsernameAvailability;
window.addChatButton = addChatButton;
window.removeChatButton = removeChatButton;


// ============================================================
// FRIENDS SCREEN: search function
// ============================================================
function renderFriendSearchResults(query) {
    var wrap = document.getElementById('friend-search-results');
    if (!wrap) return;
    query = (query || '').trim().toLowerCase();
    if (!query) { wrap.innerHTML = ''; return; }
    var db = loadDB();
    var me = db.users[state.user.id] || state.user;
    var matches = Object.keys(db.users).map(function(k){ return db.users[k]; }).filter(function(u){
      return u.id !== me.id && (u.username || '').toLowerCase().indexOf(query) !== -1;
    }).slice(0, 8);
    if (!matches.length) { wrap.innerHTML = '<div class="muted small" style="padding:8px 2px;">No players found by that username.</div>'; return; }
    wrap.innerHTML = matches.map(function(u){
      var isFriend = (me.friends || []).indexOf(u.id) !== -1;
      var requested = (me.outgoingRequests || []).indexOf(u.id) !== -1;
      var incoming = (me.incomingRequests || []).indexOf(u.id) !== -1;
      var btn;
      if (isFriend) btn = '<div class="pill gold">Friends</div>';
      else if (incoming) btn = '<button class="btn-send-req" data-uname="' + escapeHTML(u.username) + '" style="background:var(--accent);color:#1a1d24;border:none;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;">Accept</button>';
      else if (requested) btn = '<div class="pill" style="opacity:.7;">Requested</div>';
      else btn = '<button class="btn-send-req" data-uname="' + escapeHTML(u.username) + '" style="background:var(--accent);color:#1a1d24;border:none;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;">Send request</button>';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--panel-2);border-radius:10px;margin-bottom:8px;">' +
        (typeof getAvatarHTML === 'function' ? getAvatarHTML(u, 34) : '') +
        '<div style="flex:1;min-width:0;"><div style="font-weight:600;">' + escapeHTML(u.username) + '</div>' +
        '<div class="muted small">ELO ' + u.elo + '</div></div>' + btn + '</div>';
    }).join('');
    $$('#friend-search-results .btn-send-req').forEach(function(b){
      b.addEventListener('click', function(){ addFriendAndRefresh(b.dataset.uname); });
    });
  }
function addFriendAndRefresh(username) {
    try {
      var res = addFriendByUsername(state.user, username);
      if (res && res.accepted) toast('You are now friends with ' + res.username + ' \ud83e\udd1d');
      else toast('Friend request sent to ' + (res ? res.username : username));
      var si = $('#friend-search-input');
      renderFriendSearchResults(si ? si.value : username);
      renderFriendsList();
    } catch (e) {
      toast(e.message, false);
    }
  }
window.renderFriendSearchResults = renderFriendSearchResults;
window.addFriendAndRefresh = addFriendAndRefresh;
  window.acceptFriendRequest = acceptFriendRequest;
  window.declineFriendRequest = declineFriendRequest;


function signOut() {
  if (!confirm('Sign out of ChessTrophies?')) return;
  // Clear session
  try { localStorage.removeItem('chesstrophies_session_v1'); } catch(e) {}
  state.user = null;
  state.userId = null;
  showScreen('lobby');
  renderLobby();
  showNav(true);
  toast('Signed out.', true);
}
window.signOut = signOut;

  // ============================================================
  // 2v2 TEAM CHESS ("Duo") \u2014 additive, self-contained module
  // One board, relay turns: White = you + partner, Black = two opponents.
  // White move order: you, partner, you, partner...  Black: opp1, opp2...
  // On your move, your partner suggests a move you may accept or override.
  // ============================================================
  const duo = {
    game: null, mode: null, ranked: false,
    selected: null, legalTargets: [], lastMove: null,
    teammate: null,   // { name, isAI }
    teammateId: null,
    opp1: null, opp2: null, // opponent team members (sim/AI/users)
    seat: 0,          // whose turn within current color (0/1)
    suggestion: null, // { from, to } from partner during your turn
    over: false, ended: false,
    overrides: 0, accepts: 0,
    youColor: 'w',
    aiLevel: 'medium',
    sawQueenDown: false,
  };
  window.__duo = duo;

  // Lightweight move chooser for a given chess instance + difficulty.
  function duoPickMove(chess, level) {
    const moves = chess.moves({ verbose: true });
    if (moves.length === 0) return null;
    const maximizing = chess.turn() === 'w';
    if (level === 'easy') {
      const caps = moves.filter(m => m.captured);
      if (caps.length && Math.random() < 0.6) return caps[Math.floor(Math.random()*caps.length)];
      return moves[Math.floor(Math.random()*moves.length)];
    }
    // greedy 1-ply on evaluateBoard with light randomness
    let best = null, bestVal = maximizing ? -Infinity : Infinity;
    const shuffled = moves.slice().sort(() => Math.random() - 0.5);
    for (const m of shuffled) {
      chess.move(m);
      let v = evaluateBoard(chess);
      if (chess.in_checkmate()) v = maximizing ? 99999 : -99999;
      chess.undo();
      if (level === 'medium') v += (Math.random()-0.5) * 40;
      if (maximizing ? v > bestVal : v < bestVal) { bestVal = v; best = m; }
    }
    return best || shuffled[0];
  }

  // Is it the human player's seat to move right now?
  function duoIsYourTurn() {
    if (!duo.game || duo.over) return false;
    const turn = duo.game.turn();
    if (turn !== duo.youColor) return false;
    return ((duo.turnCount ? duo.turnCount[duo.youColor] : 0) % 2) === 0; // you choose on even team-turns
  }

  function duoStart(opts) {
    // opts: { ranked, teammateId, teammateName, teammateIsAI, aiLevel }
    const db = loadDB();
    duo.game = new Chess();
    duo.ranked = !!opts.ranked;
    duo.mode = opts.ranked ? 'ranked' : 'private';
    duo.aiLevel = opts.aiLevel || 'medium';
    duo.youColor = 'w';
    duo.seat = 0;
    duo.turnCount = { w: 0, b: 0 }; // times each TEAM has had a turn; chooser = count%2
    duo.selected = null; duo.legalTargets = []; duo.lastMove = null;
    duo.suggestion = null; duo.over = false; duo.ended = false;
    duo.overrides = 0; duo.accepts = 0; duo.sawQueenDown = false;
    duo.teammateId = opts.teammateId || null;
    duo.teammate = { name: opts.teammateName || 'Ally', isAI: opts.teammateIsAI !== false };

    const pool = ['Nova','Rook','Blaze','Sable','Vega','Onyx','Quill','Drift'];
    duo.opp1 = { name: pool[Math.floor(Math.random()*pool.length)] };
    duo.opp2 = { name: pool[Math.floor(Math.random()*pool.length)] };

    if (duo.ranked) {
      const users = Object.values(db.users || {}).filter(u => u.id !== state.user.id && u.id !== duo.teammateId);
      if (users.length >= 2) {
        users.sort((a, b) => Math.abs((a.elo || 1200) - (state.user.elo || 1200)) - Math.abs((b.elo || 1200) - (state.user.elo || 1200)));
        const oppA = users[Math.floor(Math.random() * Math.min(3, users.length))];
        const oppB = users.filter(u => u.id !== oppA.id)[Math.floor(Math.random() * Math.min(3, users.length - 1))];
        if (oppA && oppB) {
          duo.opp1 = { name: oppA.username, elo: oppA.elo || 1200 };
          duo.opp2 = { name: oppB.username, elo: oppB.elo || 1200 };
        }
      }
    }

    // Award "played a 2v2" trophy
    try {
      const me = state.user;
      if (me) { unlockAchievement(me, 'duo_first'); { const _db = loadDB(); if (state.user) _db.users[state.user.id] = state.user; saveDB(_db); } }
    } catch(e){}
    showScreen('duo');
    duoRender();
    duoUpdateStatus();
    duoComputeSuggestion();
  }

  // Advance one ply has been made; rotate seat and drive AI seats.
  function duoAfterPly(move) {
    duo.lastMove = move ? { from: move.from, to: move.to } : null;
    duo.selected = null; duo.legalTargets = [];
    // sound
    try {
      if (window.ChessSounds) {
        if (move && move.captured) window.ChessSounds.capture();
        else window.ChessSounds.move();
        if (duo.game.in_check()) setTimeout(() => window.ChessSounds.check(), 80);
      }
    } catch(e){}
    // track queen-down for comeback trophy (your side lost its queen earlier)
    try {
      const fen = duo.game.fen();
      const youHasQ = duo.youColor === 'w' ? fen.split(' ')[0].includes('Q') : fen.split(' ')[0].includes('q');
      if (!youHasQ) duo.sawQueenDown = true;
    } catch(e){}
    if (duo.game.game_over()) { duoRender(); duoUpdateStatus(); duoFinish(); return; }
    // seat rotates each ply within the same color until color flips
    // A team just completed its single move (normal chess: teams alternate).
    // Record that this team took a turn, then the chooser within each team
    // alternates (0->1->0...) the NEXT time that team is on move.
    const moved = duo.game.turn() === 'w' ? 'b' : 'w'; // side that just moved
    if (!duo.turnCount) duo.turnCount = { w: 0, b: 0 };
    duo.turnCount[moved] = (duo.turnCount[moved] || 0) + 1;
    duo.seat = (duo.turnCount[duo.game.turn()] || 0) % 2; // chooser for side now on move
    duoRender();
    duoUpdateStatus();
    // Drive non-human seats
    duoDriveTurn();
  }

  // Decide who controls the current ply and auto-play AI/sim seats.
  function duoDriveTurn() {
    if (duo.over || !duo.game || duo.game.game_over()) return;
    const turn = duo.game.turn();
    // Your seat: turn === youColor && seat 0 -> wait for human input
    if (turn === duo.youColor && duo.seat === 0) {
      duoComputeSuggestion();
      return;
    }
    // Otherwise an AI/sim seat plays after a short delay
    const level = (turn === duo.youColor) ? duo.aiLevel /* teammate */ : duo.aiLevel /* opponents */;
    setTimeout(() => {
      if (duo.over || duo.game.game_over()) return;
      const m = duoPickMove(duo.game, level);
      if (!m) { duoFinish(); return; }
      const applied = duo.game.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
      duoAfterPly(applied);
    }, 420);
  }

  // Partner computes a suggested move for YOUR turn.
  function duoComputeSuggestion() {
    duo.suggestion = null;
    if (!duoIsYourTurn()) { duoRenderSuggestion(); return; }
    const clone = new Chess(duo.game.fen());
    const m = duoPickMove(clone, duo.aiLevel);
    if (m) duo.suggestion = { from: m.from, to: m.to, promotion: m.promotion || 'q', san: m.san };
    duoRenderSuggestion();
  }

  // Human accepts the partner suggestion.
  function duoAcceptSuggestion() {
    if (!duo.suggestion || !duoIsYourTurn()) return;
    const s = duo.suggestion;
    const applied = duo.game.move({ from: s.from, to: s.to, promotion: s.promotion || 'q' });
    if (!applied) return;
    duo.accepts++;
    try { const me = state.user; if (me) { me.duoSuggestAccepts = (me.duoSuggestAccepts||0)+1; if (me.duoSuggestAccepts >= 10) unlockAchievement(me, 'duo_synergy'); { const _db = loadDB(); if (state.user) _db.users[state.user.id] = state.user; saveDB(_db); } } } catch(e){}
    duoAfterPly(applied);
  }

  // Human clicks a board square during their seat.
  function duoClick(name) {
    if (!duoIsYourTurn()) return;
    const g = duo.game;
    const piece = g.get(name);
    if (duo.selected) {
      if (duo.selected === name) { duo.selected = null; duo.legalTargets = []; duoRender(); return; }
      // try move
      const legal = g.moves({ square: duo.selected, verbose: true }).find(m => m.to === name);
      if (legal) {
        // count as override if it differs from partner suggestion
        if (duo.suggestion && !(duo.suggestion.from === duo.selected && duo.suggestion.to === name)) {
          duo.overrides++;
        }
        const applied = g.move({ from: duo.selected, to: name, promotion: 'q' });
        duoAfterPly(applied);
        return;
      }
      if (piece && piece.color === duo.youColor) { duoSelect(name); return; }
      duo.selected = null; duo.legalTargets = []; duoRender(); return;
    }
    if (piece && piece.color === duo.youColor) duoSelect(name);
  }

  function duoSelect(name) {
    duo.selected = name;
    duo.legalTargets = duo.game.moves({ square: name, verbose: true }).map(m => m.to);
    duoRender();
  }

  function duoRender() {
    const el = $('#duo-board');
    if (!el || !duo.game) return;
    el.innerHTML = '';
    const board = duo.game.board();
    const flip = duo.youColor === 'b';
    for (let r = 7; r >= 0; r--) {
      for (let f = 0; f < 8; f++) {
        const rr = flip ? 7 - r : r;
        const ff = flip ? 7 - f : f;
        const sq = document.createElement('div');
        const isLight = (rr + ff) % 2 === 1;
        const name = squareName(ff, rr);
        sq.className = 'sq ' + (isLight ? 'light' : 'dark');
        sq.dataset.sq = name;
        const pieceObj = board[7 - rr][ff];
        if (pieceObj) sq.innerHTML = pieceSVG(pieceObj.type, pieceObj.color);
        if (duo.selected === name) sq.classList.add('selected');
        if (duo.legalTargets.indexOf(name) !== -1) sq.classList.add('target');
        if (duo.lastMove && (duo.lastMove.from === name || duo.lastMove.to === name)) sq.classList.add('lastmove');
        if (duo.suggestion && duoIsYourTurn() && (duo.suggestion.from === name || duo.suggestion.to === name)) sq.classList.add('duo-suggest-sq');
        sq.addEventListener('click', () => duoClick(name));
        el.appendChild(sq);
      }
    }
  }

  function duoColorLabel(c) { return c === 'w' ? 'White' : 'Black'; }

  function duoUpdateStatus() {
    const s = $('#duo-status'); if (!s || !duo.game) return;
    const turn = duo.game.turn();
    let who;
    if (turn === duo.youColor) who = duo.seat === 0 ? 'Your move' : duo.teammate.name + ' (partner) is thinking\u2026';
    else who = (duo.seat === 0 ? duo.opp1.name : duo.opp2.name) + ' (opponent) is thinking\u2026';
    let extra = '';
    if (duo.game.in_check()) extra = ' \u2014 Check!';
    s.textContent = who + extra;
  }

  function duoRenderSuggestion() {
    const p = $('#duo-suggest'); if (!p) return;
    if (duo.suggestion && duoIsYourTurn()) {
      const sanTxt = duo.suggestion.san || (duo.suggestion.from + '\u2192' + duo.suggestion.to);
      p.style.display = '';
      p.innerHTML = '<div class="duo-suggest-row"><span>\ud83e\udd1d ' + duo.teammate.name + ' suggests: <b>' + sanTxt + '</b></span>' +
        '<span><button id="duo-accept" class="btn btn-secondary" style="padding:6px 12px">Play it</button> ' +
        '<button id="duo-ignore" class="btn" style="padding:6px 12px">I\u2019ll decide</button></span></div>';
      const a = $('#duo-accept'); if (a) a.addEventListener('click', duoAcceptSuggestion);
      const ig = $('#duo-ignore'); if (ig) ig.addEventListener('click', () => { p.style.display='none'; });
    } else { p.style.display = 'none'; p.innerHTML = ''; }
  }

  function duoFinish() {
    if (duo.ended) return;
    duo.ended = true; duo.over = true;
    const g = duo.game;
    let winnerColor = null, reason = 'draw';
    if (g.in_checkmate()) { winnerColor = g.turn() === 'w' ? 'b' : 'w'; reason = 'checkmate'; }
    else if (g.in_stalemate()) { reason = 'stalemate'; }
    else if (g.in_draw() || g.insufficient_material() || g.in_threefold_repetition()) { reason = 'draw'; }
    const youWon = winnerColor === duo.youColor;
    const isDraw = winnerColor === null;
    const me = state.user;
    let delta = 0;
    if (me) {
      me.games2v2 = (me.games2v2||0) + 1; // count completed game
      if (youWon) { me.wins2v2 = (me.wins2v2||0)+1; me.currentStreak2v2 = (me.currentStreak2v2||0)+1; me.bestStreak2v2 = Math.max(me.bestStreak2v2||0, me.currentStreak2v2); }
      else if (isDraw) { me.draws2v2 = (me.draws2v2||0)+1; me.currentStreak2v2 = 0; }
      else { me.losses2v2 = (me.losses2v2||0)+1; me.currentStreak2v2 = 0; }
      // ELO (ranked 2v2 only): team rating vs a simulated team rating near yours
      if (duo.ranked) {
        const myR = me.elo2v2 || 1200;
        const oppR = Math.max(400, myR + Math.floor((Math.random()-0.5)*200));
        const score = isDraw ? 0.5 : (youWon ? 1 : 0);
        const k = (typeof eloKFactor === 'function') ? eloKFactor(myR, me.games2v2||0) : 24;
        delta = Math.round(k * (score - (1/(1+Math.pow(10,(oppR-myR)/400)))));
        me.elo2v2 = Math.max(100, Math.min(2800, myR + delta));
        if (!Array.isArray(me.ratingHistory2v2)) me.ratingHistory2v2 = [myR];
        me.ratingHistory2v2.push(me.elo2v2);
        if (me.ratingHistory2v2.length > 30) me.ratingHistory2v2 = me.ratingHistory2v2.slice(-30);
      }
      // Trophies
      if (youWon) {
        unlockAchievement(me, 'duo_win1');
        if ((me.wins2v2||0) >= 10) unlockAchievement(me, 'duo_win10');
        if ((me.wins2v2||0) >= 25) unlockAchievement(me, 'duo_win25');
        if ((me.currentStreak2v2||0) >= 3) unlockAchievement(me, 'duo_streak3');
        if ((me.currentStreak2v2||0) >= 5) unlockAchievement(me, 'duo_streak5');
        if (duo.overrides > 0) { me.duoOverrideWins = (me.duoOverrideWins||0)+duo.overrides; if ((me.duoOverrideWins||0) >= 20) unlockAchievement(me, 'duo_maverick'); }
        if ((me.elo2v2||1200) >= 1600) unlockAchievement(me, 'duo_2400');
        if (duo.sawQueenDown) unlockAchievement(me, 'duo_comeback');
      }
      try { { const _db = loadDB(); if (state.user) _db.users[state.user.id] = state.user; saveDB(_db); } } catch(e){}
    }
    // celebrate / sound
    try { if (window.ChessSounds) { if (isDraw) window.ChessSounds.note && window.ChessSounds.note(523,0.4,'sine',0.18); else window.ChessSounds.gameOver(youWon); } } catch(e){}
    if (youWon && typeof ctCelebrate === 'function') { try { ctCelebrate('big'); } catch(e){} }
    duoShowResult(youWon, isDraw, reason, delta);
  }

  function duoShowResult(youWon, isDraw, reason, delta) {
    const s = $('#duo-status');
    if (s) s.textContent = isDraw ? 'Draw \u2014 ' + reason : (youWon ? 'Victory! Your team wins.' : 'Defeat \u2014 your team lost.');
    const p = $('#duo-suggest');
    if (p) {
      const dtxt = duo.ranked ? ('<div class="muted small">2v2 rating ' + (delta>=0?'+':'') + delta + ' (now ' + (state.user?state.user.elo2v2:'?') + ')</div>') : '<div class="muted small">Private match \u2014 no rating change.</div>';
      p.style.display = '';
      p.innerHTML = '<div style="text-align:center"><h3 style="margin:4px 0">' + (isDraw?'\ud83e\udd1d Draw':(youWon?'\ud83c\udfc6 Victory':'\ud83d\ude45 Defeat')) + '</h3>' + dtxt +
        '<button id="duo-again" class="btn btn-primary" style="margin-top:10px">Back to lobby</button></div>';
      const again = $('#duo-again'); if (again) again.addEventListener('click', () => { duo.over = true; duo.game = null; showScreen('lobby'); });
    }
  }

  // Forfeit / leave a 2v2 in progress (warns first).
  function duoQuit() {
    if (duo.game && !duo.ended && !duo.over) {
      if (!confirm('Are you sure you want to quit this 2v2 match?\n\nLeaving now counts as a forfeit for your team.')) return false;
      const me = state.user;
      if (me) { me.losses2v2 = (me.losses2v2||0)+1; me.currentStreak2v2 = 0; try { { const _db = loadDB(); if (state.user) _db.users[state.user.id] = state.user; saveDB(_db); } } catch(e){} }
      duo.ended = true; duo.over = true;
    }
    return true;
  }

  // Lobby entry points
  function duoStartRanked() {
    duoStart({ ranked: true, teammateName: 'Ally', teammateIsAI: true, aiLevel: 'medium' });
  }
  function duoStartPrivate(partnerName) {
    throw new Error('Private 2v2 is disabled. Use ranked 2v2 with four players on separate devices.');
  }

  window.Duo = {
    startRanked: duoStartRanked,
    startPrivate: duoStartPrivate,
    quit: duoQuit,
    accept: duoAcceptSuggestion,
    state: duo,
  };

})();
