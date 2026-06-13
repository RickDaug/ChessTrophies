// FIDE Article 6.9 — timeout (flag-fall) scoring.
//
// When a player's flag falls they LOSE, UNLESS the position is such that the
// winner cannot checkmate the flagged king by ANY possible series of legal moves
// (helpmates included) — then the game is a DRAW. That decision depends on BOTH
// sides' material, not just the winner's:
//   - a lone king can never mate;
//   - a single minor (K+N or K+B) cannot mate a BARE king, but CAN help-mate once
//     the flagged side still has any material (a pawn/piece to box its own king),
//     so e.g. K+B vs K+pawn is a WIN on time, not a draw;
//   - any pawn / rook / queen, or two or more minor pieces, can always (help)mate.
//
// The previous in-game check only inspected the winner's pieces and so wrongly
// drew K+B-vs-K+pawns (audit DOMAIN-M4). This pure module fixes that and is unit
// tested in test/flag-fall.mjs.
//
// `chess` is anything exposing chess.js's board() (8x8 of null | {type,color}).
// winnerColor ('w'|'b') is the side that did NOT flag. Returns true if that side
// can still deliver mate (the flag stands → win), false if it must be a draw.
export function winnerCanMateOnTimeout(chess, winnerColor) {
  try {
    let winMinors = 0;        // winner's knights + bishops
    let winHeavyOrPawn = false; // winner has a pawn, rook, or queen
    let loserHasMaterial = false; // flagged side has anything beyond its king
    for (const row of chess.board()) {
      for (const sq of row) {
        if (!sq) continue;
        if (sq.color === winnerColor) {
          const t = sq.type;
          if (t === 'q' || t === 'r' || t === 'p') winHeavyOrPawn = true;
          else if (t === 'n' || t === 'b') winMinors++;
        } else if (sq.type !== 'k') {
          loserHasMaterial = true;
        }
      }
    }
    if (winHeavyOrPawn) return true;            // pawn/rook/queen -> can mate
    if (winMinors >= 2) return true;            // 2+ minors -> can (help)mate
    if (winMinors === 1) return loserHasMaterial; // single minor: only via helpmate
    return false;                                // lone king -> can never mate
  } catch {
    return true; // on any unexpected error, never WRONGLY downgrade a win to a draw
  }
}
