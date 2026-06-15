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
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// New cache-buster stamp for files this build rewrites (index.html tags).
const STAMP = 'b' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

// The contiguous, order-safe trailing tail to concatenate into app.bundle.js.
// NOTE: the checkers scripts (checkers.js, checkers-ai.js, ct-checkers.js) are
// intentionally NOT in TAIL — they are classic standalone <script> files
// referenced by index.html, so parseScripts() auto-discovers them and they get
// minified INDIVIDUALLY into dist/ under the same name (same as ct-ai.js). Do
// not fold them into the tail bundle.
const TAIL = ['app.js', 'academy.js', 'review.js', 'trophy-extras.js', 'learn-library.js'];

// Extra same-origin runtime JS not in index.html's <script> list but loaded at
// runtime — must exist in dist by exact name. The worker importScripts these.
// NOTE: sw.js is NOT here — it gets special handling (rewriteServiceWorker) so
// its precache ASSETS list + CACHE name match what this build actually emits.
const RUNTIME_JS = ['ct-ai-worker.js', 'checkers-ai-worker.js'];

// Non-JS assets / pages referenced by index.html (and the PWA) to copy verbatim.
const COPY_ASSETS = [
  'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-1024.png',
  'og-image.png', 'terms.html', 'privacy.html',
  // SEO: crawler directives served at the site root. sitemap.xml is NOT here —
  // it is generated in step 7 from the learn pages so it stays in sync.
  'robots.txt',
  // Admin analytics dashboard. The HTML shell is harmless to expose — all data
  // is gated server-side by ADMIN_KEY (the API returns 403 without it).
  'admin.html',
];

// Canonical production origin used for SEO canonical/OG URLs + the sitemap.
const SITE = 'https://www.playchesstrophies.com';

