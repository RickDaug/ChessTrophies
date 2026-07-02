#!/usr/bin/env node
/*
 * blog-quality.mjs — content-quality gate for the /blog/ posts (blog/*.mjs).
 *
 * Enforces the promises made when the blog was created:
 *   - Author is "Rick Ruiz" on every post.
 *   - Every post has a DISTINCT, well-formed publish date (YYYY-MM-DD).
 *   - Posts are substantial (>= ~500 words) and structured (>= 3 headings).
 *   - NO AI-slop / "tacky" phrasing (a banned-phrase lint).
 *   - No two posts open with the same words (anti-template / anti-sameness).
 *   - Schema is intact (slug/title/dek/tags/body), slugs unique.
 *
 * Pure Node (no browser/build). Exit 0 = PASS.  Run: node test/blog-quality.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'blog');
const log = (...a) => console.log('[blog-quality]', ...a);
const fail = (m) => { throw new Error(m); };
const assert = (c, m) => { if (!c) fail(m); };

// Phrases that read as AI slop / filler. Kept lowercase; matched case-insensitively.
const BANNED = [
  'in the world of', 'when it comes to', 'in conclusion', 'stands as a testament',
  'testament to', 'rich tapestry', 'delve', 'dive into', "it's worth noting",
  'needless to say', 'without a doubt', 'cemented his legacy', 'cemented her legacy',
  'left an indelible mark', 'captured the hearts', 'rise to prominence',
  'force to be reckoned with', 'game-changer', 'boasts', 'ever-evolving',
  'at the end of the day', 'look no further', "whether you're a beginner or",
  'broke the glass ceiling', 'in today', 'a true master',
];

function postText(p) {
  const parts = [p.title, p.dek];
  for (const b of (p.body || [])) {
    if (b.h) parts.push(b.h);
    if (b.p) parts.push(b.p);
    if (b.quote) parts.push(b.quote);
    if (b.cite) parts.push(b.cite);
  }
  return parts.join('  ');
}
const wordCount = (s) => (s.trim().match(/\S+/g) || []).length;

async function main() {
  assert(fs.existsSync(BLOG_DIR), 'blog/ directory missing');
  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith('.mjs'));
  assert(files.length >= 6, `expected >= 6 blog posts, found ${files.length}`);

  const posts = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(BLOG_DIR, f)).href);
    const p = mod.default;
    assert(p && typeof p === 'object', `${f}: no default export object`);
    p._file = f;
    posts.push(p);
  }

  const dates = new Set();
  const slugs = new Set();
  const openers = new Set();

  for (const p of posts) {
    const id = p._file;
    for (const req of ['slug', 'title', 'author', 'date', 'dek', 'tags', 'body']) {
      assert(p[req], `${id}: missing field "${req}"`);
    }
    // Author
    assert(p.author === 'Rick Ruiz', `${id}: author must be "Rick Ruiz", got "${p.author}"`);
    // Date: well-formed + distinct
    assert(/^\d{4}-\d{2}-\d{2}$/.test(p.date), `${id}: date must be YYYY-MM-DD, got "${p.date}"`);
    assert(!dates.has(p.date), `${id}: duplicate publish date ${p.date} — every post needs a DIFFERENT date`);
    dates.add(p.date);
    // Slug distinct
    assert(!slugs.has(p.slug), `${id}: duplicate slug "${p.slug}"`);
    slugs.add(p.slug);
    // Structure
    assert(Array.isArray(p.body) && p.body.length >= 4, `${id}: body must have >= 4 blocks`);
    const headings = p.body.filter((b) => b.h).length;
    assert(headings >= 3, `${id}: needs >= 3 section headings, has ${headings}`);
    assert(Array.isArray(p.tags) && p.tags.length >= 2, `${id}: needs >= 2 tags`);
    // Substance
    const text = postText(p);
    const wc = wordCount(text);
    assert(wc >= 500, `${id}: too thin (${wc} words, need >= 500)`);
    assert(p.dek.length <= 200, `${id}: dek too long (${p.dek.length} chars)`);
    // Anti-slop lint
    const lc = text.toLowerCase();
    for (const bad of BANNED) {
      assert(!lc.includes(bad), `${id}: contains banned AI-slop phrase "${bad}"`);
    }
    // Anti-template: first paragraph must not open with the same words as another post
    const firstP = (p.body.find((b) => b.p) || {}).p || '';
    const opener = firstP.toLowerCase().split(/\s+/).slice(0, 6).join(' ');
    assert(opener, `${id}: no opening paragraph`);
    assert(!openers.has(opener), `${id}: opening paragraph starts identically to another post ("${opener}…") — vary it`);
    openers.add(opener);

    log(`ok: ${p.slug} — ${wc} words, ${headings} sections, ${p.date}, by ${p.author}`);
  }

  assert(dates.size === posts.length, 'all publish dates must be distinct');
  log(`PASS — ${posts.length} posts: distinct dates, all by Rick Ruiz, substantial, structured, no AI-slop phrases`);
  return 0;
}

main().then((c) => process.exit(c ?? 0)).catch((e) => { console.error('[blog-quality] FAIL:', e.message); process.exit(1); });
