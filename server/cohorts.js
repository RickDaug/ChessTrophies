// server/cohorts.js — true cohort retention CURVES from a per-user activity log.
//
// Unlike the last_seen proxy (did they stick around >= N days), this computes
// INTERVAL retention: for each weekly signup cohort, the % of the cohort that was
// active in week 0, 1, 2, … after signup. "Active in week k" = the user has at
// least one analytics event (keyed by user_id) on a day that falls k weeks after
// their own signup day. Week 0 is the cohort itself (100% by definition).
//
// Pure + side-effect free (no DB, no clock) so it's unit-testable: pass `now`,
// the cohort users, and the distinct (userId, dayKey) activity pairs.

const DAY = 86400000;
const WEEK = 7 * DAY;

// Midnight-UTC ms for a 'YYYY-MM-DD' string (NaN-safe).
function dayMs(dayKey) { return Date.parse(String(dayKey) + 'T00:00:00Z'); }
function dayKeyOf(ms) { return new Date(ms).toISOString().slice(0, 10); }

/**
 * @param {object} o
 * @param {number} o.now            ms timestamp "now"
 * @param {Array<{id:string, createdAt:number}>} o.users   cohort-eligible users
 * @param {Array<{userId:string, dayKey:string}>} o.events distinct (user, active-day) pairs
 * @param {number} [o.weeks=8]      how many signup-weeks of cohorts to include
 * @returns {{cohorts:Array<{week:string,size:number,curve:number[]}>, maxWeeks:number}}
 *   cohorts oldest→newest; curve[k] = % of the cohort active in week k (curve[0]=100);
 *   each curve only extends as far as the cohort is old enough to have data.
 */
export function retentionCurves(o) {
  o = o || {};
  const now = Number(o.now) || Date.now();
  const weeks = Math.max(1, Math.min(52, Number(o.weeks) || 8));
  const users = Array.isArray(o.users) ? o.users : [];
  const events = Array.isArray(o.events) ? o.events : [];

  // Bucket each user into a signup-week cohort (0 = this week … weeks-1 = oldest).
  const uinfo = new Map();           // userId -> { wi, signupDayMs }
  const cohortUsers = new Map();     // wi -> Set(userId)
  for (const u of users) {
    const ca = Number(u && u.createdAt) || 0;
    if (!ca || !u.id) continue;
    const wi = Math.floor((now - ca) / WEEK);
    if (wi < 0 || wi >= weeks) continue;
    uinfo.set(u.id, { wi, signupDayMs: dayMs(dayKeyOf(ca)) });
    if (!cohortUsers.has(wi)) cohortUsers.set(wi, new Set());
    cohortUsers.get(wi).add(u.id);
  }

  // Per-user set of active week-offsets (weeks since that user's signup).
  const userOffsets = new Map();     // userId -> Set(offset)
  for (const e of events) {
    const info = uinfo.get(e && e.userId);
    if (!info) continue;
    const dms = dayMs(e.dayKey);
    if (isNaN(dms)) continue;
    const off = Math.floor((dms - info.signupDayMs) / WEEK);
    if (off < 0) continue;
    let set = userOffsets.get(e.userId);
    if (!set) { set = new Set(); userOffsets.set(e.userId, set); }
    set.add(off);
  }

  // Build the triangle: older cohorts (higher wi) first; each gets offsets 0..wi.
  const wis = Array.from(cohortUsers.keys()).sort((a, b) => b - a);
  const cohorts = [];
  let maxWeeks = 1;
  for (const wi of wis) {
    const members = cohortUsers.get(wi);
    const size = members.size;
    const span = wi + 1; // offsets 0..wi are reachable for a cohort this old
    if (span > maxWeeks) maxWeeks = span;
    const curve = [];
    for (let k = 0; k < span; k++) {
      if (k === 0) { curve.push(100); continue; } // cohort definition
      let retained = 0;
      for (const uid of members) { const s = userOffsets.get(uid); if (s && s.has(k)) retained++; }
      curve.push(size ? Math.round(retained / size * 100) : 0);
    }
    cohorts.push({ week: dayKeyOf(now - wi * WEEK), size, curve });
  }
  return { cohorts, maxWeeks };
}
