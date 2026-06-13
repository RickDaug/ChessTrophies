#!/usr/bin/env node
/*
 * test-all.mjs — aggregate test runner for the whole test/ suite.
 *
 * `npm test` is wired to this. It DISCOVERS every test/*.mjs file, runs them
 * SEQUENTIALLY (each in its own `node` child so a crash/exit in one can't take
 * down the runner), prints a per-file PASS/FAIL summary, and exits NON-ZERO if
 * any test fails. Works the same on Windows + Linux/CI (no shell globbing).
 *
 * Browser/build tests (Playwright / Chromium / the dist build) are detected by
 * statically scanning each file for those imports/usages. Set CT_SKIP_BROWSER=1
 * to SKIP them (for environments without Chromium / esbuild) and run only the
 * pure-logic + real-backend tests. The flag may also be passed as a bare arg:
 *     node scripts/test-all.mjs CT_SKIP_BROWSER=1
 *
 * Usage:
 *   node scripts/test-all.mjs                  # run everything
 *   CT_SKIP_BROWSER=1 node scripts/test-all.mjs  # skip browser/build tests
 *   node scripts/test-all.mjs foo bar          # run only files matching foo|bar
 *
 * CT_EXCLUDE=a.mjs,b.mjs skips specific files by basename substring (comma-sep).
 * Used in CI to quarantine known-broken tests that are owned by other workstreams
 * (see .github/workflows/full-suite.yml) so the suite still gates real regressions.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(__dirname, '..', 'test');

// Allow `KEY=VALUE` args (so the flag works without a POSIX env prefix on Windows).
const args = [];
for (const a of process.argv.slice(2)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(a);
  if (m) process.env[m[1]] = m[2];
  else args.push(a);
}
const SKIP_BROWSER = /^(1|true|yes|on)$/i.test(String(process.env.CT_SKIP_BROWSER || ''));

// A test is "browser/build" if it pulls in Playwright/Chromium or the dist build.
const BROWSER_HINT = /playwright|chromium|build\.mjs|build-smoke|buildDist/i;
function isBrowserTest(file) {
  try { return BROWSER_HINT.test(fs.readFileSync(file, 'utf8')); }
  catch { return false; }
}

// Discover every test file. Optional positional args filter by substring.
let files = fs.readdirSync(TEST_DIR)
  .filter(f => f.endsWith('.mjs'))
  .sort()
  .map(f => path.join(TEST_DIR, f));
if (args.length) files = files.filter(f => args.some(a => path.basename(f).includes(a)));
const excludes = String(process.env.CT_EXCLUDE || '').split(',').map(s => s.trim()).filter(Boolean);
if (excludes.length) files = files.filter(f => !excludes.some(e => path.basename(f).includes(e)));

function runOne(file) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [file], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env: process.env });
    child.on('exit', (code) => resolve({ code: code == null ? 1 : code, ms: Date.now() - start }));
    child.on('error', () => resolve({ code: 1, ms: Date.now() - start }));
  });
}

async function main() {
  const results = [];
  let skipped = 0;
  for (const file of files) {
    const name = path.basename(file);
    const category = isBrowserTest(file) ? 'browser' : 'logic';
    if (category === 'browser' && SKIP_BROWSER) {
      console.log(`\n=== SKIP (browser) ${name} ===`);
      results.push({ name, status: 'SKIP', ms: 0, category });
      skipped++;
      continue;
    }
    console.log(`\n=== RUN [${category}] ${name} ===`);
    const { code, ms } = await runOne(file);
    results.push({ name, status: code === 0 ? 'PASS' : 'FAIL', ms, category, code });
  }

  // Summary.
  const pass = results.filter(r => r.status === 'PASS');
  const failed = results.filter(r => r.status === 'FAIL');
  console.log('\n========== TEST SUMMARY ==========');
  for (const r of results) {
    const dur = r.ms ? `${(r.ms / 1000).toFixed(1)}s` : '-';
    console.log(`  ${r.status.padEnd(4)} [${r.category}] ${r.name} (${dur})`);
  }
  console.log('----------------------------------');
  console.log(`  ${pass.length} passed, ${failed.length} failed, ${skipped} skipped, ${results.length} total`);
  if (SKIP_BROWSER && skipped) console.log('  (browser/build tests skipped via CT_SKIP_BROWSER)');
  console.log('==================================');
  return failed.length === 0 ? 0 : 1;
}

main().then(code => process.exit(code)).catch(e => { console.error('[test-all] runner error:', e); process.exit(1); });
