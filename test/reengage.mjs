#!/usr/bin/env node
/*
 * reengage.mjs — unit tests for the PURE re-engagement selector + the env-off
 * no-op of the scheduler tick (audit BLOCKER fix: the re-engagement SENDER).
 *
 * Everything here is DETERMINISTIC: `now` is passed in, thresholds are passed in,
 * there is NO wall-clock and NO RNG (the project already has one timing-flaky
 * wall-clock test — we deliberately don't add another). Covers:
 *   1) streak-at-risk detection (active streak, solved yesterday, not today)
 *   2) inactive d1/d3/d7 bucketing (longest window wins; long-churn cap)
 *   3) reachability (push sub OR verified email; unreachable users skipped)
 *   4) per-user cooldown dedup (no second notify inside the window)
 *   5) channel choice (push when subscribed, else email)
 *   6) the scheduler tick is a safe NO-OP when neither push nor email is set
 *
 * Run: node test/reengage.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[reengage]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function importFrom(file) {
  const url = new URL(`file://${path.join(SERVER_DIR, file).replace(/\\/g, '/')}`);
  return import(url.href);
}

const DAY = 86400000;
// Fixed anchor "now": noon UTC on 2026-06-14 (mid-day so day math is unambiguous).
const NOW = Date.parse('2026-06-14T12:00:00Z');
const dayKeyOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const TODAY = dayKeyOf(NOW);                       // 2026-06-14
const YESTERDAY = dayKeyOf(NOW - DAY);             // 2026-06-13
const TWO_AGO = dayKeyOf(NOW - 2 * DAY);           // 2026-06-12

// A baseline reachable, off-cooldown, recently-active user (NOT a target).
function user(over) {
  return Object.assign({
    id: 'u0',
    email: 'u0@x.test',
    emailVerified: true,
    hasPushSub: true,
    lastSeen: NOW - 60 * 1000,    // active a minute ago -> not inactive
    lastNotifiedAt: 0,            // never notified
    currentStreak: 0,
    streakLastDayKey: '',
  }, over || {});
}

async function main() {
  const { selectReengagementTargets, messageFor, runReengagementTick, reengageEnabled } = await importFrom('reengage.js');

  const pick = (users, thresholds) => selectReengagementTargets({ now: NOW, users, thresholds });
  const reasonFor = (u) => { const r = pick([u]); return r.length ? r[0].reason : null; };

  // --- 1) streak-at-risk -----------------------------------------------------
  assert(reasonFor(user({ currentStreak: 5, streakLastDayKey: YESTERDAY, lastSeen: NOW - 60000 })) === 'streak_at_risk',
    'active streak solved yesterday (not today) -> streak_at_risk');
  // Already solved today -> NOT at risk (and recently active -> nothing).
  assert(reasonFor(user({ currentStreak: 5, streakLastDayKey: TODAY })) === null,
    'streak already extended today -> not a target');
  // Streak last seen 2 days ago -> the streak is already broken, not "at risk".
  assert(reasonFor(user({ currentStreak: 5, streakLastDayKey: TWO_AGO, lastSeen: NOW - 60000 })) === null,
    'streak broken (last solve 2 days ago) is not streak_at_risk');
  // current_streak 0 even if last_day_key is yesterday -> no live streak.
  assert(reasonFor(user({ currentStreak: 0, streakLastDayKey: YESTERDAY, lastSeen: NOW - 60000 })) === null,
    'no live streak (current=0) -> not streak_at_risk');
  log('streak-at-risk detection ✓');

  // --- 2) inactive bucketing (longest window wins; churn cap) ----------------
  assert(reasonFor(user({ lastSeen: NOW - 12 * 60 * 60 * 1000 })) === null, 'idle < 1d -> not a target');
  assert(reasonFor(user({ lastSeen: NOW - 1.5 * DAY })) === 'inactive_d1', 'idle ~1.5d -> inactive_d1');
  assert(reasonFor(user({ lastSeen: NOW - 4 * DAY })) === 'inactive_d3', 'idle ~4d -> inactive_d3 (longest crossed)');
  assert(reasonFor(user({ lastSeen: NOW - 9 * DAY })) === 'inactive_d7', 'idle ~9d -> inactive_d7');
  assert(reasonFor(user({ lastSeen: NOW - 45 * DAY })) === null, 'idle > 30d (churn cap) -> not a target');
  assert(reasonFor(user({ lastSeen: 0 })) === null, 'last_seen 0 (never seen) -> not a target');
  log('inactive d1/d3/d7 bucketing + churn cap ✓');

  // --- streak-at-risk wins over a stale inactivity bucket --------------------
  // (solved yesterday but last_seen also a few days stale -> at-risk takes priority)
  assert(reasonFor(user({ currentStreak: 3, streakLastDayKey: YESTERDAY, lastSeen: NOW - 4 * DAY })) === 'streak_at_risk',
    'streak-at-risk takes priority over an inactive bucket');
  log('streak-at-risk priority over inactivity ✓');

  // --- 3) reachability -------------------------------------------------------
  // No push sub AND no verified email -> unreachable -> skipped even if at risk.
  assert(reasonFor(user({ hasPushSub: false, emailVerified: false, currentStreak: 5, streakLastDayKey: YESTERDAY })) === null,
    'unreachable user (no sub, unverified email) is skipped');
  // Verified email but no sub -> reachable via email.
  assert(reasonFor(user({ hasPushSub: false, emailVerified: true, currentStreak: 5, streakLastDayKey: YESTERDAY })) === 'streak_at_risk',
    'verified-email-only user is reachable');
  // Push sub but unverified email -> reachable via push.
  assert(reasonFor(user({ hasPushSub: true, emailVerified: false, email: '', lastSeen: NOW - 2 * DAY })) === 'inactive_d1',
    'push-sub-only user is reachable');
  log('reachability (push OR verified email) ✓');

  // --- 4) cooldown dedup -----------------------------------------------------
  const atRisk = { currentStreak: 5, streakLastDayKey: YESTERDAY, lastSeen: NOW - 60000 };
  // Notified 1 day ago, cooldown 3 days -> still cooling down -> skipped.
  assert(reasonFor(user(Object.assign({ lastNotifiedAt: NOW - 1 * DAY }, atRisk))) === null,
    'within cooldown window -> not re-notified');
  // Notified 4 days ago, cooldown 3 days -> cooled down -> eligible again.
  assert(reasonFor(user(Object.assign({ lastNotifiedAt: NOW - 4 * DAY }, atRisk))) === 'streak_at_risk',
    'past cooldown window -> eligible again');
  // Custom cooldown override is honored.
  assert(pick([user(Object.assign({ lastNotifiedAt: NOW - 2 * DAY }, atRisk))], { cooldownMs: 1 * DAY }).length === 1,
    'shorter cooldown override makes a 2-day-ago notify eligible');
  log('per-user cooldown dedup ✓');

  // --- 5) channel choice + stable ordering -----------------------------------
  const targets = pick([
    user({ id: 'b', hasPushSub: true, emailVerified: true, currentStreak: 2, streakLastDayKey: YESTERDAY }),
    user({ id: 'a', hasPushSub: false, emailVerified: true, lastSeen: NOW - 2 * DAY }),
  ]);
  assert(targets.length === 2, 'both reachable targets selected');
  assert(targets[0].userId === 'a' && targets[1].userId === 'b', 'targets sorted by id (stable)');
  assert(targets[0].channel === 'email', 'no-sub user -> email channel');
  assert(targets[1].channel === 'push', 'subscribed user -> push channel (preferred)');
  log('channel choice (push preferred, email fallback) + stable order ✓');

  // --- messageFor copy is defined for every reason ---------------------------
  for (const reason of ['streak_at_risk', 'inactive_d1', 'inactive_d3', 'inactive_d7', 'unknown']) {
    const m = messageFor(reason);
    assert(m && typeof m.title === 'string' && m.title && typeof m.body === 'string' && m.body,
      `messageFor(${reason}) returns non-empty title+body`);
  }
  log('messageFor copy present for all reasons (+ default) ✓');

  // --- 6) scheduler tick is a safe NO-OP when env is off ---------------------
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; delete process.env.VAPID_SUBJECT;
  delete process.env.RESEND_API_KEY;
  assert(reengageEnabled() === false, 'reengageEnabled() false when neither push nor email configured');
  const r = await runReengagementTick({ now: NOW });
  assert(r && r.skipped === 'disabled', `tick should report skipped:disabled, got ${JSON.stringify(r)}`);
  assert(r.sent === 0, 'tick sends nothing when disabled');
  log('scheduler tick is a safe no-op (never throws) when env is off ✓');

  // --- empty / garbage input is safe -----------------------------------------
  assert(selectReengagementTargets({}).length === 0, 'no users -> empty');
  assert(selectReengagementTargets({ now: NOW, users: [null, {}, { id: 'x' }] }).length === 0, 'garbage rows -> empty (no throw)');
  log('empty/garbage input handled safely ✓');

  // --- 7) store-backed candidate query + cooldown stamp (real SQLite) --------
  // Proves the listReengagementCandidates / markReengaged SQL is valid and that
  // the rows it returns feed the pure selector end-to-end. Throwaway DB.
  await testStoreLayer();
  log('store helpers (listReengagementCandidates + markReengaged) run on SQLite ✓');

  log('PASS — pure selector (streak-at-risk, inactive thresholds, reachability, cooldown, channel) + env-off no-op all correct');
  return 0;
}

// Exercise the new store helpers against a real (throwaway) SQLite DB to prove
// the SQL is valid on the default backend (same approach as test/push.mjs).
async function testStoreLayer() {
  const dbPath = path.join(os.tmpdir(), `ct-reengage-${process.pid}-${Date.now().toString(36)}.db`);
  process.env.DATABASE_PATH = dbPath;
  const store = await importFrom('store.js');
  const db = await importFrom('db.js');
  try {
    // A reachable user idle ~2 days (verified email) -> a candidate.
    const idle = 'u_idle_' + Math.random().toString(36).slice(2, 8);
    db.createUser({ id: idle, email: `${idle}@unit.local`, username: idle, region: '', pw_hash: 'x' });
    db.db.prepare('UPDATE users SET last_seen = ?, email_verified = 1 WHERE id = ?').run(NOW - 2 * DAY, idle);

    // A user with a LIVE streak (solved yesterday) but recently active -> still a
    // candidate via the streak branch even though not idle.
    const streaker = 'u_streak_' + Math.random().toString(36).slice(2, 8);
    db.createUser({ id: streaker, email: `${streaker}@unit.local`, username: streaker, region: '', pw_hash: 'x' });
    db.db.prepare('UPDATE users SET last_seen = ?, email_verified = 1 WHERE id = ?').run(NOW - 60000, streaker);
    db.db.prepare("INSERT INTO puzzle_streaks (user_id, current_streak, best_streak, last_day_key, total_solved) VALUES (?, 4, 4, ?, 4)").run(streaker, YESTERDAY);

    // A user active 1 minute ago, no streak -> NOT a candidate.
    const fresh = 'u_fresh_' + Math.random().toString(36).slice(2, 8);
    db.createUser({ id: fresh, email: `${fresh}@unit.local`, username: fresh, region: '', pw_hash: 'x' });
    db.db.prepare('UPDATE users SET last_seen = ?, email_verified = 1 WHERE id = ?').run(NOW - 60000, fresh);

    const rows = await store.listReengagementCandidates({ sinceMs: NOW - 30 * DAY, limit: 100 });
    const byId = new Map(rows.map(r => [r.id, r]));
    assert(byId.has(idle), 'idle user is in the candidate scan');
    assert(byId.has(streaker), 'live-streak user is in the candidate scan (streak branch)');
    assert(byId.get(streaker).currentStreak === 4 && byId.get(streaker).streakLastDayKey === YESTERDAY,
      'streak fields joined from puzzle_streaks');
    assert(byId.get(idle).emailVerified === true && byId.get(idle).hasPushSub === false,
      'reachability flags reflect the row');

    // The pure selector over the REAL rows picks both, and stamps cooldown.
    const reengage = await importFrom('reengage.js');
    const targets = reengage.selectReengagementTargets({ now: NOW, users: rows });
    const ids = targets.map(t => t.userId);
    assert(ids.includes(idle) && ids.includes(streaker), 'selector picks the idle + streak users from real rows');
    assert(!ids.includes(fresh), 'recently-active no-streak user is NOT picked');

    // markReengaged stamps the cooldown so a re-scan excludes them next time.
    await store.markReengaged(idle, NOW);
    const after = await store.listReengagementCandidates({ sinceMs: NOW - 30 * DAY, limit: 100 });
    const idleAfter = after.find(r => r.id === idle);
    assert(idleAfter && idleAfter.lastNotifiedAt === NOW, 'markReengaged persisted last_notified_at');
    const targetsAfter = reengage.selectReengagementTargets({ now: NOW, users: after });
    assert(!targetsAfter.map(t => t.userId).includes(idle), 'cooled-down user excluded on the next pass');

    db.db.close();
  } finally {
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}

main().then(c => process.exit(c ?? 0)).catch(e => { console.error('[reengage] FAIL:', e.message); process.exit(1); });
