/* ChessTrophies — Academy module
   - Hand-on chess lessons that must be solved to advance
   - Roadmap visualization with a per-rank avatar piece
   - Theme switching for board and pieces
*/
(function () {
  'use strict';
  const CT = window.CT;
  if (!CT) {
    console.error('Academy: window.CT not available');
    return;
  }

  // -------------------- THEMES --------------------
  const BOARD_THEMES = {
    forest:    { light: '#eedfc6', dark: '#6e8c6b', label: 'Forest' },
    ocean:     { light: '#dde7ef', dark: '#4a6c8a', label: 'Ocean' },
    wood:      { light: '#e8c89c', dark: '#a26136', label: 'Wood' },
    rose:      { light: '#f1d7d2', dark: '#a87080', label: 'Rose' },
    midnight:  { light: '#3a4565', dark: '#1a2236', label: 'Midnight' },
    coral:     { light: '#fde3c6', dark: '#cd6155', label: 'Coral' },
    mint:      { light: '#e6f1e7', dark: '#6db58a', label: 'Mint' },
    slate:     { light: '#cfd6df', dark: '#5b6477', label: 'Slate' },
  };
  const PIECE_THEMES = {
    classic: { lightFill:'#f6f3eb', lightStroke:'#262d44', lightAccent:'#3b425a', darkFill:'#1a2236', darkStroke:'#e9ecf5', darkAccent:'#cdd3e6', label:'Classic' },
    bold:    { lightFill:'#ffffff', lightStroke:'#0a0d18', lightAccent:'#1a2236', darkFill:'#0d111c', darkStroke:'#ffffff', darkAccent:'#e1e5f2', label:'Bold' },
    royal:   { lightFill:'#fef3c7', lightStroke:'#5b21b6', lightAccent:'#7c3aed', darkFill:'#5b21b6', darkStroke:'#fef3c7', darkAccent:'#fcd34d', label:'Royal' },
    sunset:  { lightFill:'#fff7ed', lightStroke:'#9a3412', lightAccent:'#c2410c', darkFill:'#7c2d12', darkStroke:'#fed7aa', darkAccent:'#fb923c', label:'Sunset' },
    ice:     { lightFill:'#eff6ff', lightStroke:'#1e3a8a', lightAccent:'#3b82f6', darkFill:'#1e3a8a', darkStroke:'#dbeafe', darkAccent:'#93c5fd', label:'Ice' },
  };

  function applyThemes(boardKey, piecesKey) {
    const b = BOARD_THEMES[boardKey] || BOARD_THEMES.forest;
    const p = PIECE_THEMES[piecesKey] || PIECE_THEMES.classic;
    document.documentElement.style.setProperty('--light-sq', b.light);
    document.documentElement.style.setProperty('--dark-sq', b.dark);
    window.CT_PIECE_THEME = p;
    // Re-render board if visible
    const boardEl = document.getElementById('board');
    if (boardEl && boardEl.children.length) CT.renderBoard && CT.renderBoard();
    // Refresh any captured-piece SVGs and lobby/profile avatars (cheap full refresh)
    if (document.getElementById('screen-lobby').classList.contains('active')) CT.renderLobby && CT.renderLobby();
    if (document.getElementById('screen-profile').classList.contains('active')) CT.renderProfile && CT.renderProfile();
  }
  window.CT_applyThemes = applyThemes;

  // -------------------- RANKS / AVATAR --------------------
  // Rank determined by lessons completed. Thresholds are scaled to the curriculum
  // length (currently 60 lessons) so the full "zero to Grandmaster" journey is
  // actually reachable: finishing every lesson earns the King. If you add lessons,
  // bump the top `min` toward the new LESSONS.length.
  const RANKS = [
    { min: 0,   piece: 'p', name: 'Novice'        },
    { min: 4,   piece: 'p', name: 'Pawn II'       },
    { min: 9,   piece: 'n', name: 'Apprentice'    },
    { min: 15,  piece: 'n', name: 'Apprentice II' },
    { min: 21,  piece: 'b', name: 'Adept'         },
    { min: 27,  piece: 'b', name: 'Adept II'      },
    { min: 33,  piece: 'r', name: 'Expert'        },
    { min: 40,  piece: 'r', name: 'Expert II'     },
    { min: 47,  piece: 'q', name: 'Master'        },
    { min: 53,  piece: 'q', name: 'Master II'     },
    { min: 60,  piece: 'k', name: 'Grandmaster'   },
  ];
  function getRank(user) {
    const n = (user && user.lessonsCompleted) ? user.lessonsCompleted.length : 0;
    let cur = RANKS[0];
    for (const r of RANKS) if (n >= r.min) cur = r;
    return cur;
  }
  window.CT_getRank = getRank;

  // -------------------- LESSON CONCEPTS (teaching text) --------------------
  // Keyed by lesson ID prefix; falls back to chapter-level concept.
  const CONCEPTS = {
    // Family-level
    'F': "Foundations: every piece moves a certain way. Knights jump in an L-shape; bishops slide diagonals; rooks slide ranks and files; queens do both; pawns push forward and capture diagonally. Get these patterns right and the rest of chess opens up.",
    'M': "Mate in 1: find a move that puts the enemy king in check AND leaves no legal escape — no flight square, no block, no capture of the attacker. Look for combinations of attack + escape-blocking.",
    'T': "Tactics: short forced sequences that win material. The five core patterns are the FORK (one piece attacks two), PIN (a piece can't move because something more valuable is behind it), SKEWER (the reverse of a pin), DISCOVERED ATTACK (moving one piece reveals another's attack), and DEFLECTION (forcing a defender away).",
    'O': "Openings: in the first 10 moves, fight for the center with pawns and knights, develop minor pieces (knights before bishops, ideally), castle early for king safety, and avoid moving the same piece twice unless you have to.",
    'E': "Endgames: with fewer pieces on the board, the KING becomes a strong attacking piece. Centralize it. Passed pawns are gold — push them or block opposing ones. Patience and precision beat speed here.",
    // ID-prefix concepts (generated lesson families)
    'BR': "Back-rank mate: when the enemy king is stuck behind its own pawns (no luft), a rook or queen sliding down to the back rank can deliver checkmate because the king has nowhere to run.",
    'QM': "Queen + King mate: with just a queen and king vs a lone king, your king supports the queen as it delivers the final blow. The queen alone can't mate — it needs king help.",
    'LM': "Ladder mate (rook & rook): two rooks cooperating can corner a king. One rook controls a rank or file, the other slides in to deliver mate while the first cuts off escape.",
    'FK': "Knight fork: the knight is unique — it can attack two pieces along paths neither attacked piece can use to defend or block. Look for L-shapes hitting both the king and a major piece.",
    'PIN': "Absolute pin: a piece can't move because the king is behind it on the same line. A pinned piece is effectively paralyzed — capture it freely with another attacker.",
    'BM': "Bishop + Queen battery: the bishop guards a key square; the queen lands on it for mate. Because the bishop defends, the king can't capture the queen.",
    'PR': "Promotion: when your pawn reaches the 8th rank (1st rank for black), it promotes — usually to a queen, sometimes to a knight if a knight fork follows. A new queen often turns a winning position into checkmate.",
  };
  function getConcept(lesson) {
    // Prefer the per-lesson concept text; fall back to id-prefix / chapter-letter map.
    if (lesson.concept) return lesson.concept;
    const prefix2 = lesson.id.replace(/\d.*/, '');
    if (CONCEPTS[prefix2]) return CONCEPTS[prefix2];
    const first = lesson.id[0];
    return CONCEPTS[first] || CONCEPTS['M'];
  }

  // -------------------- LESSON CATALOG --------------------
  // FEN tip: trailing " w - - 0 1" or " b - - 0 1" sets side to move.
  // Each lesson:
  //   id, chapter, title, desc, fen, side ('w'|'b'),
  //   solution: [move|alts]  — alts can be {san} or {from,to,promotion}
  //   hint, difficulty (1-5)
  // For multi-move solutions, opponent replies are scripted alongside.
  const LESSONS = [
    // FIRST MOVES
    { id:'FM01', chapter:'First Moves', title:'The Pawn Strikes Sideways', desc:'White to play. Pawns push straight but capture on the diagonal — take that knight.',
      fen:'8/8/8/3n4/4P3/8/4K2k/8 w - - 0 1', side:'w',
      solution:[{from:'e4', to:'d5'}], hint:'Pawns never capture straight ahead — they capture one square diagonally forward.', difficulty:1,
      concept:'A pawn moves straight forward but captures diagonally. That one quirk catches every beginner — when an enemy piece sits one square diagonally ahead, your pawn can snap it up.' },
    { id:'FM02', chapter:'First Moves', title:'The Rook Runs the File', desc:'White to play. Slide the rook up the open file to grab the loose knight.',
      fen:'4n3/8/8/8/8/8/4R3/4K2k w - - 0 1', side:'w',
      solution:[{from:'e2', to:'e8'}], hint:'Rooks travel any distance in straight lines along ranks and files.', difficulty:1,
      concept:'The rook moves in straight lines along ranks and files, as far as it likes. Open files are its highways — put a rook on one and it controls the whole lane.' },
    { id:'FM03', chapter:'First Moves', title:'The Bishop Rides the Diagonal', desc:'White to play. Run the bishop down the long diagonal and capture the rook.',
      fen:'7r/8/8/8/8/8/8/B3K2k w - - 0 1', side:'w',
      solution:[{from:'a1', to:'h8'}], hint:'Bishops slide along diagonals only, staying on one color forever.', difficulty:1,
      concept:'A bishop slides along diagonals and never leaves its starting color. The long a1-h8 and a8-h1 diagonals are its favorite raceways across the whole board.' },
    { id:'FM04', chapter:'First Moves', title:'The Knight Hops an L', desc:'White to play. The knight jumps in an L — leap onto the enemy rook.',
      fen:'8/8/3r4/8/4N3/8/8/4K2k w - - 0 1', side:'w',
      solution:[{from:'e4', to:'d6'}], hint:'A knight moves two squares one way, then one square at a right angle — and it can jump over pieces.', difficulty:2,
      concept:'The knight is the only piece that jumps. It moves in an L: two squares in a line, then one to the side. Nothing blocks it, which makes it tricky and sneaky.' },
    { id:'FM05', chapter:'First Moves', title:'The Queen Does It All', desc:'White to play. The queen combines rook and bishop — capture the bishop along the diagonal.',
      fen:'7b/8/8/8/8/8/8/Q3K2k w - - 0 1', side:'w',
      solution:[{from:'a1', to:'h8'}], hint:'The queen moves like a rook and a bishop combined — straight or diagonal, any distance.', difficulty:1,
      concept:'The queen is the most powerful piece: she moves like a rook and a bishop together, gliding straight or diagonally as far as the road is clear. Treat her with care.' },
    { id:'FM06', chapter:'First Moves', title:'The King Grabs a Freebie', desc:'White to play. The king steps one square in any direction — snatch that undefended rook.',
      fen:'8/8/8/8/8/5r2/4K3/7k w - - 0 1', side:'w',
      solution:[{from:'e2', to:'f3'}], hint:'The king moves one square in any direction. If a loose enemy piece is next door, take it.', difficulty:1,
      concept:'The king moves one square in any direction. He is slow but not helpless — when an undefended enemy piece sits right beside him, the king can capture it himself.' },
    { id:'FM07', chapter:'First Moves', title:'Free Piece, No Strings', desc:'White to play. The black bishop is undefended — win it for nothing with your rook.',
      fen:'8/8/2b5/8/8/8/2R5/4K2k w - - 0 1', side:'w',
      solution:[{from:'c2', to:'c6'}], hint:'Before anything fancy, scan for enemy pieces that nothing defends — take them for free.', difficulty:1,
      concept:'A hanging piece is one that nobody defends. The first skill in chess is simply noticing free material. Always ask: if I take this, can anything take back?' },
    { id:'FM08', chapter:'First Moves', title:'A Pawn Becomes a Queen', desc:'White to play. Push the pawn to the last rank and crown a brand-new queen.',
      fen:'8/4P3/8/8/8/8/8/k3K3 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'e8', promotion:'q'}], hint:'A pawn that reaches the far end transforms — almost always into a queen.', difficulty:1,
      concept:'When a pawn reaches the far side of the board it promotes, turning into any piece you choose — nearly always a queen. A humble pawn can become your strongest weapon.' },
    // CHECK & ESCAPES
    { id:'CE01', chapter:'Check & Escapes', title:'Say Check!', desc:'White to play. Put the enemy king in check with your rook.',
      fen:'7k/8/8/8/8/8/3R4/4K3 w - - 0 1', side:'w',
      solution:[{from:'d2', to:'d8'}, {from:'d2', to:'h2'}], hint:'Check just means attacking the king. Line your rook up on the king.', difficulty:1,
      concept:'Check means you are attacking the enemy king. It is not the end of the game — your opponent must respond — but it forces them to drop everything and save the king.' },
    { id:'CE02', chapter:'Check & Escapes', title:'Step the King to Safety', desc:'Black to play. The white rook eyes your king\'s file — step the king aside before it checks.',
      fen:'8/8/8/8/8/4k3/8/3R2K1 b - - 0 1', side:'b',
      solution:[{from:'e3', to:'f3'}, {from:'e3', to:'e4'}, {from:'e3', to:'f4'}, {from:'e3', to:'e2'}], hint:'Walk the king off the open file so the rook can never check it there.', difficulty:1,
      concept:'There are exactly three ways out of a check: move the king, block the check, or capture the checker. The most basic is to walk the king to a square the attacker cannot reach.' },
    { id:'CE03', chapter:'Check & Escapes', title:'Check With the Bishop', desc:'White to play. Slide the bishop onto the diagonal that strikes the black king.',
      fen:'7k/8/8/8/8/8/3B4/4K3 w - - 0 1', side:'w',
      solution:[{from:'d2', to:'c3'}], hint:'Find the diagonal that runs from your bishop straight to the enemy king.', difficulty:2,
      concept:'Bishops check along diagonals from a distance. A long-range check like this is powerful: the king must respond, and you can often line the bishop up to win material behind the king.' },
    { id:'CE04', chapter:'Check & Escapes', title:'Capture the Attacker', desc:'White to play. A black knight is harassing your king — simply capture it with your rook.',
      fen:'7k/8/8/8/8/8/3n4/3RK3 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d2'}], hint:'The cleanest answer to an attacker near your king is often to take it.', difficulty:1,
      concept:'The third way out of a check is to capture the attacking piece. If one of your pieces can safely take the checker, the threat simply disappears off the board.' },
    { id:'CE05', chapter:'Check & Escapes', title:'Dodge the Knight', desc:'Black to play. The white knight is poised to check on e5 — step your king off that square\'s reach.',
      fen:'8/8/8/7N/3k4/8/8/6K1 b - - 0 1', side:'b',
      solution:[{from:'d4', to:'c3'}, {from:'d4', to:'d3'}, {from:'d4', to:'e3'}, {from:'d4', to:'c4'}, {from:'d4', to:'e4'}, {from:'d4', to:'c5'}, {from:'d4', to:'d5'}, {from:'d4', to:'e5'}], hint:'A knight\'s check can never be blocked, so keep your king out of its jumping reach.', difficulty:2,
      concept:'A knight\'s check is special: because the knight jumps over pieces, you can never block it. Your only answers are to move the king or capture the knight. Best of all, avoid its reach.' },
    { id:'CE06', chapter:'Check & Escapes', title:'Give Check With the Queen', desc:'White to play. Deliver a check with your queen that the king cannot ignore.',
      fen:'6k1/8/8/8/8/8/8/Q3K3 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}, {from:'a1', to:'g7'}], hint:'Find a queen move that lines up on the enemy king along a rank, file, or diagonal.', difficulty:1,
      concept:'Learning to give check helps you attack the king. The queen, reaching along ranks, files, and diagonals, can deliver check from many directions at once.' },
    // CHECKMATE BASICS
    { id:'CM01', chapter:'Checkmate Basics', title:'The Back-Rank Mate (Rook)', desc:'White to play and mate in one. The king is trapped behind its own pawns.',
      fen:'6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'The king\'s own pawns block its escape — slide the rook to the back rank.', difficulty:1,
      concept:'A back-rank mate happens when a king is hemmed in by its own pawns on the edge. A rook or queen sliding onto that rank delivers checkmate, since the king has no square to flee to.' },
    { id:'CM02', chapter:'Checkmate Basics', title:'The Back-Rank Mate (Queen)', desc:'White to play and mate in one using the queen on the back rank.',
      fen:'6k1/5ppp/8/8/8/8/8/Q5K1 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'Same trap as the rook version — the queen ends it on the eighth rank.', difficulty:1,
      concept:'The queen delivers back-rank mate just like the rook. Whenever you see an enemy king boxed in by its own pawns, look immediately for a heavy piece that can reach the back rank.' },
    { id:'CM03', chapter:'Checkmate Basics', title:'Supported Queen Mate', desc:'White to play and mate in one. The king guards the queen as it lands beside the enemy king.',
      fen:'7k/Q7/6K1/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'a7', to:'h7'}, {from:'a7', to:'g7'}, {from:'a7', to:'a8'}, {from:'a7', to:'b8'}], hint:'Put the queen right beside the enemy king on a square your own king defends.', difficulty:2,
      concept:'A queen alone cannot mate a lone king — the king would just capture her. But when your own king stands guard beside her, the enemy king cannot take her, and it is checkmate.' },
    { id:'CM04', chapter:'Checkmate Basics', title:'Two-Rook Ladder Mate', desc:'White to play and mate in one. Two rooks march the king to the edge.',
      fen:'4k3/R7/1R6/8/8/8/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'b6', to:'b8'}], hint:'One rook seals the seventh rank; bring the other to the eighth for mate.', difficulty:2,
      concept:'Two rooks mate a king with no help from their own king. One rook fences off a rank so the king cannot advance, and the second rook delivers check on the next rank — the ladder.' },
    { id:'CM05', chapter:'Checkmate Basics', title:'King and Queen Corner the King', desc:'White to play and mate in one, driving the enemy king into the corner.',
      fen:'7k/5K2/8/8/8/8/8/3Q4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'h5'}, {from:'d1', to:'h1'}], hint:'Your king already guards the escape squares — the queen just needs to check.', difficulty:2,
      concept:'King and queen versus a lone king is the most common mate to learn. The king takes away flight squares while the queen delivers the final check from a safe distance.' },
    { id:'CM06', chapter:'Checkmate Basics', title:'Promote and Mate', desc:'White to play. Capture the rook, promote to a queen, and deliver checkmate all in one move.',
      fen:'6kr/6P1/6K1/8/8/8/1B6/8 w - - 0 1', side:'w',
      solution:[{from:'g7', to:'h8', promotion:'q'}], hint:'Capture the rook and promote at the same time — the new queen mates, guarded by your king.', difficulty:3,
      concept:'Promotion and checkmate often arrive together. A pawn reaching the last rank can become a queen that delivers mate on the spot — the most satisfying way to finish a game.' },
    { id:'CM07', chapter:'Checkmate Basics', title:'Smothered Knight Mate', desc:'White to play and mate in one. The king is hemmed in by its own pieces — the knight slips in.',
      fen:'6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', side:'w',
      solution:[{from:'g5', to:'f7'}], hint:'The king\'s own rook and pawns trap it; hop the knight to f7 for mate.', difficulty:3,
      concept:'A smothered mate is a knight checkmate where the enemy king is so boxed in by its own pieces it has no escape. The knight is the only piece that can attack a fully surrounded king.' },
    // THE FORK
    { id:'FK01', chapter:'The Fork', title:'Knight Forks King and Rook', desc:'White to play. Land the knight where it checks the king and attacks the rook at once.',
      fen:'r3k3/8/4N3/8/8/8/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'e6', to:'c7'}], hint:'Find the L-shape that hits both the king and the rook in one jump.', difficulty:2,
      reply:{from:'e8', to:'d7'},
      payoff:'…the king must run, and the rook is yours.',
      concept:'A fork is one piece attacking two targets at once. The knight is the master forker — it can hit a king and a rook on squares from which neither can defend or block.' },
    { id:'FK02', chapter:'The Fork', title:'The Royal Fork', desc:'White to play. Fork the king and queen with a single knight leap.',
      fen:'2q1k3/8/8/5N2/8/8/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'f5', to:'d6'}], hint:'A knight check that also attacks the queen wins her — the king must move first.', difficulty:3,
      reply:{from:'e8', to:'d7'},
      payoff:'…the king steps away and the queen falls.',
      concept:'A royal fork hits both the king and the queen. Because check must be answered, the king is forced to move and you scoop up the queen next turn. It is a knight\'s deadliest trick.' },
    { id:'FK03', chapter:'The Fork', title:'The Pawn Fork', desc:'White to play. Push the pawn so it attacks two pieces at once.',
      fen:'7k/8/2r1n3/8/3P4/8/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'d4', to:'d5'}], hint:'A single pawn push can threaten two enemy pieces on its two diagonals.', difficulty:2,
      concept:'Even a pawn can fork. When it advances and attacks two pieces on its two diagonal squares, your opponent can only save one — a tiny pawn winning a big piece.' },
    { id:'FK04', chapter:'The Fork', title:'Queen Double Attack', desc:'White to play. One queen move attacks the king and the loose rook together.',
      fen:'1k5r/8/8/8/8/8/8/3QK3 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'Find a queen move that gives check and lines up on the rook at the same time.', difficulty:2,
      reply:{from:'b8', to:'a7'},
      payoff:'…the king dodges and the rook drops.',
      concept:'The queen forks by hitting two things along her many lines of attack. A check that also aims at a loose piece forces the king to move and lets you grab the other target.' },
    { id:'FK05', chapter:'The Fork', title:'Bishop Forks Two Rooks', desc:'White to play. Place the bishop where both of its diagonals strike a rook.',
      fen:'2r3rk/8/8/8/8/7B/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'h3', to:'e6'}], hint:'A bishop on the right square can attack two pieces along its two diagonals at once.', difficulty:3,
      concept:'A bishop forks along its two diagonals. Park it on a square where both diagonals end in an enemy piece, and your opponent cannot rescue both at once.' },
    { id:'FK06', chapter:'The Fork', title:'Knight Forks King and Queen on the Rim', desc:'White to play. A knight check on the edge also snares the queen.',
      fen:'8/8/8/8/1q6/4N3/8/k5K1 w - - 0 1', side:'w',
      solution:[{from:'e3', to:'c2'}], hint:'Jump to a square that checks the cornered king and attacks the queen too.', difficulty:3,
      reply:{from:'a1', to:'b1'},
      payoff:'…the king shuffles aside and the queen falls.',
      concept:'Kings stuck on the edge are easy fork targets. Look for a knight square that checks the king and simultaneously attacks the queen — the rim gives the king nowhere to hide.' },
    // PINS
    { id:'PN01', chapter:'Pins', title:'Take the Pinned Queen', desc:'White to play. The black queen is pinned to its king — capture it for free.',
      fen:'4k3/4q3/8/8/4R3/8/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'e4', to:'e7'}], hint:'The queen can\'t move aside — the king sits right behind it. Just take it.', difficulty:2,
      reply:{from:'e8', to:'e7'},
      payoff:'…the king recaptures, but you have won the queen for a rook.',
      concept:'In an absolute pin, a piece cannot move because its own king sits directly behind it. The pinned piece is frozen — you can pile up on it and win it without it ever escaping.' },
    { id:'PN02', chapter:'Pins', title:'Pin the Knight to the King', desc:'White to play. Pin the knight against the king so it cannot move.',
      fen:'3k4/3n4/8/8/8/8/8/3RK3 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d2'}, {from:'d1', to:'d3'}, {from:'d1', to:'d4'}, {from:'d1', to:'d5'}], hint:'Line your rook up on the file with the knight and the king behind it.', difficulty:2,
      concept:'To create a pin, line your rook, bishop, or queen up so an enemy piece stands between your attacker and a more valuable piece. The pinned piece is now stuck in place.' },
    { id:'PN03', chapter:'Pins', title:'Pile On the Pinned Piece', desc:'White to play. The black bishop is pinned to the king — capture it with the rook.',
      fen:'3rk3/8/3b4/8/3R4/8/8/3RK3 w - - 0 1', side:'w',
      solution:[{from:'d4', to:'d6'}], hint:'The bishop is pinned and now you attack it twice — take it.', difficulty:3,
      concept:'When a piece is pinned, attack it again. Since it cannot move and its defenders may be too few, adding a second attacker lets you win it outright.' },
    { id:'PN04', chapter:'Pins', title:'Win the Pinned Bishop', desc:'White to play. A black bishop is pinned to its king — capture it with your pawn.',
      fen:'4k3/8/8/4b3/3P4/8/8/4R1K1 w - - 0 1', side:'w',
      solution:[{from:'d4', to:'e5'}], hint:'The bishop is pinned against the king, so capture it for free with the pawn.', difficulty:2,
      reply:{from:'e8', to:'e7'},
      payoff:'…the king can only watch — you have won a clean piece.',
      concept:'A pinned piece is glued in place. Here a rook pins the bishop to its king, so the bishop cannot recapture — your pawn simply takes it and wins a piece.' },
    { id:'PN05', chapter:'Pins', title:'Pin and Win the Knight', desc:'White to play. Pin the knight to the queen, then snap it off with the bishop.',
      fen:'3qk3/8/8/8/8/6n1/8/B3K3 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'g7'}], hint:'Slide the bishop onto the diagonal where the knight blocks the queen.', difficulty:3,
      concept:'Bishops pin along diagonals. Place yours so an enemy knight is trapped in front of the queen — the knight cannot run without losing the queen, so it is effectively yours.' },
    // SKEWERS & DISCOVERED ATTACKS
    { id:'SK01', chapter:'Skewers & Discovered Attacks', title:'Skewer the King, Win the Queen', desc:'White to play. Check the king so it must step aside, exposing the queen behind it.',
      fen:'3qk3/8/8/8/8/8/8/3RK3 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'A skewer is a reverse pin: check the king and the queen behind it falls.', difficulty:2,
      reply:{from:'e8', to:'d8'},
      payoff:'…the king grabs the rook back, but the queen is won.',
      concept:'A skewer is a pin in reverse: the more valuable piece is in front. You check the king, it must move, and the piece hiding behind it is left hanging for you to take.' },
    { id:'SK02', chapter:'Skewers & Discovered Attacks', title:'Skewer Along the Diagonal', desc:'White to play. Check the king on the diagonal so the rook lined up behind it falls.',
      fen:'8/1r6/8/3k4/8/8/2B5/4K3 w - - 0 1', side:'w',
      solution:[{from:'c2', to:'e4'}], hint:'Slide the bishop to give check; the rook on the same diagonal behind the king is the prize.', difficulty:3,
      reply:{from:'d5', to:'d6'},
      payoff:'…the king slides off the diagonal and the rook falls.',
      concept:'Bishops and queens skewer along diagonals. Give check so the king must dodge, and whatever stood behind it on that diagonal is left hanging for you to take.' },
    { id:'SK03', chapter:'Skewers & Discovered Attacks', title:'Discovered Check', desc:'White to play. Move the bishop to uncover your rook\'s check down the e-file.',
      fen:'3qk3/8/8/8/8/4B3/8/4R1K1 w - - 0 1', side:'w',
      solution:[{from:'e3', to:'a7'}, {from:'e3', to:'b6'}, {from:'e3', to:'c5'}, {from:'e3', to:'d4'}, {from:'e3', to:'f4'}, {from:'e3', to:'g5'}, {from:'e3', to:'h6'}, {from:'e3', to:'d2'}, {from:'e3', to:'c1'}, {from:'e3', to:'f2'}], hint:'Any bishop move uncovers the rook checking the king down the e-file.', difficulty:3,
      reply:{from:'e8', to:'d7'},
      payoff:'…the king must answer the rook, and your bishop went wherever it pleased.',
      concept:'A discovered check happens when you move one piece out of the way to reveal a check from the piece behind it. The moving piece is free to go anywhere — even to grab material.' },
    { id:'SK04', chapter:'Skewers & Discovered Attacks', title:'Discovered Attack Wins the Queen', desc:'White to play. Unveil your rook\'s check while the knight jumps to attack the queen.',
      fen:'4k3/8/8/3q4/4N3/8/8/4R1K1 w - - 0 1', side:'w',
      solution:[{from:'e4', to:'f6'}, {from:'e4', to:'c5'}, {from:'e4', to:'d6'}, {from:'e4', to:'c3'}, {from:'e4', to:'g3'}, {from:'e4', to:'d2'}, {from:'e4', to:'f2'}, {from:'e4', to:'g5'}], hint:'Move the knight to f6: the rook checks the king while the knight also hits the queen.', difficulty:4,
      reply:{from:'e8', to:'f8'},
      payoff:'…the king must meet the check, then the knight snaps off the queen.',
      concept:'The deadliest discoveries hit two targets. While the unveiled piece gives check, the moving piece attacks something else. The opponent must answer the check and loses the other piece.' },
    { id:'SK05', chapter:'Skewers & Discovered Attacks', title:'Double Check', desc:'White to play. Leap the knight so the knight AND the uncovered rook both check the king.',
      fen:'4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1', side:'w',
      solution:[{from:'e4', to:'d6'}, {from:'e4', to:'f6'}], hint:'Find the knight jump that checks the king itself while revealing the rook behind it.', difficulty:4,
      reply:{from:'e8', to:'d8'},
      payoff:'…against a double check the king MUST move — nothing else works.',
      concept:'A double check attacks the king with two pieces at once. It cannot be blocked or met by capturing just one attacker — the king is forced to move, with no other option.' },
    // REMOVE THE GUARD
    { id:'RG01', chapter:'Remove the Guard', title:'Capture the Defender', desc:'White to play. A knight guards the back-rank square — take it so mate becomes possible.',
      fen:'6k1/5ppp/8/8/8/8/5n2/R5K1 w - - 0 1', side:'w',
      solution:[{from:'g1', to:'f2'}], hint:'That knight is the only thing guarding the mating square — remove it.', difficulty:2,
      reply:{from:'g7', to:'g6'},
      payoff:'…the guard is gone; next move Ra8 is mate.',
      concept:'Sometimes only one piece defends a key square. Remove that guard — by capturing or chasing it — and the square, or the mate behind it, falls into your hands.' },
    { id:'RG02', chapter:'Remove the Guard', title:'Trade Off the Last Defender', desc:'White to play. The black rook defends the back rank — exchange it and open the door.',
      fen:'r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'Swap rooks: once the defender is gone, the back rank is weak.', difficulty:2,
      concept:'Defenders can be removed by trading. Exchange off the piece that holds your opponent\'s position together, and the weakness it was covering is suddenly exposed.' },
    { id:'RG03', chapter:'Remove the Guard', title:'Capture the Guard of the Queen', desc:'White to play. A bishop defends the black queen — capture the bishop and the queen is loose.',
      fen:'3qk3/8/5b2/8/7B/8/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'h4', to:'f6'}], hint:'Take the piece that protects the queen; next move the queen hangs.', difficulty:3,
      reply:{from:'d8', to:'d7'},
      payoff:'…the guard is gone, so the queen must flee — and you have won a bishop.',
      concept:'Before you win a defended piece, deal with its defender. Capture or deflect the guard first, and the piece it was protecting becomes a free target on the next move.' },
    { id:'RG04', chapter:'Remove the Guard', title:'Remove the Knight That Holds the Fort', desc:'White to play. A knight is the lone guard of the mating square — eliminate it with your rook.',
      fen:'5rk1/5ppp/8/8/8/8/8/1n2R1K1 w - - 0 1', side:'w',
      solution:[{from:'e1', to:'b1'}], hint:'Capture the knight guarding the back rank; mate threats follow.', difficulty:2,
      concept:'Identify exactly what is defending the square you want, then take it. With the single guard gone, your heavy pieces dominate the weakened back rank.' },
    // ADVANCED TACTICS
    { id:'AT01', chapter:'Advanced Tactics', title:'Deflect the Defender', desc:'White to play. The black rook is the lone guard of the back rank — force it off with a check.',
      fen:'r5k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1', side:'w',
      solution:[{from:'e1', to:'e8'}], hint:'Give a check that the rook is forced to answer, pulling it away from its post.', difficulty:3,
      reply:{from:'a8', to:'e8'},
      payoff:'…the rook is dragged off the eighth rank — its defensive duty abandoned.',
      concept:'Deflection forces a defending piece away from a job it must do. Hit it with a check or threat it cannot ignore, and the square or piece it was guarding is suddenly undefended.' },
    { id:'AT02', chapter:'Advanced Tactics', title:'Decoy the King', desc:'White to play. Sacrifice the queen to lure the king onto a square where a knight fork wins it back with interest.',
      fen:'2r3k1/5p1p/8/1N5Q/8/8/1B6/6K1 w - - 0 1', side:'w',
      solution:[{from:'h5', to:'f7'}], hint:'Offer the queen on a square the king is forced to capture, landing it in a knight fork.', difficulty:4,
      reply:{from:'g8', to:'f7'},
      payoff:'…the king is decoyed to f7, where Nd6+ will fork king and rook.',
      concept:'A decoy lures an enemy piece — often the king — onto a fatal square. You give it something it must take; the square it lands on then falls victim to a fork or other blow.' },
    { id:'AT03', chapter:'Advanced Tactics', title:'Punish the Overloaded Piece', desc:'White to play. The black queen is doing two jobs at once — make it choose by capturing one of them.',
      fen:'3r2k1/3q1ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d7'}], hint:'The queen guards both the rook and the back rank. Take the rook and overload it.', difficulty:4,
      reply:{from:'d8', to:'d7'},
      payoff:'…the rook must recapture, abandoning the back rank to a mating rook.',
      concept:'An overloaded piece is defending two things at once. Attack one of its duties: when it answers there, the other duty is abandoned and the second target falls.' },
    { id:'AT04', chapter:'Advanced Tactics', title:'Interfere With the Defense', desc:'White to play. A black bishop defends c8 along the diagonal — plant a knight in the way to cut the line.',
      fen:'2r3k1/5ppp/b7/2N5/8/8/5PPP/2R3K1 w - - 0 1', side:'w',
      solution:[{from:'c5', to:'b7'}], hint:'Block the diagonal between the bishop and the square it guards by jumping a knight onto it.', difficulty:4,
      reply:{from:'a6', to:'b7'},
      payoff:'…the bishop captures, but the defensive line was broken — Rxc8 follows.',
      concept:'Interference breaks the line a defender needs. Drop a piece between the defender and what it protects, and even though you may lose that piece, the defense collapses for a move.' },
    { id:'AT05', chapter:'Advanced Tactics', title:'The In-Between Move (Zwischenzug)', desc:'White to play. Your knight is attacked — but instead of retreating, strike first with a forcing fork.',
      fen:'4k3/5q2/8/1b6/2N5/8/8/6K1 w - - 0 1', side:'w',
      solution:[{from:'c4', to:'d6'}], hint:'The bishop attacks your knight — but a knight check that also hits the queen comes first.', difficulty:4,
      reply:{from:'e8', to:'d7'},
      payoff:'…the in-between check is answered first; then the knight takes the queen.',
      concept:'A zwischenzug, or in-between move, is an unexpected reply inserted before the \'expected\' one. When your piece is attacked, look for a more forcing move — a check or threat — to play first.' },
    { id:'AT06', chapter:'Advanced Tactics', title:'Trap the Knight on the Rim', desc:'White to play. The black knight has strayed to the edge — push the pawn so every escape is cut off.',
      fen:'k7/8/8/7n/3B4/4P3/5PP1/6K1 w - - 0 1', side:'w',
      solution:[{from:'g2', to:'g4'}], hint:'Attack the knight with a pawn; its bishop and pawns already cover every flight square.', difficulty:3,
      reply:{from:'h5', to:'f6'},
      payoff:'…wherever the knight jumps it is covered — it cannot escape and will be won.',
      concept:'Trapping a piece means attacking it where it has no safe square. A piece on the rim is especially vulnerable — fence off its escape squares first, then attack it and win it.' },
    { id:'AT07', chapter:'Advanced Tactics', title:'Trap the Greedy Rook', desc:'White to play. The cornered black rook is boxed in by its own pieces — leap a knight at it.',
      fen:'rb4k1/p4ppp/8/8/2N5/8/8/6K1 w - - 0 1', side:'w',
      solution:[{from:'c4', to:'b6'}], hint:'The rook\'s own pawn blocks the file and its bishop blocks the rank — jump the knight to attack it.', difficulty:3,
      reply:{from:'b8', to:'d6'},
      payoff:'…the rook is hemmed in by its own pawn and bishop — there is no flight square.',
      concept:'A piece can be trapped by its own army. When a rook\'s own pawns and pieces block its escape, a single attacker is enough — it has nowhere to run and is simply lost.' },
    // OPENING PRINCIPLES
    { id:'OP01', chapter:'Opening Principles', title:'Claim the Center', desc:'White to play the first move. Stake your flag in the center with a pawn.',
      fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', side:'w',
      solution:[{from:'e2', to:'e4'}, {from:'d2', to:'d4'}], hint:'Push a central pawn two squares to grab space and free your pieces.', difficulty:1,
      concept:'Start the game by fighting for the center. Pushing the e- or d-pawn two squares grabs space, controls key squares, and opens lines for your bishop and queen.' },
    { id:'OP02', chapter:'Opening Principles', title:'Develop a Knight', desc:'White to play. Bring a knight toward the center where it controls the most squares.',
      fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1', side:'w',
      solution:[{from:'g1', to:'f3'}, {from:'b1', to:'c3'}], hint:'Knights belong near the center — develop one before your bishops.', difficulty:1,
      concept:'Get your pieces into the game early. Knights develop best toward the center, where they reach more squares. A common saying: knights before bishops.' },
    { id:'OP03', chapter:'Opening Principles', title:'Develop the Bishop (Italian)', desc:'White to play. Aim the light-squared bishop at the weak f7 square.',
      fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1', side:'w',
      solution:[{from:'f1', to:'c4'}], hint:'Bishop to c4 eyes f7, the most vulnerable square near the black king.', difficulty:2,
      concept:'After a knight, develop a bishop to an active diagonal. The Italian setup points the bishop at f7, the soft spot in Black\'s camp, putting early pressure on the king.' },
    { id:'OP04', chapter:'Opening Principles', title:'Castle Your King to Safety', desc:'White to play. Tuck the king into the corner behind its pawns by castling kingside.',
      fen:'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1', side:'w',
      solution:[{from:'e1', to:'g1'}], hint:'Castling moves the king two squares toward the rook and tucks it away safely.', difficulty:2,
      concept:'Castling whisks your king into safety behind a wall of pawns and connects your rooks. Do it early — a king caught in the center is a king in danger.' },
    { id:'OP05', chapter:'Opening Principles', title:'Don\'t Waste a Tempo', desc:'White to play. Instead of moving a developed piece again, bring out a new one.',
      fen:'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1', side:'w',
      solution:[{from:'f1', to:'b5'}, {from:'f1', to:'c4'}, {from:'b1', to:'c3'}], hint:'Develop a fresh piece rather than shuffling one you already moved.', difficulty:2,
      concept:'A tempo is a move\'s worth of time. Don\'t waste tempi moving the same piece twice in the opening — develop a new piece each turn and race to finish your setup.' },
    { id:'OP06', chapter:'Opening Principles', title:'Knight to the Rim Is Dim — Aim Central', desc:'White to play. Choose the central knight development, not the edge.',
      fen:'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1', side:'w',
      solution:[{from:'g1', to:'f3'}, {from:'b1', to:'c3'}], hint:'Develop the knight toward the middle — a knight on the rim controls fewer squares.', difficulty:1,
      concept:'A knight on the edge of the board reaches only a few squares — \'a knight on the rim is dim.\' Develop knights toward the center, where their power is greatest.' },
    // ENDGAME ESSENTIALS
    { id:'EG01', chapter:'Endgame Essentials', title:'Promote the Passed Pawn', desc:'White to play. Nothing can stop the runner — push it home to a queen.',
      fen:'8/4P3/4K3/8/8/8/8/7k w - - 0 1', side:'w',
      solution:[{from:'e7', to:'e8', promotion:'q'}], hint:'A passed pawn with a clear path should be promoted without delay.', difficulty:1,
      concept:'A passed pawn has no enemy pawns to stop it. In the endgame, escort it to the last rank and promote — a new queen usually decides the game on the spot.' },
    { id:'EG02', chapter:'Endgame Essentials', title:'Squeeze With King and Queen', desc:'White to play. Use the queen to shrink the enemy king\'s box one rank smaller.',
      fen:'8/8/4k3/8/3Q4/4K3/8/8 w - - 0 1', side:'w',
      solution:[{from:'d4', to:'d5'}, {from:'d4', to:'d6'}], hint:'Step the queen a knight\'s-move away to cut the king\'s space without stalemate.', difficulty:3,
      concept:'To mate with king and queen, herd the lone king toward the edge by shrinking its box. Keep the queen a safe distance away so you never accidentally stalemate.' },
    { id:'EG03', chapter:'Endgame Essentials', title:'Rook Behind the Passed Pawn', desc:'White to play. Put your rook behind the runner to support its march.',
      fen:'8/8/8/8/8/2P5/8/R3K2k w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a3'}, {from:'a1', to:'c1'}], hint:'Rooks belong behind passed pawns — yours or your opponent\'s.', difficulty:2,
      concept:'A golden rook-endgame rule: place the rook behind a passed pawn. Behind your own pawn it shoves it forward; behind the enemy\'s it holds the pawn back.' },
    { id:'EG04', chapter:'Endgame Essentials', title:'Take the Opposition', desc:'White to play. Step the king up to face the enemy king and seize the opposition.',
      fen:'4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'e6', to:'d6'}, {from:'e6', to:'f6'}], hint:'Sidestep so your king controls the squares in front of the pawn.', difficulty:3,
      concept:'The opposition is a king standoff: the player NOT to move is often worse off. Use it to seize key squares in front of your pawn and escort it safely to promotion.' },
    { id:'EG05', chapter:'Endgame Essentials', title:'Bring the King Into the Fight', desc:'White to play. March the king toward the center — in endgames it is a fighting piece.',
      fen:'8/4k3/8/8/8/4K3/4P3/8 w - - 0 1', side:'w',
      solution:[{from:'e3', to:'d4'}, {from:'e3', to:'e4'}, {from:'e3', to:'f4'}], hint:'With queens off the board, walk your king forward to support your pawns.', difficulty:2,
      concept:'Once the queens are gone, the king stops hiding and starts fighting. Centralize it: an active king shepherds pawns, attacks weaknesses, and is worth its weight in the endgame.' },
    { id:'EG06', chapter:'Endgame Essentials', title:'Stop the Enemy Passer', desc:'Black to play. A white pawn is running — get your rook behind it to halt the advance.',
      fen:'4k3/8/8/8/8/8/r2P4/3RK3 b - - 0 1', side:'b',
      solution:[{from:'a2', to:'d2'}], hint:'Plant your rook behind or in front of the runner to stop it cold.', difficulty:2,
      concept:'When the opponent has a dangerous passer, blockade or capture it before it queens. Here the rook swings over to take the pawn outright — the simplest way to stop a runner.' },
  ];
  window.CT_LESSONS = LESSONS;

  // -------------------- ACADEMY STATE --------------------
  let acadCurrent = null; // {lesson, chess, stepIndex}

  function chaptersInOrder() {
    const order = ['First Moves','Check & Escapes','Checkmate Basics','The Fork','Pins','Skewers & Discovered Attacks','Remove the Guard','Advanced Tactics','Opening Principles','Endgame Essentials'];
    const grouped = {};
    for (const l of LESSONS) (grouped[l.chapter] = grouped[l.chapter] || []).push(l);
    return order.filter(c => grouped[c]).map(c => ({ name: c, lessons: grouped[c] }));
  }
  function isCompleted(user, id) { return (user.lessonsCompleted || []).includes(id); }
  function isUnlocked(user, lesson) {
    // Locked unless previous lesson in flat order is complete (or it's the first).
    const flat = LESSONS;
    const idx = flat.findIndex(l => l.id === lesson.id);
    if (idx <= 0) return true;
    const prev = flat[idx - 1];
    return isCompleted(user, prev.id);
  }

  function moveMatchesAny(move, options) {
    return options.some(o => {
      if (o.san && o.san === move.san) return true;
      if (o.from && o.to) {
        if (o.from !== move.from || o.to !== move.to) return false;
        if (o.promotion && move.promotion && o.promotion !== move.promotion) return false;
        return true;
      }
      return false;
    });
  }

  function renderAcademy() {
    const u = CT.user;
    const rank = getRank(u);
    const wrap = document.getElementById('academy-content');
    if (!wrap) return;
    const completed = (u.lessonsCompleted || []).length;
    const total = LESSONS.length;
    const pct = Math.round((completed / total) * 100);

    let html = `<div class="card" style="display:flex;gap:12px;align-items:center">
      <div style="width:54px;height:54px">${CT.pieceSVG(rank.piece, 'w')}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:18px">${escapeHTML(rank.name)}</div>
        <div class="muted small">${completed} / ${total} lessons · ${pct}%</div>
        <div style="height:6px;background:var(--panel-2);border-radius:3px;overflow:hidden;margin-top:8px">
          <div style="width:${pct}%;height:100%;background:linear-gradient(90deg, var(--accent), #ffd97a)"></div>
        </div>
      </div>
    </div>`;

    const chs = chaptersInOrder();
    for (const ch of chs) {
      const chDone = ch.lessons.filter(l => isCompleted(u, l.id)).length;
      html += `<h3 style="margin-top:18px">${escapeHTML(ch.name)} <span class="muted small">${chDone}/${ch.lessons.length}</span></h3>`;
      html += `<div class="roadmap">`;
      ch.lessons.forEach((l, i) => {
        const done = isCompleted(u, l.id);
        const unlocked = isUnlocked(u, l);
        const isCurrent = !done && unlocked;
        const cls = done ? 'done' : (unlocked ? 'open' : 'locked');
        html += `<div class="lnode ${cls}" data-lid="${l.id}" title="${escapeHTML(l.title)}">
          <div class="dot">${done ? '✓' : (i + 1)}</div>
          <div class="ltitle">${escapeHTML(l.title)}</div>
          ${isCurrent ? `<div class="here">${CT.pieceSVG(rank.piece, 'w')}</div>` : ''}
        </div>`;
      });
      html += `</div>`;
    }

    wrap.innerHTML = '<div class="learn-tabs">' +
      '<button class="learn-tab active" data-ltab="lessons">Lessons</button>' +
      '<button class="learn-tab" data-ltab="library">Read &amp; Learn</button>' +
      '</div>' +
      '<div id="academy-lessons">' + html + '</div>' +
      '<div id="library-content" style="display:none"></div>';
    (function(){
      var tabs = wrap.querySelectorAll('.learn-tab');
      var lessonsEl = wrap.querySelector('#academy-lessons');
      var libEl = wrap.querySelector('#library-content');
      var libLoaded = false;
      tabs.forEach(function(t){
        t.addEventListener('click', function(){
          tabs.forEach(function(x){ x.classList.remove('active'); });
          t.classList.add('active');
          var which = t.dataset.ltab;
          if (which === 'library') {
            if (lessonsEl) lessonsEl.style.display = 'none';
            if (libEl) { libEl.style.display = 'block';
              if (window.CT_renderLibrary) window.CT_renderLibrary(libEl); }
          } else {
            if (libEl) libEl.style.display = 'none';
            if (lessonsEl) lessonsEl.style.display = 'block';
          }
        });
      });
    })();
    wrap.querySelectorAll('.lnode').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.lid;
        const lesson = LESSONS.find(l => l.id === id);
        if (!lesson) return;
        if (!isUnlocked(u, lesson)) {
          CT.toast('Complete the previous lesson first.');
          return;
        }
        startLesson(lesson);
      });
    });
  }
  window.CT_renderAcademy = renderAcademy;

  function startLesson(lesson) {
    const Chess = window.Chess;
    if (!Chess) { CT.toast('chess.js not loaded'); return; }
    acadCurrent = {
      lesson,
      chess: new Chess(lesson.fen),
      selected: null,
      legalTargets: [],
      attempts: 0,
      solved: false,
      demoing: false,
      hintStage: 0, // graduated hints: 0 = none shown yet, 1..3 escalating
    };
    document.getElementById('lesson-title').textContent = lesson.title;
    document.getElementById('lesson-chapter').textContent = lesson.chapter + ' · Difficulty ' + lesson.difficulty;
    document.getElementById('lesson-desc').textContent = lesson.desc;
    document.getElementById('lesson-side').textContent = (lesson.side === 'w' ? 'White' : 'Black') + ' to move';
    document.getElementById('lesson-feedback').textContent = '';
    document.getElementById('lesson-next').style.display = 'none';
    // Set the concept teaching text
    const conceptEl = document.getElementById('lesson-concept');
    if (conceptEl) conceptEl.textContent = getConcept(lesson);
    // Reset demo button label
    const demoBtn = document.getElementById('lesson-demo');
    if (demoBtn) demoBtn.textContent = '👁 Watch example';
    renderLessonBoard();
    CT.showScreen && CT.showScreen('lesson');
  }
  // Watch an example: play the solution move automatically, pause, then reset for user to try.
  function watchExample() {
    const cur = acadCurrent;
    if (!cur || cur.demoing) return;
    if (cur.solved) { resetLesson(); return; }
    const s = cur.lesson.solution[0];
    if (!s) return;
    cur.demoing = true;
    document.getElementById('lesson-feedback').innerHTML = '<span style="color:var(--accent);font-weight:700">Watching example…</span>';
    document.getElementById('lesson-demo').textContent = '⏳ Playing…';
    // Highlight the from-square first
    cur.selected = s.from;
    cur.legalTargets = [s.to];
    renderLessonBoard();
    setTimeout(() => {
      // Apply the move
      const moveCfg = { from: s.from, to: s.to };
      if (s.promotion) moveCfg.promotion = s.promotion;
      cur.chess.move(moveCfg);
      cur.selected = null;
      cur.legalTargets = [];
      renderLessonBoard();
      // Show feedback and reset
      setTimeout(() => {
        document.getElementById('lesson-feedback').innerHTML = '<span class="muted small">That is the idea — now try it yourself.</span>';
        document.getElementById('lesson-demo').textContent = '👁 Watch again';
        cur.chess = new window.Chess(cur.lesson.fen);
        cur.demoing = false;
        cur.attempts = 0;
        renderLessonBoard();
      }, 1500);
    }, 800);
  }

  function renderLessonBoard() {
    const Chess = window.Chess;
    const cur = acadCurrent;
    const boardEl = document.getElementById('lesson-board');
    if (!boardEl || !cur) return;
    boardEl.innerHTML = '';
    const FILES = ['a','b','c','d','e','f','g','h'];
    const board = cur.chess.board();
    const orientation = cur.lesson.side; // show from the perspective of the player to move
    const ranksOrder = orientation === 'w' ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const filesOrder = orientation === 'w' ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
    for (const r of ranksOrder) {
      for (const f of filesOrder) {
        const isLight = (r + f) % 2 === 1;
        const name = FILES[f] + (r + 1);
        const sq = document.createElement('div');
        sq.className = 'sq ' + (isLight ? 'light' : 'dark');
        sq.dataset.sq = name;
        const piece = board[7 - r][f];
        if (piece) sq.innerHTML = CT.pieceSVG(piece.type, piece.color);
        if (cur.selected === name) sq.classList.add('selected');
        if (cur.legalTargets.includes(name)) {
          const dot = document.createElement('span');
          dot.className = piece ? 'ring' : 'dot';
          sq.appendChild(dot);
        }
        sq.addEventListener('click', () => onLessonSquareClick(name));
        boardEl.appendChild(sq);
      }
    }
  }

  function onLessonSquareClick(name) {
    const cur = acadCurrent;
    if (!cur || cur.solved) return;
    const chess = cur.chess;
    const turn = chess.turn();
    const piece = chess.get(name);
    if (cur.selected) {
      if (cur.selected === name) { cur.selected = null; cur.legalTargets = []; renderLessonBoard(); return; }
      // Attempt move
      const candidates = chess.moves({ square: cur.selected, verbose: true }).filter(m => m.to === name);
      let move;
      if (candidates.length === 1) {
        move = chess.move({ from: cur.selected, to: name });
      } else if (candidates.length > 1) {
        // Promotion or otherwise — default to queen
        move = chess.move({ from: cur.selected, to: name, promotion: 'q' });
      }
      if (move) {
        evaluateLessonMove(move);
        cur.selected = null;
        cur.legalTargets = [];
        renderLessonBoard();
        return;
      }
      // Maybe clicked own piece — re-select
      if (piece && piece.color === turn) {
        cur.selected = name;
        cur.legalTargets = chess.moves({ square: name, verbose: true }).map(m => m.to);
        renderLessonBoard();
        return;
      }
      cur.selected = null;
      cur.legalTargets = [];
      renderLessonBoard();
      return;
    }
    if (piece && piece.color === turn) {
      cur.selected = name;
      cur.legalTargets = chess.moves({ square: name, verbose: true }).map(m => m.to);
      renderLessonBoard();
    }
  }

  function evaluateLessonMove(move) {
    const cur = acadCurrent;
    const solution = cur.lesson.solution; // accept any of these as correct
    if (moveMatchesAny(move, solution)) {
      cur.solved = true;
      document.getElementById('lesson-feedback').innerHTML = '<span style="color:var(--success);font-weight:700">✓ Correct!</span>';
      const u = CT.user;
      if (!isCompleted(u, cur.lesson.id)) {
        u.lessonsCompleted = u.lessonsCompleted || [];
        u.lessonsCompleted.push(cur.lesson.id);
        const db = CT.loadDB();
        db.users[u.id] = u;
        CT.saveDB(db);
        CT.toast('Lesson complete! 🎉', true);
        if (window.CT_syncProgress) window.CT_syncProgress();
      }
      // Reveal Next button
      document.getElementById('lesson-next').style.display = '';
      // Show the payoff: play the opponent's forced/typical reply so the point of
      // the tactic (the queen actually falling, etc.) plays out on the board.
      // Completion/credit above is unchanged — this is purely a visual follow-up.
      maybePlayReply(cur, move);
    } else {
      cur.attempts++;
      // Undo the wrong move so they can try again
      cur.chess.undo();
      document.getElementById('lesson-feedback').innerHTML = `<span style="color:var(--danger);font-weight:700">Not quite.</span> <span class="muted small">Try again.</span>${cur.attempts >= 2 ? `<div class="muted small" style="margin-top:6px">Hint: ${escapeHTML(cur.lesson.hint)}</div>` : ''}`;
    }
  }

  // Animate the opponent's forced/typical reply (the "payoff") after a correct move.
  // The reply is authored to be legal in the position after the lesson's solution[0];
  // we still guard against the player having chosen a different accepted alternative
  // by checking legality in the live position before playing it.
  function maybePlayReply(cur, playerMove) {
    const reply = cur.lesson && cur.lesson.reply;
    if (!reply || !reply.from || !reply.to) return;
    setTimeout(() => {
      // Bail out if the lesson was reset / navigated away in the meantime.
      if (acadCurrent !== cur || !cur.solved) return;
      const chess = cur.chess;
      const legal = chess.moves({ square: reply.from, verbose: true })
        .some(m => m.to === reply.to && (!reply.promotion || m.promotion === reply.promotion));
      if (!legal) return;
      const cfg = { from: reply.from, to: reply.to };
      if (reply.promotion) cfg.promotion = reply.promotion;
      const done = chess.move(cfg);
      if (!done) return;
      // Briefly highlight the reply, then render it.
      cur.selected = reply.to;
      cur.legalTargets = [];
      renderLessonBoard();
      const caption = cur.lesson.payoff || '…and the point of the move is revealed.';
      const fb = document.getElementById('lesson-feedback');
      if (fb) {
        fb.innerHTML = '<span style="color:var(--success);font-weight:700">✓ Correct!</span>' +
          ' <span class="muted small">' + escapeHTML(caption) + '</span>';
      }
    }, 600);
  }

  // Lesson controls
  function nextLesson() {
    const cur = acadCurrent;
    if (!cur) { CT.showScreen('academy'); return; }
    const idx = LESSONS.findIndex(l => l.id === cur.lesson.id);
    const next = LESSONS[idx + 1];
    if (next) startLesson(next);
    else CT.showScreen('academy');
  }
  function resetLesson() {
    if (!acadCurrent) return;
    acadCurrent.chess = new window.Chess(acadCurrent.lesson.fen);
    acadCurrent.solved = false;
    acadCurrent.attempts = 0;
    acadCurrent.selected = null;
    acadCurrent.legalTargets = [];
    acadCurrent.hintStage = 0;
    document.getElementById('lesson-feedback').textContent = '';
    document.getElementById('lesson-next').style.display = 'none';
    renderLessonBoard();
  }
  // Graduated hints: each press escalates.
  //   1) conceptual nudge (theme line)   2) name the piece to move
  //   3) reveal the from-square (never the destination)
  function hintLesson() {
    const cur = acadCurrent;
    if (!cur) return;
    cur.hintStage = Math.min((cur.hintStage || 0) + 1, 3);
    const lesson = cur.lesson;
    let msg;
    if (cur.hintStage === 1) {
      // Conceptual nudge: prefer the short hint theme, trimmed to one sentence.
      const full = lesson.hint || getConcept(lesson) || '';
      const m = full.match(/^[^.!?]*[.!?]/);
      const theme = (m ? m[0] : full).trim();
      msg = 'Think about the idea: ' + escapeHTML(theme);
    } else if (cur.hintStage === 2) {
      // Name the piece to move (derived from the solution's from-square).
      const from = lesson.solution && lesson.solution[0] && lesson.solution[0].from;
      const pc = from ? cur.chess.get(from) : null;
      const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
      const name = pc ? (names[pc.type] || 'piece') : 'piece';
      msg = 'Move your <b>' + name + '</b>.';
    } else {
      // Reveal the from-square only (never the destination).
      const from = lesson.solution && lesson.solution[0] && lesson.solution[0].from;
      msg = 'The piece to move is on <b>' + escapeHTML(from || '?') + '</b>. Now find its best square.';
    }
    document.getElementById('lesson-feedback').innerHTML =
      '<span class="muted small">Hint (' + cur.hintStage + '/3): ' + msg + '</span>';
  }
  function showLessonSolution() {
    if (!acadCurrent) return;
    const s = acadCurrent.lesson.solution[0];
    const txt = s.san ? s.san : (s.from + '→' + s.to + (s.promotion ? '=' + s.promotion.toUpperCase() : ''));
    document.getElementById('lesson-feedback').innerHTML = `<span class="muted small">Solution: <b>${escapeHTML(txt)}</b></span>`;
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // -------------------- SETTINGS UI --------------------
  function renderSettings() {
    const u = CT.user;
    if (!u) return;
    const bWrap = document.getElementById('settings-boards');
    const pWrap = document.getElementById('settings-pieces');
    if (!bWrap || !pWrap) return;
    bWrap.innerHTML = Object.keys(BOARD_THEMES).map(k => {
      const b = BOARD_THEMES[k];
      const active = u.themeBoard === k;
      return `<div class="theme-card ${active ? 'active' : ''}" data-board="${k}">
        <div class="theme-preview"><div style="background:${b.light}"></div><div style="background:${b.dark}"></div><div style="background:${b.dark}"></div><div style="background:${b.light}"></div></div>
        <div class="theme-label">${b.label}</div>
      </div>`;
    }).join('');
    pWrap.innerHTML = Object.keys(PIECE_THEMES).map(k => {
      const p = PIECE_THEMES[k];
      const active = u.themePieces === k;
      const previewLight = renderPiecePreview('q', 'w', p);
      const previewDark = renderPiecePreview('q', 'b', p);
      return `<div class="theme-card ${active ? 'active' : ''}" data-pieces="${k}">
        <div class="theme-preview piece" style="background:linear-gradient(90deg,#cbd5e1 50%,#475569 50%)">
          ${previewLight}${previewDark}
        </div>
        <div class="theme-label">${p.label}</div>
      </div>`;
    }).join('');
    bWrap.querySelectorAll('.theme-card').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.board;
        u.themeBoard = key;
        const db = CT.loadDB();
        db.users[u.id] = u;
        CT.saveDB(db);
        applyThemes(u.themeBoard, u.themePieces);
        renderSettings();
      });
    });
    pWrap.querySelectorAll('.theme-card').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.pieces;
        u.themePieces = key;
        const db = CT.loadDB();
        db.users[u.id] = u;
        CT.saveDB(db);
        applyThemes(u.themeBoard, u.themePieces);
        renderSettings();
      });
    });
  }
  function renderPiecePreview(type, color, theme) {
    const fill = color === 'w' ? theme.lightFill : theme.darkFill;
    const stroke = color === 'w' ? theme.lightStroke : theme.darkStroke;
    return `<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" style="width:30px;height:30px;display:inline-block;vertical-align:middle"><path d="M9 14l3 15h21l3-15-5 4-3-8-3 9-3-10-3 10-3-9-3 8z" fill="${fill}" stroke="${stroke}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  }
  window.CT_renderSettings = renderSettings;

  // Update the lobby's rank card
  function renderRankCard() {
    const u = CT.user; if (!u) return;
    const rank = getRank(u);
    const iconEl = document.getElementById('rank-icon');
    const nameEl = document.getElementById('rank-name');
    const progEl = document.getElementById('rank-progress');
    if (iconEl) iconEl.innerHTML = CT.pieceSVG(rank.piece, 'w');
    if (nameEl) nameEl.textContent = rank.name;
    if (progEl) progEl.textContent = `${(u.lessonsCompleted || []).length} / ${LESSONS.length} lessons completed`;
  }

  function init() {
    const tryStart = () => {
      const u = CT.user;
      if (u) applyThemes(u.themeBoard || 'forest', u.themePieces || 'classic');
    };
    tryStart();

    function onScreenActivate(id, fn) {
      const el = document.getElementById('screen-' + id);
      if (!el) return;
      const obs = new MutationObserver(() => {
        if (el.classList.contains('active')) fn();
      });
      obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    }
    onScreenActivate('auth', tryStart);
    onScreenActivate('lobby', renderRankCard);
    onScreenActivate('academy', renderAcademy);
    onScreenActivate('settings', renderSettings);

    document.querySelectorAll('#bottom-nav .nav-item').forEach(n => {
      if (n.dataset.nav === 'academy') n.addEventListener('click', () => setTimeout(renderAcademy, 0));
      if (n.dataset.nav === 'settings') n.addEventListener('click', () => setTimeout(renderSettings, 0));
    });

    const btnNext = document.getElementById('lesson-next');
    if (btnNext) btnNext.addEventListener('click', nextLesson);
    const btnReset = document.getElementById('lesson-reset');
    if (btnReset) btnReset.addEventListener('click', resetLesson);
    const btnHint = document.getElementById('lesson-hint');
    if (btnHint) btnHint.addEventListener('click', hintLesson);
    const btnSol = document.getElementById('lesson-solution');
    if (btnSol) btnSol.addEventListener('click', showLessonSolution);
    const btnDemo = document.getElementById('lesson-demo');
    if (btnDemo) btnDemo.addEventListener('click', watchExample);
    const btnBack = document.getElementById('lesson-back');
    if (btnBack) btnBack.addEventListener('click', () => CT.showScreen('academy'));

    const btnAcademy = document.getElementById('btn-academy');
    if (btnAcademy) btnAcademy.addEventListener('click', () => { CT.showScreen('academy'); renderAcademy(); });
    const btnSettings = document.getElementById('btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', () => { CT.showScreen('settings'); renderSettings(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
