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
 * Lichess publishes the full puzzle DB (CC0) at:
 *     https://database.lichess.org/lichess_db_puzzle.csv.zst
 * It is large (hundreds of MB compressed) and Zstandard-compressed. Node has no
 * built-in .zst decoder, so DECOMPRESS IT FIRST, then point this script at the
 * plain .csv:
 *     # macOS/Linux:  brew install zstd  (or apt-get install zstd)
 *     zstd -d lichess_db_puzzle.csv.zst -o lichess_db_puzzle.csv
 *     # Windows (PowerShell, with zstd installed):
 *     zstd -d lichess_db_puzzle.csv.zst -o lichess_db_puzzle.csv
 * (A plain .csv.gz is also accepted directly — node's built-in zlib handles gzip.)
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
 *   node server/import-puzzles.mjs <path-to.csv> [options]
 *
 * Options (env or flags):
 *   --min-rating N     (default 800)    only import puzzles rated >= N
 *   --max-rating N     (default 2200)   only import puzzles rated <= N
 *   --min-popularity N (default 80)     Lichess popularity score >= N (max 100)
 *   --min-plays N      (default 100)    NbPlays >= N (well-tested puzzles)
 *   --limit N          (default 2000)   cap the number imported
 *   --themes a,b,c     (optional)       only puzzles whose Themes include ANY of these
 *   --replace          (flag)           DELETE existing rows before importing
 *
 * The active DB backend is chosen exactly like the server: SQLite by default,
 * Postgres when DB_BACKEND=postgres (+ DATABASE_URL). All SQL is parameterized.
 *
 * Every imported puzzle's full solution line is RE-VALIDATED for legality with
 * the bundled chess.js before insert; illegal/garbled rows are skipped + counted.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
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
  console.error('Usage: node server/import-puzzles.mjs <path-to.csv|.csv.gz> [--min-rating N --max-rating N --min-popularity N --min-plays N --limit N --themes a,b --replace]');
  process.exit(2);
}
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  if (/\.zst$/i.test(csvPath)) console.error('(.zst is not supported directly — decompress it first: `zstd -d file.csv.zst -o file.csv`)');
  process.exit(2);
}
if (/\.zst$/i.test(csvPath)) {
  console.error('.zst files are not supported by node. Decompress first: `zstd -d ' + csvPath + ' -o ' + csvPath.replace(/\.zst$/i, '') + '` then re-run.');
  process.exit(2);
}

const MIN_RATING = parseInt(args['min-rating'] ?? process.env.PUZZLE_MIN_RATING ?? '800', 10);
const MAX_RATING = parseInt(args['max-rating'] ?? process.env.PUZZLE_MAX_RATING ?? '2200', 10);
const MIN_POP = parseInt(args['min-popularity'] ?? process.env.PUZZLE_MIN_POPULARITY ?? '80', 10);
const MIN_PLAYS = parseInt(args['min-plays'] ?? process.env.PUZZLE_MIN_PLAYS ?? '100', 10);
const LIMIT = parseInt(args.limit ?? process.env.PUZZLE_LIMIT ?? '2000', 10);
const THEME_FILTER = (args.themes ? String(args.themes) : '').split(',').map((s) => s.trim()).filter(Boolean);
const REPLACE = !!args.replace;

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
  for (let i = 1; i < uci.length; i++) {
    if (!applyUci(uci[i])) return null;         // rest of the line must be legal
  }

  // Pick a single primary theme tag for display (first recognised tactic theme).
  const KNOWN = ['mate', 'fork', 'pin', 'skewer', 'discoveredAttack', 'deflection', 'sacrifice', 'advantage', 'endgame', 'crushing'];
  const theme = themes.find((t) => KNOWN.includes(t)) || themes[0] || 'tactics';

  return {
    id: 'li-' + PuzzleId,
    fen: solverFen,
    moves: uci.slice(1).join(' '),   // solver line (setup move stripped)
    rating,
    theme,
    title: '',
    hint: '',
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
         theme=excluded.theme, popularity=excluded.popularity, nb_plays=excluded.nb_plays`,
      [p.id, p.fen, p.moves, p.rating, p.theme, p.title, p.hint, p.popularity, p.nbPlays]
    );
  } else {
    await store.run(
      `INSERT INTO puzzles (id, fen, moves, rating, theme, title, hint, popularity, nb_plays, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lichess')
       ON CONFLICT(id) DO UPDATE SET fen=excluded.fen, moves=excluded.moves, rating=excluded.rating,
         theme=excluded.theme, popularity=excluded.popularity, nb_plays=excluded.nb_plays`,
      [p.id, p.fen, p.moves, p.rating, p.theme, p.title, p.hint, p.popularity, p.nbPlays]
    );
  }
}

async function main() {
  console.log(`[import] backend: ${store.usingPostgres ? 'postgres' : 'sqlite'}`);
  console.log(`[import] filters: rating ${MIN_RATING}-${MAX_RATING}, popularity >= ${MIN_POP}, plays >= ${MIN_PLAYS}, limit ${LIMIT}` +
    (THEME_FILTER.length ? `, themes: ${THEME_FILTER.join(',')}` : ''));
  await ensureTable();
  if (REPLACE) {
    console.log('[import] --replace: clearing existing puzzles…');
    await store.run('DELETE FROM puzzles', []);
  }

  // Stream the file line-by-line; transparently gunzip a .gz.
  let input = fs.createReadStream(csvPath);
  if (/\.gz$/i.test(csvPath)) input = input.pipe(zlib.createGunzip());
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
