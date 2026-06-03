# -*- coding: utf-8 -*-
"""
Source of truth for the ChessTrophies lesson curriculum.
Authors each lesson as Python data, verifies it with python-chess,
then emits the JS LESSONS array to paste into academy.js.

Run:  python tools/verify_lessons.py            # verify + print summary
      python tools/verify_lessons.py --emit      # also write tools/_lessons.js
"""
import sys
import json
import chess

# Each lesson dict:
#   id, chapter, title, desc, fen, side ('w'|'b'),
#   solution: list of {from,to[,promotion]} (UCI parts),
#   hint, difficulty (1-5), concept,
#   theme: one of 'capture','mate','promote','fork','pin','skewer',
#          'discovered','double','remove','develop','endgame','move',
#          'deflection','decoy','overload','interference','zwischenzug','trap'
#   (theme drives extra assertions; 'move' = just legal)
#   capture_piece (optional): expected captured piece type letter for capture/skewer/pin themes
#   reply (optional): {from,to[,promotion]} = the opponent's forced/typical response
#          to animate AFTER the player's correct move (must be legal after solution[0])
#   payoff (optional): short caption shown while the reply animates (the point of the tactic)

L = []


def add(**kw):
    L.append(kw)


# ============================================================
# CHAPTER 1 — First Moves (how pieces move & capture)
# ============================================================
add(id='FM01', chapter='First Moves', title='The Pawn Strikes Sideways',
   desc='White to play. Pawns push straight but capture on the diagonal — take that knight.',
   fen='8/8/8/3n4/4P3/8/4K2k/8 w - - 0 1', side='w',
   solution=[{'from': 'e4', 'to': 'd5'}],
   hint='Pawns never capture straight ahead — they capture one square diagonally forward.',
   difficulty=1, theme='capture', capture_piece='n',
   concept="A pawn moves straight forward but captures diagonally. That one quirk catches every beginner — when an enemy piece sits one square diagonally ahead, your pawn can snap it up.")

add(id='FM02', chapter='First Moves', title='The Rook Runs the File',
   desc='White to play. Slide the rook up the open file to grab the loose knight.',
   fen='4n3/8/8/8/8/8/4R3/4K2k w - - 0 1', side='w',
   solution=[{'from': 'e2', 'to': 'e8'}],
   hint='Rooks travel any distance in straight lines along ranks and files.',
   difficulty=1, theme='capture', capture_piece='n',
   concept="The rook moves in straight lines along ranks and files, as far as it likes. Open files are its highways — put a rook on one and it controls the whole lane.")

add(id='FM03', chapter='First Moves', title='The Bishop Rides the Diagonal',
   desc='White to play. Run the bishop down the long diagonal and capture the rook.',
   fen='7r/8/8/8/8/8/8/B3K2k w - - 0 1', side='w',
   solution=[{'from': 'a1', 'to': 'h8'}],
   hint='Bishops slide along diagonals only, staying on one color forever.',
   difficulty=1, theme='capture', capture_piece='r',
   concept="A bishop slides along diagonals and never leaves its starting color. The long a1-h8 and a8-h1 diagonals are its favorite raceways across the whole board.")

add(id='FM04', chapter='First Moves', title='The Knight Hops an L',
   desc="White to play. The knight jumps in an L — leap onto the enemy rook.",
   fen='8/8/3r4/8/4N3/8/8/4K2k w - - 0 1', side='w',
   solution=[{'from': 'e4', 'to': 'd6'}],
   hint='A knight moves two squares one way, then one square at a right angle — and it can jump over pieces.',
   difficulty=2, theme='capture', capture_piece='r',
   concept="The knight is the only piece that jumps. It moves in an L: two squares in a line, then one to the side. Nothing blocks it, which makes it tricky and sneaky.")

add(id='FM05', chapter='First Moves', title='The Queen Does It All',
   desc='White to play. The queen combines rook and bishop — capture the bishop along the diagonal.',
   fen='7b/8/8/8/8/8/8/Q3K2k w - - 0 1', side='w',
   solution=[{'from': 'a1', 'to': 'h8'}],
   hint='The queen moves like a rook and a bishop combined — straight or diagonal, any distance.',
   difficulty=1, theme='capture', capture_piece='b',
   concept="The queen is the most powerful piece: she moves like a rook and a bishop together, gliding straight or diagonally as far as the road is clear. Treat her with care.")

add(id='FM06', chapter='First Moves', title='The King Grabs a Freebie',
   desc='White to play. The king steps one square in any direction — snatch that undefended rook.',
   fen='8/8/8/8/8/5r2/4K3/7k w - - 0 1', side='w',
   solution=[{'from': 'e2', 'to': 'f3'}],
   hint='The king moves one square in any direction. If a loose enemy piece is next door, take it.',
   difficulty=1, theme='capture', capture_piece='r',
   concept="The king moves one square in any direction. He is slow but not helpless — when an undefended enemy piece sits right beside him, the king can capture it himself.")

add(id='FM07', chapter='First Moves', title='Free Piece, No Strings',
   desc='White to play. The black bishop is undefended — win it for nothing with your rook.',
   fen='8/8/2b5/8/8/8/2R5/4K2k w - - 0 1', side='w',
   solution=[{'from': 'c2', 'to': 'c6'}],
   hint='Before anything fancy, scan for enemy pieces that nothing defends — take them for free.',
   difficulty=1, theme='capture', capture_piece='b',
   concept="A hanging piece is one that nobody defends. The first skill in chess is simply noticing free material. Always ask: if I take this, can anything take back?")

add(id='FM08', chapter='First Moves', title='A Pawn Becomes a Queen',
   desc='White to play. Push the pawn to the last rank and crown a brand-new queen.',
   fen='8/4P3/8/8/8/8/8/k3K3 w - - 0 1', side='w',
   solution=[{'from': 'e7', 'to': 'e8', 'promotion': 'q'}],
   hint='A pawn that reaches the far end transforms — almost always into a queen.',
   difficulty=1, theme='promote',
   concept="When a pawn reaches the far side of the board it promotes, turning into any piece you choose — nearly always a queen. A humble pawn can become your strongest weapon.")

