#!/usr/bin/env node
/*
 * streak.mjs — pure unit test for the daily PLAY STREAK transition.
 *
 * The streak logic lives in app.js (computePlayStreak / todayKey /
 * yesterdayKeyOf), exposed at runtime on window.CT._streak. app.js can't be
 * loaded standalone in a vm (its IIFE wires the DOM), so this test replicates
 * the SAME small pure logic and asserts the documented behaviour:
 *   first play -> streak 1
 *   same-day replay -> unchanged
 *   next day -> increment
 *   2-day gap -> reset to 1
 *   best is the running max
 *
 * Keep this in lockstep with computePlayStreak in app.js.
 *
 * Run:  node test/streak.mjs   (exit 0 = PASS)
 */
const log = (...a) => console.log('[streak]', ...a);
const assert = (c, m) => { if (!c) { console.error('[streak] FAIL:', m); process.exit(1); } };

// --- pure logic mirrored from app.js -------------------------------------
function todayKey(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function yesterdayKeyOf(key) {
  const parts = String(key).split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() - 1);
  return todayKey(d);
}
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

// helper: the day N days after a YYYY-MM-DD key
function plusDays(key, n) {
  const p = String(key).split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

const D0 = '2026-06-06';
const D1 = plusDays(D0, 1);
const D2 = plusDays(D0, 2);
const D3 = plusDays(D0, 3);

// 1) First play (no prior state) -> streak 1, best 1, lastDate = today.
let s = computePlayStreak(null, D0);
assert(s.streak === 1 && s.best === 1 && s.lastDate === D0, `first play, got ${JSON.stringify(s)}`);
log('1) first play -> streak 1 ✓');

// 2) Same-day replay -> unchanged (idempotent per day).
let s2 = computePlayStreak(s, D0);
assert(s2.streak === 1 && s2.best === 1 && s2.lastDate === D0, `same-day replay should be unchanged, got ${JSON.stringify(s2)}`);
log('2) same-day replay -> unchanged ✓');

// 3) Next day -> increment to 2, best advances.
let s3 = computePlayStreak(s2, D1);
assert(s3.streak === 2 && s3.best === 2 && s3.lastDate === D1, `next day should increment, got ${JSON.stringify(s3)}`);
log('3) next day -> increment ✓');

// 3b) One more consecutive day -> 3.
let s3b = computePlayStreak(s3, D2);
assert(s3b.streak === 3 && s3b.best === 3 && s3b.lastDate === D2, `another consecutive day -> 3, got ${JSON.stringify(s3b)}`);
log('3b) another consecutive day -> 3 ✓');

// 4) A 2-day gap (skip D3, play on D2+2) -> reset to 1, BUT best stays the max.
let s4 = computePlayStreak(s3b, plusDays(D2, 2));
assert(s4.streak === 1, `2-day gap should reset streak to 1, got ${JSON.stringify(s4)}`);
assert(s4.best === 3, `best should remain the running max (3), got ${s4.best}`);
log('4) 2-day gap -> reset to 1, best preserved ✓');

// 5) best is the running max across a fresh higher run.
let r = computePlayStreak(null, D0);          // 1 (best 1)
r = computePlayStreak(r, D1);                  // 2 (best 2)
r = computePlayStreak(r, D2);                  // 3 (best 3)
r = computePlayStreak(r, D3);                  // 4 (best 4)
assert(r.streak === 4 && r.best === 4, `running streak/best, got ${JSON.stringify(r)}`);
// Now break it, then rebuild a shorter run: best must NOT regress.
let broken = computePlayStreak(r, plusDays(D3, 5)); // gap -> streak 1
assert(broken.streak === 1 && broken.best === 4, `after break best must stay 4, got ${JSON.stringify(broken)}`);
log('5) best is the running max (never regresses) ✓');

log('PASS — daily play-streak transition behaves as specified');
process.exit(0);
