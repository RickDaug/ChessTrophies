// scripts/seo/blog-pages.mjs — generates the /blog/ SEO surface for ChessTrophies.
//
// Reads every post module in ../../blog/*.mjs (each `export default { slug, title,
// author, date, dek, tags, readMins, body }`), renders one static page per post
// plus a /blog/ hub, all in the shared "Board Room" design (board-night navy +
// walnut board motif + trophy gold, bookish serif over Inter) so the blog matches
// /learn, /openings, /tools and /endgames. Emits BlogPosting + BreadcrumbList
// JSON-LD (author = the post's author, datePublished = the post's date).
//
// Self-contained: node core only. Contract matches the other SEO modules —
//   export async function generate({ DIST, SITE }) -> { urls:[{loc,priority}], count }
// build.mjs folds the returned urls into sitemap.xml.

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = path.resolve(__dirname, '..', '..', 'blog');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Safe to embed inside a <script type="application/ld+json"> block.
function jsonLd(obj) {
  return JSON.stringify(obj, null, 2).replace(/</g, '\\u003c');
}
// 'YYYY-MM-DD' -> 'June 18, 2026' without touching Date (deterministic, TZ-free).
function prettyDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// Shared "Board Room" stylesheet (matches openings/tools/endgames/learn).
function styles(extra = '') {
  return `<style>
  :root { color-scheme: dark;
    --ink:#0b1220; --panel:#17223b; --panel-2:#1d2a47; --border:#243556; --text:#e8eefc;
    --muted:#8a98b8; --body:#d7def0; --gold:#f5c451; --gold-deep:#e1a92a;
    --walnut-l:#e8d2a8; --walnut-d:#9c6b43;
    --serif:'Iowan Old Style','Palatino Linotype','Palatino','Georgia',serif;
    --sans:'Inter',-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--ink); color:var(--text); font-family:var(--sans); line-height:1.7; }
  a { color:var(--gold); }
  .wrap { max-width:760px; margin:0 auto; padding:36px 22px 72px; }
  .crumbs { font-size:13px; color:var(--muted); margin-bottom:20px; }
  .crumbs a { color:var(--muted); text-decoration:none; }
  .crumbs a:hover { color:var(--text); }
  .eyebrow { font-family:var(--serif); text-transform:uppercase; letter-spacing:.14em;
    font-size:12px; font-weight:700; color:var(--gold); margin:0 0 8px; }
  h1 { font-family:var(--serif); font-weight:700; font-size:34px; line-height:1.15;
    letter-spacing:-.01em; margin:0; }
  .rule { height:12px; border-radius:3px; margin:16px 0 20px;
    background-image:repeating-linear-gradient(90deg,var(--walnut-d) 0 24px,var(--walnut-l) 24px 48px);
    opacity:.92; }
  .byline { color:var(--muted); font-size:14px; margin:0 0 6px; }
  .byline b { color:var(--body); font-weight:600; }
  .dek { color:var(--body); font-size:19px; line-height:1.5; margin:14px 0 4px; }
  article h2 { font-family:var(--serif); font-size:23px; color:var(--gold); font-weight:700; margin:34px 0 8px; }
  article p { margin:14px 0; color:var(--body); font-size:17px; }
  blockquote { margin:26px 0; padding:14px 22px; border-left:3px solid var(--gold);
    background:var(--panel); border-radius:0 10px 10px 0; font-family:var(--serif);
    font-size:20px; line-height:1.45; color:var(--text); font-style:italic; }
  blockquote cite { display:block; margin-top:8px; font-family:var(--sans); font-style:normal;
    font-size:13px; color:var(--muted); }
  .tags { margin:26px 0 0; display:flex; gap:8px; flex-wrap:wrap; }
  .tags span { font-size:12px; color:var(--muted); border:1px solid var(--border);
    border-radius:999px; padding:4px 11px; background:var(--panel); }
  .cta { margin-top:44px; padding:26px 24px; border-radius:16px; text-align:center;
    background:linear-gradient(135deg,var(--gold),var(--gold-deep)); }
  .cta h2 { font-family:var(--serif); margin:0 0 6px; color:#241a02; font-size:22px; }
  .cta p { margin:0 0 16px; color:#3b2c06; font-size:15px; }
  .btn { display:inline-block; padding:13px 26px; border-radius:10px; font-weight:700;
    text-decoration:none; background:#161007; color:var(--gold);
    transition:transform .15s ease, box-shadow .15s ease; }
  .btn:hover { transform:translateY(-1px); box-shadow:0 8px 22px rgba(0,0,0,.4); }
  a:focus-visible, .btn:focus-visible { outline:3px solid var(--gold); outline-offset:3px; border-radius:6px; }
  footer { margin-top:48px; font-size:13px; color:var(--muted); border-top:1px solid var(--border); padding-top:20px; }
  footer a { color:var(--muted); text-decoration:none; }
  footer a:hover { color:var(--gold); }
  @media (max-width:520px){ .wrap{padding:26px 18px 56px;} h1{font-size:28px;} article p{font-size:16px;} }
  @media (prefers-reduced-motion: reduce){ .btn{transition:none;} .btn:hover{transform:none;} }
  ${extra}
</style>`;
}

