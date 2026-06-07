// Redis-backed shared state for 2v2 TEAM games + duo invites (multi-instance).
// Used only when REDIS_URL is set; game.js delegates the 2v2 handlers here in
// that mode. Self-contained (duplicates the few stable pure helpers) so it stays
// decoupled from scale-store.js / game.js.
import { Chess } from 'chess.js';
import crypto from 'crypto';
import { db, getUserById } from './db.js';
import * as store from './store.js';

// Backend-agnostic single-user read: sync SQLite (unchanged) or awaited Postgres
// facade. All callers here are already async.
function readUser(uid) {
  return store.usingPostgres ? store.getUserById(uid) : getUserById(uid);
}

const TK = {
  tqueue: 'ct:tq',
  tgame: (id) => `ct:tg:${id}`,
  tactive: 'ct:tgames:active',
  userTeam: (uid) => `ct:uat:${uid}`,
  invite: (id) => `ct:di:${id}`,
  lockTmm: 'ct:lk:tmm',
  lockTg: (id) => `ct:lk:tg:${id}`,
};
const DUO_INVITE_TTL_MS = 60000;
const userRoom = (uid) => `u:${uid}`;

// ---- pure helpers (duplicated, stable) ----
// One timed control + unlimited (mirrors game.js / app.js) to avoid splitting the queue.
const TC_ALLOWLIST = new Set(['10+0', 'unlimited']);
function normalizeTc(tc) { return (typeof tc === 'string' && TC_ALLOWLIST.has(tc)) ? tc : 'unlimited'; }
function parseTc(tc) { const k = normalizeTc(tc); if (k === 'unlimited') return null; const m = /^(\d+)\+(\d+)$/.exec(k); return m ? { initialMs: Number(m[1]) * 60000, incrementMs: Number(m[2]) * 1000 } : null; }
function makeClock(parsed) { return parsed ? { w: parsed.initialMs, b: parsed.initialMs, incrementMs: parsed.incrementMs, running: 'w', turnStartedAt: Date.now() } : null; }
function clockStartSnap(c, p) { return (c && p) ? { initialMs: p.initialMs, incrementMs: c.incrementMs, w: c.w, b: c.b, running: c.running, serverNow: Date.now() } : null; }
function clockMoveSnap(c) { return { w: c.w, b: c.b, running: c.running, serverNow: Date.now() }; }
function publicUser(u) { return { id: u.id, username: u.username, elo: u.elo, wins: u.wins, losses: u.losses, isPremium: !!u.is_premium }; }
function newGameId() { return 'g_' + crypto.randomBytes(6).toString('hex'); }
function newDuoInviteId() { return 'di_' + crypto.randomBytes(5).toString('hex'); }
function newTeamEntryId() { return 'tq_' + crypto.randomBytes(5).toString('hex'); }
function ratingFor2v2(u) { const v = u && u.elo_2v2; return Number.isFinite(v) ? v : 1200; }
function chessOf(g) { const c = new Chess(); if (g.pgn) { try { c.loadPgn(g.pgn); } catch { /* fresh */ } } return c; }
function colorHasMatingMaterial(chess, color) {
  try { let n = 0, b = 0; for (const row of chess.board()) for (const sq of row) { if (!sq || sq.color !== color) continue; if (sq.type === 'q' || sq.type === 'r' || sq.type === 'p') return true; if (sq.type === 'n') n++; else if (sq.type === 'b') b++; } return n + b >= 2; } catch { return true; }
}
const UNLOCK_LUA = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;
async function withLock(R, key, fn, { ttlMs = 5000, tries = 50, waitMs = 20 } = {}) {
  const token = crypto.randomBytes(8).toString('hex'); let held = false;
  for (let i = 0; i < tries; i++) { if (await R.set(key, token, 'PX', ttlMs, 'NX')) { held = true; break; } await new Promise((r) => setTimeout(r, waitMs)); }
  if (!held) throw new Error('lock timeout: ' + key);
  try { return await fn(); } finally { try { await R.eval(UNLOCK_LUA, 1, key, token); } catch {} }
}

function emitTeam(io, tg, ev, data) { let e = io; for (const u of [...tg.whiteMembers, ...tg.blackMembers]) e = e.to(userRoom(u)); e.emit(ev, data); }
function teamSideOf(tg, uid) { if (tg.whiteByUid[uid] !== undefined) return 'w'; if (tg.blackByUid[uid] !== undefined) return 'b'; return null; }
async function loadTeam(R, id) { const raw = await R.get(TK.tgame(id)); return raw ? JSON.parse(raw) : null; }
export async function isTeamGame(R, id) { return (await R.exists(TK.tgame(id))) === 1; }
async function teamEntryOfUid(R, uid) { const all = await R.hgetall(TK.tqueue); for (const [id, raw] of Object.entries(all)) { const e = JSON.parse(raw); if (e.members.some((m) => m.uid === uid)) return { id, e }; } return null; }

