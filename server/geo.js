// server/geo.js — privacy-safe IP → { country, region } lookup.
//
// Uses geoip-lite: an OFFLINE, bundled database (no API key, no network call,
// the IP never leaves this server). We derive ONLY the coarse country (ISO-2,
// e.g. "US") and region (subdivision code, e.g. a US state "CA"), and store just
// those aggregate-friendly strings — the raw IP is NEVER persisted. This keeps
// the analytics layer privacy-light (no PII) while answering "which countries /
// US states is our player base in?".
//
// Fails closed: any error (missing module/DB, bad input) returns empty strings so
// geo can never break event ingest or signup. We require() defensively rather
// than a top-level import so a missing geoip-lite can't crash server boot.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let geoip = null;
try { geoip = require('geoip-lite'); }
catch (e) { console.warn('[geo] geoip-lite unavailable — geo lookups disabled:', e && e.message ? e.message : e); }

// Best client IP behind Railway's single reverse proxy (mirrors analytics.js).
export function clientIpOf(req) {
  try {
    const xff = req && req.headers && req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
    return ((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '').toString();
  } catch (e) { return ''; }
}

// IP string → { country, region }. Strips IPv6-mapped IPv4 prefixes + ports.
export function geoFromIp(ip) {
  try {
    if (!geoip) return { country: '', region: '' };
    let a = String(ip || '').trim();
    if (!a) return { country: '', region: '' };
    if (a.startsWith('::ffff:')) a = a.slice(7);   // IPv4-mapped IPv6
    a = a.split(',')[0].trim();
    const colons = (a.match(/:/g) || []).length;
    if (colons === 1) a = a.split(':')[0];          // strip :port from IPv4:port
    const g = geoip.lookup(a);
    if (!g) return { country: '', region: '' };
    return { country: (g.country || '').slice(0, 2), region: (g.region || '').slice(0, 8) };
  } catch (e) { return { country: '', region: '' }; }
}

// Convenience: derive geo straight from a request.
export function geoFromReq(req) {
  return geoFromIp(clientIpOf(req));
}
