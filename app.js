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
    // Premium themed Store set override: if a set is equipped and provides this
    // piece, use its themed SVG. Falls through to the built-in Staunton below.
    try { var _themed = (window.CT_Sets && window.CT_Sets.pieceSVG) ? window.CT_Sets.pieceSVG(type, color) : null; if (_themed) return _themed; } catch (e) {}
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
  // Storage / auth / network primitives live in ct-auth.js (loaded before app.js).
  // Aliased into local scope here so the rest of app.js calls them unchanged.
  // ---------------------------------------------------------------------------
  const _A = window.CT_Auth;
  const DB_KEY = _A.DB_KEY, SESSION_KEY = _A.SESSION_KEY, SERVER_URL = _A.SERVER_URL, API_TIMEOUT_MS = _A.API_TIMEOUT_MS;
  const defaultDB = _A.defaultDB, loadDB = _A.loadDB, saveDB = _A.saveDB, getSession = _A.getSession, setSession = _A.setSession;
  const api = _A.api, serverAuth = _A.serverAuth, fetchMe = _A.fetchMe, syncRemoteProfile = _A.syncRemoteProfile;
  const hashPassword = _A.hashPassword, randomSalt = _A.randomSalt, newUser = _A.newUser, findUserByUsername = _A.findUserByUsername;
  const getFriendUsers = _A.getFriendUsers, isServerLoggedIn = _A.isServerLoggedIn, serverAddFriend = _A.serverAddFriend, serverSearchUsers = _A.serverSearchUsers;

  // Cache of the server's authoritative friends list, used by the renderers so they
  // can display synchronously after an async refresh.
  var serverFriendsCache = null;
  async function refreshServerFriends() {
    if (!isServerLoggedIn()) return null;
    var res = await api('/api/friends');
    serverFriendsCache = (res && Array.isArray(res.friends)) ? res.friends : [];
    return serverFriendsCache;
  }
  // Incoming pending friend requests (server-backed accept/reject model).
  var serverRequestsCache = null;
  async function refreshServerRequests() {
    if (!isServerLoggedIn()) return null;
    var res = await api('/api/friends/requests');
    serverRequestsCache = (res && Array.isArray(res.requests)) ? res.requests : [];
    return serverRequestsCache;
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
    // If the current session is a GUEST, snapshot it now so we can carry their
    // local progress onto the new account (state.user is still the guest until the
    // form handler swaps it after this resolves).
    const _guestForMigration = (typeof state !== 'undefined' && state.user && state.user.isGuest) ? state.user : null;
    if (!email || !username || !password) throw new Error('Please fill in all fields.');
    if (!isValidEmail(email)) throw new Error('Enter a valid email address.');
    if (!isValidUsername(username)) throw new Error('Username must be 3–20 letters, numbers, or underscores.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');

    // The server is authoritative. Try it FIRST and let it decide uniqueness, so a
    // stale local-only account in this browser can never block creating a real
    // online account. Local duplicate checks apply only to the offline fallback.
    try {
      const params = new URLSearchParams(window.location.search);
      const invitedBy = params.get('invitedBy') || undefined;
      const { token } = await serverAuth('/api/auth/signup', { email, username, password, region, invitedBy, startingElo });
      setSession({ userId: null, token });
      const profile = await fetchMe();
      const user = syncRemoteProfile(profile);
      setSession({ userId: user.id, token });
      return migrateGuestProgress(_guestForMigration, user);
    } catch (serverErr) {
      // Server reachable and said no (email/username taken, invalid): surface it.
      // Only a genuinely unreachable backend falls through to an offline account.
      if (serverErr.status && serverErr.status < 500 && !serverErr.transient) throw serverErr;
    }

    const db = loadDB();
    if (findUserByEmail(db, email)) throw new Error('An account with that email already exists.');
    if (Object.values(db.users).some(u => u.username.toLowerCase() === username.toLowerCase()))
      throw new Error('That username is taken.');
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
    setSession({ userId: user.id, offline: true });
    return migrateGuestProgress(_guestForMigration, user);
  }

  // When a GUEST signs up, carry their local progress onto the brand-new account
  // so they don't feel they lost what they built. The account is fresh (empty
  // trophy/streak arrays from syncRemoteProfile / newUser), so we assign the
  // guest's earned values directly: daily streak, trophies, achievements, and the
  // learning/trophy flags. The daily streak also follows to the SERVER via the
  // progress sync the signup form triggers afterwards (and the sync's merge keeps
  // the better streak, so a server pull can't clobber it). Stats (elo/W-L) are NOT
  // carried — guests play practice only (always 0) and the account is canonical.
  function migrateGuestProgress(guest, account) {
    try {
      if (!guest || !account || !guest.isGuest || guest.id === account.id) return account;
      const db = loadDB();
      const acct = db.users[account.id];
      if (!acct) return account;
      if (guest.playStreak) acct.playStreak = guest.playStreak;
      if (Array.isArray(guest.streakTrophies) && guest.streakTrophies.length) acct.streakTrophies = guest.streakTrophies.slice();
      if (Array.isArray(guest.achievements) && guest.achievements.length) acct.achievements = guest.achievements.slice();
      if (guest.flags && typeof guest.flags === 'object') {
        acct.flags = Object.assign({}, acct.flags || {}, guest.flags);
        delete acct.flags.guestGames; // guest-only practice-ramp counter; irrelevant to an account
      }
      db.users[account.id] = acct;
      saveDB(db);
      return acct;
    } catch (e) { return account; }
  }
  // Look up a local account by email OR username (offline fallback for login).
  function findLocalAccount(db, identifier) {
    const id = (identifier || '').trim();
    if (!id) return null;
    return findUserByEmail(db, id) || findUserByUsername(db, id) || null;
  }
  async function login(identifier, password) {
    identifier = (identifier || '').trim();
    if (!identifier) throw new Error('Enter your email or username.');

    try {
      // Server accepts `identifier` (email or username); send legacy `email` too so
      // an older backend that only reads `email` still works for email logins.
      const { token } = await serverAuth('/api/auth/login', { identifier, email: identifier, password });
      setSession({ userId: null, token });
      const profile = await fetchMe();
      const user = syncRemoteProfile(profile);
      setSession({ userId: user.id, token });
      return user;
    } catch (serverErr) {
      // The server is authoritative. If it was REACHABLE and rejected the login,
      // trust it -- never silently sign in to a stale local-only account, which is
      // exactly what traps a user "offline" with no way to play online.
      if (!serverErr.transient) {
        const local = findLocalAccount(loadDB(), identifier);
        // Only nudge to Sign Up when this really is a local-only account whose
        // password matches here (not a server-synced cache or a wrong password).
        if (local && local.pwHash) {
          const h = await hashPassword(password, local.salt);
          if (h === local.pwHash) {
            throw new Error('This account was only saved on this device. Tap Sign Up to register it online and play.');
          }
        }
        throw serverErr; // genuine wrong identifier / password
      }
      // Server unreachable -> allow offline login to a local account if present.
      const db = loadDB();
      const u = findLocalAccount(db, identifier);
      if (!u) throw new Error('Cannot reach the server. Check your connection and try again.');
      const h = await hashPassword(password, u.salt);
      if (h !== u.pwHash) throw new Error('Incorrect password.');
      setSession({ userId: u.id, offline: true });
      return u;
    }
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
    // Online (server-authoritative) play
    isOnline: false,
    gameId: null,         // server-issued game id when in an online match
    applyingRemoteMove: false, // guard so afterMove doesn't echo opponent moves back to server
    awaitingServerGameOver: false, // when online, defer local handleGameOver until server sends game_over
    selectedTc: '10+0', // last-chosen time control for online matchmaking
    drag: null,           // active drag-and-drop session (see onBoardPointerDown)
  };

  // ---------------------------------------------------------------------------
  // Server feature flags (GET /api/config). The whole client gates ranked UI on
  // a SINGLE source of truth: rankedEnabled. Default FALSE (safe) so a config
  // fetch failure / unreachable server hides ranked rather than dead-ending a
  // user in a queue that can never match. Flip the server env to re-enable the
  // UI with no client change.
  // ---------------------------------------------------------------------------
  var _rankedEnabled = false;
  function rankedEnabled() { return _rankedEnabled === true; }
  async function fetchServerConfig() {
    try {
      const cfg = await api('/api/config');
      _rankedEnabled = !!(cfg && cfg.rankedEnabled);
    } catch (e) {
      _rankedEnabled = false; // safe default on any failure
    }
    // Re-paint any ranked entry points now that we know the flag.
    try { applyRankedGate(); } catch (e) {}
    return _rankedEnabled;
  }

  // Fire-and-forget share analytics. platform: x|facebook|whatsapp|reddit|
  // telegram|copy|native. Public endpoint — never blocks the share action and
  // swallows all errors (the share itself must always succeed).
  function trackShare(platform) {
    try {
      api('/api/share/track', { method: 'POST', body: JSON.stringify({ platform: platform }) }).catch(function () {});
    } catch (e) { /* never let analytics break a share */ }
  }

  // The canonical site URL to share, plus the referral param when logged in. We
  // reuse the SAME ?invitedBy=<userId> param the existing referral link uses.
  const SHARE_SITE_URL = 'https://www.playchesstrophies.com/';
  function buildShareUrl() {
    let url = SHARE_SITE_URL;
    const u = state.user;
    // Match the referral link: append ?invitedBy=<userId> for real (non-guest)
    // accounts so shares are attributed.
    if (u && u.id && !u.isGuest) {
      url += '?invitedBy=' + encodeURIComponent(u.id);
    }
    return url;
  }

  // ---------------------------------------------------------------------------
  // Time controls (game clocks). Key format "<minutes>+<incrementSeconds>".
  // The server pairs only players on the SAME tc key, so these strings matter.
  // ---------------------------------------------------------------------------
  // Kept deliberately to TWO choices so the matchmaking pool isn't fragmented:
  // a single standard timed control and an untimed (no-clock) game. With a small
  // queue, more options would mean players unable to find a same-tc opponent.
  const TC_OPTIONS = [
    { key: '10+0',      label: '10 min',  cat: 'Timed' },
    { key: 'unlimited', label: 'No clock', cat: 'Untimed' },
  ];
  const TC_DEFAULT = '10+0';
  const TC_STORE_KEY = 'ct_selected_tc_v1';

  function tcDisplay(key) {
    if (!key || key === 'unlimited') return 'unlimited';
    return key; // already in "M+S" form
  }
  function loadSelectedTc() {
    try {
      const v = localStorage.getItem(TC_STORE_KEY);
      if (v && TC_OPTIONS.some((o) => o.key === v)) { state.selectedTc = v; return; }
    } catch (e) {}
    state.selectedTc = TC_DEFAULT;
  }
  function saveSelectedTc(key) {
    state.selectedTc = key;
    try { localStorage.setItem(TC_STORE_KEY, key); } catch (e) {}
  }
  loadSelectedTc();

  // ---------------------------------------------------------------------------
  // Client-side clock runner. The server is authoritative; we only smooth the
  // display of the running side between move events. clockState is rebuilt from
  // every clock-bearing payload using `serverNow` so latency doesn't accumulate.
  // ---------------------------------------------------------------------------
  const clockState = {
    active: false,         // true only for a clocked (non-unlimited) game
    wMs: 0, bMs: 0,        // last server-reported remaining ms per side
    running: 'w',          // side currently counting down
    localBase: 0,          // Date.now() captured when wMs/bMs were valid
    // element ids for the side mapped to each on-screen card
    topSide: 'b', botSide: 'w',
    topEl: null, botEl: null,
    interval: null,
  };

  function clockStop() {
    if (clockState.interval) { clearInterval(clockState.interval); clockState.interval = null; }
    clockState.active = false;
    // Hide whatever clock elements we were driving.
    [clockState.topEl, clockState.botEl].forEach((el) => { if (el) el.style.display = 'none'; });
  }

  function fmtClock(ms) {
    if (ms < 0) ms = 0;
    const totalSecs = ms / 1000;
    const mins = Math.floor(totalSecs / 60);
    if (ms < 20000) {
      // Under 20s: show tenths for urgency.
      const secs = Math.floor(totalSecs % 60);
      const tenths = Math.floor((ms % 1000) / 100);
      return mins + ':' + String(secs).padStart(2, '0') + '.' + tenths;
    }
    const secs = Math.round(totalSecs % 60);
    // round can yield 60 at boundaries; normalize.
    if (secs === 60) return (mins + 1) + ':00';
    return mins + ':' + String(secs).padStart(2, '0');
  }

  // Remaining ms for a side right now, accounting for the running side ticking.
  function clockRemaining(side) {
    let ms = side === 'w' ? clockState.wMs : clockState.bMs;
    if (clockState.running === side) ms -= (Date.now() - clockState.localBase);
    return Math.max(0, ms);
  }

  function clockPaint() {
    if (!clockState.active) return;
    const pairs = [
      { el: clockState.topEl, side: clockState.topSide },
      { el: clockState.botEl, side: clockState.botSide },
    ];
    pairs.forEach((p) => {
      if (!p.el) return;
      const ms = clockRemaining(p.side);
      p.el.textContent = fmtClock(ms);
      p.el.style.display = '';
      p.el.classList.toggle('running', clockState.running === p.side && ms > 0);
      p.el.classList.toggle('low', ms < 20000);
    });
  }

  // Start/refresh the clock from a server payload's clock object.
  // clock = { initialMs?, incrementMs?, w, b, running, serverNow }
  // topEl/botEl are the DOM clock elements; topSide/botSide map sides to cards.
  function clockSync(clock, topEl, botEl, topSide, botSide) {
    if (!clock) { clockStop(); return; }
    clockState.wMs = typeof clock.w === 'number' ? clock.w : clockState.wMs;
    clockState.bMs = typeof clock.b === 'number' ? clock.b : clockState.bMs;
    clockState.running = clock.running || clockState.running;
    // localBase aligns "now" with the server's clock snapshot. We don't have a
    // real offset, so treat serverNow as ~= the moment we received it; this keeps
    // the running side from drifting because every move event re-syncs.
    clockState.localBase = Date.now();
    if (topEl) clockState.topEl = topEl;
    if (botEl) clockState.botEl = botEl;
    if (topSide) clockState.topSide = topSide;
    if (botSide) clockState.botSide = botSide;
    clockState.active = true;
    clockPaint();
    if (!clockState.interval) {
      clockState.interval = setInterval(clockPaint, 200);
    }
  }

  // 1v1: map the two on-screen clock cards to board sides from current orientation.
  // Bottom of the board is always the `orientation` color; top is the other side.
  function clock1v1Map() {
    return {
      topEl: document.getElementById('pt-clock'), botEl: document.getElementById('pb-clock'),
      topSide: state.orientation === 'w' ? 'b' : 'w',
      botSide: state.orientation,
    };
  }

  // ---------------------------------------------------------------------------
  // Tiered achievement catalog — each tier is a separate trophy and gets harder.
  // Tiered achievement catalog lives in trophy-data.js (loaded before app.js).
  const ACHIEVEMENT_TIERS = (typeof window !== 'undefined' && window.CT_ACHIEVEMENT_TIERS) || [];

  function achievementEntry(user, id) {
    user.achievements = user.achievements || [];
    return user.achievements.find(a => a.id === id);
  }
  // How many times this trophy has been earned. Legacy entries (saved before the
  // repeat counter existed) have no `count`, so a present-but-countless entry
  // counts as 1 — old saves keep their trophies and start counting from there.
  function achievementCount(user, id) {
    const e = achievementEntry(user, id);
    if (!e) return 0;
    return (e.count != null) ? e.count : 1;
  }
  function hasAchievement(user, id) {
    return achievementCount(user, id) > 0;
  }
  // Grant a trophy `times` times (default 1), bumping its earned counter.
  // Repeatable trophies (streaks, single-game feats) reach counts > 1 over a
  // career; one-time milestones never go past 1.
  function awardAchievement(user, id, times) {
    times = times || 1;
    user.achievements = user.achievements || [];
    let e = achievementEntry(user, id);
    const def = ACHIEVEMENT_TIERS.find(a => a.id === id);
    if (!e) { e = { id, awardedAt: Date.now(), firstAt: Date.now(), count: 0 }; user.achievements.push(e); }
    const prev = (e.count != null) ? e.count : 1; // legacy entry counts as 1
    e.count = prev + times;
    e.lastAt = Date.now();
    // Play a sound when a trophy is earned: triumphant for normal trophies,
    // a not-so-triumphant cue for embarrassing (Oops) trophies. Purely cosmetic;
    // does not affect which trophies are granted or how they are stored.
    try {
      if (window.ChessSounds) {
        if (def && def.embarrassing) window.ChessSounds.trophyOops();
        else window.ChessSounds.trophy();
      }
    } catch (e2) {}
    return def;
  }
  // Back-compat one-time unlock (kept for external callers): grants once.
  function unlockAchievement(user, id, meta) {
    if (hasAchievement(user, id)) return null;
    const def = awardAchievement(user, id, 1);
    if (def && meta) { const e = achievementEntry(user, id); if (e) e.meta = meta; }
    return def;
  }
  // The one-time "milestone reached" test for a non-repeatable trophy.
  function trophyConditionMet(user, a, ctx) {
    switch (a.type) {
      case 'wins':     return user.wins >= a.threshold;
      case 'streak':   return user.currentStreak >= a.threshold;
      case 'elo':      return user.elo >= a.threshold;
      case 'games':    return (user.wins + user.losses + user.draws) >= a.threshold;
      case 'mate':     return (user.mateWins || 0) >= a.threshold;
      case 'fast':     return !!(ctx && ctx.justWon) && (ctx.moves != null && ctx.moves <= a.threshold);
      case 'comeback': return (user.comebackWins || 0) >= a.threshold;
      case 'invites':  return (user.invitesAccepted || 0) >= a.threshold;
      case 'flag':     return !!(user.flags && (user.flags[a.flag] || 0) >= a.threshold);
      // Checkers trophies — evaluated against the user's checkers stats block
      // (state.user.checkers = { elo8, elo10, wins, losses, draws, streak }),
      // synced from /api/me and reconciled locally as ranked games finish.
      case 'checkers_elo': {
        const ck = user.checkers || {};
        return Math.max(ck.elo8 || 0, ck.elo10 || 0) >= a.threshold;
      }
      case 'checkers_games': {
        const ck = user.checkers || {};
        return ((ck.wins || 0) + (ck.losses || 0) + (ck.draws || 0)) >= a.threshold;
      }
    }
    return false;
  }
  // Check every tier and award anything newly earned.
  //   ctx may include { justWon, mateWin, moves, gameCheckCount, finalize }
  // REPEATABLE trophies (streaks + single-game feats) re-award with a counter,
  // but only on the FINAL post-game pass (ctx.finalize) so the two-phase chess
  // result flow can't double-count a single game. One-time milestones (total
  // wins, games, rating, etc.) award once and stay at a count of 1.
  function checkAchievementsFor(user, ctx) {
    const newly = [];
    const finalize = !!(ctx && ctx.finalize);
    for (const a of ACHIEVEMENT_TIERS) {
      if (a.repeatable) {
        if (!finalize) continue; // count repeats exactly once per game
        let inc = 0;
        if (a.type === 'streak') {
          // Awarded each time the exact streak length is freshly hit; the streak
          // resets to 0 on a loss, so the next run can earn it again.
          if (ctx.justWon && user.currentStreak === a.threshold) inc = 1;
        } else if (a.type === 'fast') {
          if (ctx.justWon && ctx.moves != null && ctx.moves <= a.threshold) inc = 1;
        } else if (a.type === 'flag') {
          // Counter mirrors how many times the single-game feat has happened.
          const total = (user.flags && (user.flags[a.flag] || 0)) || 0;
          const have = achievementCount(user, a.id);
          if (total > have) inc = total - have;
        }
        if (inc > 0) { const def = awardAchievement(user, a.id, inc); if (def) newly.push(def); }
      } else {
        if (achievementCount(user, a.id) > 0) continue;
        if (trophyConditionMet(user, a, ctx)) {
          const def = awardAchievement(user, a.id, 1);
          if (def) newly.push(def);
        }
      }
    }
    return newly;
  }
  function tierColor(tier) {
    return ['#cd7f32','#9aa0b3','#f5c451','#7dd4ff','#c084fc','#34d399','#fb7185','#ffffff'][Math.min((tier || 1) - 1, 7)];
  }

  // ---------------------------------------------------------------------------
  // DAILY PLAY STREAK
  // ---------------------------------------------------------------------------
  // Consecutive calendar days (LOCAL date, YYYY-MM-DD) on which the user SOLVED the
  // daily puzzle (repointed from "finished any game"; the streak now rewards the
  // daily-challenge retention loop). The pure transition lives in computePlayStreak
  // (no DOM), exposed via window.CT for testing. recordDailyPlay() wires it into
  // state + persistence + trophies and is called from window.CT_onPuzzleSolved.

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
  // Pure streak transition (no DOM). Returns the new { streak, best, lastDate }.
  //   prev.lastDate === todayKey            -> unchanged (already counted today)
  //   prev.lastDate === yesterday(todayKey) -> streak + 1
  //   otherwise                              -> streak resets to 1
  function computePlayStreak(prev, todayK) {
    const cur = {
      streak: (prev && typeof prev.streak === 'number') ? prev.streak : 0,
      best: (prev && typeof prev.best === 'number') ? prev.best : 0,
      lastDate: (prev && prev.lastDate) || null,
    };
    if (cur.lastDate === todayK) {
      return { streak: cur.streak, best: cur.best, lastDate: cur.lastDate };
    }
    let streak;
    if (cur.lastDate && cur.lastDate === yesterdayKeyOf(todayK)) {
      streak = cur.streak + 1;
    } else {
      streak = 1;
    }
    const best = Math.max(cur.best || 0, streak);
    return { streak, best, lastDate: todayK };
  }

  // Record that the user finished a game today. Idempotent per day (the helper
  // no-ops if today is already counted), so it's safe to call from every
  // game-end path. Persists, mirrors the flag, checks trophies, syncs + redraws.
  function recordDailyPlay() {
    const u = state.user;
    if (!u) return;
    const prev = u.playStreak || { streak: 0, best: 0, lastDate: null };
    const today = todayKey();
    const next = computePlayStreak(prev, today);
    u.playStreak = { streak: next.streak, best: next.best, lastDate: next.lastDate };
    // Mirror the current streak into the flag the flag-based trophy check reads.
    u.flags = u.flags || {};
    u.flags.dailyPlayStreak = next.streak;
    // Persist the user record (same loadDB/saveDB pattern as finishGame).
    const db = loadDB();
    if (db.users[u.id]) { db.users[u.id] = u; saveDB(db); }
    checkAchievementsFor(u);
    if (window.CT_syncProgress) window.CT_syncProgress();
    renderPlayStreak();
  }

  // Lobby play-streak card. current = streak only if lastDate is today/yesterday
  // (a missed day breaks the live streak to 0 until they play again).
  function renderPlayStreak() {
    const wrap = $('#playstreak-card');
    if (!wrap) return;
    const u = state.user;
    if (!u) { wrap.innerHTML = ''; return; }
    const ps = u.playStreak || { streak: 0, best: 0, lastDate: null };
    const today = todayKey();
    const yest = yesterdayKeyOf(today);
    const best = ps.best || 0;
    const isToday = ps.lastDate === today;
    const isYesterday = ps.lastDate === yest;
    const current = (isToday || isYesterday) ? (ps.streak || 0) : 0;
    // Three states with escalating urgency: DONE today (celebratory), AT RISK
    // (streak alive from yesterday but today's puzzle unsolved — loss-aversion),
    // and START (no live streak). At-risk is the strongest retention lever, so it
    // gets a red/urgent treatment instead of the calm gold.
    const atRisk = current >= 1 && isYesterday && !isToday;
    const doneToday = current >= 1 && isToday;
    let line, title, icon, border, bg, lineColor;
    if (doneToday) {
      title = 'Daily Puzzle Streak';
      line = current + '-day streak' + (best > current ? ' · best ' + best : '') + ' — see you tomorrow!';
      icon = '🔥'; border = 'var(--accent)';
      bg = 'linear-gradient(135deg, rgba(245,196,81,.10), var(--panel))'; lineColor = 'var(--accent)';
    } else if (atRisk) {
      title = '🔥 ' + current + '-day streak ends tonight!';
      line = 'Solve today’s puzzle now to keep your ' + current + '-day streak alive.';
      icon = '⚠️'; border = '#e0683c';
      bg = 'linear-gradient(135deg, rgba(224,104,60,.16), var(--panel))'; lineColor = '#e0683c';
    } else {
      title = 'Daily Puzzle Streak';
      line = 'Solve today’s puzzle to start a daily streak.';
      icon = '🔥'; border = 'var(--accent)';
      bg = 'linear-gradient(135deg, rgba(245,196,81,.10), var(--panel))'; lineColor = 'var(--accent)';
    }
    wrap.innerHTML =
      '<div class="card pc-streak-card" data-act="open-daily" style="cursor:pointer;border:1px solid ' + border + ';background:' + bg + '">' +
        '<div class="pc-row" style="display:flex;align-items:center;gap:12px">' +
          '<div class="pc-icon" style="font-size:26px">' + icon + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div class="pc-title" style="font-weight:800;font-size:16px">' + escapeHTML(title) + '</div>' +
            '<div class="small" style="margin-top:4px;color:' + lineColor + ';font-weight:700">' + escapeHTML(line) + '</div>' +
          '</div>' +
          '<div class="pc-go" style="font-size:18px;color:' + lineColor + ';opacity:.7">›</div>' +
        '</div>' +
      '</div>';
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
  // How many games this user has FINISHED (any mode). Registered users have it in
  // their record (wins+losses+draws); guests have no record, so we track a simple
  // session counter (state._sessionGamesFinished, bumped in finishGame). Used to
  // hold back ad/upsell clutter until the user has actually completed a game.
  function gamesFinishedCount() {
    const u = state.user;
    if (!u) return 0;
    const recorded = (u.wins || 0) + (u.losses || 0) + (u.draws || 0);
    return Math.max(recorded, state._sessionGamesFinished || 0);
  }
  // Ads + the "Remove ads" upsell stay hidden until the user has finished >=1 game.
  // (No point selling ad-removal to someone who's seen zero ads.) Premium users
  // never see either, regardless.
  function adsUnlocked() {
    const u = state.user;
    if (!u || u.isPremium) return false;
    return gamesFinishedCount() >= 1;
  }

  function renderAdSlot(type) {
    if (state.user && state.user.isPremium) return '';
    // Don't render any ad (or its "Remove ads" upsell) before the user has
    // finished a game — there's no real inventory and it's pure clutter at start.
    if (!adsUnlocked()) return '';
    const cfg = {
      banner: { label: 'Sponsored', size: '320×50',  copy: 'Your brand here. Premium players never see this.' },
      medium: { label: 'Sponsored', size: '300×250', copy: 'Sponsored — upgrade to Premium to remove all ads.' },
      native: { label: 'Sponsored', size: 'Native',  copy: 'A relevant chess product or learning resource could appear here.' },
    }[type] || { label: 'Sponsored', size: 'Banner', copy: 'Ad placeholder' };
    return `<div class="ad-slot ad-${type}" data-ad-type="${type}">
      <div class="ad-label">${cfg.label} · ${cfg.size}</div>
      <div class="ad-body">
        <div class="ad-copy">${cfg.copy}</div>
        <button class="ad-upgrade" data-act="open-premium">Remove ads</button>
      </div>
    </div>`;
  }

  // --- Stripe billing (subscription) ---------------------------------------
  // Stays a no-op/demo until the backend has Stripe keys configured; the client
  // discovers that via GET /api/billing/config.
  let billingCfg = { enabled: false, publishableKey: null, mode: 'subscription' };
  async function fetchBillingConfig() {
    try { const c = await api('/api/billing/config'); if (c) billingCfg = Object.assign(billingCfg, c); } catch (e) {}
    // Re-paint any premium copy now that we know whether billing is live.
    try { applyPremiumCopy(); } catch (e) {}
    // Reveal the Settings "Subscription" (manage/cancel) section only when live.
    try { const ss = $('#settings-subscription'); if (ss) ss.style.display = billingCfg.enabled ? '' : 'none'; } catch (e) {}
  }
  async function startCheckout() {
    try {
      const r = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({}) });
      if (r && r.url) { window.location.href = r.url; return; }
      toast('Could not start checkout — please try again.');
    } catch (e) {
      toast(e && e.status === 401 ? 'Please sign in to upgrade.' : 'Could not start checkout — please try again.');
    }
  }
  async function openBillingPortal() {
    try {
      const r = await api('/api/billing/portal', { method: 'POST', body: JSON.stringify({}) });
      if (r && r.url) { window.location.href = r.url; return; }
      toast('Could not open the billing portal.');
    } catch (e) { toast('Could not open the billing portal.'); }
  }
  // After returning from Stripe Checkout (success_url adds ?billing=success), the
  // subscription is confirmed by the webhook, which flips is_premium server-side.
  // Poll /api/me a few times so Premium activates without a manual refresh.
  function handleBillingReturn() {
    let bp;
    try { bp = new URLSearchParams(window.location.search).get('billing'); } catch (e) { return; }
    if (!bp) return;
    try { history.replaceState({}, '', window.location.pathname); } catch (e) {}
    if (bp === 'cancel') { toast('Checkout cancelled — you were not charged.'); return; }
    if (bp !== 'success') return;
    toast('Payment received — activating Premium…', true);
    let tries = 0;
    const poll = function () {
      tries++;
      fetchMe().then(function (profile) {
        const fresh = profile ? syncRemoteProfile(profile) : null;
        if (fresh) state.user = fresh;
        if (state.user && state.user.isPremium) {
          try { if (window.CT_Ads) window.CT_Ads.refresh(true); } catch (e) {}
          toast('Premium is active 🎉 ads removed', true);
          if (typeof renderLobby === 'function') renderLobby();
          return;
        }
        if (tries < 5) setTimeout(poll, 1500);
      }).catch(function () { if (tries < 5) setTimeout(poll, 1500); });
    };
    setTimeout(poll, 1200);
  }

  // Drive ALL premium price/CTA copy (modal button, modal disclaimer, lobby card)
  // from billingCfg.enabled so the screen never contradicts itself. When billing
  // is LIVE: consistent "$4.99/mo · cancel anytime" everywhere. When disabled
  // (demo/self-host with no Stripe keys): honest demo wording, no fake price.
  function applyPremiumCopy() {
    const live = !!billingCfg.enabled;
    const priceLine = $('#premium-price-line');
    const disclaimer = $('#premium-disclaimer');
    const lobbyDesc = $('#lobby-premium-desc');
    const lobbyPill = $('#lobby-premium-pill');
    if (live) {
      if (priceLine) priceLine.textContent = '$4.99/mo · cancel anytime';
      if (disclaimer) disclaimer.textContent = '$4.99/month, billed securely via Stripe. Cancel anytime from Manage subscription.';
      if (lobbyDesc) lobbyDesc.textContent = 'Support the app, hide all ad slots, unlock a Premium badge on your profile.';
      if (lobbyPill) lobbyPill.textContent = '$4.99/mo';
    } else {
      if (priceLine) priceLine.textContent = 'Free demo · unlocks the perks instantly';
      if (disclaimer) disclaimer.textContent = 'Billing isn’t enabled on this server, so upgrading is a free demo that just unlocks the perks above.';
      if (lobbyDesc) lobbyDesc.textContent = 'Hide all ad slots and unlock a Premium badge on your profile.';
      if (lobbyPill) lobbyPill.textContent = 'Try it';
    }
  }

  function openPremium() {
    // Analytics: the premium modal opened.
    try { window.CT_Analytics && window.CT_Analytics.track('premium_view'); } catch (e) {}
    const isPremium = state.user && state.user.isPremium;
    const live = !!billingCfg.enabled;
    applyPremiumCopy();
    const buyBtn = $('#btn-premium-buy');
    const cancelBtn = $('#btn-premium-cancel-paid');
    if (buyBtn) {
      buyBtn.style.display = isPremium ? 'none' : '';
      buyBtn.textContent = live ? 'Upgrade · $4.99/mo' : 'Unlock Premium (free demo)';
    }
    if (cancelBtn) {
      cancelBtn.style.display = isPremium ? '' : 'none';
      // With real billing on, "cancel" opens the Stripe portal (manage/cancel);
      // in demo mode it simply toggles Premium off.
      cancelBtn.textContent = live ? 'Manage subscription' : 'Cancel Premium';
    }
    openModal('premium');
  }
  function setPremium(value) {
    state.user.isPremium = !!value;
    state.user.premiumSince = value ? Date.now() : null;
    // Analytics: a confirmed premium activation (client-side activation point).
    if (value) { try { window.CT_Analytics && window.CT_Analytics.track('purchase'); } catch (e) {} }
    const db = loadDB();
    db.users[state.user.id] = state.user;
    saveDB(db);
    toast(value ? 'Premium activated 🎉 ads removed' : 'Premium cancelled', true);
    // Show/hide the native AdMob banner to match the new premium state.
    try { if (window.CT_Ads) window.CT_Ads.refresh(!!value); } catch (e) {}
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
    // Warn before leaving an in-progress checkers match (forfeits if confirmed).
    if (id !== 'checkers' && window.CT_Checkers_UI && window.CT_Checkers_UI.isActive && window.CT_Checkers_UI.isActive()) {
      if (!confirm('Leave this checkers match?\n\nLeaving now counts as a resignation.')) return;
      // Resign through the UI module so the online/result paths still run.
      try { window.CT_Checkers_UI.resignActive && window.CT_Checkers_UI.resignActive(); } catch (e) {}
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
      const on = n.dataset.nav === id;
      n.classList.toggle('active', on);
      if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    if (id === 'lobby') renderLobby();
    if (id === 'profile') renderProfile();
    if (id === 'rankings') renderRankings();
    if (id === 'feared') renderFeared();
    if (id === 'season') renderSeason();
    // Arena screen owns a poll/countdown ticker — start it on enter, stop on any
    // other screen (exit() is idempotent).
    if (window.CT_Arena) { if (id === 'arena') window.CT_Arena.enter(); else if (window.CT_Arena.exit) window.CT_Arena.exit(); }
    if (id === 'trophies') renderTrophies();
    if (id === 'friends') { serverRequestsCache = null; renderFriendsList(); }
    // Academy lives in academy.js; it exposes window.CT_renderAcademy to populate #academy-content on demand.
    if (id === 'academy' && window.CT_renderAcademy) window.CT_renderAcademy();
    if (id === 'settings') { /* settings already rendered statically */ }
    if (id === 'puzzles') {
      // Entering the Puzzles screen (bottom nav). If the module is missing, bounce
      // back to the lobby with a toast rather than showing an empty screen.
      if (!puzzlesAvailable()) { toast('Puzzles are unavailable right now.'); $('#screen-puzzles').classList.remove('active'); $('#screen-lobby').classList.add('active'); return; }
      try { window.CT_Puzzles.openDaily(); } catch (e) {}
    }
  }

  function showNav(visible) {
    $('#bottom-nav').classList.toggle('show', visible);
  }

  function ctCelebrate(intensity) {
    // Lightweight confetti burst for trophy/streak celebrations. Visual only.
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      // Scaled intensities: 'win' (a plain game win) < 'normal' (a trophy) <
      // 'big' (multi-trophy / 7-win streak). Keeps a normal win from feeling as
      // loud as a streak milestone.
      var count = intensity === 'big' ? 90 : intensity === 'win' ? 38 : 55;
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
  // Named rating tiers. Crossing UP into a higher one on a ranked win is a
  // celebratory "rank up" moment (the reveal below). Boundaries are every ~200
  // ELO; names stay chess-credible.
  var CT_TIERS = [
    { min: 0,    name: 'Novice',           icon: '🪶' },
    { min: 800,  name: 'Apprentice',       icon: '♟️' },
    { min: 1000, name: 'Casual',           icon: '🛡️' },
    { min: 1200, name: 'Intermediate',     icon: '⚔️' },
    { min: 1400, name: 'Skilled',          icon: '🎯' },
    { min: 1600, name: 'Advanced',         icon: '🔥' },
    { min: 1800, name: 'Expert',           icon: '💎' },
    { min: 2000, name: 'Candidate Master', icon: '👑' },
    { min: 2200, name: 'Master',           icon: '🏅' },
    { min: 2400, name: 'Grandmaster',      icon: '⭐' },
  ];
  function ctTierIndex(elo) {
    var i = 0;
    for (var k = 0; k < CT_TIERS.length; k++) { if (elo >= CT_TIERS[k].min) i = k; }
    return i;
  }
  // A brief, centered "Rank Up!" reveal. Inline styles + CSS transitions only
  // (CSP-safe, no @keyframes / no asset). Reduced-motion shows it static + brief.
  function ctRankUpReveal(tier, newElo) {
    try {
      if (!tier) return;
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var o = document.createElement('div');
      o.setAttribute('role', 'status');
      o.style.cssText = 'position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;pointer-events:none';
      var card = document.createElement('div');
      card.style.cssText = 'text-align:center;padding:24px 40px;border-radius:18px;background:linear-gradient(160deg,rgba(22,30,50,.97),rgba(12,18,32,.97));border:1px solid rgba(245,196,81,.5);box-shadow:0 18px 60px rgba(0,0,0,.55),0 0 0 1px rgba(245,196,81,.15)';
      card.innerHTML = '<div style="font-size:48px;line-height:1">' + tier.icon + '</div>' +
        '<div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#f5c451;font-weight:800;margin-top:10px">Rank up</div>' +
        '<div style="font-size:25px;font-weight:800;color:#fff;margin-top:2px">' + tier.name + '</div>' +
        '<div style="font-size:13px;color:#9fb2cc;margin-top:4px">ELO ' + newElo + '</div>';
      if (!reduce) {
        card.style.opacity = '0';
        card.style.transform = 'scale(.86) translateY(10px)';
        card.style.transition = 'opacity .4s ease, transform .45s cubic-bezier(.2,1.3,.4,1)';
      }
      o.appendChild(card);
      document.body.appendChild(o);
      if (!reduce) {
        requestAnimationFrame(function () { card.style.opacity = '1'; card.style.transform = 'scale(1) translateY(0)'; });
        setTimeout(function () { card.style.opacity = '0'; card.style.transform = 'scale(1) translateY(-6px)'; }, 2100);
        setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 2700);
      } else {
        setTimeout(function () { if (o.parentNode) o.parentNode.removeChild(o); }, 1700);
      }
    } catch (e) {}
  }
  // Briefly punctuate a checkmate on the board: flash the mated king's square red
  // and topple the king (CSS). Visual only — does NOT touch the engine/board state.
  // Returns the delay (ms) the caller should wait before showing the result modal
  // so the moment is seen first; 0 when nothing was punctuated. Reduced-motion-safe
  // (the CSS swaps the animation for a static tint), but we still honor the same
  // gate the rest of the celebrations use so we never surprise reduced-motion users
  // with movement.
  function ctMateMoment(loserColor) {
    try {
      var boardEl = document.getElementById('board');
      if (!boardEl || !loserColor) return 0;
      // Find the mated king's square from the live position.
      var sqName = null;
      try {
        var b = state.game.board(); // rank 8 -> rank 1
        for (var r = 0; r < 8 && !sqName; r++) {
          for (var f = 0; f < 8; f++) {
            var pc = b[r][f];
            if (pc && pc.type === 'k' && pc.color === loserColor) {
              sqName = FILES[f] + (8 - r); break;
            }
          }
        }
      } catch (e) {}
      if (!sqName) return 0;
      var sqEl = boardEl.querySelector('[data-sq="' + sqName + '"]');
      if (!sqEl) return 0;
      sqEl.classList.remove('ct-mate'); void sqEl.offsetWidth; // restart animation
      sqEl.classList.add('ct-mate');
      // The .ct-mate class is left in place; the next renderBoard() (new game,
      // rematch, review) rebuilds #board from scratch and drops it.
      return 420;
    } catch (e) { return 0; }
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

  // Accessible modal: role=dialog + aria-modal, focus trap (Tab cycles inside),
  // Escape to close, and focus returned to the trigger on close. Same signatures
  // as before so every caller is unchanged. CSP-safe (addEventListener only).
  let _modalState = null;
  function _modalFocusables(el) {
    return Array.from(el.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(n => n.offsetParent !== null); // visible only (skips display:none controls)
  }
  function openModal(id) {
    const overlay = $('#modal-' + id);
    if (!overlay) return;
    overlay.classList.add('show');
    const dialog = overlay.querySelector('.modal') || overlay;
    try {
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      if (!dialog.getAttribute('aria-label') && !dialog.getAttribute('aria-labelledby')) {
        const h = dialog.querySelector('h1,h2,h3');
        if (h && h.textContent.trim()) dialog.setAttribute('aria-label', h.textContent.trim());
      }
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    } catch (e) {}
    const prevFocus = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(id); return; }
      if (e.key !== 'Tab') return;
      const f = _modalFocusables(dialog);
      if (!f.length) { e.preventDefault(); try { dialog.focus(); } catch (er) {} return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    overlay.addEventListener('keydown', onKey);
    _modalState = { id, overlay, onKey, prevFocus };
    // Move focus into the dialog once it's shown (first field/button, else the dialog).
    setTimeout(() => { try { const f = _modalFocusables(dialog); (f[0] || dialog).focus(); } catch (e) {} }, 30);
  }
  function closeModal(id) {
    const overlay = $('#modal-' + id);
    if (!overlay) return;
    overlay.classList.remove('show');
    if (_modalState && _modalState.id === id) {
      try { overlay.removeEventListener('keydown', _modalState.onKey); } catch (e) {}
      const pf = _modalState.prevFocus;
      _modalState = null;
      try { if (pf && typeof pf.focus === 'function') pf.focus(); } catch (e) {}
    }
  }

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
      setSession(Object.assign({}, getSession(), { userId: u.id }));
      state.user = u;
      if (window.__connectGameSocket) window.__connectGameSocket();
      enterApp();
      const s = getSession();
      if (s && s.offline) toast('Signed in offline — ranked online play is unavailable until you reconnect.');
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });

  $('#form-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#signup-error').textContent = '';
    // Was this a guest converting? (signup() carries their progress onto the new
    // account; we push it to the server + acknowledge it below.)
    const _wasGuest = !!(state.user && state.user.isGuest);
    try {
      const u = await signup(
        $('#signup-email').value,
        $('#signup-username').value,
        $('#signup-password').value,
        $('#signup-region').value,
          // Default to a beginner rating (800) when no level is picked, so brand-new
          // players aren't over-seeded at "Intermediate".
          (function () { const v = $('#signup-skill') ? parseInt($('#signup-skill').value, 10) : NaN; return Number.isFinite(v) ? v : 800; })()
      );
      setSession(Object.assign({}, getSession(), { userId: u.id }));
      state.user = u;
      // Analytics: a successful account creation.
      try { window.CT_Analytics && window.CT_Analytics.track('signup', { wasGuest: _wasGuest }); } catch (e) {}
      toast('Welcome, ' + u.username + ' 👑', true);
      if (window.__connectGameSocket) window.__connectGameSocket();
      enterApp();
      // Guest → account: push the carried progress (daily streak, learning) up to
      // the server so it follows the user across devices, and acknowledge it.
      if (_wasGuest) {
        try { if (window.CT_syncProgress) window.CT_syncProgress(); } catch (e) {}
        const _st = (u.playStreak && u.playStreak.streak) || 0;
        const _tr = ((u.streakTrophies && u.streakTrophies.length) || 0) + ((u.achievements && u.achievements.length) || 0);
        if (_st > 1) setTimeout(() => toast('Your ' + _st + '-day streak came with you 🔥', true), 900);
        else if (_tr > 0) setTimeout(() => toast('Your progress came with you 🏆', true), 900);
      }
      const s = getSession();
      if (s && s.offline) toast('Account created offline — ranked online play is unavailable until you reconnect.');
    } catch (err) {
      $('#signup-error').textContent = err.message;
    }
  });

  // Password reset (forgot password) ----------------------------------
  // Two-step flow inside one modal: (1) request a reset code by email,
  // (2) enter the code + a new password. When the server can send email it does;
  // when it's configured to expose the token (EXPOSE_RESET_TOKEN dev path) it
  // returns `devToken`, which we prefill so the flow can still be completed.
  function showForgotStep(step) {
    $('#forgot-step-1').style.display = step === 1 ? '' : 'none';
    $('#forgot-step-2').style.display = step === 2 ? '' : 'none';
  }

  function resetForgotModal() {
    showForgotStep(1);
    $('#forgot-email').value = '';
    $('#forgot-status').textContent = '';
    $('#forgot-error').textContent = '';
    $('#reset-code').value = '';
    $('#reset-new-password').value = '';
    $('#reset-note').textContent = '';
    $('#reset-error').textContent = '';
  }

  // Open the reset modal from the login form's "Forgot password?" link.
  const forgotLink = $('#link-forgot-password');
  if (forgotLink) {
    forgotLink.addEventListener('click', (e) => {
      e.preventDefault();
      resetForgotModal();
      // Pre-fill with whatever the user already typed into the login email field.
      $('#forgot-email').value = $('#login-email').value || '';
      openModal('forgot-password');
    });
  }

  const forgotCancel = $('#btn-forgot-cancel');
  if (forgotCancel) forgotCancel.addEventListener('click', () => closeModal('forgot-password'));
  const resetCancel = $('#btn-reset-cancel');
  if (resetCancel) resetCancel.addEventListener('click', () => closeModal('forgot-password'));

  // Step 1: request a reset code.
  const forgotSend = $('#btn-forgot-send');
  if (forgotSend) {
    forgotSend.addEventListener('click', async () => {
      $('#forgot-error').textContent = '';
      $('#forgot-status').textContent = '';
      const email = ($('#forgot-email').value || '').trim();
      if (!email) { $('#forgot-error').textContent = 'Enter your email.'; return; }
      forgotSend.disabled = true;
      try {
        const r = await api('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
        // Always show a neutral message so we don't reveal whether the email exists.
        $('#forgot-status').textContent = 'If that email exists, a reset code has been issued.';
        const hint = $('#forgot-code-hint');
        if (r && r.devToken) {
          // Dev/self-host convenience: when the server is configured to expose the
          // reset token (EXPOSE_RESET_TOKEN) it returns it so we can prefill the field.
          $('#reset-code').value = r.devToken;
          $('#reset-note').textContent = 'Reset code prefilled for you.';
          if (hint) hint.textContent = 'Your reset code is prefilled below. (Email delivery isn’t enabled on this server.)';
        } else if (hint) {
          hint.textContent = 'Check your email for the reset code, then paste it below.';
        }
        showForgotStep(2);
      } catch (err) {
        $('#forgot-error').textContent = err.message;
      } finally {
        forgotSend.disabled = false;
      }
    });
  }

  // Step 2: submit the code + new password.
  const resetSubmit = $('#btn-reset-submit');
  if (resetSubmit) {
    resetSubmit.addEventListener('click', async () => {
      $('#reset-error').textContent = '';
      const token = ($('#reset-code').value || '').trim();
      const newPassword = $('#reset-new-password').value || '';
      if (!token) { $('#reset-error').textContent = 'Enter your reset code.'; return; }
      if (newPassword.length < 6) { $('#reset-error').textContent = 'Password must be at least 6 characters.'; return; }
      resetSubmit.disabled = true;
      try {
        await api('/api/auth/reset', { method: 'POST', body: JSON.stringify({ token, newPassword }) });
        closeModal('forgot-password');
        toast('Password updated — please sign in.', true);
        // Switch back to the login tab so the user can sign in with the new password.
        const loginTab = $('#screen-auth .tab[data-tab="login"]');
        if (loginTab) loginTab.click();
      } catch (err) {
        $('#reset-error').textContent = err.message;
      } finally {
        resetSubmit.disabled = false;
      }
    });
  }

  // Change password (from Settings) -----------------------------------
  const changePwBtn = $('#btn-change-password');
  if (changePwBtn) {
    changePwBtn.addEventListener('click', () => {
      $('#cp-current').value = '';
      $('#cp-new').value = '';
      $('#cp-error').textContent = '';
      openModal('change-password');
    });
  }
  const cpCancel = $('#btn-cp-cancel');
  if (cpCancel) cpCancel.addEventListener('click', () => closeModal('change-password'));

  const cpSubmit = $('#btn-cp-submit');
  if (cpSubmit) {
    cpSubmit.addEventListener('click', async () => {
      $('#cp-error').textContent = '';
      const currentPassword = $('#cp-current').value || '';
      const newPassword = $('#cp-new').value || '';
      if (!currentPassword) { $('#cp-error').textContent = 'Enter your current password.'; return; }
      if (newPassword.length < 6) { $('#cp-error').textContent = 'New password must be at least 6 characters.'; return; }
      cpSubmit.disabled = true;
      try {
        const r = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
        // The server revoked the old token (token_version bump); adopt the fresh
        // one it returned so this session stays signed in.
        if (r && r.token) { try { setSession(Object.assign({}, getSession(), { token: r.token })); } catch (e) {} }
        closeModal('change-password');
        toast('Password changed.', true);
      } catch (err) {
        $('#cp-error').textContent = err.message;
      } finally {
        cpSubmit.disabled = false;
      }
    });
  }

  // A 401 from an authed call means our stored token is no longer valid (e.g. it
  // predates a server JWT_SECRET change, or expired). Clear it and send the user
  // back to sign in rather than dead-ending on a raw "Unauthorized".
  function handleAuthExpired(msg) {
    // Idempotent: a burst of 401s (friends + progress + socket all fail at once)
    // must only sign the user out + prompt ONCE, not spam toasts or re-enter auth.
    if (state._authExpiredHandled) return;
    // If we're already on the auth screen with no user, there's nothing to expire.
    if (!state.user && !getSession()) return;
    state._authExpiredHandled = true;
    setSession(null);
    state.user = null;
    if (window.CTNet) { try { window.CTNet.disconnect(); } catch (e) {} }
    state._netHandlersRegistered = false;
    showNav(false);
    showScreen('auth');
    toast(msg || 'Your session expired — please sign in again.');
  }

  // Single global listener for the centralized 401 signal dispatched by
  // ct-auth.js's api() helper. Friends/progress/avatar calls that swallow their
  // own errors now still route the user back to sign-in via this one path.
  window.addEventListener('ct-auth-expired', function () { handleAuthExpired(); });

  // Email verification (soft nudge) -----------------------------------
  // Resend the verification email for the signed-in user. `noteEl` (optional)
  // gets a dev-fallback hint when the server isn't configured to send email.
  async function resendVerification(btn, noteEl) {
    if (btn) btn.disabled = true;
    try {
      const r = await api('/api/auth/resend-verification', { method: 'POST', body: JSON.stringify({}) });
      if (r && r.alreadyVerified) {
        toast('Your email is already verified. ✓', true);
        await refreshVerifiedStatus();
        return;
      }
      // Dev/self-host convenience: when the server is configured to expose the code
      // (email delivery not enabled), it returns it so the flow can still be
      // completed via the "Enter code" modal.
      if (r && r.devVerifyCode) {
        const codeInput = $('#verify-code'); if (codeInput) codeInput.value = r.devVerifyCode;
        if (noteEl) noteEl.textContent = 'Code prefilled for you. (Email delivery isn’t enabled on this server.)';
        toast('Verification code issued.', true);
      } else if (r && r.sent) {
        toast('Verification email sent — check your inbox for your 6-digit code.', true);
      } else {
        toast('Verification requested. If email is configured, check your inbox.');
      }
    } catch (err) {
      if (err && err.status === 401) { handleAuthExpired('Your session expired — please sign in again to verify your email.'); return; }
      toast(err.message || 'Could not resend verification.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Re-fetch the profile so the banner reflects a freshly verified email.
  async function refreshVerifiedStatus() {
    try {
      if (!isServerLoggedIn()) return;
      const profile = await fetchMe();
      state.user = syncRemoteProfile(profile);
      updateVerifyBanner();
    } catch (e) {}
  }

  const verifyResendBtn = $('#btn-verify-resend');
  if (verifyResendBtn) verifyResendBtn.addEventListener('click', () => resendVerification(verifyResendBtn, null));

  const verifyCodeLink = $('#link-verify-code');
  if (verifyCodeLink) verifyCodeLink.addEventListener('click', (e) => {
    e.preventDefault();
    $('#verify-code').value = '';
    $('#verify-error').textContent = '';
    $('#verify-note').textContent = '';
    openModal('verify-email');
  });

  const verifyCancel = $('#btn-verify-cancel');
  if (verifyCancel) verifyCancel.addEventListener('click', () => closeModal('verify-email'));

  const verifyResend2 = $('#btn-verify-resend2');
  if (verifyResend2) verifyResend2.addEventListener('click', () => resendVerification(verifyResend2, $('#verify-note')));

  const verifySubmit = $('#btn-verify-submit');
  if (verifySubmit) verifySubmit.addEventListener('click', async () => {
    $('#verify-error').textContent = '';
    const code = ($('#verify-code').value || '').replace(/\s+/g, '');
    if (!code) { $('#verify-error').textContent = 'Enter the 6-digit code from your email.'; return; }
    verifySubmit.disabled = true;
    try {
      await api('/api/auth/verify', { method: 'POST', body: JSON.stringify({ code }) });
      closeModal('verify-email');
      toast('Email verified — thank you! ✓', true);
      // Persist emailVerified=true to the local DB IMMEDIATELY so a reload before
      // the follow-up /api/me sync still sees verified and never re-prompts.
      if (state.user) {
        state.user.emailVerified = true;
        const _db = loadDB();
        if (_db.users[state.user.id]) { _db.users[state.user.id].emailVerified = true; saveDB(_db); }
      }
      updateVerifyBanner();
      await refreshVerifiedStatus();
    } catch (err) {
      if (err && err.status === 401) { closeModal('verify-email'); handleAuthExpired('Your session expired — please sign in again to verify your email.'); return; }
      $('#verify-error').textContent = err.message;
    } finally {
      verifySubmit.disabled = false;
    }
  });

  // Continue as guest -------------------------------------------------
  // Asks the server for a goofy display name unique among active guests. The
  // guest session lives ONLY in sessionStorage, so it is gone when the tab
  // closes. Nothing about a guest is written to the local account DB or the
  // server DB -- no progress, stats, or trophies persist.
  function makeGuestUser(username) {
    return {
      id: 'guest:' + username,
      username: username,
      email: '', region: '',
      elo: 1200, wins: 0, losses: 0, draws: 0,
      currentStreak: 0, bestStreak: 0, invitesAccepted: 0,
      isPremium: false, isGuest: true,
      friends: [], streakVictims: [], streakTrophies: [],
      achievements: [], flags: {},
      themeBoard: 'forest', themePieces: 'classic',
      createdAt: Date.now()
    };
  }

  // Persist a guest's local record (trophies, daily streak, ramp counter) so it
  // survives a refresh / tab-close / next visit. No-op for signed-in users (they
  // persist via the normal DB/server paths). The guest lives in the same local
  // db.users the boot restore reads, so this is all it takes to bring them back.
  function saveGuest() {
    try {
      if (state.user && state.user.isGuest) {
        const db = loadDB();
        db.users[state.user.id] = state.user;
        saveDB(db);
      }
    } catch (e) {}
  }

  // Difficulty for a guest's practice game. Newcomers get an eased first couple of
  // games (800 -> 1000 -> 1200) so a beginner can actually WIN — a good first
  // impression that also fires the signup CTA. After the ramp (or for signed-in
  // users) it falls back to the chosen slider value. Ramp index = games played.
  function guestPracticeElo(sliderVal) {
    const u = state.user;
    if (u && u.isGuest) {
      const gp = (u.flags && u.flags.guestGames) || 0;
      const RAMP = [800, 1000, 1200];
      if (gp < RAMP.length) return RAMP[gp];
    }
    return sliderVal;
  }

  // Start a guest session and jump into the app. Shared by the prominent "Play now"
  // button at the top of the auth card and the "Continue as guest" button below.
  // opts.playNow=true honours the "start a game in one tap" promise: it drops the
  // guest straight into a Practice vs Computer game (board on screen) instead of
  // the lobby — no dead-end.
  async function startGuestSession(btn, opts) {
    opts = opts || {};
    if (btn) btn.disabled = true;
    try {
      let username = null;
      try {
        const r = await api('/api/guest', { method: 'POST' });
        username = r && r.username;
      } catch (e) { username = null; }
      if (!username) username = 'Guest' + (Math.floor(Math.random() * 9999) + 1);
      const gu = makeGuestUser(username);
      // PERSIST the guest locally (localStorage), unlike before (sessionStorage,
      // gone on tab-close). Stored in the same local db.users + session the boot
      // restore reads, so a returning guest is brought straight back into the app
      // with their trophies + daily streak intact. This is the #1 retention fix.
      const gdb = loadDB();
      if (!gdb.users[gu.id]) { gdb.users[gu.id] = gu; saveDB(gdb); }
      state.user = gdb.users[gu.id];
      setSession({ userId: gu.id, guest: true });
      // Show the nav and prep lobby state, then optionally drop straight into a game.
      enterApp();
      if (opts.playNow) {
        const firstGame = !(state.user.flags && state.user.flags.guestGames);
        const lvl = guestPracticeElo(($('#practice-elo') && $('#practice-elo').value) || 1200);
        toast(firstGame
          ? 'Practice vs the computer — free, no signup. Win it to earn your first trophy! 🏆'
          : 'Playing offline vs computer — sign up to play real people.');
        startPracticeGame(lvl);
      } else {
        toast('Playing as ' + username + ' (guest)', true);
      }
    } catch (err) {
      if (btn) btn.disabled = false;
    }
  }

  const guestBtn = $('#btn-continue-guest');
  if (guestBtn) guestBtn.addEventListener('click', () => startGuestSession(guestBtn));
  const playNowBtn = $('#btn-play-now');
  if (playNowBtn) playNowBtn.addEventListener('click', () => startGuestSession(playNowBtn, { playNow: true }));

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
    if (state.user && state.user.isGuest) {
      const gname = state.user.username;
      api('/api/guest/release', { method: 'POST', body: JSON.stringify({ username: gname }) }).catch(function(){});
      try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    }
    setSession(null);
    state.user = null;
    if (window.CTNet) window.CTNet.disconnect();
    state._netHandlersRegistered = false;
    showNav(false);
    showScreen('auth');
  });

  // ---------------------------------------------------------------------------
  // Lobby
  // ---------------------------------------------------------------------------
  function renderLobby() {
  if (!state.user) return;
    const u = state.user;
    $('#lobby-avatar').innerHTML = getAvatarHTML(u, 40);
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
    // Inject ad slot (renderAdSlot returns '' for premium users AND for users who
    // haven't finished a game yet). Hide the container whenever it's empty so it
    // can't leave a gap.
    const adWrap = $('#lobby-ad-slot');
    if (adWrap) {
      const adHtml = renderAdSlot('banner');
      adWrap.innerHTML = adHtml;
      adWrap.style.display = adHtml ? '' : 'none';
    }
    // The "Go Premium / Remove ads" upsell follows the same gate as ads: hidden for
    // premium users and for anyone who hasn't finished a game yet (don't pitch
    // ad-removal to someone who has seen no ads).
    const upWrap = $('#lobby-premium-card');
    if (upWrap) upWrap.style.display = adsUnlocked() ? '' : 'none';
    applyPremiumCopy();
    // Season ladder nudge ("Season ends in N days") — ranked-only, best-effort.
    refreshSeasonNudge();
    // Today's Challenge card + Puzzles nav: only when the puzzle module loaded.
    const _puz = puzzlesAvailable();
    const dailyCard = $('#lobby-daily-card');
    if (dailyCard) dailyCard.style.display = _puz ? '' : 'none';
    const navPuz = $('#nav-puzzles');
    if (navPuz) navPuz.style.display = _puz ? '' : 'none';
    const premiumBadge = $('#premium-badge');
    if (premiumBadge) premiumBadge.style.display = u.isPremium ? '' : 'none';
    updateVerifyBanner();
    // Paint ranked entry points per the seasonal switch (Coming soon when off).
    applyRankedGate();
    // Daily play-streak card (consecutive days the user finished any game).
    renderPlayStreak();
    // Live arena card (shown only when an arena is live/upcoming; degrades hidden).
    if (window.CT_Arena && window.CT_Arena.renderLobbyCard) window.CT_Arena.renderLobbyCard();
    // Keep the (possibly hidden) checkers stat row in sync with state.user.checkers.
    if (typeof renderCheckersLobbyStats === 'function') renderCheckersLobbyStats();
  }

  // Soft email-verification nudge: shown only for server-logged-in users whose
  // email isn't confirmed yet. Guests/offline accounts have no server email to
  // verify, so they never see it.
  function updateVerifyBanner() {
    const banner = $('#verify-banner');
    if (!banner) return;
    const u = state.user;
    // Hide the banner the moment the server says verified — and once verified it
    // must NEVER reappear. Only show for a server-logged-in user we KNOW is
    // unverified (emailVerified === false). Any other value (true/undefined)
    // keeps it hidden.
    const show = !!u && isServerLoggedIn() && u.emailVerified === false;
    banner.style.display = show ? 'flex' : 'none';
  }

  // Seasonal ranked switch — drives EVERY ranked entry point off the single
  // rankedEnabled() flag. When false: disable + badge the ranked buttons with a
  // clear "Coming soon" state. When true: restore them. Practice / friendly /
  // pass-and-play / friend challenges / the nav tabs are never touched here.
  // Idempotent + safe to call before the flag is known (defaults to disabled).
  function applyRankedGate() {
    const enabled = rankedEnabled();
    // [selector, original label] for each ranked button.
    const targets = [
      ['#btn-find-match', 'Find ranked opponent'],
      ['#btn-duo-online', 'Find ranked 2v2'],
      ['#btn-duo-ranked', 'Find ranked 2v2'],
      ['#ck-btn-find-match', 'Find ranked checkers opponent'],
      // 2v2 invite-from-friend (ranked duo) — disabling the trigger is enough;
      // the friend-challenge modal also routes to ranked 2v2.
      ['#btn-fc-ranked', 'Invite to 2v2 (random opponents)'],
    ];
    targets.forEach(function (t) {
      const btn = $(t[0]);
      if (!btn) return;
      if (!btn.dataset.rankedLabel) btn.dataset.rankedLabel = btn.textContent;
      const baseLabel = btn.dataset.rankedLabel || t[1];
      if (enabled) {
        btn.disabled = false;
        btn.classList.remove('is-coming-soon');
        btn.removeAttribute('aria-disabled');
        btn.textContent = baseLabel;
      } else {
        btn.disabled = true;
        btn.classList.add('is-coming-soon');
        btn.setAttribute('aria-disabled', 'true');
        // Append a small "Coming soon" badge (kept inside the button so it
        // collapses with the button; CSP-safe — no inline handlers).
        btn.innerHTML = escapeHTML(baseLabel) +
          ' <span class="pill coming-soon-badge" style="margin-left:8px">Coming soon</span>';
      }
    });

    // Lobby hierarchy: when ranked is OFF, lead with Practice/Casual (the modes
    // that actually work for everyone) and collapse the ranked 1v1 + 2v2 cards
    // into a single muted "More modes coming soon" line. When ON, restore the
    // original Casual -> Ranked 1v1 -> Practice -> 2v2 order and show all cards.
    const practice = $('#card-practice');
    const casual = $('#card-casual');
    const ranked1v1 = $('#card-ranked1v1');
    const section2v2 = $('#section-2v2');
    const moreModes = $('#lobby-more-modes');
    if (enabled) {
      if (casual) casual.style.order = '1';
      if (ranked1v1) { ranked1v1.style.order = '2'; ranked1v1.style.display = ''; }
      if (practice) practice.style.order = '3';
      if (section2v2) { section2v2.style.order = '4'; section2v2.style.display = ''; }
      if (moreModes) moreModes.style.display = 'none';
    } else {
      if (practice) practice.style.order = '1';
      if (casual) casual.style.order = '2';
      if (ranked1v1) ranked1v1.style.display = 'none';
      if (section2v2) section2v2.style.display = 'none';
      if (moreModes) { moreModes.style.order = '5'; moreModes.style.display = ''; }
    }
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
    // Logged-in users: use the server's authoritative friends list (cached).
    if (isServerLoggedIn()) {
      var sf = serverFriendsCache || [];
      wrap.textContent = sf.length
        ? (sf.length + ' friend' + (sf.length === 1 ? '' : 's'))
        : 'No friends yet — add one in Friends';
      if (serverFriendsCache === null) {
        refreshServerFriends().then(function(){ renderFriendsSummary(); }).catch(function(){});
      }
      return;
    }
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
    // Logged-in users: render from the server's authoritative friends list.
    if (isServerLoggedIn()) {
      renderServerFriendsList(wrap);
      return;
    }
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
          '<div class="friend-actions" style="display:flex;gap:6px;align-items:center;flex-shrink:0;">' +
            '<button type="button" class="pill gold fc-go-chess" data-fid="' + escapeHTML(String(f.id)) + '" title="Challenge to chess" style="cursor:pointer;border:none;">♟ Chess</button>' +
            '<button type="button" class="pill fc-go-checkers" data-fid="' + escapeHTML(String(f.id)) + '" title="Challenge to checkers" style="cursor:pointer;background:#2a3142;color:var(--accent,#ffd97a);border:1px solid var(--accent,#ffd97a);">⛀ Checkers</button>' +
          '</div></div>';
      }).join('');
    }
    wrap.innerHTML = html;
    renderFriendsSummary();
    $$('#friends-list [data-friend-id]').forEach(function(row){
      row.addEventListener('click', function(){ openFriendChallenge(row.dataset.friendId); });
    });
    // Explicit per-friend challenge buttons (clearer than the catch-all modal):
    // one starts a chess challenge, the other a checkers challenge directly.
    $$('#friends-list .fc-go-chess').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); startFriendChess(b.dataset.fid); });
    });
    $$('#friends-list .fc-go-checkers').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); startFriendCheckers(b.dataset.fid); });
    });
    $$('#friends-list .btn-accept-req').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); acceptFriendRequest(state.user, b.dataset.id); toast('Friend added \ud83e\udd1d'); renderFriendsList(); });
    });
    $$('#friends-list .btn-decline-req').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); declineFriendRequest(state.user, b.dataset.id); renderFriendsList(); });
    });
  }

  // Render the friends list from the server's authoritative data. The server's
  // /api/friends/add is immediate (no pending-request state), so there is no
  // incoming-requests section here.
  function renderServerFriendsList(wrap) {
    var friends = serverFriendsCache || [];
    var requests = serverRequestsCache || [];
    var html = '';
    // Incoming friend requests -> accept/reject (the consent flow).
    if (requests.length) {
      html += '<div class="muted small" style="text-transform:uppercase;letter-spacing:.6px;margin:4px 0 6px;">Friend requests</div>';
      html += requests.map(function(u){
        return '<div class="friend-row" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--panel-2);border-radius:10px;margin-bottom:8px;">' +
          (typeof getAvatarHTML === 'function' ? getAvatarHTML(u, 34) : '') +
          '<div style="flex:1;min-width:0;"><div style="font-weight:600;">' + escapeHTML(u.username) + '</div>' +
          '<div class="muted small">wants to be friends</div></div>' +
          '<button class="btn-accept-req" data-id="' + escapeHTML(String(u.id)) + '" style="background:var(--accent);color:#1a1d24;border:none;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;">Accept</button>' +
          '<button class="btn-decline-req" data-id="' + escapeHTML(String(u.id)) + '" style="background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;">Reject</button>' +
          '</div>';
      }).join('');
    }
    html += '<div class="muted small" style="text-transform:uppercase;letter-spacing:.6px;margin:10px 0 6px;">Your friends</div>';
    if (serverFriendsCache === null) {
      html += '<div class="muted small" style="padding:8px 2px;">Loading friends…</div>';
    } else if (!friends.length) {
      html += '<div class="muted small" style="padding:8px 2px;">No friends yet. Search by username above to add one.</div>';
    } else {
      html += friends.map(function(f){
        return '<div class="friend-row" data-friend-id="' + escapeHTML(String(f.id)) + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--panel-2);border-radius:10px;margin-bottom:8px;cursor:pointer;">' +
          (typeof getAvatarHTML === 'function' ? getAvatarHTML(f, 34) : '') +
          '<div style="flex:1;min-width:0;"><div style="font-weight:600;">' + escapeHTML(f.username) + '</div>' +
          '<div class="muted small">ELO ' + (f.elo || 1200) + ' · ' + (f.wins||0) + 'W ' + (f.losses||0) + 'L</div></div>' +
          '<div class="friend-actions" style="display:flex;gap:6px;align-items:center;flex-shrink:0;">' +
            '<button type="button" class="pill gold fc-go-chess" data-fid="' + escapeHTML(String(f.id)) + '" title="Challenge to chess" style="cursor:pointer;border:none;">♟ Chess</button>' +
            '<button type="button" class="pill fc-go-checkers" data-fid="' + escapeHTML(String(f.id)) + '" title="Challenge to checkers" style="cursor:pointer;background:#2a3142;color:var(--accent,#ffd97a);border:1px solid var(--accent,#ffd97a);">⛀ Checkers</button>' +
          '</div></div>';
      }).join('');
    }
    wrap.innerHTML = html;
    renderFriendsSummary();
    $$('#friends-list [data-friend-id]').forEach(function(row){
      row.addEventListener('click', function(){ openFriendChallenge(row.dataset.friendId); });
    });
    // Explicit per-friend challenge buttons (clearer than the catch-all modal):
    // one starts a chess challenge, the other a checkers challenge directly.
    $$('#friends-list .fc-go-chess').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); startFriendChess(b.dataset.fid); });
    });
    $$('#friends-list .fc-go-checkers').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); startFriendCheckers(b.dataset.fid); });
    });
    $$('#friends-list .btn-accept-req').forEach(function(b){
      b.addEventListener('click', function(){ respondToFriendRequest(b.dataset.id, true); });
    });
    $$('#friends-list .btn-decline-req').forEach(function(b){
      b.addEventListener('click', function(){ respondToFriendRequest(b.dataset.id, false); });
    });
    if (serverFriendsCache === null) {
      refreshServerFriends().then(function(){ renderServerFriendsList(wrap); }).catch(function(){
        serverFriendsCache = serverFriendsCache || [];
        renderServerFriendsList(wrap);
      });
    }
    if (serverRequestsCache === null) {
      refreshServerRequests().then(function(){ renderServerFriendsList(wrap); }).catch(function(){
        serverRequestsCache = serverRequestsCache || [];
      });
    }
  }

  // Accept or reject an incoming server friend request, then refresh the list.
  function respondToFriendRequest(fromId, accept) {
    var path = accept ? '/api/friends/accept' : '/api/friends/decline';
    api(path, { method: 'POST', body: JSON.stringify({ fromId: fromId }) }).then(function(){
      toast(accept ? 'Friend added 🤝' : 'Request dismissed');
      serverFriendsCache = null; serverRequestsCache = null;
      renderFriendsList();
    }).catch(function(err){ toast((err && err.message) || 'Could not update request.'); });
  }

  // Block a player by id (server-enforced: no matching, no requests, hidden in search).
  function blockPlayer(userId, username) {
    if (!isServerLoggedIn()) { toast('Sign in to block players.'); return; }
    if (!confirm('Block ' + (username || 'this player') + '?\n\nYou won’t be matched with them, they can’t friend-request you, and any existing friendship is removed.')) return;
    api('/api/friends/block', { method: 'POST', body: JSON.stringify({ userId: userId }) }).then(function(){
      toast('Blocked ' + (username || 'player'));
      serverFriendsCache = null; serverRequestsCache = null;
      if ($('#screen-friends') && $('#screen-friends').classList.contains('active')) renderFriendsList();
    }).catch(function(err){ toast((err && err.message) || 'Could not block.'); });
  }
  window.CT_blockPlayer = blockPlayer;

  // A friend request arrived in real time -> pop a window so the recipient can act
  // on it (instead of being silently added). Accept immediately, or leave it in the
  // Friends tab where it shows with explicit Accept / Reject buttons.
  function handleFriendRequestPush(d) {
    var from = d && d.from;
    if (!from) return;
    serverRequestsCache = null; // a new request arrived; refetch on next render
    var onFriends = $('#screen-friends') && $('#screen-friends').classList.contains('active');
    if (onFriends) renderFriendsList();
    var accept = confirm((from.username || 'A player') + ' wants to be your friend.\n\nOK = Accept now\nCancel = decide later (Accept / Reject in the Friends tab)');
    if (accept) respondToFriendRequest(from.id, true);
    else { if (!onFriends) toast((from.username || 'Someone') + ' sent you a friend request — see the Friends tab.'); renderFriendsSummary(); }
  }

  // "Find ranked opponent" — ranked online matchmaking vs a similar-ELO opponent.
  // (The former duplicate "Start a challenge" card was removed; it opened the same
  // picker and called the same matchmaking, so it added no distinct behavior.)
  $('#btn-find-match').addEventListener('click', () => {
    if (!rankedEnabled()) { toast('Ranked play is coming soon.'); return; }
    state.pendingChallenge = null;
    openTimeControlPicker({}, () => startOnlineOrFakeMatchmaking('ranked'));
  });

  // "Play a casual game" — unrated online matchmaking. Always available (NOT gated
  // by the seasonal ranked switch): a casual game never touches ELO, wins, or
  // streaks. The server forces mode='casual' to zero out any rating change.
  { const c = $('#btn-find-casual'); if (c) c.addEventListener('click', () => {
    state.pendingChallenge = null;
    openTimeControlPicker({ startLabel: 'Play a casual game' }, () => startOnlineOrFakeMatchmaking('casual'));
  }); }

  // Prefer real server matchmaking. The legacy localStorage matcher only ever sees
  // accounts created on THIS device, so it can never pair two real players across
  // devices -- using it for a logged-in user just produces a fake ~3s "search" that
  // finds nobody. So we only drop to it for guests (who have no server token), and
  // for registered users we (re)connect and wait for the socket instead of silently
  // degrading.
  // Render the time-control picker and resolve the user's choice via callback.
  // Used by both 1v1 and 2v2 entry points; persists the last choice.
  let _tcOnStart = null;
  function renderTcGrid() {
    const grid = $('#tc-grid');
    if (!grid) return;
    grid.innerHTML = TC_OPTIONS.map((o) =>
      '<div class="tc-opt' + (o.key === state.selectedTc ? ' selected' : '') + '" data-tc="' + o.key + '">' +
        '<span>' + o.label + '</span>' +
        '<span class="tc-sub">' + o.cat + '</span>' +
      '</div>'
    ).join('');
    $$('#tc-grid .tc-opt').forEach((el) => {
      el.addEventListener('click', () => {
        saveSelectedTc(el.dataset.tc);
        $$('#tc-grid .tc-opt').forEach((o) => o.classList.toggle('selected', o.dataset.tc === state.selectedTc));
      });
    });
  }
  function openTimeControlPicker(opts, onStart) {
    opts = opts || {};
    _tcOnStart = onStart;
    const titleEl = $('#tc-title'), subEl = $('#tc-subtitle');
    if (titleEl) titleEl.textContent = opts.title || 'Choose a time control';
    if (subEl) subEl.textContent = opts.subtitle || 'Both players must pick the same time control to be matched.';
    const startBtn = $('#btn-tc-start');
    if (startBtn) startBtn.textContent = opts.startLabel || 'Find match';
    renderTcGrid();
    openModal('timecontrol');
  }
  {
    const startBtn = $('#btn-tc-start');
    if (startBtn) startBtn.addEventListener('click', () => {
      closeModal('timecontrol');
      const cb = _tcOnStart; _tcOnStart = null;
      if (typeof cb === 'function') cb(state.selectedTc);
    });
    const cancelBtn = $('#btn-tc-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => { _tcOnStart = null; closeModal('timecontrol'); });
  }

  // Guests can't authenticate the game socket (no token), so they can't join the
  // real online queue. Instead of a jarring blocking confirm() that dead-ends,
  // drop them straight into a Practice vs Computer game NOW and nudge them with a
  // non-blocking toast to sign up for real opponents. No dialog, no dead-end.
  function guestPlayOfflineWithNudge(mode) {
    const lvl = guestPracticeElo(($('#practice-elo') && $('#practice-elo').value) || 1200);
    startPracticeGame(lvl);
    toast(mode === 'ranked'
      ? 'Playing offline vs computer — sign up to play ranked online.'
      : 'Playing offline vs computer — sign up to play real people.');
  }

  function startOnlineOrFakeMatchmaking(mode) {
    if (window.CTNet && window.CTNet.isReady()) {
      startOnlineMatchmaking(mode);
      return;
    }
    const isGuest = !!(state.user && state.user.isGuest);
    const sess = getSession();
    const haveToken = !!(sess && sess.token);

    if (isGuest) {
      // Guests have no server token, so they can't be placed in the real online
      // queue. Don't fake a search and don't pop a blocking confirm() — start an
      // offline game immediately with a non-blocking sign-up nudge.
      guestPlayOfflineWithNudge(mode);
      return;
    }
    if (!window.CTNet) {
      // No realtime client available at all (e.g. socket.io failed to load).
      toast('Online play is unavailable right now — try Practice vs Computer.');
      return;
    }
    if (!haveToken) {
      // Registered user but signed in via the offline fallback (server login failed),
      // so there is no token and the game socket can't authenticate. Surface it
      // instead of pretending to matchmake against a same-device pool.
      toast('You’re signed in offline — log out and back in to play ranked online.');
      return;
    }
    // Registered + token but the socket isn't ready yet (still connecting, or it
    // dropped). (Re)connect and wait briefly rather than falling back.
    if (window.__connectGameSocket) window.__connectGameSocket();
    waitForSocketThenMatchmake(mode);
  }

  // Show a "Connecting…" state and start server matchmaking as soon as the socket
  // authenticates, or error out clearly if it can't connect within a few seconds.
  function waitForSocketThenMatchmake(mode) {
    const titleEl = $('#mm-title'), statusEl = $('#mm-status'), timerEl = $('#mm-timer');
    if (titleEl) titleEl.textContent = 'Connecting to server…';
    if (statusEl) statusEl.textContent = 'Establishing a secure connection…';
    if (timerEl) timerEl.textContent = '0:00';
    openModal('matchmaking');
    state._waitingForServerMatch = false;
    const startedAt = Date.now();
    if (mmTimer) { clearInterval(mmTimer); mmTimer = null; }
    mmTimer = setInterval(() => {
      if (window.CTNet && window.CTNet.isReady()) {
        clearInterval(mmTimer); mmTimer = null;
        startOnlineMatchmaking(mode); // re-opens the modal in its searching state
        return;
      }
      if (Date.now() - startedAt > 8000) {
        clearInterval(mmTimer); mmTimer = null;
        closeModal('matchmaking');
        toast('Could not reach the game server. Check your connection and try again.');
      }
    }, 250);
  }
    // 2v2 lobby buttons
    // - btn-duo-online -> real ranked 2v2 via the server (3-min queue, real opponents)
    // - btn-duo-ranked -> kept as alias for older builds (treated as online)
    { const b = $('#btn-duo-online'); if (b) b.addEventListener('click', () => { if (!rankedEnabled()) { toast('Ranked 2v2 is coming soon.'); return; } openTimeControlPicker({ title: 'Choose a 2v2 time control', startLabel: 'Find ranked 2v2' }, () => startOnlineTeamMatchmaking()); }); }
    { const b = $('#btn-duo-ranked'); if (b) b.addEventListener('click', () => { if (!rankedEnabled()) { toast('Ranked 2v2 is coming soon.'); return; } openTimeControlPicker({ title: 'Choose a 2v2 time control', startLabel: 'Find ranked 2v2' }, () => startOnlineTeamMatchmaking()); }); }
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
    // chess960: Fischer Random is re-enabled. The bundled chess.js 0.x still can't
    // castle from randomized back-ranks, so real 960 castling is implemented in
    // chess960.js (window.CT_960Castle) and wired into the human-move path
    // (tryMove / selectSquare). KNOWN LIMITATION: the computer opponent moves via
    // chess.js .moves(), so the engine itself won't castle in 960 — acceptable;
    // the human castling correctly is what un-breaks the mode.
    const start960Button = $('#btn-start-960');
    if (start960Button && practiceEloInput) {
      start960Button.addEventListener('click', () => startPractice960(practiceEloInput.value));
    }
  }

  // ---------------------------------------------------------------------------
  // CHECKERS lobby wiring (game-type selector + size/rule pickers + play cards)
  // ---------------------------------------------------------------------------
  // The checkers EXPERIENCE lives in ct-checkers.js (window.CT_Checkers_UI); this
  // block only handles the lobby selectors + routing the three play modes to it.
  const ckLobby = { gametype: 'chess', size: 8, rules: 'acf' };

  function applyGameType(which) {
    ckLobby.gametype = (which === 'checkers') ? 'checkers' : 'chess';
    const isCk = ckLobby.gametype === 'checkers';
    $$('#gametype-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.gametype === ckLobby.gametype));
    const ckOpts = $('#checkers-options'); if (ckOpts) ckOpts.style.display = isCk ? '' : 'none';
    const chessCards = $('#chess-play-cards'); if (chessCards) chessCards.style.display = isCk ? 'none' : '';
    const ckCards = $('#checkers-play-cards'); if (ckCards) ckCards.style.display = isCk ? '' : 'none';
    const chessStats = $('#stat-grid-chess'); if (chessStats) chessStats.style.display = isCk ? 'none' : '';
    const ckStats = $('#stat-grid-checkers'); if (ckStats) { ckStats.style.display = isCk ? '' : 'none'; if (isCk) renderCheckersLobbyStats(); }
    // Keep the ranked "Coming soon" state correct as cards toggle in/out.
    applyRankedGate();
  }
  // Reconcile the displayed rules with the chosen size (ACF=8 only, Intl=10 only).
  function syncCkRulesToSize() {
    // ACF requires 8x8; International requires 10x10. If they conflict, snap rules.
    if (ckLobby.size === 10 && ckLobby.rules === 'acf') ckLobby.rules = 'international';
    if (ckLobby.size === 8 && ckLobby.rules === 'international') ckLobby.rules = 'acf';
    $$('#ck-rules-grid .tc-opt').forEach((o) => o.classList.toggle('selected', o.dataset.ckrules === ckLobby.rules));
    $$('#ck-size-grid .tc-opt').forEach((o) => o.classList.toggle('selected', String(o.dataset.cksize) === String(ckLobby.size)));
  }
  $$('#gametype-tabs .tab').forEach((t) => t.addEventListener('click', () => applyGameType(t.dataset.gametype)));
  $$('#ck-size-grid .tc-opt').forEach((o) => o.addEventListener('click', () => {
    ckLobby.size = Number(o.dataset.cksize) === 10 ? 10 : 8;
    syncCkRulesToSize();
  }));
  $$('#ck-rules-grid .tc-opt').forEach((o) => o.addEventListener('click', () => {
    ckLobby.rules = o.dataset.ckrules;
    // Selecting International forces 10x10; ACF forces 8x8; Casual keeps the size.
    if (ckLobby.rules === 'international') ckLobby.size = 10;
    else if (ckLobby.rules === 'acf') ckLobby.size = 8;
    syncCkRulesToSize();
  }));
  { const b = $('#ck-btn-start-practice'); if (b) b.addEventListener('click', () => {
      const elo = $('#ck-practice-elo') ? $('#ck-practice-elo').value : 1200;
      if (window.CT_Checkers_UI) window.CT_Checkers_UI.startPractice(elo, ckLobby.size, ckLobby.rules);
    }); }
  { const el = $('#ck-practice-elo'); const lbl = $('#ck-practice-elo-label');
    if (el && lbl) { const upd = () => { lbl.textContent = clampElo(el.value); }; upd(); el.addEventListener('input', upd); } }
  { const b = $('#ck-btn-find-match'); if (b) b.addEventListener('click', () => {
      if (!rankedEnabled()) { toast('Ranked checkers is coming soon.'); return; }
      if (window.CT_Checkers_UI) window.CT_Checkers_UI.startFindRanked(ckLobby.size, ckLobby.rules);
    }); }
  // Casual checkers — unrated online matchmaking. Always available (not gated by
  // the seasonal ranked switch); never affects checkers ELO/wins/streaks.
  { const b = $('#ck-btn-find-casual'); if (b) b.addEventListener('click', () => {
      if (window.CT_Checkers_UI && window.CT_Checkers_UI.startFindCasual) window.CT_Checkers_UI.startFindCasual(ckLobby.size, ckLobby.rules);
    }); }
  // Friendly checkers challenge from the friend-challenge modal.
  { const b = $('#btn-fc-checkers'); if (b) b.addEventListener('click', () => {
      closeModal('friend-challenge');
      const fid = state.selectedFriendId, fname = state.selectedFriendName;
      if (fid && window.CT_Checkers_UI) window.CT_Checkers_UI.inviteFriend(fid, fname, ckLobby.size, ckLobby.rules);
    }); }

  // Lobby checkers stats (best ELO / wins / streak). Reads state.user.checkers.
  function renderCheckersLobbyStats() {
    const u = state.user; if (!u) return;
    const ck = u.checkers || { elo8: 1200, elo10: 1200, wins: 0, streak: 0 };
    const best = Math.max(ck.elo8 || 0, ck.elo10 || 0) || 1200;
    const e = $('#ck-stat-elo'); if (e) e.textContent = best;
    const w = $('#ck-stat-wins'); if (w) w.textContent = ck.wins || 0;
    const st = $('#ck-stat-streak'); if (st) st.textContent = ck.streak || 0;
  }
  // Expose so ct-checkers.js / renderLobby can refresh after a game or /api/me sync.
  window.CT_renderCheckersLobbyStats = renderCheckersLobbyStats;

  // Friends
  // Shared add-friend submit, used by BOTH the Friends-tab "+ Add friend" button
  // (reading the inline search box) and the modal's Add button. This is what fixes
  // the "type a name, click Add, then get asked for the name AGAIN" double-prompt:
  // the tab button now adds the typed name directly instead of opening the modal.
  function submitAddFriend(uname, opts) {
    opts = opts || {};
    var setErr = opts.setError || function () {};
    var u = (uname || '').trim();
    if (!u) { setErr('Enter a username.'); if (opts.focusEl) opts.focusEl.focus(); return; }
    if (isServerLoggedIn()) {
      if (opts.btn) opts.btn.disabled = true;
      serverAddFriend(u).then(function (friend) {
        hideFriendSuggestions();
        closeModal('add-friend');
        toast((friend && friend.requested ? 'Friend request sent to ' : 'Added ') + ((friend && friend.username) || u) + ' 🤝');
        if (opts.clearEl) opts.clearEl.value = '';
        serverFriendsCache = null; // force a fresh pull
        renderFriendsList();
      }).catch(function (err) {
        setErr((err && err.status === 404) ? 'No user with that username.'
          : ((err && err.message) || 'Could not add friend. Try again.'));
      }).then(function () { if (opts.btn) opts.btn.disabled = false; });
      return;
    }
    // No server session: friends are stored server-side, so we can't add one.
    // Be honest about why instead of searching this device's empty local list.
    setErr(friendsUnavailableMessage());
  }

  $('#btn-add-friend').addEventListener('click', () => {
    const si = $('#friend-search-input');
    const typed = si ? si.value : '';
    if (typed && typed.trim()) {
      // Name already in the search box — add it directly, no second prompt.
      submitAddFriend(typed, { btn: $('#btn-add-friend'), clearEl: si, focusEl: si, setError: (m) => toast(m) });
      return;
    }
    // Nothing typed yet — fall back to the modal as a manual entry point.
    $('#friend-username').value = '';
    $('#friend-error').textContent = '';
    hideFriendSuggestions();
    openModal('add-friend');
    setTimeout(() => $('#friend-username').focus(), 100);
  });
  $('#btn-friend-cancel').addEventListener('click', () => { hideFriendSuggestions(); closeModal('add-friend'); });

  // --- Add-friend autocomplete (server search, logged-in only) ---
  function hideFriendSuggestions() {
    var box = $('#friend-suggestions');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }
  function renderFriendSuggestions(users) {
    var box = $('#friend-suggestions');
    if (!box) return;
    if (!users || !users.length) { hideFriendSuggestions(); return; }
    box.innerHTML = users.map(function(u){
      return '<div class="friend-suggestion" data-uname="' + escapeHTML(u.username) + '">' +
        '<span style="font-weight:600;">' + escapeHTML(u.username) + '</span>' +
        '<span class="fs-elo">ELO ' + (u.elo || 1200) + '</span></div>';
    }).join('');
    box.style.display = '';
    $$('#friend-suggestions .friend-suggestion').forEach(function(row){
      row.addEventListener('click', function(){
        var input = $('#friend-username');
        if (input) input.value = row.dataset.uname;
        hideFriendSuggestions();
        if (input) input.focus();
      });
    });
  }
  var _friendSearchTimer = null;
  var _friendInputEl = $('#friend-username');
  if (_friendInputEl) {
    _friendInputEl.addEventListener('input', function(){
      var q = (_friendInputEl.value || '').trim();
      if (_friendSearchTimer) { clearTimeout(_friendSearchTimer); _friendSearchTimer = null; }
      // Guests have no token -> no server search, degrade quietly (no dropdown).
      if (!isServerLoggedIn() || q.length < 2) { hideFriendSuggestions(); return; }
      _friendSearchTimer = setTimeout(function(){
        serverSearchUsers(q).then(function(users){
          // Ignore stale results if the input changed while we waited.
          if ((_friendInputEl.value || '').trim() !== q) return;
          renderFriendSuggestions(users);
        }).catch(function(){ hideFriendSuggestions(); });
      }, 250);
    });
    _friendInputEl.addEventListener('blur', function(){ setTimeout(hideFriendSuggestions, 150); });
  }
  $('#btn-friend-add').addEventListener('click', () => {
    $('#friend-error').textContent = '';
    submitAddFriend($('#friend-username').value, {
      btn: $('#btn-friend-add'),
      setError: (m) => { $('#friend-error').textContent = m; },
    });
  });

  // Resolve a friend (local DB or server cache) and mark them as the selected
  // challenge target. Returns the friend record or null.
  function selectFriendById(friendId) {
    const db = loadDB();
    let friend = db.users[friendId];
    if (!friend && serverFriendsCache) {
      friend = serverFriendsCache.find(function(f){ return String(f.id) === String(friendId); }) || null;
    }
    if (!friend) return null;
    state.selectedFriendId = friendId;
    state.selectedFriendName = friend.username;
    return friend;
  }
  function openFriendChallenge(friendId) {
    const friend = selectFriendById(friendId);
    if (!friend) return;
    $('#fc-title').textContent = 'Challenge ' + friend.username;
    $('#fc-sub').textContent = 'ELO ' + friend.elo + ' · ' + (friend.region || 'no region');
    openModal('friend-challenge');
  }
  // Direct (one-tap) friend challenges from the friends list buttons.
  function startFriendChess(friendId) {
    const f = selectFriendById(friendId);
    if (!f) { toast('Couldn’t find that friend — refresh your friends list.'); return; }
    inviteFriendlyChallenge();
  }
  function startFriendCheckers(friendId) {
    const f = selectFriendById(friendId);
    if (!f) { toast('Couldn’t find that friend — refresh your friends list.'); return; }
    if (window.CT_Checkers_UI && window.CT_Checkers_UI.inviteFriend) {
      window.CT_Checkers_UI.inviteFriend(friendId, f.username, ckLobby.size, ckLobby.rules);
    } else {
      toast('Checkers is still loading — try again in a moment.');
    }
  }
  $('#btn-fc-friendly').addEventListener('click', () => {
    closeModal('friend-challenge');
    inviteFriendlyChallenge();
  });
  $('#btn-fc-ranked').addEventListener('click', () => {
    if (!rankedEnabled()) { toast('Ranked 2v2 is coming soon.'); return; }
    closeModal('friend-challenge');
    // Real online: send a duo invite via the server. The friend (if online and
    // authenticated against the same backend) receives a popup; on accept we
    // both enter the team queue together and the server pairs us with another
    // duo or 2 solo players.
    const friendId = state.selectedFriendId;
    if (friendId && window.CTNet && window.CTNet.isReady()) {
      try { window.CTNet.inviteDuo(friendId); toast('2v2 invite sent — waiting for them to accept…'); return; }
      catch (e) { console.error(e); }
    }
    // Ranked 2v2 requires a live server connection (real four-player match).
    toast('Server unavailable — ranked 2v2 needs a connection. Try again shortly.');
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
  $('#btn-fc-block').addEventListener('click', () => {
    closeModal('friend-challenge');
    blockPlayer(state.selectedFriendId, state.selectedFriendName);
  });
  $('#btn-fc-cancel').addEventListener('click', () => closeModal('friend-challenge'));

  // Send an ONLINE friendly (unrated) 1v1 challenge to the selected friend. The
  // friend (if online + authed against the same backend) gets a popup; on accept
  // the server emits the SAME `match_found` the matchmaker uses, which the existing
  // handleServerMatchFound starts automatically (we flag _waitingForServerMatch so
  // it accepts the incoming match).
  function inviteFriendlyChallenge() {
    const friendId = state.selectedFriendId;
    if (!friendId) return;
    if (!window.CTNet || !window.CTNet.isReady()) {
      toast('Server unavailable — a friendly challenge needs a connection. Try again shortly.');
      return;
    }
    const tc = state.selectedTc || TC_DEFAULT;
    try {
      window.CTNet.inviteChallenge(friendId, tc);
    } catch (e) {
      console.error('[Challenge] invite failed', e);
      toast('Could not send the challenge. Try again.');
      return;
    }
    state._pendingChallenge = { role: 'host', friendId: friendId, friendName: state.selectedFriendName };
    state._waitingForServerMatch = true; // so the match_found from acceptance is honored
    const body = $('#challenge-wait-body');
    if (body) body.textContent = 'Waiting for ' + (state.selectedFriendName || 'your friend') + ' to accept…';
    openModal('challenge-wait');
  }

  // Invite & Share — shares a referral link so friends can join the app. (The old
  // private-room/pass-and-play code path was removed; play is online-only now.)
  $('#btn-invite').addEventListener('click', () => {
    if (state.user) {
      state.user.invitesSent = state.user.invitesSent || [];
      // Keep populating invitesSent so the Recruiter trophy still tracks shares.
      state.user.invitesSent.push('share_' + Date.now().toString(36));
      const db = loadDB(); db.users[state.user.id] = state.user; saveDB(db);
    }
    // Show the canonical site share URL (with the referral param when logged in),
    // matching what the share buttons actually send.
    $('#invite-link').textContent = buildShareUrl();
    // Reveal the native Share button only where the Web Share API exists.
    const nativeBtn = $('#btn-share-native');
    if (nativeBtn) nativeBtn.style.display = (typeof navigator !== 'undefined' && navigator.share) ? '' : 'none';
    openModal('invite');
  });

  // Social share + tracking. Each button opens the correct share URL for the
  // canonical site (with the referral ?invitedBy param when logged in) AND calls
  // POST /api/share/track with the platform name. CSP-safe: delegated click, no
  // inline handlers; external share targets open via window.open (navigation, not
  // a frame, so frame-src 'none' is unaffected).
  const SHARE_MESSAGE = 'Play chess with me on ChessTrophies!';
  function openShareWindow(href) {
    try {
      const w = window.open(href, '_blank', 'noopener,noreferrer');
      if (!w) { /* popup blocked */ location.href = href; }
    } catch (e) { try { location.href = href; } catch (e2) {} }
  }
  async function copyShareLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied!');
    } catch (e) {
      toast('Link: ' + url);
    }
  }
  function shareUrlFor(platform, url, text) {
    const eu = encodeURIComponent(url);
    const et = encodeURIComponent(text);
    switch (platform) {
      case 'x':        return 'https://twitter.com/intent/tweet?text=' + et + '&url=' + eu;
      case 'facebook': return 'https://www.facebook.com/sharer/sharer.php?u=' + eu;
      case 'whatsapp': return 'https://api.whatsapp.com/send?text=' + encodeURIComponent(text + ' ' + url);
      case 'reddit':   return 'https://www.reddit.com/submit?url=' + eu + '&title=' + et;
      case 'telegram': return 'https://t.me/share/url?url=' + eu + '&text=' + et;
      default:         return url;
    }
  }
  async function handleShare(platform) {
    const url = buildShareUrl();
    const text = SHARE_MESSAGE;
    // Track first (fire-and-forget) so analytics fire regardless of what the
    // share target does.
    trackShare(platform);
    if (platform === 'copy') { await copyShareLink(url); return; }
    if (platform === 'native') {
      if (navigator.share) {
        try { await navigator.share({ title: 'ChessTrophies', text: text, url: url }); }
        catch (e) { /* user cancelled — no-op */ }
      } else {
        await copyShareLink(url);
      }
      return;
    }
    openShareWindow(shareUrlFor(platform, url, text));
  }
  { const grid = $('#share-grid');
    if (grid) grid.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-share]');
      if (!btn) return;
      handleShare(btn.getAttribute('data-share'));
    });
  }
  $('#btn-invite-cancel').addEventListener('click', () => { closeModal('invite'); });

  $$('[data-go]').forEach(el => {
    el.addEventListener('click', () => showScreen(el.dataset.go));
  });
  $$('#bottom-nav .nav-item').forEach(n => {
    n.addEventListener('click', () => showScreen(n.dataset.nav));
  });

  // ---------------------------------------------------------------------------
  // Matchmaking
  // ---------------------------------------------------------------------------
  let mmTimer = null, mmStart = 0;