// First-load weight: assets that must NOT be in the SW precache ASSETS list.
// These are emitted into dist/ and served fine, but precaching them bloats the
// FIRST visit's install (the activation funnel) with bytes a normal landing/play
// session never needs. sw.js's runtime fetch handler still caches them on demand
// (network-first for HTML, cache-first for images), so nothing is lost — only the
// up-front install cost. Keep this list tight + justified; do NOT exclude anything
// on the landing/first-paint path.
//   - admin.html (~89 KB): owner-only analytics dashboard, not linked from index.
//   - icon-1024.png (~155 KB): NOT referenced by manifest.json (only 192/512 are)
//     and not used at first paint — effectively dead weight in the precache.
//   - og-image.png (~362 KB): social-share card image, consumed by crawlers via
//     the server's /c/:id OG meta — never rendered in the app's first paint.
//   - robots.txt: crawler-only; pointless to hold in an offline app-shell cache.
// NOTE: there is a build-smoke assertion that these stay OUT of the precache list.
const PRECACHE_EXCLUDE = new Set([
  'admin.html',
  'icon-1024.png',
  'og-image.png',
  'robots.txt',
]);

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
  const res = await esbuild.transform(src, { minify: true, loader: 'js', legalComments: 'none', charset: 'utf8' });
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
    const res = await esbuild.transform(parts.join('\n'), { minify: true, loader: 'js', legalComments: 'none', charset: 'utf8' });
    await fsp.writeFile(path.join(DIST, 'app.bundle.js'), res.code, 'utf8');
    bundleReport = { name: 'app.bundle.js', in: rawTotal, out: Buffer.byteLength(res.code), kind: 'BUNDLE (tail x5)' };
  }

  // 3) Runtime JS not in index.html (ct-ai-worker.js, …) — minify by name.
  //    sw.js is handled separately in step 6 (its precache list is rewritten).
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
  // sets/ (premium themed piece-set JSON, lazy-loaded by piece-sets.js) — copy
  // verbatim. EXCLUDED from the SW precache (step 6) so they don't bloat install;
  // they're fetched on demand and runtime-cached when a user previews/equips a set.
  const setsDir = path.join(ROOT, 'sets');
  if (fs.existsSync(setsDir)) {
    await fsp.mkdir(path.join(DIST, 'sets'), { recursive: true });
    let nSets = 0;
    for (const f of await fsp.readdir(setsDir)) {
      if (!f.endsWith('.json')) continue;
      await fsp.copyFile(path.join(setsDir, f), path.join(DIST, 'sets', f));
      nSets++;
    }
    log(`copied ${nSets} themed set(s) -> dist/sets/`);
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
        // Inherit `defer` from the original app.js tag. The bottom-of-body script
        // tags are deferred; if the bundle tag were NOT deferred it would execute
        // synchronously mid-parse, BEFORE its deferred dependencies (chess.min.js,
        // ct-ai.js, …) — throwing on undefined globals and never attaching the
        // tail's exports (e.g. CT_reviewGame). Mirror the source tag's defer.
        const deferAttr = /\bdefer\b/.test(s.tag) ? 'defer ' : '';
        outHtml = outHtml.replace(s.tag, `<script ${deferAttr}src="app.bundle.js?v=${STAMP}"></script>`);
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

  // 6) Service worker: rewrite its precache ASSETS list + CACHE name to match
  //    the files THIS build actually emitted into dist, then minify -> dist/sw.js.
  //    The repo-root sw.js precaches source files (app.js, academy.js, …) that
  //    the bundler folds into app.bundle.js and never emits — caching those 404s
  //    would (atomically, pre-fix) nuke the whole precache. Deriving the list
  //    from the real dist tree keeps it honest, and stamping CACHE makes the
  //    activate-cleanup actually evict old caches on every deploy.
  const swReport = await rewriteServiceWorker();
  report.push(swReport);

  // 7) SEO content pages + sitemap. Generated AFTER the SW step on purpose so the
  //    48 standalone learn articles are NOT precached (they're discoverable static
  //    HTML for crawlers/readers, not part of the PWA shell — same rationale as the
  //    sets/ exclusion). These pages are dependency-free: no app bundle, no SW, no
  //    CSP needed. The sitemap lists the homepage + every page generated here.
  const seo = await generateSeoPages();
  log('');
  log(`SEO: generated ${seo.count} learn page(s) -> dist/learn/<slug>.html + dist/learn/index.html`);
  log(`SEO: sitemap.xml lists ${seo.count + 2} URL(s) (home + /learn/ + ${seo.count} articles)`);

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

// Build dist/sw.js: rewrite the precache ASSETS list to the files actually
// emitted into dist (same-origin) + preserved cross-origin URLs from the source
// list (e.g. Google Fonts), and stamp the CACHE name so each deploy gets a fresh
// cache and the activate handler evicts stale ones. Then minify.
async function rewriteServiceWorker() {
  const srcPath = path.join(ROOT, 'sw.js');
  const src = await fsp.readFile(srcPath, 'utf8');

  // Cross-origin URLs to preserve from the source ASSETS list (fonts/CDN). We
  // never list a same-origin source file here; those come from the dist scan.
  const crossOrigin = (() => {
    const m = src.match(/const\s+ASSETS\s*=\s*\[([\s\S]*?)\];/);
    if (!m) return [];
    const out = [];
    const re = /["']([^"']+)["']/g;
    let x;
    while ((x = re.exec(m[1]))) {
      if (/^https?:\/\//i.test(x[1])) out.push(x[1]);
    }
    return out;
  })();

  // Same-origin assets = every file emitted into dist (recursively for vendor/),
  // EXCEPT sw.js itself (a SW need not precache its own script).
  const distAssets = (await listDistFiles(DIST))
    .filter((rel) => rel !== 'sw.js')
    // EXCLUDE premium themed sets/ — large, owner-gated, lazy-loaded on equip and
    // runtime-cached; precaching all 19 would bloat the install for files most
    // users never use.
    .filter((rel) => !rel.split(path.sep).join('/').startsWith('sets/'))
    // EXCLUDE the first-load-weight assets (admin dashboard, unused 1024 icon,
    // social OG image, robots.txt) — see PRECACHE_EXCLUDE above. Still served +
    // runtime-cached on demand by sw.js; just not in the up-front install set.
    .filter((rel) => !PRECACHE_EXCLUDE.has(rel.split(path.sep).join('/')))
    .sort();

  const assets = [
    './',
    './index.html',
    ...distAssets.filter((rel) => rel !== 'index.html').map((rel) => './' + rel.split(path.sep).join('/')),
    ...crossOrigin,
  ];

  const stampedCache = `'chesstrophies-${STAMP}'`;
  const assetsLiteral = 'const ASSETS = [\n' +
    assets.map((a) => "  '" + a + "'").join(',\n') +
    '\n];';

  let out = src
    .replace(/const\s+CACHE\s*=\s*['"][^'"]*['"];/, `const CACHE = ${stampedCache};`)
    .replace(/const\s+ASSETS\s*=\s*\[[\s\S]*?\];/, assetsLiteral);

  const res = await esbuild.transform(out, { minify: true, loader: 'js', legalComments: 'none', charset: 'utf8' });
  await fsp.writeFile(path.join(DIST, 'sw.js'), res.code, 'utf8');
  log('');
  log(`service worker: CACHE=chesstrophies-${STAMP}, ${assets.length} precache assets:`);
  log('  ' + assets.join(' '));
  return { name: 'sw.js', in: Buffer.byteLength(src), out: Buffer.byteLength(res.code), kind: 'rewritten SW' };
}

// Recursively list files under dir, returned as paths relative to dir.
async function listDistFiles(dir, base = dir) {
  const out = [];
  for (const ent of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...await listDistFiles(full, base));
    } else if (ent.isFile()) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fmt(n) { return (n / 1024).toFixed(1) + ' KB'; }

// --- SEO: standalone learn pages + sitemap ----------------------------------

// HTML-escape text for use in element content / double-quoted attributes.
function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// URL-safe slug from an article title (ASCII lowercase, hyphen-separated).
function slugify(title) {
  return String(title)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'lesson';
}

// Load window.CT_LIBRARY out of the browser IIFE learn-library.js by running it
// in a minimal sandbox (it only touches window/localStorage/document at module
// scope to assign globals — no DOM is required to read the ARTICLES array).
async function loadLearnLibrary() {
  const src = await fsp.readFile(path.join(ROOT, 'learn-library.js'), 'utf8');
  const noop = () => {};
  const sandbox = {
    window: {},
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { getElementById: () => null, createElement: () => ({}) },
    console,
  };
  sandbox.self = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'learn-library.js' });
  const lib = sandbox.window.CT_LIBRARY;
  if (!Array.isArray(lib)) throw new Error('learn-library.js did not expose window.CT_LIBRARY array');
  return lib;
}

