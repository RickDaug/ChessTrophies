#!/usr/bin/env node
/*
 * cohorts.mjs — unit test for server/cohorts.js retentionCurves (pure function).
 * Builds synthetic signup cohorts + per-user activity and checks the interval
 * retention triangle (week 0 = 100%, later weeks from events). No DB / no server.
 * Run: node test/cohorts.mjs. Exit 0 = PASS.
 */
import { retentionCurves } from '../server/cohorts.js';

const log = (...a) => console.log('[cohorts]', ...a);
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; log('PASS:', m); } else { failed++; log('FAIL:', m); } };

const DAY = 86400000, WEEK = 7 * DAY;
const dayKeyOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (dk) => Date.parse(dk + 'T00:00:00Z');

const now = Date.UTC(2026, 5, 15, 12, 0, 0);
// Cohort A: 4 users signed up ~3 weeks + 1 day ago (signup-week index 3).
const caA = now - (3 * 7 + 1) * DAY;
const signA = dayMs(dayKeyOf(caA));
const evDay = (signMs, k) => dayKeyOf(signMs + k * WEEK + 2 * DAY); // a day inside week-offset k

const users = [
  { id: 'a1', createdAt: caA }, { id: 'a2', createdAt: caA }, { id: 'a3', createdAt: caA }, { id: 'a4', createdAt: caA },
  { id: 'b1', createdAt: now - DAY }, { id: 'b2', createdAt: now - DAY }, // this-week cohort
  { id: 'old', createdAt: now - 20 * WEEK }, // outside the 8-week window → excluded
];
const events = [
  { userId: 'a1', dayKey: evDay(signA, 1) }, { userId: 'a1', dayKey: evDay(signA, 2) },
  { userId: 'a2', dayKey: evDay(signA, 1) },
  { userId: 'a3', dayKey: evDay(signA, 3) },
  { userId: 'a1', dayKey: evDay(signA, 1) }, // duplicate day → must not double-count
  { userId: 'ghost', dayKey: evDay(signA, 1) }, // unknown user → ignored
];

const out = retentionCurves({ now, users, events, weeks: 8 });

check(out.cohorts.length === 2, `2 cohorts in-window (8-week old excluded), got ${out.cohorts.length}`);
const A = out.cohorts.find(c => c.size === 4);
const B = out.cohorts.find(c => c.size === 2);
check(A && B, 'found the size-4 and size-2 cohorts');
check(A && JSON.stringify(A.curve) === JSON.stringify([100, 50, 25, 25]), `cohort A curve should be [100,50,25,25], got ${A && JSON.stringify(A.curve)}`);
check(B && JSON.stringify(B.curve) === JSON.stringify([100]), `this-week cohort curve should be [100], got ${B && JSON.stringify(B.curve)}`);
check(out.maxWeeks === 4, `maxWeeks should be 4, got ${out.maxWeeks}`);
check(out.cohorts[0].size === 4, 'cohorts are ordered oldest → newest');

// Empty input is safe.
const empty = retentionCurves({ now, users: [], events: [] });
check(empty.cohorts.length === 0 && empty.maxWeeks === 1, 'empty input → no cohorts, maxWeeks 1');

log(`DONE — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