// ---- duo invites ----
export async function duoInvite(io, R, uid, friendId) {
  if (typeof friendId !== 'string' || friendId === uid) return;
  const friend = await readUser(friendId);
  if (!friend) { io.to(userRoom(uid)).emit('duo_err', { error: 'friend not found' }); return; }
  const inviteId = newDuoInviteId();
  await R.set(TK.invite(inviteId), JSON.stringify({ id: inviteId, hostId: uid, guestId: friendId, accepted: false, entryId: null }), 'PX', DUO_INVITE_TTL_MS);
  io.to(userRoom(friendId)).emit('duo_invite_received', { inviteId, from: publicUser(await readUser(uid)) });
  io.to(userRoom(uid)).emit('duo_invite_sent', { inviteId, to: publicUser(friend) });
  const t = setTimeout(async () => { try { const raw = await R.get(TK.invite(inviteId)); if (raw && !JSON.parse(raw).accepted) { await R.del(TK.invite(inviteId)); io.to(userRoom(uid)).to(userRoom(friendId)).emit('duo_invite_expired', { inviteId }); } } catch {} }, DUO_INVITE_TTL_MS);
  if (typeof t.unref === 'function') t.unref();
}
export async function duoAccept(io, R, uid, inviteId) {
  const raw = await R.get(TK.invite(inviteId)); if (!raw) return; const inv = JSON.parse(raw); if (inv.guestId !== uid) return;
  inv.accepted = true; await R.set(TK.invite(inviteId), JSON.stringify(inv), 'PX', DUO_INVITE_TTL_MS);
  io.to(userRoom(inv.hostId)).emit('duo_accepted', { inviteId, partner: publicUser(await readUser(uid)) });
  io.to(userRoom(uid)).emit('duo_ready', { inviteId, partner: publicUser(await readUser(inv.hostId)) });
}
export async function duoDecline(io, R, uid, inviteId) {
  const raw = await R.get(TK.invite(inviteId)); if (!raw) return; const inv = JSON.parse(raw); if (inv.guestId !== uid) return;
  await R.del(TK.invite(inviteId)); io.to(userRoom(inv.hostId)).emit('duo_declined', { inviteId });
}
export async function duoCancel(io, R, uid, inviteId) {
  const raw = await R.get(TK.invite(inviteId)); if (!raw) return; const inv = JSON.parse(raw); if (inv.hostId !== uid) return;
  await R.del(TK.invite(inviteId)); if (inv.entryId) await R.hdel(TK.tqueue, inv.entryId);
  io.to(userRoom(inv.guestId)).emit('duo_cancelled', { inviteId });
}

