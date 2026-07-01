// scripts/seo/tools-pages.mjs — ESM, self-contained (node:fs/promises, node:path only).
//
// Generates static, crawlable "free chess tools" for SEO:
//   dist/tools/index.html                    — hub
//   dist/tools/elo-rating-calculator.html    (+ .js)
//   dist/tools/fen-board-viewer.html         (+ .js)
//
// build.mjs imports generate() and merges the returned `urls` into sitemap.xml.
// Design: "The Board Room" — board-night navy + walnut + trophy gold. Each page
// carries its own <style>; each tool's JS lives in an external companion file
// loaded with <script src defer> (these pages are NOT under index.html's CSP).

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Escape for use in HTML text / double-quoted attributes.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Shared "Board Room" stylesheet. Self-contained, no external fonts.
const STYLE = `  :root {
    color-scheme: dark;
    --bg:#0b1220; --surface:#101a2e; --panel:#17223b; --panel-2:#1d2a47;
    --border:#243556; --text:#e8eefc; --muted:#8a98b8; --body:#d7def0;
    --gold:#f5c451; --gold-2:#e1a92a; --walnut-l:#e8d2a8; --walnut-d:#9c6b43;
    --display:'Iowan Old Style','Palatino Linotype','Palatino','Georgia',serif;
    --ui:'Inter',-apple-system,BlinkMacSystemFont,system-ui,'Segoe UI',sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:var(--ui);
    line-height:1.65; -webkit-font-smoothing:antialiased; }
  a { color:var(--gold); }
  .wrap { max-width:880px; margin:0 auto; padding:26px 20px 72px; }
  .eyebrow { font-family:var(--display); text-transform:uppercase; letter-spacing:.14em;
    font-size:12px; color:var(--gold); margin:0 0 8px; font-weight:700; }
  h1 { font-family:var(--display); font-size:33px; line-height:1.2; margin:2px 0 12px; }
  h2 { font-family:var(--display); font-size:22px; margin:34px 0 8px; color:var(--gold); }
  h3 { font-family:var(--display); font-size:17px; margin:22px 0 6px; color:var(--text); }
  p { margin:12px 0; color:var(--body); }
  .lede { color:#b9c3dc; font-size:17px; margin:0 0 6px; }
  .crumbs { font-size:14px; color:var(--muted); margin-bottom:16px; }
  .crumbs a { color:var(--muted); text-decoration:none; }
  .crumbs a:hover { color:var(--text); }
  /* SIGNATURE: walnut checker hairline under the header */
  .walnut-rule { height:8px; border-radius:3px; margin:16px 0 26px; overflow:hidden;
    display:grid; grid-template-columns:repeat(8,1fr); border:1px solid var(--border); }
  .walnut-rule > i { display:block; }
  .walnut-rule > i:nth-child(odd) { background:var(--walnut-l); }
  .walnut-rule > i:nth-child(even) { background:var(--walnut-d); }
  .panel { background:var(--panel); border:1px solid var(--border); border-radius:14px;
    padding:22px; margin:22px 0; }
  .panel-2 { background:var(--panel-2); }
  label { display:block; font-size:13px; color:var(--muted); font-weight:600;
    margin:0 0 6px; }
  input, select { width:100%; background:var(--panel-2); color:var(--text);
    border:1px solid var(--border); border-radius:9px; padding:11px 12px; font:inherit;
    min-height:44px; }
  input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible {
    outline:2px solid var(--gold); outline-offset:2px; }
  textarea { width:100%; background:var(--panel-2); color:var(--text);
    border:1px solid var(--border); border-radius:9px; padding:11px 12px; font:inherit;
    line-height:1.5; resize:vertical; min-height:66px; }
  textarea:focus-visible { outline:2px solid var(--gold); outline-offset:2px; }
  .grid { display:grid; gap:16px; }
  @media (min-width:560px) { .grid-3 { grid-template-columns:repeat(3,1fr); }
    .grid-2 { grid-template-columns:repeat(2,1fr); } }
  .row { display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
  button, .btn { font-family:var(--ui); cursor:pointer; border:none;
    background:linear-gradient(180deg,var(--gold),var(--gold-2)); color:#0b1220;
    font-weight:700; border-radius:10px; padding:12px 20px; min-height:44px;
    font-size:15px; transition:transform .12s ease, filter .12s ease;
    text-decoration:none; display:inline-block; }
  button:hover, .btn:hover { transform:translateY(-1px); filter:brightness(1.04); }
  button.ghost { background:transparent; color:var(--text); border:1px solid var(--border);
    font-weight:600; }
  button.ghost:hover { background:var(--panel-2); }
  .results { margin-top:6px; }
  .stat-row { display:flex; justify-content:space-between; align-items:baseline;
    gap:12px; padding:12px 0; border-bottom:1px solid #1c2845; }
  .stat-row:last-child { border-bottom:none; }
  .stat-row .k { color:var(--muted); font-size:14px; }
  .stat-row .v { font-size:20px; font-weight:700; font-variant-numeric:tabular-nums; }
  .v.up { color:#7ee0a8; } .v.down { color:#ff9d9d; } .v.gold { color:var(--gold); }
  .hint { color:var(--muted); font-size:13px; margin-top:6px; }
  .err { color:#ff9d9d; font-size:14px; margin-top:10px; min-height:1em; }
  table { width:100%; border-collapse:collapse; margin:10px 0; font-size:14px;
    font-variant-numeric:tabular-nums; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #1c2845; }
  th { color:var(--muted); font-weight:600; }
  .cards { display:grid; gap:16px; margin:20px 0; }
  @media (min-width:620px) { .cards { grid-template-columns:1fr 1fr; } }
  .card { display:block; background:var(--panel); border:1px solid var(--border);
    border-radius:14px; padding:20px; text-decoration:none; color:var(--text);
    transition:transform .12s ease, border-color .12s ease; }
  .card:hover { transform:translateY(-2px); border-color:var(--gold-2); }
  .card h3 { margin:0 0 6px; color:var(--gold); }
  .card p { margin:0; color:var(--muted); font-size:14px; }
  .cta { margin-top:40px; padding:24px; border:1px solid var(--gold-2); border-radius:16px;
    background:linear-gradient(180deg,#1b2138,#141b30); text-align:center; }
  .cta h2 { margin-top:0; color:var(--gold); }
  .cta p { color:var(--body); }
  /* Walnut board for the FEN viewer */
  .board { display:grid; grid-template-columns:repeat(8,1fr); aspect-ratio:1/1;
    width:100%; max-width:440px; margin:6px auto; border:1px solid var(--border);
    border-radius:8px; overflow:hidden; }
  .sq { display:flex; align-items:center; justify-content:center;
    font-size:clamp(20px,7vw,38px); line-height:1; user-select:none; }
  .sq.l { background:var(--walnut-l); } .sq.d { background:var(--walnut-d); }
  .sq .pc.w { color:#f4eee2; text-shadow:0 1px 1px rgba(0,0,0,.35); }
  .sq .pc.b { color:#33373e; text-shadow:0 1px 0 rgba(255,255,255,.12); }
  footer { margin-top:44px; font-size:13px; color:var(--muted);
    border-top:1px solid var(--border); padding-top:18px; }
  footer a { color:var(--muted); }
  @media (prefers-reduced-motion: reduce) {
    * { transition:none !important; animation:none !important; }
  }`;

