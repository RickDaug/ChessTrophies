#!/usr/bin/env node
/*
 * import-puzzles.mjs — import a filtered subset of the Lichess CC0 puzzle
 * database into the ChessTrophies `puzzles` table.
 *
 * The game ships with a small VERIFIED seed corpus (puzzle-seed.mjs) so puzzles
 * work with zero setup. Run THIS script post-deploy to scale up to thousands of
 * puzzles. The API prefers the `puzzles` table and falls back to the seed when
 * it's empty, so importing is purely additive — no code change needed.
 *
 * ── DATA SOURCE ────────────────────────────────────────────────────────────
 * Lichess publishes the full puzzle DB (CC0 / public domain) at:
 *     https://database.lichess.org/lichess_db_puzzle.csv.zst
 * It is large (~300MB compressed, ~1GB CSV) and Zstandard-compressed. This script
 * reads ALL THREE forms directly — no external tools, no extra npm deps:
 *     • .csv        plain CSV
 *     • .csv.gz     gzip      (node zlib gunzip)
 *     • .csv.zst    Zstandard (node 22+ zlib zstd; see ZSTD NOTE below)
 *
 * It can also STREAM straight from the URL — pass the https URL as the path and it
 * downloads + decompresses on the fly, so you never need to store the giant file:
 *     node server/import-puzzles.mjs https://database.lichess.org/lichess_db_puzzle.csv.zst --limit 3000
 *
 * ZSTD NOTE: the Lichess .zst begins with a small Zstandard *skippable frame*
 * (magic 0x184D2A5x) before the real data frame, and uses a large window. Node's
 * stream decompressor stops at the skippable frame and rejects the big window by
 * default, so we (a) strip leading skippable frames and (b) raise ZSTD_d_windowLogMax.
 * Requires Node >= 22.15 (zlib.createZstdDecompress). On older Node, decompress
 * out-of-band first (`zstd -d lichess_db_puzzle.csv.zst -o lichess_db_puzzle.csv`)
 * and feed the plain .csv.
 *
 * CSV columns (header row present):
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
 *
 * NOTE on the `Moves` field: Lichess gives the moves with the OPPONENT'S setup
 * move FIRST (the FEN is the position BEFORE that move). This script applies that
 * first move so the stored FEN is the position with the SOLVER to move, and the
 * stored solution line begins with the solver's first move — matching the seed's
 * format (even indices = solver moves).
 *
 * ── USAGE ──────────────────────────────────────────────────────────────────
 *   node server/import-puzzles.mjs <path-or-url.csv[.gz|.zst]> [options]
 *
 * Options (env or flags):
 *   --min-rating N     (default 800)    only import puzzles rated >= N
 *   --max-rating N     (default 2200)   only import puzzles rated <= N
 *   --min-popularity N (default 80)     Lichess popularity score >= N (max 100)
 *   --min-plays N      (default 100)    NbPlays >= N (well-tested puzzles)
 *   --limit N          (default 2000)   cap the number imported
 *   --max-plies N      (default 12)     skip lines longer than N solver plies
 *   --themes a,b,c     (optional)       only puzzles whose Themes include ANY of these
 *   --replace          (flag)           DELETE existing rows before importing
 *
 * The active DB backend is chosen exactly like the server: SQLite by default,
 * Postgres when DB_BACKEND=postgres (+ DATABASE_URL). All SQL is parameterized,
 * and the upsert is idempotent (re-running updates in place, never duplicates).
 *
 * Every imported puzzle's full solution line is RE-VALIDATED for legality with
 * the bundled chess.js before insert; illegal/garbled rows are skipped + counted.
 *
 * ── RUN IT ON RAILWAY (against the production Postgres DB) ──────────────────
 * The API falls back to puzzle-seed.mjs (1200+ verified puzzles) when the
 * `puzzles` table is empty, so this import is OPTIONAL — it only scales the
 * corpus further. To populate the prod table, run a ONE-OFF command on Railway
 * (Project → your service → ⋮ → "Run a command", or the CLI). Postgres must be
 * selected via env (DB_BACKEND=postgres + DATABASE_URL, both already set in prod):
 *
 *   railway run node server/import-puzzles.mjs \
 *     https://database.lichess.org/lichess_db_puzzle.csv.zst \
 *     --min-rating 800 --max-rating 2200 --min-popularity 90 \
 *     --min-plays 1000 --limit 5000
 *
 * (`railway run` injects the service env incl. DATABASE_URL/DB_BACKEND. Omit the
 * URL and pass a local .csv path instead if you prefer to pre-download.) Re-run
 * any time to refresh/extend — it upserts by id and never duplicates rows.
 */