# ============================================================
# CHAPTER 2 — Check & Escapes
# ============================================================
add(id='CE01', chapter='Check & Escapes', title='Say Check!',
   desc='White to play. Put the enemy king in check with your rook.',
   fen='7k/8/8/8/8/8/3R4/4K3 w - - 0 1', side='w',
   solution=[{'from': 'd2', 'to': 'd8'}, {'from': 'd2', 'to': 'h2'}],
   hint='Check just means attacking the king. Line your rook up on the king.',
   difficulty=1, theme='move',
   concept="Check means you are attacking the enemy king. It is not the end of the game — your opponent must respond — but it forces them to drop everything and save the king.")

add(id='CE02', chapter='Check & Escapes', title='Step the King to Safety',
   desc="Black to play. The white rook eyes your king's file — step the king aside before it checks.",
   fen='8/8/8/8/8/4k3/8/3R2K1 b - - 0 1', side='b',
   solution=[{'from': 'e3', 'to': 'f3'}, {'from': 'e3', 'to': 'e4'},
             {'from': 'e3', 'to': 'f4'}, {'from': 'e3', 'to': 'e2'}],
   hint='Walk the king off the open file so the rook can never check it there.',
   difficulty=1, theme='move',
   concept="There are exactly three ways out of a check: move the king, block the check, or capture the checker. The most basic is to walk the king to a square the attacker cannot reach.")

add(id='CE03', chapter='Check & Escapes', title='Check With the Bishop',
   desc="White to play. Slide the bishop onto the diagonal that strikes the black king.",
   fen='7k/8/8/8/8/8/3B4/4K3 w - - 0 1', side='w',
   solution=[{'from': 'd2', 'to': 'c3'}],
   hint='Find the diagonal that runs from your bishop straight to the enemy king.',
   difficulty=2, theme='move',
   concept="Bishops check along diagonals from a distance. A long-range check like this is powerful: the king must respond, and you can often line the bishop up to win material behind the king.")

add(id='CE04', chapter='Check & Escapes', title='Capture the Attacker',
   desc='White to play. A black knight is harassing your king — simply capture it with your rook.',
   fen='7k/8/8/8/8/8/3n4/3RK3 w - - 0 1', side='w',
   solution=[{'from': 'd1', 'to': 'd2'}],
   hint='The cleanest answer to an attacker near your king is often to take it.',
   difficulty=1, theme='capture', capture_piece='n',
   concept="The third way out of a check is to capture the attacking piece. If one of your pieces can safely take the checker, the threat simply disappears off the board.")

add(id='CE05', chapter='Check & Escapes', title='Dodge the Knight',
   desc="Black to play. The white knight is poised to check on e5 — step your king off that square's reach.",
   fen='8/8/8/7N/3k4/8/8/6K1 b - - 0 1', side='b',
   solution=[{'from': 'd4', 'to': 'c3'}, {'from': 'd4', 'to': 'd3'},
             {'from': 'd4', 'to': 'e3'}, {'from': 'd4', 'to': 'c4'},
             {'from': 'd4', 'to': 'e4'}, {'from': 'd4', 'to': 'c5'},
             {'from': 'd4', 'to': 'd5'}, {'from': 'd4', 'to': 'e5'}],
   hint="A knight's check can never be blocked, so keep your king out of its jumping reach.",
   difficulty=2, theme='move',
   concept="A knight's check is special: because the knight jumps over pieces, you can never block it. Your only answers are to move the king or capture the knight. Best of all, avoid its reach.")

add(id='CE06', chapter='Check & Escapes', title='Give Check With the Queen',
   desc='White to play. Deliver a check with your queen that the king cannot ignore.',
   fen='6k1/8/8/8/8/8/8/Q3K3 w - - 0 1', side='w',
   solution=[{'from': 'a1', 'to': 'a8'}, {'from': 'a1', 'to': 'g7'}],
   hint='Find a queen move that lines up on the enemy king along a rank, file, or diagonal.',
   difficulty=1, theme='move',
   concept="Learning to give check helps you attack the king. The queen, reaching along ranks, files, and diagonals, can deliver check from many directions at once.")

# ============================================================
# CHAPTER 3 — Checkmate Basics
# ============================================================
add(id='CM01', chapter='Checkmate Basics', title='The Back-Rank Mate (Rook)',
   desc="White to play and mate in one. The king is trapped behind its own pawns.",
   fen='6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', side='w',
   solution=[{'from': 'a1', 'to': 'a8'}],
   hint="The king's own pawns block its escape — slide the rook to the back rank.",
   difficulty=1, theme='mate',
   concept="A back-rank mate happens when a king is hemmed in by its own pawns on the edge. A rook or queen sliding onto that rank delivers checkmate, since the king has no square to flee to.")

add(id='CM02', chapter='Checkmate Basics', title='The Back-Rank Mate (Queen)',
   desc='White to play and mate in one using the queen on the back rank.',
   fen='6k1/5ppp/8/8/8/8/8/Q5K1 w - - 0 1', side='w',
   solution=[{'from': 'a1', 'to': 'a8'}],
   hint='Same trap as the rook version — the queen ends it on the eighth rank.',
   difficulty=1, theme='mate',
   concept="The queen delivers back-rank mate just like the rook. Whenever you see an enemy king boxed in by its own pawns, look immediately for a heavy piece that can reach the back rank.")

add(id='CM03', chapter='Checkmate Basics', title='Supported Queen Mate',
   desc='White to play and mate in one. The king guards the queen as it lands beside the enemy king.',
   fen='7k/Q7/6K1/8/8/8/8/8 w - - 0 1', side='w',
   solution=[{'from': 'a7', 'to': 'h7'}, {'from': 'a7', 'to': 'g7'},
             {'from': 'a7', 'to': 'a8'}, {'from': 'a7', 'to': 'b8'}],
   hint='Put the queen right beside the enemy king on a square your own king defends.',
   difficulty=2, theme='mate',
   concept="A queen alone cannot mate a lone king — the king would just capture her. But when your own king stands guard beside her, the enemy king cannot take her, and it is checkmate.")

add(id='CM04', chapter='Checkmate Basics', title='Two-Rook Ladder Mate',
   desc='White to play and mate in one. Two rooks march the king to the edge.',
   fen='4k3/R7/1R6/8/8/8/8/4K3 w - - 0 1', side='w',
   solution=[{'from': 'b6', 'to': 'b8'}],
   hint='One rook seals the seventh rank; bring the other to the eighth for mate.',
   difficulty=2, theme='mate',
   concept="Two rooks mate a king with no help from their own king. One rook fences off a rank so the king cannot advance, and the second rook delivers check on the next rank — the ladder.")