const WALNUT_RULE =
  '<div class="walnut-rule" aria-hidden="true">' +
  '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>';

// Full <head> for a tool/hub page, incl. OG/Twitter + JSON-LD blocks.
function head({ SITE, title, desc, url, ogType, ld }) {
  const jsonld = (Array.isArray(ld) ? ld : [ld])
    .map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(url)}" />
<link rel="icon" type="image/svg+xml" href="/icon.svg" />
<meta property="og:type" content="${esc(ogType)}" />
<meta property="og:site_name" content="ChessTrophies" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${SITE}/og-image.png" />
${jsonld}
<style>
${STYLE}
</style>
</head>`;
}

function breadcrumbLd(SITE, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.item.startsWith('http') ? it.item : `${SITE}${it.item}`,
    })),
  };
}

function ctaCard(SITE) {
  return `    <section class="cta">
      <h2>Play free on ChessTrophies</h2>
      <p>Put the numbers to work: play ranked chess and checkers, climb the ELO ladder, and earn trophies — free, in your browser.</p>
      <a class="btn" href="${SITE}/">Play free on ChessTrophies</a>
    </section>`;
}

// ---------------------------------------------------------------------------
// ELO / rating calculator
// ---------------------------------------------------------------------------

function eloPageHtml(SITE) {
  const url = `${SITE}/tools/elo-rating-calculator.html`;
  const title = 'ELO Rating Calculator — Chess Rating Change | ChessTrophies';
  const desc =
    'Free ELO chess rating calculator. Enter your rating, your opponent’s rating, the result and a K-factor to see the expected score, your rating change (±) and new rating instantly.';
  const app = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'ELO Rating Calculator',
    url,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: desc,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'ChessTrophies' },
  };
  const crumbs = breadcrumbLd(SITE, [
    { name: 'Home', item: '/' },
    { name: 'Tools', item: '/tools/' },
    { name: 'ELO Rating Calculator', item: '/tools/elo-rating-calculator.html' },
  ]);
  return `${head({ SITE, title, desc, url, ogType: 'website', ld: [app, crumbs] })}
