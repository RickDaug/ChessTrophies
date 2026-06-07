#!/usr/bin/env node
/*
 * session.mjs — regression test for the session-storage precedence bug.
 *
 * Guest mode writes a tokenless session to sessionStorage; real sign-in writes a
 * token to localStorage. getSession() must prefer the TOKEN-bearing session so a
 * leftover guest entry can't shadow a real login (which 401'd every authed call:
 * resend verification, verify, friends, online play).
 *
 * Loads ct-auth.js in a vm with storage stubs and asserts getSession/setSession.
 * Run:  node test/session.mjs   (exit 0 = PASS)
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'chesstrophies_session_v1';
const log = (...a) => console.log('[session]', ...a);
const assert = (c, m) => { if (!c) { console.error('[session] FAIL:', m); process.exit(1); } };

function makeStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

const sandbox = {};
sandbox.window = sandbox;
sandbox.location = { origin: 'https://example.com' };
sandbox.window.location = sandbox.location;
sandbox.sessionStorage = makeStore();
sandbox.localStorage = makeStore();
sandbox.console = console;
sandbox.fetch = () => Promise.reject(new Error('no net in test'));
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.AbortController = AbortController;
sandbox.crypto = globalThis.crypto;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'ct-auth.js'), 'utf8'), sandbox);

const A = sandbox.window.CT_Auth;
assert(A && typeof A.getSession === 'function' && typeof A.setSession === 'function', 'CT_Auth.getSession/setSession not exported');

// 1) Guest (sessionStorage, no token) must NOT shadow a real token (localStorage).
sandbox.sessionStorage.setItem(KEY, JSON.stringify({ userId: 'g1', guest: true }));
sandbox.localStorage.setItem(KEY, JSON.stringify({ userId: 'u1', token: 'TOK' }));
let s = A.getSession();
assert(s && s.token === 'TOK' && s.userId === 'u1', `getSession should prefer the token session, got ${JSON.stringify(s)}`);
log('1) token session wins over a tokenless guest shadow ✓');

// 2) setSession() with a token clears the sessionStorage guest entry.
A.setSession({ userId: 'u1', token: 'TOK2' });
assert(sandbox.sessionStorage.getItem(KEY) === null, 'setSession(token) should clear the sessionStorage guest entry');
s = A.getSession();
assert(s && s.token === 'TOK2', `after setSession, getSession should return the new token, got ${JSON.stringify(s)}`);
log('2) real sign-in clears the guest shadow ✓');

// 3) Guest-only (no real token anywhere) still returns the guest session.
sandbox.localStorage.removeItem(KEY);
sandbox.sessionStorage.setItem(KEY, JSON.stringify({ userId: 'g2', guest: true }));
s = A.getSession();
assert(s && s.guest === true && s.userId === 'g2', `guest-only should return the guest session, got ${JSON.stringify(s)}`);
log('3) guest-only session still works ✓');

// 4) setSession(null) clears BOTH stores (sign-out).
A.setSession(null);
assert(sandbox.localStorage.getItem(KEY) === null && sandbox.sessionStorage.getItem(KEY) === null, 'setSession(null) should clear both stores');
assert(A.getSession() === null, 'after sign-out getSession should be null');
log('4) sign-out clears both stores ✓');

log('PASS — session precedence prevents guest shadowing a real token');
process.exit(0);