add(id='CM05', chapter='Checkmate Basics', title='King and Queen Corner the King',
   desc='White to play and mate in one, driving the enemy king into the corner.',
   fen='7k/5K2/8/8/8/8/8/3Q4 w - - 0 1', side='w',
   solution=[{'from': 'd1', 'to': 'h5'}, {'from': 'd1', 'to': 'h1'}],
   hint='Your king already guards the escape squares — the queen just needs to check.',
   difficulty=2, theme='mate',
   concept="King and queen versus a lone king is the most common mate to learn. The king takes away flight squares while the queen delivers the final check from a safe distance.")

add(id='CM06', chapter='Checkmate Basics', title='Promote and Mate',
   desc='White to play. Capture the rook, promote to a queen, and deliver checkmate all in one move.',
   fen='6kr/6P1/6K1/8/8/8/1B6/8 w - - 0 1', side='w',
   solution=[{'from': 'g7', 'to': 'h8', 'promotion': 'q'}],
   hint='Capture the rook and promote at the same time — the new queen mates, guarded by your king.',
   difficulty=3, theme='mate',
   concept="Promotion and checkmate often arrive together. A pawn reaching the last rank can become a queen that delivers mate on the spot — the most satisfying way to finish a game.")

add(id='CM07', chapter='Checkmate Basics', title='Smothered Knight Mate',
   desc="White to play and mate in one. The king is hemmed in by its own pieces — the knight slips in.",
   fen='6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', side='w',
   solution=[{'from': 'g5', 'to': 'f7'}],
   hint="The king's own rook and pawns trap it; hop the knight to f7 for mate.",
   difficulty=3, theme='mate',
   concept="A smothered mate is a knight checkmate where the enemy king is so boxed in by its own pieces it has no escape. The knight is the only piece that can attack a fully surrounded king.")

# ============================================================
# CHAPTER 4 — The Fork
# ============================================================
add(id='FK01', chapter='The Fork', title='Knight Forks King and Rook',
   desc="White to play. Land the knight where it checks the king and attacks the rook at once.",
   fen='r3k3/8/4N3/8/8/8/8/4K3 w - - 0 1', side='w',
   solution=[{'from': 'e6', 'to': 'c7'}],
   reply={'from': 'e8', 'to': 'd7'}, payoff='…the king must run, and the rook is yours.',
   hint='Find the L-shape that hits both the king and the rook in one jump.',
   difficulty=2, theme='fork',
   concept="A fork is one piece attacking two targets at once. The knight is the master forker — it can hit a king and a rook on squares from which neither can defend or block.")

add(id='FK02', chapter='The Fork', title='The Royal Fork',
   desc="White to play. Fork the king and queen with a single knight leap.",
   fen='2q1k3/8/8/5N2/8/8/8/4K3 w - - 0 1', side='w',
   solution=[{'from': 'f5', 'to': 'd6'}],
   reply={'from': 'e8', 'to': 'd7'}, payoff='…the king steps away and the queen falls.',
   hint='A knight check that also attacks the queen wins her — the king must move first.',
   difficulty=3, theme='fork',
   concept="A royal fork hits both the king and the queen. Because check must be answered, the king is forced to move and you scoop up the queen next turn. It is a knight's deadliest trick.")

add(id='FK03', chapter='The Fork', title='The Pawn Fork',
   desc="White to play. Push the pawn so it attacks two pieces at once.",
   fen='7k/8/2r1n3/8/3P4/8/8/4K3 w - - 0 1', side='w',
   solution=[{'from': 'd4', 'to': 'd5'}],
   hint='A single pawn push can threaten two enemy pieces on its two diagonals.',
   difficulty=2, theme='move',
   concept="Even a pawn can fork. When it advances and attacks two pieces on its two diagonal squares, your opponent can only save one — a tiny pawn winning a big piece.")

add(id='FK04', chapter='The Fork', title='Queen Double Attack',
   desc="White to play. One queen move attacks the king and the loose rook together.",
   fen='1k5r/8/8/8/8/8/8/3QK3 w - - 0 1', side='w',
   solution=[{'from': 'd1', 'to': 'd8'}],
   reply={'from': 'b8', 'to': 'a7'}, payoff='…the king dodges and the rook drops.',
   hint='Find a queen move that gives check and lines up on the rook at the same time.',
   difficulty=2, theme='fork',
   concept="The queen forks by hitting two things along her many lines of attack. A check that also aims at a loose piece forces the king to move and lets you grab the other target.")

add(id='FK05', chapter='The Fork', title='Bishop Forks Two Rooks',
   desc="White to play. Place the bishop where both of its diagonals strike a rook.",
   fen='2r3rk/8/8/8/8/7B/8/4K3 w - - 0 1', side='w',
   solution=[{'from': 'h3', 'to': 'e6'}],
   hint='A bishop on the right square can attack two pieces along its two diagonals at once.',
   difficulty=3, theme='move',
   concept="A bishop forks along its two diagonals. Park it on a square where both diagonals end in an enemy piece, and your opponent cannot rescue both at once.")

add(id='FK06', chapter='The Fork', title='Knight Forks King and Queen on the Rim',
   desc="White to play. A knight check on the edge also snares the queen.",
   fen='8/8/8/8/1q6/4N3/8/k5K1 w - - 0 1', side='w',
   solution=[{'from': 'e3', 'to': 'c2'}],
   reply={'from': 'a1', 'to': 'b1'}, payoff='…the king shuffles aside and the queen falls.',
   hint='Jump to a square that checks the cornered king and attacks the queen too.',
   difficulty=3, theme='fork',
   concept="Kings stuck on the edge are easy fork targets. Look for a knight square that checks the king and simultaneously attacks the queen — the rim gives the king nowhere to hide.")

# ============================================================
# CHAPTER 5 — Pins
# ============================================================
add(id='PN01', chapter='Pins', title='Take the Pinned Queen',
   desc="White to play. The black queen is pinned to its king — capture it for free.",
   fen='4k3/4q3/8/8/4R3/8/8/4K3 w - - 0 1', side='w',
   solution=[{'from': 'e4', 'to': 'e7'}],
   reply={'from': 'e8', 'to': 'e7'}, payoff='…the king recaptures, but you have won the queen for a rook.',
   hint="The queen can't move aside — the king sits right behind it. Just take it.",
   difficulty=2, theme='capture', capture_piece='q',
   concept="In an absolute pin, a piece cannot move because its own king sits directly behind it. The pinned piece is frozen — you can pile up on it and win it without it ever escaping.")

