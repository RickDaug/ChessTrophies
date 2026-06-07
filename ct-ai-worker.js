/* ct-ai-worker.js — runs the ChessTrophies computer-opponent search off the UI
 * thread. Loads chess.js + the shared engine, then answers chooseMove requests.
 * Classic dedicated worker (importScripts); same-origin scripts only. */
/* global importScripts, self */
// chess960.js provides self.CT_960Castle so the engine can offer real 960
// castling in the worker too (it attaches to window||self — see chess960.js).
importScripts('chess.min.js', 'ct-ai.js', 'chess960.js'); // sets self.Chess, self.CT_AI, self.CT_960Castle

self.onmessage = function (e) {
  var d = e.data || {};
  try {
    var chess = new self.Chess(d.fen);
    var move = self.CT_AI.chooseMove(chess, d.aiElo, d.startFen960);
    self.postMessage({ id: d.id, move: move });
  } catch (err) {
    self.postMessage({ id: d.id, move: null, error: String((err && err.message) || err) });
  }
};
