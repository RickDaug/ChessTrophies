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
  // Rank determined by lessons completed.
  const RANKS = [
    { min: 0,   piece: 'p', name: 'Novice'      },
    { min: 5,   piece: 'p', name: 'Pawn II'     },
    { min: 10,  piece: 'n', name: 'Apprentice'  },
    { min: 20,  piece: 'n', name: 'Apprentice II'},
    { min: 30,  piece: 'b', name: 'Adept'       },
    { min: 50,  piece: 'b', name: 'Adept II'    },
    { min: 75,  piece: 'r', name: 'Expert'      },
    { min: 100, piece: 'r', name: 'Expert II'   },
    { min: 150, piece: 'q', name: 'Master'      },
    { min: 250, piece: 'k', name: 'Grandmaster' },
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
    // Try the full id prefix first (e.g. 'BR' from 'BR01'), then chapter letter.
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
    // FOUNDATIONS — piece movement and basic mates
    { id:'F01', chapter:'Foundations', title:'Pawn Captures Diagonally', desc:'White to play. Capture the black knight with your pawn.',
      fen:'8/8/8/3n4/4P3/8/8/4K2k w - - 0 1', side:'w',
      solution:[{from:'e4', to:'d5'}], hint:'Pawns move forward but capture diagonally.' , difficulty:1 },
    { id:'F02', chapter:'Foundations', title:'Knight L-Move', desc:'White to play. Use the knight to fork the king and rook.',
      fen:'r3k3/8/N7/8/8/8/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'a6', to:'c7'}], hint:'Find the L-shape that attacks both the king and the rook.', difficulty:2 },
    { id:'F03', chapter:'Foundations', title:'Bishop Long Diagonal', desc:'White to play. Pin the rook to the king.',
      fen:'r3k3/8/8/8/8/8/8/B3K3 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'h8'}], hint:'Travel the longest diagonal.', difficulty:2 },
    { id:'F04', chapter:'Foundations', title:'Rook on the 7th', desc:'White to play. Win the unprotected piece.',
      fen:'4k3/4n3/8/8/8/8/4R3/4K3 w - - 0 1', side:'w',
      solution:[{from:'e2', to:'e7'}], hint:'Rooks love open files.', difficulty:1 },
    { id:'F05', chapter:'Foundations', title:'Queen Forks Rook and Mate', desc:'White to play. Threaten mate and win the rook in one move.',
      fen:'4k2r/8/8/8/8/8/8/3QK3 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'A queen check that also lines up on the rook.', difficulty:3 },
    { id:'F06', chapter:'Foundations', title:'Promote the Pawn', desc:'White to play. Promote to a queen.',
      fen:'8/4P3/8/8/8/8/8/k3K3 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'e8', promotion:'q'}], hint:'A pawn reaching the 8th rank can promote.', difficulty:1 },
    { id:'F07', chapter:'Foundations', title:'Castle Kingside', desc:'White to play. Castle to safety.',
      fen:'r3k2r/pppq1ppp/2n5/3pp3/3PP3/2N5/PPPQ1PPP/R3K2R w KQkq - 0 1', side:'w',
      solution:[{from:'e1', to:'g1'}], hint:'King hops two squares toward the rook.', difficulty:2 },
    { id:'F08', chapter:'Foundations', title:'Capture the Queening Pawn', desc:'Black to play. Capture the queening pawn.',
      fen:'4k3/8/8/8/8/8/r7/3PK3 b - - 0 1', side:'b',
      solution:[{from:'a2', to:'d2'}], hint:'Use your rook actively.', difficulty:2 },

    // MATE IN 1
    { id:'M01', chapter:'Mate in 1', title:'Rook Delivers the Back-Rank Mate', desc:'White to play and mate in one.',
      fen:'6k1/5ppp/8/8/8/8/8/4R2K w - - 0 1', side:'w',
      solution:[{from:'e1', to:'e8'}], hint:'King is stuck behind his pawns.', difficulty:1 },
    { id:'M02', chapter:'Mate in 1', title:'Smothered Mate', desc:'White to play and deliver smothered mate with the knight.',
      fen:'6rk/6pp/8/4N3/8/8/8/4K3 w - - 0 1', side:'w',
      solution:[{from:'e5', to:'f7'}], hint:'The king is smothered by its own pieces — the knight slips in.', difficulty:3 },
    { id:'M03', chapter:'Mate in 1', title:'Queen and King', desc:'White to play and mate in one.',
      fen:'7k/6Q1/6K1/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'g7', to:'h7'}], hint:'King defends the queen as it delivers mate.', difficulty:1 },
    { id:'M04', chapter:'Mate in 1', title:'Promotion Mate', desc:'White to play. Promote and mate in one.',
      fen:'7k/6P1/8/8/8/8/8/6RK w - - 0 1', side:'w',
      solution:[{from:'g7', to:'g8', promotion:'q'}], hint:'Promote with rook support — the new queen is defended.', difficulty:3 },
    { id:'M05', chapter:'Mate in 1', title:'Queen Mate', desc:'White to play and mate in one.',
      fen:'6k1/6pp/4Q3/7K/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'e6', to:'e8'}], hint:'Slide to the back rank — the pawns block escape.', difficulty:2 },
    { id:'M06', chapter:'Mate in 1', title:'Long Diagonal Mate', desc:'White to play and mate in one.',
      fen:'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1', side:'w',
      solution:[{from:'f3', to:'f7'}], hint:'Famous "Scholar\'s Mate" idea.', difficulty:2 },
    { id:'M07', chapter:'Mate in 1', title:'Back-Rank Sweep', desc:'White to play and deliver mate on the back rank.',
      fen:'7k/6pp/8/8/8/8/8/1R4K1 w - - 0 1', side:'w',
      solution:[{from:'b1', to:'b8'}], hint:'Slide along the open file to the eighth rank.', difficulty:2 },
    { id:'M08', chapter:'Mate in 1', title:'Anastasia\'s Mate', desc:'White to play and mate in one — knight and rook combine.',
      fen:'8/4N1pk/8/R7/8/8/8/2K5 w - - 0 1', side:'w',
      solution:[{from:'a5', to:'h5'}], hint:'The knight cuts off escape; bring the rook to the h-file.', difficulty:4 },
    { id:'M09', chapter:'Mate in 1', title:'Queen Lift Mate', desc:'White to play and mate in one with the queen.',
      fen:'6k1/5ppp/8/8/8/8/8/3Q2K1 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'Slide the queen down the open file to the back rank.', difficulty:2 },
    { id:'M10', chapter:'Mate in 1', title:'Rook Battery', desc:'White to play and deliver back-rank mate.',
      fen:'6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'The pawns trap the king; deliver checkmate on the back rank.', difficulty:2 },

    // TACTICS — pins, forks, skewers, discovered attacks
    { id:'T01', chapter:'Tactics', title:'Royal Fork', desc:'White to play. Fork king and queen with the knight.',
      fen:'r1bqk2r/pppp1ppp/2n2n2/4p3/1bB1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1', side:'w',
      solution:[{from:'c4', to:'f7'}], hint:'A familiar Italian Game motif.', difficulty:3 },
    { id:'T02', chapter:'Tactics', title:'Absolute Pin', desc:'White to play. Pin the queen to the king.',
      fen:'4k3/4q3/8/8/8/8/4R3/4K3 w - - 0 1', side:'w',
      solution:[{from:'e2', to:'e7'}], hint:'The queen can\'t move without exposing the king.', difficulty:2 },
    { id:'T03', chapter:'Tactics', title:'Skewer the King', desc:'White to play. Skewer the king to win the queen.',
      fen:'q7/8/8/8/k7/8/8/2R3K1 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'a1'}], hint:'Check with the rook so the king must step off the file, then capture the queen behind it.', difficulty:3 },
    { id:'T04', chapter:'Tactics', title:'Discovered Check', desc:'White to play. Move the knight to discover check and win the rook.',
      fen:'4k3/8/8/8/r3N3/8/8/4R1K1 w - - 0 1', side:'w',
      solution:[{from:'e4', to:'c3'}, {from:'e4', to:'c5'}, {from:'e4', to:'d6'}, {from:'e4', to:'f6'}, {from:'e4', to:'g5'}, {from:'e4', to:'g3'}, {from:'e4', to:'f2'}, {from:'e4', to:'d2'}], hint:'Any knight move uncovers the rook on e1 — they all discover check. Nc3 also attacks the rook.', difficulty:3 },
    { id:'T05', chapter:'Tactics', title:'Remove the Defender', desc:'White to play. Capture the piece defending the queen.',
      fen:'r2q1rk1/ppp2ppp/2n5/3p4/3P4/2N2N2/PP3PPP/R2QR1K1 w - - 0 1', side:'w',
      solution:[{from:'c3', to:'d5'}], hint:'If you trade the defender, the queen falls.', difficulty:4 },
    { id:'T06', chapter:'Tactics', title:'Deflection', desc:'White to play. Deflect the rook from defending mate.',
      fen:'4r1k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'Sacrifice the queen to deflect the rook!', difficulty:4 },
    { id:'T07', chapter:'Tactics', title:'Queen Double Attack', desc:'White to play. One queen move attacks both the rook and the bishop.',
      fen:'1k2r3/8/8/8/8/8/8/2KQ3b w - - 0 1', side:'w',
      solution:[{from:'d1', to:'h5'}], hint:'Find a queen move that hits both pieces at once.', difficulty:3 },
    { id:'T08', chapter:'Tactics', title:'Back-Rank Tactic', desc:'White to play. Win material exploiting the back rank.',
      fen:'r5k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'Trade rooks — but the back rank lingers.', difficulty:2 },

    // OPENINGS — principles
    { id:'O01', chapter:'Openings', title:'Control the Center', desc:'White to play the most principled first move.',
      fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', side:'w',
      solution:[{from:'e2', to:'e4'}, {from:'d2', to:'d4'}], hint:'Stake a claim in the center.', difficulty:1 },
    { id:'O02', chapter:'Openings', title:'Develop a Knight', desc:'White to play. Develop a knight to a central square.',
      fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1', side:'w',
      solution:[{from:'g1', to:'f3'}], hint:'Knights before bishops — toward the center.', difficulty:1 },
    { id:'O03', chapter:'Openings', title:'Italian Game', desc:'White to play. Develop the light-squared bishop actively.',
      fen:'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 1', side:'w',
      solution:[{from:'f1', to:'c4'}], hint:'Aim at the weak f7 square.', difficulty:2 },
    { id:'O04', chapter:'Openings', title:'Castle Early', desc:'White to play. Tuck the king to safety.',
      fen:'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1', side:'w',
      solution:[{from:'e1', to:'g1'}], hint:'Don\'t leave the king in the center too long.', difficulty:2 },

    // ENDGAMES
    { id:'E01', chapter:'Endgames', title:'Pawn Promotion Race', desc:'White to play. Push the pawn safely.',
      fen:'8/4P3/4K3/8/8/8/8/7k w - - 0 1', side:'w',
      solution:[{from:'e7', to:'e8', promotion:'q'}], hint:'Promote!', difficulty:1 },
    { id:'E02', chapter:'Endgames', title:'King and Queen vs King', desc:'White to play. Take the opposition and prepare mate.',
      fen:'4k3/8/4K3/3Q4/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'d5', to:'d7'}, {from:'d5', to:'e5'}], hint:'Squeeze the king toward the edge.', difficulty:3 },
    { id:'E03', chapter:'Endgames', title:'Rook Cuts Off', desc:'White to play. Cut off the black king with the rook.',
      fen:'4k3/8/4K3/8/8/8/8/3R4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}, {from:'d1', to:'d7'}], hint:'Box in the king with the rook on the d-file.', difficulty:2 },
    { id:'E04', chapter:'Endgames', title:'Stop the Pawn', desc:'White to play. King and rook stop the passed pawn.',
      fen:'4k3/8/8/8/8/8/p7/3RK3 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'a1'}], hint:'Get behind the runner.', difficulty:2 },
    { id:'E05', chapter:'Endgames', title:'Active King', desc:'White to play. March the king toward the center.',
      fen:'8/4k3/8/8/4K3/8/4P3/8 w - - 0 1', side:'w',
      solution:[{from:'e4', to:'d5'}, {from:'e4', to:'e5'}, {from:'e4', to:'f5'}], hint:'In endgames the king is a fighter — push it forward.', difficulty:2 },

    // === GENERATED MATE-IN-1 + PROMOTION PUZZLES ===
    { id:'BR01', chapter:'Mate in 1', title:'A-File Mate vs King on e8', desc:'White to play and mate in one with the rook.',
      fen:'4k3/3ppp2/8/8/8/8/7K/R7 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR02', chapter:'Mate in 1', title:'B-File Mate vs King on e8', desc:'White to play and mate in one with the rook.',
      fen:'4k3/3ppp2/8/8/8/8/7K/1R6 w - - 0 1', side:'w',
      solution:[{from:'b1', to:'b8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR03', chapter:'Mate in 1', title:'C-File Mate vs King on e8', desc:'White to play and mate in one with the rook.',
      fen:'4k3/3ppp2/8/8/8/8/7K/2R5 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'c8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR04', chapter:'Mate in 1', title:'Rook Lifts from a2 to Mate e8', desc:'White to play and mate in one with the rook.',
      fen:'4k3/3ppp2/8/8/8/8/R6K/8 w - - 0 1', side:'w',
      solution:[{from:'a2', to:'a8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR05', chapter:'Mate in 1', title:'Rook Lifts from b2 to Mate e8', desc:'White to play and mate in one with the rook.',
      fen:'4k3/3ppp2/8/8/8/8/1R5K/8 w - - 0 1', side:'w',
      solution:[{from:'b2', to:'b8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR06', chapter:'Mate in 1', title:'Rook Lifts from c2 to Mate e8', desc:'White to play and mate in one with the rook.',
      fen:'4k3/3ppp2/8/8/8/8/2R4K/8 w - - 0 1', side:'w',
      solution:[{from:'c2', to:'c8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR07', chapter:'Mate in 1', title:'H-File Swing to the Back Rank', desc:'White to play and mate in one with the rook.',
      fen:'4k3/3ppp2/8/8/8/8/6KR/8 w - - 0 1', side:'w',
      solution:[{from:'h2', to:'h8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR08', chapter:'Mate in 1', title:'A-File Mate vs King on f8', desc:'White to play and mate in one with the rook.',
      fen:'5k2/4ppp1/8/8/8/8/7K/R7 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR09', chapter:'Mate in 1', title:'B-File Mate vs King on f8', desc:'White to play and mate in one with the rook.',
      fen:'5k2/4ppp1/8/8/8/8/7K/1R6 w - - 0 1', side:'w',
      solution:[{from:'b1', to:'b8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR10', chapter:'Mate in 1', title:'C-File Mate vs King on f8', desc:'White to play and mate in one with the rook.',
      fen:'5k2/4ppp1/8/8/8/8/7K/2R5 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'c8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR11', chapter:'Mate in 1', title:'D-File Mate vs King on f8', desc:'White to play and mate in one with the rook.',
      fen:'5k2/4ppp1/8/8/8/8/7K/3R4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR12', chapter:'Mate in 1', title:'Second-Rank Lift vs King on f8', desc:'White to play and mate in one with the rook.',
      fen:'5k2/4ppp1/8/8/8/8/R6K/8 w - - 0 1', side:'w',
      solution:[{from:'a2', to:'a8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR13', chapter:'Mate in 1', title:'B-File Lift vs King on f8', desc:'White to play and mate in one with the rook.',
      fen:'5k2/4ppp1/8/8/8/8/1R5K/8 w - - 0 1', side:'w',
      solution:[{from:'b2', to:'b8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR14', chapter:'Mate in 1', title:'C-File Lift vs King on f8', desc:'White to play and mate in one with the rook.',
      fen:'5k2/4ppp1/8/8/8/8/2R4K/8 w - - 0 1', side:'w',
      solution:[{from:'c2', to:'c8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR15', chapter:'Mate in 1', title:'H-File Swing vs King on f8', desc:'White to play and mate in one with the rook.',
      fen:'5k2/4ppp1/8/8/8/8/6KR/8 w - - 0 1', side:'w',
      solution:[{from:'h2', to:'h8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR16', chapter:'Mate in 1', title:'A-File Mate vs King on g8', desc:'White to play and mate in one with the rook.',
      fen:'6k1/5ppp/8/8/8/8/7K/R7 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR17', chapter:'Mate in 1', title:'B-File Mate vs King on g8', desc:'White to play and mate in one with the rook.',
      fen:'6k1/5ppp/8/8/8/8/7K/1R6 w - - 0 1', side:'w',
      solution:[{from:'b1', to:'b8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR18', chapter:'Mate in 1', title:'C-File Mate vs King on g8', desc:'White to play and mate in one with the rook.',
      fen:'6k1/5ppp/8/8/8/8/7K/2R5 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'c8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR19', chapter:'Mate in 1', title:'D-File Mate vs King on g8', desc:'White to play and mate in one with the rook.',
      fen:'6k1/5ppp/8/8/8/8/7K/3R4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR20', chapter:'Mate in 1', title:'E-File Mate vs King on g8', desc:'White to play and mate in one with the rook.',
      fen:'6k1/5ppp/8/8/8/8/7K/4R3 w - - 0 1', side:'w',
      solution:[{from:'e1', to:'e8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR21', chapter:'Mate in 1', title:'A-File Lift vs King on g8', desc:'White to play and mate in one with the rook.',
      fen:'6k1/5ppp/8/8/8/8/R6K/8 w - - 0 1', side:'w',
      solution:[{from:'a2', to:'a8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR22', chapter:'Mate in 1', title:'B-File Lift vs King on g8', desc:'White to play and mate in one with the rook.',
      fen:'6k1/5ppp/8/8/8/8/1R5K/8 w - - 0 1', side:'w',
      solution:[{from:'b2', to:'b8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR23', chapter:'Mate in 1', title:'C-File Lift vs King on g8', desc:'White to play and mate in one with the rook.',
      fen:'6k1/5ppp/8/8/8/8/2R4K/8 w - - 0 1', side:'w',
      solution:[{from:'c2', to:'c8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR24', chapter:'Mate in 1', title:'A-File Mate vs King in the Corner', desc:'White to play and mate in one with the rook.',
      fen:'7k/6pp/8/8/8/8/7K/R7 w - - 0 1', side:'w',
      solution:[{from:'a1', to:'a8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'BR25', chapter:'Mate in 1', title:'B-File Mate vs King in the Corner', desc:'White to play and mate in one with the rook.',
      fen:'7k/6pp/8/8/8/8/7K/1R6 w - - 0 1', side:'w',
      solution:[{from:'b1', to:'b8'}], hint:'The king is stuck behind his own pawns — use the open rank.', difficulty:2 },
    { id:'QM01', chapter:'Mate in 1', title:'Queen Mates on a8 in the Corner', desc:'White to play and mate in one with the queen.',
      fen:'2k5/1Q6/2K5/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'b7', to:'a8'}, {from:'b7', to:'c7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM02', chapter:'Mate in 1', title:'Queen Mates on c8 from d7', desc:'White to play and mate in one with the queen.',
      fen:'4k3/3Q4/4K3/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'d7', to:'c8'}, {from:'d7', to:'e7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM03', chapter:'Mate in 1', title:'Queen Mates on b8 from c7', desc:'White to play and mate in one with the queen.',
      fen:'3k4/2Q5/3K4/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'c7', to:'b8'}, {from:'c7', to:'d7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM04', chapter:'Mate in 1', title:'Queen Corners the King on a8', desc:'White to play and mate in one with the queen.',
      fen:'2k5/1Q6/2K5/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'b7', to:'a8'}, {from:'b7', to:'c7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM05', chapter:'Mate in 1', title:'Queen Mates on d8 from e7', desc:'White to play and mate in one with the queen.',
      fen:'5k2/4Q3/5K2/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'d8'}, {from:'e7', to:'f7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM06', chapter:'Mate in 1', title:'Queen Box Mate on the a-File', desc:'White to play and mate in one with the queen.',
      fen:'2k5/1Q6/2K5/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'b7', to:'a8'}, {from:'b7', to:'c7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM07', chapter:'Mate in 1', title:'Queen Slides to b8 for Mate', desc:'White to play and mate in one with the queen.',
      fen:'3k4/2Q5/3K4/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'c7', to:'b8'}, {from:'c7', to:'d7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM08', chapter:'Mate in 1', title:'Queen Pins the King to a8', desc:'White to play and mate in one with the queen.',
      fen:'2k5/1Q6/2K5/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'b7', to:'a8'}, {from:'b7', to:'c7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM09', chapter:'Mate in 1', title:'Queen Mates on d8 (King on f8)', desc:'White to play and mate in one with the queen.',
      fen:'5k2/4Q3/5K2/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'d8'}, {from:'e7', to:'f7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM10', chapter:'Mate in 1', title:'Queen Mates on h8 from g7', desc:'White to play and mate in one with the queen.',
      fen:'5k2/6Q1/5K2/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'g7', to:'h8'}, {from:'g7', to:'f7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM11', chapter:'Mate in 1', title:'Queen Edge Mate on the a-File', desc:'White to play and mate in one with the queen.',
      fen:'2k5/1Q6/2K5/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'b7', to:'a8'}, {from:'b7', to:'c7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM12', chapter:'Mate in 1', title:'Queen Corners the King on h8', desc:'White to play and mate in one with the queen.',
      fen:'5k2/6Q1/5K2/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'g7', to:'h8'}, {from:'g7', to:'f7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM13', chapter:'Mate in 1', title:'Queen Steps to c8 for Mate', desc:'White to play and mate in one with the queen.',
      fen:'4k3/3Q4/4K3/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'d7', to:'c8'}, {from:'d7', to:'e7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM14', chapter:'Mate in 1', title:'Queen Mates on f8 from e7', desc:'White to play and mate in one with the queen.',
      fen:'3k4/4Q3/3K4/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'f8'}, {from:'e7', to:'d7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM15', chapter:'Mate in 1', title:'Queen Final Box Mate on a8', desc:'White to play and mate in one with the queen.',
      fen:'2k5/1Q6/2K5/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'b7', to:'a8'}, {from:'b7', to:'c7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM16', chapter:'Mate in 1', title:'Queen Diagonal Mate on d8', desc:'White to play and mate in one with the queen.',
      fen:'5k2/4Q3/5K2/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'d8'}, {from:'e7', to:'f7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM17', chapter:'Mate in 1', title:'Queen Mates on g8 from f7', desc:'White to play and mate in one with the queen.',
      fen:'4k3/5Q2/4K3/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'f7', to:'g8'}, {from:'f7', to:'e7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM18', chapter:'Mate in 1', title:'Queen Closes the Net on c8', desc:'White to play and mate in one with the queen.',
      fen:'4k3/3Q4/4K3/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'d7', to:'c8'}, {from:'d7', to:'e7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM19', chapter:'Mate in 1', title:'Queen Confines the King to d8', desc:'White to play and mate in one with the queen.',
      fen:'5k2/4Q3/5K2/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'d8'}, {from:'e7', to:'f7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'QM20', chapter:'Mate in 1', title:'Queen Seals the d8 Mate', desc:'White to play and mate in one with the queen.',
      fen:'5k2/4Q3/5K2/8/8/8/8/8 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'d8'}, {from:'e7', to:'f7'}], hint:'King supports the queen as it delivers the final blow.', difficulty:2 },
    { id:'LM01', chapter:'Mate in 1', title:'Ladder Mate: Roll the Rooks Up the Edge', desc:'White to play and deliver mate with the second rook.',
      fen:'k7/R7/8/8/8/8/8/KR6 w - - 0 1', side:'w',
      solution:[{from:'a7', to:'a6'}, {from:'a7', to:'a5'}, {from:'a7', to:'a4'}, {from:'a7', to:'a3'}, {from:'a7', to:'a2'}, {from:'b1', to:'b7'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM02', chapter:'Mate in 1', title:'Ladder Mate on the d-File', desc:'White to play and deliver mate with the second rook.',
      fen:'k7/2R5/8/8/8/8/8/K2R4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM03', chapter:'Mate in 1', title:'Ladder Mate Driving Down the c-File', desc:'White to play and deliver mate with the second rook.',
      fen:'k7/3R4/8/8/8/8/8/K1R5 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'c8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM04', chapter:'Mate in 1', title:'Ladder Mate with the e-Rook Cutoff', desc:'White to play and deliver mate with the second rook.',
      fen:'k7/4R3/8/8/8/8/8/K1R5 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'c8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM05', chapter:'Mate in 1', title:'Ladder Mate with the f-Rook Cutoff', desc:'White to play and deliver mate with the second rook.',
      fen:'k7/5R2/8/8/8/8/8/K1R5 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'c8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM06', chapter:'Mate in 1', title:'Ladder Mate with the g-Rook Cutoff', desc:'White to play and deliver mate with the second rook.',
      fen:'k7/6R1/8/8/8/8/8/K1R5 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'c8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM07', chapter:'Mate in 1', title:'Ladder Mate with the h-Rook Cutoff', desc:'White to play and deliver mate with the second rook.',
      fen:'k7/7R/8/8/8/8/8/K1R5 w - - 0 1', side:'w',
      solution:[{from:'c1', to:'c8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM08', chapter:'Mate in 1', title:'Ladder Mate: King on b8, e-File Finish', desc:'White to play and deliver mate with the second rook.',
      fen:'1k6/3R4/8/8/8/8/8/K3R3 w - - 0 1', side:'w',
      solution:[{from:'e1', to:'e8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM09', chapter:'Mate in 1', title:'Ladder Mate: King on b8, d-File Finish', desc:'White to play and deliver mate with the second rook.',
      fen:'1k6/4R3/8/8/8/8/8/K2R4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM10', chapter:'Mate in 1', title:'Ladder Mate: f-Rook Cutoff, d-File Mate', desc:'White to play and deliver mate with the second rook.',
      fen:'1k6/5R2/8/8/8/8/8/K2R4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM11', chapter:'Mate in 1', title:'Ladder Mate: g-Rook Cutoff, d-File Mate', desc:'White to play and deliver mate with the second rook.',
      fen:'1k6/6R1/8/8/8/8/8/K2R4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM12', chapter:'Mate in 1', title:'Ladder Mate: h-Rook Cutoff, d-File Mate', desc:'White to play and deliver mate with the second rook.',
      fen:'1k6/7R/8/8/8/8/8/K2R4 w - - 0 1', side:'w',
      solution:[{from:'d1', to:'d8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM13', chapter:'Mate in 1', title:'Ladder Mate: King on c8, e-File Finish', desc:'White to play and deliver mate with the second rook.',
      fen:'2k5/R7/8/8/8/8/8/K3R3 w - - 0 1', side:'w',
      solution:[{from:'e1', to:'e8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM14', chapter:'Mate in 1', title:'Ladder Mate: King on c8, f-File Finish', desc:'White to play and deliver mate with the second rook.',
      fen:'2k5/4R3/8/8/8/8/8/K4R2 w - - 0 1', side:'w',
      solution:[{from:'f1', to:'f8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'LM15', chapter:'Mate in 1', title:'Ladder Mate: f-Rook Cutoff, e-File Mate', desc:'White to play and deliver mate with the second rook.',
      fen:'2k5/5R2/8/8/8/8/8/K3R3 w - - 0 1', side:'w',
      solution:[{from:'e1', to:'e8'}], hint:'One rook cuts off, the other delivers.', difficulty:3 },
    { id:'PIN01', chapter:'Tactics', title:'Pin the Queen Down the e-File (from e4)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'4k3/4q3/8/8/4R3/8/8/7K w - - 0 1', side:'w',
      solution:[{from:'e4', to:'e7'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN02', chapter:'Tactics', title:'Pin the Queen Down the e-File (from e3)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'4k3/4q3/8/8/8/4R3/8/7K w - - 0 1', side:'w',
      solution:[{from:'e3', to:'e7'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN03', chapter:'Tactics', title:'Pin the Queen Down the e-File (from e2)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'4k3/4q3/8/8/8/8/4R3/7K w - - 0 1', side:'w',
      solution:[{from:'e2', to:'e7'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN04', chapter:'Tactics', title:'Pin the Queen Up the e-File (from e5)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'7K/8/8/4R3/8/8/4q3/4k3 w - - 0 1', side:'w',
      solution:[{from:'e5', to:'e2'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN05', chapter:'Tactics', title:'Pin the Queen Up the e-File (from e6)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'7K/8/4R3/8/8/8/4q3/4k3 w - - 0 1', side:'w',
      solution:[{from:'e6', to:'e2'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN06', chapter:'Tactics', title:'Pin the Queen Up the e-File (from e7)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'7K/4R3/8/8/8/8/4q3/4k3 w - - 0 1', side:'w',
      solution:[{from:'e7', to:'e2'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN07', chapter:'Tactics', title:'Pin the Queen Down the d-File (from d4)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'3k4/3q4/8/8/3R4/8/8/7K w - - 0 1', side:'w',
      solution:[{from:'d4', to:'d7'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN08', chapter:'Tactics', title:'Pin the Queen Down the d-File (from d3)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'3k4/3q4/8/8/8/3R4/8/7K w - - 0 1', side:'w',
      solution:[{from:'d3', to:'d7'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN09', chapter:'Tactics', title:'Pin the Queen Down the d-File (from d2)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'3k4/3q4/8/8/8/8/3R4/7K w - - 0 1', side:'w',
      solution:[{from:'d2', to:'d7'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN10', chapter:'Tactics', title:'Pin the Queen Up the d-File (from d5)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'7K/8/8/3R4/8/8/3q4/3k4 w - - 0 1', side:'w',
      solution:[{from:'d5', to:'d2'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN11', chapter:'Tactics', title:'Pin the Queen Up the d-File (from d6)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'7K/8/3R4/8/8/8/3q4/3k4 w - - 0 1', side:'w',
      solution:[{from:'d6', to:'d2'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PIN12', chapter:'Tactics', title:'Pin the Queen Up the d-File (from d7)', desc:'White to play. Take the queen — it\'s pinned to the king.',
      fen:'7K/3R4/8/8/8/8/3q4/3k4 w - - 0 1', side:'w',
      solution:[{from:'d7', to:'d2'}], hint:'The queen can\'t move; the king is behind.', difficulty:2 },
    { id:'PR01', chapter:'Foundations', title:'Promote the a-Pawn to a Queen', desc:'White to play. Promote the pawn on A-file to a queen.',
      fen:'8/P7/8/8/8/4k3/8/7K w - - 0 1', side:'w',
      solution:[{from:'a7', to:'a8', promotion:'q'}], hint:'Pawn reaches the 8th rank — promote to a queen.', difficulty:1 },
    { id:'PR02', chapter:'Foundations', title:'Promote the b-Pawn to a Queen', desc:'White to play. Promote the pawn on B-file to a queen.',
      fen:'8/1P6/8/8/8/4k3/8/7K w - - 0 1', side:'w',
      solution:[{from:'b7', to:'b8', promotion:'q'}], hint:'Pawn reaches the 8th rank — promote to a queen.', difficulty:1 },
    { id:'PR03', chapter:'Foundations', title:'Promote the c-Pawn to a Queen', desc:'White to play. Promote the pawn on C-file to a queen.',
      fen:'8/2P5/8/8/8/4k3/8/7K w - - 0 1', side:'w',
      solution:[{from:'c7', to:'c8', promotion:'q'}], hint:'Pawn reaches the 8th rank — promote to a queen.', difficulty:1 },
    { id:'PR04', chapter:'Foundations', title:'Promote the d-Pawn to a Queen', desc:'White to play. Promote the pawn on D-file to a queen.',
      fen:'8/3P4/8/8/k7/8/8/7K w - - 0 1', side:'w',
      solution:[{from:'d7', to:'d8', promotion:'q'}], hint:'Pawn reaches the 8th rank — promote to a queen.', difficulty:1 },
    { id:'PR05', chapter:'Foundations', title:'Promote the e-Pawn to a Queen', desc:'White to play. Promote the pawn on E-file to a queen.',
      fen:'8/4P3/8/8/k7/8/8/7K w - - 0 1', side:'w',
      solution:[{from:'e7', to:'e8', promotion:'q'}], hint:'Pawn reaches the 8th rank — promote to a queen.', difficulty:1 },
    { id:'PR06', chapter:'Foundations', title:'Promote the f-Pawn to a Queen', desc:'White to play. Promote the pawn on F-file to a queen.',
      fen:'8/5P2/8/8/k7/8/8/7K w - - 0 1', side:'w',
      solution:[{from:'f7', to:'f8', promotion:'q'}], hint:'Pawn reaches the 8th rank — promote to a queen.', difficulty:1 },
    { id:'PR07', chapter:'Foundations', title:'Promote the g-Pawn to a Queen', desc:'White to play. Promote the pawn on G-file to a queen.',
      fen:'8/6P1/8/8/8/4k3/8/7K w - - 0 1', side:'w',
      solution:[{from:'g7', to:'g8', promotion:'q'}], hint:'Pawn reaches the 8th rank — promote to a queen.', difficulty:1 },
    { id:'PR08', chapter:'Foundations', title:'Promote the h-Pawn to a Queen', desc:'White to play. Promote the pawn on H-file to a queen.',
      fen:'8/7P/8/8/8/4k3/8/K7 w - - 0 1', side:'w',
      solution:[{from:'h7', to:'h8', promotion:'q'}], hint:'Pawn reaches the 8th rank — promote to a queen.', difficulty:1 },
  ];
  window.CT_LESSONS = LESSONS;

  // -------------------- ACADEMY STATE --------------------
  let acadCurrent = null; // {lesson, chess, stepIndex}

  function chaptersInOrder() {
    const order = ['Foundations','Mate in 1','Tactics','Openings','Endgames'];
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

    wrap.innerHTML = html;
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
      }
      // Reveal Next button
      document.getElementById('lesson-next').style.display = '';
    } else {
      cur.attempts++;
      // Undo the wrong move so they can try again
      cur.chess.undo();
      document.getElementById('lesson-feedback').innerHTML = `<span style="color:var(--danger);font-weight:700">Not quite.</span> <span class="muted small">Try again.</span>${cur.attempts >= 2 ? `<div class="muted small" style="margin-top:6px">Hint: ${escapeHTML(cur.lesson.hint)}</div>` : ''}`;
    }
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
    acadCurrent.chess = new window.Chess(acadCurrent.lesson.lesson || acadCurrent.lesson.fen);
    acadCurrent.solved = false;
    acadCurrent.attempts = 0;
    acadCurrent.selected = null;
    acadCurrent.legalTargets = [];
    document.getElementById('lesson-feedback').textContent = '';
    document.getElementById('lesson-next').style.display = 'none';
    renderLessonBoard();
  }
  function hintLesson() {
    if (!acadCurrent) return;
    document.getElementById('lesson-feedback').innerHTML = `<span class="muted small">Hint: ${escapeHTML(acadCurrent.lesson.hint)}</span>`;
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