add(id='PN02', chapter='Pins', title='Pin the Knight to the King',
   desc="White to play. Pin the knight against the king so it cannot move.",
   fen='3k4/3n4/8/8/8/8/8/3RK3 w - - 0 1', side='w',
   solution=[{'from': 'd1', 'to': 'd2'}, {'from': 'd1', 'to': 'd3'},
             {'from': 'd1', 'to': 'd4'}, {'from': 'd1', 'to': 'd5'}],
   hint='Line your rook up on the file with the knight and the king behind it.',
   difficulty=2, theme='move',
   concept="To create a pin, line your rook, bishop, or queen up so an enemy piece stands between your attacker and a more valuable piece. The pinned piece is now stuck in place.")

add(id='PN03', chapter='Pins', title='Pile On the Pinned Piece',
   desc="White to play. The black bishop is pinned to the king — capture it with the rook.",
   fen='3rk3/8/3b4/8/3R4/8/8/3RK3 w - - 0 1', side='w',
   solution=[{'from': 'd4', 'to': 'd6'}],
   hint='The bishop is pinned and now you attack it twice — take it.',
   difficulty=3, theme='capture', capture_piece='b',
   concept="When a piece is pinned, attack it again. Since it cannot move and its defenders may be too few, adding a second attacker lets you win it outright.")

add(id='PN04', chapter='Pins', title='Win the Pinned Bishop',
   desc="White to play. A black bishop is pinned to its king — capture it with your pawn.",
   fen='4k3/8/8/4b3/3P4/8/8/4R1K1 w - - 0 1', side='w',
   solution=[{'from': 'd4', 'to': 'e5'}],
   reply={'from': 'e8', 'to': 'e7'}, payoff='…the king can only watch — you have won a clean piece.',
   hint='The bishop is pinned against the king, so capture it for free with the pawn.',
   difficulty=2, theme='capture', capture_piece='b',
   concept="A pinned piece is glued in place. Here a rook pins the bishop to its king, so the bishop cannot recapture — your pawn simply takes it and wins a piece.")

add(id='PN05', chapter='Pins', title='Pin and Win the Knight',
   desc="White to play. Pin the knight to the queen, then snap it off with the bishop.",
   fen='3qk3/8/8/8/8/6n1/8/B3K3 w - - 0 1', side='w',
   solution=[{'from': 'a1', 'to': 'g7'}],
   hint='Slide the bishop onto the diagonal where the knight blocks the queen.',
   difficulty=3, theme='move',
   concept="Bishops pin along diagonals. Place yours so an enemy knight is trapped in front of the queen — the knight cannot run without losing the queen, so it is effectively yours.")

# ============================================================
# CHAPTER 6 — Skewers & Discovered Attacks
# ============================================================
add(id='SK01', chapter='Skewers & Discovered Attacks', title='Skewer the King, Win the Queen',
   desc="White to play. Check the king so it must step aside, exposing the queen behind it.",
   fen='3qk3/8/8/8/8/8/8/3RK3 w - - 0 1', side='w',
   solution=[{'from': 'd1', 'to': 'd8'}],
   reply={'from': 'e8', 'to': 'd8'}, payoff='…the king grabs the rook back, but the queen is won.',
   hint='A skewer is a reverse pin: check the king and the queen behind it falls.',
   difficulty=2, theme='capture', capture_piece='q',
   concept="A skewer is a pin in reverse: the more valuable piece is in front. You check the king, it must move, and the piece hiding behind it is left hanging for you to take.")

add(id='SK02', chapter='Skewers & Discovered Attacks', title='Skewer Along the Diagonal',
   desc="White to play. Check the king on the diagonal so the rook lined up behind it falls.",
   fen='8/1r6/8/3k4/8/8/2B5/4K3 w - - 0 1', side='w',
   solution=[{'from': 'c2', 'to': 'e4'}],
   reply={'from': 'd5', 'to': 'd6'}, payoff='…the king slides off the diagonal and the rook falls.',
   hint='Slide the bishop to give check; the rook on the same diagonal behind the king is the prize.',
   difficulty=3, theme='move',
   concept="Bishops and queens skewer along diagonals. Give check so the king must dodge, and whatever stood behind it on that diagonal is left hanging for you to take.")

add(id='SK03', chapter='Skewers & Discovered Attacks', title='Discovered Check',
   desc="White to play. Move the bishop to uncover your rook's check down the e-file.",
   fen='3qk3/8/8/8/8/4B3/8/4R1K1 w - - 0 1', side='w',
   solution=[{'from': 'e3', 'to': 'a7'}, {'from': 'e3', 'to': 'b6'},
             {'from': 'e3', 'to': 'c5'}, {'from': 'e3', 'to': 'd4'},
             {'from': 'e3', 'to': 'f4'}, {'from': 'e3', 'to': 'g5'},
             {'from': 'e3', 'to': 'h6'}, {'from': 'e3', 'to': 'd2'},
             {'from': 'e3', 'to': 'c1'}, {'from': 'e3', 'to': 'f2'}],
   reply={'from': 'e8', 'to': 'd7'}, payoff='…the king must answer the rook, and your bishop went wherever it pleased.',
   hint='Any bishop move uncovers the rook checking the king down the e-file.',
   difficulty=3, theme='discovered',
   concept="A discovered check happens when you move one piece out of the way to reveal a check from the piece behind it. The moving piece is free to go anywhere — even to grab material.")

add(id='SK04', chapter='Skewers & Discovered Attacks', title='Discovered Attack Wins the Queen',
   desc="White to play. Unveil your rook's check while the knight jumps to attack the queen.",
   fen='4k3/8/8/3q4/4N3/8/8/4R1K1 w - - 0 1', side='w',
   solution=[{'from': 'e4', 'to': 'f6'}, {'from': 'e4', 'to': 'c5'},
             {'from': 'e4', 'to': 'd6'}, {'from': 'e4', 'to': 'c3'},
             {'from': 'e4', 'to': 'g3'}, {'from': 'e4', 'to': 'd2'},
             {'from': 'e4', 'to': 'f2'}, {'from': 'e4', 'to': 'g5'}],
   reply={'from': 'e8', 'to': 'f8'}, payoff='…the king must meet the check, then the knight snaps off the queen.',
   hint='Move the knight to f6: the rook checks the king while the knight also hits the queen.',
   difficulty=4, theme='discovered',
   concept="The deadliest discoveries hit two targets. While the unveiled piece gives check, the moving piece attacks something else. The opponent must answer the check and loses the other piece.")

