/* Stockfish bridge — DISABLED by default to keep the project MIT-clean.

   Stockfish.js is GPL v3 (copyleft). Distributing it with your app may require
   you to GPL the whole app. See LICENSES.md for the full discussion.

   The built-in AI in app.js is pure MIT-licensable JavaScript with proper
   piece-square tables, MVV-LVA move ordering, quiescence search, and iterative
   deepening. It plays around 1500-1700 ELO depending on difficulty setting —
   strong enough for most users.

   If you want to enable Stockfish anyway:
     1. Decide on your license strategy (read LICENSES.md, Option A/B/C).
     2. Set ENABLE_STOCKFISH = true below.
     3. Re-add the Stockfish branch in app.js makeAIMove (git history).
*/
(function () {
  'use strict';
  const ENABLE_STOCKFISH = false;

  if (!ENABLE_STOCKFISH) {
    window.StockfishAI = {
      init: () => Promise.reject(new Error('Stockfish disabled')),
      getMove: () => Promise.resolve(null),
      analyze: () => Promise.resolve(null),
      analyzeGame: () => Promise.resolve(null),
      destroy: () => {},
      isReady: () => false,
    };
    return;
  }

  // ... full Stockfish bridge would live here if re-enabled.
})();