function stopMatchmaking() {
  if (mmTimer) { clearInterval(mmTimer); mmTimer = null; }
}
// DEPRECATED / no longer reachable from any ranked entry point. This simulated a
// local "search" over the per-device account DB, which could never pair two real
// players across devices and dead-ended in the "Player 2 sign in" modal. Ranked
// online now goes through the server (startOnlineMatchmaking); guests are dropped
// into Practice vs Computer with a non-blocking sign-up nudge
// (guestPlayOfflineWithNudge). Kept only for reference -- do NOT re-wire into ranked.
function startMatchmaking(mode) {
  if (!state.user) return;
  stopMatchmaking();
  mmStart = Date.now();
  const titleEl = $('#mm-title'), statusEl = $('#mm-status'), timerEl = $('#mm-timer');
  if (titleEl) titleEl.textContent = 'Searching for an opponent…';
  if (statusEl) statusEl.textContent = 'Looking for the next available player near ' + state.user.elo + ' ELO…';
  if (timerEl) timerEl.textContent = '0:00';
  openModal('matchmaking');
  const bands = [50, 100, 200, 400];
  mmTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - mmStart) / 1000);
    if (timerEl) timerEl.textContent = '0:' + String(secs).padStart(2, '0');
    const band = bands[Math.min(secs, bands.length - 1)];
    if (statusEl) statusEl.textContent = 'Searching players within ±' + band + ' ELO of you…';
  }, 1000);
  // Resolve after a short, realistic search; the ELO-band pool is then picked in findMatch().
  const wait = 1600 + Math.floor(Math.random() * 1800);
  setTimeout(() => {
    if (mmTimer === null) return; // search was cancelled
    findMatch();
  }, wait);
}