add(id='SK05', chapter='Skewers & Discovered Attacks', title='Double Check',
   desc="White to play. Leap the knight so the knight AND the uncovered rook both check the king.",
   fen='4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', side='w',
   solution=[{'from': 'e4', 'to': 'd6'}, {'from': 'e4', 'to': 'f6'}],
   reply={'from': 'e8', 'to': 'd8'}, payoff='…against a double check the king MUST move — nothing else works.',
   hint='Find the knight jump that checks the king itself while revealing the rook behind it.',
   difficulty=4, theme='discovered',
   concept="A double check attacks the king with two pieces at once. It cannot be blocked or met by capturing just one attacker — the king is forced to move, with no other option.")

# ============================================================
# CHAPTER 7 — Remove the Guard
# ============================================================
add(id='RG01', chapter='Remove the Guard', title='Capture the Defender',
   desc="White to play. A knight guards the back-rank square — take it so mate becomes possible.",
   fen='6k1/5ppp/8/8/8/8/5n2/R5K1 w - - 0 1', side='w',
   solution=[{'from': 'g1', 'to': 'f2'}],
   reply={'from': 'g7', 'to': 'g6'}, payoff='…the guard is gone; next move Ra8 is mate.',
   hint="That knight is the only thing guarding the mating square — remove it.",
   difficulty=2, theme='capture', capture_piece='n',
   concept="Sometimes only one piece defends a key square. Remove that guard — by capturing or chasing it — and the square, or the mate behind it, falls into your hands.")

add(id='RG02', chapter='Remove the Guard', title='Trade Off the Last Defender',
   desc="White to play. The black rook defends the back rank — exchange it and open the door.",
   fen='r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', side='w',
   solution=[{'from': 'a1', 'to': 'a8'}],
   hint='Swap rooks: once the defender is gone, the back rank is weak.',
   difficulty=2, theme='capture', capture_piece='r',
   concept="Defenders can be removed by trading. Exchange off the piece that holds your opponent's position together, and the weakness it was covering is suddenly exposed.")

add(id='RG03', chapter='Remove the Guard', title='Capture the Guard of the Queen',
   desc="White to play. A bishop defends the black queen — capture the bishop and the queen is loose.",
   fen='3qk3/8/5b2/8/7B/8/8/4K3 w - - 0 1', side='w',
   solution=[{'from': 'h4', 'to': 'f6'}],
   reply={'from': 'd8', 'to': 'd7'}, payoff='…the guard is gone, so the queen must flee — and you have won a bishop.',
   hint='Take the piece that protects the queen; next move the queen hangs.',
   difficulty=3, theme='capture', capture_piece='b',
   concept="Before you win a defended piece, deal with its defender. Capture or deflect the guard first, and the piece it was protecting becomes a free target on the next move.")

add(id='RG04', chapter='Remove the Guard', title='Remove the Knight That Holds the Fort',
   desc="White to play. A knight is the lone guard of the mating square — eliminate it with your rook.",
   fen='5rk1/5ppp/8/8/8/8/8/1n2R1K1 w - - 0 1', side='w',
   solution=[{'from': 'e1', 'to': 'b1'}],
   hint='Capture the knight guarding the back rank; mate threats follow.',
   difficulty=2, theme='capture', capture_piece='n',
   concept="Identify exactly what is defending the square you want, then take it. With the single guard gone, your heavy pieces dominate the weakened back rank.")

# ============================================================
# CHAPTER 8 — Advanced Tactics
# ============================================================
add(id='AT01', chapter='Advanced Tactics', title='Deflect the Defender',
   desc="White to play. The black rook is the lone guard of the back rank — force it off with a check.",
   fen='r5k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', side='w',
   solution=[{'from': 'e1', 'to': 'e8'}],
   reply={'from': 'a8', 'to': 'e8'}, payoff='…the rook is dragged off the eighth rank — its defensive duty abandoned.',
   hint='Give a check that the rook is forced to answer, pulling it away from its post.',
   difficulty=3, theme='deflection',
   concept="Deflection forces a defending piece away from a job it must do. Hit it with a check or threat it cannot ignore, and the square or piece it was guarding is suddenly undefended.")

add(id='AT02', chapter='Advanced Tactics', title='Decoy the King',
   desc="White to play. Sacrifice the queen to lure the king onto a square where a knight fork wins it back with interest.",
   fen='2r3k1/5p1p/8/1N5Q/8/8/1B6/6K1 w - - 0 1', side='w',
   solution=[{'from': 'h5', 'to': 'f7'}],
   reply={'from': 'g8', 'to': 'f7'}, payoff='…the king is decoyed to f7, where Nd6+ will fork king and rook.',
   hint='Offer the queen on a square the king is forced to capture, landing it in a knight fork.',
   difficulty=4, theme='decoy',
   concept="A decoy lures an enemy piece — often the king — onto a fatal square. You give it something it must take; the square it lands on then falls victim to a fork or other blow.")

add(id='AT03', chapter='Advanced Tactics', title='Punish the Overloaded Piece',
   desc="White to play. The black queen is doing two jobs at once — make it choose by capturing one of them.",
   fen='3r2k1/3q1ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1', side='w',
   solution=[{'from': 'd1', 'to': 'd7'}],
   reply={'from': 'd8', 'to': 'd7'}, payoff='…the rook must recapture, abandoning the back rank to a mating rook.',
   hint='The queen guards both the rook and the back rank. Take the rook and overload it.',
   difficulty=4, theme='overload',
   concept="An overloaded piece is defending two things at once. Attack one of its duties: when it answers there, the other duty is abandoned and the second target falls.")

