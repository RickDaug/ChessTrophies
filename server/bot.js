// server/bot.js — server-side chess engine for RANKED bot-backfill + arena bots.
//
// The engine (chess.min.js + ct-ai.js) is loaded head-less; see engine-load.js.
// The alpha-beta search is CPU-bound and used to run on the main event loop, so
// one bot "thinking" blocked EVERY other request and game (measured ~1.5s/move
// stalls even at a single concurrent bot game, scaling linearly with load). It
// now runs in a small pool of worker_threads (bot-worker.js) so the main loop
// stays responsive and multiple bot searches run in parallel across cores.
//
// An in-process engine is still loaded for two reasons: (1) botEngineReady() — a
// synchronous readiness signal game.js consults before offering bot-backfill at
// all, and (2) a last-resort fallback if no worker is available.
//
// botMove(fen, targetElo) -> Promise<{from,to[,promotion]}|null>. NEVER throws.
import os from 'node:os';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { loadEngine, computeMove } from './engine-load.js';

// --- in-process engine: readiness + fallback -------------------------------
const _eng = loadEngine();
if (!_eng.CT_AI) {
  console.error('[bot] chess engine (chess.min.js + ct-ai.js) not found in-process — ' +
    (_eng.diag && _eng.diag.error ? _eng.diag.error : 'ranked bot-backfill disabled'));
}

// Is the server-side engine available at all? game.js gates bot-backfill on this
// (so botMove is only ever called when this is true).
export function botEngineReady() { return !!(_eng.CT_AI && _eng.ChessCtor); }

// --- worker pool -----------------------------------------------------------
const WORKER_URL = new URL('./bot-worker.js', import.meta.url);