<body>
  <main class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/tools/">Tools</a> &rsaquo; ELO Rating Calculator</nav>
    <p class="eyebrow">Free chess tool</p>
    <h1>ELO Rating Calculator</h1>
    ${WALNUT_RULE}
    <p class="lede">See exactly how many rating points a game is worth before or after you play it.</p>
    <p>Enter your rating, your opponent’s rating, the result, and the K-factor your rating system uses. The calculator shows your <strong>expected score</strong>, the <strong>points you’d gain or lose</strong>, and your <strong>new rating</strong> — recomputed as you type. It uses the standard ELO formula, the same math behind chess ratings on ChessTrophies and most federations.</p>

    <section class="panel" aria-labelledby="calc-h">
      <h2 id="calc-h" style="margin-top:0;font-size:18px;">Calculate a rating change</h2>
      <div class="grid grid-2">
        <div>
          <label for="you">Your rating</label>
          <input id="you" type="number" inputmode="numeric" value="1500" min="0" max="4000" step="1" />
        </div>
        <div>
          <label for="opp">Opponent rating</label>
          <input id="opp" type="number" inputmode="numeric" value="1600" min="0" max="4000" step="1" />
        </div>
      </div>
      <div class="grid grid-2" style="margin-top:16px;">
        <div>
          <label for="result">Result</label>
          <select id="result">
            <option value="1">Win</option>
            <option value="0.5">Draw</option>
            <option value="0">Loss</option>
          </select>
        </div>
        <div>
          <label for="kfactor">K-factor</label>
          <select id="kfactor">
            <option value="40">40 — new / provisional players</option>
            <option value="32" selected>32 — standard (default)</option>
            <option value="24">24 — experienced</option>
            <option value="16">16 — masters (2400+)</option>
            <option value="10">10 — elite / stable</option>
          </select>
        </div>
      </div>
      <div class="results" role="region" aria-live="polite" aria-atomic="true">
        <div class="stat-row"><span class="k">Expected score</span><span class="v gold" id="r-expected">—</span></div>
        <div class="stat-row"><span class="k">Rating change</span><span class="v" id="r-change">—</span></div>
        <div class="stat-row"><span class="k">New rating</span><span class="v" id="r-new">—</span></div>
      </div>
      <p class="err" id="err" role="alert"></p>
      <p class="hint">Expected score is your win probability (a draw counts as half). K-factor controls how fast ratings move.</p>
    </section>

    <h2>Expected score vs. rating difference</h2>
    <p>A quick reference for how the rating gap maps to your expected score. A positive difference means you out-rate your opponent.</p>
    <table>
      <thead><tr><th>Rating difference (you − opponent)</th><th>Your expected score</th></tr></thead>
      <tbody id="ref-table"></tbody>
    </table>

    <h2>How ELO rating math works</h2>
    <p>ELO estimates each player’s strength as a single number. Before a game it predicts an <em>expected score</em> from the rating gap; after the game it nudges both ratings toward reality based on how the result compared to that prediction.</p>
    <p>The expected score is:</p>
    <p class="panel panel-2" style="font-family:var(--ui);text-align:center;">E = 1 / (1 + 10^((opponent − you) / 400))</p>
    <p>Your actual score S is 1 for a win, 0.5 for a draw, 0 for a loss. Your new rating is <strong>you + K · (S − E)</strong>, rounded to the nearest whole point. Beat a stronger opponent and S − E is large and positive, so you gain a lot; lose to a weaker one and you drop more.</p>

    <h2>FAQ</h2>
    <h3>What K-factor should I use?</h3>
    <p>Most casual and club systems use 32. Federations often lower K as you improve (24, then 16 for masters) so established ratings are stable, and raise it (40) for newcomers so their rating finds its level quickly.</p>
    <h3>Why do I gain more for beating a higher-rated player?</h3>
    <p>Because your expected score against them is low, so S − E is large. The upset is “surprising” to the formula, and it corrects your rating more.</p>
    <h3>Is a 400-point gap really 10-to-1 odds?</h3>
    <p>Roughly. A 400-point difference gives the favourite an expected score of about 0.91 — near a 10-to-1 edge. That is the anchor the whole scale is built around.</p>

