#!/usr/bin/env node
/*
 * build.mjs — additive production build for the ChessTrophies web client.
 *
 * Reads the repo-root client files (index.html + the local <script src> it
 * loads) and emits a minified, deploy-ready copy into dist/. NOTHING in the
 * repo root is modified — this is purely additive.
 *
 * Strategy (lowest-risk):
 *   - Parse index.html for the EXACT ordered list of local <script src> files
 *     (ignoring the cdnjs socket.io tag and vendor/ scripts).
 *   - Minify each local JS file individually with esbuild.transform
 *     ({ minify:true, loader:'js' }) and write it to dist/ under the SAME name.
 *     These are classic IIFE/global scripts (NOT ES modules), so transform with
 *     loader:'js' preserves their semantics exactly — only smaller. This keeps
 *     load order, file count and the importScripts() contract identical.
 *   - Additionally concatenate the order-safe trailing tail
 *       app.js -> academy.js -> review.js
 *       -> trophy-extras.js -> learn-library.js
 *     (verified contiguous in index.html, all order-safe window globals, none
 *     importScripts'd by the worker) into ONE minified dist/app.bundle.js, and
 *     collapse those 5 tags in dist/index.html to a single <script>. This cuts
 *     requests without changing semantics. ct-ai.js, chess960.js, chess.min.js
 *     and everything else stay individual files (the worker importScripts the
 *     dist copies of ct-ai.js / chess960.js by exact name).
 *   - Copy through unchanged: vendor/ (socket.io fallback), all non-JS assets
 *     referenced by index.html (icons, manifest.json, *.html). chess.min.js is
 *     already minified -> copied verbatim. sw.js (+ its register + worker) are
 *     same-origin runtime JS -> minified too.
 *   - dist/index.html: byte-for-byte copy of index.html with ONLY the tail
 *     script tags collapsed + cache-busters bumped. The CSP is untouched.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// New cache-buster stamp for files this build rewrites (index.html tags).
const STAMP = 'b' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

// The contiguous, order-safe trailing tail to concatenate into app.bundle.js.
const TAIL = ['app.js', 'academy.js', 'review.js', 'trophy-extras.js', 'learn-library.js'];

// Extra same-origin runtime JS not in index.html's <script> list but loaded at
// runtime — must exist in dist by exact name. The worker importScripts these.
const RUNTIME_JS = ['sw.js', 'ct-ai-worker.js'];

// Non-JS assets / pages referenced by index.html (and the PWA) to copy verbatim.
const COPY_ASSETS = [
  'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-1024.png',
  'og-image.png', 'terms.html', 'privacy.html',
];

const log = (...a) => console.log('[build]', ...a);

// Parse the ordered local <script src="..."> list from index.html. Skips the
// cdnjs socket.io tag (cross-origin) and any vendor/ script.
function parseScripts(html) {
  const re = /<script\s+[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1];
    if (/^https?:\/\//i.test(raw)) continue;       // cdnjs socket.io — skip
    if (/^vendor\//i.test(raw)) continue;          // local vendor fallback — skip (copied verbatim)
    const file = raw.split('?')[0];                // strip cache-buster
    out.push({ tag: m[0], raw, file });
  }
  return out;
}

async function minifyFile(file, outName = file) {
  const src = await fsp.readFile(path.join(ROOT, file), 'utf8');
  const res = await esbuild.transform(src, { minify: true, loader: 'js', legalComments: 'none' });
  await fsp.writeFile(path.join(DIST, outName), res.code, 'utf8');
  return { in: Buffer.byteLength(src), out: Buffer.byteLength(res.code) };
}

async function main() {
  const t0 = Date.now();
  // Fresh dist/.
  await fsp.rm(DIST, { recursive: true, force: true });
  await fsp.mkdir(DIST, { recursive: true });

  const html = await fsp.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = parseScripts(html);
  const localFiles = scripts.map(s => s.file);
  log(`index.html references ${scripts.length} local scripts in order:`);
  log('  ' + localFiles.join(' -> '));

  // Verify the tail is the actual trailing contiguous order in index.html.
  const tailIdx = localFiles.indexOf(TAIL[0]);
  const contiguous = tailIdx >= 0 && TAIL.every((f, i) => localFiles[tailIdx + i] === f);
  if (!contiguous) {
    log('WARN: expected tail not contiguous; shipping per-file minified, no app.bundle.js');
  }

  const report = []; // { name, in, out, kind }
  const tailSet = new Set(contiguous ? TAIL : []);

  // 1) Minify every local script individually -> dist/<same name>.
  //    Skip tail members: they live ONLY in app.bundle.js and nothing
  //    references them by name (the worker importScripts only chess.min.js /
  //    ct-ai.js / chess960.js), so emitting separate copies is dead weight.
  for (const f of localFiles) {
    if (f === 'chess.min.js') continue; // already minified — copy verbatim below
    if (tailSet.has(f)) continue;       // bundled instead
    const r = await minifyFile(f);
    report.push({ name: f, ...r, kind: 'individual' });
  }

  // chess.min.js: copy verbatim (already minified).
  {
    const src = await fsp.readFile(path.join(ROOT, 'chess.min.js'));
    await fsp.writeFile(path.join(DIST, 'chess.min.js'), src);
    report.push({ name: 'chess.min.js', in: src.length, out: src.length, kind: 'copied (pre-minified)' });
  }

  // 2) Concatenate the order-safe tail -> one minified dist/app.bundle.js.
  let bundleReport = null;
  if (contiguous) {
    const parts = [];
    let rawTotal = 0;
    for (const f of TAIL) {
      const s = await fsp.readFile(path.join(ROOT, f), 'utf8');
      rawTotal += Buffer.byteLength(s);
      // Each file is its own IIFE/global block; separate with newline + semicolon
      // safety to avoid any ASI edge between concatenated files.
      parts.push('/*' + f + '*/\n' + s + '\n;');
    }
    const res = await esbuild.transform(parts.join('\n'), { minify: true, loader: 'js', legalComments: 'none' });
    await fsp.writeFile(path.join(DIST, 'app.bundle.js'), res.code, 'utf8');
    bundleReport = { name: 'app.bundle.js', in: rawTotal, out: Buffer.byteLength(res.code), kind: 'BUNDLE (tail x5)' };
  }

  // 3) Runtime JS not in index.html (sw.js, ct-ai-worker.js) — minify by name.
  for (const f of RUNTIME_JS) {
    const r = await minifyFile(f);
    report.push({ name: f, ...r, kind: 'individual (runtime)' });
  }

  // 4) Copy non-JS assets + vendor verbatim.
  for (const a of COPY_ASSETS) {
    const from = path.join(ROOT, a);
    if (!fs.existsSync(from)) { log(`WARN: asset missing, skipped: ${a}`); continue; }
    await fsp.copyFile(from, path.join(DIST, a));
  }
  // vendor/ (socket.io fallback) — copy the whole dir verbatim.
  const vendorDir = path.join(ROOT, 'vendor');
  if (fs.existsSync(vendorDir)) {
    await fsp.mkdir(path.join(DIST, 'vendor'), { recursive: true });
    for (const f of await fsp.readdir(vendorDir)) {
      await fsp.copyFile(path.join(vendorDir, f), path.join(DIST, 'vendor', f));
    }
  }

  // 5) Emit dist/index.html: original HTML with the tail tags collapsed to a
  //    single <script src="app.bundle.js?v=...">, all other tags' cache-busters
  //    bumped, CSP and everything else byte-identical.
  let outHtml = html;
  if (contiguous) {
    // Remove each tail tag, replacing the FIRST (app.js) with the bundle tag.
    const tailTags = scripts.filter(s => tailSet.has(s.file));
    tailTags.forEach((s, i) => {
      if (i === 0) {
        outHtml = outHtml.replace(s.tag, `<script src="app.bundle.js?v=${STAMP}"></script>`);
      } else {
        // Drop the tag (and a leading run of whitespace to avoid blank lines).
        outHtml = outHtml.replace(new RegExp('[ \\t]*' + escapeRe(s.tag) + '\\r?\\n?'), '');
      }
    });
  }
  // Bump cache-busters on the remaining individual local script tags so the new
  // minified files aren't served stale from an old SW/cache.
  for (const s of scripts) {
    if (tailSet.has(s.file)) continue; // those are gone / replaced
    const newRaw = s.file + '?v=' + STAMP;
    outHtml = outHtml.replace(s.tag, s.tag.replace(s.raw, newRaw));
  }
  await fsp.writeFile(path.join(DIST, 'index.html'), outHtml, 'utf8');

  // --- Size report ----------------------------------------------------------
  const allRows = [...report];
  if (bundleReport) allRows.push(bundleReport);
  // "Raw JS" baseline = every distinct source JS file once (no double counting
  // the tail). Dist JS = every emitted .js file in dist (individual + bundle).
  const rawBytes = uniqueRawJsBytes(localFiles, RUNTIME_JS);
  const distBytes = await distJsBytes();

  log('');
  log('per-file sizes (raw -> dist):');
  const pad = (s, n) => String(s).padEnd(n);
  for (const r of allRows.sort((a, b) => b.out - a.out)) {
    const pct = r.in ? ((1 - r.out / r.in) * 100).toFixed(1) : '0.0';
    log(`  ${pad(r.name, 22)} ${pad(fmt(r.in), 10)} -> ${pad(fmt(r.out), 10)} (${pct}% smaller)  [${r.kind}]`);
  }
  const totalPct = ((1 - distBytes / rawBytes) * 100).toFixed(1);
  log('');
  log(`TOTAL JS  raw ${fmt(rawBytes)}  ->  dist ${fmt(distBytes)}  =  ${totalPct}% smaller`);
  log(`dist/ written in ${Date.now() - t0}ms`);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fmt(n) { return (n / 1024).toFixed(1) + ' KB'; }

function uniqueRawJsBytes(localFiles, runtime) {
  let total = 0;
  const seen = new Set();
  for (const f of [...localFiles, ...runtime]) {
    if (seen.has(f)) continue; seen.add(f);
    total += fs.statSync(path.join(ROOT, f)).size;
  }
  return total;
}
async function distJsBytes() {
  let total = 0;
  for (const f of await fsp.readdir(DIST)) {
    if (f.endsWith('.js')) total += (await fsp.stat(path.join(DIST, f))).size;
  }
  return total;
}

main().catch(err => { console.error('[build] FAILED:', err); process.exit(1); });