function bodyHtml(body) {
  if (!Array.isArray(body)) return '';
  return body.map((b) => {
    if (b && typeof b.h === 'string') return '      <h2>' + escHtml(b.h) + '</h2>';
    if (b && typeof b.p === 'string') return '      <p>' + escHtml(b.p) + '</p>';
    if (b && typeof b.quote === 'string') {
      return '      <blockquote>' + escHtml(b.quote) +
        (b.cite ? '<cite>' + escHtml(b.cite) + '</cite>' : '') + '</blockquote>';
    }
    return '';
  }).filter(Boolean).join('\n');
}

function metaDesc(post) {
  let d = (post.dek || '').replace(/\s+/g, ' ').trim();
  if (d.length > 157) d = d.slice(0, 154).replace(/\s+\S*$/, '') + '…';
  return d;
}

function postHtml(post, SITE) {
  const url = `${SITE}/blog/${post.slug}.html`;
  const desc = metaDesc(post);
  const title = `${post.title} — ChessTrophies`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: desc,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Person', name: post.author },
    publisher: {
      '@type': 'Organization',
      name: 'ChessTrophies',
      logo: { '@type': 'ImageObject', url: `${SITE}/icon-512.png` },
    },
    image: `${SITE}/og-image.png`,
    url,
    mainEntityOfPage: url,
    keywords: (post.tags || []).join(', '),
  };
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'ChessTrophies', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE}/blog/` },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  };
  const mins = post.readMins ? `${escHtml(String(post.readMins))} min read` : '';
  const tags = (post.tags || []).map((t) => `<span>${escHtml(t)}</span>`).join('');
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
<meta property="og:title" content="${escHtml(post.title)}" />
<meta property="og:description" content="${escHtml(desc)}" />
<meta property="og:url" content="${escHtml(url)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta property="article:published_time" content="${escHtml(post.date)}" />
<meta property="article:author" content="${escHtml(post.author)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escHtml(post.title)}" />
<meta name="twitter:description" content="${escHtml(desc)}" />
<meta name="twitter:image" content="${SITE}/og-image.png" />
<script type="application/ld+json">
${jsonLd(ld)}
</script>
<script type="application/ld+json">
${jsonLd(crumb)}
</script>
${styles()}
</head>
<body>
  <main class="wrap">
    <nav class="crumbs"><a href="/">ChessTrophies</a> &rsaquo; <a href="/blog/">Blog</a> &rsaquo; ${escHtml(post.title)}</nav>
    <article>
      <p class="eyebrow">Chess Legends</p>
      <h1>${escHtml(post.title)}</h1>
      <div class="rule" aria-hidden="true"></div>
      <p class="byline">By <b>${escHtml(post.author)}</b> &middot; ${escHtml(prettyDate(post.date))}${mins ? ' &middot; ' + mins : ''}</p>
      ${post.dek ? '<p class="dek">' + escHtml(post.dek) + '</p>' : ''}
${bodyHtml(post.body)}
      ${tags ? '<div class="tags">' + tags + '</div>' : ''}
    </article>
    <section class="cta">
      <h2>Play the game they made famous</h2>
      <p>Jump into ranked online chess, climb the ELO ladder, and earn trophies — free.</p>
      <a class="btn" href="${SITE}/">Play ChessTrophies free</a>
    </section>
    <footer>
      <a href="/blog/">&larr; All posts</a> &nbsp;&middot;&nbsp;
      <a href="/learn/">Learn</a> &nbsp;&middot;&nbsp;
      <a href="/openings/">Openings</a> &nbsp;&middot;&nbsp;
      <a href="/">Home</a>
    </footer>
  </main>
</body>
</html>
`;
}

function hubHtml(posts, SITE) {
  const url = `${SITE}/blog/`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'The ChessTrophies Blog',
    url,
    description: 'Stories and profiles of the greatest chess grandmasters — Carlsen, Kasparov, Fischer and more — from the ChessTrophies blog.',
    blogPost: posts.map((p) => ({
      '@type': 'BlogPosting', headline: p.title, url: `${SITE}/blog/${p.slug}.html`,
      datePublished: p.date, author: { '@type': 'Person', name: p.author },
    })),
  };
  const cards = posts.map((p) => {
    const mins = p.readMins ? ` &middot; ${escHtml(String(p.readMins))} min read` : '';
    return `      <li class="card">
        <a href="/blog/${escHtml(p.slug)}.html"><h2>${escHtml(p.title)}</h2></a>
        <p class="meta">By ${escHtml(p.author)} &middot; ${escHtml(prettyDate(p.date))}${mins}</p>
        ${p.dek ? '<p class="dek">' + escHtml(p.dek) + '</p>' : ''}
        <a class="more" href="/blog/${escHtml(p.slug)}.html">Read the story &rarr;</a>
      </li>`;
  }).join('\n');
  const extra = `
  .lede { color:var(--body); font-size:18px; margin:0 0 8px; max-width:62ch; }
  ul.cards { list-style:none; padding:0; margin:30px 0 0; display:grid; gap:16px; }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:20px 22px; }
  .card a { text-decoration:none; }
  .card h2 { font-family:var(--serif); font-size:21px; color:var(--text); margin:0 0 4px; }
  .card a:hover h2 { color:var(--gold); }
  .card .meta { color:var(--muted); font-size:13px; margin:0 0 8px; }
  .card .dek { color:var(--body); font-size:15px; margin:0 0 12px; }
  .card .more { color:var(--gold); font-weight:600; font-size:14px; }`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>The ChessTrophies Blog — Grandmaster Stories &amp; Chess History</title>