${ctaCard(SITE)}
    <footer>
      <a href="/tools/">&larr; All chess tools</a> &nbsp;·&nbsp; <a href="/">Home</a>
    </footer>
  </main>
  <script src="elo-rating-calculator.js" defer></script>
</body>
</html>
`;
}

function eloJs() {
  return `// ELO / chess rating calculator — dependency-free. Recomputes on every input.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var youEl = $('you'), oppEl = $('opp'), resEl = $('result'), kEl = $('kfactor');
  var expEl = $('r-expected'), chgEl = $('r-change'), newEl = $('r-new'), errEl = $('err');

  // Expected score for A vs B given their ratings.
  function expected(you, opp) {
    return 1 / (1 + Math.pow(10, (opp - you) / 400));
  }

  function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }

  function compute() {
    var you = parseFloat(youEl.value);
    var opp = parseFloat(oppEl.value);
    var S = parseFloat(resEl.value);
    var K = parseFloat(kEl.value);
    var valid =
      isFinite(you) && isFinite(opp) && you >= 0 && opp >= 0 &&
      you <= 4000 && opp <= 4000;
    if (!valid) {
      expEl.textContent = '—'; chgEl.textContent = '—'; newEl.textContent = '—';
      chgEl.className = 'v';
      errEl.textContent = 'Enter both ratings as numbers between 0 and 4000.';
      return;
    }
    errEl.textContent = '';
    var E = expected(you, opp);
    var newRating = Math.round(you + K * (S - E));
    var change = newRating - Math.round(you);
    expEl.textContent = fmtPct(E) + '  (' + E.toFixed(3) + ')';
    var sign = change > 0 ? '+' : '';
    chgEl.textContent = sign + change + (Math.abs(change) === 1 ? ' point' : ' points');
    chgEl.className = 'v ' + (change > 0 ? 'up' : change < 0 ? 'down' : '');
    newEl.textContent = String(newRating);
    newEl.className = 'v gold';
  }

  // Build the "expected score vs rating difference" reference table.
  function buildRefTable() {
    var body = $('ref-table');
    if (!body) return;
    var diffs = [-400, -200, -100, -50, 0, 50, 100, 200, 400];
    var rows = '';
    for (var i = 0; i < diffs.length; i++) {
      var d = diffs[i];
      var E = 1 / (1 + Math.pow(10, -d / 400)); // you - opp = d  ->  opp - you = -d
      var label = (d > 0 ? '+' + d : String(d));
      rows += '<tr><td>' + label + '</td><td>' + fmtPct(E) + '</td></tr>';
    }
    body.innerHTML = rows;
  }

  [youEl, oppEl, resEl, kEl].forEach(function (el) {
    el.addEventListener('input', compute);
    el.addEventListener('change', compute);
  });
  buildRefTable();
  compute();
})();
`;
}

// ---------------------------------------------------------------------------
// FEN board viewer
// ---------------------------------------------------------------------------

function fenPageHtml(SITE) {
  const url = `${SITE}/tools/fen-board-viewer.html`;
  const title = 'FEN Viewer — Chess Board from FEN | ChessTrophies';
  const desc =
    'Free FEN viewer. Paste a FEN string to render the chess position on a walnut board, with side to move, castling rights, en passant and move numbers. Validates your FEN with a friendly error.';
  const app = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'FEN Board Viewer',
    url,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (web browser)',
    description: desc,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    publisher: { '@type': 'Organization', name: 'ChessTrophies' },
  };
  const crumbs = breadcrumbLd(SITE, [
    { name: 'Home', item: '/' },
    { name: 'Tools', item: '/tools/' },
    { name: 'FEN Board Viewer', item: '/tools/fen-board-viewer.html' },
  ]);
  return `${head({ SITE, title, desc, url, ogType: 'website', ld: [app, crumbs] })}
