// server/reengage.js — re-engagement target SELECTION (pure) + the scheduler tick.
//
// Audit BLOCKER: push opt-in plumbing (ct-push.js, push.js) and "we'll nudge
// your streak" copy exist, but NOTHING ever pushes an inactive or streak-at-risk
// player — the only player-facing sender was arena-champion/friend events, and
// email.js only sends reset/verify. This module is the missing re-engagement
// SENDER.
//
// The hard, testable part — WHO should be nudged and WHY — is a PURE,
// deterministic function (mirrors server/timeout-rules.js / server/cohorts.js):
// pass `now` in, no wall-clock, no RNG, no DB. The scheduler tick (below) does
// the impure work (read candidates, dispatch push/email, stamp the cooldown) and
// is fully env-gated + failure-isolated so it can never crash the server and
// no-ops when neither push (VAPID) nor email (RESEND_API_KEY) is configured.

const DAY = 86400000;

// Default thresholds (ms). Overridable per call so tests stay deterministic.
export const DEFAULT_THRESHOLDS = {
  // Inactivity windows. A user is a candidate at the LONGEST window they've
  // crossed but not beyond the next one (so a 5-day-idle user is "inactive_d3",
  // not also d1) — one bucket, one reason.
  inactiveD1Ms: 1 * DAY,
  inactiveD3Ms: 3 * DAY,
  inactiveD7Ms: 7 * DAY,
  // Don't keep nagging the long-churned (avoids spamming someone idle for months).
  inactiveMaxMs: 30 * DAY,
  // Per-user cooldown: never notify the same user twice inside this window.
  cooldownMs: 3 * DAY,
};