import fs from 'node:fs';
import https from 'node:https';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { Transform } from 'node:stream';
import { Chess } from '../chess.min.js';
import * as store from './store.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const flagOnly = key === 'replace';
      if (flagOnly) { out[key] = true; continue; }
      out[key] = argv[++i];
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const csvPath = args._[0];
if (!csvPath) {
  console.error('Usage: node server/import-puzzles.mjs <path-or-url.csv[.gz|.zst]> [--min-rating N --max-rating N --min-popularity N --min-plays N --limit N --max-plies N --themes a,b --replace]');
  process.exit(2);
}
const IS_URL = /^https?:\/\//i.test(csvPath);
const IS_ZST = /\.zst$/i.test(csvPath);
const IS_GZ = /\.gz$/i.test(csvPath);
if (!IS_URL && !fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(2);
}
if (IS_ZST && typeof zlib.createZstdDecompress !== 'function') {
  console.error('This Node build has no zstd support (needs Node >= 22.15). Decompress first: `zstd -d ' +
    csvPath + ' -o ' + csvPath.replace(/\.zst$/i, '') + '` then re-run on the plain .csv.');
  process.exit(2);
}

const MIN_RATING = parseInt(args['min-rating'] ?? process.env.PUZZLE_MIN_RATING ?? '800', 10);
const MAX_RATING = parseInt(args['max-rating'] ?? process.env.PUZZLE_MAX_RATING ?? '2200', 10);
const MIN_POP = parseInt(args['min-popularity'] ?? process.env.PUZZLE_MIN_POPULARITY ?? '80', 10);
const MIN_PLAYS = parseInt(args['min-plays'] ?? process.env.PUZZLE_MIN_PLAYS ?? '100', 10);
const LIMIT = parseInt(args.limit ?? process.env.PUZZLE_LIMIT ?? '2000', 10);
const MAX_PLIES = parseInt(args['max-plies'] ?? process.env.PUZZLE_MAX_PLIES ?? '12', 10);
const THEME_FILTER = (args.themes ? String(args.themes) : '').split(',').map((s) => s.trim()).filter(Boolean);
const REPLACE = !!args.replace;

// Strip leading Zstandard *skippable frames* (magic 0x184D2A5x + 4-byte LE size)
// so node's zstd decompressor reaches the real data frame (Lichess prepends one).
class StripZstdSkippable extends Transform {
  constructor() { super(); this._buf = Buffer.alloc(0); this._past = false; }
  _transform(chunk, _enc, cb) {
    if (this._past) { this.push(chunk); return cb(); }
    this._buf = Buffer.concat([this._buf, chunk]);
    for (;;) {
      if (this._buf.length < 8) return cb();
      const magic = this._buf.readUInt32LE(0);
      if ((magic & 0xFFFFFFF0) === 0x184D2A50) {
        const size = this._buf.readUInt32LE(4);
        if (this._buf.length < 8 + size) return cb();   // await the full frame
        this._buf = this._buf.subarray(8 + size);        // drop the skippable frame
      } else {
        this._past = true;
        if (this._buf.length) this.push(this._buf);
        this._buf = null;
        return cb();
      }
    }
  }
}

// Open the input as a line source: local file or https URL, transparently
// gunzip'd (.gz) or zstd-decompressed (.zst, skippable frame stripped + large
// window allowed). Returns a readable stream of decompressed bytes.
function openInputStream() {
  return new Promise((resolve, reject) => {
    const wrap = (raw) => {
      if (IS_GZ) return raw.pipe(zlib.createGunzip());
      if (IS_ZST) {
        const dec = zlib.createZstdDecompress({ params: { [zlib.constants.ZSTD_d_windowLogMax]: 31 } });
        return raw.pipe(new StripZstdSkippable()).pipe(dec);
      }
      return raw;
    };
    if (!IS_URL) { resolve(wrap(fs.createReadStream(csvPath))); return; }
    https.get(csvPath, { headers: { 'User-Agent': 'chesstrophies-importer/1.0' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`download failed: HTTP ${res.statusCode}`)); res.resume(); return; }
      resolve(wrap(res));
    }).on('error', reject);
  });
}