<body>
  <main class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/tools/">Tools</a> &rsaquo; FEN Board Viewer</nav>
    <p class="eyebrow">Free chess tool</p>
    <h1>FEN Board Viewer</h1>
    ${WALNUT_RULE}
    <p class="lede">Paste any FEN string and see the position on a real walnut board.</p>
    <p>FEN (Forsyth–Edwards Notation) is the standard one-line text format for a chess position. Paste one below and this viewer draws the board, tells you whose move it is, and lists castling rights, en-passant target and move numbers. If the FEN is malformed, it tells you exactly what’s wrong instead of failing silently.</p>

    <section class="panel" aria-labelledby="fen-h">
      <h2 id="fen-h" style="margin-top:0;font-size:18px;">Show a position</h2>
      <label for="fen">FEN string</label>
      <textarea id="fen" spellcheck="false" autocapitalize="off" autocomplete="off" rows="2"></textarea>
      <div class="row" style="margin-top:12px;">
        <button id="show" type="button">Show position</button>
        <button id="start" type="button" class="ghost">Load starting position</button>
        <button id="example" type="button" class="ghost">Load example</button>
        <button id="copy" type="button" class="ghost">Copy FEN</button>
      </div>
      <p class="err" id="err" role="alert"></p>
      <div class="board" id="board" role="img" aria-label="Chess position from the FEN string"></div>
      <div class="results" role="region" aria-live="polite" aria-atomic="true">
        <div class="stat-row"><span class="k">Side to move</span><span class="v gold" id="m-turn">—</span></div>
        <div class="stat-row"><span class="k">Castling rights</span><span class="v" id="m-castle" style="font-size:16px;">—</span></div>
        <div class="stat-row"><span class="k">En passant target</span><span class="v" id="m-ep" style="font-size:16px;">—</span></div>
        <div class="stat-row"><span class="k">Halfmove clock</span><span class="v" id="m-half" style="font-size:16px;">—</span></div>
        <div class="stat-row"><span class="k">Fullmove number</span><span class="v" id="m-full" style="font-size:16px;">—</span></div>
      </div>
    </section>

    <h2>Example positions</h2>
    <p>Click to load one, then hit “Show position”:</p>
    <ul id="examples" style="margin:0 0 8px;padding-left:18px;color:var(--body);"></ul>

    <h2>What is a FEN string?</h2>
    <p>A FEN has up to six space-separated fields. Only the first is required to draw a board:</p>
    <ol style="color:var(--body);">
      <li><strong>Piece placement</strong> — eight ranks from 8 down to 1, separated by <code>/</code>. Letters are pieces (uppercase = white, lowercase = black); a digit is that many empty squares. Each rank must total 8.</li>
      <li><strong>Side to move</strong> — <code>w</code> or <code>b</code>.</li>
      <li><strong>Castling</strong> — any of <code>KQkq</code>, or <code>-</code> for none.</li>
      <li><strong>En passant</strong> — the target square (e.g. <code>e3</code>) or <code>-</code>.</li>
      <li><strong>Halfmove clock</strong> — half-moves since the last capture or pawn move (for the 50-move rule).</li>
      <li><strong>Fullmove number</strong> — starts at 1, increments after Black moves.</li>
    </ol>

    <h2>FAQ</h2>
    <h3>Does this check if the position is legal?</h3>
    <p>No — it reads the FEN and draws it exactly as written. It validates the <em>format</em> (each rank totalling 8, valid piece letters) but does not judge whether the position could arise in a real game.</p>
    <h3>Why is my FEN rejected?</h3>
    <p>The most common causes are a rank that doesn’t add up to eight squares, an invalid piece letter, or the wrong number of ranks. The error message names the exact rank so you can fix it fast.</p>

${ctaCard(SITE)}
    <footer>
      <a href="/tools/">&larr; All chess tools</a> &nbsp;·&nbsp; <a href="/">Home</a>
    </footer>
  </main>
  <script src="fen-board-viewer.js" defer></script>
