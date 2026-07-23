#!/usr/bin/env node
/*
 * deploy-assets.mjs — STATIC guard against the "asset never reaches the deploy"
 * class of bug. Pure file reads, no server, no browser: fast enough for every PR.
 *
 * WHY THIS EXISTS. This repo has been bitten repeatedly by an asset that exists
 * in the tree and works locally but never reaches a deploy target:
 *
 *   - server/Dockerfile's client COPY list drifted out of sync with index.html
 *     and failed EVERY Railway build for 10 consecutive deploys (see the comment
 *     block above that COPY).
 *   - The 2026-07 audit remediation split admin.js out of admin.html so the page
 *     could carry an enforceable `script-src 'self'` CSP — but added it to
 *     NEITHER scripts/build.mjs COPY_ASSETS NOR the Dockerfile COPY. The Vercel
 *     build silently omitted dist/admin.js and the new CSP guaranteed there was
 *     no inline fallback, so the dashboard would have deployed as a blank shell.
 *
 * The existing docker-build.yml CI job cannot catch this: a COPY only fails the
 * build when a LISTED file is missing. A file that was never listed builds
 * green and breaks at runtime. This test closes that gap from the other side.
 *
 * Asserts, for every locally-referenced <script src> in index.html + admin.html:
 *   1) the file exists in the repo;
 *   2) it is accounted for by scripts/build.mjs (bundled via TAIL, lazy-loaded
 *      via LAZY, emitted as an individual/runtime script, or copied verbatim via
 *      COPY_ASSETS) so `npm run build:dist` emits it;
 *   3) it appears in the server/Dockerfile client COPY list, so the Railway
 *      image serves the same client Vercel does.
 * Plus: every COPY_ASSETS entry exists, and the Dockerfile lists no file that
 * has been deleted from the tree (the original 10-deploy failure).
 *
 * Run:  node test/deploy-assets.mjs   (exit 0 = PASS, 1 = FAIL)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (...a) => console.log('[deploy-assets]', ...a);
const problems = [];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// --- what the HTML pages ask the browser to load -----------------------------
function scriptRefs(htmlFile) {
  const html = read(htmlFile);
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    const src = m[1].split('?')[0];
    if (/^(https?:)?\/\//.test(src)) continue;      // external (none expected)
    out.push(src.replace(/^\.\//, ''));
  }
  return [...new Set(out)];
}

// --- what build.mjs will emit -----------------------------------------------
const build = read('scripts/build.mjs');
function arrayLiteral(name) {
  // const NAME = [ ... ];  /  const NAME = new Set([ ... ]);
  const re = new RegExp(`const\\s+${name}\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`, 'm');
  const m = re.exec(build);
  if (!m) { problems.push(`build.mjs: could not parse ${name} — this guard needs updating`); return []; }
  // Strip // comments first: prose inside them contains apostrophes/backticks
  // that would otherwise be parsed as list entries.
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/'([^']+)'/g)].map(x => x[1]);
}
const TAIL = arrayLiteral('TAIL');
const LAZY = arrayLiteral('LAZY');
const RUNTIME_JS = arrayLiteral('RUNTIME_JS');
const COPY_ASSETS = arrayLiteral('COPY_ASSETS');

// build.mjs's parseScripts() reads INDEX.HTML ONLY, so a standalone root .js
// referenced there is auto-discovered and emitted individually. Scripts on any
// OTHER page (admin.html) are NOT discovered and must be listed in COPY_ASSETS
// explicitly — that distinction is exactly what let dist/admin.js go missing.
const AUTO_DISCOVERED_PAGE = 'index.html';
const rootJs = new Set(fs.readdirSync(ROOT).filter(f => f.endsWith('.js')));
// Generated at build time (not a source file), so it is exempt from the repo check.
const GENERATED = new Set(['ct-lazy-learn.js']);
// Whole directories copied verbatim by BOTH build.mjs and the Dockerfile
// (`COPY vendor/ ./public/vendor/`), so per-file listing does not apply.
const DIR_COPIED = ['vendor/'];
const inCopiedDir = (ref) => DIR_COPIED.some(d => ref.startsWith(d));

// --- what the Docker image copies -------------------------------------------
const dockerfile = read('server/Dockerfile');
const copyBlock = (() => {
  // The multi-line `COPY index.html ... ./public/` client block.
  const m = /COPY\s+index\.html([\s\S]*?)\.\/public\//.exec(dockerfile);
  return m ? ('index.html' + m[1]) : '';
})();
if (!copyBlock) problems.push('server/Dockerfile: could not locate the client COPY block — this guard needs updating');
const dockerFiles = new Set(
  copyBlock.split(/\s+/).map(s => s.replace(/\\$/, '').trim()).filter(f => f && f !== './public/' && !f.startsWith('#'))
);

// ---- 1/2/3: every referenced script is buildable AND dockerized -------------
const pages = ['index.html', 'admin.html'];
let checked = 0;
for (const page of pages) {
  for (const ref of scriptRefs(page)) {
    checked++;
    const base = path.basename(ref);
    if (!GENERATED.has(base) && !fs.existsSync(path.join(ROOT, ref))) {
      problems.push(`${page} loads "${ref}" but that file does not exist in the repo`);
      continue;
    }
    const autoDiscovered = page === AUTO_DISCOVERED_PAGE && rootJs.has(base);
    const emitted = GENERATED.has(base) || inCopiedDir(ref) || TAIL.includes(base) || LAZY.includes(base) ||
      RUNTIME_JS.includes(base) || COPY_ASSETS.includes(base) || autoDiscovered;
    if (!emitted) {
      problems.push(page === AUTO_DISCOVERED_PAGE
        ? `${page} loads "${ref}" but scripts/build.mjs will not emit it — dist/ would 404`
        : `${page} loads "${ref}" but build.mjs only auto-discovers scripts from ${AUTO_DISCOVERED_PAGE} — "${base}" must be added to COPY_ASSETS or dist/${base} will be MISSING`);
    }
    // The Railway image serves the same client; a script missing here is a blank page.
    if (!GENERATED.has(base) && !inCopiedDir(ref) && !dockerFiles.has(base) && !TAIL.includes(base)) {
      problems.push(`${page} loads "${ref}" but server/Dockerfile never COPYs it into ./public/ — the Railway-served client would 404 (this is the recurring COPY-drift bug)`);
    }
  }
}

// ---- COPY_ASSETS entries must exist ----------------------------------------
for (const a of COPY_ASSETS) {
  if (!fs.existsSync(path.join(ROOT, a))) problems.push(`build.mjs COPY_ASSETS lists "${a}" which does not exist`);
}
// ---- the Dockerfile must not list deleted files (the 10-deploy failure) -----
for (const f of dockerFiles) {
  if (!/\.[a-z0-9]+$/i.test(f)) continue;
  if (!fs.existsSync(path.join(ROOT, f))) {
    problems.push(`server/Dockerfile COPYs "${f}" which no longer exists — this fails EVERY Docker build`);
  }
}

if (problems.length) {
  console.error('[deploy-assets] FAIL:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
log(`checked ${checked} script refs across ${pages.join(' + ')}`);
log(`build.mjs: TAIL=${TAIL.length} LAZY=${LAZY.length} RUNTIME=${RUNTIME_JS.length} COPY_ASSETS=${COPY_ASSETS.length}; Dockerfile client COPY=${dockerFiles.size} files`);
log('PASS — every referenced client asset is emitted by the build AND copied into the Docker image');
