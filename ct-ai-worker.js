/* ct-ai-worker.js — runs the ChessTrophies computer-opponent search off the UI
 * thread. Loads chess.js + the shared engine, then answers chooseMove requests.
 * Classic dedicated worker (importScripts); same-origin scripts only. */
/* global importScripts, self */
importScripts('chess.min.js', 'ct-ai.js'); // sets self.Chess and self.CT_AI

self.onmessage = function (e) {
  var d = e.data || {};
  try {
    var chess = new self.Chess(d.fen);
    var move = self.CT_AI.chooseMove(chess, d.aiElo);
    self.postMessage({ id: d.id, move: move });
  } catch (err) {
    self.postMessage({ id: d.id, move: null, error: String((err && err.message) || err) });
  }
};