</body>
</html>
`;
}

function fenJs() {
  return `// FEN board viewer — dependency-free. Parses the piece-placement field itself.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var fenEl = $('fen'), boardEl = $('board'), errEl = $('err');
  var turnEl = $('m-turn'), castleEl = $('m-castle'), epEl = $('m-ep'),
      halfEl = $('m-half'), fullEl = $('m-full');

  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var EXAMPLES = [
    { name: 'Italian Game (after 3.Bc4)', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3' },
    { name: 'Scholar\\'s mate threat', fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3' },
    { name: 'King & pawn endgame', fen: '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1' }
  ];

  var GLYPH = {
    K: '\\u2654', Q: '\\u2655', R: '\\u2656', B: '\\u2657', N: '\\u2658', P: '\\u2659',
    k: '\\u265A', q: '\\u265B', r: '\\u265C', b: '\\u265D', n: '\\u265E', p: '\\u265F'
  };
  var VALID = /^[prnbqkPRNBQK]$/;

  // Parse the piece-placement field into an 8x8 array (rank 8 first).
  // Returns { ok:true, rows } or { ok:false, msg }.
  function parsePlacement(field) {
    if (!field) return { ok: false, msg: 'FEN is empty — paste a position first.' };
    var ranks = field.split('/');
    if (ranks.length !== 8) {
      return { ok: false, msg: 'FEN has ' + ranks.length + ' rank(s) — a board needs exactly 8, separated by "/".' };
    }
    var rows = [];
    for (var r = 0; r < 8; r++) {
      var rank = ranks[r];
      var row = [];
      for (var i = 0; i < rank.length; i++) {
        var c = rank[i];
        if (c >= '1' && c <= '8') {
          var n = parseInt(c, 10);
          for (var j = 0; j < n; j++) row.push(null);
        } else if (VALID.test(c)) {
          row.push(c);
        } else {
          return { ok: false, msg: 'Rank ' + (8 - r) + ' contains "' + c + '", which is not a valid piece or number.' };
        }
      }
      if (row.length !== 8) {
        return { ok: false, msg: 'Rank ' + (8 - r) + ' has ' + row.length + ' square(s) — each rank must total 8.' };
      }
      rows.push(row);
    }
    return { ok: true, rows: rows };
  }

  function render(rows) {
    var html = '';
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var light = (r + f) % 2 === 0;
        var piece = rows[r][f];
        var inner = '';
        if (piece) {
          var isWhite = piece === piece.toUpperCase();
          inner = '<span class="pc ' + (isWhite ? 'w' : 'b') + '">' + GLYPH[piece] + '</span>';
        }
        html += '<div class="sq ' + (light ? 'l' : 'd') + '">' + inner + '</div>';
      }
    }
    boardEl.innerHTML = html;
  }

  function show() {
    var raw = (fenEl.value || '').trim().replace(/\\s+/g, ' ');
    var fields = raw.split(' ');
    var res = parsePlacement(fields[0]);
    if (!res.ok) {
      errEl.textContent = res.msg;
      return;
    }
    errEl.textContent = '';
    render(res.rows);

    var turn = fields[1];
    turnEl.textContent = turn === 'b' ? 'Black' : turn === 'w' ? 'White' : 'White (not specified)';

    var castle = fields[2];
    castleEl.textContent = (!castle || castle === '-') ? 'None' : castle;

    var ep = fields[3];
    epEl.textContent = (!ep || ep === '-') ? 'None' : ep;

    halfEl.textContent = (fields[4] === undefined || fields[4] === '') ? '—' : fields[4];
    fullEl.textContent = (fields[5] === undefined || fields[5] === '') ? '—' : fields[5];
  }

  function load(fen) { fenEl.value = fen; show(); }

  $('show').addEventListener('click', show);
  $('start').addEventListener('click', function () { load(START); });
  $('example').addEventListener('click', function () { load(EXAMPLES[0].fen); });
  $('copy').addEventListener('click', function () {
    var t = fenEl.value.trim();
    if (!t) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () {
        var b = $('copy'); var old = b.textContent; b.textContent = 'Copied!';
        setTimeout(function () { b.textContent = old; }, 1200);
      });
    } else {
      fenEl.select(); try { document.execCommand('copy'); } catch (e) {}
    }
  });
  fenEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); show(); }
  });

  // Build the clickable examples list.
  var ul = $('examples');
  if (ul) {
    EXAMPLES.forEach(function (ex) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#';
      a.textContent = ex.name;
      a.addEventListener('click', function (e) { e.preventDefault(); load(ex.fen); window.scrollTo({ top: 0, behavior: 'smooth' }); });
      li.appendChild(a);
      ul.appendChild(li);
    });
  }

  // Never empty: start with the default position.
  load(START);
})();
`;
}

// ---------------------------------------------------------------------------
// /tools/ hub
// ---------------------------------------------------------------------------

function hubHtml(SITE) {
  const url = `${SITE}/tools/`;
  const title = 'Free Chess Tools — ELO Calculator & FEN Viewer | ChessTrophies';
  const desc =
    'Free, no-signup chess tools from ChessTrophies: an ELO rating calculator and a FEN board viewer. Fast, private, and run entirely in your browser.';
  const tools = [
    {
      name: 'ELO Rating Calculator',
      path: '/tools/elo-rating-calculator.html',
      blurb: 'Expected score, points gained or lost, and your new rating from any matchup and K-factor.',
    },
    {
      name: 'FEN Board Viewer',
      path: '/tools/fen-board-viewer.html',
      blurb: 'Paste a FEN string to draw the position on a walnut board, with side to move and castling rights.',
    },
  ];
  const collection = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Free Chess Tools',
    url,
    description: desc,
    hasPart: tools.map((t) => ({
      '@type': 'WebApplication',
      name: t.name,
      url: `${SITE}${t.path}`,
      applicationCategory: 'UtilitiesApplication',
    })),
  };
  const crumbs = breadcrumbLd(SITE, [
    { name: 'Home', item: '/' },
    { name: 'Tools', item: '/tools/' },
  ]);
  const cards = tools
    .map(
      (t) =>
        `      <a class="card" href="${esc(t.path)}"><h3>${esc(t.name)}</h3><p>${esc(t.blurb)}</p></a>`
    )
    .join('\n');
  return `${head({ SITE, title, desc, url, ogType: 'website', ld: [collection, crumbs] })}