add(id='AT04', chapter='Advanced Tactics', title='Interfere With the Defense',
   desc="White to play. A black bishop defends c8 along the diagonal — plant a knight in the way to cut the line.",
   fen='2r3k1/5ppp/b7/2N5/8/8/5PPP/2R3K1 w - - 0 1', side='w',
   solution=[{'from': 'c5', 'to': 'b7'}],
   reply={'from': 'a6', 'to': 'b7'}, payoff='…the bishop captures, but the defensive line was broken — Rxc8 follows.',
   hint='Block the diagonal between the bishop and the square it guards by jumping a knight onto it.',
   difficulty=4, theme='interference',
   concept="Interference breaks the line a defender needs. Drop a piece between the defender and what it protects, and even though you may lose that piece, the defense collapses for a move.")

add(id='AT05', chapter='Advanced Tactics', title='The In-Between Move (Zwischenzug)',
   desc="White to play. Your knight is attacked — but instead of retreating, strike first with a forcing fork.",
   fen='4k3/5q2/8/1b6/2N5/8/8/6K1 w - - 0 1', side='w',
   solution=[{'from': 'c4', 'to': 'd6'}],
   reply={'from': 'e8', 'to': 'd7'}, payoff='…the in-between check is answered first; then the knight takes the queen.',
   hint="The bishop attacks your knight — but a knight check that also hits the queen comes first.",
   difficulty=4, theme='zwischenzug',
   concept="A zwischenzug, or in-between move, is an unexpected reply inserted before the 'expected' one. When your piece is attacked, look for a more forcing move — a check or threat — to play first.")

add(id='AT06', chapter='Advanced Tactics', title='Trap the Knight on the Rim',
   desc="White to play. The black knight has strayed to the edge — push the pawn so every escape is cut off.",
   fen='k7/8/8/7n/3B4/4P3/5PP1/6K1 w - - 0 1', side='w',
   solution=[{'from': 'g2', 'to': 'g4'}],
   reply={'from': 'h5', 'to': 'f6'}, payoff='…wherever the knight jumps it is covered — it cannot escape and will be won.',
   hint='Attack the knight with a pawn; its bishop and pawns already cover every flight square.',
   difficulty=3, theme='trap',
   concept="Trapping a piece means attacking it where it has no safe square. A piece on the rim is especially vulnerable — fence off its escape squares first, then attack it and win it.")

add(id='AT07', chapter='Advanced Tactics', title='Trap the Greedy Rook',
   desc="White to play. The cornered black rook is boxed in by its own pieces — leap a knight at it.",
   fen='rb4k1/p4ppp/8/8/2N5/8/8/6K1 w - - 0 1', side='w',
   solution=[{'from': 'c4', 'to': 'b6'}],
   reply={'from': 'b8', 'to': 'd6'}, payoff='…the rook is hemmed in by its own pawn and bishop — there is no flight square.',
   hint="The rook's own pawn blocks the file and its bishop blocks the rank — jump the knight to attack it.",
   difficulty=3, theme='trap',
   concept="A piece can be trapped by its own army. When a rook's own pawns and pieces block its escape, a single attacker is enough — it has nowhere to run and is simply lost.")

# ============================================================
# CHAPTER 9 — Opening Principles
# ============================================================
add(id='OP01', chapter='Opening Principles', title='Claim the Center',
   desc="White to play the first move. Stake your flag in the center with a pawn.",
   fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', side='w',
   solution=[{'from': 'e2', 'to': 'e4'}, {'from': 'd2', 'to': 'd4'}],
   hint='Push a central pawn two squares to grab space and free your pieces.',
   difficulty=1, theme='move',
   concept="Start the game by fighting for the center. Pushing the e- or d-pawn two squares grabs space, controls key squares, and opens lines for your bishop and queen.")

add(id='OP02', chapter='Opening Principles', title='Develop a Knight',
   desc="White to play. Bring a knight toward the center where it controls the most squares.",
   fen='rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1', side='w',
   solution=[{'from': 'g1', 'to': 'f3'}, {'from': 'b1', 'to': 'c3'}],
   hint="Knights belong near the center — develop one before your bishops.",
   difficulty=1, theme='move',
   concept="Get your pieces into the game early. Knights develop best toward the center, where they reach more squares. A common saying: knights before bishops.")

add(id='OP03', chapter='Opening Principles', title='Develop the Bishop (Italian)',
   desc="White to play. Aim the light-squared bishop at the weak f7 square.",
   fen='rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1', side='w',
   solution=[{'from': 'f1', 'to': 'c4'}],
   hint="Bishop to c4 eyes f7, the most vulnerable square near the black king.",
   difficulty=2, theme='move',
   concept="After a knight, develop a bishop to an active diagonal. The Italian setup points the bishop at f7, the soft spot in Black's camp, putting early pressure on the king.")

add(id='OP04', chapter='Opening Principles', title='Castle Your King to Safety',
   desc="White to play. Tuck the king into the corner behind its pawns by castling kingside.",
   fen='rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1', side='w',
   solution=[{'from': 'e1', 'to': 'g1'}],
   hint='Castling moves the king two squares toward the rook and tucks it away safely.',
   difficulty=2, theme='move',
   concept="Castling whisks your king into safety behind a wall of pawns and connects your rooks. Do it early — a king caught in the center is a king in danger.")

add(id='OP05', chapter='Opening Principles', title="Don't Waste a Tempo",
   desc="White to play. Instead of moving a developed piece again, bring out a new one.",
   fen='r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1', side='w',
   solution=[{'from': 'f1', 'to': 'b5'}, {'from': 'f1', 'to': 'c4'},
             {'from': 'b1', 'to': 'c3'}],
   hint='Develop a fresh piece rather than shuffling one you already moved.',
   difficulty=2, theme='move',
   concept="A tempo is a move's worth of time. Don't waste tempi moving the same piece twice in the opening — develop a new piece each turn and race to finish your setup.")

add(id='OP06', chapter='Opening Principles', title='Knight to the Rim Is Dim — Aim Central',
   desc="White to play. Choose the central knight development, not the edge.",
   fen='rnbqkb1r/pppp1ppp/5n2/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1', side='w',
   solution=[{'from': 'g1', 'to': 'f3'}, {'from': 'b1', 'to': 'c3'}],
   hint="Develop the knight toward the middle — a knight on the rim controls fewer squares.",
   difficulty=1, theme='move',
   concept="A knight on the edge of the board reaches only a few squares — 'a knight on the rim is dim.' Develop knights toward the center, where their power is greatest.")