// How many CPUs this process can ACTUALLY use. os.cpus() reports the HOST cores,
// which over-counts inside a container (Railway, Docker) and would make us spawn
// compute-bound workers that thrash a small vCPU allocation. Prefer the cgroup
// CPU quota when present; fall back to os.cpus() off-container (dev).
function detectCpuLimit() {
  try { // cgroup v2: "<quota> <period>" or "max <period>"
    const p = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (p.length === 2 && p[0] !== 'max') { const q = +p[0], per = +p[1]; if (q > 0 && per > 0) return Math.max(0.5, q / per); }
  } catch {}
  try { // cgroup v1
    const q = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8'), 10);
    const per = parseInt(fs.readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8'), 10);
    if (q > 0 && per > 0) return Math.max(0.5, q / per);
  } catch {}
  return (os.cpus() || []).length || 2;
}
function defaultPoolSize() {
  const cpus = detectCpuLimit();
  if (cpus <= 1.25) return 1;                              // ~1 vCPU: one worker (still off the main loop)
  return Math.max(1, Math.min(4, Math.floor(cpus) - 1));   // leave a core for the event loop; cap at 4
}
const _envN = parseInt(process.env.BOT_WORKER_THREADS ?? '', 10);   // 0 disables workers (forces in-process)
const POOL_SIZE = Number.isFinite(_envN) && _envN >= 0 ? _envN : defaultPoolSize();
const _envT = parseInt(process.env.BOT_JOB_TIMEOUT_MS ?? '', 10);
const JOB_TIMEOUT_MS = Number.isFinite(_envT) && _envT > 0 ? _envT : 15000; // a worker past this is hung -> recycle
const MAX_QUEUE = 256;            // safety cap; beyond this, compute in-process rather than drop

const pool = [];                  // { worker, ready, engineOk, busy, jobId }
const queue = [];                 // pending jobs { id, fen, targetElo, resolve }
const inflight = new Map();       // id -> { resolve, slot, timer }
let jobSeq = 0;
let _wantWorkers = POOL_SIZE > 0 && botEngineReady();

function spawnWorker() {
  let worker;
  try { worker = new Worker(WORKER_URL); }
  catch (e) { console.error('[bot] failed to spawn worker:', e && e.message); return; }
  const slot = { worker, ready: false, engineOk: false, busy: false, jobId: null };
  worker.on('message', (m) => {
    if (!m) return;
    if (m.type === 'ready') {
      slot.ready = true; slot.engineOk = !!m.ok;
      if (!m.ok) { console.error('[bot] worker engine load failed:', (m.diag && m.diag.error) || '?'); failSlot(slot, false); }
      else pump();
      return;
    }
    if (m.type === 'result') {
      const job = inflight.get(m.id);
      if (job) { inflight.delete(m.id); clearTimeout(job.timer); job.resolve(m.move || null); }
      slot.busy = false; slot.jobId = null;
      pump();
    }
  });
  worker.on('error', (e) => { console.error('[bot] worker error:', e && e.message); failSlot(slot, true); });
  worker.on('exit', () => { failSlot(slot, true); });
  try { worker.unref(); } catch {}  // workers must not keep the process alive on their own
  pool.push(slot);
}

// A worker died / errored / loaded no engine: drop it, fail any in-flight job
// (resolve null — game.js handles "no move" safely), and optionally respawn.
function failSlot(slot, respawn) {
  const idx = pool.indexOf(slot); if (idx !== -1) pool.splice(idx, 1);
  if (slot.jobId != null) {
    const job = inflight.get(slot.jobId);
    if (job) { inflight.delete(slot.jobId); clearTimeout(job.timer); job.resolve(null); }
  }
  try { slot.worker.terminate(); } catch {}
  if (respawn && _wantWorkers) spawnWorker();
}

function onTimeout(job, slot) {
  // The worker accepted the job but hasn't replied within the budget -> recycle.
  inflight.delete(job.id);
  console.error('[bot] worker job timed out — recycling worker');
  job.resolve(null);
  failSlot(slot, true);
}

function pump() {
  for (const slot of pool) {
    if (!queue.length) break;
    if (slot.busy || !slot.ready || !slot.engineOk) continue;
    const job = queue.shift();
    slot.busy = true; slot.jobId = job.id;
    const timer = setTimeout(() => onTimeout(job, slot), JOB_TIMEOUT_MS);
    inflight.set(job.id, { resolve: job.resolve, slot, timer });
    try { slot.worker.postMessage({ type: 'job', id: job.id, fen: job.fen, targetElo: job.targetElo }); }
    catch (e) { clearTimeout(timer); inflight.delete(job.id); slot.busy = false; slot.jobId = null; queue.unshift(job); failSlot(slot, true); }
  }
}

if (_wantWorkers) {
  console.log(`[bot] engine ready — search pool: ${POOL_SIZE} worker(s) (detected ~${detectCpuLimit().toFixed(1)} cpu; override with BOT_WORKER_THREADS)`);
  for (let i = 0; i < POOL_SIZE; i++) spawnWorker();
} else if (botEngineReady()) {
  console.log('[bot] engine ready — workers disabled (BOT_WORKER_THREADS=0): searches run in-process');
}

// The pool can serve now or shortly: there's a slot that's either still warming
// up (not yet ready) or known-good (ready & engineOk).
function poolUsable() { return _wantWorkers && pool.some(s => !s.ready || s.engineOk); }

// Compute the bot's move. Prefers the worker pool (keeps the event loop free);
// falls back to in-process compute only when no worker is available. Never throws.
export async function botMove(fen, targetElo) {
  if (poolUsable()) {
    // Extreme overload: rather than drop the move (which would stall a game),
    // compute in-process this once.
    if (queue.length >= MAX_QUEUE) return computeMove(_eng.CT_AI, _eng.ChessCtor, fen, targetElo);
    return await new Promise((resolve) => { queue.push({ id: ++jobSeq, fen, targetElo, resolve }); pump(); });
  }
  return computeMove(_eng.CT_AI, _eng.ChessCtor, fen, targetElo);
}

// Diagnostic snapshot for /health (?diag=1). Includes the in-process load diag
// plus live pool stats so prod can tell "engine missing" from "workers stuck".
export function botEngineDiag() {
  return {
    ...(_eng.diag || {}),
    inProcess: botEngineReady(),
    workers: {
      configured: POOL_SIZE,
      alive: pool.length,
      ready: pool.filter(s => s.ready && s.engineOk).length,
      queued: queue.length,
      inflight: inflight.size,
    },
  };
}

// Best-effort teardown so the process can exit cleanly (e.g. on SIGTERM/tests).
export async function shutdownBots() {
  _wantWorkers = false;
  const ws = pool.splice(0);
  await Promise.all(ws.map(s => { try { return s.worker.terminate(); } catch { return Promise.resolve(); } }));
}
