'use strict';
const { Chess } = require('../chess.min.js');
const code = require('fs').readFileSync('puzzles-data.js','utf8');
global.window = {};
eval(code);
const P = global.window.CT_PUZZLES;
let ok=0, bad=0; const counts={easy:0,medium:0,hard:0}; const dups=new Set();
for(const p of P){
  if(dups.has(p.fen)){ console.log('DUP', p.id); bad++; continue; } dups.add(p.fen);
  counts[p.difficulty]=(counts[p.difficulty]||0)+1;
  const g=new Chess(p.fen);
  const mv=p.solution[0];
  const from=mv.slice(0,2), to=mv.slice(2,4), promo=mv.slice(4)||undefined;
  const res=g.move({from,to,promotion:promo});
  if(!res){ console.log('ILLEGAL', p.id, mv, p.fen); bad++; continue; }
  if(p.objective==='Mate in 1'){
    if(g.in_checkmate()) ok++; else { console.log('NOT MATE1', p.id); bad++; }
  } else {
    // mate2: after our move, EVERY reply must allow a mate-in-1
    const replies=g.moves({verbose:true});
    if(replies.length===0){ console.log('NO REPLIES(stalemate?)',p.id); bad++; continue; }
    let allMate=true;
    for(const r of replies){ const g2=new Chess(g.fen()); g2.move(r);
      let found=false; for(const m of g2.moves({verbose:true})){ const g3=new Chess(g2.fen()); g3.move(m); if(g3.in_checkmate()){found=true;break;} }
      if(!found){ allMate=false; break; } }
    if(allMate) ok++; else { console.log('NOT FORCED MATE2', p.id); bad++; }
  }
}
console.log('TOTAL',P.length,'OK',ok,'BAD',bad,'counts',JSON.stringify(counts),'unique',dups.size);
