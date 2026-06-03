# -*- coding: utf-8 -*-
"""
verify_puzzles.py -- SOURCE OF TRUTH for ChessTrophies Tactics Trainer puzzles.

Curates the puzzles, VERIFIES every one with python-chess (1.11.2), and on
success EMITS the JS array for window.CT_PUZZLES so puzzles-data.js contains
exactly what passed verification.

  python tools/verify_puzzles.py            verify + print report
  python tools/verify_puzzles.py --emit     verify, then print JS to stdout
  python tools/verify_puzzles.py --write     verify, then overwrite puzzles-data.js

Checks per puzzle:
  - Board valid; side to move matches; NOT in check / checkmate / stalemate at start.
  - Every solution UCI is a legal move.
  - Mate in 1: each listed solution move gives checkmate.
  - Mate in 2: key move is not immediate mate, and for EVERY reply a mate-in-1
    exists (a genuinely forced mate). These are harvested by search, so they are
    correct by construction.
  - Win material: after key move + opponent's best reply + our best recapture we
    are up >= +2 (a minor piece) of material.
"""
import sys
import os
import chess

VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
       chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}


def material(board, color):
    return sum(len(board.pieces(pt, color)) * VAL[pt]
               for pt in (chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN))


def balance(board, color):
    return material(board, color) - material(board, not color)


def is_forced_mate_in_2(board, key_uci):
    """True if key move isn't immediate mate and every reply allows a mate-in-1."""
    b = board.copy()
    mv = chess.Move.from_uci(key_uci)
    if mv not in b.legal_moves:
        return False, "key move illegal"
    b.push(mv)
    if b.is_checkmate():
        return False, "key move is immediate mate (should be mate-in-1)"
    if b.is_stalemate():
        return False, "key move stalemates"
    replies = list(b.legal_moves)
    if not replies:
        return False, "no legal replies but not mate/stalemate"
    for r in replies:
        c = b.copy()
        c.push(r)
        if not any((lambda d: d.is_checkmate())(_push(c, m2)) for m2 in c.legal_moves):
            return False, "defence %s escapes mate" % r.uci()
    return True, "forced mate in 2"


def _push(board, move):
    d = board.copy()
    d.push(move)
    return d


def win_material_ok(board, key_uci, need=2):
    """Opponent picks the reply minimizing our eventual balance; we pick the
    recapture maximizing it. Net gain over the start must be >= need."""
    mover = board.turn
    start = balance(board, mover)
    b = board.copy()
    mv = chess.Move.from_uci(key_uci)
    if mv not in b.legal_moves:
        return False, "key move illegal", 0
    b.push(mv)
    if b.is_checkmate():
        return True, "mate (counts as winning)", 99
    replies = list(b.legal_moves)
    if not replies:
        return False, "stalemates opponent", 0
    worst = None
    for r in replies:
        c = _push(b, r)
        best_after = balance(c, mover)
        for m2 in c.legal_moves:
            best_after = max(best_after, balance(_push(c, m2), mover))
        worst = best_after if worst is None else min(worst, best_after)
    gain = worst - start
    return gain >= need, "net material gain %+d (need >=%d)" % (gain, need), gain