// ---- team matchmaking ----
export async function joinTeamQueue(io, R, uid, { inviteId, tc }) {
  const user = await readUser(uid); if (!user) return;
  const entryTc = normalizeTc(tc);
  if (await teamEntryOfUid(R, uid)) return;
  if (inviteId) {
    const raw = await R.get(TK.invite(inviteId)); const inv = raw ? JSON.parse(raw) : null;
    if (!inv || !inv.accepted) { io.to(userRoom(uid)).emit('team_mm_err', { error: 'invite not ready' }); return; }
    if (inv.hostId !== uid && inv.guestId !== uid) { io.to(userRoom(uid)).emit('team_mm_err', { error: 'not part of this invite' }); return; }
    // Order-independent + atomic: whoever queues FIRST creates the duo entry, the
    // second joins it. (Across instances the host/guest "queue now" events can
    // arrive in either order, so we can't assume host-first.) The lock serializes
    // the two joins so the entry is created exactly once.
    let full = false;
    await withLock(R, TK.lockTmm, async () => {
      const role = uid === inv.hostId ? 'host' : 'guest';
      const cur = await R.get(TK.invite(inviteId)); const inv2 = cur ? JSON.parse(cur) : inv;
      let entry = inv2.entryId ? JSON.parse((await R.hget(TK.tqueue, inv2.entryId)) || 'null') : null;
      if (!entry) {
        entry = { id: newTeamEntryId(), type: 'duo', inviteId, tc: entryTc, members: [{ uid, elo: ratingFor2v2(user) }], joinedAt: Date.now() };
        await R.hset(TK.tqueue, entry.id, JSON.stringify(entry));
        inv2.entryId = entry.id; await R.set(TK.invite(inviteId), JSON.stringify(inv2), 'PX', DUO_INVITE_TTL_MS);
        io.to(userRoom(uid)).emit('team_mm_queued', { type: 'duo', size: 1, role });
      } else if (!entry.members.some((m) => m.uid === uid)) {
        entry.members.push({ uid, elo: ratingFor2v2(user) });
        await R.hset(TK.tqueue, entry.id, JSON.stringify(entry));
        for (const m of entry.members) io.to(userRoom(m.uid)).emit('team_mm_queued', { type: 'duo', size: 2, role: m.uid === inv.hostId ? 'host' : 'guest' });
        full = entry.members.length === 2;
      }
    });
    if (full) await tryTeamPair(io, R);
    return;
  }
  const entry = { id: newTeamEntryId(), type: 'solo', tc: entryTc, members: [{ uid, elo: ratingFor2v2(user) }], joinedAt: Date.now() };
  await R.hset(TK.tqueue, entry.id, JSON.stringify(entry));
  io.to(userRoom(uid)).emit('team_mm_queued', { type: 'solo', size: 1 });
  await tryTeamPair(io, R);
}
export async function leaveTeamQueue(io, R, uid) {
  const found = await teamEntryOfUid(R, uid); if (!found) return;
  await R.hdel(TK.tqueue, found.id);
  if (found.e.type === 'duo') for (const m of found.e.members) if (m.uid !== uid) io.to(userRoom(m.uid)).emit('team_mm_left', { reason: 'partner_left' });
}
async function tryTeamPair(io, R) {
  let picked = null, matchedTc = 'unlimited';
  await withLock(R, TK.lockTmm, async () => {
    const all = await R.hgetall(TK.tqueue);
    const ready = Object.values(all).map((s) => JSON.parse(s)).filter((e) => e.type !== 'duo' || e.members.length === 2).sort((a, b) => a.joinedAt - b.joinedAt);
    const byTc = new Map();
    for (const e of ready) { const k = normalizeTc(e.tc); if (!byTc.has(k)) byTc.set(k, []); byTc.get(k).push(e); }
    for (const [k, entries] of byTc) {
      const g = []; let t = 0;
      for (const e of entries) { if (t + e.members.length <= 4) { g.push(e); t += e.members.length; if (t === 4) break; } }
      if (t === 4) { picked = g; matchedTc = k; break; }
    }
    if (picked) for (const e of picked) { await R.hdel(TK.tqueue, e.id); if (e.type === 'duo' && e.inviteId) await R.del(TK.invite(e.inviteId)); }
  });
  if (picked) await startTeamGame(io, R, picked, matchedTc);
}
async function startTeamGame(io, R, picked, tc) {
  const duos = picked.filter((e) => e.type === 'duo');
  const solos = picked.filter((e) => e.type === 'solo').flatMap((e) => e.members);
  let teamA, teamB;
  if (duos.length === 2) { teamA = duos[0].members.slice(); teamB = duos[1].members.slice(); }
  else if (duos.length === 1) { teamA = duos[0].members.slice(); teamB = solos.slice(0, 2); }
  else { const s = solos.slice().sort((a, b) => b.elo - a.elo); teamA = [s[0], s[3]]; teamB = [s[1], s[2]]; }
  const aWhite = Math.random() < 0.5;
  const whiteM = aWhite ? teamA : teamB, blackM = aWhite ? teamB : teamA;
  if (Math.random() < 0.5) whiteM.reverse();
  if (Math.random() < 0.5) blackM.reverse();
  const id = newGameId(); const normTc = normalizeTc(tc); const parsed = parseTc(normTc); const clock = makeClock(parsed);
  const whiteMembers = whiteM.map((m) => m.uid), blackMembers = blackM.map((m) => m.uid);
  const whiteByUid = {}, blackByUid = {};
  whiteMembers.forEach((u, i) => { whiteByUid[u] = i; });
  blackMembers.forEach((u, i) => { blackByUid[u] = i; });
  const wU = await Promise.all(whiteMembers.map(readUser)), bU = await Promise.all(blackMembers.map(readUser));
  const tg = {
    id, mode: 'team-ranked', tc: normTc, pgn: '', clock,
    whiteMembers, blackMembers, whiteByUid, blackByUid, turnCount: { w: 0, b: 0 },
    whiteAvgEloBefore: Math.round((ratingFor2v2(wU[0]) + ratingFor2v2(wU[1])) / 2),
    blackAvgEloBefore: Math.round((ratingFor2v2(bU[0]) + ratingFor2v2(bU[1])) / 2),
    started: Date.now(), ended: false,
  };
  await R.set(TK.tgame(id), JSON.stringify(tg));
  await R.sadd(TK.tactive, id);
  for (const u of [...whiteMembers, ...blackMembers]) await R.set(TK.userTeam(u), id);
  const sideUsers = { w: wU, b: bU }, sideMembers = { w: whiteMembers, b: blackMembers };
  for (const side of ['w', 'b']) for (let seat = 0; seat < 2; seat++) {
    io.to(userRoom(sideMembers[side][seat])).emit('team_match_found', {
      gameId: id, mode: 'team-ranked', yourSide: side, yourSeat: seat,
      partner: publicUser(sideUsers[side][1 - seat]), partnerId: sideMembers[side][1 - seat],
      white: { p1: publicUser(wU[0]), p2: publicUser(wU[1]) }, black: { p1: publicUser(bU[0]), p2: publicUser(bU[1]) },
      whiteAvgElo: tg.whiteAvgEloBefore, blackAvgElo: tg.blackAvgEloBefore,
      tc: normTc, clock: clockStartSnap(clock, parsed),
    });
  }
}

