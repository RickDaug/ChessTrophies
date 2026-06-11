#!/usr/bin/env node
/*
 * theme-sync.mjs — verifies the appearance theme (board/piece) follows the
 * account across devices via /api/progress.
 *
 * Boots the real backend on a throwaway DB, signs up a user ("device 1"), saves
 * a theme, and confirms a second GET ("device 2") returns it; also checks the
 * defaults (walnut/classic) and that a later sync omitting the theme preserves it.
 * Run: node test/theme-sync.mjs. Exit 0 = PASS.
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', 'server');
const log = (...a) => console.log('[theme-sync]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

function freePort() {
  return new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function waitForHealth(url, t = 15000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  fail('health timeout');
}

async function main() {
  const port = await freePort();
  const BASE = `http://localhost:${port}`;
  const dbPath = path.join(os.tmpdir(), `ct-theme-${process.pid}-${port}.db`);
  let proc, err = '';
  try {
    proc = spawn(process.execPath, ['server.js'], { cwd: SERVER_DIR, env: { ...process.env, PORT: String(port), DATABASE_PATH: dbPath, CORS_ORIGIN: '*', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr.on('data', d => { err += d; });
    proc.on('exit', c => { if (c) log('server exited', c, err); });
    await waitForHealth(`${BASE}/health`);
    log('backend healthy');

    const RUN = Date.now().toString(36).slice(-5);
    const signup = await fetch(`${BASE}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `th_${RUN}@theme.local`, username: `Themer_${RUN}`, password: 'passw0rd', region: 'Testland' }),
    });
    assert(signup.ok, `signup failed: ${signup.status}`);
    const { token } = await signup.json();
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const getProg = () => fetch(`${BASE}/api/progress`, { headers: auth }).then(r => r.json());

    // 0) Defaults before any sync: walnut / classic.
    const d0 = await getProg();
    assert(d0.themeBoard === 'walnut' && d0.themePieces === 'classic', `defaults should be walnut/classic, got ${d0.themeBoard}/${d0.themePieces}`);
    log('default: walnut / classic ✓');

    // 1) Device 1 saves a theme.
    const save = await fetch(`${BASE}/api/progress`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ lessonsCompleted: [], puzzles: {}, themeBoard: 'midnight', themePieces: 'ice' }),
    });
    assert(save.ok, `theme save failed: ${save.status}`);

    // 2) Device 2 (fresh GET) sees the saved theme.
    const d2 = await getProg();
    assert(d2.themeBoard === 'midnight' && d2.themePieces === 'ice', `device 2 should see midnight/ice, got ${d2.themeBoard}/${d2.themePieces}`);
    log('cross-device: saved theme returned on a fresh GET ✓');

    // 3) A later sync that OMITS the theme must not wipe it.
    const other = await fetch(`${BASE}/api/progress`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ lessonsCompleted: ['L1'], puzzles: { solved: 1 } }),
    });
    assert(other.ok, `lessons-only sync failed: ${other.status}`);
    const d3 = await getProg();
    assert(d3.themeBoard === 'midnight' && d3.themePieces === 'ice', `theme should survive a sync that omits it, got ${d3.themeBoard}/${d3.themePieces}`);
    assert(d3.lessonsCompleted.includes('L1'), 'lessons still persist alongside the theme');
    log('preserve: a theme-less sync keeps the saved theme ✓');

    // 4) Long/garbage values are bounded (<=32 chars), never throw.
    const big = await fetch(`${BASE}/api/progress`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ lessonsCompleted: [], puzzles: {}, themeBoard: 'x'.repeat(200) }),
    });
    assert(big.ok, `oversized theme should be accepted+truncated, got ${big.status}`);
    const d4 = await getProg();
    assert(d4.themeBoard.length <= 32, `themeBoard should be bounded to 32 chars, got ${d4.themeBoard.length}`);
    log('safety: oversized theme id truncated, not rejected ✓');

    log('PASS — appearance theme syncs across devices via /api/progress');
    return 0;
  } finally {
    try { if (proc) proc.kill(); } catch {}
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { fs.rmSync(f, { force: true }); } catch {} }
  }
}

main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error('[theme-sync] FAIL:', e.message); process.exit(1); });
