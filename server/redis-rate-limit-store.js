// redis-rate-limit-store.js — a minimal Redis-backed Store for express-rate-limit
// (v7), built on the EXISTING ioredis client (no new npm dependency, so no
// package-lock churn / Railway `npm ci` surprises).
//
// WHY: server.js builds its limiters with no `store:`, so the default
// MemoryStore keys counts per-process. Under horizontal scale (multiple Railway
// replicas, gated on REDIS_URL) the effective auth brute-force ceiling becomes
// N×max — a 20/15min auth cap silently becomes 60/15min across 3 replicas.
// A shared Redis store makes the limit global again.
//
// GRACEFUL DEGRADATION: a Redis hiccup must NEVER 500 a request. Every Redis
// call is wrapped; on error we "fail open" (return a low hit count so the
// request proceeds) rather than throwing. The trade-off is deliberate: a brief
// Redis outage should degrade rate limiting, not take down auth/login.
//
// express-rate-limit v7 Store contract:
//   init(options)            — receives { windowMs, ... }; we read windowMs.
//   increment(key) -> { totalHits, resetTime }   (may be async)
//   decrement(key)           — undo a hit (used by skipFailedRequests etc.)
//   resetKey(key)            — clear one key.
// We implement them on top of INCR + PEXPIRE (set TTL only on first hit so the
// window is fixed from the first request, matching MemoryStore semantics) and
// PTTL to derive resetTime.

export class RedisRateLimitStore {
  /**
   * @param {import('ioredis').Redis} client  an already-connected ioredis client
   * @param {{ prefix?: string }} [opts]
   */
  constructor(client, { prefix = 'rl:' } = {}) {
    this.client = client;
    this.prefix = prefix;
    this.windowMs = 60 * 1000; // overwritten by init()
  }

  // Called by express-rate-limit when the limiter is constructed.
  init(options) {
    if (options && typeof options.windowMs === 'number') this.windowMs = options.windowMs;
  }

  _key(key) { return this.prefix + key; }

  async increment(key) {
    const k = this._key(key);
    try {
      // INCR returns the new counter value. On the FIRST hit (value === 1) set the
      // window TTL; subsequent hits in the window leave the TTL untouched so the
      // window does not slide.
      const totalHits = await this.client.incr(k);
      if (totalHits === 1) {
        // PX = milliseconds; NX is implied by only setting it on first hit.
        await this.client.pexpire(k, this.windowMs);
      }
      // Derive the reset time from the remaining TTL. PTTL returns ms remaining,
      // or -1 (no expiry) / -2 (no key). Fall back to a full window if unknown.
      let ttl = await this.client.pttl(k);
      if (typeof ttl !== 'number' || ttl < 0) ttl = this.windowMs;
      return { totalHits, resetTime: new Date(Date.now() + ttl) };
    } catch (e) {
      // FAIL OPEN: never let a Redis problem 500 the request. Report a single hit
      // (well under any max) so the limiter lets the request through this window.
      // eslint-disable-next-line no-console
      console.error('[ratelimit] redis increment failed (failing open):', e && e.message);
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key) {
    try { await this.client.decr(this._key(key)); }
    catch (e) { console.error('[ratelimit] redis decrement failed:', e && e.message); }
  }

  async resetKey(key) {
    try { await this.client.del(this._key(key)); }
    catch (e) { console.error('[ratelimit] redis resetKey failed:', e && e.message); }
  }
}

// Factory: returns a shared-store config fragment for express-rate-limit when a
// Redis client is provided, or an empty object (-> default MemoryStore) when it
// is not. Keeping the prefix per-limiter avoids auth/api/translate counters
// colliding on the same key space.
export function redisStoreOption(client, prefix) {
  if (!client) return {};
  return { store: new RedisRateLimitStore(client, { prefix }) };
}
