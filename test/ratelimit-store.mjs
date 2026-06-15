#!/usr/bin/env node
/*
 * ratelimit-store.mjs — unit test for the Redis-backed rate-limit store.
 *
 * Covers:
 *   1) redisStoreOption(null) → {} (no `store`), so server falls back to the
 *      default in-memory MemoryStore when REDIS_URL is unset (unchanged behaviour).
 *   2) redisStoreOption(client) → { store: RedisRateLimitStore } when a client
 *      is provided.
 *   3) increment() counts hits, sets the TTL only on the first hit, and derives a
 *      sane resetTime (against a tiny in-memory fake of the ioredis surface used).
 *   4) GRACEFUL DEGRADATION: when the client throws, increment() FAILS OPEN
 *      (returns a low totalHits and does not throw) so a Redis hiccup can never
 *      500 a request.
 *
 * Pure logic test — no network, no Playwright. Run: node test/ratelimit-store.mjs
 */
import assert from 'node:assert/strict';
import { RedisRateLimitStore, redisStoreOption } from '../server/redis-rate-limit-store.js';

const log = (...a) => console.log('[ratelimit-store]', ...a);

// Minimal in-memory fake of the ioredis methods the store uses.
function makeFakeRedis() {
  const map = new Map();   // key -> count
  const ttl = new Map();   // key -> ms remaining (static for the test)
  const calls = { pexpire: 0, incr: 0 };
  return {
    map, ttl, calls,
    async incr(k) { calls.incr++; const v = (map.get(k) || 0) + 1; map.set(k, v); return v; },
    async pexpire(k, ms) { calls.pexpire++; ttl.set(k, ms); return 1; },
    async pttl(k) { return ttl.has(k) ? ttl.get(k) : -2; },
    async decr(k) { const v = (map.get(k) || 0) - 1; map.set(k, v); return v; },
    async del(k) { map.delete(k); ttl.delete(k); return 1; },
  };
}

// A fake that throws on every call — to exercise the fail-open path.
function makeThrowingRedis() {
  const boom = async () => { throw new Error('redis down'); };
  return { incr: boom, pexpire: boom, pttl: boom, decr: boom, del: boom };
}

async function main() {
  // 1) No client → fall back to MemoryStore (no `store` key).
  const none = redisStoreOption(null, 'rl:x:');
  assert.deepEqual(none, {}, 'redisStoreOption(null) must return {} (MemoryStore fallback)');
  log('ok: redisStoreOption(null) → {} (in-memory fallback)');

  // 2) With a client → returns a RedisRateLimitStore.
  const fake = makeFakeRedis();
  const opt = redisStoreOption(fake, 'rl:auth:');
  assert.ok(opt.store instanceof RedisRateLimitStore, 'expected a RedisRateLimitStore instance');
  log('ok: redisStoreOption(client) → { store: RedisRateLimitStore }');

  // 3) increment() counts + sets TTL once.
  const store = opt.store;
  store.init({ windowMs: 1000 });
  const r1 = await store.increment('1.2.3.4');
  const r2 = await store.increment('1.2.3.4');
  const r3 = await store.increment('1.2.3.4');
  assert.equal(r1.totalHits, 1, 'first hit count');
  assert.equal(r2.totalHits, 2, 'second hit count');
  assert.equal(r3.totalHits, 3, 'third hit count');
  assert.equal(fake.calls.pexpire, 1, 'TTL must be set ONCE (first hit only), not per hit');
  assert.ok(r3.resetTime instanceof Date && r3.resetTime.getTime() > Date.now(), 'resetTime is a future Date');
  // A different key is counted independently and prefixed.
  const other = await store.increment('9.9.9.9');
  assert.equal(other.totalHits, 1, 'distinct key counts separately');
  assert.ok(fake.map.has('rl:auth:1.2.3.4'), 'key must be prefixed in Redis');
  log('ok: increment counts, prefixes keys, sets TTL once, returns future resetTime');

  // decrement + resetKey round-trip.
  await store.decrement('1.2.3.4');
  assert.equal(fake.map.get('rl:auth:1.2.3.4'), 2, 'decrement reduces the counter');
  await store.resetKey('1.2.3.4');
  assert.ok(!fake.map.has('rl:auth:1.2.3.4'), 'resetKey clears the counter');
  log('ok: decrement + resetKey work');

  // 4) FAIL OPEN: a throwing client must not throw out of increment(); it should
  //    return a low totalHits so the request proceeds.
  const bad = new RedisRateLimitStore(makeThrowingRedis(), { prefix: 'rl:auth:' });
  bad.init({ windowMs: 5000 });
  let threw = false, res;
  try { res = await bad.increment('1.2.3.4'); } catch (e) { threw = true; }
  assert.equal(threw, false, 'increment must NOT throw when Redis fails (fail open)');
  assert.equal(res.totalHits, 1, 'fail-open returns a low hit count so the request is allowed');
  assert.ok(res.resetTime instanceof Date, 'fail-open still returns a resetTime');
  // decrement / resetKey must also swallow errors.
  await bad.decrement('1.2.3.4');
  await bad.resetKey('1.2.3.4');
  log('ok: fail-open on Redis error (no throw, request allowed through)');

  log('PASS — all rate-limit store assertions hold');
}

main().then(() => process.exit(0)).catch((e) => { console.error('[ratelimit-store] FAIL:', e); process.exit(1); });