// ---- team moves / resign / disconnect / finish ----
export async function handleTeamMove(io, R, socket, uid, gameId, { from, to, promotion }) {
  await withLock(R, TK.lockTg(gameId), async () => {
    const tg = await loadTeam(R, gameId); if (!tg || tg.ended) return;
    const myTeam = teamSideOf(tg, uid); if (!myTeam) return;
    const chess = chessOf(tg);
    if (chess.turn() !== myTeam) { socket.emit('illegal_move', { gameId, reason: 'not your team turn' }); return; }
    if ((myTeam === 'w' ? tg.whiteByUid : tg.blackByUid)[uid] !== tg.turnCount[myTeam] % 2) { socket.emit('illegal_move', { gameId, reason: 'not your seat' }); return; }
    const move = chess.move({ from, to, promotion: promotion || 'q' });
    if (!move) { socket.emit('illegal_move', { gameId, from, to, reason: 'illegal' }); return; }
    tg.turnCount[myTeam] += 1;
    let clockPayload = null;
    if (tg.clock) {
      const c = tg.clock; c[myTeam] -= Date.now() - c.turnStartedAt;
      if (c[myTeam] <= 0) { c[myTeam] = 0; await finishTeamTimeout(io, R, tg, chess, myTeam); return; }
      c[myTeam] += c.incrementMs; c.running = myTeam === 'w' ? 'b' : 'w'; c.turnStartedAt = Date.now();
      clockPayload = clockMoveSnap(c);
    }
    tg.pgn = chess.pgn();
    await R.set(TK.tgame(gameId), JSON.stringify(tg));
    emitTeam(io, tg, 'move_made', { gameId, move, fen: chess.fen(), turnCount: { w: tg.turnCount.w, b: tg.turnCount.b }, nextSeat: tg.turnCount[chess.turn()] % 2, clock: clockPayload });
    if (chess.isGameOver()) await finishTeam(io, R, tg, {}, chess);
  });
}
export async function handleTeamResign(io, R, uid, gameId) {
  await withLock(R, TK.lockTg(gameId), async () => {
    const tg = await loadTeam(R, gameId); if (!tg || tg.ended) return;
    const myTeam = teamSideOf(tg, uid); if (!myTeam) return;
    await finishTeam(io, R, tg, { reason: 'resignation', winnerColor: myTeam === 'w' ? 'b' : 'w' }, chessOf(tg));
  });
}
// 2v2 disconnect = immediate team forfeit (matches single-instance behavior).
export async function onTeamDisconnect(io, R, uid) {
  await leaveTeamQueue(io, R, uid);
  const gameId = await R.get(TK.userTeam(uid)); if (!gameId) return;
  await withLock(R, TK.lockTg(gameId), async () => {
    const tg = await loadTeam(R, gameId); if (!tg || tg.ended) return;
    const myTeam = teamSideOf(tg, uid);
    if (myTeam) await finishTeam(io, R, tg, { reason: 'disconnect', winnerColor: myTeam === 'w' ? 'b' : 'w' }, chessOf(tg));
  });
}
async function finishTeamTimeout(io, R, tg, chess, flagColor) {
  const winnerColor = flagColor === 'w' ? 'b' : 'w';
  await finishTeam(io, R, tg, { reason: 'timeout', winnerColor: colorHasMatingMaterial(chess, winnerColor) ? winnerColor : null }, chess);
}
async function finishTeam(io, R, tg, override, chess) {
  if (tg.ended) return;
  tg.ended = true; await R.set(TK.tgame(tg.id), JSON.stringify(tg));
  let winnerColor = override.winnerColor || null;
  let reason = override.reason || (chess.isCheckmate() ? 'checkmate' : (chess.isDraw() ? 'draw' : (chess.isStalemate() ? 'stalemate' : 'unknown')));
  if (!winnerColor && override.winnerColor === undefined && chess.isCheckmate()) winnerColor = chess.turn() === 'w' ? 'b' : 'w';
  const isDraw = !winnerColor; const Kf = 24;
  const wAvg = tg.whiteAvgEloBefore, bAvg = tg.blackAvgEloBefore;
  const expectedW = 1 / (1 + Math.pow(10, (bAvg - wAvg) / 400));
  const whiteScore = isDraw ? 0.5 : (winnerColor === 'w' ? 1 : 0);
  const wDelta = Math.round(Kf * (whiteScore - expectedW)), bDelta = -wDelta;
  const whiteUids = tg.whiteMembers, blackUids = tg.blackMembers;
  const wWin = isDraw ? 0 : (winnerColor === 'w' ? 1 : 0), wLoss = isDraw ? 0 : (winnerColor === 'w' ? 0 : 1), wDraw = isDraw ? 1 : 0;
  const teamInsertSql = `INSERT INTO team_games (id, white_p1_id, white_p2_id, black_p1_id, black_p2_id, mode, result, winner_color, pgn, white_avg_elo_before, black_avg_elo_before, white_elo_delta, black_elo_delta, created_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const teamInsertParams = [tg.id, whiteUids[0], whiteUids[1], blackUids[0], blackUids[1], tg.mode, reason, winnerColor || null, chess.pgn(), wAvg, bAvg, wDelta, bDelta, tg.started, Date.now()];
  const up2v2 = `UPDATE users SET elo_2v2 = elo_2v2 + ?, wins_2v2 = wins_2v2 + ?, losses_2v2 = losses_2v2 + ?, draws_2v2 = draws_2v2 + ? WHERE id = ?`;
  // Atomic 4 ELO updates + game-record persist, backend-branched (SQLite sync /
  // Postgres async via store.runTransaction).
  if (store.usingPostgres) {
    try {
      await store.runTransaction(async (tx) => {
        for (const u of whiteUids) await tx.run(up2v2, [wDelta, wWin, wLoss, wDraw, u]);
        for (const u of blackUids) await tx.run(up2v2, [bDelta, 1 - wWin - wDraw, 1 - wLoss - wDraw, wDraw, u]);
        await tx.run(teamInsertSql, teamInsertParams);
      });
    } catch (e) { console.error('[scale] team finish pg persist failed', e && e.message); }
  } else {
    try {
      db.transaction(() => {
        const up = db.prepare(up2v2);
        for (const u of whiteUids) up.run(wDelta, wWin, wLoss, wDraw, u);
        for (const u of blackUids) up.run(bDelta, 1 - wWin - wDraw, 1 - wLoss - wDraw, wDraw, u);
        db.prepare(teamInsertSql).run(...teamInsertParams);
      })();
    } catch (e) { console.error('[scale] team finish persist failed', e && e.message); }
  }
  const perPlayerDelta = {};
  for (const u of whiteUids) perPlayerDelta[u] = wDelta;
  for (const u of blackUids) perPlayerDelta[u] = bDelta;
  emitTeam(io, tg, 'game_over', { gameId: tg.id, winnerColor, reason, whiteDelta: wDelta, blackDelta: bDelta, perPlayerDelta, pgn: chess.pgn(), team: true });
  await R.del(TK.tgame(tg.id));
  await R.srem(TK.tactive, tg.id);
  for (const u of [...whiteUids, ...blackUids]) await R.del(TK.userTeam(u));
}

// Team-clock flag-fall sweep (own interval).
export function startSweep(io, R) {
  const timer = setInterval(async () => {
    let ids = [];
    try { ids = await R.smembers(TK.tactive); } catch { return; }
    const now = Date.now();
    for (const id of ids) {
      try {
        await withLock(R, TK.lockTg(id), async () => {
          const tg = await loadTeam(R, id);
          if (!tg) { await R.srem(TK.tactive, id); return; }
          if (tg.ended || !tg.clock) return;
          const remaining = tg.clock[tg.clock.running] - (now - tg.clock.turnStartedAt);
          if (remaining <= 0) { tg.clock[tg.clock.running] = 0; await finishTeamTimeout(io, R, tg, chessOf(tg), tg.clock.running); }
        }, { tries: 3 });
      } catch {}
    }
  }, 1000);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
