#!/usr/bin/env node
/*
 * scripts/seo/endgames-pages.mjs — static, crawlable "Endgame Trainer" pages.
 *
 * Generates one interactive page per fundamental endgame (basic checkmates and
 * key rook/pawn positions) plus an /endgames/ hub, all in the shared "Board
 * Room" design system (board-night navy + walnut + trophy gold). Each page lets
 * the reader step through the model line on a walnut board (Prev / Next / Reset
 * / Show solution) with the last move highlighted — a real trainer feel, but
 * fully precomputed (no runtime engine).
 *
 * CORRECTNESS: every model line is replayed at build time through chess.min.js
 * (loaded via a CommonJS shim) to (a) compute the FEN after each ply for the
 * stepper and (b) PROVE the technique works — mates must reach checkmate, the
 * pawn/Lucena wins must reach a live promoted-queen position, and the Philidor
 * line must be a legal, live (non-mate) draw. Any failure THROWS the build.
 *
 * Client JS lives in ONE shared external file (endgame-stepper.js) loaded with
 * <script src defer> — no inline JS, no on* handlers, so these pages stay
 * CSP-clean. Move data rides along in a non-executable
 * <script type="application/json"> block (allowed under any CSP).
 *
 * Contract:
 *   export async function generate({ DIST, SITE }) -> { urls, count }
 *   build.mjs imports generate() and merges the returned urls into sitemap.xml.
 *
 * Self-contained: only node:fs/promises, node:path, node:module, node:url.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SITE = 'https://www.playchesstrophies.com';

// ---------------------------------------------------------------------------
// chess.min.js is a UMD file; on this type:module repo Node mis-loads UMD via
// require(). Load it with a CommonJS shim: read the text and run it as CJS so
// module.exports is populated correctly. (Same trick as openings-pages.mjs.)
// ---------------------------------------------------------------------------
async function loadChess() {
  const require = createRequire(import.meta.url);
  const src = await fsp.readFile(path.join(ROOT, 'chess.min.js'), 'utf8');
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(m, m.exports, require);
  const Chess = m.exports.Chess || m.exports;
  if (typeof Chess !== 'function') throw new Error('chess.min.js did not export Chess');
  return Chess;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['‘’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'endgame';
}

// Pretty move list "1.Ke6 Kf8 2.Kf6 ..." honouring the side that moves first.
function formatLine(sans, sideToMove) {
  const out = [];
  let moveNo = 1;
  let i = 0;
  if (sideToMove === 'b') {
    // first ply is Black's — write "1...Kd8"
    out.push(`${moveNo}…${sans[0]}`);
    i = 1; moveNo = 2;
  }
  for (; i < sans.length; i++) {
    const whiteToMove = (sideToMove === 'w') ? (i % 2 === 0) : (i % 2 === 1);
    if (whiteToMove) { out.push(`${moveNo}.${sans[i]}`); }
    else { out.push(sans[i]); moveNo++; }
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// fenToBoardSvg — render a FEN on a walnut-toned board (server-side, used for
// the no-JS fallback board and for hub thumbnails). Same renderer/colours as
// openings-pages.mjs so the surfaces are visually unified.
// ---------------------------------------------------------------------------
const WHITE_GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
const BLACK_GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function fenToBoardSvg(fen, ariaLabel) {
  const M = 18, C = 42, B = C * 8, T = M * 2 + B;
  const placement = String(fen).split(' ')[0];
  const rows = placement.split('/');
  const squares = [];
  const pieces = [];
  for (let ri = 0; ri < 8; ri++) {
    const rankNum = 8 - ri;
    for (let fi = 0; fi < 8; fi++) {
      const light = ((fi + rankNum) % 2 === 0);
      squares.push(`<rect x="${M + fi * C}" y="${M + ri * C}" width="${C}" height="${C}" fill="${light ? '#e8d2a8' : '#9c6b43'}"/>`);
    }
    let fileIdx = 0;
    for (const ch of rows[ri]) {
      if (/\d/.test(ch)) { fileIdx += parseInt(ch, 10); continue; }
      const isWhite = WHITE_GLYPH[ch] != null;
      const glyph = isWhite ? WHITE_GLYPH[ch] : BLACK_GLYPH[ch];
      if (glyph) {
        const cx = M + fileIdx * C + C / 2;
        const cy = M + ri * C + C / 2;
        pieces.push(
          `<text x="${cx}" y="${cy}" font-size="${Math.round(C * 0.74)}" text-anchor="middle" ` +
          `dominant-baseline="central" fill="${isWhite ? '#f4eee2' : '#33373e'}" stroke="${isWhite ? '#33373e' : '#0b0d10'}" stroke-width="0.7" ` +
          `paint-order="stroke" font-family="'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2','DejaVu Sans',sans-serif">${glyph}</text>`
        );
      }
      fileIdx += 1;
    }
  }
  const labels = [];
  for (let fi = 0; fi < 8; fi++) {
    labels.push(`<text x="${M + fi * C + C / 2}" y="${M + B + 12}" font-size="10" text-anchor="middle" fill="#8a98b8" font-family="'Inter',system-ui,sans-serif">${FILES[fi]}</text>`);
  }
  for (let ri = 0; ri < 8; ri++) {
    labels.push(`<text x="${M - 9}" y="${M + ri * C + C / 2}" font-size="10" text-anchor="middle" dominant-baseline="central" fill="#8a98b8" font-family="'Inter',system-ui,sans-serif">${8 - ri}</text>`);
  }
  return `<svg class="board" viewBox="0 0 ${T} ${T}" role="img" aria-label="${escHtml(ariaLabel)}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${T}" height="${T}" rx="10" fill="#101a2e"/>
  <g>${squares.join('')}</g>
  <rect x="${M}" y="${M}" width="${B}" height="${B}" fill="none" stroke="#243556" stroke-width="1.5"/>
  <g>${pieces.join('')}</g>
  <g>${labels.join('')}</g>
</svg>`;
}

function boardThumbSvg(fen, ariaLabel) {
  return fenToBoardSvg(fen, ariaLabel).replace('class="board"', 'class="board thumb"');
}

// ---------------------------------------------------------------------------
// THE ENDGAMES. Each start FEN + SAN line was authored from established
// technique and VERIFIED with chess.min.js (see generate()):
//   mate  -> final position is checkmate
//   win   -> line ends with the pawn promoted to a queen, side winning, no stalemate
//   draw  -> line is legal and reaches the known drawing setup (not mate/stalemate)
// ---------------------------------------------------------------------------
const ENDGAMES = [
  {
    slug: 'checkmate-king-and-queen-vs-king',
    name: 'Checkmate with King and Queen',
    eyebrow: 'Endgame · Checkmate',
    result: 'mate', resultLabel: 'Mate',
    sideToMove: 'w',
    start: '4k3/8/8/4K3/2Q5/8/8/8 w - - 0 1',
    sans: ['Ke6', 'Kf8', 'Kf6', 'Ke8', 'Qc8#'],
    hook: 'The first checkmate every player should own: the queen does the cornering, but it is your king that makes mate possible.',
    oneLiner: 'Box the lone king to the edge and mate — the first checkmate to master.',
    idea: 'A queen cannot checkmate a lone king by herself — you need your own king to help cover the escape squares. The method is safe and simple: use the queen to shrink the space the enemy king is allowed to move in, herding it toward the edge of the board, then bring your king up to support the final blow. The one thing you must never do is stalemate: if the enemy king has no legal move and is not in check, the game is an instant draw.',
    stepBySteps: [
      'White’s king marches in first. 1.Ke6 takes the opposition, standing face to face with the black king and stealing the d7, e7 and f7 escape squares.',
      'After 1…Kf8, the move 2.Kf6 keeps the kings opposed and boxes Black onto the back rank, with the queen poised on c4.',
      '2…Ke8 is forced back toward the corner, and now 3.Qc8# delivers mate: the queen covers the whole 8th rank while the White king on f6 guards e7 and f7 — the black king has nowhere to run.',
    ],
    keyRule: 'Herd with the queen, mate with the king. In longer versions, keep your queen a knight’s-move from the enemy king to drive it to the edge without ever giving it a free square — and always bring your king up before you deliver mate. Above all, never stalemate: if the enemy king has no move, give it one or check it.',
  },
  {
    slug: 'checkmate-king-and-rook-vs-king',
    name: 'Checkmate with King and Rook',
    eyebrow: 'Endgame · Rook',
    result: 'mate', resultLabel: 'Mate',
    sideToMove: 'w',
    start: '4k3/8/8/4K3/8/8/8/1R6 w - - 0 1',
    sans: ['Ke6', 'Kf8', 'Rg1', 'Ke8', 'Rg8#'],
    hook: 'No queen? No problem. King and rook force mate against a lone king every time — with the classic “box” method.',
    oneLiner: 'Build a wall with the rook, march your king up, and mate on the edge.',
    idea: 'The rook cannot mate a lone king on its own; it needs the king’s help. You use the rook to build a wall the enemy king cannot cross, then walk your own king up to take the opposition — standing directly in front of the enemy king with one square between them. When the kings are face to face, the rook delivers mate along the far rank or file.',
    stepBySteps: [
      '1.Ke6 takes the opposition, freezing the black king onto the back rank.',
      '1…Kf8 2.Rg1! is the key waiting move: it hands the move back to Black without breaking the box (“losing a tempo”).',
      '2…Ke8 is forced, and 3.Rg8# mates — the rook sweeps the 8th rank while the White king on e6 covers d7, e7 and f7.',
    ],
    keyRule: 'Shrink the box with the rook, take the opposition with your king, and when you need to pass the move to your opponent, play a quiet waiting move with the rook along its rank. Mate arrives when the kings stand face to face and the rook checks along the edge.',
  },
  {
    slug: 'two-rook-ladder-checkmate',
    name: 'The Two-Rook Ladder Mate',
    eyebrow: 'Endgame · Rook',
    result: 'mate', resultLabel: 'Mate',
    sideToMove: 'w',
    start: '8/8/8/4k3/8/8/8/R6R w - - 0 1',
    sans: ['Ra5+', 'Ke6', 'Rh6+', 'Kf7', 'Ra7+', 'Kg8', 'Rg6+', 'Kh8', 'Re6', 'Kg8', 'Re8#'],
    hook: 'The easiest mate in chess: two rooks “walk” the enemy king to the edge like rungs on a ladder — and you don’t even need your own king.',
    oneLiner: 'Two rooks walk the lone king to the edge, rung by rung.',
    idea: 'With two rooks you do not need your king at all. One rook cuts off a rank so the enemy king cannot step forward; the other checks to drive it back one rank. Then you repeat, climbing the board rung by rung — the “ladder” or “lawnmower” — until the king is mated on the edge. The only care: if the king ever marches toward a rook, swing that rook far away along its rank to safety and keep laddering.',
    stepBySteps: [
      '1.Ra5+ drives the king off the fifth rank; 1…Ke6 2.Rh6+ pushes it off the sixth.',
      'Now the king approaches the h6-rook, so the other rook takes over: 2…Kf7 3.Ra7+ Kg8 4.Rg6+ Kh8, laddering the king to the edge.',
      '5.Re6 is a quiet switch of the checking rook, and after 5…Kg8 6.Re8# the king is mated — the rook on a7 seals the 7th rank so there is no escape.',
    ],
    keyRule: 'One rook holds the line the king cannot cross; the other checks to push it back a rank. When the king marches toward a rook, slide that rook to the far end of its rank and keep laddering. Two rooks mate a lone king with no help from your own king at all.',
  },
  {
    slug: 'king-and-pawn-vs-king-opposition',
    name: 'King and Pawn vs King: The Opposition',
    eyebrow: 'Endgame · Pawn',
    result: 'win', resultLabel: 'Win',
    sideToMove: 'b',
    start: '4k3/8/4K3/4P3/8/8/8/8 b - - 0 1',
    sans: ['Kd8', 'Kf7', 'Kd7', 'e6+', 'Kd6', 'e7', 'Kd7', 'e8=Q+'],
    hook: 'One pawn and one king each — and the whole game turns on a single idea: the opposition.',
    oneLiner: 'Lead with the king, take the opposition, and queen the pawn.',
    idea: 'A lone king can stop a lone pawn if it gets in front of it — so the attacker’s job is to escort the pawn with the king leading, not the pawn. The weapon is “the opposition”: place your king directly in front of the enemy king with one square between them and the opponent to move, and they must step aside and give ground. Get your king to the sixth rank in front of your pawn with the opposition, and the pawn promotes.',
    stepBySteps: [
      'White already has the winning set-up: the king stands in front of the pawn on the sixth rank and it is Black to move, so Black must give way. 1…Kd8.',
      '2.Kf7! side-steps to escort the pawn, seizing the key squares in front of it. 2…Kd7 3.e6+ Kd6 4.e7 shepherds the pawn home.',
      '4…Kd7 cannot stop it, and 5.e8=Q+ promotes with check. White is up a queen and winning.',
    ],
    keyRule: 'Lead with the king, not the pawn. If your king reaches the sixth rank in front of the pawn and you hold the opposition (kings facing, one square apart, opponent to move), the pawn always queens. Push the pawn only after the king has cleared the way.',
  },
  {
    slug: 'lucena-position-building-a-bridge',
    name: 'The Lucena Position: Building a Bridge',
    eyebrow: 'Endgame · Rook',
    result: 'win', resultLabel: 'Win',
    sideToMove: 'w',
    start: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1',
    sans: ['Rd1+', 'Ke7', 'Rd4', 'Ra1', 'Kc7', 'Rc1+', 'Kb6', 'Rb1+', 'Kc6', 'Rc1+', 'Kb5', 'Rb1+', 'Rb4', 'Ra1', 'b8=Q'],
    hook: 'The most important winning position in rook endgames — and the famous trick that cracks it: build a bridge.',
    oneLiner: 'Cut off the king, build a bridge, and promote the pawn.',
    idea: 'In the Lucena position the attacker has a rook and a pawn one step from queening, the defending king is cut off from the pawn, and the attacking king is boxed in front of its own pawn. The only thing preventing promotion is a stream of rook checks from the side. “Building a bridge” solves it: place your rook on the fourth rank so that, at the decisive moment, it can interpose to block a check — shielding your king and letting the pawn queen.',
    stepBySteps: [
      '1.Rd1+ nudges the black king a step further away (1…Ke7), then 2.Rd4! is the whole idea — the rook drops to the fourth rank to build the bridge.',
      'The White king now walks out toward the checks: 2…Ra1 3.Kc7 Rc1+ 4.Kb6 Rb1+ 5.Kc6 Rc1+ 6.Kb5 Rb1+.',
      'Now 7.Rb4! closes the bridge: the rook interposes on the fourth rank, blocking the check (and offering a trade Black cannot accept). Black has run out of safe checks, so after 7…Ra1 8.b8=Q the pawn queens and White is easily winning.',
    ],
    keyRule: 'Put your rook on the fourth rank first. Then march your king out toward the checking rook; the instant the checks would otherwise be endless, interpose your rook on the fourth rank — the “bridge” — to block the check and trade if needed. The pawn queens.',
  },
  {
    slug: 'philidor-position-drawing-defense',
    name: 'The Philidor Position: The Drawing Defense',
    eyebrow: 'Endgame · Rook',
    result: 'draw', resultLabel: 'Draw',
    sideToMove: 'w',
    start: '8/4k3/r7/4PK2/8/8/8/7R w - - 0 1',
    sans: ['e6', 'Ra1', 'Kg6', 'Rg1+', 'Kf5', 'Rf1+', 'Ke5', 'Re1+', 'Kf5', 'Rf1+'],
    hook: 'Down a pawn in a rook endgame? Philidor’s third-rank defense holds the draw — if you know the trick.',
    oneLiner: 'The third-rank defense: how to hold a rook-down draw.',
    idea: 'The Philidor position is the defender’s answer to the Lucena: rook and pawn against a lone rook, but here the weaker side holds the draw. The method has two phases. First, keep your rook on your third rank — the rank just in front of the enemy pawn — stopping the attacking king from advancing to support it. Then, the very moment the pawn steps onto that rank, swing your rook to the far end of the board and check the king from behind: the pawn now blocks its own king from finding shelter, so the checks never stop. With best play, the position is a draw.',
    stepBySteps: [
      'Black’s rook holds the sixth rank, so the White king cannot come forward. White finally breaks the blockade with 1.e6 — but this is the signal to switch defenses.',
      '1…Ra1! drops the rook to the first rank for checks from behind. Now the White king cannot escort the pawn: 2.Kg6 Rg1+ 3.Kf5 Rf1+ 4.Ke5 Re1+.',
      'Every king move runs into another rear check — 5.Kf5 Rf1+ and so on, forever. Because the pawn on e6 blocks its own king from hiding, the checks are endless and the game is drawn.',
    ],
    keyRule: 'While the pawn is still one square back, hold your rook on your third rank so the enemy king cannot come forward. The instant the pawn advances onto that rank, drop your rook far behind and check the king from the rear — with the pawn in the way, it can never escape. Best play is a draw.',
  },
];

// ---------------------------------------------------------------------------
// Shared "Board Room" CSS (matches openings-pages.mjs), plus stepper + card rules.
// ---------------------------------------------------------------------------
function boardRoomCss(extra = '') {
  return `  :root {
    color-scheme: dark;
    --bg:#0b1220; --surface:#101a2e; --panel:#17223b; --panel-2:#1d2a47;
    --border:#243556; --text:#e8eefc; --muted:#8a98b8; --body:#d7def0;
    --gold:#f5c451; --gold-deep:#e1a92a; --walnut-l:#e8d2a8; --walnut-d:#9c6b43;
    --serif:'Iowan Old Style','Palatino Linotype','Palatino','Georgia',serif;
    --sans:'Inter',-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:var(--sans);
    line-height:1.65; -webkit-font-smoothing:antialiased; }
  a { color:var(--gold); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .wrap { max-width:760px; margin:0 auto; padding:26px 20px 72px; }
  .crumbs { font-size:14px; color:var(--muted); margin-bottom:18px; }
  .crumbs a { color:var(--muted); }
  .crumbs a:hover { color:var(--text); }
  .eyebrow { font-family:var(--serif); text-transform:uppercase; letter-spacing:.14em;
    font-size:12px; font-weight:700; color:var(--gold); margin:0 0 8px; }
  .walnut-rule { height:6px; border-radius:3px; margin:14px 0 22px;
    background:repeating-linear-gradient(90deg,var(--walnut-l) 0 20px,var(--walnut-d) 20px 40px);
    box-shadow:0 1px 0 rgba(0,0,0,.35) inset; }
  h1 { font-family:var(--serif); font-size:34px; line-height:1.2; margin:0 0 10px; font-weight:700; }
  h2 { font-family:var(--serif); font-size:22px; margin:34px 0 8px; color:var(--gold); font-weight:700; }
  p { margin:12px 0; color:var(--body); }
  .hook { font-size:18px; color:var(--text); margin:0 0 6px; }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:14px;
    padding:18px 20px; margin:22px 0; }
  .panel h2 { margin-top:0; }
  .note { color:var(--muted); font-size:14px; margin-top:12px; }
  .steps { margin:12px 0; padding-left:22px; color:var(--body); }
  .steps li { margin:8px 0; }
  .cta { margin-top:40px; padding:24px; border-radius:16px; text-align:center;
    background:linear-gradient(135deg,var(--gold),var(--gold-deep)); color:#0b1220; }
  .cta h2 { color:#0b1220; margin:0 0 6px; }
  .cta p { color:#241a02; margin:6px 0 16px; }
  .btn { display:inline-block; padding:13px 26px; border-radius:10px; font-weight:700;
    background:#0b1220; color:var(--gold); text-decoration:none;
    transition:transform .15s ease, box-shadow .15s ease; }
  .btn:hover { transform:translateY(-2px); box-shadow:0 8px 22px rgba(0,0,0,.35); text-decoration:none; }
  .btn:focus-visible { outline:3px solid var(--gold); outline-offset:3px; }
  a:focus-visible, .card:focus-visible { outline:3px solid var(--gold); outline-offset:3px; border-radius:6px; }
  footer { margin-top:44px; font-size:13px; color:var(--muted);
    border-top:1px solid var(--border); padding-top:18px; }
  footer a { color:var(--muted); }
  /* --- interactive stepper --- */
  .trainer { display:flex; flex-direction:column; align-items:center; }
  .eg-board { display:grid; grid-template-columns:repeat(8,1fr); aspect-ratio:1/1;
    width:100%; max-width:360px; margin:2px auto 0; border:1px solid var(--border);
    border-radius:10px; overflow:hidden; box-shadow:0 10px 30px rgba(0,0,0,.4); }
  .eg-board svg.board { max-width:100%; border-radius:0; box-shadow:none; }
  .eg-sq { position:relative; display:flex; align-items:center; justify-content:center;
    font-size:clamp(20px,7vw,34px); line-height:1; user-select:none; }
  .eg-sq.l { background:var(--walnut-l); } .eg-sq.d { background:var(--walnut-d); }
  .eg-sq.hl::after { content:""; position:absolute; inset:0;
    background:rgba(245,196,81,.42); box-shadow:inset 0 0 0 2px rgba(245,196,81,.85); }
  .eg-sq .pc { position:relative; z-index:1; }
  .eg-sq .pc.w { color:#f4eee2; text-shadow:0 1px 1px rgba(0,0,0,.45); }
  .eg-sq .pc.b { color:#33373e; text-shadow:0 1px 0 rgba(255,255,255,.12); }
  .eg-readout { text-align:center; margin:14px 0 0; min-height:1.5em; font-weight:600;
    color:var(--text); font-variant-numeric:tabular-nums; }
  .eg-line { text-align:center; margin:6px 0 0; color:var(--muted); font-size:13px;
    font-variant-numeric:tabular-nums; }
  .eg-controls { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-top:14px; }
  .eg-btn { font-family:var(--sans); cursor:pointer; border:none; border-radius:10px;
    padding:11px 18px; min-height:44px; min-width:44px; font-size:15px; font-weight:700;
    background:linear-gradient(180deg,var(--gold),var(--gold-deep)); color:#0b1220;
    transition:transform .12s ease, filter .12s ease; }
  .eg-btn:hover { transform:translateY(-1px); filter:brightness(1.05); }
  .eg-btn.secondary { background:transparent; color:var(--text); border:1px solid var(--border); font-weight:600; }
  .eg-btn.secondary:hover { background:var(--panel-2); }
  .eg-btn:focus-visible { outline:3px solid var(--gold); outline-offset:3px; }
  .eg-btn:disabled { opacity:.4; cursor:default; transform:none; filter:none; }
  @media (max-width:560px) {
    h1 { font-size:28px; }
    .wrap { padding:20px 16px 56px; }
    .btn { display:block; min-height:44px; }
    .eg-btn { flex:1 1 40%; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition:none !important; animation:none !important; }
  }
${extra}`;
}

// ---------------------------------------------------------------------------
// Per-endgame page
// ---------------------------------------------------------------------------
function endgamePageHtml(eg, fens, SITE) {
  const url = `${SITE}/endgames/${eg.slug}.html`;
  const resultWord = eg.result === 'mate' ? 'Checkmate' : eg.result === 'win' ? 'a winning promotion' : 'a draw';
  const title = `${eg.name} — Endgame Trainer | ChessTrophies`;
  const desc = `${eg.name}: step through the model line move by move on an interactive board, learn the idea and the one key rule. A fundamental chess endgame ending in ${resultWord}.`;
  const startBoard = fenToBoardSvg(eg.start, `${eg.name}: starting position`);

  const data = {
    start: eg.start,
    fens,
    sans: eg.sans,
    sideToMove: eg.sideToMove,
    result: eg.result,
    name: eg.name,
  };

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${eg.name} — Endgame Trainer`,
    description: desc,
    articleSection: 'Chess Endgames',
    about: eg.name,
    url,
    mainEntityOfPage: url,
    image: `${SITE}/og-image.png`,
    author: { '@type': 'Organization', name: 'ChessTrophies' },
    publisher: {
      '@type': 'Organization',
      name: 'ChessTrophies',
      logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` },
    },
  };
  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Endgames', item: `${SITE}/endgames/` },
      { '@type': 'ListItem', position: 3, name: eg.name, item: url },
    ],
  };

  const steps = eg.stepBySteps.map((s) => `        <li>${escHtml(s)}</li>`).join('\n');
  const lineText = formatLine(eg.sans, eg.sideToMove);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}" />
<link rel="canonical" href="${escHtml(url)}" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="ChessTrophies" />
<meta property="og:title" content="${escHtml(eg.name + ' — Endgame Trainer')}" />
<meta property="og:description" content="${escHtml(desc)}" />
<meta property="og:url" content="${escHtml(url)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escHtml(eg.name + ' — Endgame Trainer')}" />
<meta name="twitter:description" content="${escHtml(desc)}" />
<meta name="twitter:image" content="${SITE}/og-image.png" />
<script type="application/ld+json">
${JSON.stringify(articleLd, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(crumbLd, null, 2)}
</script>
<style>
${boardRoomCss()}
</style>
</head>
<body>
  <main class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/endgames/">Endgames</a> &rsaquo; ${escHtml(eg.name)}</nav>
    <article>
      <p class="eyebrow">${escHtml(eg.eyebrow)}</p>
      <h1>${escHtml(eg.name)}</h1>
      <div class="walnut-rule" aria-hidden="true"></div>
      <p class="hook">${escHtml(eg.hook)}</p>

      <section class="panel" aria-labelledby="trainer-h">
        <h2 id="trainer-h">Step through the moves</h2>
        <div class="trainer">
          <div class="eg-board" id="eg-board" role="img" aria-label="${escHtml(eg.name + ': interactive board')}">
${startBoard}
          </div>
          <p class="eg-readout" id="eg-readout" role="status" aria-live="polite" aria-atomic="true">Starting position. Press Next to begin.</p>
          <div class="eg-controls">
            <button type="button" class="eg-btn secondary" id="eg-prev">&larr; Prev</button>
            <button type="button" class="eg-btn" id="eg-next">Next &rarr;</button>
            <button type="button" class="eg-btn secondary" id="eg-reset">Reset</button>
            <button type="button" class="eg-btn" id="eg-solution">Show solution</button>
          </div>
          <p class="eg-line" id="eg-line">Model line: ${escHtml(lineText)}</p>
        </div>
        <script type="application/json" id="eg-data">
${JSON.stringify(data)}
        </script>
      </section>

      <h2>The idea</h2>
      <p>${escHtml(eg.idea)}</p>

      <h2>Step by step</h2>
      <ol class="steps">
${steps}
      </ol>

      <h2>The key rule</h2>
      <p>${escHtml(eg.keyRule)}</p>
    </article>

    <section class="cta">
      <h2>Practice it for real</h2>
      <p>Play this endgame out against the computer on ChessTrophies — free, in your browser, as many times as it takes to make it automatic.</p>
      <a class="btn" href="/">Play this endgame on ChessTrophies</a>
    </section>

    <footer>
      <a href="/endgames/">&larr; All endgames</a> &nbsp;&middot;&nbsp;
      <a href="/learn/">Chess lessons</a> &nbsp;&middot;&nbsp;
      <a href="/openings/">Openings</a> &nbsp;&middot;&nbsp;
      <a href="/tools/">Tools</a> &nbsp;&middot;&nbsp;
      <a href="/">Home</a>
    </footer>
  </main>
  <script src="endgame-stepper.js" defer></script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// /endgames/ hub index
// ---------------------------------------------------------------------------
function endgamesIndexHtml(entries, SITE) {
  const url = `${SITE}/endgames/`;
  const collectionLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Chess Endgames: Checkmates & Key Positions — ChessTrophies',
    url,
    description: 'Learn the fundamental chess endgames: king-and-queen and king-and-rook checkmates, the two-rook ladder mate, the opposition in king-and-pawn endings, and the Lucena and Philidor rook positions. Step through every model line on an interactive board.',
    hasPart: entries.map((e) => ({ '@type': 'Article', name: e.name, url: `${SITE}/endgames/${e.slug}.html` })),
  };
  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Endgames', item: url },
    ],
  };

  const badgeClass = (r) => (r === 'mate' ? 'mate' : r === 'win' ? 'win' : 'draw');
  const cards = entries.map((e) => `      <a class="card" href="/endgames/${escHtml(e.slug)}.html">
        <div class="card-board">${boardThumbSvg(e.start, `${e.name} starting position`)}</div>
        <div class="card-body">
          <div class="card-eyebrow">${escHtml(e.eyebrow)} <span class="badge ${badgeClass(e.result)}">${escHtml(e.resultLabel)}</span></div>
          <div class="card-name">${escHtml(e.name)}</div>
          <div class="card-oneliner">${escHtml(e.oneLiner)}</div>
        </div>
      </a>`).join('\n');

  const extraCss = `  .lede { font-size:18px; color:var(--body); margin:0 0 6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:16px; margin-top:26px; }
  .card { display:flex; gap:14px; align-items:flex-start; background:var(--panel);
    border:1px solid var(--border); border-radius:14px; padding:14px; color:var(--text);
    text-decoration:none; transition:transform .15s ease, border-color .15s ease, box-shadow .15s ease; }
  .card:hover { transform:translateY(-2px); border-color:var(--gold); box-shadow:0 10px 26px rgba(0,0,0,.35); text-decoration:none; }
  .card-board { flex:0 0 auto; }
  svg.board.thumb { width:120px; height:auto; display:block; border-radius:10px; box-shadow:0 6px 16px rgba(0,0,0,.35); }
  .card-body { min-width:0; }
  .card-eyebrow { font-family:var(--serif); text-transform:uppercase; letter-spacing:.1em;
    font-size:11px; color:var(--gold); font-weight:700; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .badge { font-family:var(--sans); letter-spacing:.02em; text-transform:uppercase; font-size:10px;
    font-weight:700; padding:2px 8px; border-radius:999px; border:1px solid var(--border); }
  .badge.mate { color:#ffd9d9; background:rgba(220,90,90,.16); border-color:rgba(220,90,90,.5); }
  .badge.win { color:#c9f5d8; background:rgba(80,190,120,.16); border-color:rgba(80,190,120,.5); }
  .badge.draw { color:#dfe6f6; background:rgba(140,152,184,.16); border-color:rgba(140,152,184,.5); }
  .card-name { font-family:var(--serif); font-size:19px; font-weight:700; margin:3px 0 4px; }
  .card-oneliner { color:var(--muted); font-size:13.5px; line-height:1.45; }
  @media (max-width:560px) { .grid { grid-template-columns:1fr; } }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Chess Endgames: Checkmates &amp; Key Positions | ChessTrophies</title>
<meta name="description" content="Learn the fundamental chess endgames on an interactive board: king-and-queen and king-and-rook checkmates, the two-rook ladder mate, the opposition, and the Lucena and Philidor rook positions. Step through every model line." />
<link rel="canonical" href="${escHtml(url)}" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="ChessTrophies" />
<meta property="og:title" content="Chess Endgames: Checkmates &amp; Key Positions — ChessTrophies" />
<meta property="og:description" content="Interactive trainers for the fundamental chess endgames — basic checkmates and the key rook and pawn positions." />
<meta property="og:url" content="${escHtml(url)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Chess Endgames: Checkmates &amp; Key Positions — ChessTrophies" />
<meta name="twitter:image" content="${SITE}/og-image.png" />
<script type="application/ld+json">
${JSON.stringify(collectionLd, null, 2)}
</script>
<script type="application/ld+json">
${JSON.stringify(crumbLd, null, 2)}
</script>
<style>
${boardRoomCss(extraCss)}
</style>
</head>
<body>
  <main class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; Endgames</nav>
    <p class="eyebrow">The Board Room &middot; Endgames</p>
    <h1>Chess Endgames: Checkmates &amp; Key Positions</h1>
    <div class="walnut-rule" aria-hidden="true"></div>
    <p class="lede">Games are won and lost at the end. These interactive trainers teach the endgames every player must know — the basic checkmates and the classic rook and pawn positions — by letting you <em>step through the model line</em> on the board, move by move, with the last move highlighted. Learn the idea, then the one rule that makes it work.</p>
    <section class="grid" aria-label="Chess endgames">
${cards}
    </section>
    <section class="cta">
      <h2>Turn technique into instinct</h2>
      <p>Play any of these endgames out against the computer on ChessTrophies — free, no sign-up, right in your browser.</p>
      <a class="btn" href="/">Play free on ChessTrophies</a>
    </section>
    <footer>
      <a href="/learn/">Chess lessons</a> &nbsp;&middot;&nbsp;
      <a href="/openings/">Openings</a> &nbsp;&middot;&nbsp;
      <a href="/tools/">Tools</a> &nbsp;&middot;&nbsp;
      <a href="/">Home</a>
    </footer>
  </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Shared client stepper. External, defer, no inline JS / no on* handlers.
// Reads the JSON data block, renders the walnut board for the current ply,
// highlights the last move (diff of consecutive placements), and wires the
// Prev / Next / Reset / Show solution buttons + left/right arrow keys.
// Glyphs are written as \uXXXX escapes (no raw non-ASCII in this file).
// ---------------------------------------------------------------------------
function stepperJs() {
  return `// ChessTrophies endgame stepper - dependency-free, CSP-clean.
(function () {
  'use strict';
  var dataEl = document.getElementById('eg-data');
  var boardEl = document.getElementById('eg-board');
  var readEl = document.getElementById('eg-readout');
  if (!dataEl || !boardEl) return; // degrade gracefully

  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!data || !data.start || !Array.isArray(data.fens) || !Array.isArray(data.sans)) return;

  var GLYPH = {
    K: '\\u2654', Q: '\\u2655', R: '\\u2656', B: '\\u2657', N: '\\u2658', P: '\\u2659',
    k: '\\u265A', q: '\\u265B', r: '\\u265C', b: '\\u265D', n: '\\u265E', p: '\\u265F'
  };

  // placement field -> array of 64 (index 0 = a8 ... 63 = h1), null or piece char
  function parse(fen) {
    var rows = String(fen).split(' ')[0].split('/');
    var cells = [];
    for (var r = 0; r < 8; r++) {
      var rank = rows[r] || '';
      for (var i = 0; i < rank.length; i++) {
        var c = rank[i];
        if (c >= '1' && c <= '9') { var n = parseInt(c, 10); for (var j = 0; j < n; j++) cells.push(null); }
        else cells.push(c);
      }
    }
    while (cells.length < 64) cells.push(null);
    return cells;
  }

  var N = data.fens.length;
  var boards = [parse(data.start)];
  for (var k = 0; k < N; k++) boards.push(parse(data.fens[k]));

  var sideW = data.sideToMove !== 'b'; // is white to move at ply 0?
  var ply = 0;

  function moverIsWhite(plyIndex) {
    // plyIndex is 1..N (the move that produced boards[plyIndex])
    var whiteFirst = sideW;
    var evenPly = (plyIndex % 2 === 1); // 1st move is index 1
    return whiteFirst ? evenPly : !evenPly;
  }

  function moveLabel(plyIndex) {
    var san = data.sans[plyIndex - 1];
    var whiteFirst = sideW;
    var moveNo;
    if (whiteFirst) moveNo = Math.floor((plyIndex - 1) / 2) + 1;
    else moveNo = Math.floor(plyIndex / 2) + 1;
    var dots = moverIsWhite(plyIndex) ? '.' : '\\u2026';
    return moveNo + dots + san;
  }

  function diff(prev, cur) {
    var s = {};
    if (!prev) return s;
    for (var i = 0; i < 64; i++) { if (prev[i] !== cur[i]) s[i] = true; }
    return s;
  }

  function render() {
    var cur = boards[ply];
    var hl = ply > 0 ? diff(boards[ply - 1], cur) : {};
    var html = '';
    for (var i = 0; i < 64; i++) {
      var r = Math.floor(i / 8), f = i % 8;
      var light = (r + f) % 2 === 0;
      var cls = 'eg-sq ' + (light ? 'l' : 'd') + (hl[i] ? ' hl' : '');
      var piece = cur[i];
      var inner = '';
      if (piece && GLYPH[piece]) {
        var isW = piece === piece.toUpperCase();
        inner = '<span class="pc ' + (isW ? 'w' : 'b') + '">' + GLYPH[piece] + '</span>';
      }
      html += '<div class="' + cls + '">' + inner + '</div>';
    }
    boardEl.innerHTML = html;

    if (readEl) {
      if (ply === 0) {
        readEl.textContent = 'Starting position. Press Next to begin.';
      } else {
        var suffix = '';
        if (ply === N) {
          if (data.result === 'mate') suffix = ' \\u2014 checkmate!';
          else if (data.result === 'win') suffix = ' \\u2014 winning!';
          else if (data.result === 'draw') suffix = ' \\u2014 and the checks never stop: a draw.';
        }
        readEl.textContent = 'Move ' + ply + ' of ' + N + ': ' + moveLabel(ply) + suffix;
      }
    }
    setDisabled('eg-prev', ply === 0);
    setDisabled('eg-next', ply === N);
    setDisabled('eg-solution', ply === N);
  }

  function setDisabled(id, on) {
    var el = document.getElementById(id);
    if (el) el.disabled = !!on;
  }

  function go(p) { ply = Math.max(0, Math.min(N, p)); render(); }

  var nextBtn = document.getElementById('eg-next');
  var prevBtn = document.getElementById('eg-prev');
  var resetBtn = document.getElementById('eg-reset');
  var solBtn = document.getElementById('eg-solution');
  if (nextBtn) nextBtn.addEventListener('click', function () { go(ply + 1); });
  if (prevBtn) prevBtn.addEventListener('click', function () { go(ply - 1); });
  if (resetBtn) resetBtn.addEventListener('click', function () { go(0); });
  if (solBtn) solBtn.addEventListener('click', function () { go(N); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { go(ply + 1); }
    else if (e.key === 'ArrowLeft') { go(ply - 1); }
  });

  render();
})();
`;
}

// ---------------------------------------------------------------------------
// Public API: generate the pages + return the sitemap URLs.
// ---------------------------------------------------------------------------
export async function generate({ DIST, SITE = DEFAULT_SITE } = {}) {
  if (!DIST) throw new Error('generate() requires { DIST }');
  const Chess = await loadChess();
  const outDir = path.join(DIST, 'endgames');
  await fsp.mkdir(outDir, { recursive: true });

  const urls = [];
  const entries = [];

  for (const eg of ENDGAMES) {
    // Replay the SAN line: compute the FEN after every ply AND prove the technique.
    const g = new Chess(eg.start);
    const fens = [];
    for (let i = 0; i < eg.sans.length; i++) {
      const mv = g.move(eg.sans[i], { sloppy: true });
      if (!mv) throw new Error(`ILLEGAL move "${eg.sans[i]}" at ply ${i + 1} in endgame "${eg.slug}"`);
      fens.push(g.fen());
    }
    const finalFen = g.fen();
    const placement = finalFen.split(' ')[0];

    if (eg.result === 'mate') {
      if (!g.in_checkmate()) {
        throw new Error(`endgame "${eg.slug}" is marked "mate" but the final position is NOT checkmate (${finalFen})`);
      }
    } else if (eg.result === 'win') {
      // pawn must have promoted to a queen for the winning (White) side; opponent not stalemated.
      if (!placement.includes('Q')) {
        throw new Error(`endgame "${eg.slug}" is marked "win" but no White queen is on the board (${finalFen})`);
      }
      if (g.in_stalemate()) {
        throw new Error(`endgame "${eg.slug}" is marked "win" but the final position is stalemate (${finalFen})`);
      }
    } else if (eg.result === 'draw') {
      // must be a legal, live position that is neither checkmate nor stalemate.
      if (g.in_checkmate()) {
        throw new Error(`endgame "${eg.slug}" is marked "draw" but the final position is checkmate (${finalFen})`);
      }
      if (g.in_stalemate()) {
        throw new Error(`endgame "${eg.slug}" is marked "draw" but the final position is stalemate (${finalFen})`);
      }
    } else {
      throw new Error(`endgame "${eg.slug}" has an unknown result "${eg.result}"`);
    }

    await fsp.writeFile(path.join(outDir, eg.slug + '.html'), endgamePageHtml(eg, fens, SITE), 'utf8');
    entries.push(eg);
    urls.push({ loc: `${SITE}/endgames/${eg.slug}.html`, priority: '0.7' });
  }

  await fsp.writeFile(path.join(outDir, 'endgame-stepper.js'), stepperJs(), 'utf8');
  await fsp.writeFile(path.join(outDir, 'index.html'), endgamesIndexHtml(entries, SITE), 'utf8');

  const allUrls = [{ loc: `${SITE}/endgames/`, priority: '0.8' }, ...urls];
  return { urls: allUrls, count: entries.length };
}

// ---------------------------------------------------------------------------
// Standalone preview: `node scripts/seo/endgames-pages.mjs [outDir]`
// Robust main-guard on POSIX + Windows (compare normalized paths, not URLs).
// ---------------------------------------------------------------------------
const invoked = (process.argv[1] || '').replace(/\\/g, '/');
const selfPath = decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
if (invoked && (selfPath === invoked || (selfPath.endsWith('/endgames-pages.mjs') && invoked.endsWith('/endgames-pages.mjs')))) {
  const outDir = path.resolve(process.argv[2] || './_preview');
  generate({ DIST: outDir, SITE: DEFAULT_SITE })
    .then(async (res) => {
      const Chess = await loadChess();
      console.log(`[endgames-seo] wrote ${res.count} endgame page(s) + hub + endgame-stepper.js into ${path.join(outDir, 'endgames')}\n`);
      for (const eg of ENDGAMES) {
        const g = new Chess(eg.start);
        for (const san of eg.sans) g.move(san, { sloppy: true });
        const fen = g.fen();
        let assertion;
        if (eg.result === 'mate') assertion = 'checkmate=' + g.in_checkmate();
        else if (eg.result === 'win') assertion = 'promoted+winning (whiteQ=' + fen.split(' ')[0].includes('Q') + ', stalemate=' + g.in_stalemate() + ')';
        else assertion = 'legal-draw (checkmate=' + g.in_checkmate() + ', stalemate=' + g.in_stalemate() + ')';
        console.log(`  ${eg.slug}`);
        console.log(`    plies=${eg.sans.length}  result=${eg.result}  assert: ${assertion}`);
        console.log(`    final FEN: ${fen}`);
      }
      console.log('\nurls:', JSON.stringify(res.urls, null, 2));
    })
    .catch((err) => { console.error('[endgames-seo] FAILED:', err); process.exit(1); });
}