# ---------------------------------------------------------------------------
# CURATED PUZZLES (hand-built; verified below). Mate-in-2 set is harvested by
# search in harvest_mate_in_2() and appended at runtime.
# ---------------------------------------------------------------------------
PUZZLES = [
    # ===================== MATE IN 1 =====================
    {"name": "Back-Rank Finish", "theme": "Back-rank",
     "fen": "6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1", "solution": ["d1d8"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "easy", "rating": 900},
    {"name": "The Queen Comes Home", "theme": "Back-rank",
     "fen": "6k1/5ppp/8/8/8/8/8/3Q2K1 w - - 0 1", "solution": ["d1d8"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "easy", "rating": 1000},
    {"name": "Black Strikes the Back Rank", "theme": "Back-rank",
     "fen": "3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1", "solution": ["d8d1"],
     "sideToMove": "black", "objective": "Mate in 1", "difficulty": "easy", "rating": 1000},
    {"name": "Smothered Mate", "theme": "Smothered",
     "fen": "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", "solution": ["g5f7"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "medium", "rating": 1300},
    {"name": "The Arabian Mate", "theme": "Arabian",
     "fen": "7k/8/5N2/8/8/8/8/6RK w - - 0 1", "solution": ["g1g8"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "medium", "rating": 1300},
    {"name": "Anastasia's Mate", "theme": "Anastasia",
     "fen": "8/4N1pk/8/8/8/6K1/8/R7 w - - 0 1", "solution": ["a1h1"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "hard", "rating": 1500},
    {"name": "Queen & King Box", "theme": "Queen + King",
     "fen": "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1", "solution": ["f7f8"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "easy", "rating": 1100},
    {"name": "The Two-Rook Ladder", "theme": "Ladder",
     "fen": "6k1/R7/1R6/8/8/8/8/6K1 w - - 0 1", "solution": ["b6b8"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "easy", "rating": 1000},
    {"name": "Bishop-Backed Queen", "theme": "Support mate",
     "fen": "6k1/8/8/8/8/2Q5/1B6/7K w - - 0 1", "solution": ["c3g7"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "medium", "rating": 1300},
    {"name": "Knight-Backed Queen", "theme": "Support mate",
     "fen": "7k/8/8/7N/8/6Q1/8/K7 w - - 0 1", "solution": ["g3g7"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "medium", "rating": 1300},
    {"name": "The Rook Box", "theme": "King + Rook",
     "fen": "7k/8/6K1/8/8/8/8/3R4 w - - 0 1", "solution": ["d1d8"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "easy", "rating": 900},
    {"name": "Promote and Mate", "theme": "Promotion",
     "fen": "6k1/4Pppp/8/8/8/8/8/6K1 w - - 0 1", "solution": ["e7e8q"],
     "sideToMove": "white", "objective": "Mate in 1", "difficulty": "medium", "rating": 1400},

    # ===================== WIN MATERIAL =====================
    {"name": "The Royal Fork", "theme": "Knight fork",
     "fen": "2q1k3/pp6/8/5N2/8/8/8/6K1 w - - 0 1", "solution": ["f5d6"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "medium", "rating": 1300},
    {"name": "Knight Forks King & Rook", "theme": "Knight fork",
     "fen": "r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1", "solution": ["d5c7"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "medium", "rating": 1200},
    {"name": "Check and Grab the Queen", "theme": "Knight fork",
     "fen": "8/8/8/4k3/5N2/8/1q6/6K1 w - - 0 1", "solution": ["f4d3"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "medium", "rating": 1300},
    {"name": "The Pawn Fork", "theme": "Pawn fork",
     "fen": "4k3/8/2n1n3/8/3P4/8/8/6K1 w - - 0 1", "solution": ["d4d5"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "easy", "rating": 1000},
    {"name": "Queen's Double Attack", "theme": "Double attack",
     "fen": "r5k1/8/8/8/8/8/8/3Q2K1 w - - 0 1", "solution": ["d1d5"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "medium", "rating": 1300},
    {"name": "Skewer the King", "theme": "Skewer",
     "fen": "4q3/8/8/4k3/8/8/6K1/7R w - - 0 1", "solution": ["h1e1"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "medium", "rating": 1300},
    {"name": "Skewer Along the Rank", "theme": "Skewer",
     "fen": "8/8/8/4k2q/8/8/8/R5K1 w - - 0 1", "solution": ["a1a5"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "medium", "rating": 1300},
    {"name": "The Bishop Skewer", "theme": "Skewer",
     "fen": "8/1q6/8/8/4k3/8/6K1/3B4 w - - 0 1", "solution": ["d1f3"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "hard", "rating": 1500},
    {"name": "Win the Pinned Queen", "theme": "Pin",
     "fen": "4k3/4q3/8/5N2/8/8/8/4R2K w - - 0 1", "solution": ["f5e7"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "medium", "rating": 1400},
    {"name": "Discovered Check Wins the Queen", "theme": "Discovered attack",
     "fen": "7k/8/2q5/4N3/8/8/1B6/6K1 w - - 0 1", "solution": ["e5c6"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "hard", "rating": 1500},
    {"name": "Double Check, Then Fork", "theme": "Double check",
     "fen": "4k3/1q6/8/8/4N3/8/8/4R1K1 w - - 0 1", "solution": ["e4d6"],
     "sideToMove": "white", "objective": "Win material", "difficulty": "hard", "rating": 1600},
]


# ---------------------------------------------------------------------------
# Harvest genuinely-forced mate-in-2 positions by search (King+Queen vs King).
# Deterministic iteration -> reproducible output, correct by construction.
# ---------------------------------------------------------------------------
def _board_from(pieces, turn):
    b = chess.Board.empty()
    for sq, pc in pieces.items():
        b.set_piece_at(sq, pc)
    b.turn = turn
    return b


def _find_m2_key(board):
    for m in board.legal_moves:
        ok, _ = is_forced_mate_in_2(board, m.uci())
        if ok:
            return m.uci()
    return None


def harvest_mate_in_2(limit):
    found = []
    bk_squares = [chess.A8, chess.H8, chess.A1, chess.H1,
                  chess.A5, chess.H4, chess.D8, chess.E1]
    wK = chess.Piece(chess.KING, chess.WHITE)
    bK = chess.Piece(chess.KING, chess.BLACK)
    wQ = chess.Piece(chess.QUEEN, chess.WHITE)
    for bk in bk_squares:
        if len(found) >= limit:
            break
        hit = False
        for wk in range(64):
            if hit:
                break
            if chess.square_distance(wk, bk) <= 1:
                continue
            for wq in range(64):
                if wq == wk or wq == bk or wk == bk:
                    continue
                board = _board_from({bk: bK, wk: wK, wq: wQ}, chess.WHITE)
                if not board.is_valid() or board.is_check() \
                        or board.is_checkmate() or board.is_stalemate():
                    continue
                key = _find_m2_key(board)
                if key:
                    found.append({
                        "name": "Queen's Mating Net %d" % (len(found) + 1),
                        "theme": "Mating net",
                        "fen": board.fen(), "solution": [key], "sideToMove": "white",
                        "objective": "Mate in 2",
                        "difficulty": "medium" if len(found) % 2 == 0 else "hard",
                        "rating": 1400 if len(found) % 2 == 0 else 1600,
                    })
                    hit = True
                    break
    return found


# ---------------------------------------------------------------------------
def verify_all(puzzles):
    results = []
    all_pass = True
    for p in puzzles:
        ok, msgs = True, []
        try:
            board = chess.Board(p["fen"])
        except Exception as e:
            results.append((p["id"], False, "FEN parse error: %s" % e))
            all_pass = False
            continue
        if not board.is_valid():
            ok = False; msgs.append("board not valid")
        want = chess.WHITE if p["sideToMove"] == "white" else chess.BLACK
        if board.turn != want:
            ok = False; msgs.append("side to move mismatch")
        if board.is_check():
            ok = False; msgs.append("starts in check")
        if board.is_checkmate():
            ok = False; msgs.append("starts in checkmate")
        if board.is_stalemate():
            ok = False; msgs.append("starts in stalemate")
        for u in p["solution"]:
            try:
                mv = chess.Move.from_uci(u)
            except Exception:
                ok = False; msgs.append("bad uci %s" % u); continue
            if mv not in board.legal_moves:
                ok = False; msgs.append("illegal solution move %s" % u)

        obj = p["objective"]
        if ok and obj == "Mate in 1":
            for u in p["solution"]:
                if not _push(board, chess.Move.from_uci(u)).is_checkmate():
                    ok = False; msgs.append("%s is not mate" % u)
            if ok:
                msgs.append("mate-in-1 confirmed")
        elif ok and obj == "Mate in 2":
            good, why = is_forced_mate_in_2(board, p["solution"][0])
            ok = ok and good; msgs.append(why)
        elif ok and obj == "Win material":
            good, why, _g = win_material_ok(board, p["solution"][0])
            ok = ok and good; msgs.append(why)

        all_pass = all_pass and ok
        results.append((p["id"], ok, "; ".join(msgs)))
    return results, all_pass


def emit_js(puzzles):
    import json
    items = [json.dumps({k: p[k] for k in ("id", "name", "theme", "fen", "solution",
                                           "sideToMove", "objective", "difficulty", "rating")},
                        ensure_ascii=False, separators=(",", ":")) for p in puzzles]
    header = (
        "/* CURATED + ENGINE-VERIFIED by tools/verify_puzzles.py -- DO NOT EDIT BY HAND.\n"
        "   Themed tactics: Mate in 1, forced Mate in 2 (harvested by search), and\n"
        "   Win-material forks/pins/skewers/discoveries. None start in check.\n"
        "   Regenerate: python tools/verify_puzzles.py --write */\n"
    )
    return header + "window.CT_PUZZLES = [" + ",".join(items) + "];\n"


def build_all():
    puzzles = [dict(p) for p in PUZZLES]
    puzzles += harvest_mate_in_2(limit=8)
    for i, p in enumerate(puzzles):
        p["id"] = "ctp_%d" % (i + 1)
    return puzzles


def main():
    puzzles = build_all()
    results, all_pass = verify_all(puzzles)
    npass = sum(1 for _, ok, _ in results if ok)
    by_obj, by_theme = {}, {}
    for p in puzzles:
        by_obj[p["objective"]] = by_obj.get(p["objective"], 0) + 1
        by_theme[p["theme"]] = by_theme.get(p["theme"], 0) + 1
    for pid, ok, msg in results:
        print("[%s] %s -- %s" % ("PASS" if ok else "FAIL", pid, msg))
    print("-" * 60)
    print("By objective: " + ", ".join("%s=%d" % kv for kv in sorted(by_obj.items())))
    print("By theme: " + ", ".join("%s=%d" % kv for kv in sorted(by_theme.items())))
    print("SUMMARY: %d/%d puzzles passed (%s)" % (
        npass, len(results), "100% PASS" if all_pass else "FAILURES PRESENT"))
    if not all_pass:
        sys.exit(1)
    if "--write" in sys.argv:
        out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "puzzles-data.js")
        with open(out, "w", encoding="utf-8") as f:
            f.write(emit_js(puzzles))
        print("WROTE " + out)
    elif "--emit" in sys.argv:
        sys.stdout.write(emit_js(puzzles))


if __name__ == "__main__":
    main()