# ============================================================
# CHAPTER 10 — Endgame Essentials
# ============================================================
add(id='EG01', chapter='Endgame Essentials', title='Promote the Passed Pawn',
   desc="White to play. Nothing can stop the runner — push it home to a queen.",
   fen='8/4P3/4K3/8/8/8/8/7k w - - 0 1', side='w',
   solution=[{'from': 'e7', 'to': 'e8', 'promotion': 'q'}],
   hint='A passed pawn with a clear path should be promoted without delay.',
   difficulty=1, theme='promote',
   concept="A passed pawn has no enemy pawns to stop it. In the endgame, escort it to the last rank and promote — a new queen usually decides the game on the spot.")

add(id='EG02', chapter='Endgame Essentials', title='Squeeze With King and Queen',
   desc="White to play. Use the queen to shrink the enemy king's box one rank smaller.",
   fen='8/8/4k3/8/3Q4/4K3/8/8 w - - 0 1', side='w',
   solution=[{'from': 'd4', 'to': 'd5'}, {'from': 'd4', 'to': 'd6'}],
   hint="Step the queen a knight's-move away to cut the king's space without stalemate.",
   difficulty=3, theme='move',
   concept="To mate with king and queen, herd the lone king toward the edge by shrinking its box. Keep the queen a safe distance away so you never accidentally stalemate.")

add(id='EG03', chapter='Endgame Essentials', title='Rook Behind the Passed Pawn',
   desc="White to play. Put your rook behind the runner to support its march.",
   fen='8/8/8/8/8/2P5/8/R3K2k w - - 0 1', side='w',
   solution=[{'from': 'a1', 'to': 'a3'}, {'from': 'a1', 'to': 'c1'}],
   hint="Rooks belong behind passed pawns — yours or your opponent's.",
   difficulty=2, theme='move',
   concept="A golden rook-endgame rule: place the rook behind a passed pawn. Behind your own pawn it shoves it forward; behind the enemy's it holds the pawn back.")

add(id='EG04', chapter='Endgame Essentials', title='Take the Opposition',
   desc="White to play. Step the king up to face the enemy king and seize the opposition.",
   fen='4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', side='w',
   solution=[{'from': 'e6', 'to': 'd6'}, {'from': 'e6', 'to': 'f6'}],
   hint='Sidestep so your king controls the squares in front of the pawn.',
   difficulty=3, theme='move',
   concept="The opposition is a king standoff: the player NOT to move is often worse off. Use it to seize key squares in front of your pawn and escort it safely to promotion.")

add(id='EG05', chapter='Endgame Essentials', title='Bring the King Into the Fight',
   desc="White to play. March the king toward the center — in endgames it is a fighting piece.",
   fen='8/4k3/8/8/8/4K3/4P3/8 w - - 0 1', side='w',
   solution=[{'from': 'e3', 'to': 'd4'}, {'from': 'e3', 'to': 'e4'},
             {'from': 'e3', 'to': 'f4'}],
   hint='With queens off the board, walk your king forward to support your pawns.',
   difficulty=2, theme='move',
   concept="Once the queens are gone, the king stops hiding and starts fighting. Centralize it: an active king shepherds pawns, attacks weaknesses, and is worth its weight in the endgame.")

add(id='EG06', chapter='Endgame Essentials', title='Stop the Enemy Passer',
   desc="Black to play. A white pawn is running — get your rook behind it to halt the advance.",
   fen='4k3/8/8/8/8/8/r2P4/3RK3 b - - 0 1', side='b',
   solution=[{'from': 'a2', 'to': 'd2'}],
   hint="Plant your rook behind or in front of the runner to stop it cold.",
   difficulty=2, theme='capture', capture_piece='p',
   concept="When the opponent has a dangerous passer, blockade or capture it before it queens. Here the rook swings over to take the pawn outright — the simplest way to stop a runner.")


# ============================================================
# VERIFICATION
# ============================================================
PIECE_NAMES = {'p': 'pawn', 'n': 'knight', 'b': 'bishop',
               'r': 'rook', 'q': 'queen', 'k': 'king'}


def uci(m):
    return m['from'] + m['to'] + m.get('promotion', '')


