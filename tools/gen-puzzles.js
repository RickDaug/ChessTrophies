/*
 * tools/gen-puzzles.js  (BUILD-TIME ONLY -- not shipped to client)
 *
 * Generates ORIGINAL ChessTrophies tactics puzzles from scratch.
 *
 * IMPORTANT (copyright): puzzles here are NOT taken from any external
 * puzzle database (Lichess/Chess.com/etc). Every position is synthesised
 * by randomly placing a small, legal set of pieces and then VERIFYING with
 * the bundled chess.js engine that a forced solution exists and is unique.
 * The output is wholly machine-generated original composition.
 *
 * Run:  node tools/gen-puzzles.js > puzzles-data.js
 */
'use strict';
const { Chess } = require('../chess.min.js');

function rng(seed) { // deterministic so builds are reproducible
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const FILES = 'abcdefgh';
function sq(f, r) { return FILES[f] + (r + 1); }
function randSquare(rand) { return sq((rand()*8)|0, (rand()*8)|0); }

// Place pieces on an empty board via FEN; side-to-move = mover.
function buildFen(pieces, mover) {
  const board = Array.from({length:8}, () => Array(8).fill(''));
  for (const p of pieces) {
    const f = FILES.indexOf(p.sq[0]); const r = (+p.sq[1]) - 1;
    if (f<0||r<0||r>7||board[r][f]) return null;
    board[r][f] = p.color === 'w' ? p.type.toUpperCase() : p.type.toLowerCase();
  }
  let rows = [];
  for (let r=7;r>=0;r--){ let e=0,row='';
    for(let f=0;f<8;f++){ const c=board[r][f]; if(!c){e++;} else {if(e){row+=e;e=0;} row+=c;} }
    if(e) row+=e; rows.push(row);
  }
  return rows.join('/') + ' ' + mover + ' - - 0 1';
}
console.error('generator scaffold written');

// ---- Solver helpers (all via chess.js, depth-limited) ----
function legalMoves(fen) { const g=new Chess(fen); return g.moves({verbose:true}); }
function isMate(fen){ const g=new Chess(fen); return g.in_checkmate(); }

// Find UNIQUE mate-in-1: exactly one move by side-to-move gives checkmate.
function findMateIn1(fen){
  const mates=[];
  for(const m of legalMoves(fen)){
    const g=new Chess(fen); g.move(m);
    if(g.in_checkmate()) mates.push(m);
  }
  return mates.length===1 ? mates[0] : null;
}

// Find UNIQUE mate-in-2: exactly one first move such that, for EVERY defence,
// a mate-in-1 exists; and no other first move forces mate in 2.
function findMateIn2(fen){
  const solutions=[];
  for(const m of legalMoves(fen)){
    const g=new Chess(fen); g.move(m);
    if(g.in_checkmate()) continue; // that's mate-in-1, not 2
    const replies=g.moves({verbose:true});
    if(replies.length===0) continue; // stalemate, not a win
    let allForced=true;
    for(const r of replies){
      const g2=new Chess(g.fen()); g2.move(r);
      if(!findMateIn1(g2.fen())){ allForced=false; break; }
    }
    if(allForced) solutions.push(m);
  }
  return solutions.length===1 ? solutions[0] : null;
}
console.error('solvers appended');

// ---- Position synthesiser ----
// Bias toward mate-friendly geometry: defender king on an EDGE/CORNER, attackers nearby.
// This makes forced mates common, so generation converges quickly.
function edgeSquare(rand){
  const edge=(rand()*4)|0; const k=(rand()*8)|0;
  if(edge===0) return sq(k,0);       // rank 1
  if(edge===1) return sq(k,7);       // rank 8
  if(edge===2) return sq(0,k);       // file a
  return sq(7,k);                    // file h
}
function near(rand, base, spread){
  const f=FILES.indexOf(base[0]); const r=(+base[1])-1;
  let nf=Math.max(0,Math.min(7,f+(((rand()*(2*spread+1))|0)-spread)));
  let nr=Math.max(0,Math.min(7,r+(((rand()*(2*spread+1))|0)-spread)));
  return sq(nf,nr);
}
function randomComposition(rand, mover){
  const defender = mover==='w' ? 'b' : 'w';
  const used = new Set();
  function place(s){ if(!s||used.has(s)) return false; used.add(s); return true; }
  const pieces=[];
  const bk=edgeSquare(rand); if(!place(bk)) return pieces; pieces.push({color:defender,type:'k',sq:bk});
  // attacking king kept far away (random non-adjacent square)
  let wk; for(let t=0;t<40;t++){ wk=randSquare(rand); const fa=Math.abs(FILES.indexOf(wk[0])-FILES.indexOf(bk[0])); const ra=Math.abs((+wk[1])-(+bk[1])); if(fa>1||ra>1){ if(place(wk)) break; } }
  pieces.push({color:mover,type:'k',sq:wk});
  // attackers placed NEAR the defender king to create mating nets
  const pool=['q','r','r','b','n'];
  const n = 2 + ((rand()*2)|0);
  for(let i=0;i<n;i++){ let s; for(let t=0;t<30;t++){ s=near(rand,bk,3); if(place(s)) break; s=null; } if(s) pieces.push({color:mover,type:pool[(rand()*pool.length)|0],sq:s}); }
  // sometimes a defender blocker adjacent to its king (enables mate-in-2 motifs)
  if(rand()<0.45){ let s; for(let t=0;t<20;t++){ s=near(rand,bk,1); if(place(s)) break; s=null; } if(s) pieces.push({color:defender,type:(rand()<0.5?'p':'n'),sq:s}); }
  return pieces;
}

function tryMakePuzzle(rand){
  const mover = rand()<0.5 ? 'w':'b';
  const fen = buildFen(randomComposition(rand, mover), mover);
  if(!fen) return null;
  let g; try{ g=new Chess(fen); }catch(e){ return null; }
  if(typeof g.fen!=='function') return null;
  if(g.in_checkmate()||g.in_stalemate()) return null;
  if(g.in_check()) return null; // mover should deliver the blow, not start in check
  const m1=findMateIn1(fen);
  if(m1) return { fen, solution:[m1.from+m1.to+(m1.promotion||'')], type:'mate1' };
  const m2=findMateIn2(fen);
  if(m2){ return { fen, solution:[m2.from+m2.to+(m2.promotion||'')], type:'mate2' }; }
  return null;
}
console.error('synth appended');

// ---- Catalog builder ----
// Difficulty: mate1 => easy; mate2 with few pieces => medium; mate2 with blocker => hard.
function classify(p){
  const fen=p.fen; const board=fen.split(' ')[0];
  const pieceCount=board.replace(/[^a-zA-Z]/g,'').length;
  if(p.type==='mate1') return pieceCount<=4 ? 'easy' : 'easy';
  return pieceCount>=6 ? 'hard' : 'medium';
}
const THEME = { mate1:'Mate in 1', mate2:'Mate in 2' };

function build(target){
  const rand=rng(20260531); // fixed seed => reproducible catalog
  const seen=new Set(); const out=[];
  let attempts=0; const MAX=400000;
  while(out.length<target && attempts<MAX){
    attempts++;
    const p=tryMakePuzzle(rand);
    if(!p) continue;
    if(seen.has(p.fen)) continue;
    seen.add(p.fen);
    const diff=classify(p);
    out.push({
      id:'ctp_'+(out.length+1),
      fen:p.fen,
      solution:p.solution,      // moves in coord form e.g. 'd1h5'
      sideToMove:fen2stm(p.fen),
      objective:THEME[p.type],
      difficulty:diff,
      rating: diff==='easy'?900: diff==='medium'?1300:1700,
    });
  }
  console.error('built '+out.length+' puzzles in '+attempts+' attempts');
  return out;
}
function fen2stm(fen){ return fen.split(' ')[1]==='w'?'white':'black'; }

const N = parseInt(process.argv[2]||'120',10);
const puzzles=build(N);
process.stdout.write(
  '/* AUTO-GENERATED by tools/gen-puzzles.js -- DO NOT EDIT BY HAND.\n'+
  '   Original engine-verified compositions (unique forced mates).\n'+
  '   Regenerate: node tools/gen-puzzles.js '+N+' > puzzles-data.js */\n'+
  'window.CT_PUZZLES = '+JSON.stringify(puzzles)+';\n'
);
