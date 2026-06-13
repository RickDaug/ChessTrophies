// server/bot-worker.js — worker_threads entry for the chess bot search.
//
// The alpha-beta search is synchronous and CPU-bound; running it on the main
// event loop blocked EVERY other request and game while a bot "thought"
// (measured ~1.5s/move stalls even at one concurrent bot game). Running it here,
// off-thread, keeps the main loop responsive.
//
// Protocol: parent posts { type:'job', id, fen, targetElo }; we reply
// { type:'result', id, move|null }. On startup we announce { type:'ready', ok }.
import { parentPort } from 'node:worker_threads';
import { loadEngine, computeMove } from './engine-load.js';

const { CT_AI, ChessCtor, diag } = loadEngine();

// Announce readiness so the parent can route around a worker whose engine didn't
// load (it would otherwise only ever return null and stall games).
parentPort.postMessage({ type: 'ready', ok: !!(CT_AI && ChessCtor), diag });

parentPort.on('message', (msg) => {
  if (!msg || msg.type !== 'job') return;
  const move = computeMove(CT_AI, ChessCtor, msg.fen, msg.targetElo);
  parentPort.postMessage({ type: 'result', id: msg.id, move: move || null });
});