<body>
  <main class="wrap">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; Tools</nav>
    <p class="eyebrow">Free chess tools</p>
    <h1>Free Chess Tools</h1>
    ${WALNUT_RULE}
    <p class="lede">Handy, no-signup chess utilities that run entirely in your browser.</p>
    <p>Nothing to install, nothing tracked — each tool does one thing well and works offline once loaded. Built by ChessTrophies, where you can play everything you calculate here for real.</p>
    <div class="cards">
${cards}
    </div>
${ctaCard(SITE)}
    <footer>
      <a href="/">Home</a> &nbsp;·&nbsp; <a href="/learn/">Chess lessons</a>
    </footer>
  </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// generate() + main guard
// ---------------------------------------------------------------------------

export async function generate({ DIST, SITE }) {
  const toolsDir = path.join(DIST, 'tools');
  await mkdir(toolsDir, { recursive: true });

  await writeFile(path.join(toolsDir, 'index.html'), hubHtml(SITE), 'utf8');
  await writeFile(path.join(toolsDir, 'elo-rating-calculator.html'), eloPageHtml(SITE), 'utf8');
  await writeFile(path.join(toolsDir, 'elo-rating-calculator.js'), eloJs(), 'utf8');
  await writeFile(path.join(toolsDir, 'fen-board-viewer.html'), fenPageHtml(SITE), 'utf8');
  await writeFile(path.join(toolsDir, 'fen-board-viewer.js'), fenJs(), 'utf8');

  const urls = [
    { loc: `${SITE}/tools/`, priority: '0.8' },
    { loc: `${SITE}/tools/elo-rating-calculator.html`, priority: '0.7' },
    { loc: `${SITE}/tools/fen-board-viewer.html`, priority: '0.7' },
  ];
  return { urls, count: urls.length };
}

// node scripts/seo/tools-pages.mjs <outDir>  -> generate into outDir (default ./_preview)
// Robust main-guard on both POSIX and Windows: compare normalized paths rather
// than file:// URLs (Windows drive letters + backslashes break naive comparison).
const invoked = (process.argv[1] || '').replace(/\\/g, '/');
const selfPath = decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
if (invoked && (selfPath === invoked || selfPath.endsWith('/tools-pages.mjs') && invoked.endsWith('/tools-pages.mjs'))) {
  const outDir = process.argv[2] || path.resolve('./_preview');
  const SITE = 'https://www.playchesstrophies.com';
  generate({ DIST: outDir, SITE })
    .then((res) => {
      console.log('Generated ' + res.count + ' tool URL(s) into ' + path.join(outDir, 'tools'));
      console.log('Files:');
      for (const f of [
        'tools/index.html',
        'tools/elo-rating-calculator.html',
        'tools/elo-rating-calculator.js',
        'tools/fen-board-viewer.html',
        'tools/fen-board-viewer.js',
      ]) {
        console.log('  ' + path.join(outDir, f));
      }
      console.log('urls:', JSON.stringify(res.urls, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
