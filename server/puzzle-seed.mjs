// Verified chess puzzle seed corpus for ChessTrophies.
//
// HOW THIS WAS BUILT (quality over quantity):
//   These puzzles are DERIVED from the 60 python-verified academy lessons in
//   `academy.js` — specifically the tactical / mate families (Checkmate Basics,
//   The Fork, Pins, Skewers & Discovered Attacks, Remove the Guard, Advanced
//   Tactics). Only lessons with a SINGLE unambiguous forcing solution were taken
//   (drills that accept "any of N legal moves" were rejected — they are teaching
//   exercises, not puzzles with one right answer).
//
//   EVERY puzzle's full solution line was re-validated for legality with the
//   bundled chess.js (../chess.min.js) during generation, and is re-validated
//   again by `test/puzzles.mjs` on every CI run. No hand-invented positions —
//   if a line wasn't fully legal it never made it into this file.
//
// FORMAT (mirrors the Lichess puzzle CSV `Moves` convention):
//   - `fen`   : position with the SOLVER to move.
//   - `moves` : UCI tokens for the whole solution line. EVEN indices (0,2,4,…)
//               are the SOLVER's moves; ODD indices (1,3,…) are the scripted
//               opponent replies the UI auto-plays after a correct solver move.
//               A one-token line is a mate-in-1 / single winning move (solved
//               immediately). Promotions append the piece letter, e.g. "g7h8q".
//   - `rating`: difficulty estimate (derived from the lesson's 1–5 difficulty).
//   - `theme` : tactic family tag (mate, fork, pin, discoveredAttack, …).
//
// To SCALE UP beyond this seed, run `node server/import-puzzles.mjs` to import a
// filtered subset of the Lichess CC0 puzzle database into the `puzzles` table;
// the API prefers the DB table and transparently falls back to this seed when the
// table is empty. See that script's header for usage.

