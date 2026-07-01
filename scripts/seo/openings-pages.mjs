#!/usr/bin/env node
/*
 * scripts/seo/openings-pages.mjs — static, crawlable chess-opening pages.
 *
 * Generates one editorial page per opening (targeting high-volume searches like
 * "Italian Game", "Ruy Lopez", "Sicilian Defense") plus an /openings/ hub, all
 * following the shared "Board Room" design system (board-night navy + walnut +
 * trophy gold). Each page renders the REAL resulting position after the book
 * line on a walnut board, computed by replaying the SAN line through chess.js —
 * which also proves the line is legal (an illegal move throws loudly).
 *
 * Source of truth for opening data: repo-root openings.js (the OPENINGS array).
 * id / name / eco / userColor / line are copied VERBATIM (validated by
 * test/content-correctness.mjs); the prose around them is authored here.
 *
 * Contract:
 *   export async function generate({ DIST, SITE }) -> { urls, count }
 *   build.mjs imports generate() and merges the returned urls into sitemap.xml.
 *
 * Self-contained: only node:fs/promises, node:path, node:module. No deps.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SITE = 'https://www.playchesstrophies.com';

// ---------------------------------------------------------------------------
// chess.min.js is a UMD file; this repo is type:module in places and Node 22
// mis-loads UMD via require(). Load it with a CommonJS shim: read the text and
// run it as CJS so its module.exports is populated correctly.
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
// Load the OPENINGS array out of the browser IIFE openings.js by running it in
// a tiny sandbox (its module body only defines functions + assigns globals). We
// read window.CT_Openings._openings — the exact array the app + tests use.
// ---------------------------------------------------------------------------
async function loadOpenings() {
  const src = await fsp.readFile(path.join(ROOT, 'openings.js'), 'utf8');
  const noop = () => {};
  const win = {};
  const doc = {
    getElementById: () => null,
    createElement: () => ({ classList: { add: noop, remove: noop }, appendChild: noop, setAttribute: noop, style: {} }),
    querySelector: () => null,
    addEventListener: noop,
  };
  win.document = doc;
  win.addEventListener = noop;
  win.location = { href: '' };
  const sandbox = { window: win, document: doc, self: win, globalThis: win, console, setTimeout: noop, clearTimeout: noop };
  // Run inside a fresh Function scope with the sandbox globals bound. Using vm
  // would add a dependency import we don't need; a Function shim is enough since
  // the IIFE only reads window/document/self.
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'self', 'globalThis', 'console', 'setTimeout', 'clearTimeout', src)(
    sandbox.window, sandbox.document, sandbox.self, sandbox.globalThis, sandbox.console, noop, noop
  );
  const list = win.CT_Openings && win.CT_Openings._openings;
  if (!Array.isArray(list) || !list.length) throw new Error('openings.js did not expose CT_Openings._openings');
  return list;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// URL-safe slug from an opening name: lowercase ASCII, hyphen-separated, accents
// stripped, apostrophes dropped (so "Queen's" -> "queens", not "queen-s").
function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/['‘’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'opening';
}

// "1.e4" / "1...c5" style label for the ply at index i.
function plyLabel(i, san) {
  const moveNo = Math.floor(i / 2) + 1;
  return (i % 2 === 0) ? `${moveNo}.${san}` : `${moveNo}...${san}`;
}

// The pretty label for the FINAL ply of a line (used in aria-label / captions).
function finalPlyLabel(line) {
  const i = line.length - 1;
  return plyLabel(i, line[i]);
}

// ---------------------------------------------------------------------------
// fenToBoardSvg — render a FEN on a walnut-toned 8x8 board.
//   light squares #e8d2a8, dark #9c6b43; white pieces ivory #f4eee2 (outline
//   glyphs), black pieces charcoal #33373e (filled glyphs). role="img" +
//   descriptive aria-label; thin coordinate labels around the edge.
// ---------------------------------------------------------------------------
const WHITE_GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' };
const BLACK_GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function fenToBoardSvg(fen, ariaLabel) {
  const M = 18;        // outer margin (holds coordinate labels)
  const C = 42;        // cell size
  const B = C * 8;     // board size (336)
  const T = M * 2 + B; // total (372)
  const placement = String(fen).split(' ')[0];
  const rows = placement.split('/'); // rows[0] = rank 8

  const squares = [];
  const pieces = [];
  for (let ri = 0; ri < 8; ri++) {   // ri 0 = top = rank 8
    const rankNum = 8 - ri;
    let fileIdx = 0;
    // squares first (so pieces paint on top)
    for (let fi = 0; fi < 8; fi++) {
      const light = ((fi + rankNum) % 2 === 0);
      const x = M + fi * C;
      const y = M + ri * C;
      squares.push(`<rect x="${x}" y="${y}" width="${C}" height="${C}" fill="${light ? '#e8d2a8' : '#9c6b43'}"/>`);
    }
    // pieces from the FEN row string
    for (const ch of rows[ri]) {
      if (/\d/.test(ch)) { fileIdx += parseInt(ch, 10); continue; }
      const isWhite = WHITE_GLYPH[ch] != null;
      const glyph = isWhite ? WHITE_GLYPH[ch] : BLACK_GLYPH[ch];
      if (glyph) {
        const cx = M + fileIdx * C + C / 2;
        const cy = M + ri * C + C / 2;
        const fill = isWhite ? '#f4eee2' : '#33373e';
        const stroke = isWhite ? '#33373e' : '#0b0d10';
        pieces.push(
          `<text x="${cx}" y="${cy}" font-size="${Math.round(C * 0.74)}" text-anchor="middle" ` +
          `dominant-baseline="central" fill="${fill}" stroke="${stroke}" stroke-width="0.7" ` +
          `paint-order="stroke" font-family="'Segoe UI Symbol','Apple Symbols','Noto Sans Symbols2','DejaVu Sans',sans-serif">${glyph}</text>`
        );
      }
      fileIdx += 1;
    }
  }

  // Coordinate labels: files a-h under the board, ranks 8-1 down the left edge.
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

// A compact thumbnail variant (same renderer; sizing handled by CSS class).
function boardThumbSvg(fen, ariaLabel) {
  return fenToBoardSvg(fen, ariaLabel).replace('class="board"', 'class="board thumb"');
}

// ---------------------------------------------------------------------------
// AUTHORED PROSE — one rich, accurate, plain-English entry per opening id.
// (The move data itself comes verbatim from openings.js; this is the writing.)
// ---------------------------------------------------------------------------
const CONTENT = {
  italian: {
    hook: 'The oldest respected way to open a game of chess — and still one of the very best for learning how the pieces cooperate.',
    idea: 'The Italian Game is the purest expression of classical opening principles: put a pawn in the centre, develop a knight to attack it, and swing the light-squared bishop out to c4 where it stares straight down the diagonal at f7 — the weakest square in Black’s camp. Everything is fast, natural and to the point. In the quiet modern main line (the Giuoco Pianissimo, or "very quiet game") both sides reinforce the centre with c3 and d3 and castle before committing to a plan, producing a rich, manoeuvring middlegame rather than an early brawl.',
    lineExplained: 'After 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 both sides mirror each other, bishops trained on the enemy f-pawn. White plays 4.c3, preparing the central lever d4 and giving the c4-bishop a retreat to c2. 4…Nf6 develops with a hit on e4, 5.d3 quietly defends it, and after 5…d6 both kings hurry to safety with 6.O-O O-O. The tension is unresolved on purpose: the position is balanced, flexible and full of long-term plans.',
    plansWhite: 'White wants to prepare and play d4 under good circumstances, gaining space and opening lines toward the black king. Typical tools are Re1, Nbd2–f1–g3 (the classic knight tour to the kingside), and h3 to make luft and prevent …Bg4 pins. If Black castles kingside, a slow pawn advance with a4 and even a timely kingside expansion can follow.',
    plansBlack: 'Black mirrors the setup and fights for the same central break from the other side. The freeing move is …d5; before that Black often plays …a6 and …Ba7 to tuck the bishop safely out of the way of White’s d4, then re-routes a knight with …Ne7–g6. Whoever achieves their central pawn break on the best terms usually gets the more comfortable game.',
    trap: 'As White, do not block your c-pawn with an early Nc3 in this structure. The classic "fork trick" punishes it: after a position with Nc3 and a bishop on c4, Black plays …Nxe4!, and if Nxe4 then …d5 forks the bishop and knight, regaining the piece with a free, comfortable game. Keeping c2–c3 available for the d4 break is exactly why the main line delays that knight.',
    suits: 'Beginners and improvers who want to learn chess "the right way" — rapid development, early castling, control of the centre — and club players who prefer a slow build-up they understand deeply over a memorised theoretical duel.',
    tableNote: 'Both sides develop naturally and castle; the position stays balanced while each prepares the central …d5 / d4 break.',
  },
  'ruy-lopez': {
    hook: 'The Spanish Torture: a slow, positional squeeze that has been the acid test of 1.e4 e5 for over four centuries.',
    idea: 'The Ruy López (or Spanish Opening) attacks the knight on c6 with 3.Bb5. That knight defends the e5-pawn, so by pressuring it White creates a subtle, lasting question mark over the centre of Black’s position. Rather than winning material outright, White accumulates tiny structural advantages, keeps the tension, and manoeuvres for the long game — which is why it has been nicknamed "the Spanish Torture."',
    lineExplained: 'After 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 (the Morphy Defence) White retreats with 4.Ba4, keeping the bishop’s pressure alive while sidestepping …b5 tricks for now. 4…Nf6 hits e4, 5.O-O tucks the king away and quietly offers the e4-pawn (it is poisoned by tactics), 5…Be7 develops solidly, and after 6.Re1 defending e4, Black gains queenside space with 6…b5, chasing the bishop to b3 and reaching the great Closed Ruy main lines.',
    plansWhite: 'White plays for a big, well-supported centre: c3 and d4 build the classic pawn duo, while the b3-bishop and a re-routed knight (Nbd2–f1–g3, the "Spanish knight tour") aim at the kingside. The bind on e5 and pressure down the e-file give White a durable, low-risk initiative.',
    plansBlack: 'Black gets a rock-solid position with counterplay. The bishop on b3 can be neutralised with …Na5 or blunted with …d6 and …Nc6–a5; queenside space from …b5 and …c5 gives real space of its own, and the resilient centre means Black is rarely worse if the theory is known.',
    trap: 'Watch the Noah’s Ark Trap. If White grabs the centre carelessly with an early d4, Black can round up the b3/a4-bishop with a wall of queenside pawns: …b5, …Nxd4, …exd4, and then …c5–c4 slams the door, trapping the bishop behind Black’s own pawns. Time your d4 and keep an escape square for the light-squared bishop.',
    suits: 'Patient, positionally-minded players who enjoy long strategic manoeuvring and want the most principled, deeply-respected answer to 1…e5. Expect to learn ideas, not just memorise moves.',
    tableNote: 'White pressures c6 to loosen Black’s centre; Black gains queenside space with …b5 and heads for the Closed Ruy.',
  },
  'sicilian-open': {
    hook: 'The fighting reply of world champions: Black plays for the win from move one by refusing to mirror White.',
    idea: 'The Sicilian Defence answers 1.e4 with 1…c5, declining a symmetrical game. By trading a flank pawn for White’s central d-pawn, Black gets a half-open c-file, a queenside pawn majority and rich, unbalanced play. The Najdorf Variation — reached via …d6, …Nf6, …a6 — is the most celebrated of all, the choice of Fischer and Kasparov, prized for its flexibility and razor-sharp counterattacking chances.',
    lineExplained: 'After 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 (the Najdorf move, controlling b5 and preparing …e5 or …e6), White chooses the calm, classical 6.Be2. Black immediately stakes a claim in the centre with 6…e5, hitting the d4-knight and grabbing space. The knight retreats and both sides castle into a tense, double-edged middlegame.',
    plansWhite: 'White enjoys a lead in development and space, and steers play toward the d5-square and the f-file. Standard ideas are Nb3, O-O, Be3, and f4 (or a slower Bg5/Bf3 plan), building pressure on the backward d6-pawn and the d5 outpost while keeping an eye on a kingside attack.',
    plansBlack: 'Black’s trumps are the half-open c-file, the queenside majority and the pair of bishops after …Be6/…Be7. Play often revolves around …Be6, …Nbd7, …b5 with a queenside pawn storm, contesting the d5-square so White can never plant a knight there for free.',
    trap: 'The move 6…e5 concedes the d5-square and leaves d6 backward — that is the deal Black accepts for activity. The mistake to avoid is treating d5 casually: if Black allows White to install a piece there permanently (and trades away the wrong defender of that square), the position can quietly go from dynamic to strategically lost. Keep a piece that fights for d5.',
    suits: 'Ambitious players who want to play for a win with Black and are willing to walk a knife-edge. The Najdorf rewards deep understanding and sharp calculation more than almost any other opening.',
    tableNote: 'Black unbalances the game with …c5 and the Najdorf …a6, then …e5 grabs space at the cost of the d5-hole.',
  },
  french: {
    hook: 'Solid, resilient and quietly aggressive: Black builds a fortress, then strikes back at the centre.',
    idea: 'The French Defence answers 1.e4 with 1…e6, preparing to challenge the centre with …d5 the very next move. Black accepts a slightly cramped position and one traditionally "bad" light-squared bishop in exchange for a rock-solid pawn chain and a clear plan: undermine White’s centre with the pawn breaks …c5 and …f6. It is one of the most reliable, hard-to-crack replies to 1.e4.',
    lineExplained: 'After 1.e4 e6 2.d4 d5 3.Nc3 Nf6 White pins nothing yet but develops with tempo; 4.Bg5 pins the f6-knight and increases the pressure on d5. Black unpins calmly with 4…Be7, White grabs space and closes the centre with 5.e5, kicking the knight to 5…Nfd7. The bishops are then traded with 6.Bxe7 Qxe7, leaving a classic French structure: a locked pawn chain and a fight over the …c5 and …f6 breaks.',
    plansWhite: 'With more space and a big pawn on e5, White plays on the kingside: pieces flow toward h5/g5/f-file, and moves like Qd2, O-O-O or f4–f5 aim to open lines near Black’s king. The strategic goal is to keep the centre fixed so Black’s cramped pieces never get room to breathe.',
    plansBlack: 'Black strikes at the base of the chain. …c5 hits d4 and opens the c-file for counterplay; …f6 challenges e5 and frees the position. The problem child is the light-squared bishop locked behind …e6 and …d5 — a good French player spends real effort trading it off or activating it via …b6 and …Ba6.',
    trap: 'The mistake that sinks most French players is passivity. If Black shuffles pieces without ever playing …c5 or …f6, White’s space advantage simply grows until the kingside attack crashes through. The French is not a "sit and hold" opening — it is a coiled spring, and Black must uncoil it with a timely central break.',
    suits: 'Players who like solid, strategically clear positions, don’t mind defending a little, and enjoy counterattacking chess where a well-timed pawn break turns the tables.',
    tableNote: 'Black challenges the centre with …d5; after the Bg5 pin and e5 clamp, the game becomes a race between White’s kingside and Black’s …c5/…f6 breaks.',
  },
  qgd: {
    hook: 'The gold standard of 1.d4 defences: decline the gambit, build a fortress, and outplay the opponent later.',
    idea: 'When White offers the Queen’s Gambit with 2.c4, Black can simply decline it. The Queen’s Gambit Declined props up the d5-pawn with …e6, accepting a slightly passive light-squared bishop in return for one of the soundest, most reliable structures in all of chess. It has been the choice of world champions in title matches for a century precisely because it is so hard to break down.',
    lineExplained: 'After 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5 White pins the knight and piles pressure on d5. Black develops solidly with 4…Be7, breaking the pin’s sting, and castles: 5.e3 O-O reaches the classical Orthodox setup. 6.Nf3 completes development and 6…h6 politely questions the g5-bishop, gaining a small kingside foothold and clarifying White’s intentions before Black chooses a freeing plan.',
    plansWhite: 'White enjoys more central space and a natural plan: complete development, and either execute the "minority attack" (b4–b5 to create a weakness on Black’s queenside) or push in the centre with e3–e4 once fully mobilised. The pin on f6 and pressure on d5 give White the easier position to play.',
    plansBlack: 'Black aims to free the game. The key breaks are …c5 (challenging d4) and, after …dxc4 at the right moment, …b5 or …c5 to activate the pieces; developing the problem bishop via …b6 and …Bb7, or the …Nbd7–f8–g6 regrouping, are thematic. Equality is very achievable with accurate play.',
    trap: 'Do not release the central tension too early with …dxc4. Capturing on c4 before White has committed hands over the centre for free and simply gives White a mobile pawn majority and a tempo (Bxc4). In the QGD, patience is a weapon: keep the pawn on d5 until capturing actually achieves something concrete.',
    suits: 'Solid, classical players who want a lifelong, low-maintenance answer to 1.d4 and enjoy grinding out equal-to-better endgames rather than gambling in sharp theory.',
    tableNote: 'Black declines the gambit and builds the rock-solid Orthodox structure, holding the d5-point and preparing to free the game with …c5.',
  },
  london: {
    hook: 'One setup against everything: the London System is the easiest strong opening to learn and the hardest to surprise.',
    idea: 'The London System is a "system" rather than a memorised line: White develops the dark-squared bishop to f4 outside the pawn chain, builds a solid pyramid of pawns on c3, d4 and e3, and plays essentially the same harmonious setup against almost anything Black does. It trades a few percentage points of theoretical ambition for reliability, safety and a deep understanding of the resulting middlegames.',
    lineExplained: 'After 1.d4 d5 2.Nf3 Nf6 3.Bf4 White gets the bishop out before locking it in with e3. Black develops naturally with 3…e6 and 4…Bd6, offering to trade the good f4-bishop. White sidesteps with 5.Bg3, keeping the bishop, and after 5…O-O 6.Bd3 both sides complete a healthy setup; Black strikes at the centre with 6…c5, the standard challenge to White’s d4-pawn.',
    plansWhite: 'White’s plan is clear and repeatable: complete the setup with Nbd2, c3, and often Ne5 planting a knight in the centre, then attack on the kingside with h4–h5, Qf3/Qh5 and a rook lift. The Bd3–Bg3 battery aimed at h7 is the engine of many London attacks.',
    plansBlack: 'Black should challenge actively before White gets comfortable: …c5 and …Qb6 hit d4 and b2, …Nc6 and …cxd4 open lines, and trading off the strong f4/g3-bishop (or the e5-knight) takes the sting out of White’s attack. Passive play lets White build the kingside assault unopposed.',
    trap: 'The London’s main headache is …Qb6, hitting the b2-pawn and d4 at once. If White carelessly defends b2 with b3, the dark squares sag; if White ignores it, a pawn falls. The right handling is to be ready with Qc1, Qb3 (offering a queen trade), or Nc3/Nbd2 support — know this in advance so …Qb6 doesn’t win a pawn.',
    suits: 'Busy players and improvers who want a complete, low-theory 1.d4 repertoire they can trust in every game, and attackers who enjoy the recurring Bd3–plus–Ne5 kingside plan.',
    tableNote: 'White sets up the solid Bf4 pyramid and keeps the bishop with Bg3; Black challenges the centre with …c5 and eyes the …Qb6 pressure point.',
  },
  'caro-kann': {
    hook: 'Solid like the French, but the "bad" bishop gets out first: a bulletproof defence with a healthy structure.',
    idea: 'The Caro-Kann answers 1.e4 with 1…c6, preparing …d5 while — crucially — keeping the light-squared bishop free. That single difference from the French is its whole appeal: Black gets a rock-solid pawn structure without burying the problem bishop behind the pawn chain. In the Classical Variation Black develops that bishop actively to f5 before playing …e6, solving the French’s biggest headache.',
    lineExplained: 'After 1.e4 c6 2.d4 d5 3.Nc3 Black clarifies the centre with 3…dxe4 4.Nxe4, and now the point of the whole system: 4…Bf5 develops the bishop actively, hitting the e4-knight. White gains kingside space by chasing it: 5.Ng3 Bg6 6.h4, and Black makes the vital escape square with 6…h6, reaching the B19 Classical main line where the bishop is safe on h7 and Black is ready to complete development.',
    plansWhite: 'White has a space advantage and a plan: h4–h5 to cramp the g6-bishop, Nf3, Bd3 (trading the light-squared bishops), Qe2 and O-O-O with a pawn storm, or a calmer central build-up. The extra kingside space and easy development give White a pleasant, low-risk edge.',
    plansBlack: 'Black completes a harmonious setup: …Nd7, …Ngf6, …e6, …Bd6 (or …Be7) and …O-O, with the famously solid Caro structure and no bad pieces. The plan is to neutralise White’s space with sound development and later break with …c5, reaching a safe, resilient middlegame or a comfortable endgame.',
    trap: 'The move you must not omit is 6…h6. Without it, White’s h4–h5 followed by ideas like Ne5, Bd3 and Qxg6, or a well-timed Ng5/Bg5, can harass and even trap the light-squared bishop that Black developed so proudly. The little pawn move on h6 gives the bishop its retreat on h7 and is the glue that holds the whole Classical system together.',
    suits: 'Players who love the French’s solidity but hate its passive bishop — anyone who wants a dependable, structurally sound defence to 1.e4 with clear plans and few tactical land-mines.',
    tableNote: 'Black develops the light-squared bishop actively before …e6; White gains space with h4, and …h6 gives the bishop the vital h7 retreat.',
  },
};

// ---------------------------------------------------------------------------
// Shared "Board Room" CSS. `extra` appends page-type-specific rules.
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
  .board-wrap { display:flex; justify-content:center; margin:22px 0; }
  svg.board { width:100%; max-width:360px; height:auto; display:block;
    border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.4); }
  svg.board.thumb { max-width:132px; border-radius:10px; box-shadow:0 6px 16px rgba(0,0,0,.35); }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:14px;
    padding:18px 20px; margin:22px 0; }
  .panel h2 { margin-top:0; }
  table.notation { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
  table.notation caption { text-align:left; color:var(--muted); font-size:13px; padding-bottom:10px; }
  table.notation td, table.notation th { padding:7px 10px; text-align:left; border-bottom:1px solid var(--border); }
  table.notation th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  table.notation td.num { color:var(--muted); width:44px; }
  table.notation td.mv { font-weight:600; color:var(--text); }
  table.notation tr:last-child td { border-bottom:none; }
  .note { color:var(--muted); font-size:14px; margin-top:12px; }
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
  @media (max-width:560px) {
    h1 { font-size:28px; }
    .wrap { padding:20px 16px 56px; }
    .btn { display:block; min-height:44px; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { transition:none !important; animation:none !important; }
  }
${extra}`;
}

// ---------------------------------------------------------------------------
// Per-opening page
// ---------------------------------------------------------------------------
function notationTable(line, note) {
  let rows = '';
  for (let i = 0; i < line.length; i += 2) {
    const n = i / 2 + 1;
    const white = escHtml(line[i]);
    const black = line[i + 1] != null ? escHtml(line[i + 1]) : '';
    rows += `        <tr><td class="num">${n}.</td><td class="mv">${white}</td><td class="mv">${black}</td></tr>\n`;
  }
  return `      <table class="notation">
        <caption>Main line — the moves in the order they are played</caption>
        <thead><tr><th>#</th><th>White</th><th>Black</th></tr></thead>
        <tbody>
${rows}        </tbody>
      </table>
      <p class="note">${escHtml(note)}</p>`;
}

function openingPageHtml(o, slug, fen, SITE) {
  const c = CONTENT[o.id];
  if (!c) throw new Error(`no authored content for opening id "${o.id}"`);
  const url = `${SITE}/openings/${slug}.html`;
  const sideLabel = o.userColor === 'w' ? 'White' : 'Black';
  const title = `${o.name} — Chess Opening Guide (ECO ${o.eco}) | ChessTrophies`;
  const desc = `${o.name} explained in plain English: the ideas, main line (${o.line.slice(0, 4).join(' ')}…), plans for both sides and a common trap. ECO ${o.eco}.`;
  const boardAria = `Chessboard: the ${o.name} position after ${finalPlyLabel(o.line)}`;
  const board = fenToBoardSvg(fen, boardAria);

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${o.name} — Chess Opening Guide`,
    description: desc,
    articleSection: 'Chess Openings',
    about: `${o.name} (ECO ${o.eco})`,
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
      { '@type': 'ListItem', position: 2, name: 'Openings', item: `${SITE}/openings/` },
      { '@type': 'ListItem', position: 3, name: o.name, item: url },
    ],
  };

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
<meta property="og:title" content="${escHtml(o.name + ' — Chess Opening Guide (ECO ' + o.eco + ')')}" />
<meta property="og:description" content="${escHtml(desc)}" />
<meta property="og:url" content="${escHtml(url)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escHtml(o.name + ' — Chess Opening Guide')}" />
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
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/openings/">Openings</a> &rsaquo; ${escHtml(o.name)}</nav>
    <article>
      <p class="eyebrow">Opening · ECO ${escHtml(o.eco)}</p>
      <h1>${escHtml(o.name)}</h1>
      <div class="walnut-rule" aria-hidden="true"></div>
      <p class="hook">${escHtml(c.hook)}</p>

      <div class="board-wrap">
${board}
      </div>

      <section class="panel" aria-label="Main line">
${notationTable(o.line, c.tableNote)}
      </section>

      <h2>The idea</h2>
      <p>${escHtml(c.idea)}</p>

      <h2>Main line explained</h2>
      <p>${escHtml(c.lineExplained)}</p>

      <h2>Plans for both sides</h2>
      <p><strong>White:</strong> ${escHtml(c.plansWhite)}</p>
      <p><strong>Black:</strong> ${escHtml(c.plansBlack)}</p>

      <h2>A common trap to avoid</h2>
      <p>${escHtml(c.trap)}</p>

      <h2>Who it suits</h2>
      <p>${escHtml(c.suits)}</p>

      <p class="note">In this line you play <strong>${sideLabel}</strong>. The board above shows the position reached after ${escHtml(finalPlyLabel(o.line))}.</p>
    </article>

    <section class="cta">
      <h2>Learn it by playing it</h2>
      <p>Drill the ${escHtml(o.name)} move-by-move in the free Opening Trainer — the board corrects you, so the line sticks.</p>
      <a class="btn" href="/">Open the free Opening Trainer</a>
    </section>

    <footer>
      <a href="/openings/">&larr; All chess openings</a> &nbsp;·&nbsp;
      <a href="/learn/">Chess lessons</a> &nbsp;·&nbsp;
      <a href="/">Home</a>
    </footer>
  </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// /openings/ hub index
// ---------------------------------------------------------------------------
function openingsIndexHtml(entries, SITE) {
  const url = `${SITE}/openings/`;
  const collectionLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Chess Openings Explained — ChessTrophies',
    url,
    description: 'Plain-English guides to the great chess openings: the Italian Game, Ruy López, Sicilian Defence, French, Queen’s Gambit Declined, London System and Caro-Kann — with real board positions and main lines.',
    hasPart: entries.map((e) => ({ '@type': 'Article', name: e.name, url: `${SITE}/openings/${e.slug}.html` })),
  };
  const crumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Openings', item: url },
    ],
  };

  const cards = entries.map((e) => {
    const side = e.userColor === 'w' ? 'You play White' : 'You play Black';
    const firstMoves = e.line.slice(0, 6).map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
    return `      <a class="card" href="/openings/${escHtml(e.slug)}.html">
        <div class="card-board">${boardThumbSvg(e.fen, `${e.name} position`)}</div>
        <div class="card-body">
          <div class="card-eco">ECO ${escHtml(e.eco)} · ${escHtml(side)}</div>
          <div class="card-name">${escHtml(e.name)}</div>
          <div class="card-oneliner">${escHtml(e.hook)}</div>
          <div class="card-moves">${escHtml(firstMoves)}…</div>
        </div>
      </a>`;
  }).join('\n');

  const extraCss = `  .lede { font-size:18px; color:var(--body); margin:0 0 6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:16px; margin-top:26px; }
  .card { display:flex; gap:14px; align-items:flex-start; background:var(--panel);
    border:1px solid var(--border); border-radius:14px; padding:14px; color:var(--text);
    text-decoration:none; transition:transform .15s ease, border-color .15s ease, box-shadow .15s ease; }
  .card:hover { transform:translateY(-2px); border-color:var(--gold); box-shadow:0 10px 26px rgba(0,0,0,.35); text-decoration:none; }
  .card-board { flex:0 0 auto; }
  .card-body { min-width:0; }
  .card-eco { font-family:var(--serif); text-transform:uppercase; letter-spacing:.1em;
    font-size:11px; color:var(--gold); font-weight:700; }
  .card-name { font-family:var(--serif); font-size:19px; font-weight:700; margin:2px 0 4px; }
  .card-oneliner { color:var(--muted); font-size:13.5px; line-height:1.45; }
  .card-moves { color:var(--body); font-size:12.5px; margin-top:8px; font-variant-numeric:tabular-nums; opacity:.85; }
  @media (max-width:560px) { .grid { grid-template-columns:1fr; } }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Chess Openings Explained — Ideas, Main Lines &amp; Traps | ChessTrophies</title>
<meta name="description" content="Plain-English guides to the great chess openings — the Italian Game, Ruy López, Sicilian Defence, French, Queen's Gambit Declined, London System and Caro-Kann. Real board positions, main lines and common traps." />
<link rel="canonical" href="${escHtml(url)}" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="ChessTrophies" />
<meta property="og:title" content="Chess Openings Explained — ChessTrophies" />
<meta property="og:description" content="Plain-English guides to the great chess openings, with real board positions, main lines and common traps." />
<meta property="og:url" content="${escHtml(url)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Chess Openings Explained — ChessTrophies" />
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
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; Openings</nav>
    <p class="eyebrow">The Board Room · Openings</p>
    <h1>Chess Openings Explained</h1>
    <div class="walnut-rule" aria-hidden="true"></div>
    <p class="lede">Every great game starts with an opening. These plain-English guides show you the <em>ideas</em> behind the classics — not just moves to memorise — with the real resulting position on the board, the main line, the plans for both sides and the trap everyone falls for.</p>
    <section class="grid" aria-label="Chess openings">
${cards}
    </section>
    <section class="cta">
      <h2>Turn theory into instinct</h2>
      <p>Drill any of these openings move-by-move in the free Opening Trainer — no sign-up, no cost.</p>
      <a class="btn" href="/">Open the free Opening Trainer</a>
    </section>
    <footer>
      <a href="/learn/">Chess lessons</a> &nbsp;·&nbsp;
      <a href="/">Home</a>
    </footer>
  </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Public API: generate the pages + return the sitemap URLs.
// ---------------------------------------------------------------------------
export async function generate({ DIST, SITE = DEFAULT_SITE } = {}) {
  if (!DIST) throw new Error('generate() requires { DIST }');
  const Chess = await loadChess();
  const openings = await loadOpenings();

  await fsp.mkdir(path.join(DIST, 'openings'), { recursive: true });

  const seen = new Set();
  const entries = [];
  const urls = [];

  for (const o of openings) {
    if (!o || !o.id || !Array.isArray(o.line)) continue;

    // Replay the SAN line to compute the real FEN AND prove it is legal.
    const g = new Chess();
    for (let i = 0; i < o.line.length; i++) {
      const mv = g.move(o.line[i], { sloppy: true });
      if (!mv) throw new Error(`ILLEGAL book move "${o.line[i]}" at ply ${i} in opening "${o.id}"`);
    }
    const fen = g.fen();

    let slug = slugify(o.name);
    let unique = slug, n = 2;
    while (seen.has(unique)) unique = `${slug}-${n++}`;
    seen.add(unique);
    slug = unique;

    await fsp.writeFile(path.join(DIST, 'openings', slug + '.html'), openingPageHtml(o, slug, fen, SITE), 'utf8');

    entries.push({ id: o.id, name: o.name, eco: o.eco, userColor: o.userColor, line: o.line, slug, fen, hook: CONTENT[o.id].hook });
    urls.push({ loc: `${SITE}/openings/${slug}.html`, priority: '0.7' });
  }

  await fsp.writeFile(path.join(DIST, 'openings', 'index.html'), openingsIndexHtml(entries, SITE), 'utf8');

  // Hub first (higher priority), then the individual pages.
  const allUrls = [{ loc: `${SITE}/openings/`, priority: '0.8' }, ...urls];
  return { urls: allUrls, count: entries.length };
}

// ---------------------------------------------------------------------------
// Standalone preview: `node scripts/seo/openings-pages.mjs [outDir]`
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = path.resolve(process.argv[2] || './_preview');
  generate({ DIST: outDir, SITE: DEFAULT_SITE })
    .then((res) => {
      console.log(`[openings-seo] wrote ${res.count} opening page(s) + index into ${path.join(outDir, 'openings')}`);
      for (const u of res.urls) console.log('  ' + u.loc + '  (priority ' + u.priority + ')');
    })
    .catch((err) => { console.error('[openings-seo] FAILED:', err); process.exit(1); });
}