function findMatch() {
  stopMatchmaking();
  closeModal('matchmaking');
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
$('#btn-mm-cancel').addEventListener('click', () => {
  stopMatchmaking();
  if (mmGiveUpTimer) { clearTimeout(mmGiveUpTimer); mmGiveUpTimer = null; }
  if (window.CTNet && window.CTNet.isReady()) window.CTNet.leaveQueue();
  state._waitingForServerMatch = false;
  closeModal('matchmaking');
});

  // ---------------------------------------------------------------------------
  // Online matchmaking + live game session (server-authoritative)
  // ---------------------------------------------------------------------------
  // Bounded, generous online search window shared by 1v1 and 2v2 (tune here).
  const MATCH_SEARCH_MS = 120000; // 120s — within the requested 90-120s range
  let mmGiveUpTimer = null;
  function startOnlineMatchmaking(mode) {
    if (!window.CTNet || !window.CTNet.isReady()) {
      // Socket dropped between the readiness check and here. Don't fake a local
      // search against an empty pool -- tell the user the truth.
      toast('Lost connection to the game server. Check your connection and try again.');
      closeModal('matchmaking');
      return;
    }
    if (mmTimer) { clearInterval(mmTimer); mmTimer = null; }
    if (mmGiveUpTimer) { clearTimeout(mmGiveUpTimer); mmGiveUpTimer = null; }
    mmStart = Date.now();
    const tc = state.selectedTc || TC_DEFAULT;
    const titleEl = $('#mm-title'), statusEl = $('#mm-status'), timerEl = $('#mm-timer');
    if (titleEl) titleEl.textContent = 'Searching for a ' + tcDisplay(tc) + ' game…';
    if (statusEl) statusEl.textContent = 'Looking on the server for a player near ' + state.user.elo + ' ELO…';
    if (timerEl) timerEl.textContent = '0:00';
    openModal('matchmaking');
    state._waitingForServerMatch = true;
    mmTimer = setInterval(() => {
      const secs = Math.floor((Date.now() - mmStart) / 1000);
      const mm = Math.floor(secs / 60), ss = secs % 60;
      if (timerEl) timerEl.textContent = mm + ':' + String(ss).padStart(2, '0');
    }, 1000);
    // Bounded search: give up after MATCH_SEARCH_MS rather than counting up forever.
    mmGiveUpTimer = setTimeout(() => {
      mmGiveUpTimer = null;
      if (!state._waitingForServerMatch) return;
      state._waitingForServerMatch = false;
      if (mmTimer) { clearInterval(mmTimer); mmTimer = null; }
      if (window.CTNet && window.CTNet.isReady()) window.CTNet.leaveQueue();
      closeModal('matchmaking');
      toast('No opponent found right now — try again.');
    }, MATCH_SEARCH_MS);
    window.CTNet.joinQueue(mode, tc);
  }

  // ---------------------------------------------------------------------------
  // Online 1v1 connection / opponent status banners + rematch UX.
  // ---------------------------------------------------------------------------
  // Rematch state for the most-recently-finished online 1v1 game. We capture the
  // gameId here because state.gameId is cleared by handleServerGameOver.
  const rematchState = {
    gameId: null,        // gameId of the game the result modal refers to
    eligible: false,     // true only for online 1v1 (not vs AI, not 2v2)
    phase: 'idle',       // 'idle' | 'offered' (we offered) | 'incoming' (they offered)
  };
  let oppCountdownTimer = null;

  function netBanner(msg) {
    const el = document.getElementById('net-banner');
    if (!el) return;
    if (msg == null) { el.style.display = 'none'; return; }
    el.textContent = msg;
    el.style.display = '';
  }

  function clearOppCountdown() {
    if (oppCountdownTimer) { clearInterval(oppCountdownTimer); oppCountdownTimer = null; }
  }

  function oppBanner(msg) {
    const el = document.getElementById('opp-banner');
    if (!el) return;
    if (msg == null) { clearOppCountdown(); el.style.display = 'none'; return; }
    el.textContent = msg;
    el.style.display = '';
  }

  // Clear all online-status UI + timers. Called on game end, leaving, new game.
  function clearNetUI() {
    netBanner(null);
    oppBanner(null);
    clearOppCountdown();
  }

  // --- Rematch result-modal UI ---
  function resetRematchUI() {
    rematchState.phase = 'idle';
    const ui = document.getElementById('rematch-ui');
    if (ui) ui.style.display = rematchState.eligible ? '' : 'none';
    const offer = document.getElementById('btn-rematch-offer');
    const waiting = document.getElementById('rematch-waiting');
    const incoming = document.getElementById('rematch-incoming');
    if (offer) offer.style.display = '';
    if (waiting) waiting.style.display = 'none';
    if (incoming) incoming.style.display = 'none';
  }

  function showRematchPhase(phase) {
    rematchState.phase = phase;
    const offer = document.getElementById('btn-rematch-offer');
    const waiting = document.getElementById('rematch-waiting');
    const incoming = document.getElementById('rematch-incoming');
    if (offer) offer.style.display = phase === 'idle' ? '' : 'none';
    if (waiting) waiting.style.display = phase === 'offered' ? '' : 'none';
    if (incoming) incoming.style.display = phase === 'incoming' ? '' : 'none';
  }

  // Wire rematch buttons once.
  (function wireRematchButtons() {
    const offer = document.getElementById('btn-rematch-offer');
    const cancel = document.getElementById('btn-rematch-cancel');
    const accept = document.getElementById('btn-rematch-accept');
    const decline = document.getElementById('btn-rematch-decline');
    if (offer) offer.addEventListener('click', () => {
      if (!rematchState.gameId || !window.CTNet || !window.CTNet.isReady()) {
        toast('Not connected — cannot rematch.');
        return;
      }
      window.CTNet.offerRematch(rematchState.gameId);
      showRematchPhase('offered');
    });
    if (cancel) cancel.addEventListener('click', () => {
      // Locally revert; server treats no-accept as expiry. Send a decline of our
      // own offer is not in the contract, so we just stop waiting on this client.
      if (rematchState.gameId && window.CTNet && window.CTNet.isReady()) {
        window.CTNet.declineRematch(rematchState.gameId);
      }
      showRematchPhase('idle');
    });
    if (accept) accept.addEventListener('click', () => {
      if (!rematchState.gameId || !window.CTNet || !window.CTNet.isReady()) {
        toast('Not connected — cannot rematch.');
        return;
      }
      window.CTNet.acceptRematch(rematchState.gameId);
      showRematchPhase('offered'); // waiting for match_found to arrive
    });
    if (decline) decline.addEventListener('click', () => {
      if (rematchState.gameId && window.CTNet && window.CTNet.isReady()) {
        window.CTNet.declineRematch(rematchState.gameId);
      }
      showRematchPhase('idle');
    });
  })();

  function handleRematchOffered(data) {
    if (!data || !rematchState.gameId || data.gameId !== rematchState.gameId) return;
    // Only meaningful while the result modal is up.
    if (!document.getElementById('modal-result').classList.contains('show')) return;
    showRematchPhase('incoming');
  }

  function handleRematchEnded(data, msg) {
    if (data && rematchState.gameId && data.gameId !== rematchState.gameId) return;
    showRematchPhase('idle');
    toast(msg);
  }

  function handleServerMatchFound(data) {
    // Arena games arrive UNSOLICITED (continuous auto-pairing + re-pool). Accept
    // them only when we're an active arena participant, and flag the game so
    // gameOver routes back to the arena screen instead of the 1v1 result flow.
    const isArenaMatch = !!(data && data.mode === 'arena');
    if (isArenaMatch) {
      if (!(window.CT_Arena && window.CT_Arena.isActive())) return;
      state._waitingForServerMatch = true; // let the standard flow below run
      state._arenaGame = true;
    } else {
      state._arenaGame = false;
    }
    // Accept this match if we're queueing OR if a rematch is in flight (the
    // server starts a fresh 1v1 game and both sides get a normal match_found).
    const fromRematch = rematchState.phase === 'offered' || rematchState.phase === 'incoming';
    if (!state._waitingForServerMatch && !fromRematch) return;
    state._waitingForServerMatch = false;
    if (mmTimer) { clearInterval(mmTimer); mmTimer = null; }
    if (mmGiveUpTimer) { clearTimeout(mmGiveUpTimer); mmGiveUpTimer = null; }
    closeModal('matchmaking');
    // Friendly-challenge handshake (if any) resolved into a real match.
    closeModal('challenge-wait');
    closeModal('challenge-invite');
    state._pendingChallenge = null;
    // A new game is starting — tear down the result modal + rematch/status UI.
    closeModal('result');
    clearNetUI();
    rematchState.phase = 'idle';
    rematchState.gameId = null;
    const me = state.user;
    if (!me || !data || !data.gameId) return;
    const iAmWhite = data.white && data.white.id === me.id;
    const oppData = iAmWhite ? data.black : data.white;
    state.opponent = {
      username: (oppData && oppData.username) || 'Opponent',
      elo: (oppData && oppData.elo) || 1200,
      isAI: false,
      userId: (oppData && oppData.id) || null,
      avatarStock: (oppData && oppData.avatarStock) || 'av_knight',
      avatarDataUrl: (oppData && oppData.avatarDataUrl) || '',
    };
    state.isOnline = true;
    state.gameId = data.gameId;
    state.awaitingServerGameOver = true;
    rematchState.eligible = true; // online 1v1 match -> rematch allowed
    state._forceColor = iAmWhite ? 'w' : 'b';
    toast('Matched with ' + state.opponent.username + ' (ELO ' + state.opponent.elo + ')', true);
    state.tc = data.tc || null;
    startGame(data.mode === 'ranked' ? 'ranked' : 'unranked');
    state._forceColor = null;
    // Clocked game: initialize both clocks (unlimited games omit `clock`).
    clockStop();
    if (data.clock) {
      const m = clock1v1Map();
      clockSync(data.clock, m.topEl, m.botEl, m.topSide, m.botSide);
    }
    if (state._arenaGame) {
      rematchState.eligible = false; // arenas have no rematch — you re-pair instead
      if (window.CT_Arena) window.CT_Arena.onMatchStarted();
    }
  }

  function handleServerMoveMade(data) {
    if (!data) return;
    // 2v2 routing: if Duo is in an online game with this gameId, hand off.
    if (window.Duo && window.__duo && window.__duo.online && window.__duo.gameId === data.gameId) {
      window.Duo.applyServerMove(data);
      return;
    }
    if (!state.isOnline || !state.game) return;
    if (data.gameId !== state.gameId) return;
    const mv = data.move; if (!mv) return;
    // Re-sync clocks from the server on every move_made (ours and theirs).
    if (data.clock && clockState.active) {
      const m = clock1v1Map();
      clockSync(data.clock, m.topEl, m.botEl, m.topSide, m.botSide);
    }
    // Only apply opponent's move; our own move was already applied locally.
    if (mv.color === state.userColor) return;
    state.applyingRemoteMove = true;
    const applied = state.game.move({ from: mv.from, to: mv.to, promotion: mv.promotion || 'q' });
    if (applied) {
      afterMove(applied);
    }
    state.applyingRemoteMove = false;
  }

  function handleServerIllegalMove(data) {
    // Server rejected one of our moves -- rare unless local/server desync. Reload to recover.
    toast('Move rejected by server. Reloading game state…');
    // For v1, surface the issue rather than try to silently roll back.
    console.warn('[CTNet] illegal_move', data);
  }

  function handleServerGameOver(data) {
    if (!data) return;
    // 2v2 routing: if Duo is in an online game with this gameId, hand off.
    if (data.team === true && window.Duo && window.__duo && window.__duo.online && window.__duo.gameId === data.gameId) {
      window.Duo.handleServerGameOver(data);
      return;
    }
    if (!state.isOnline || data.gameId !== state.gameId) return;
    // ARENA: the server already scored this game into the leaderboard (no global
    // ELO/stats) and re-pooled us. Skip the 1v1 result/rematch flow entirely —
    // show a light result + return to the arena screen; the next match_found
    // (re-pool) pulls us back in. CT_Arena handles the toast + refresh.
    if (state._arenaGame) {
      state._arenaGame = false;
      state.awaitingServerGameOver = false;
      clockStop();
      state.isOnline = false;
      state.gameId = null;
      if (window.CT_Arena) window.CT_Arena.onGameEnded(data);
      showScreen('arena');
      return;
    }
    state.awaitingServerGameOver = false;
    clockStop();
    // Opponent grace expiry sends a normal game_over (reason 'disconnect') — make
    // sure the disconnected banner clears now.
    oppBanner(null);
    // Capture the finished game's id so the rematch button can reference it after
    // state.gameId is cleared below. eligible was set when this 1v1 match started.
    rematchState.gameId = state.gameId;
    const me = state.user;
    let winnerColor = null;
    if (data.winnerId) {
      winnerColor = (data.winnerId === me.id) ? state.userColor : (state.userColor === 'w' ? 'b' : 'w');
    }
    const reason = data.reason || 'unknown';
    // Server-initiated end (e.g. opponent resigned) might mean local board isn't naturally
    // game-over; still treat it as ended so the result screen shows.
    if (!state.game.game_over() && winnerColor !== null) state.gameEnded = true;
    finishGame(winnerColor, reason);
    // Refresh local profile from the server so ELO/stats match what was just persisted.
    if (window.fetch) {
      fetchMe().then((profile) => syncRemoteProfile(profile)).catch(() => {});
    }
    state.isOnline = false;
    state.gameId = null;
  }

  // Full resync of our active online 1v1 game from a server game_state payload.
  // Sent after we reconnect (auth_ok -> game_state) so we pick up any move the
  // opponent made while we were gone, and our clocks re-align.
  function handleServerGameState(data) {
    if (!data || !data.gameId || !data.fen) return;
    // 2v2 has its own resume path; ignore team game_state here.
    if (window.Duo && window.__duo && window.__duo.online && window.__duo.gameId === data.gameId) return;
    // Adopt this as our active game (covers the case where state.gameId was
    // cleared while the socket was down).
    state.isOnline = true;
    state.gameId = data.gameId;
    state.awaitingServerGameOver = true;
    rematchState.eligible = true;
    const me = state.user;
    // yourColor is authoritative; fall back to existing userColor.
    state.userColor = data.yourColor || state.userColor;
    state.orientation = state.userColor;
    // Opponent identity (white/black are public user objects).
    if (me && (data.white || data.black)) {
      const iAmWhite = state.userColor === 'w';
      const oppData = iAmWhite ? data.black : data.white;
      if (oppData) {
        state.opponent = {
          username: oppData.username || (state.opponent && state.opponent.username) || 'Opponent',
          elo: oppData.elo || (state.opponent && state.opponent.elo) || 1200,
          isAI: false,
          userId: oppData.id || (state.opponent && state.opponent.userId) || null,
        };
      }
    }
    // Rebuild the board from the authoritative FEN.
    try { state.game = new Chess(data.fen); }
    catch (e) { console.warn('[CTNet] bad game_state fen', e); return; }
    state.gameEnded = false;
    state.selected = null;
    state.legalTargets = [];
    state.lastMove = null;
    state.applyingRemoteMove = false;
    if (data.mode) state.gameMode = data.mode === 'ranked' ? 'ranked' : 'unranked';
    // Make sure we're on the game screen, then re-render for our color.
    if (!document.querySelector('#screen-game.active')) showScreen('game');
    setupGameScreen();
    renderBoard();
    updateStatus();
    // Resync clocks (null clock => unlimited game, clockSync stops the clock).
    if (data.clock) {
      const m = clock1v1Map();
      clockSync(data.clock, m.topEl, m.botEl, m.topSide, m.botSide);
    } else {
      clockStop();
    }
    // Resync succeeded — we're back; clear the reconnecting banner.
    netBanner(null);
  }

  // Our own socket dropped (onDisconnect). socket.io is configured to retry.
  function handleSelfDisconnect(reason) {
    clockStop();
    if (state.isOnline && state.gameId) {
      netBanner('Reconnecting…');
    }
  }

  // socket.io exhausted its reconnection attempts — surface a clear failure.
  function handleReconnectFailed() {
    if (state.isOnline && state.gameId) {
      netBanner('Connection lost. Please check your network.');
    }
  }

  // Opponent dropped: show a live countdown banner for the grace window.
  function handleOpponentDisconnected(data) {
    if (!data || data.gameId !== state.gameId) return;
    clearOppCountdown();
    let remaining = Math.max(0, Math.ceil((data.graceMs || 0) / 1000));
    const paint = () => {
      if (remaining <= 0) { clearOppCountdown(); return; }
      oppBanner('Opponent disconnected — ' + remaining + 's to reconnect');
      remaining -= 1;
    };
    paint();
    oppCountdownTimer = setInterval(paint, 1000);
  }

  function handleOpponentReconnected(data) {
    if (data && data.gameId !== state.gameId) return;
    oppBanner(null);
    toast('Opponent reconnected.');
  }

  function connectGameSocketIfPossible() {
    const sess = getSession();
    if (!sess || !sess.token || !window.CTNet) return;
    window.CTNet.connect(SERVER_URL, sess.token, {
      onAuthOk: () => { /* ready to matchmake; server sends game_state to resume */ },
      onAuthErr: (e) => {
        console.warn('[CTNet] auth_err', e);
        // The game socket rejected our token — same root cause as a REST 401.
        // Route through the centralized handler (idempotent) so the user isn't
        // stranded with a silently-dead socket. Guests/offline have no token, so
        // this never fires for them.
        const sess = getSession();
        if (sess && sess.token) handleAuthExpired('Your session expired — please sign in again.');
      },
      onDisconnect: handleSelfDisconnect,
      onReconnectFailed: handleReconnectFailed,
    });
    // Register once; CTNet keeps an internal list, but we want at most one of each.
    if (!state._netHandlersRegistered) {
      window.CTNet.on('matchFound', handleServerMatchFound);
      window.CTNet.on('moveMade', handleServerMoveMade);
      window.CTNet.on('illegalMove', handleServerIllegalMove);
      window.CTNet.on('gameOver', handleServerGameOver);
      window.CTNet.on('rateLimited', (d) => toast('Slow down (' + (d && d.event) + ')'));
      // Arena tournaments: forward join/leave acks + errors to CT_Arena.
      window.CTNet.on('arenaJoined', (d) => {
        try { window.CT_Analytics && window.CT_Analytics.track('arena_join'); } catch (e) {}
        return window.CT_Arena && window.CT_Arena.onJoined(d);
      });
      window.CTNet.on('arenaErr', (d) => window.CT_Arena && window.CT_Arena.onErr(d));
      window.CTNet.on('arenaLeft', (d) => window.CT_Arena && window.CT_Arena.onLeft(d));
      window.CTNet.on('arenaChampion', (d) => {
        if (window.CT_Arena) window.CT_Arena.onChampion(d);
        try { ctCelebrate('big'); } catch (e) {}
        // arena_wins bumped server-side — pull the fresh profile.
        if (window.fetch) fetchMe().then((p) => syncRemoteProfile(p)).catch(() => {});
      });
      // Rematch (1v1) lifecycle
      window.CTNet.on('rematchOffered', handleRematchOffered);
      window.CTNet.on('rematchDeclined', (d) => handleRematchEnded(d, 'Rematch declined.'));
      window.CTNet.on('rematchExpired', (d) => handleRematchEnded(d, 'Rematch offer expired.'));
      // Disconnect grace + reconnect/resume (1v1)
      window.CTNet.on('opponentDisconnected', handleOpponentDisconnected);
      window.CTNet.on('opponentReconnected', handleOpponentReconnected);
      window.CTNet.on('gameState', handleServerGameState);
      // 2v2 events
      window.CTNet.on('teamMatchFound', handleTeamMatchFound);
      window.CTNet.on('teamQueued', handleTeamQueued);
      window.CTNet.on('teamLeft', (d) => { stopTeamQueueTimer(); closeModal('team-queue'); toast('Your teammate left the queue.'); });
      window.CTNet.on('teamErr', (d) => { stopTeamQueueTimer(); closeModal('team-queue'); toast('Queue error: ' + (d && d.error || 'unknown')); });
      // Duo invites
      window.CTNet.on('duoInviteReceived', handleDuoInviteReceived);
      window.CTNet.on('duoAccepted', handleDuoAccepted);
      window.CTNet.on('duoReady', handleDuoReady);
      window.CTNet.on('duoDeclined', (d) => { toast('Your 2v2 invite was declined.'); state._pendingDuoInvite = null; });
      window.CTNet.on('duoCancelled', (d) => { toast('2v2 invite cancelled.'); state._pendingDuoInvite = null; closeModal('duo-invite'); });
      window.CTNet.on('duoInviteExpired', (d) => { toast('2v2 invite expired.'); state._pendingDuoInvite = null; closeModal('duo-invite'); });
      window.CTNet.on('duoErr', (d) => toast('2v2 error: ' + (d && d.error || 'unknown')));

      // Friendly 1v1 challenge lifecycle
      window.CTNet.on('challengeReceived', handleChallengeReceived);
      window.CTNet.on('challengeDeclined', (d) => {
        toast('Your friendly challenge was declined.');
        state._pendingChallenge = null;
        state._waitingForServerMatch = false;
        closeModal('challenge-wait');
      });
      window.CTNet.on('challengeCancelled', (d) => {
        toast('Friendly challenge cancelled.');
        state._pendingChallenge = null;
        state._waitingForServerMatch = false;
        closeModal('challenge-invite');
        closeModal('challenge-wait');
      });

      // Real-time friend requests: pop a window asking the recipient to accept/reject.
      window.CTNet.on('friendRequest', handleFriendRequestPush);
      window.CTNet.on('friendAccepted', (d) => {
        toast(((d && d.username) ? d.username : 'Someone') + ' accepted your friend request 🤝');
        serverFriendsCache = null;
        if ($('#screen-friends') && $('#screen-friends').classList.contains('active')) renderFriendsList();
      });
      // VICTIM WALL / revenge loop: the server tells a freshly-beaten player they
      // landed on the winner's streak. Show a tasteful "get revenge?" banner.
      window.CTNet.on('defeated', handleDefeated);
      // Checkers online listeners (ct-checkers.js registers its own camelCased
      // CTNet handlers). wireNet() is idempotent; calling it here ensures the
      // handlers exist on the freshly-connected socket alongside the chess ones.
      try { if (window.CT_Checkers_UI) window.CT_Checkers_UI.wireNet(); } catch (e) {}
      state._netHandlersRegistered = true;
    }
    // Pull any learning progress saved on the server (other devices) and merge it in.
    loadServerProgress();
  }
  // Expose for the login/signup flows.
  window.__connectGameSocket = connectGameSocketIfPossible;

  // ---------------------------------------------------------------------------
  // Learning-progress sync (lessons completed + puzzle progress) across devices.
  // Local-first: everything still works offline / for guests; when the user has a
  // server session we mirror progress to GET/POST /api/progress so switching
  // between web and the Android app keeps the "zero to Grandmaster" journey.
  // academy.js and puzzles.js call window.CT_syncProgress() after saving locally.
  // ---------------------------------------------------------------------------
  const PUZZLE_PROGRESS_KEY = 'ct_puzzle_progress_v1';

  function readPuzzleProgress() {
    try { return JSON.parse(localStorage.getItem(PUZZLE_PROGRESS_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function gatherLocalProgress() {
    const puzzles = readPuzzleProgress();
    // Ride the daily PLAY STREAK on the existing /api/progress sync. The server
    // (server.js POST /api/progress) only persists `lessonsCompleted` and the
    // `puzzles` object — within `puzzles`, unknown keys survive (last-write
    // wins). So we tuck the play-streak state under puzzles.playStreak to follow
    // the user across web/Android. applyServerProgress merges the maxes back so a
    // stale device never erases a higher streak.
    if (state.user && state.user.playStreak) puzzles.playStreak = state.user.playStreak;
    return {
      lessonsCompleted: (state.user && state.user.lessonsCompleted) || [],
      puzzles,
    };
  }

  // Merge the server's stored progress into local state (union lessons, merge puzzles).
  function applyServerProgress(p) {
    if (!p) return;
    if (state.user && Array.isArray(p.lessonsCompleted) && p.lessonsCompleted.length) {
      const seen = Object.create(null);
      (state.user.lessonsCompleted || []).forEach((id) => { seen[id] = 1; });
      p.lessonsCompleted.forEach((id) => { seen[id] = 1; });
      state.user.lessonsCompleted = Object.keys(seen);
      const db = loadDB();
      if (db.users[state.user.id]) { db.users[state.user.id] = state.user; saveDB(db); }
    }
    if (p.puzzles && typeof p.puzzles === 'object') {
      const local = readPuzzleProgress();
      const merged = Object.assign({}, local, p.puzzles);
      merged.byId = Object.assign({}, local.byId || {}, p.puzzles.byId || {});
      // Keep the most generous of the counters so a sync never erases progress.
      merged.solved = Math.max(local.solved || 0, p.puzzles.solved || 0);
      merged.best = Math.max(local.best || 0, p.puzzles.best || 0);
      try { localStorage.setItem(PUZZLE_PROGRESS_KEY, JSON.stringify(merged)); } catch (e) {}
      // Daily PLAY STREAK rides in puzzles.playStreak. Merge so the most-recent
      // play date wins and best never regresses (avoids a stale device clobber).
      const remoteStreak = p.puzzles.playStreak;
      if (state.user && remoteStreak && typeof remoteStreak === 'object') {
        const localStreak = state.user.playStreak || { streak: 0, best: 0, lastDate: null };
        const lDate = localStreak.lastDate || '';
        const rDate = remoteStreak.lastDate || '';
        // Newer lastDate carries the authoritative current streak; best is the max.
        const winner = rDate > lDate ? remoteStreak : localStreak;
        state.user.playStreak = {
          streak: winner.streak || 0,
          best: Math.max(localStreak.best || 0, remoteStreak.best || 0, winner.streak || 0),
          lastDate: winner.lastDate || null,
        };
        // Mirror the current streak into the flag the trophy check reads.
        state.user.flags = state.user.flags || {};
        state.user.flags.dailyPlayStreak = state.user.playStreak.streak;
        const db = loadDB();
        if (db.users[state.user.id]) { db.users[state.user.id] = state.user; saveDB(db); }
        checkAchievementsFor(state.user);
        renderPlayStreak();
      }
    }
    // Refresh any visible rank/academy UI now that counts may have grown.
    try { if (window.CT_renderAcademy && document.getElementById('screen-academy').classList.contains('active')) window.CT_renderAcademy(); } catch (e) {}
  }

  function loadServerProgress() {
    const sess = getSession();
    if (!sess || !sess.token) return; // guests / offline stay purely local
    api('/api/progress').then(applyServerProgress).catch(() => {});
  }

  // Debounced push of local progress to the server (called after a lesson/puzzle solve).
  let _progressSyncTimer = null;
  window.CT_syncProgress = function () {
    const sess = getSession();
    if (!sess || !sess.token) return; // local-only for guests / offline
    if (_progressSyncTimer) clearTimeout(_progressSyncTimer);
    _progressSyncTimer = setTimeout(() => {
      api('/api/progress', { method: 'POST', body: JSON.stringify(gatherLocalProgress()) })
        .then(applyServerProgress)
        .catch(() => {}); // best-effort; local copy remains the source of truth offline
    }, 400);
  };

  // ---------------------------------------------------------------------------
  // 2v2 online matchmaking (bounded queue with graceful timeout)
  // ---------------------------------------------------------------------------
  let tqTimer = null, tqStart = 0;
  const TEAM_QUEUE_TIMEOUT_MS = MATCH_SEARCH_MS; // 120s search window (was 3 minutes)

  function stopTeamQueueTimer() {
    if (tqTimer) { clearInterval(tqTimer); tqTimer = null; }
  }

  function startOnlineTeamMatchmaking() {
    if (!state.user) return;
    if (!window.CTNet || !window.CTNet.isReady()) {
      toast('Not connected to server. Try again in a moment.');
      return;
    }
    if (state._pendingDuoInvite && state._pendingDuoInvite.role === 'host') {
      // Solo flow ignored — already mid-duo. Should not happen via this entry.
      return;
    }
    stopTeamQueueTimer();
    tqStart = Date.now();
    const titleEl = $('#tq-title'), statusEl = $('#tq-status'), timerEl = $('#tq-timer'), partnerEl = $('#tq-partner');
    if (titleEl) titleEl.textContent = 'Searching for a ' + tcDisplay(state.selectedTc || TC_DEFAULT) + ' 2v2 match…';
    {
      const totalS = Math.round(TEAM_QUEUE_TIMEOUT_MS / 1000);
      const tm = Math.floor(totalS / 60), ts = totalS % 60;
      if (statusEl) statusEl.textContent = 'Need 4 players for a match. Waiting up to ' + tm + ' min ' + ts + ' sec.';
      if (timerEl) timerEl.textContent = tm + ':' + String(ts).padStart(2, '0');
    }
    if (partnerEl) partnerEl.textContent = '';
    openModal('team-queue');
    state._inTeamQueue = true;
    tqTimer = setInterval(() => {
      const elapsed = Date.now() - tqStart;
      const remaining = Math.max(0, TEAM_QUEUE_TIMEOUT_MS - elapsed);
      if (timerEl) {
        const s = Math.ceil(remaining / 1000);
        const mm = Math.floor(s / 60), ss = s % 60;
        timerEl.textContent = mm + ':' + String(ss).padStart(2, '0');
      }
      if (remaining <= 0) {
        stopTeamQueueTimer();
        if (state._inTeamQueue) {
          state._inTeamQueue = false;
          if (window.CTNet && window.CTNet.isReady()) window.CTNet.leaveTeamQueue();
          closeModal('team-queue');
          toast('No players available for ranked 2v2 right now. Try again soon.');
        }
      }
    }, 250);
    window.CTNet.joinTeamQueue(null, state.selectedTc || TC_DEFAULT);
  }

  function handleTeamQueued(data) {
    const partnerEl = $('#tq-partner');
    if (!partnerEl) return;
    if (data && data.type === 'duo') {
      partnerEl.textContent = data.size === 2 ? 'Queued as a duo — finding 2 opponents.' : 'Waiting for your partner to join the queue…';
    } else {
      partnerEl.textContent = '';
    }
  }

  function handleTeamMatchFound(data) {
    if (!data || !data.gameId) return;
    stopTeamQueueTimer();
    state._inTeamQueue = false;
    closeModal('team-queue');
    toast('Matched! 2v2 starting…', true);
    if (window.Duo && typeof window.Duo.startOnline === 'function') {
      window.Duo.startOnline(data);
    } else {
      console.error('Duo.startOnline missing');
    }
  }

  function handleDuoInviteReceived(data) {
    if (!data || !data.inviteId || !data.from) return;
    state._pendingDuoInvite = { role: 'guest', inviteId: data.inviteId, from: data.from };
    const body = $('#duo-invite-body');
    if (body) body.textContent = `${data.from.username} (ELO ${data.from.elo}) invited you to team up for ranked 2v2.`;
    openModal('duo-invite');
  }

  function handleDuoAccepted(data) {
    // Host side: partner accepted. Host now joins the queue (which creates the duo entry).
    if (!data || !data.inviteId) return;
    state._pendingDuoInvite = { role: 'host', inviteId: data.inviteId, partner: data.partner };
    if (window.CTNet && window.CTNet.isReady()) {
      // Open queue modal and join with the inviteId.
      stopTeamQueueTimer();
      tqStart = Date.now();
      const partnerEl = $('#tq-partner');
      if (partnerEl) partnerEl.textContent = `Teamed up with ${data.partner.username}.`;
      const timerEl = $('#tq-timer'); if (timerEl) timerEl.textContent = '3:00';
      openModal('team-queue');
      state._inTeamQueue = true;
      tqTimer = setInterval(() => {
        const elapsed = Date.now() - tqStart;
        const remaining = Math.max(0, TEAM_QUEUE_TIMEOUT_MS - elapsed);
        const s = Math.ceil(remaining / 1000);
        const mm = Math.floor(s / 60), ss = s % 60;
        if (timerEl) timerEl.textContent = mm + ':' + String(ss).padStart(2, '0');
        if (remaining <= 0) {
          stopTeamQueueTimer();
          if (state._inTeamQueue) {
            state._inTeamQueue = false;
            window.CTNet.leaveTeamQueue();
            closeModal('team-queue');
            toast('No opponents found in 3 minutes. Try again soon.');
          }
        }
      }, 250);
      window.CTNet.joinTeamQueue(data.inviteId, state.selectedTc || TC_DEFAULT);
    }
  }

  function handleDuoReady(data) {
    // Guest side: my accept reached the host. Now I queue with the inviteId.
    if (!data || !data.inviteId) return;
    state._pendingDuoInvite = { role: 'guest', inviteId: data.inviteId, partner: data.partner };
    if (window.CTNet && window.CTNet.isReady()) {
      stopTeamQueueTimer();
      tqStart = Date.now();
      const partnerEl = $('#tq-partner');
      if (partnerEl) partnerEl.textContent = `Teamed up with ${data.partner.username}.`;
      const timerEl = $('#tq-timer'); if (timerEl) timerEl.textContent = '3:00';
      openModal('team-queue');
      state._inTeamQueue = true;
      tqTimer = setInterval(() => {
        const elapsed = Date.now() - tqStart;
        const remaining = Math.max(0, TEAM_QUEUE_TIMEOUT_MS - elapsed);
        const s = Math.ceil(remaining / 1000);
        const mm = Math.floor(s / 60), ss = s % 60;
        if (timerEl) timerEl.textContent = mm + ':' + String(ss).padStart(2, '0');
        if (remaining <= 0) {
          stopTeamQueueTimer();
          if (state._inTeamQueue) {
            state._inTeamQueue = false;
            window.CTNet.leaveTeamQueue();
            closeModal('team-queue');
            toast('No opponents found in 3 minutes. Try again soon.');
          }
        }
      }, 250);
      window.CTNet.joinTeamQueue(data.inviteId, state.selectedTc || TC_DEFAULT);
    }
  }

  // Duo-invite modal wiring (one-time)
  { const b = $('#btn-duo-accept'); if (b) b.addEventListener('click', () => {
      const pi = state._pendingDuoInvite;
      if (!pi || pi.role !== 'guest' || !window.CTNet) { closeModal('duo-invite'); return; }
      window.CTNet.acceptDuo(pi.inviteId);
      closeModal('duo-invite');
    }); }
  { const b = $('#btn-duo-decline'); if (b) b.addEventListener('click', () => {
      const pi = state._pendingDuoInvite;
      if (pi && pi.role === 'guest' && window.CTNet) window.CTNet.declineDuo(pi.inviteId);
      state._pendingDuoInvite = null;
      closeModal('duo-invite');
    }); }
  { const b = $('#btn-tq-cancel'); if (b) b.addEventListener('click', () => {
      stopTeamQueueTimer();
      if (state._inTeamQueue && window.CTNet && window.CTNet.isReady()) window.CTNet.leaveTeamQueue();
      state._inTeamQueue = false;
      closeModal('team-queue');
    }); }

  // --- Friendly 1v1 challenge: incoming + waiting modal wiring ---
  function handleChallengeReceived(data) {
    if (!data || !data.inviteId) return;
    state._pendingChallenge = { role: 'guest', inviteId: data.inviteId, from: { id: data.fromId, name: data.fromName, elo: data.fromElo }, tc: data.tc };
    const body = $('#challenge-invite-body');
    if (body) body.textContent = (data.fromName || 'A friend') + ' (ELO ' + (data.fromElo || '?') + ') challenged you to a friendly (unrated) game.';
    openModal('challenge-invite');
  }
  { const b = $('#btn-challenge-accept'); if (b) b.addEventListener('click', () => {
      const pc = state._pendingChallenge;
      if (!pc || pc.role !== 'guest' || !window.CTNet || !window.CTNet.isReady()) { closeModal('challenge-invite'); return; }
      // Accepting: the server starts the game and emits match_found to both sides.
      state._waitingForServerMatch = true;
      window.CTNet.acceptChallenge(pc.inviteId);
      closeModal('challenge-invite');
    }); }
  { const b = $('#btn-challenge-decline'); if (b) b.addEventListener('click', () => {
      const pc = state._pendingChallenge;
      if (pc && pc.role === 'guest' && window.CTNet && window.CTNet.isReady()) window.CTNet.declineChallenge(pc.inviteId);
      state._pendingChallenge = null;
      closeModal('challenge-invite');
    }); }
  { const b = $('#btn-challenge-cancel'); if (b) b.addEventListener('click', () => {
      const pc = state._pendingChallenge;
      if (pc && pc.role === 'host' && pc.inviteId && window.CTNet && window.CTNet.isReady()) window.CTNet.cancelChallenge(pc.inviteId);
      state._pendingChallenge = null;
      state._waitingForServerMatch = false;
      closeModal('challenge-wait');
    }); }

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
    state.is960 = false; state.startFen960 = null;
    const { aiElo } = getAIDifficultyForElo(level);
    state.opponent = {
      username: 'Computer (' + aiNameForElo(aiElo) + ')',
      elo: aiElo,
      isAI: true,
      aiElo,
    };
    startGame('practice');
  }

  function startPractice960(level) {
    state.is960 = true;
    state.startFen960 = window.CT_random960Fen ? window.CT_random960Fen() : null;
    if (!state.startFen960) { state.is960 = false; }
    const { aiElo } = getAIDifficultyForElo(level);
    state.opponent = {
      username: 'Computer Random (' + aiNameForElo(aiElo) + ')',
      elo: aiElo,
      isAI: true,
      aiElo
    };
    startGame('practice');
  }
  window.CT_startPractice960 = startPractice960;

  // ---------------------------------------------------------------------------
  // Game lifecycle
  // ---------------------------------------------------------------------------
  function startGame(mode) {
    // When entering an offline game (practice, friendly, legacy ranked) after an
    // online match, clear any leftover online flags so the move gate doesn't
    // refuse input. state._forceColor is only set by the online matchmaking flow.
    if (!state._forceColor) {
      state.isOnline = false;
      state.gameId = null;
      state.applyingRemoteMove = false;
      state.awaitingServerGameOver = false;
      rematchState.eligible = false; // offline/AI games can't rematch online
    }
    // New game starting — clear any stale online status banners + countdowns.
    clearNetUI();
    // Tear down any previous clock; online clocked games re-init it after startGame.
    clockStop();
    state.gameMode = mode;
    // Analytics: single chokepoint for a game starting (practice, online, arena…).
    try { window.CT_Analytics && window.CT_Analytics.track('play_start', { mode: mode }); } catch (e) {}
    if (state.is960 && window.CT_random960Fen) {
      state.startFen960 = state.startFen960 || window.CT_random960Fen();
      try { state.game = new Chess(state.startFen960); }
      catch (e) { state.game = new Chess(); state.is960 = false; }
    } else {
      state.game = new Chess();
    }
    state.gameEnded = false;
    state.selected = null;
    state.legalTargets = [];
    state.lastMove = null;
    state.history = [];
    state.userColor = state._forceColor || (Math.random() < 0.5 ? 'w' : 'b');
    state.orientation = state.userColor;
    state.checkCount = { w: 0, b: 0 };
    setupGameScreen();
    showScreen('game');
    renderBoard();
    updateStatus();
    // If AI plays first, kick it off (offline only)
    if (!state.isOnline && state.opponent.isAI && state.game.turn() !== state.userColor) {
      setTimeout(makeAIMove, 500);
    }
  }

  function setupGameScreen() {
    // Top = opponent, Bottom = me (when orientation = my color)
    const me = state.user;
    const opp = state.opponent;
    const topIsOpp = state.orientation === state.userColor;
    const topUser = topIsOpp ? opp : me;
    const botUser = topIsOpp ? me : opp;
    $('#pt-name').textContent = topUser.username;
    $('#pt-elo').textContent = 'ELO ' + topUser.elo;
    $('#pb-name').textContent = botUser.username;
    $('#pb-elo').textContent = 'ELO ' + botUser.elo;
    // Show each player's REAL avatar (stock emoji or uploaded image), so both
    // parties see who they're playing -- not just a first initial.
    if (typeof getAvatarHTML === 'function') {
      $('#pt-avatar').innerHTML = getAvatarHTML(topUser, 40);
      $('#pb-avatar').innerHTML = getAvatarHTML(botUser, 40);
    } else {
      $('#pt-avatar').textContent = (topUser.username || '?')[0].toUpperCase();
      $('#pb-avatar').textContent = (botUser.username || '?')[0].toUpperCase();
    }
    $('#pt-captured').innerHTML = '';
    $('#pb-captured').innerHTML = '';
  }

  $('#btn-flip').addEventListener('click', () => {
    state.orientation = state.orientation === 'w' ? 'b' : 'w';
    setupGameScreen();
    renderBoard();
    // Re-map clocks to the swapped cards (no clock data changes; just sides).
    if (clockState.active) {
      const m = clock1v1Map();
      clockState.topEl = m.topEl; clockState.botEl = m.botEl;
      clockState.topSide = m.topSide; clockState.botSide = m.botSide;
      clockPaint();
    }
  });

  $('#btn-resign').addEventListener('click', () => {
    if (!state.game || state.game.game_over()) return;
    if (!confirm('Resign this game?')) return;
    if (state.isOnline && state.gameId && window.CTNet && window.CTNet.isReady()) {
      // Server will emit game_over to both sides with the authoritative result.
      window.CTNet.resign(state.gameId);
      return;
    }
    finishGame(state.userColor === 'w' ? 'b' : 'w', 'resignation');
  });

  // ---------------------------------------------------------------------------
  // Board rendering
  // ---------------------------------------------------------------------------
  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  function squareName(file, rank) { return FILES[file] + (rank + 1); }

  // Accessible-name helpers for the board (screen readers announce these as the
  // keyboard cursor moves square to square).
  const _PIECE_WORD = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const _COLOR_WORD = { w: 'white', b: 'black' };
  function squareAriaLabel(name, pieceObj) {
    let label = name + ', ' + (pieceObj ? _COLOR_WORD[pieceObj.color] + ' ' + _PIECE_WORD[pieceObj.type] : 'empty');
    if (state.selected === name) label += ', selected';
    else if (state.legalTargets && state.legalTargets.includes(name)) label += ', move target';
    return label;
  }
  // Move the keyboard cursor (roving tabindex) to a square and optionally focus it.
  function setBoardFocus(name, doFocus) {
    state.kbFocus = name;
    const boardEl = $('#board');
    if (!boardEl) return;
    boardEl.querySelectorAll('.sq[data-sq]').forEach(c => { c.tabIndex = (c.dataset.sq === name) ? 0 : -1; });
    if (doFocus) { const el = boardEl.querySelector('[data-sq="' + name + '"]'); if (el) el.focus(); }
  }
  // Keyboard play: arrows move the cursor (respecting orientation), Enter/Space
  // selects/moves via the SAME handleSquareClick path as mouse/touch, Escape
  // clears the selection. Bound once on #board (delegated; survives re-renders).
  function onBoardKey(ev) {
    const cur = ev.target && ev.target.closest ? ev.target.closest('.sq[data-sq]') : null;
    if (!cur) return;
    const name = cur.dataset.sq;
    const k = ev.key;
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
      ev.preventDefault();
      state.kbFocus = name;
      handleSquareClick(name);
      // handleSquareClick re-renders (new nodes), so restore DOM focus after paint.
      requestAnimationFrame(() => setBoardFocus(name, true));
      return;
    }
    if (k === 'Escape') {
      if (state.selected) { ev.preventDefault(); clearSelection(); renderBoard(); requestAnimationFrame(() => setBoardFocus(name, true)); }
      return;
    }
    const deltas = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Up: [0, 1], Down: [0, -1], Left: [-1, 0], Right: [1, 0] };
    const d = deltas[k];
    if (!d) return;
    ev.preventDefault();
    let f = FILES.indexOf(name[0]);
    let r = parseInt(name.slice(1), 10) - 1;
    let df = d[0], dr = d[1];
    // Black at the bottom: visual arrows are inverted relative to board coords.
    if (state.orientation === 'b') { df = -df; dr = -dr; }
    f = Math.max(0, Math.min(7, f + df));
    r = Math.max(0, Math.min(7, r + dr));
    setBoardFocus(FILES[f] + (r + 1), true);
  }

  function renderBoard() {
    const boardEl = $('#board');
    if (!boardEl.dataset.kbBound) {
      boardEl.setAttribute('role', 'grid');
      boardEl.setAttribute('aria-label', 'Chess board — arrow keys to move the cursor, Enter to select or move');
      boardEl.addEventListener('keydown', onBoardKey);
      boardEl.dataset.kbBound = '1';
    }
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
        sq.setAttribute('role', 'gridcell');
        // chess.js board() returns rows from rank 8 → 1; index = 7 - r
        const pieceObj = board[7 - r][f];
        sq.setAttribute('aria-label', squareAriaLabel(name, pieceObj));
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
        sq.addEventListener('pointerdown', (ev) => onBoardPointerDown(ev, name));
        boardEl.appendChild(sq);
      }
    }
    // Roving tabindex: exactly one square is a tab stop (the keyboard cursor).
    // Keep the prior cursor if it still exists; otherwise seed it sensibly.
    let focusName = state.kbFocus;
    if (!focusName || !boardEl.querySelector('[data-sq="' + focusName + '"]')) {
      focusName = state.selected || (state.orientation === 'b' ? 'e7' : 'e2');
    }
    state.kbFocus = focusName;
    boardEl.querySelectorAll('.sq[data-sq]').forEach(c => { c.tabIndex = (c.dataset.sq === focusName) ? 0 : -1; });
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
    // In online play, only the side matching the user's assigned color may move
    if (state.isOnline && turn !== state.userColor) return;

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

  // ---------------------------------------------------------------------------
  // DRAG-AND-DROP (Pointer Events). Coexists with click-to-move:
  //  - pointerdown on a movable piece begins a *potential* drag and selects the
  //    square (reusing selectSquare -> the same legal-target highlights as click).
  //  - moving past a small threshold "lifts" the piece (a floating clone follows
  //    the pointer); page scroll is suppressed for the duration (touch-action:none
  //    on .sq + we don't let the gesture bubble once lifted).
  //  - pointerup over a legal target applies the move through tryMove/afterMove —
  //    the SAME path click-to-move uses (no reimplemented legality/animation).
  //  - a quick tap (down+up, no lift) does nothing here and lets the native click
  //    drive selection/move exactly as before. We only suppress the click when we
  //    actually consumed the gesture as a drag-drop (so we never double-apply).
  // ---------------------------------------------------------------------------
  function dragReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function onBoardPointerDown(ev, name) {
    // Only primary button / single touch; ignore right-click & multi-touch.
    if (ev.button != null && ev.button !== 0) return;
    if (state.drag) return; // already dragging something
    // Same gates as handleSquareClick: game live, our turn, no modal/animation.
    if (!state.game || state.game.game_over() || state.aiThinking || state.promotionPending || state.animatingMove) return;
    const piece = state.game.get(name);
    const turn = state.game.turn();
    if (!piece || piece.color !== turn) return; // empty / opponent piece: let click handle
    if (state.opponent && state.opponent.isAI && turn !== state.userColor) return;
    if (state.isOnline && turn !== state.userColor) return;

    const boardEl = $('#board');
    const sqEl = boardEl ? boardEl.querySelector('[data-sq="' + name + '"]') : null;
    if (!boardEl || !sqEl) return;

    // IMPORTANT: do NOT select here. A pure tap must be handled entirely by the
    // native click (selecting here would make the trailing click toggle the
    // selection OFF again). We only select once the gesture actually LIFTS into a
    // drag (see dragBeginLift), which reuses the same selectSquare highlighting.
    const boardRect = boardEl.getBoundingClientRect();
    const drag = {
      from: name,
      piece: piece.type,
      color: piece.color,
      sqEl: sqEl,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      lifted: false,
      clone: null,
      size: boardRect.width / 8,
      boardRect: boardRect,
      consumed: false, // true once we apply a move (suppress the trailing click)
      moveHandler: null,
      upHandler: null,
      cancelHandler: null,
    };
    state.drag = drag;

    drag.moveHandler = (e) => onBoardPointerMove(e);
    drag.upHandler = (e) => onBoardPointerUp(e);
    drag.cancelHandler = (e) => onBoardPointerCancel(e);
    // Listen on window so the drag keeps tracking even off the board.
    window.addEventListener('pointermove', drag.moveHandler, { passive: false });
    window.addEventListener('pointerup', drag.upHandler);
    window.addEventListener('pointercancel', drag.cancelHandler);
    try { sqEl.setPointerCapture(ev.pointerId); } catch (e) {}
  }

  function dragBeginLift(drag, clientX, clientY) {
    drag.lifted = true;
    // Now show the legal-target highlights (reuses the click-to-move selection).
    // selectSquare -> renderBoard rebuilds the board, so re-acquire the square el.
    if (state.selected !== drag.from) {
      selectSquare(drag.from);
      const fresh = $('#board') && $('#board').querySelector('[data-sq="' + drag.from + '"]');
      if (fresh) drag.sqEl = fresh;
    }
    drag.sqEl.classList.add('dragging');
    const clone = document.createElement('div');
    clone.className = 'drag-piece' + (dragReducedMotion() ? '' : ' lift');
    clone.style.width = drag.size + 'px';
    clone.style.height = drag.size + 'px';
    clone.innerHTML = pieceSVG(drag.piece, drag.color);
    const overlay = $('#board-overlay') || $('#board');
    overlay.appendChild(clone);
    drag.clone = clone;
    dragMoveClone(drag, clientX, clientY);
  }

  function dragMoveClone(drag, clientX, clientY) {
    if (!drag.clone) return;
    // Position relative to the board (overlay is inset:0 over the board).
    const x = clientX - drag.boardRect.left - drag.size / 2;
    const y = clientY - drag.boardRect.top - drag.size / 2;
    const scale = dragReducedMotion() ? 1 : 1.08;
    drag.clone.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(' + scale + ')';
  }

  function onBoardPointerMove(ev) {
    const drag = state.drag;
    if (!drag || ev.pointerId !== drag.pointerId) return;
    if (!drag.lifted) {
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if ((dx * dx + dy * dy) < 25) return; // ~5px threshold before we treat it as a drag
      dragBeginLift(drag, ev.clientX, ev.clientY);
    }
    // While lifted, suppress page scroll / text selection.
    if (ev.cancelable) ev.preventDefault();
    dragMoveClone(drag, ev.clientX, ev.clientY);
  }

  function dragSquareAt(drag, clientX, clientY) {
    const r = drag.boardRect;
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const el = document.elementFromPoint(clientX, clientY);
    const sq = el && el.closest ? el.closest('#board .sq[data-sq]') : null;
    return sq ? sq.dataset.sq : null;
  }

  function teardownDrag(drag) {
    window.removeEventListener('pointermove', drag.moveHandler, { passive: false });
    window.removeEventListener('pointerup', drag.upHandler);
    window.removeEventListener('pointercancel', drag.cancelHandler);
    try { drag.sqEl.releasePointerCapture(drag.pointerId); } catch (e) {}
    if (drag.clone) { drag.clone.remove(); drag.clone = null; }
    drag.sqEl.classList.remove('dragging');
    if (state.drag === drag) state.drag = null;
  }

  function onBoardPointerUp(ev) {
    const drag = state.drag;
    if (!drag || ev.pointerId !== drag.pointerId) return;

    if (!drag.lifted) {
      // No real drag happened — a tap. Let the native click drive selection/move
      // exactly as today; just tear down our drag bookkeeping.
      teardownDrag(drag);
      return;
    }

    const dest = dragSquareAt(drag, ev.clientX, ev.clientY);
    const isLegal = dest && dest !== drag.from && state.legalTargets.indexOf(dest) !== -1;

    if (isLegal) {
      // Apply via the SAME path click-to-move uses (handles promotion modal,
      // Chess960 castling, animation, online send — all of it).
      drag.consumed = true;
      const from = drag.from;
      // Remove the floating clone & dragging class BEFORE the move so afterMove's
      // animation (overlay piece) renders cleanly from the real board.
      teardownDrag(drag);
      clearSelection();
      const move = tryMove(from, dest);
      if (move) {
        afterMove(move);
      } else {
        // tryMove returned null because it opened the promotion modal (state set);
        // showPromotion -> its click handler will call afterMove. Nothing to undo.
        renderBoard();
      }
      // Suppress the click event that follows this pointerup so we don't re-handle
      // the same gesture as a click-to-move (double-apply guard).
      suppressNextBoardClick();
      return;
    }

    // Not a legal target (or dropped off-board): snap back. Keep the selection so
    // the user still sees the highlighted piece/targets (matches a no-op click).
    teardownDrag(drag);
    suppressNextBoardClick(); // the lift consumed the gesture; don't let click toggle it off
    renderBoard();
  }

  function onBoardPointerCancel(ev) {
    const drag = state.drag;
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const wasLifted = drag.lifted;
    teardownDrag(drag);
    if (wasLifted) { suppressNextBoardClick(); renderBoard(); }
  }

  // After a drag we consumed, the browser still synthesizes a `click` on the
  // source square (from the pointerdown). Swallow exactly one board click so the
  // gesture isn't double-handled by handleSquareClick.
  var _suppressBoardClick = false;
  function suppressNextBoardClick() {
    if (_suppressBoardClick) return;
    _suppressBoardClick = true;
    const boardEl = $('#board');
    if (!boardEl) { _suppressBoardClick = false; return; }
    const handler = (e) => {
      e.stopPropagation();
      e.preventDefault();
      boardEl.removeEventListener('click', handler, true);
      _suppressBoardClick = false;
    };
    boardEl.addEventListener('click', handler, true);
    // Safety: if no click arrives (some browsers don't synthesize one), clear soon.
    setTimeout(() => {
      if (_suppressBoardClick) { boardEl.removeEventListener('click', handler, true); _suppressBoardClick = false; }
    }, 400);
  }

  function selectSquare(name) {
    state.selected = name;
    state.legalTargets = state.game.moves({ square: name, verbose: true }).map(m => m.to);
    // Chess960: chess.js 0.x can't generate castles from randomized back-ranks,
    // so add the castle destinations ourselves as legal targets for the king.
    if (state.is960 && window.CT_960Castle) {
      const piece = state.game.get(name);
      if (piece && piece.type === 'k' && piece.color === state.game.turn()) {
        window.CT_960Castle.legalCastlingMoves(state.game, state.startFen960).forEach(d => {
          // Standard 960 input is "king onto its own rook", so surface the rook
          // square as a target (the rook hop is what the player clicks).
          if (state.legalTargets.indexOf(d.rookFrom) === -1) state.legalTargets.push(d.rookFrom);
          // Also surface the g/c king destination for the two-square input.
          if (state.legalTargets.indexOf(d.kingTo) === -1) state.legalTargets.push(d.kingTo);
        });
      }
    }
    renderBoard();
  }
  function clearSelection() {
    state.selected = null;
    state.legalTargets = [];
  }

  function tryMove(from, to) {
    // Chess960 castling: chess.js 0.x can't castle from randomized back-ranks,
    // so detect a castle intent (king onto own rook, or king two+ squares toward
    // a rook / to the g|c square) and execute it via our own validator, which
    // FEN-surgers the resulting position into state.game. Returns a move-like
    // object so afterMove() drives the normal re-render + AI-reply flow.
    if (state.is960 && window.CT_960Castle) {
      const desc = window.CT_960Castle.castleIntent(state.game, from, to, state.startFen960);
      if (desc) {
        return window.CT_960Castle.applyCastleDescriptor(state.game, desc);
      }
    }
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
    // Online: if this is OUR move (not a remote-applied opponent move), tell the server.
    if (state.isOnline && !state.applyingRemoteMove && move && move.color === state.userColor && state.gameId) {
      try {
        window.CTNet.sendMove({
          gameId: state.gameId,
          from: move.from,
          to: move.to,
          promotion: move.promotion || undefined,
        });
      } catch (e) { console.error('[CTNet] sendMove failed', e); }
    }
    animateBoardMove(move, () => {
      state.animatingMove = false;
      renderBoard();
      updateStatus();
      if (state.game.game_over()) {
        // Online: wait for server's game_over for authoritative ELO; offline: resolve locally.
        if (!state.isOnline) handleGameOver();
        return;
      }
      // If AI opponent's turn (offline only)
      if (!state.isOnline && state.opponent.isAI && state.game.turn() !== state.userColor) {
        state.aiThinking = true;
        // makeAIMove now runs the search off-thread (Web Worker) and clears
        // state.aiThinking itself once the move resolves.
        setTimeout(() => { makeAIMove(); }, 350);
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
  // The minimax/alpha-beta engine + piece-square tables now live in ct-ai.js
  // (window.CT_AI.chooseMove). makeAIMove below just applies its choice.
  function makeAIMove() {
    if (state.game.game_over()) { state.aiThinking = false; return; }
    const g = state.game;                       // capture: skip if a new game starts mid-think
    const fen = g.fen();
    const aiElo = state.opponent.aiElo || 1200;
    // In 960 the engine may return a real Chess960 castle descriptor (king + rook
    // hop) instead of a chess.js move; pass the 960 start FEN so it can find them.
    const startFen960 = state.is960 ? state.startFen960 : undefined;
    const apply = (m) => {
      state.aiThinking = false;
      // Bail if the game was reset/left while the worker was thinking, or the move
      // is no longer legal (defensive — the worker ran on a snapshot FEN).
      if (!m || state.game !== g || g.game_over()) return;
      // 960 castle descriptor: apply via FEN surgery, not chess.js .move().
      if (m.castle && m.kingFrom && window.CT_960Castle) {
        const move = window.CT_960Castle.applyCastleDescriptor(g, m);
        if (move) afterMove(move);
        return;
      }
      const move = g.move({ from: m.from, to: m.to, promotion: m.promotion || 'q' });
      if (move) afterMove(move);
    };
    // Prefer the off-thread (Web Worker) search so the UI never freezes; fall back
    // to the synchronous engine if Workers are unavailable.
    if (window.CT_AI && window.CT_AI.chooseMoveAsync) {
      window.CT_AI.chooseMoveAsync(fen, aiElo, startFen960).then(apply, () => { state.aiThinking = false; });
    } else if (window.CT_AI) {
      apply(window.CT_AI.chooseMove(g, aiElo, startFen960));
    } else {
      state.aiThinking = false;
    }
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
    clockStop();
    // Session "games finished" signal — gates ad/upsell clutter until the user has
    // completed at least one game (covers guests, who have no persisted record).
    state._sessionGamesFinished = (state._sessionGamesFinished || 0) + 1;
    // NOTE: the DAILY STREAK is now earned by SOLVING the daily puzzle
    // (window.CT_onPuzzleSolved -> recordDailyPlay), not by finishing a game.
    // Finishing a game no longer advances the streak.
    // Game ended — drop any disconnect/reconnect status banners + their timers.
    netBanner(null);
    oppBanner(null);
    const opp = state.opponent;
    const myWon = winnerColor === state.userColor;
    const isDraw = winnerColor === null;
    // Analytics: a game ended. result is from the local player's perspective.
    try {
      window.CT_Analytics && window.CT_Analytics.track('play_finish', {
        mode: state.gameMode,
        result: isDraw ? 'draw' : (myWon ? 'win' : 'loss'),
      });
    } catch (e) {}
    // Game-over sound
    if (window.ChessSounds) {
      if (isDraw) window.ChessSounds.note ? window.ChessSounds.note(523, 0.4, 'sine', 0.18) : null;
      else window.ChessSounds.gameOver(myWon);
    }

    const rewards = [];
    const isRanked = state.gameMode === 'ranked';
    // Set true if the 7-win-streak milestone fired its own big confetti burst, so
    // the win-celebration block below doesn't fire a second competing burst.
    let streakBurstFired = false;
    // Set to the new tier object if this ranked win crossed UP into a higher
    // named tier; the centralized celebration block fires the reveal (so it
    // respects the mate-moment delay + doesn't stack on the streak burst).
    let rankUpTier = null;

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

      // Rank-up: did this win cross into a higher named tier? (Only on a gain —
      // we never punish a rating drop with a "rank down" callout.)
      if (delta > 0) {
        const _newTierIdx = ctTierIndex(me.elo);
        if (_newTierIdx > ctTierIndex(me.elo - delta)) {
          rankUpTier = CT_TIERS[_newTierIdx];
          rewards.unshift(`<div class="card row between" style="border-color:rgba(245,196,81,.55);background:linear-gradient(160deg,rgba(245,196,81,.10),transparent)"><div>${rankUpTier.icon} Rank up — <b>${rankUpTier.name}</b></div><div class="pill success">ELO ${me.elo}</div></div>`);
        }
      }

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
            streakBurstFired = true;
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
      // Measure "days without a win" from the last win, or from account creation
      // for players who have NEVER won -- otherwise these two trophies could never
      // unlock for a winless player (the very person they describe).
      const winRef = me.lastWinDate || me.createdAt || Date.now();
      {
        const daysSinceWin = (Date.now() - winRef) / 86400000;
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
      const moreUnlocks = checkAchievementsFor(me, { justWon: myWon, mateWin: myWon && reason === 'checkmate', moves: fullMoves, finalize: true });
      moreUnlocks.filter(Boolean).forEach(a => {
        const color = tierColor(a.tier || 1);
        const isOops = a.embarrassing;
        const cnt = achievementCount(me, a.id);
        const again = cnt > 1 ? ` <span class="pill" style="background:${color}33;color:${color};font-weight:800">×${cnt}</span>` : '';
        const head = cnt > 1
          ? (isOops ? '😅 Earned again' : 'Trophy earned again')
          : (isOops ? '😅 Oops! A cheeky trophy' : (a.hidden ? '🔓 Hidden trophy unlocked' : 'Trophy unlocked'));
        rewards.push(`<div class="card row" style="gap:12px;border-color:${isOops ? 'var(--danger)' : color + 'aa'};background:linear-gradient(135deg, ${isOops ? 'rgba(248,113,113,.1)' : color + '12'}, var(--panel))">
          <div style="font-size:30px">${a.icon}</div>
          <div style="flex:1">
            <div style="font-weight:700">${head}<span class="pill" style="background:${color}22;color:${color};margin-left:6px">${a.family}</span>${again}</div>
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
    let title, body, outcome, stateClass;
    if (isDraw) {
      title = 'Draw';
      outcome = 'Draw';
      stateClass = 'ct-result-draw';
      body = reason === 'stalemate' ? 'Stalemate.' : 'Draw agreed by the rules.';
    } else if (myWon) {
      title = 'Victory! 🏆';
      outcome = 'You win';
      stateClass = 'ct-result-win';
      body = reason === 'checkmate' ? 'You delivered checkmate.' :
             reason === 'resignation' ? 'Your opponent resigned.' :
             reason === 'timeout' ? 'You won on time.' : 'You won.';
    } else {
      title = 'Defeat';
      outcome = 'You lose';
      stateClass = 'ct-result-lose';
      body = reason === 'checkmate' ? 'Checkmated.' :
             reason === 'resignation' ? 'You resigned.' :
             reason === 'timeout' ? 'You lost on time.' : 'Your opponent won.';
    }
    var _titleEl = $('#result-title');
    _titleEl.textContent = title;
    _titleEl.classList.remove('ct-result-win', 'ct-result-lose', 'ct-result-draw', 'ct-trophy-shine');
    _titleEl.classList.add(stateClass);
    var _outcomeEl = $('#result-outcome');
    if (_outcomeEl) {
      _outcomeEl.textContent = outcome;
      _outcomeEl.className = stateClass; // distinct win/lose/draw pill
      _outcomeEl.style.display = '';
    }
    $('#result-body').textContent = body;
    $('#result-rewards').innerHTML = rewards.join('') + renderAdSlot('medium');
    // Rematch UI: only for online 1v1 games (eligible flag set at match start and
    // cleared for offline/2v2). Reset to its default "Rematch" state each time.
    resetRematchUI();
    // Offer "Block opponent" only for a real online human opponent.
    var _blkBtn = $('#btn-result-block');
    if (_blkBtn) {
      var _blkOpp = state.opponent;
      var canBlock = !!(_blkOpp && _blkOpp.userId && !_blkOpp.isAI && !_blkOpp.isGuest && isServerLoggedIn());
      _blkBtn.style.display = canBlock ? '' : 'none';
    }
    // The checkers result reuses this same modal and hides the review button; make
    // sure chess always restores it (block-button visibility is set just above).
    var _rvBtn2 = $('#btn-result-review'); if (_rvBtn2) _rvBtn2.style.display = '';
    // Guest CTA: show after EVERY guest game (not just wins — the ~80% who lose
    // their first game previously got no prompt + no reason to return). Copy is
    // framed by context (loss-aversion): a win/trophy → "save your win", a live
    // daily streak → "keep your N-day streak", else "track your progress".
    var _gBtn = $('#btn-result-guest-signup');
    if (_gBtn) {
      var _newTrophyCount = (typeof unlocked !== 'undefined' ? unlocked.length : 0) + (typeof moreUnlocks !== 'undefined' ? moreUnlocks.length : 0);
      var _showGuestCta = !!(state.user && state.user.isGuest);
      if (_showGuestCta) {
        var _gStreak = (state.user.playStreak && state.user.playStreak.streak) || 0;
        _gBtn.textContent = (myWon || _newTrophyCount > 0)
          ? '🏆 Save your win — create a free account'
          : (_gStreak > 1
              ? 'Keep your ' + _gStreak + '-day streak — create a free account'
              : 'Track your progress — create a free account');
      }
      _gBtn.style.display = _showGuestCta ? '' : 'none';
      // Analytics: the guest signup CTA is actually being shown.
      if (_showGuestCta) { try { window.CT_Analytics && window.CT_Analytics.track('signup_cta_view', { won: !!(myWon || _newTrophyCount > 0) }); } catch (e) {} }
    }
    // Checkmate moment: punctuate the mate on the board (flash + king topple)
    // BEFORE the modal slides up, so the player sees the kill on the board. The
    // loser is the side that was checkmated (the side to move when mate happened).
    var _mateDelay = 0;
    if (reason === 'checkmate') {
      var _loserColor = isDraw ? null : (myWon ? (state.userColor === 'w' ? 'b' : 'w') : state.userColor);
      _mateDelay = ctMateMoment(_loserColor);
    }

    // Count any trophies/streaks earned this game — they get the BIGGER, layered
    // celebration; a plain win gets a single tasteful burst. We coordinate both
    // here so a win+trophy is ONE cohesive moment (never two competing bursts).
    var _newTrophies = (typeof unlocked !== 'undefined' ? unlocked.length : 0) + (typeof moreUnlocks !== 'undefined' ? moreUnlocks.length : 0);
    // Gate ALL win celebration on a real local-human WIN (covers checkmate,
    // resignation, timeout in our favor). myWon is false for losses, draws, and —
    // in online play — when the OPPONENT wins, so those never celebrate.
    var _celebrateWin = myWon && !isDraw;

    var _runCelebration = function () {
      try {
        openModal('result');
        var _t = $('#result-title');
        if (_celebrateWin || _newTrophies > 0) {
          if (_t) { _t.classList.remove('ct-trophy-shine'); void _t.offsetWidth; _t.classList.add('ct-trophy-shine'); }
        }
        // One confetti decision, scaled: trophies/streaks > plain win. If the
        // 7-win-streak already fired its 'big' burst, it IS the moment — don't
        // stack another burst on top (keeps win+streak cohesive, not competing).
        if (streakBurstFired) {
          // streak 'big' already played; nothing more to fire.
        } else if (rankUpTier) {
          // Crossing into a new tier is THE moment: a big burst + the reveal.
          ctCelebrate('big');
          try { if (window.ChessSounds && window.ChessSounds.streakMilestone) window.ChessSounds.streakMilestone(); } catch (e) {}
          setTimeout(function () { ctRankUpReveal(rankUpTier, me.elo); }, 240);
        } else if (_newTrophies >= 2) {
          // Multiple unlocks: the loud, layered moment.
          ctCelebrate('big');
          setTimeout(function(){ ctCelebrate('normal'); }, 260);
        } else if (_newTrophies === 1) {
          // A single trophy alongside the win: a solid burst with a small echo.
          ctCelebrate('normal');
          setTimeout(function(){ ctCelebrate('normal'); }, 260);
        } else if (_celebrateWin) {
          // Plain win, no new trophy: ONE tasteful 'win'-tier burst — deliberately
          // lighter than a trophy/streak moment so a normal win never feels as loud
          // as a 7-streak.
          ctCelebrate('win');
        }
      } catch (e) {}
    };

    // Guest persistence: bump the practice-difficulty ramp counter + save the
    // guest's trophies / daily streak / stats so they SURVIVE a refresh (the
    // practice/unranked branches above never call saveDB). No-op for signed-in
    // users. This is what makes a returning guest come back to their progress.
    if (state.user && state.user.isGuest) {
      state.user.flags = state.user.flags || {};
      state.user.flags.guestGames = (state.user.flags.guestGames || 0) + 1;
      saveGuest();
    }

    if (_mateDelay > 0) {
      // Hold the modal briefly so the board mate animation reads first.
      setTimeout(_runCelebration, _mateDelay);
    } else {
      _runCelebration();
    }
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

  $('#btn-result-block').addEventListener('click', () => {
    var opp = state.opponent;
    if (opp && opp.userId) { closeModal('result'); blockPlayer(opp.userId, opp.username); }
  });
  { const _gb = $('#btn-result-guest-signup'); if (_gb) _gb.addEventListener('click', () => {
    // Send the guest to the auth screen with Create-account preselected so their
    // future progress is saved server-side. (We can't migrate this game's result —
    // guests are intentionally not persisted — but we stop the bleeding here.)
    closeModal('result');
    showNav(false);
    showScreen('auth');
    const signupTab = $('#screen-auth .tab[data-tab="signup"]');
    if (signupTab) signupTab.click();
    toast('Create a free account to keep your rating, wins, and trophies.');
  }); }
  $('#btn-result-close').addEventListener('click', () => {
    // Dismissing the result drops any pending rematch offer/eligibility.
    if (rematchState.phase === 'offered' && rematchState.gameId && window.CTNet && window.CTNet.isReady()) {
      window.CTNet.declineRematch(rematchState.gameId);
    }
    rematchState.phase = 'idle';
    rematchState.eligible = false;
    rematchState.gameId = null;
    clearNetUI();
    // Reset result-title/outcome state so it never bleeds into the next result
    // (incl. the checkers result, which reuses this same modal).
    try {
      var _rt = $('#result-title'); if (_rt) _rt.classList.remove('ct-result-win', 'ct-result-lose', 'ct-result-draw', 'ct-trophy-shine');
      var _ro = $('#result-outcome'); if (_ro) { _ro.style.display = 'none'; _ro.className = ''; }
    } catch (e) {}
    closeModal('result');
    showScreen('lobby');
  _addLobbyChatButton();
  });
    var _rvBtn = $('#btn-result-review');
    if (_rvBtn && !_rvBtn._wired) {
      _rvBtn._wired = true;
      _rvBtn.addEventListener('click', function () {
        try {
          var hist = (state.game && state.game.history) ? state.game.history({ verbose: true }) : [];
          if (window.CT_reviewGame) window.CT_reviewGame(hist);
          else if (CT && CT.toast) CT.toast('Review is unavailable.');
        } catch (e) { if (window.console) console.warn('review failed', e); }
      });
    }

  // ---------------------------------------------------------------------------
  // Profile screen
  // ---------------------------------------------------------------------------
  // Show the daily-reminder opt-in only when Web Push is supported by the browser,
  // configured on the server (VAPID set), the user is logged in, not already
  // subscribed, and hasn't denied permission. Stays hidden otherwise (incl. while
  // push is unconfigured), so it never nags.
  function updateReminderCard() {
    const card = $('#profile-reminders'); if (!card) return;
    const btn = $('#btn-enable-reminders');
    let show = false, subscribed = false;
    try {
      const P = window.CT_Push;
      const supported = ('Notification' in window) && ('serviceWorker' in navigator) && ('PushManager' in window);
      const enabled = !!(P && P.isEnabled && P.isEnabled());
      subscribed = !!(P && P.isSubscribed && P.isSubscribed());
      const denied = ('Notification' in window) && Notification.permission === 'denied';
      show = !!(P && supported && enabled && !subscribed && !denied && state.user && !state.user.isGuest);
    } catch (e) {}
    card.style.display = show ? '' : 'none';
    if (btn) btn.textContent = subscribed ? '✓ On' : 'Enable';
  }

  function renderProfile() {
  if (!state.user) return;
    const u = state.user;
    // Coach summary + daily-reminder opt-in (deferred modules; guard).
    try { if (window.CT_Coach) window.CT_Coach.renderInto('#profile-coach'); } catch (e) {}
    updateReminderCard();
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
    { const aw = $('#prof-arena-wins'); if (aw) aw.textContent = u.arenaWins || 0; }
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

  // Most Feared (Victim Wall) wiring — CSP-safe (no inline handlers).
  { const b = $('#btn-open-feared'); if (b) b.addEventListener('click', () => showScreen('feared')); }
  { const b = $('#btn-feared-refresh'); if (b) b.addEventListener('click', () => renderFeared()); }
  { const b = $('#btn-feared-revenge'); if (b) b.addEventListener('click', () => {
      if (typeof rankedEnabled === 'function' && !rankedEnabled()) { toast('Ranked play is coming soon.'); return; }
      try { openTimeControlPicker({}, () => startOnlineOrFakeMatchmaking('ranked')); }
      catch (e) { toast('Find a ranked game to climb the wall.'); }
  }); }

  // Season (monthly ladder) wiring — CSP-safe (no inline handlers).
  { const b = $('#btn-open-season'); if (b) b.addEventListener('click', () => showScreen('season')); }
  { const b = $('#btn-season-refresh'); if (b) b.addEventListener('click', () => renderSeason()); }
  { const b = $('#btn-season-play'); if (b) b.addEventListener('click', () => {
      if (typeof rankedEnabled === 'function' && !rankedEnabled()) { toast('Ranked play is coming soon.'); return; }
      try { openTimeControlPicker({}, () => startOnlineOrFakeMatchmaking('ranked')); }
      catch (e) { toast('Find a ranked game to climb the ladder.'); }
  }); }

  const METRIC_INFO = {
    elo:      { label: 'ELO',     key: u => u.elo,                            unit: '' },
    wins:     { label: 'Wins',    key: u => u.wins,                           unit: 'W' },
    trophies: { label: 'Trophies', key: u => u.streakTrophies.length + u.achievements.length, unit: '🏆' },
    streak:   { label: 'Best',    key: u => u.bestStreak,                     unit: '' },
    checkers8:  { label: 'Checkers 8×8',  key: u => u.eloCheckers8,  unit: '' },
    checkers10: { label: 'Checkers 10×10', key: u => u.eloCheckers10, unit: '' },
  };

  // Score a normalized player by the active metric.
  function rankScore(u, metric) {
    if (metric === 'wins') return u.wins || 0;
    if (metric === 'trophies') return u.trophies || 0;
    if (metric === 'streak') return u.bestStreak || 0;
    if (metric === 'checkers8') return u.eloCheckers8 || 1200;
    if (metric === 'checkers10') return u.eloCheckers10 || 1200;
    return u.elo || 0;
  }
  // Normalize a server rankings row (snake_case + computed trophies) to a common shape.
  function normalizeServerPlayer(p) {
    return {
      id: p.id, username: p.username || 'Player', region: p.region || '',
      elo: p.elo || 1200, wins: p.wins || 0, losses: p.losses || 0,
      bestStreak: p.best_streak || 0, trophies: p.trophies || 0,
      eloCheckers8: p.elo_checkers_8 || 1200, eloCheckers10: p.elo_checkers_10 || 1200,
    };
  }
  // Normalize a local-DB user to the same shape (guests/offline fallback only).
  function normalizeLocalPlayer(u) {
    const ck = u.checkers || {};
    return {
      id: u.id, username: u.username || 'Player', region: u.region || '',
      elo: u.elo || 1200, wins: u.wins || 0, losses: u.losses || 0, draws: u.draws || 0,
      bestStreak: u.bestStreak || 0,
      trophies: ((u.streakTrophies && u.streakTrophies.length) || 0) + ((u.achievements && u.achievements.length) || 0),
      eloCheckers8: ck.elo8 || 1200, eloCheckers10: ck.elo10 || 1200,
      checkersGames: (ck.wins || 0) + (ck.losses || 0) + (ck.draws || 0),
    };
  }
  // Has this (normalized) player actually competed in the given metric's mode?
  // Mirrors the server's participation filter so the offline fallback doesn't
  // list registered-but-never-played users at their default rating.
  function participatedInMetric(u, metric) {
    if (metric === 'wins')     return (u.wins || 0) > 0;
    if (metric === 'streak')   return (u.bestStreak || 0) > 0;
    if (metric === 'trophies') return (u.trophies || 0) > 0;
    if (metric === 'checkers8' || metric === 'checkers10') return (u.checkersGames || 0) > 0;
    return ((u.wins || 0) + (u.losses || 0) + (u.draws || 0)) > 0; // elo
  }

  function renderRankingRows(players, serverBacked) {
    const wrap = $('#rank-list');
    if (!wrap) return;
    const footer = $('#rank-footer-note');
    if (footer) footer.textContent = serverBacked
      ? 'Global rankings update as players around the world compete.'
      : 'Showing local results — sign in for the global leaderboard.';
    const me = state.user;
    const info = METRIC_INFO[currentRankMetric] || METRIC_INFO.elo;
    if (!players.length) {
      // You only appear on a board once you've actually competed in that mode, so
      // a board can legitimately be empty (e.g. before any ranked games are played
      // this season). Say so instead of implying something is broken.
      const m = currentRankMetric;
      const what = (m === 'checkers8' || m === 'checkers10') ? 'ranked checkers games'
                 : (m === 'trophies') ? 'trophies earned'
                 : 'ranked games';
      wrap.innerHTML = `<div class="card muted center">No one's on the ${info.label.toLowerCase()} board yet — it fills up as players complete ${what}.</div>`;
      return;
    }
    const myIdx = players.findIndex(u => u.id === me.id);
    const myRank = myIdx >= 0 ? myIdx + 1 : 0;
    const scope = serverBacked ? 'global' : 'on this device';
    const summary = `<div class="muted small center" style="margin-bottom:8px">Top ${players.length} by ${info.label.toLowerCase()} (${scope})${myRank ? ` · you're #${myRank}` : ''}</div>`;
    const rows = players.map((u, i) => {
      const top = i < 3 ? `top${i + 1}` : '';
      const meTag = u.id === me.id ? 'me' : '';
      const score = rankScore(u, currentRankMetric);
      const scoreLabel = currentRankMetric === 'trophies' ? `${score}🏆` :
                        currentRankMetric === 'wins' ? `${score}W` :
                        currentRankMetric === 'streak' ? `${score}🔥` :
                        score;
      return `<div class="rank-row ${top} ${meTag}">
        <div class="rank-num">${i + 1}</div>
        <div class="avatar" style="width:32px;height:32px;font-size:13px">${escapeHTML((u.username[0] || '?').toUpperCase())}</div>
        <div class="rank-info">
          <div class="rank-name">${escapeHTML(u.username)}${u.id === me.id ? ' <span class="pill gold small">you</span>' : ''}</div>
          <div class="rank-meta">${escapeHTML(u.region || '—')} · ELO ${u.elo} · ${u.wins}W ${u.losses}L</div>
        </div>
        <div class="rank-elo">${scoreLabel}</div>
      </div>`;
    }).join('');
    wrap.innerHTML = summary + rows;
  }

  // Rankings are server-authoritative: a logged-in account pulls the real global
  // leaderboard from /api/rankings. Guests/offline sessions have no server data,
  // so they fall back to the per-device local DB (which only holds this device's
  // accounts -- that's why offline you only ever saw yourself + local guests).
  async function renderRankings() {
    if (!state.user) return;
    const wrap = $('#rank-list');
    const sizeMap = { '100': 100, '500': 500, '5000': 5000, 'all': 5000 };
    const limit = sizeMap[currentRankSize] || 100;

    // Always show the GLOBAL leaderboard — guests included. /api/rankings is
    // public + read-only (api() simply omits the auth header when there's no
    // token). Fall back to the local device list only if the server is
    // unreachable (offline), never gate the global view behind sign-in.
    if (wrap) wrap.innerHTML = `<div class="card muted center">Loading rankings…</div>`;
    try {
      const data = await api('/api/rankings?metric=' + encodeURIComponent(currentRankMetric) + '&limit=' + limit);
      const players = (((data && data.players) || []).map(normalizeServerPlayer));
      renderRankingRows(players, true);
      return;
    } catch (e) {
      // Network/server hiccup -- fall through to the local view rather than erroring.
    }

    const db = loadDB();
    let users = Object.values(db.users).map(normalizeLocalPlayer)
      .filter(u => participatedInMetric(u, currentRankMetric));
    users.sort((a, b) => rankScore(b, currentRankMetric) - rankScore(a, currentRankMetric));
    users = users.slice(0, Math.min(limit, users.length));
    renderRankingRows(users, false);
  }

  // ---------------------------------------------------------------------------
  // VICTIM WALL / revenge loop — "Most Feared" board + "you were defeated" banner
  // ---------------------------------------------------------------------------
  // Render the public Most Feared wall (top active win streaks + recent victims).
  async function renderFeared() {
    const wrap = $('#feared-list');
    if (!wrap) return;
    wrap.innerHTML = `<div class="card muted center">Loading the wall…</div>`;
    let players = [];
    try {
      const data = await api('/api/feared?limit=25');
      players = (data && data.players) || [];
    } catch (e) {
      wrap.innerHTML = `<div class="card muted center">Couldn't load the wall right now. Try again.</div>`;
      return;
    }
    if (!players.length) {
      wrap.innerHTML = `<div class="card muted center">No active win streaks yet — be the first to strike fear. Win a ranked game to start your streak.</div>`;
      return;
    }
    wrap.innerHTML = players.map((p, i) => {
      const rankBadge = i === 0 ? '👑' : (i + 1) + '.';
      const victims = (p.recentVictims || []).map(v => escapeHTML(v.name)).filter(Boolean);
      const victimLine = victims.length
        ? 'Toppled: ' + victims.join(', ')
        : 'No recorded victims yet.';
      return '<div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:10px">' +
        '<div style="font-size:18px;min-width:34px;text-align:center;font-weight:800">' + rankBadge + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;display:flex;align-items:center;gap:6px">' +
            escapeHTML(p.username || 'Player') +
            (p.isPremium ? ' <span title="Premium">⭐</span>' : '') +
          '</div>' +
          '<div class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + victimLine + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-weight:800;color:#fb7185">🔥 ' + (Number(p.currentStreak) || 0) + '</div>' +
          '<div class="muted small">ELO ' + (Number(p.elo) || 0) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // --- SEASON (monthly competitive ladder) ---------------------------------
  // Cache the last fetched public season snapshot so the lobby nudge can show a
  // "season ends in N days" line without an extra request on every lobby render.
  let _seasonCache = null;

  // Pull /api/season once (best-effort) and update the lobby nudge. Called from
  // the lobby render; never throws.
  async function refreshSeasonNudge() {
    const card = $('#lobby-season-nudge');
    if (!card) return;
    // Only pitch the ladder when ranked is enabled (it's a ranked-only loop).
    if (typeof rankedEnabled === 'function' && !rankedEnabled()) { card.style.display = 'none'; return; }
    try {
      const data = await api('/api/season');
      _seasonCache = data || null;
    } catch (e) { /* leave the nudge hidden on failure */ }
    if (!_seasonCache) { card.style.display = 'none'; return; }
    const days = Number(_seasonCache.daysRemaining) || 0;
    const title = $('#lobby-season-title');
    const sub = $('#lobby-season-sub');
    if (title) title.textContent = '🏆 ' + (_seasonCache.name || 'Season') + ' ladder';
    if (sub) sub.textContent = days > 0
      ? `Season ends in ${days} day${days === 1 ? '' : 's'} — climb the ladder.`
      : 'Final day of the season — climb the ladder!';
    card.style.display = '';
  }

  // Render the Season view: name + "ends in N days" banner, your standing, the
  // standings table, and last season's champion if present.
  async function renderSeason() {
    const banner = $('#season-name');
    const countdown = $('#season-countdown');
    const list = $('#season-list');
    if (!list) return;
    list.innerHTML = `<div class="card muted center">Loading the season…</div>`;
    // Fire BOTH requests up front so they run in PARALLEL (was sequential — the
    // standing waited for the leaderboard round-trip to finish first).
    const seasonP = api('/api/season?limit=50');
    const meP = (typeof isServerLoggedIn === 'function' && isServerLoggedIn())
      ? api('/api/season/me').catch(() => null)
      : Promise.resolve(null);
    let data = null;
    try {
      data = await seasonP;
      _seasonCache = data || null;
    } catch (e) {
      list.innerHTML = `<div class="card muted center">Couldn't load the season right now. Try again.</div>`;
      return;
    }
    if (!data) { list.innerHTML = `<div class="card muted center">No season data available.</div>`; return; }
    if (banner) banner.textContent = data.name || 'This season';
    const days = Number(data.daysRemaining) || 0;
    if (countdown) countdown.textContent = days > 0
      ? `⏳ Season ends in ${days} day${days === 1 ? '' : 's'}`
      : '⏳ Final day of the season!';

    // Last season's champion (end-of-season recognition v1).
    const champWrap = $('#season-champion');
    const champLine = $('#season-champion-line');
    if (champWrap && champLine) {
      if (data.lastSeasonChampion && data.lastSeasonChampion.username) {
        const c = data.lastSeasonChampion;
        champLine.innerHTML = escapeHTML(c.username) + (c.premium ? ' <span title="Premium">⭐</span>' : '') +
          ' — ' + (Number(c.points) || 0) + ' pts';
        champWrap.style.display = '';
      } else {
        champWrap.style.display = 'none';
      }
    }

    // The caller's own standing (auth only; silent for guests).
    const meWrap = $('#season-me');
    const meLine = $('#season-me-line');
    if (meWrap && meLine) {
      meWrap.style.display = 'none';
      {
        try {
          const mine = await meP; // already in-flight (parallel with the leaderboard)
          if (mine && (mine.rank || mine.points || mine.wins || mine.losses || mine.draws)) {
            const rankTxt = mine.rank ? '#' + mine.rank : 'unranked';
            meLine.textContent = `${rankTxt} · ${Number(mine.points) || 0} pts · ` +
              `${Number(mine.wins) || 0}-${Number(mine.losses) || 0}-${Number(mine.draws) || 0} (W-L-D)`;
            meWrap.style.display = '';
          } else {
            meLine.textContent = 'Play a ranked game this season to get on the board.';
            meWrap.style.display = '';
          }
        } catch (e) { /* leave hidden */ }
      }
    }

    const players = (data.leaderboard) || [];
    if (!players.length) {
      list.innerHTML = `<div class="card muted center">No ranked games played this season yet — be the first to climb. Win a ranked game (+3 pts) to top the ladder.</div>`;
      return;
    }
    list.innerHTML = players.map((p) => {
      const rankBadge = p.rank === 1 ? '👑' : p.rank + '.';
      return '<div class="card" style="display:flex;align-items:center;gap:12px;margin-bottom:10px">' +
        '<div style="font-size:18px;min-width:34px;text-align:center;font-weight:800">' + rankBadge + '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:700;display:flex;align-items:center;gap:6px">' +
            escapeHTML(p.username || 'Player') +
            (p.premium ? ' <span title="Premium">⭐</span>' : '') +
          '</div>' +
          '<div class="muted small">' + (Number(p.wins) || 0) + '-' + (Number(p.losses) || 0) + '-' + (Number(p.draws) || 0) +
            ' (W-L-D) · ELO ' + (Number(p.elo) || 0) + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-weight:800;color:#facc15">' + (Number(p.points) || 0) + ' pts</div>' +
          '<div class="muted small">peak ' + (Number(p.peakElo) || 0) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Socket `defeated` handler: a streaking winner just beat the local player. Show
  // a tasteful in-app banner with a Rematch/revenge CTA. Tolerant of partial data.
  function handleDefeated(d) {
    try {
      d = d || {};
      const by = (typeof d.by === 'string' && d.by) ? d.by : 'a rival';
      const rank = Number(d.rank || d.streakLen || 0) || 0;
      const line = rank > 0
        ? `You're #${rank} on ${by}'s win streak`
        : `${by} just added you to their win streak`;
      showDefeatedBanner(line, by);
    } catch (e) {}
  }

  // A dismissible, CSP-safe banner (no inline handlers) with a "Rematch?" CTA that
  // routes to ranked matchmaking (the existing challenge flow is friend-only, so a
  // ranked-game CTA is the honest, always-available revenge path).
  function showDefeatedBanner(line, by) {
    try {
      var prev = document.getElementById('ct-defeated-banner');
      if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
      var el = document.createElement('div');
      el.id = 'ct-defeated-banner';
      el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:90;' +
        'max-width:440px;width:calc(100% - 24px);background:rgba(20,26,40,0.97);border:1px solid #fb7185;' +
        'border-radius:14px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,0.5);display:flex;' +
        'align-items:center;gap:12px;backdrop-filter:blur(8px);';
      var text = document.createElement('div');
      text.style.cssText = 'flex:1;min-width:0';
      var t1 = document.createElement('div');
      t1.style.cssText = 'font-weight:700';
      t1.textContent = '🩸 ' + line;
      var t2 = document.createElement('div');
      t2.className = 'muted small';
      t2.textContent = 'Get revenge?';
      text.appendChild(t1); text.appendChild(t2);
      var go = document.createElement('button');
      go.className = 'btn small';
      go.style.cssText = 'padding:8px 14px;white-space:nowrap';
      go.textContent = 'Rematch';
      go.addEventListener('click', function () {
        dismiss();
        // Honest revenge path: queue a ranked game (the streak that beat them is
        // ranked). Falls back to a toast if ranked is off / offline.
        try {
          if (typeof rankedEnabled === 'function' && !rankedEnabled()) { toast('Ranked play is coming soon.'); return; }
          if (typeof openTimeControlPicker === 'function') {
            openTimeControlPicker({}, function () { startOnlineOrFakeMatchmaking('ranked'); });
          } else {
            startOnlineOrFakeMatchmaking('ranked');
          }
        } catch (e) { toast('Find a ranked game to get your revenge.'); }
      });
      var x = document.createElement('button');
      x.className = 'btn btn-secondary small';
      x.style.cssText = 'padding:8px 12px';
      x.setAttribute('aria-label', 'Dismiss');
      x.textContent = '✕';
      x.addEventListener('click', dismiss);
      function dismiss() { if (el && el.parentNode) el.parentNode.removeChild(el); }
      el.appendChild(text); el.appendChild(go); el.appendChild(x);
      document.body.appendChild(el);
      // Auto-dismiss after a while so it never lingers.
      setTimeout(function () { dismiss(); }, 12000);
    } catch (e) {}
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
    // Heavy build (~84 achievement tiers + streak cards = a ~100ms+ synchronous
    // task). Defer past the screen-switch paint so the tab change is INSTANT; the
    // trophy grids fill in one frame later.
    requestAnimationFrame(_renderTrophiesNow);
  }
  function _renderTrophiesNow() {
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
    }
    // Delegated detail click (bound ONCE) — survives the innerHTML rebuild above
    // and avoids binding a listener per trophy card on every render.
    if (sWrap && !sWrap.dataset.boundDetail) {
      sWrap.dataset.boundDetail = '1';
      sWrap.addEventListener('click', (e) => {
        const el = e.target && e.target.closest ? e.target.closest('.trophy[data-trophy-id]') : null;
        if (!el || !state.user) return;
        const t = state.user.streakTrophies.find(x => x.id === el.dataset.trophyId);
        if (t) showTrophyDetail(t);
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
        const cnt = achievementCount(u, t.id);
        const color = tierColor(t.tier);
        const isOops = t.embarrassing;
        const isHidden = t.hidden && !got;
        // Repeatable trophies (streaks, single-game feats) show how many times
        // they've been earned. One-time milestones stay at 1 and show no badge.
        const countBadge = (got && cnt > 1)
          ? ` <span class="pill" title="Earned ${cnt} times" style="background:${color}33;color:${color};font-weight:800">×${cnt}</span>`
          : '';
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
          <div class="name">${displayName} ${pillLabel ? `<span class="pill" style="${pillStyle}">${pillLabel}</span>` : ""}${countBadge}</div>
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
    // Trophy polish (trophy-extras.js): rarity badge + shareable card.
    try {
      if (window.CT_trophyRarity) {
        var _r = window.CT_trophyRarity(trophy.streakNumber);
        var _badge = '<div class="trophy-rarity" style="--rar:' + _r.color + '">' +
          '<span class="trophy-rarity-dot"></span>' + _r.label + ' rarity</div>';
        body.innerHTML = _badge + body.innerHTML +
          '<button class="btn btn-block" id="btn-share-trophy" style="margin-top:12px">Share trophy card</button>';
        var _sb = document.getElementById('btn-share-trophy');
        if (_sb) _sb.addEventListener('click', function () { if (window.CT_shareTrophyCard) window.CT_shareTrophyCard(trophy); });
      }
    } catch (e) { if (window.console) console.warn('trophy polish failed', e); }
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

  // Self-heal premium from Stripe on entry: if the user is logged in (has a
  // token), ask the server to reconcile is_premium against Stripe's LIVE
  // subscription status, then refresh local state + ads. Fixes the "paid but
  // prompted to pay again on next login" case when a webhook was missed/dropped.
  async function syncPremiumFromStripe() {
    try {
      const s = getSession();
      if (!s || !s.token) return;               // guests / offline: nothing to sync
      const r = await api('/api/billing/sync', { method: 'POST', body: JSON.stringify({}) });
      if (!r || typeof r.isPremium !== 'boolean' || !state.user) return;
      // Themed sets are a premium-only perk — enforce on EVERY sync (even when the
      // flag didn't change) so a lapsed/cancelled member loses access (reverts to
      // Classic) rather than keeping a set persisted in localStorage.
      try { if (window.CT_Sets && window.CT_Sets.enforcePremium) window.CT_Sets.enforcePremium(r.isPremium); } catch (e) {}
      if (state.user.isPremium === r.isPremium) return;
      state.user.isPremium = r.isPremium;
      try { const db = loadDB(); if (db.users[state.user.id]) { db.users[state.user.id].isPremium = r.isPremium; saveDB(db); } } catch (e) {}
      try { if (window.CT_Ads) window.CT_Ads.refresh(!!r.isPremium); } catch (e) {}
      if (typeof renderLobby === 'function') renderLobby();
    } catch (e) { /* best-effort self-heal */ }
  }

  function enterApp() {
    // Fresh (re)entry — reset the one-shot auth-expiry guard so a future token
    // expiry can prompt again.
    state._authExpiredHandled = false;
    showNav(true);
    showScreen('lobby');
    // Native AdMob banner: shown for free users, suppressed for premium. No-op on web.
    try { if (window.CT_Ads) window.CT_Ads.refresh(!!(state.user && state.user.isPremium)); } catch (e) {}
    // Enforce the premium-only themed-set gate immediately from cached state
    // (syncPremiumFromStripe re-enforces against Stripe's live status right after).
    try { if (window.CT_Sets && window.CT_Sets.enforcePremium) window.CT_Sets.enforcePremium(!!(state.user && state.user.isPremium)); } catch (e) {}
    // Reconcile premium from Stripe (self-healing; best-effort, async).
    syncPremiumFromStripe();
  }
  // Clear the boot splash marker (ct-boot.js) once we've decided what to show, so
  // the splash hides and normal screen control resumes.
  function doneBoot() {
    try { document.documentElement.classList.remove('ct-has-session'); } catch (e) {}
  }
  async function init() {
    // Privacy-light analytics: one 'land' event per page load (boot). Defensive +
    // optional — ct-analytics.js is a deferred module that may not have loaded yet.
    try { window.CT_Analytics && window.CT_Analytics.track('land'); } catch (e) {}
    // Fetch the server feature flags (rankedEnabled) once, up front. Fire-and-
    // forget: it defaults to FALSE on failure and re-paints the ranked UI itself
    // via applyRankedGate() when it resolves, so it never blocks boot.
    fetchServerConfig();
    // Discover whether Stripe billing is live, and handle a return from Checkout.
    fetchBillingConfig();
    handleBillingReturn();
    // Wire the Daily Challenge / puzzle module (puzzles.js). It's a deferred script
    // that loads AFTER app.js, and init() can run synchronously at readyState
    // 'interactive' (before later deferred scripts execute), so bind initPuzzles to
    // DOMContentLoaded — which fires only after ALL deferred scripts have run.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initPuzzles, { once: true });
    } else if (window.CT_Puzzles) {
      initPuzzles();
    } else {
      // Deferred puzzles.js hasn't executed yet; DOMContentLoaded will be next.
      document.addEventListener('DOMContentLoaded', initPuzzles, { once: true });
    }
    // Web Push: detect support/permission/config once (deferred ct-push.js, like puzzles).
    const initPushSafe = function () {
      try { if (window.CT_Push && window.CT_Push.init) window.CT_Push.init().then(function () { try { updateReminderCard(); } catch (e) {} }).catch(function () {}); } catch (e) {}
    };
    if (document.readyState === 'loading' || !window.CT_Push) document.addEventListener('DOMContentLoaded', initPushSafe, { once: true });
    else initPushSafe();
    const session = getSession();
    const db = loadDB();
    if (session && (session.userId || session.token)) {
      let u = session.userId ? db.users[session.userId] : null;
      if (u) {
        // We have a cached profile: show the app IMMEDIATELY (no network wait, so
        // no sign-in flash), then refresh from the server in the background.
        state.user = u;
        if (window.__connectGameSocket) window.__connectGameSocket();
        enterApp();
        doneBoot();
        if (session.token) {
          fetchMe().then((profile) => {
            // syncRemoteProfile maps the server-authoritative emailVerified onto the
            // merged user AND persists it via saveDB, so the refreshed verified
            // state survives reloads/sessions (this is the root-cause fix for the
            // "verified yesterday, re-prompted today" bug — the stale cached
            // emailVerified:false used to re-prompt every session).
            const fresh = syncRemoteProfile(profile);
            setSession({ userId: fresh.id, token: session.token });
            state.user = fresh;
            // Pull checkers ELO/W-L from the same /api/me payload onto state.user.checkers.
            try { if (window.CT_Checkers_UI) window.CT_Checkers_UI.applyCheckersProfile(profile); } catch (e) {}
            renderLobby();
            // Re-evaluate the verify banner against the TRUE server state. Once the
            // server says verified, this hides it for good (renderLobby already
            // calls it, but call explicitly so the fix is obvious + order-safe).
            updateVerifyBanner();
          }).catch(() => {});
        }
        return;
      }
      if (session.token) {
        // Have a token but no cached profile (e.g. fresh device): the splash is
        // covering the sign-in form, so fetch then enter.
        try {
          const profile = await fetchMe();
          u = syncRemoteProfile(profile);
          setSession({ userId: u.id, token: session.token });
          state.user = u;
          try { if (window.CT_Checkers_UI) window.CT_Checkers_UI.applyCheckersProfile(profile); } catch (e) {}
          if (window.__connectGameSocket) window.__connectGameSocket();
          enterApp();
          doneBoot();
          return;
        } catch (e) {
          // Server unreachable and nothing cached -> fall through to sign-in.
        }
      }
    }
    showScreen('auth');
    doneBoot();
  }

  // Premium modal wiring
  if ($('#btn-premium-buy')) $('#btn-premium-buy').addEventListener('click', () => {
    if (billingCfg.enabled) { startCheckout(); } // redirects to Stripe Checkout
    else { setPremium(true); closeModal('premium'); } // demo fallback until Stripe is configured
  });
  if ($('#btn-premium-cancel-paid')) $('#btn-premium-cancel-paid').addEventListener('click', () => {
    if (billingCfg.enabled) { openBillingPortal(); } // Stripe customer portal (manage/cancel)
    else { setPremium(false); closeModal('premium'); }
  });
  // Settings → Manage Subscription: opens the Stripe customer portal (per-customer
  // session). The static fallback link (#link-billing-portal) covers the rest.
  if ($('#btn-manage-subscription')) $('#btn-manage-subscription').addEventListener('click', () => {
    if (billingCfg.enabled) openBillingPortal();
  });
  // Profile → Enable daily reminders (Web Push opt-in; subscribes via ct-push.js).
  if ($('#btn-enable-reminders')) $('#btn-enable-reminders').addEventListener('click', () => {
    try {
      if (!window.CT_Push || !window.CT_Push.subscribe) { toast('Reminders aren’t available on this device.'); return; }
      Promise.resolve(window.CT_Push.subscribe()).then((ok) => {
        toast(ok === false ? 'Couldn’t enable reminders.' : 'Reminders on — we’ll nudge you about your streak 🔔', ok !== false);
        updateReminderCard();
      }).catch(() => { toast('Couldn’t enable reminders.'); });
    } catch (e) { toast('Couldn’t enable reminders.'); }
  });
  if ($('#btn-premium-close')) $('#btn-premium-close').addEventListener('click', () => closeModal('premium'));

  // Static handlers formerly inline on* attributes in index.html. Removing
  // 'unsafe-inline' from the CSP script-src blocks on* attributes, so we wire
  // them here. Functions defined outside this IIFE (openAvatarEditor, signOut,
  // renderFriendSearchResults) are referenced via window.* inside the handler so
  // they resolve at click time (after the window.* assignments at file end run).
  if ($('#lobby-premium-card')) $('#lobby-premium-card').addEventListener('click', () => openPremium());
  if ($('#btn-open-avatar-editor')) $('#btn-open-avatar-editor').addEventListener('click', () => window.openAvatarEditor && window.openAvatarEditor());
  if ($('#btn-view-profile')) $('#btn-view-profile').addEventListener('click', () => showScreen('profile'));
  if ($('#btn-sign-out')) $('#btn-sign-out').addEventListener('click', () => window.signOut && window.signOut());
  if ($('#toggle-sounds')) $('#toggle-sounds').addEventListener('change', function () { localStorage.setItem('ct_sounds', this.checked); });
  if ($('#friend-search-input')) $('#friend-search-input').addEventListener('input', function () { window.renderFriendSearchResults && window.renderFriendSearchResults(this.value); });

  // Document-level delegation for dynamically-rendered controls that aren't part
  // of a dedicated modal container (e.g. the ad-slot "Remove ads" button which
  // renderAdSlot() injects into the lobby/various screens). Inline onclick was
  // removed for CSP, so dispatch on data-act here.
  document.addEventListener('click', function (e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.getAttribute('data-act');
    if (act === 'open-premium') openPremium();
    else if (act === 'open-daily') openDailyPuzzle();
    else if (act === 'open-season') showScreen('season');
    else if (act === 'open-arena') showScreen('arena');
  });

  // ---------------------------------------------------------------------------
  // Puzzles / Daily Challenge (puzzles.js -> window.CT_Puzzles). app.js only wires
  // it in; the module is self-contained. Everything degrades gracefully if the
  // module failed to load (hidden cards / a toast), never throwing.
  // ---------------------------------------------------------------------------
  function puzzlesAvailable() {
    return !!(window.CT_Puzzles && typeof window.CT_Puzzles.openDaily === 'function');
  }
  function initPuzzles() {
    // Hide the Puzzles nav item + lobby card up front if the module is missing.
    const navItem = $('#nav-puzzles');
    const dailyCard = $('#lobby-daily-card');
    if (!puzzlesAvailable()) {
      if (navItem) navItem.style.display = 'none';
      if (dailyCard) dailyCard.style.display = 'none';
      return;
    }
    if (navItem) navItem.style.display = '';
    try { window.CT_Puzzles.init('#screen-puzzles .screen-body'); } catch (e) { console.warn('CT_Puzzles.init failed', e); }
  }
  function openDailyPuzzle() {
    if (!puzzlesAvailable()) { toast('Puzzles are unavailable right now.'); return; }
    showScreen('puzzles');
    try { window.CT_Puzzles.openDaily(); } catch (e) { console.warn('openDaily failed', e); }
  }
  function openPuzzleTrainer() {
    if (!puzzlesAvailable()) { toast('Puzzles are unavailable right now.'); return; }
    showScreen('puzzles');
    try { if (window.CT_Puzzles.openTrainer) window.CT_Puzzles.openTrainer(); else window.CT_Puzzles.openDaily(); } catch (e) {}
  }

  // Called by puzzles.js when the user solves a puzzle. The DAILY STREAK is now
  // earned here (it used to fire on every finished game). recordDailyPlay() is
  // idempotent per calendar day, so multiple solves in a day only count once.
  window.CT_onPuzzleSolved = function (puzzleId, meta) {
    try {
      try { window.CT_Analytics && window.CT_Analytics.track('puzzle_solve', { puzzleId: puzzleId }); } catch (e) {}
      recordDailyPlay();
      ctCelebrate('normal');
      toast('Puzzle solved 🔥 daily streak updated', true);
      if ($('#screen-lobby') && $('#screen-lobby').classList.contains('active')) renderPlayStreak();
    } catch (e) { console.warn('CT_onPuzzleSolved failed', e); }
  };

  // Expose for academy.js
  window.CT = {
    get state(){ return state; },
    get user(){ return state.user; },
    setUser(u){ state.user = u; },
    $, $$, openModal, closeModal, showScreen, showNav, toast, ctCelebrate,
    loadDB, saveDB, pieceSVG, escapeHTML,
    ACHIEVEMENT_TIERS,
    hasAchievement, achievementCount, unlockAchievement, checkAchievementsFor, tierColor,
    renderLobby, renderProfile, renderBoard,
    openPremium, setPremium, renderAdSlot,
    rankedEnabled, applyRankedGate,
    recordDailyPlay, renderPlayStreak,
    // Pure daily-play-streak helpers, exposed for testing.
    _streak: { todayKey, yesterdayKeyOf, computePlayStreak },
    // Rank-tier helpers + the reveal, exposed for testing.
    _rank: { tiers: CT_TIERS, tierIndex: ctTierIndex, reveal: ctRankUpReveal },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    // Defer one microtask so module-level declarations that live AFTER this IIFE
    // (e.g. STOCK_AVATARS + getAvatarHTML, below) are initialized before init()
    // runs. A synchronous restore that renders the lobby (now incl. returning
    // GUESTS) would otherwise hit a TDZ on STOCK_AVATARS via getAvatarHTML.
    Promise.resolve().then(init);
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

// Push the user's chosen avatar to the server so opponents can see it in-game.
// No-op for guests/offline. Uses window.CT_Auth so it works at global scope.
function ctSyncAvatar(u) {
  try {
    const A = window.CT_Auth;
    if (!A || !A.isServerLoggedIn || !A.isServerLoggedIn() || !u) return;
    A.api('/api/profile/avatar', { method: 'POST', body: JSON.stringify({
      avatarStock: u.avatarStock || 'av_knight',
      avatarDataUrl: u.avatarDataUrl || '',
    }) }).catch(function () {});
  } catch (e) {}
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
  // Store the raw message; we escape at render time (see renderChat) so we never
  // trust escape-at-write and never risk double-escaping.
  const clean = text.trim().substring(0, 500);
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
        <div style="background:${isMe?'#3b425a':'#222b3a'};color:#f0f0f0;border-radius:10px;padding:6px 10px;font-size:13px;word-break:break-word;">${escapeHTML(m.text)}</div>
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
      <button data-act="chat-close" style="background:none;border:none;color:#888;font-size:18px;cursor:pointer;line-height:1;">×</button>
    </div>
    <div id="ct-chat-box" style="flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;"></div>
    <div style="padding:8px;border-top:1px solid #2d3a52;display:flex;gap:6px;">
      <input id="ct-chat-input" type="text" maxlength="500" placeholder="Type a message…" style="flex:1;background:#0d1422;border:1px solid #2d3a52;border-radius:8px;padding:7px 10px;color:#f0f0f0;font-size:13px;outline:none;"
        data-act="chat-input">
      <button data-act="chat-send" style="background:#3b425a;border:none;border-radius:8px;color:#fff;padding:7px 12px;cursor:pointer;font-size:13px;">Send</button>
    </div>
  `;
  // Delegated click + keydown for this overlay (CSP blocks inline on* handlers).
  overlay.addEventListener('click', function (e) {
    const t = e.target.closest('[data-act]');
    if (!t || !overlay.contains(t)) return;
    const act = t.getAttribute('data-act');
    if (act === 'chat-close') overlay.remove();
    else if (act === 'chat-send') window._sendChat && window._sendChat();
  });
  overlay.addEventListener('keydown', function (e) {
    const t = e.target.closest('[data-act="chat-input"]');
    if (t && e.key === 'Enter') window._sendChat && window._sendChat();
  });
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
    `<button data-act="avatar-stock" data-id="${escapeHTML(av.id)}" title="${escapeHTML(av.label)}"
      style="width:52px;height:52px;border-radius:50%;background:${av.bg};border:${(user.avatarStock===av.id&&!user.avatarDataUrl)?'3px solid #6eb5ff':'2px solid #2d3a52'};cursor:pointer;font-size:26px;display:flex;align-items:center;justify-content:center;">${av.emoji}</button>`
  ).join('');
  modal.innerHTML = `
    <div style="background:#141d2b;border-radius:16px;padding:24px;width:340px;max-width:95vw;color:#f0f0f0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;font-size:16px;">Edit Profile Picture</h3>
        <button data-act="avatar-close" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;">×</button>
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
        <input type="file" id="ct-avatar-upload" accept="image/*" style="display:none;" data-act="avatar-upload">
        <button data-act="avatar-choose"
          style="width:100%;padding:9px;background:#1a2438;border:1px dashed #3b425a;border-radius:8px;color:#aaa;cursor:pointer;font-size:13px;">
          📁 Choose Image…
        </button>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px;">
        <button data-act="avatar-clear" style="flex:1;padding:9px;background:#2d1a1a;border:none;border-radius:8px;color:#f0a0a0;cursor:pointer;font-size:13px;">Remove Custom</button>
        <button data-act="avatar-close" style="flex:1;padding:9px;background:#3b425a;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;">Done</button>
      </div>
    </div>
  `;
  // Delegated handler for this modal (CSP blocks inline on* handlers).
  modal.addEventListener('click', function (e) {
    const t = e.target.closest('[data-act]');
    if (!t || !modal.contains(t)) return;
    const act = t.getAttribute('data-act');
    if (act === 'avatar-close') modal.remove();
    else if (act === 'avatar-stock') window._selectStockAvatar && window._selectStockAvatar(t.getAttribute('data-id'));
    else if (act === 'avatar-choose') { const up = document.getElementById('ct-avatar-upload'); if (up) up.click(); }
    else if (act === 'avatar-clear') window._clearCustomAvatar && window._clearCustomAvatar();
  });
  modal.addEventListener('change', function (e) {
    const t = e.target.closest('[data-act="avatar-upload"]');
    if (t) window._handleAvatarUpload && window._handleAvatarUpload(t);
  });
  document.body.appendChild(modal);

  window._selectStockAvatar = function(avId) {
    const db = loadDB();
    db.users[user.id].avatarStock = avId;
    db.users[user.id].avatarDataUrl = null;
    state.user = db.users[user.id];
    saveDB(db);
    ctSyncAvatar(state.user);
    document.getElementById('ct-avatar-preview').innerHTML = getAvatarHTML(state.user, 72);
    { var _la = document.getElementById('lobby-avatar'); if (_la) _la.innerHTML = getAvatarHTML(state.user, 40); }
    // Refresh stock grid borders
    document.querySelectorAll('#ct-avatar-modal button[data-act="avatar-stock"]').forEach(btn => {
      const id = btn.getAttribute('data-id');
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
      ctSyncAvatar(state.user);
      document.getElementById('ct-avatar-preview').innerHTML = getAvatarHTML(state.user, 72);
    { var _la = document.getElementById('lobby-avatar'); if (_la) _la.innerHTML = getAvatarHTML(state.user, 40); }
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
    ctSyncAvatar(state.user);
    document.getElementById('ct-avatar-preview').innerHTML = getAvatarHTML(state.user, 72);
    { var _la = document.getElementById('lobby-avatar'); if (_la) _la.innerHTML = getAvatarHTML(state.user, 40); }
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
    `<label data-act="report-reason-row" style="display:flex;align-items:center;gap:8px;padding:6px;border-radius:6px;cursor:pointer;transition:background 0.15s;">
      <input type="radio" name="ct-report-reason" value="${i}" style="accent-color:#6eb5ff;"> <span style="font-size:13px;">${escapeHTML(r)}</span>
    </label>`
  ).join('');
  modal.innerHTML = `
    <div style="background:#141d2b;border-radius:16px;padding:24px;width:360px;max-width:95vw;color:#f0f0f0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h3 style="margin:0;font-size:15px;">🚩 Report User</h3>
        <button data-act="report-close" style="background:none;border:none;color:#888;font-size:22px;cursor:pointer;">×</button>
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
        <button data-act="report-close" style="flex:1;padding:10px;background:#1a2438;border:1px solid #2d3a52;border-radius:8px;color:#aaa;cursor:pointer;font-size:13px;">Cancel</button>
        <button data-act="report-submit" data-id="${escapeHTML(targetUserId)}" data-username="${escapeHTML(targetUsername||targetUserId)}" style="flex:1;padding:10px;background:#8b2020;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">Submit Report</button>
      </div>
    </div>
  `;
  // Delegated handlers for this modal (CSP blocks inline on* handlers).
  modal.addEventListener('click', function (e) {
    const t = e.target.closest('[data-act]');
    if (!t || !modal.contains(t)) return;
    const act = t.getAttribute('data-act');
    if (act === 'report-close') modal.remove();
    else if (act === 'report-submit') window._submitReport && window._submitReport(t.getAttribute('data-id'), t.getAttribute('data-username'));
  });
  modal.addEventListener('mouseover', function (e) {
    const t = e.target.closest('[data-act="report-reason-row"]');
    if (t && modal.contains(t)) t.style.background = '#1a2438';
  });
  modal.addEventListener('mouseout', function (e) {
    const t = e.target.closest('[data-act="report-reason-row"]');
    if (t && modal.contains(t)) t.style.background = '';
  });
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
    // Logged-in users search the server (server already excludes self + existing friends).
    if (isServerLoggedIn()) {
      serverSearchUsers(query).then(function(users){
        if (!users.length) { wrap.innerHTML = '<div class="muted small" style="padding:8px 2px;">No players found by that username.</div>'; return; }
        wrap.innerHTML = users.map(function(u){
          return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--panel-2);border-radius:10px;margin-bottom:8px;">' +
            (typeof getAvatarHTML === 'function' ? getAvatarHTML(u, 34) : '') +
            '<div style="flex:1;min-width:0;"><div style="font-weight:600;">' + escapeHTML(u.username) + '</div>' +
            '<div class="muted small">ELO ' + (u.elo || 1200) + '</div></div>' +
            '<button class="btn-send-req" data-uname="' + escapeHTML(u.username) + '" style="background:var(--accent);color:#1a1d24;border:none;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer;">Add</button></div>';
        }).join('');
        $$('#friend-search-results .btn-send-req').forEach(function(b){
          b.addEventListener('click', function(){ addFriendAndRefresh(b.dataset.uname); });
        });
      }).catch(function(){ wrap.innerHTML = ''; });
      return;
    }
    // No server session: searching this device's local list is pointless (it only
    // holds your own account), so explain why friend search is unavailable.
    wrap.innerHTML = '<div class="muted small" style="padding:8px 2px;">' + escapeHTML(friendsUnavailableMessage()) + '</div>';
  }
// Why friends can't be used right now, when there's no server session. Friends
// are stored server-side, so a guest or an offline-fallback login can't use them.
function friendsUnavailableMessage() {
    if (state.user && state.user.isGuest) {
      return 'Create a free account to add friends — guests don’t have a saved friends list.';
    }
    return 'You’re signed in offline, so friends aren’t available yet. Reconnect to the internet, then sign out and sign in again.';
  }
function addFriendAndRefresh(username) {
    // Friends live in the server database (shared across devices). A real account
    // adds via the server; guests/offline sessions can't, so say so plainly rather
    // than searching this device's local list (which only ever holds yourself).
    if (isServerLoggedIn()) {
      serverAddFriend(username).then(function(friend){
        toast((friend && friend.requested ? 'Friend request sent to ' : 'Added ') + ((friend && friend.username) || username) + ' \ud83e\udd1d');
        serverFriendsCache = null; // force a fresh pull
        var si = $('#friend-search-input');
        renderFriendSearchResults(si ? si.value : username);
        renderFriendsList();
      }).catch(function(err){
        toast((err && err.status === 404) ? 'No player found with that username.' : ((err && err.message) || 'Could not add friend.'), false);
      });
      return;
    }
    toast(friendsUnavailableMessage(), false);
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
  try { if (window.CT_Ads) window.CT_Ads.hide(); } catch (e) {}
  showScreen('lobby');
  renderLobby();
  showNav(true);
  toast('Signed out.', true);
}
window.signOut = signOut;

  // ============================================================
  // 2v2 TEAM CHESS ("Duo") lives in ct-duo.js (loaded before app.js).
  // Inject the app-side helpers it needs; this publishes window.Duo + window.__duo.
  // ============================================================
  if (window.CT_Duo && typeof window.CT_Duo.install === 'function') {
    window.CT_Duo.install({
      state, loadDB, saveDB, unlockAchievement, showScreen,
      $, squareName, pieceSVG, escapeHTML,
      clockStop, clockSync, clockState,
      ctCelebrate, eloKFactor, fetchMe, syncRemoteProfile,
      Chess: (typeof window !== 'undefined' ? window.Chess : undefined),
    });
  }

})();