// Render one article body ([{h}|{p}]) into semantic HTML.
function articleBodyHtml(body) {
  if (!Array.isArray(body)) return '';
  return body.map((b) => {
    if (b && typeof b.h === 'string') return '      <h2>' + escHtml(b.h) + '</h2>';
    if (b && typeof b.p === 'string') return '      <p>' + escHtml(b.p) + '</p>';
    return '';
  }).filter(Boolean).join('\n');
}

// Plain-text description (~155 chars) for <meta description>: prefer the blurb,
// fall back to the first paragraph.
function articleDescription(a) {
  let d = (a.blurb && String(a.blurb).trim()) || '';
  if (!d) {
    const firstP = (a.body || []).find((b) => b && b.p);
    d = firstP ? String(firstP.p) : '';
  }
  d = d.replace(/\s+/g, ' ').trim();
  if (d.length > 157) d = d.slice(0, 154).replace(/\s+\S*$/, '') + '…';
  return d;
}

// One standalone, dependency-free, CSP-clean article page.
function learnPageHtml(a, slug) {
  const url = `${SITE}/learn/${slug}.html`;
  const desc = articleDescription(a);
  const title = `${a.title} — ChessTrophies`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: desc,
    articleSection: a.cat || 'Chess',
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
  const meta = a.cat ? `${escHtml(a.cat)} · ${escHtml(String(a.mins || ''))} min read` : '';
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
<meta property="og:title" content="${escHtml(a.title)}" />
<meta property="og:description" content="${escHtml(desc)}" />
<meta property="og:url" content="${escHtml(url)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escHtml(a.title)}" />
<meta name="twitter:description" content="${escHtml(desc)}" />
<meta name="twitter:image" content="${SITE}/og-image.png" />
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b1220; color: #e8eefc;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    line-height: 1.65; }
  a { color: #f5c451; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px 20px 64px; }
  .crumbs { font-size: 14px; color: #8a98b8; margin-bottom: 18px; }
  .crumbs a { color: #8a98b8; }
  h1 { font-size: 30px; line-height: 1.25; margin: 6px 0 8px; }
  h2 { font-size: 21px; margin: 30px 0 6px; color: #f5c451; }
  p { margin: 12px 0; color: #d7def0; }
  .meta { color: #8a98b8; font-size: 14px; margin-bottom: 6px; }
  .cta { margin-top: 40px; padding: 22px; border: 1px solid #243556;
    border-radius: 14px; background: #17223b; text-align: center; }
  .cta h2 { margin-top: 0; color: #f5c451; }
  .btn { display: inline-block; margin-top: 10px; padding: 12px 22px;
    background: #f5c451; color: #0b1220; font-weight: 700; border-radius: 10px;
    text-decoration: none; }
  footer { margin-top: 40px; font-size: 13px; color: #8a98b8;
    border-top: 1px solid #243556; padding-top: 18px; }
</style>
</head>
<body>
  <main class="wrap">
    <nav class="crumbs"><a href="/">ChessTrophies</a> &rsaquo; <a href="/learn/">Learn</a>${meta ? ' &rsaquo; ' + meta : ''}</nav>
    <article>
      <h1>${escHtml(a.title)}</h1>
${meta ? '      <p class="meta">' + meta + '</p>\n' : ''}${articleBodyHtml(a.body)}
    </article>
    <section class="cta">
      <h2>Ready to put this into practice?</h2>
      <p>Play ranked online chess, climb the ELO ladder, and earn trophies — free.</p>
      <a class="btn" href="${SITE}/">Play ChessTrophies free</a>
    </section>
    <footer>
      <a href="/learn/">&larr; All chess lessons</a> &nbsp;·&nbsp;
      <a href="/">Home</a>
    </footer>
  </main>
</body>
</html>
`;
}

// The /learn/ index hub linking every article (grouped by category).
function learnIndexHtml(entries) {
  const url = `${SITE}/learn/`;
  const cats = [];
  for (const e of entries) if (!cats.includes(e.cat)) cats.push(e.cat);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Chess Lessons & Strategy Guides — ChessTrophies',
    url,
    description: 'Free, plain-English chess lessons: openings, tactics, strategy, endgames and more.',
  };
  let sections = '';
  for (const cat of cats) {
    sections += `      <h2>${escHtml(cat)}</h2>\n      <ul>\n`;
    for (const e of entries.filter((x) => x.cat === cat)) {
      sections += `        <li><a href="/learn/${escHtml(e.slug)}.html">${escHtml(e.title)}</a>` +
        (e.blurb ? ` <span class="blurb">— ${escHtml(e.blurb)}</span>` : '') + `</li>\n`;
    }
    sections += '      </ul>\n';
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Chess Lessons &amp; Strategy Guides — ChessTrophies</title>
<meta name="description" content="Free, plain-English chess lessons covering openings, tactics, strategy, endgames and checkers — written by ChessTrophies." />
<link rel="canonical" href="${url}" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="ChessTrophies" />
<meta property="og:title" content="Chess Lessons & Strategy Guides — ChessTrophies" />
<meta property="og:description" content="Free, plain-English chess lessons covering openings, tactics, strategy, endgames and checkers." />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Chess Lessons & Strategy Guides — ChessTrophies" />
<meta name="twitter:image" content="${SITE}/og-image.png" />
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b1220; color: #e8eefc;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    line-height: 1.6; }
  a { color: #f5c451; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 64px; }
  .crumbs { font-size: 14px; color: #8a98b8; margin-bottom: 14px; }
  .crumbs a { color: #8a98b8; }
  h1 { font-size: 32px; margin: 6px 0 6px; }
  .lede { color: #b9c3dc; margin: 0 0 8px; }
  h2 { font-size: 20px; margin: 30px 0 8px; color: #f5c451; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 10px 0; border-bottom: 1px solid #1c2845; }
  li a { font-weight: 600; }
  .blurb { color: #8a98b8; font-weight: 400; font-size: 14px; }
  .cta { margin-top: 36px; padding: 20px; border: 1px solid #243556;
    border-radius: 14px; background: #17223b; text-align: center; }
  .btn { display: inline-block; margin-top: 10px; padding: 12px 22px;
    background: #f5c451; color: #0b1220; font-weight: 700; border-radius: 10px;
    text-decoration: none; }
</style>
</head>
<body>
  <main class="wrap">
    <nav class="crumbs"><a href="/">ChessTrophies</a> &rsaquo; Learn</nav>
    <h1>Chess Lessons &amp; Strategy Guides</h1>
    <p class="lede">Short, plain-English lessons on how strong players actually think — openings, tactics, strategy, endgames and checkers. Free to read.</p>
${sections}    <section class="cta">
      <p>Practice everything you learn against real opponents and the computer.</p>
      <a class="btn" href="${SITE}/">Play ChessTrophies free</a>
    </section>
  </main>
</body>
</html>
`;
}

// Generate dist/learn/<slug>.html + dist/learn/index.html + dist/sitemap.xml.
// Returns { count } so main() can log it. Dedupes slugs defensively.
async function generateSeoPages() {
  const articles = await loadLearnLibrary();
  await fsp.mkdir(path.join(DIST, 'learn'), { recursive: true });

  const seen = new Set();
  const entries = [];
  for (const a of articles) {
    if (!a || !a.title) continue;
    let slug = slugify(a.title);
    let unique = slug, n = 2;
    while (seen.has(unique)) unique = `${slug}-${n++}`;
    seen.add(unique);
    slug = unique;
    await fsp.writeFile(path.join(DIST, 'learn', slug + '.html'), learnPageHtml(a, slug), 'utf8');
    entries.push({ slug, title: a.title, blurb: a.blurb || '', cat: a.cat || 'Lessons' });
  }

  await fsp.writeFile(path.join(DIST, 'learn', 'index.html'), learnIndexHtml(entries), 'utf8');

  // sitemap.xml — homepage + /learn/ hub + every article page.
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/learn/`, priority: '0.8' },
    ...entries.map((e) => ({ loc: `${SITE}/learn/${e.slug}.html`, priority: '0.6' })),
  ];
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) =>
      '  <url>\n' +
      `    <loc>${escHtml(u.loc)}</loc>\n` +
      `    <lastmod>${lastmod}</lastmod>\n` +
      `    <priority>${u.priority}</priority>\n` +
      '  </url>'
    ).join('\n') +
    '\n</urlset>\n';
  await fsp.writeFile(path.join(DIST, 'sitemap.xml'), xml, 'utf8');

  return { count: entries.length };
}

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
