#!/usr/bin/env node
/*
 * gen-i18n.mjs — inject the translated dictionaries from scripts/i18n-langs.json
 * into i18n.js between the `/* <LANGS> *\/` ... `/* <\/LANGS> *\/` markers.
 *
 * The English (EN) dictionary inside i18n.js is the source of truth for the KEY
 * SET. This script validates that every language in i18n-langs.json has EXACTLY
 * the same keys (no missing/extra) before writing, so a translation drift fails
 * loudly instead of silently shipping a half-translated locale.
 *
 * Run: node scripts/gen-i18n.mjs   (writes i18n.js in place). Exit 0 = OK.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const I18N = path.join(ROOT, 'i18n.js');
const LANGS_JSON = path.join(ROOT, 'scripts', 'i18n-langs.json');

const log = (...a) => console.log('[gen-i18n]', ...a);

function extractEnKeys(src) {
  // Grab the EN = { ... } object literal and pull its 'key': occurrences.
  const m = src.match(/var EN = \{([\s\S]*?)\n  \};/);
  if (!m) throw new Error('Could not locate the EN dictionary in i18n.js');
  const keys = [];
  const re = /'((?:[^'\\]|\\.)*)':/g; // top-level-ish 'key':
  let mm;
  while ((mm = re.exec(m[1]))) keys.push(mm[1]);
  return keys;
}

function main() {
  const src = fs.readFileSync(I18N, 'utf8');
  const langs = JSON.parse(fs.readFileSync(LANGS_JSON, 'utf8'));
  const enKeys = extractEnKeys(src);
  const enSet = new Set(enKeys);
  log(`EN source has ${enKeys.length} keys`);

  const codes = Object.keys(langs);
  let problems = 0;
  for (const code of codes) {
    const dict = langs[code];
    const keys = Object.keys(dict);
    const missing = enKeys.filter(k => !(k in dict));
    const extra = keys.filter(k => !enSet.has(k));
    if (missing.length || extra.length) {
      problems++;
      log(`  ✗ ${code}: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`);
    }
  }
  if (problems) { console.error(`[gen-i18n] FAIL — ${problems} language(s) have key drift vs EN`); process.exit(1); }
  log(`key parity OK across ${codes.length} languages`);

  // Build the injection: one `STRINGS.<code> = {...};` per language, in file order.
  // JSON.stringify produces valid JS object literals (keys/strings double-quoted).
  let block = '\n';
  for (const code of codes) {
    block += `  STRINGS[${JSON.stringify(code)}] = ${JSON.stringify(langs[code])};\n`;
  }

  const out = src.replace(
    /\/\* <LANGS> \*\/[\s\S]*?\/\* <\/LANGS> \*\//,
    `/* <LANGS> */${block}  /* </LANGS> */`
  );
  if (out === src) throw new Error('Injection markers /* <LANGS> */ ... /* </LANGS> */ not found in i18n.js');
  fs.writeFileSync(I18N, out);
  log(`injected ${codes.length} dictionaries into i18n.js (${(out.length / 1024).toFixed(1)} KB)`);
}

main();