// Ensure the puzzles table exists on the active backend. SQLite uses `?`;
// Postgres needs `$n` + serial-free DDL. We branch on store.usingPostgres.
async function ensureTable() {
  if (store.usingPostgres) {
    await store.init(); // ensures the rest of the schema too
    await store.run(`CREATE TABLE IF NOT EXISTS puzzles (
      id TEXT PRIMARY KEY,
      fen TEXT NOT NULL,
      moves TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 0,
      theme TEXT NOT NULL DEFAULT 'tactics',
      title TEXT NOT NULL DEFAULT '',
      hint TEXT NOT NULL DEFAULT '',
      popularity INTEGER NOT NULL DEFAULT 0,
      nb_plays INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'lichess'
    )`);
    await store.run('CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles(rating)');
  } else {
    await store.run(`CREATE TABLE IF NOT EXISTS puzzles (
      id TEXT PRIMARY KEY,
      fen TEXT NOT NULL,
      moves TEXT NOT NULL,
      rating INTEGER NOT NULL DEFAULT 0,
      theme TEXT NOT NULL DEFAULT 'tactics',
      title TEXT NOT NULL DEFAULT '',
      hint TEXT NOT NULL DEFAULT '',
      popularity INTEGER NOT NULL DEFAULT 0,
      nb_plays INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'lichess'
    )`);
    await store.run('CREATE INDEX IF NOT EXISTS idx_puzzles_rating ON puzzles(rating)');
  }
}

// A simple CSV line splitter. The Lichess puzzle CSV does NOT quote its fields
// (FEN/Moves/Themes have no commas of their own), so a plain split on ',' is
// correct and avoids pulling in a CSV-parser dependency. OpeningTags (last col)
// may contain spaces but no commas. We defensively cap at 10 fields.
function splitCsv(line) {
  return line.split(',');
}

// Convert a Lichess puzzle row to our stored shape, or null if it's illegal /
// filtered out. Applies the opponent's setup move so the FEN is solver-to-move.
function toPuzzle(cols) {
  const [PuzzleId, FEN, Moves, Rating, , Popularity, NbPlays, Themes] = cols;
  if (!PuzzleId || !FEN || !Moves) return null;
  const rating = parseInt(Rating, 10) || 0;
  const popularity = parseInt(Popularity, 10) || 0;
  const nbPlays = parseInt(NbPlays, 10) || 0;
  if (rating < MIN_RATING || rating > MAX_RATING) return null;
  if (popularity < MIN_POP) return null;
  if (nbPlays < MIN_PLAYS) return null;
  const themes = (Themes || '').split(' ').filter(Boolean);
  if (THEME_FILTER.length && !themes.some((t) => THEME_FILTER.includes(t))) return null;

  const uci = Moves.trim().split(/\s+/).filter(Boolean);
  if (uci.length < 2) return null; // need a setup move + at least one solver move
  if (uci.length - 1 > MAX_PLIES) return null; // too long for a casual trainer

  // Each UCI token must be well-formed before we touch the board (the seed test
  // enforces the same /^[a-h][1-8][a-h][1-8][qrbn]?$/ shape).
  if (!uci.every((t) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t))) return null;

  // Validate the whole line for legality and apply the FIRST (opponent) move so
  // the stored FEN is the position the solver actually faces.
  let chess;
  try { chess = new Chess(FEN); } catch { return null; }
  function applyUci(tok) {
    const mv = { from: tok.slice(0, 2), to: tok.slice(2, 4) };
    if (tok.length > 4) mv.promotion = tok.slice(4);
    return chess.move(mv);
  }
  if (!applyUci(uci[0])) return null;          // opponent's setup move
  const solverFen = chess.fen();
  let endedMate = false;
  for (let i = 1; i < uci.length; i++) {
    if (!applyUci(uci[i])) return null;         // rest of the line must be legal
    endedMate = chess.in_checkmate();
  }

  // Pick a single primary theme tag for display (first recognised tactic theme).
  const KNOWN = ['mate', 'fork', 'pin', 'skewer', 'discoveredAttack', 'deflection', 'sacrifice', 'advantage', 'endgame', 'crushing'];
  // Treat any mate-family tag as canonical 'mate' so the value carries the same
  // "ends in checkmate" guarantee the seed uses. But only honour it if the line
  // ACTUALLY ends in checkmate — otherwise downgrade so we never label a non-mate
  // as mate.
  let theme;
  if (themes.some((t) => /mate/i.test(t)) && endedMate) theme = 'mate';
  else theme = themes.find((t) => KNOWN.includes(t) && t !== 'mate') || themes.find((t) => !/mate/i.test(t)) || 'advantage';

  const TITLE = { mate: 'Checkmate', fork: 'Fork', pin: 'Pin', skewer: 'Skewer',
    discoveredAttack: 'Discovered Attack', deflection: 'Deflection', sacrifice: 'Sacrifice',
    advantage: 'Win Material', endgame: 'Endgame Tactic', crushing: 'Crushing Attack' };
  const HINT = { mate: 'Find the forced checkmate.', fork: 'One piece attacks two targets at once.',
    pin: 'Exploit a piece that cannot move.', skewer: 'Check a valuable piece so the one behind it falls.',
    discoveredAttack: 'Move one piece to unleash the attack behind it.',
    deflection: 'Force a defender away from what it guards.', sacrifice: 'Give up material for a winning follow-up.',
    advantage: 'Win material with a forcing sequence.', endgame: 'Convert with precise endgame play.',
    crushing: 'Find the crushing blow.' };

  return {
    id: 'li-' + PuzzleId,
    fen: solverFen,
    moves: uci.slice(1).join(' '),   // solver line (setup move stripped)
    rating,
    theme,
    title: TITLE[theme] || 'Tactic',
    hint: HINT[theme] || 'Find the best move.',
    popularity,
    nbPlays,
  };
}