export const PUZZLE_SEED = [
  { id: 'ct-CM01', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', moves: ['a1a8'], rating: 940, theme: 'mate', title: 'The Back-Rank Mate (Rook)', hint: "The king's own pawns block its escape — slide the rook to the back rank.", source: 'academy:CM01' },
  { id: 'ct-CM02', fen: '6k1/5ppp/8/8/8/8/8/Q5K1 w - - 0 1', moves: ['a1a8'], rating: 940, theme: 'mate', title: 'The Back-Rank Mate (Queen)', hint: 'Same trap as the rook version — the queen ends it on the eighth rank.', source: 'academy:CM02' },
  { id: 'ct-CM04', fen: '4k3/R7/1R6/8/8/8/8/4K3 w - - 0 1', moves: ['b6b8'], rating: 1180, theme: 'mate', title: 'Two-Rook Ladder Mate', hint: 'One rook seals the seventh rank; bring the other to the eighth for mate.', source: 'academy:CM04' },
  { id: 'ct-CM05', fen: '7k/5K2/8/8/8/8/8/3Q4 w - - 0 1', moves: ['d1h5'], rating: 1180, theme: 'mate', title: 'King and Queen Corner the King', hint: 'Your king already guards the escape squares — the queen just needs to check.', source: 'academy:CM05' },
  { id: 'ct-CM06', fen: '6kr/6P1/6K1/8/8/8/1B6/8 w - - 0 1', moves: ['g7h8q'], rating: 1420, theme: 'mate', title: 'Promote and Mate', hint: 'Capture the rook and promote at the same time — the new queen mates, guarded by your king.', source: 'academy:CM06' },
  { id: 'ct-CM07', fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', moves: ['g5f7'], rating: 1420, theme: 'mate', title: 'Smothered Knight Mate', hint: "The king's own rook and pawns trap it; hop the knight to f7 for mate.", source: 'academy:CM07' },
  { id: 'ct-FK01', fen: 'r3k3/8/4N3/8/8/8/8/4K3 w - - 0 1', moves: ['e6c7', 'e8d7'], rating: 1240, theme: 'fork', title: 'Knight Forks King and Rook', hint: 'Find the L-shape that hits both the king and the rook in one jump.', source: 'academy:FK01' },
  { id: 'ct-FK02', fen: '2q1k3/8/8/5N2/8/8/8/4K3 w - - 0 1', moves: ['f5d6', 'e8d7'], rating: 1480, theme: 'fork', title: 'The Royal Fork', hint: 'A knight check that also attacks the queen wins her — the king must move first.', source: 'academy:FK02' },
  { id: 'ct-FK04', fen: '1k5r/8/8/8/8/8/8/3QK3 w - - 0 1', moves: ['d1d8', 'b8a7'], rating: 1240, theme: 'fork', title: 'Queen Double Attack', hint: 'Find a queen move that gives check and lines up on the rook at the same time.', source: 'academy:FK04' },
  { id: 'ct-FK06', fen: '8/8/8/8/1q6/4N3/8/k5K1 w - - 0 1', moves: ['e3c2', 'a1b1'], rating: 1480, theme: 'fork', title: 'Knight Forks King and Queen on the Rim', hint: 'Jump to a square that checks the cornered king and attacks the queen too.', source: 'academy:FK06' },
  { id: 'ct-PN01', fen: '4k3/4q3/8/8/4R3/8/8/4K3 w - - 0 1', moves: ['e4e7', 'e8e7'], rating: 1240, theme: 'pin', title: 'Take the Pinned Queen', hint: "The queen can't move aside — the king sits right behind it. Just take it.", source: 'academy:PN01' },
  { id: 'ct-PN03', fen: '3rk3/8/3b4/8/3R4/8/8/3RK3 w - - 0 1', moves: ['d4d6'], rating: 1480, theme: 'pin', title: 'Pile On the Pinned Piece', hint: 'The bishop is pinned and now you attack it twice — take it.', source: 'academy:PN03' },
  { id: 'ct-PN04', fen: '4k3/8/8/4b3/3P4/8/8/4R1K1 w - - 0 1', moves: ['d4e5', 'e8e7'], rating: 1240, theme: 'pin', title: 'Win the Pinned Bishop', hint: 'The bishop is pinned against the king, so capture it for free with the pawn.', source: 'academy:PN04' },
  { id: 'ct-SK01', fen: '3qk3/8/8/8/8/8/8/3RK3 w - - 0 1', moves: ['d1d8', 'e8d8'], rating: 1240, theme: 'discoveredAttack', title: 'Skewer the King, Win the Queen', hint: 'A skewer is a reverse pin: check the king and the queen behind it falls.', source: 'academy:SK01' },
  { id: 'ct-SK02', fen: '8/1r6/8/3k4/8/8/2B5/4K3 w - - 0 1', moves: ['c2e4', 'd5d6'], rating: 1480, theme: 'discoveredAttack', title: 'Skewer Along the Diagonal', hint: 'Slide the bishop to give check; the rook on the same diagonal behind the king is the prize.', source: 'academy:SK02' },
  { id: 'ct-SK04', fen: '4k3/8/8/3q4/4N3/8/8/4R1K1 w - - 0 1', moves: ['e4f6', 'e8f8'], rating: 1720, theme: 'discoveredAttack', title: 'Discovered Attack Wins the Queen', hint: 'Move the knight to f6: the rook checks the king while the knight also hits the queen.', source: 'academy:SK04' },
  { id: 'ct-SK05', fen: '4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', moves: ['e4d6', 'e8d8'], rating: 1720, theme: 'discoveredAttack', title: 'Double Check', hint: 'Find the knight jump that checks the king itself while revealing the rook behind it.', source: 'academy:SK05' },
  { id: 'ct-RG01', fen: '6k1/5ppp/8/8/8/8/5n2/R5K1 w - - 0 1', moves: ['g1f2', 'g7g6'], rating: 1240, theme: 'deflection', title: 'Capture the Defender', hint: 'That knight is the only thing guarding the mating square — remove it.', source: 'academy:RG01' },
  { id: 'ct-RG02', fen: 'r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', moves: ['a1a8'], rating: 1180, theme: 'deflection', title: 'Trade Off the Last Defender', hint: 'Swap rooks: once the defender is gone, the back rank is weak.', source: 'academy:RG02' },
  { id: 'ct-RG03', fen: '3qk3/8/5b2/8/7B/8/8/4K3 w - - 0 1', moves: ['h4f6', 'd8d7'], rating: 1480, theme: 'deflection', title: 'Capture the Guard of the Queen', hint: 'Take the piece that protects the queen; next move the queen hangs.', source: 'academy:RG03' },
  { id: 'ct-RG04', fen: '5rk1/5ppp/8/8/8/8/8/1n2R1K1 w - - 0 1', moves: ['e1b1'], rating: 1240, theme: 'deflection', title: 'Remove the Knight That Holds the Fort', hint: 'Capture the knight guarding the back rank; mate threats follow.', source: 'academy:RG04' },
  { id: 'ct-AT01', fen: 'r5k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', moves: ['e1e8', 'a8e8'], rating: 1480, theme: 'advantage', title: 'Deflect the Defender', hint: 'Give a check that the rook is forced to answer, pulling it away from its post.', source: 'academy:AT01' },
  { id: 'ct-AT02', fen: '2r3k1/5p1p/8/1N5Q/8/8/1B6/6K1 w - - 0 1', moves: ['h5f7', 'g8f7'], rating: 1720, theme: 'advantage', title: 'Decoy the King', hint: 'Offer the queen on a square the king is forced to capture, landing it in a knight fork.', source: 'academy:AT02' },
  { id: 'ct-AT03', fen: '3r2k1/3q1ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1', moves: ['d1d7', 'd8d7'], rating: 1720, theme: 'advantage', title: 'Punish the Overloaded Piece', hint: 'The queen guards both the rook and the back rank. Take the rook and overload it.', source: 'academy:AT03' },
  { id: 'ct-AT04', fen: '2r3k1/5ppp/b7/2N5/8/8/5PPP/2R3K1 w - - 0 1', moves: ['c5b7', 'a6b7'], rating: 1720, theme: 'advantage', title: 'Interfere With the Defense', hint: 'Block the diagonal between the bishop and the square it guards by jumping a knight onto it.', source: 'academy:AT04' },
  { id: 'ct-AT05', fen: '4k3/5q2/8/1b6/2N5/8/8/6K1 w - - 0 1', moves: ['c4d6', 'e8d7'], rating: 1720, theme: 'advantage', title: 'The In-Between Move (Zwischenzug)', hint: 'The bishop attacks your knight — but a knight check that also hits the queen comes first.', source: 'academy:AT05' },
  { id: 'ct-AT06', fen: 'k7/8/8/7n/3B4/4P3/5PP1/6K1 w - - 0 1', moves: ['g2g4', 'h5f6'], rating: 1480, theme: 'advantage', title: 'Trap the Knight on the Rim', hint: 'Attack the knight with a pawn; its bishop and pawns already cover every flight square.', source: 'academy:AT06' },
  { id: 'ct-AT07', fen: 'rb4k1/p4ppp/8/8/2N5/8/8/6K1 w - - 0 1', moves: ['c4b6', 'b8d6'], rating: 1480, theme: 'advantage', title: 'Trap the Greedy Rook', hint: "The rook's own pawn blocks the file and its bishop blocks the rank — jump the knight to attack it.", source: 'academy:AT07' },
];

export default PUZZLE_SEED;