def verify():
    passed = 0
    failed = 0
    warnings = []
    seen_ids = set()
    seen_titles = set()
    for les in L:
        lid = les['id']
        errs = []
        # unique id / title
        if lid in seen_ids:
            errs.append('duplicate id')
        seen_ids.add(lid)
        if les['title'] in seen_titles:
            errs.append('duplicate title')
        seen_titles.add(les['title'])

        try:
            board = chess.Board(les['fen'])
        except Exception as e:
            print('FAIL %-6s bad FEN: %s' % (lid, e))
            failed += 1
            continue

        if not board.is_valid():
            errs.append('invalid board: %s' % board.status())
        side = 'w' if board.turn == chess.WHITE else 'b'
        if side != les['side']:
            errs.append('side to move %s != declared %s' % (side, les['side']))
        if board.is_check():
            errs.append('position starts IN CHECK')
        if board.is_checkmate():
            errs.append('position starts in CHECKMATE')
        if board.is_stalemate():
            errs.append('position starts in STALEMATE')

        # validate every solution move legal
        legal_uci = set(m.uci() for m in board.legal_moves)
        for sm in les['solution']:
            u = uci(sm)
            if u not in legal_uci:
                errs.append('solution move %s not legal' % u)

        theme = les.get('theme', 'move')

        # theme checks on FIRST solution move (representative) and all where relevant
        def push_test(sm):
            b2 = board.copy()
            mv = chess.Move.from_uci(uci(sm))
            local = []
            if theme == 'mate':
                if not board.is_capture(mv) and mv.promotion is None:
                    pass
                b2.push(mv)
                if not b2.is_checkmate():
                    local.append('%s does not mate' % uci(sm))
            elif theme == 'capture':
                if not board.is_capture(mv):
                    local.append('%s is not a capture' % uci(sm))
                else:
                    cap = board.piece_at(mv.to_square)
                    # en passant handled rarely; ignore
                    if cap and les.get('capture_piece') and cap.symbol().lower() != les['capture_piece']:
                        local.append('%s captures %s not %s' % (uci(sm), cap.symbol().lower(), les['capture_piece']))
                b2.push(mv)
            elif theme == 'promote':
                if mv.promotion is None:
                    local.append('%s is not a promotion' % uci(sm))
                b2.push(mv)
            elif theme == 'fork':
                b2.push(mv)
                if not b2.is_check():
                    local.append('%s gives no check (fork)' % uci(sm))
                else:
                    # after check, must attack another valuable piece (q or r)
                    mover_color = board.turn
                    attacked_val = False
                    for sq in chess.SQUARES:
                        pc = b2.piece_at(sq)
                        if pc and pc.color != mover_color and pc.piece_type in (chess.QUEEN, chess.ROOK):
                            if b2.is_attacked_by(mover_color, sq):
                                # ensure it's not the king square
                                attacked_val = True
                    if not attacked_val:
                        local.append('%s forks nothing valuable' % uci(sm))
            elif theme == 'discovered':
                b2.push(mv)
                if not b2.is_check():
                    local.append('%s gives no check (discovered)' % uci(sm))
            elif theme in ('deflection', 'decoy'):
                # A forcing blow: must give check (the defender/king is forced to respond).
                b2.push(mv)
                if not b2.is_check():
                    local.append('%s gives no check (%s)' % (uci(sm), theme))
            elif theme == 'overload':
                # Capture one of the overloaded piece's duties.
                if not board.is_capture(mv):
                    local.append('%s is not a capture (overload)' % uci(sm))
                b2.push(mv)
            elif theme == 'interference':
                # Place a piece on a square between an enemy defender and its target
                # (i.e. a quiet, non-capturing move that lands a piece in the line).
                if board.is_capture(mv):
                    local.append('%s is a capture, not interference' % uci(sm))
                b2.push(mv)
            elif theme == 'zwischenzug':
                # The in-between move must itself be forcing (a check).
                b2.push(mv)
                if not b2.is_check():
                    local.append('%s is not forcing (zwischenzug)' % uci(sm))
            elif theme == 'trap':
                # After the move, the targeted enemy piece must be attacked with
                # no safe square to flee to (it is trapped).
                b2.push(mv)
                mover_color = board.turn
                trapped_found = False
                for sq in chess.SQUARES:
                    pc = b2.piece_at(sq)
                    if pc and pc.color != mover_color and pc.piece_type in (
                            chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN):
                        if not b2.is_attacked_by(mover_color, sq):
                            continue
                        # does this piece have any safe escape?
                        has_safe = False
                        for em in b2.legal_moves:
                            if em.from_square == sq:
                                b3 = b2.copy()
                                b3.push(em)
                                if not b3.is_attacked_by(mover_color, em.to_square):
                                    has_safe = True
                                    break
                        if not has_safe:
                            trapped_found = True
                if not trapped_found:
                    local.append('%s traps nothing (no attacked piece without escape)' % uci(sm))
            return local

        for sm in les['solution']:
            errs += push_test(sm)

        # reply legality: push solution[0], then the reply must be a legal move.
        if les.get('reply'):
            rep = les['reply']
            if not les['solution']:
                errs.append('reply given but no solution')
            else:
                b3 = board.copy()
                first = chess.Move.from_uci(uci(les['solution'][0]))
                if first in b3.legal_moves:
                    b3.push(first)
                    rep_uci = uci(rep)
                    rep_legal = set(m.uci() for m in b3.legal_moves)
                    if rep_uci not in rep_legal:
                        errs.append('reply %s not legal after solution[0] %s' % (rep_uci, uci(les['solution'][0])))
                else:
                    errs.append('cannot test reply: solution[0] illegal')

        # mate uniqueness warning
        if theme == 'mate':
            mating = []
            for mv in board.legal_moves:
                b2 = board.copy()
                b2.push(mv)
                if b2.is_checkmate():
                    mating.append(mv.uci())
            # Treat promotion-piece variants (h8=Q vs h8=R) as the same key move.
            def squash(u):
                return u[:4] if len(u) == 5 else u
            mating_sq = set(squash(u) for u in mating)
            sol_sq = set(squash(uci(s)) for s in les['solution'])
            if mating_sq != sol_sq:
                warnings.append('%s: mating moves %s but solution lists %s' % (lid, sorted(mating_sq), sorted(sol_sq)))

        if errs:
            failed += 1
            print('FAIL %-6s %s' % (lid, '; '.join(errs)))
        else:
            passed += 1
            print('PASS %-6s %s' % (lid, les['title']))

    print('')
    for w in warnings:
        print('WARN', w)
    print('')
    print('SUMMARY: %d/%d lessons passed (%d failed), %d warnings, %d total' % (
        passed, passed + failed, failed, len(warnings), len(L)))
    return failed == 0


def js_escape(s):
    return s.replace('\\', '\\\\').replace("'", "\\'")


def emit_js():
    lines = ['  const LESSONS = [']
    cur_chapter = None
    for les in L:
        if les['chapter'] != cur_chapter:
            cur_chapter = les['chapter']
            lines.append('    // ' + cur_chapter.upper())
        sol = ', '.join(
            '{from:\'%s\', to:\'%s\'%s}' % (
                m['from'], m['to'],
                (', promotion:\'%s\'' % m['promotion']) if m.get('promotion') else '')
            for m in les['solution'])
        lines.append(
            "    { id:'%s', chapter:'%s', title:'%s', desc:'%s'," % (
                les['id'], js_escape(les['chapter']), js_escape(les['title']), js_escape(les['desc'])))
        lines.append(
            "      fen:'%s', side:'%s'," % (les['fen'], les['side']))
        lines.append(
            "      solution:[%s], hint:'%s', difficulty:%d," % (
                sol, js_escape(les['hint']), les['difficulty']))
        if les.get('reply'):
            rp = les['reply']
            reply_js = "{from:'%s', to:'%s'%s}" % (
                rp['from'], rp['to'],
                (", promotion:'%s'" % rp['promotion']) if rp.get('promotion') else '')
            lines.append("      reply:%s," % reply_js)
            if les.get('payoff'):
                lines.append("      payoff:'%s'," % js_escape(les['payoff']))
        lines.append(
            "      concept:'%s' }," % js_escape(les['concept']))
    lines.append('  ];')
    return '\n'.join(lines)


def chapters_order():
    order = []
    for les in L:
        if les['chapter'] not in order:
            order.append(les['chapter'])
    return order


if __name__ == '__main__':
    ok = verify()
    print('\nCHAPTER ORDER:', chapters_order())
    if '--emit' in sys.argv:
        with open('tools/_lessons.js', 'w', encoding='utf-8') as f:
            f.write(emit_js())
        print('Wrote tools/_lessons.js (%d lessons)' % len(L))
    sys.exit(0 if ok else 1)