<meta name="description" content="Profiles of the greatest chess grandmasters — Magnus Carlsen, Garry Kasparov, Bobby Fischer, Hikaru Nakamura, Mikhail Tal and Judit Polgar — on the ChessTrophies blog." />
<link rel="canonical" href="${url}" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="ChessTrophies" />
<meta property="og:title" content="The ChessTrophies Blog — Grandmaster Stories" />
<meta property="og:description" content="Profiles of the greatest chess grandmasters, from the ChessTrophies blog." />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="The ChessTrophies Blog" />
<meta name="twitter:image" content="${SITE}/og-image.png" />
<script type="application/ld+json">
${jsonLd(ld)}
</script>
${styles(extra)}
</head>
<body>
  <main class="wrap">
    <nav class="crumbs"><a href="/">ChessTrophies</a> &rsaquo; Blog</nav>
    <p class="eyebrow">The Board Room &middot; Blog</p>
    <h1>The ChessTrophies Blog</h1>
    <div class="rule" aria-hidden="true"></div>
    <p class="lede">Profiles of the players who shaped the game — the champions, the attackers, and the record-breakers. Written for people who love chess and want to play it.</p>
    <ul class="cards">
${cards}
    </ul>
    <section class="cta">
      <h2>Ready to make your own moves?</h2>
      <p>Play ranked online chess, solve daily puzzles, and earn trophies — free.</p>
      <a class="btn" href="${SITE}/">Play ChessTrophies free</a>
    </section>
    <footer>
      <a href="/learn/">Learn</a> &nbsp;&middot;&nbsp;
      <a href="/openings/">Openings</a> &nbsp;&middot;&nbsp;
      <a href="/tools/">Tools</a> &nbsp;&middot;&nbsp;
      <a href="/">Home</a>
    </footer>
  </main>
</body>
</html>
`;
}

async function loadPosts() {
  let entries;
  try { entries = await fsp.readdir(BLOG_DIR); }
  catch { return []; } // no blog/ dir yet -> no posts
  const posts = [];
  for (const f of entries) {
    if (!f.endsWith('.mjs')) continue;
    const mod = await import(pathToFileURL(path.join(BLOG_DIR, f)).href);
    const p = mod.default;
    if (!p || typeof p !== 'object') throw new Error(`blog/${f} has no default export object`);
    for (const req of ['slug', 'title', 'author', 'date', 'dek', 'body']) {
      if (!p[req]) throw new Error(`blog/${f} missing required field "${req}"`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) throw new Error(`blog/${f} date must be YYYY-MM-DD, got "${p.date}"`);
    if (!Array.isArray(p.body) || p.body.length === 0) throw new Error(`blog/${f} body must be a non-empty array`);
    posts.push(p);
  }
  // Newest first.
  posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return posts;
}

export async function generate({ DIST, SITE }) {
  const posts = await loadPosts();
  if (!posts.length) return { urls: [], count: 0 };

  await fsp.mkdir(path.join(DIST, 'blog'), { recursive: true });
  const seen = new Set();
  const urls = [{ loc: `${SITE}/blog/`, priority: '0.7' }];
  for (const p of posts) {
    if (seen.has(p.slug)) throw new Error(`duplicate blog slug "${p.slug}"`);
    seen.add(p.slug);
    await fsp.writeFile(path.join(DIST, 'blog', p.slug + '.html'), postHtml(p, SITE), 'utf8');
    urls.push({ loc: `${SITE}/blog/${p.slug}.html`, priority: '0.6' });
  }
  await fsp.writeFile(path.join(DIST, 'blog', 'index.html'), hubHtml(posts, SITE), 'utf8');
  return { urls, count: posts.length };
}

// Standalone preview: node scripts/seo/blog-pages.mjs [outDir]
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = path.resolve(process.argv[2] || './_blog_preview');
  const SITE = 'https://www.playchesstrophies.com';
  await fsp.mkdir(out, { recursive: true });
  const r = await generate({ DIST: out, SITE });
  console.log(`generated ${r.count} blog page(s) + hub into ${out}/blog/`);
  for (const u of r.urls) console.log('  ' + u.loc + '  (priority ' + u.priority + ')');
}