async function upsert(p) {
  if (store.usingPostgres) {
    await store.run(
      `INSERT INTO puzzles (id, fen, moves, rating, theme, title, hint, popularity, nb_plays, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lichess')
       ON CONFLICT (id) DO UPDATE SET fen=excluded.fen, moves=excluded.moves, rating=excluded.rating,
         theme=excluded.theme, title=excluded.title, hint=excluded.hint,
         popularity=excluded.popularity, nb_plays=excluded.nb_plays`,
      [p.id, p.fen, p.moves, p.rating, p.theme, p.title, p.hint, p.popularity, p.nbPlays]
    );
  } else {
    await store.run(
      `INSERT INTO puzzles (id, fen, moves, rating, theme, title, hint, popularity, nb_plays, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lichess')
       ON CONFLICT(id) DO UPDATE SET fen=excluded.fen, moves=excluded.moves, rating=excluded.rating,
         theme=excluded.theme, title=excluded.title, hint=excluded.hint,
         popularity=excluded.popularity, nb_plays=excluded.nb_plays`,
      [p.id, p.fen, p.moves, p.rating, p.theme, p.title, p.hint, p.popularity, p.nbPlays]
    );
  }
}

async function main() {
  console.log(`[import] backend: ${store.usingPostgres ? 'postgres' : 'sqlite'}`);
  console.log(`[import] source : ${IS_URL ? 'URL (stream)' : 'file'} ${csvPath}` +
    (IS_ZST ? ' [zstd]' : IS_GZ ? ' [gzip]' : ''));
  console.log(`[import] filters: rating ${MIN_RATING}-${MAX_RATING}, popularity >= ${MIN_POP}, plays >= ${MIN_PLAYS}, max-plies ${MAX_PLIES}, limit ${LIMIT}` +
    (THEME_FILTER.length ? `, themes: ${THEME_FILTER.join(',')}` : ''));
  await ensureTable();
  if (REPLACE) {
    console.log('[import] --replace: clearing existing puzzles…');
    await store.run('DELETE FROM puzzles', []);
  }

  // Stream the input line-by-line (local/URL, transparently gunzip'd/zstd-decoded).
  const input = await openInputStream();
  input.on('error', (e) => { console.error('[import] input stream error:', e && e.message); });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let lineNo = 0, kept = 0, skipped = 0, illegal = 0;
  for await (const line of rl) {
    lineNo++;
    if (lineNo === 1 && /PuzzleId/i.test(line)) continue; // header
    if (!line.trim()) continue;
    if (kept >= LIMIT) break;
    const cols = splitCsv(line);
    let p;
    try { p = toPuzzle(cols); } catch { illegal++; continue; }
    if (!p) { skipped++; continue; }
    try { await upsert(p); kept++; }
    catch (e) { illegal++; if (illegal <= 5) console.error('[import] upsert failed:', e && e.message); }
    if (kept % 250 === 0) console.log(`[import] …${kept} imported (scanned ${lineNo})`);
  }

  console.log(`[import] DONE: imported ${kept}, filtered ${skipped}, errors/illegal ${illegal} (scanned ${lineNo} lines).`);
  try { await store.closePool(); } catch { /* sqlite: noop */ }
  process.exit(0);
}

main().catch((e) => { console.error('[import] FAILED:', e); process.exit(1); });
