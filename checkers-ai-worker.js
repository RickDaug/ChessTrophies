/* checkers-ai-worker.js — runs the ChessTrophies checkers computer-opponent
 * search off the UI thread (mirrors ct-ai-worker.js for chess). Loads the
 * checkers engine + AI, then answers chooseMove requests.
 * Classic dedicated worker (importScripts); same-origin scripts only. */
/* global importScripts, self */
importScripts('checkers.js', 'checkers-ai.js'); // sets self.CT_Checkers, self.CT_CheckersAI

self.onmessage = function (e) {
  var d = e.data || {};
  try {
    var game = self.CT_Checkers.load(d.position);
    var move = self.CT_CheckersAI.chooseMove(game, d.aiElo);
    self.postMessage({ id: d.id, move: move });
  } catch (err) {
    self.postMessage({ id: d.id, move: null, error: String((err && err.message) || err) });
  }
};
