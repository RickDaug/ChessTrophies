#!/usr/bin/env node
/*
 * gen-og-image.mjs — render the social share banner (og-image.png, 1200x630).
 *
 * Renders a branded HTML card in headless Chromium and screenshots it, so the
 * banner stays in sync with the app's colors/logo. Re-run after changing the
 * logo or copy:  node tools/gen-og-image.mjs
 *
 * Output: og-image.png in the repo root (1200x630, the standard OG card size).
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const logo = fs.readFileSync(path.join(ROOT, 'icon-1024.png')).toString('base64');
const out = path.join(ROOT, 'og-image.png');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1200px; height:630px; }
  .card {
    width:1200px; height:630px; display:flex; align-items:center; gap:60px;
    padding:0 80px; font-family: Arial, Helvetica, sans-serif;
    background:
      radial-gradient(1200px 600px at 80% -10%, rgba(245,196,81,.16), transparent 60%),
      linear-gradient(135deg, #0b1220 0%, #111a2e 55%, #17223b 100%);
    color:#e8eefc;
  }
  .logo { width:320px; height:320px; flex:0 0 320px;
    filter: drop-shadow(0 18px 40px rgba(0,0,0,.55)); border-radius:44px; }
  .right { display:flex; flex-direction:column; gap:16px; min-width:0; }
  h1 { font-size:72px; font-weight:800; letter-spacing:-1px; line-height:1; white-space:nowrap;
    background:linear-gradient(135deg,#f5c451,#ffe09a); -webkit-background-clip:text;
    background-clip:text; -webkit-text-fill-color:transparent; }
  .tag { font-size:36px; font-weight:600; color:#e8eefc; }
  .feat { font-size:25px; font-weight:500; color:#8a98b8; margin-top:6px; }
  .url { margin-top:16px; font-size:28px; font-weight:700; color:#f5c451; }
</style></head><body>
  <div class="card">
    <img class="logo" src="data:image/png;base64,${logo}" />
    <div class="right">
      <h1>ChessTrophies</h1>
      <div class="tag">Play online chess. Win trophies.</div>
      <div class="feat">Ranked 1v1 &amp; 2v2 &middot; ELO ratings &middot; 60+ trophies &middot; Free</div>
      <div class="url">playchesstrophies.com</div>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.locator('.card').screenshot({ path: out });
  console.log('[gen-og-image] wrote', out);
} finally {
  await browser.close();
}