// Canonical UTC date string (YYYY-MM-DD) for a ms timestamp.
function dayKeyOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
// The UTC day before `dayKey`. Mirrors db.js/db-pg.js previousDayKey.
function previousDayKey(dayKey) {
  const d = new Date(dayKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Can we actually REACH this user? Push sub OR a verified email — otherwise a
// nudge is undeliverable and selecting them is pointless (and would burn their
// cooldown for nothing).
function reachable(u) {
  return !!(u && (u.hasPushSub || (u.emailVerified && u.email)));
}

/**
 * Decide who to re-engage and why — PURE + deterministic (no clock, no I/O).
 *
 * @param {object} o
 * @param {number} o.now  ms "now" (REQUIRED for determinism; falls back to
 *                        Date.now() only if omitted).
 * @param {Array<object>} o.users  candidate rows, each:
 *   { id, email, emailVerified:boolean, hasPushSub:boolean,
 *     lastSeen:number(ms), lastNotifiedAt:number(ms),
 *     currentStreak:number, streakLastDayKey:string }
 * @param {object} [o.thresholds]  overrides for DEFAULT_THRESHOLDS.
 * @returns {Array<{userId, reason, channel}>}  reason is one of
 *   'streak_at_risk' | 'inactive_d7' | 'inactive_d3' | 'inactive_d1'.
 *   channel is 'push' when the user has a sub, else 'email'. Ordered by id for
 *   a stable, testable result.
 */
export function selectReengagementTargets(o) {
  o = o || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const t = Object.assign({}, DEFAULT_THRESHOLDS, o.thresholds || {});
  const users = Array.isArray(o.users) ? o.users : [];

  const today = dayKeyOf(now);
  const yesterday = previousDayKey(today);

  const out = [];
  for (const u of users) {
    if (!u || !u.id) continue;
    if (!reachable(u)) continue;

    // Cooldown: never notify the same user twice inside the window. A 0 / unset
    // lastNotifiedAt means "never notified" and always passes.
    const lastNotified = Number(u.lastNotifiedAt) || 0;
    if (lastNotified && (now - lastNotified) < t.cooldownMs) continue;

    const reason = classify(u, { now, today, yesterday, t });
    if (!reason) continue;

    out.push({ userId: u.id, reason, channel: u.hasPushSub ? 'push' : 'email' });
  }
  out.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  return out;
}

// Decide the single reason (or null) for one already-reachable, off-cooldown
// user. Streak-at-risk is checked FIRST — it's the strongest, most time-sensitive
// retention lever (a live streak about to break), so it wins over a plain
// inactivity bucket.
function classify(u, { now, today, yesterday, t }) {
  // STREAK AT RISK: had an active daily streak, solved YESTERDAY, but NOT yet
  // today. Their streak breaks at the next UTC midnight unless they play.
  const streak = Number(u.currentStreak) || 0;
  const lastDay = String(u.streakLastDayKey || '');
  if (streak >= 1 && lastDay === yesterday && lastDay !== today) {
    return 'streak_at_risk';
  }

  // INACTIVE: last_seen older than a threshold but not beyond the cap (don't
  // nag the long-churned). Pick the LONGEST window crossed -> one bucket.
  const lastSeen = Number(u.lastSeen) || 0;
  if (!lastSeen) return null; // never seen since the column existed -> skip (no signal)
  const idle = now - lastSeen;
  if (idle > t.inactiveMaxMs) return null;
  if (idle >= t.inactiveD7Ms) return 'inactive_d7';
  if (idle >= t.inactiveD3Ms) return 'inactive_d3';
  if (idle >= t.inactiveD1Ms) return 'inactive_d1';
  return null;
}

// Human-facing copy per reason. Pure (no I/O) so it's trivially testable and the
// scheduler/email both share one source of truth. Returns { title, body }.
export function messageFor(reason) {
  switch (reason) {
    case 'streak_at_risk':
      return {
        title: 'Keep your streak alive! 🔥',
        body: "Your daily streak is about to break — solve today's puzzle to keep it going.",
      };
    case 'inactive_d1':
      return {
        title: 'Your board is waiting ♟',
        body: 'A quick game or daily puzzle is one tap away. Come back and play!',
      };
    case 'inactive_d3':
      return {
        title: 'We miss you at the board ♟',
        body: "It's been a few days — jump back in for a game or the daily puzzle.",
      };
    case 'inactive_d7':
    default:
      return {
        title: 'Ready for a comeback? ♟',
        body: 'Your rivals have been busy. Come back, play a game, and climb the board again.',
      };
  }
}

// ---------------------------------------------------------------------------
// Scheduler tick (impure) — env-gated, failure-isolated, single-instance safe.
// ---------------------------------------------------------------------------
//
// Imports are kept lazy/at-top but the tick NEVER throws to its caller. It is a
// no-op (returns { skipped:'disabled' }) when NEITHER push (VAPID) nor email
// (RESEND_API_KEY) is configured, so it costs nothing until a channel is live.

import * as store from './store.js';
import { pushEnabled, sendPushToUser } from './push.js';
import { isEmailConfigured, sendComebackEmail } from './email.js';

// Read live so a deploy can flip env without code changes.
export function reengageEnabled() {
  return pushEnabled() || isEmailConfigured();
}

// How many users to dispatch in one tick (politeness cap; the rest catch the
// next tick). Overridable via env for ops tuning.
function batchLimit() {
  const n = parseInt(process.env.REENGAGE_BATCH_LIMIT || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 200;
}

// Run ONE selection+dispatch pass over the real users. Pure selection is done by
// selectReengagementTargets; this just feeds it DB rows and dispatches + stamps
// the cooldown (last_notified_at). Returns a small summary for logs/tests.
// NEVER throws. `now` is injectable for tests.
export async function runReengagementTick({ now = Date.now(), thresholds } = {}) {
  if (!reengageEnabled()) return { skipped: 'disabled', selected: 0, sent: 0 };

  let rows = [];
  try {
    rows = await store.listReengagementCandidates({
      sinceMs: now - DEFAULT_THRESHOLDS.inactiveMaxMs,
      limit: batchLimit() * 4, // over-fetch; selection + cooldown trims it down
    });
  } catch (e) {
    console.error('[reengage] candidate query failed:', e && e.message ? e.message : e);
    return { skipped: 'query_failed', selected: 0, sent: 0 };
  }

  const targets = selectReengagementTargets({ now, users: rows, thresholds });
  const slice = targets.slice(0, batchLimit());

  let sent = 0, pushed = 0, emailed = 0, failed = 0;
  for (const t of slice) {
    const msg = messageFor(t.reason);
    let delivered = false;
    try {
      if (t.channel === 'push' && pushEnabled()) {
        const r = await sendPushToUser(t.userId, { title: msg.title, body: msg.body, url: '/', tag: 'ct-reengage' });
        delivered = !!(r && r.sent > 0);
        if (delivered) pushed++;
      } else if (isEmailConfigured()) {
        // Need the email address; the candidate row carries it.
        const row = rows.find(u => u.id === t.userId);
        if (row && row.email && row.emailVerified) {
          const ok = await sendComebackEmail(row.email, t.reason);
          delivered = !!ok;
          if (delivered) emailed++;
        }
      }
    } catch (e) {
      console.warn('[reengage] dispatch failed for', t.userId, e && e.message ? e.message : e);
    }
    // Stamp the cooldown only when we actually delivered something, so a transient
    // failure doesn't silently consume the user's cooldown window.
    if (delivered) {
      sent++;
      try { await store.markReengaged(t.userId, now); }
      catch (e) { console.warn('[reengage] markReengaged failed for', t.userId, e && e.message ? e.message : e); }
    } else {
      failed++;
    }
  }
  return { skipped: null, selected: targets.length, dispatched: slice.length, sent, pushed, emailed, failed };
}

// Start the hourly scheduler. Env-gated + failure-isolated like the arena/bot
// schedulers. Under multi-instance (REDIS_URL), a Redis SET NX PX lock makes
// exactly one replica run each tick so we don't double-send (same withLock
// pattern as scale-store.js). `redis` is the shared ioredis client from
// server.js (null in single-instance mode — then no lock is needed). Returns the
// timer (or null when disabled) so it can be stopped/unref'd.
let schedTimer = null;
const TICK_MS = 60 * 60 * 1000; // hourly
const LOCK_KEY = 'ct:lk:reengage';
const UNLOCK_LUA = `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;

export function startReengagementScheduler({ redis = null } = {}) {
  if (!reengageEnabled()) return null;

  const tick = async () => {
    try {
      if (redis) {
        // Acquire a short-lived lock; if another instance holds it, skip THIS tick.
        const token = String(Date.now()) + ':' + Math.random().toString(36).slice(2);
        let held = false;
        try { held = !!(await redis.set(LOCK_KEY, token, 'PX', 5 * 60 * 1000, 'NX')); }
        catch (e) { held = false; }
        if (!held) return; // another replica is running this tick
        try {
          const r = await runReengagementTick({ now: Date.now() });
          if (r && r.sent) console.log('[reengage] tick:', JSON.stringify(r));
        } finally {
          try { await redis.eval(UNLOCK_LUA, 1, LOCK_KEY, token); } catch { /* lock expired */ }
        }
      } else {
        const r = await runReengagementTick({ now: Date.now() });
        if (r && r.sent) console.log('[reengage] tick:', JSON.stringify(r));
      }
    } catch (e) {
      console.error('[reengage] scheduler tick failed', e && e.message ? e.message : e);
    }
  };

  // Defer the first run a bit so boot isn't competing with it, then go hourly.
  schedTimer = setInterval(tick, TICK_MS);
  if (schedTimer.unref) schedTimer.unref();
  const kick = setTimeout(tick, 60 * 1000);
  if (kick.unref) kick.unref();
  return schedTimer;
}

export function stopReengagementScheduler() {
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
}

export function logReengageStatus() {
  const chans = [];
  if (pushEnabled()) chans.push('push');
  if (isEmailConfigured()) chans.push('email');
  if (chans.length) {
    console.log(`[reengage] ENABLED — hourly re-engagement sender via ${chans.join(' + ')} (streak-at-risk + inactive d1/d3/d7, ${DEFAULT_THRESHOLDS.cooldownMs / DAY}-day cooldown).`);
  } else {
    console.warn('[reengage] DISABLED — neither VAPID (push) nor RESEND_API_KEY (email) configured; no re-engagement notifications will be sent.');
  }
}
