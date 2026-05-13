# ChessTrophies — Launch Guide

A real, sequenced plan for going from your Downloads folder to a live, paid product on the web and app stores.

## TL;DR cost summary

| Item | Cost | When |
|---|---|---|
| Domain (e.g., `chesstrophies.com`) | $10-15/yr | Day 1 |
| Static hosting (Vercel/Netlify) | $0 to start | Day 1 |
| Backend hosting (Railway/Render) | $5-20/mo | Week 2 |
| Stripe payments | 2.9% + $0.30 per charge | Week 3 |
| Apple Developer Program | $99/yr | Month 2 (only if iOS) |
| Google Play Console | $25 one-time | Month 2 (only if Android) |
| AdSense | Free, takes ~30% of ad revenue | Week 3 (needs traffic first) |
| **Minimum to launch web** | **~$15 + ~$10/mo** | — |
| **Add native apps** | **+$124 first year** | — |

---

## Phase 1: Live on the web (Days 1–3)

**Goal:** Anyone in the world can visit `https://yoursite.com` and play.

### Step 1.1 — Buy a domain (15 min, $10–15/yr)
- Go to **Cloudflare Registrar** (cheapest) or **Namecheap** / **Porkbun**
- Search for `chesstrophies.com` — if taken, try `playchesstrophies.com`, `chesstrophies.app`, etc.
- Pay for 1 year, set auto-renew off if you want to evaluate

### Step 1.2 — Push to GitHub (15 min)
```bash
cd C:\Users\RickD\Downloads\ChessTrophies
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/RickDaug/ChessTrophies.git
git push -u origin main
```

If your existing repo has the older trophy-tracker README, force-push:
```bash
git push -u origin main --force
```

### Step 1.3 — Deploy to Vercel (10 min, free)
- Go to **vercel.com**, sign in with GitHub
- Click **Add New → Project**
- Pick your `ChessTrophies` repo
- Framework preset: **Other** (it's static)
- Click **Deploy**
- In ~30 seconds you'll have a URL like `chesstrophies-rickdaug.vercel.app`

### Step 1.4 — Connect your domain (15 min)
- In Vercel, go to your project → **Settings → Domains**
- Add `chesstrophies.com`
- Vercel shows you a DNS record to add at Cloudflare/Namecheap
- Paste it in your registrar's DNS dashboard
- Wait 5-30 min for DNS propagation
- Done — `https://chesstrophies.com` now serves your site, with free HTTPS

**You are now live on the web.** Single-device localStorage app, no online play yet, but installable as PWA from any phone.

---

## Phase 2: Real online play (Days 4–10)

**Goal:** Two people on different devices can play a ranked game.

### Step 2.1 — Deploy the backend (1 hour, $5/mo)

The `server/` folder is ready. Pick one:

**Option A: Railway (easiest)**
- Go to **railway.app**, sign in with GitHub
- **New Project → Deploy from GitHub repo**
- Pick your ChessTrophies repo
- Set **Root Directory** to `server`
- Add environment variable: `JWT_SECRET=` then 64 random chars (run `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- Click Deploy
- Railway gives you a URL like `chesstrophies-server-production.up.railway.app`
- Cost: free tier covers light usage, then $5/mo
- Custom domain: `api.chesstrophies.com` → CNAME to the Railway URL

**Option B: Render** — same workflow, set start command to `npm start`. Free tier exists but sleeps after 15 min of inactivity (bad for a chess game). Pay tier: $7/mo.

**Option C: Fly.io** — more setup but always-on for ~$2/mo.

### Step 2.2 — Wire the client to the server (2-4 hours)

You'll need to refactor `app.js` so the existing localStorage-based auth talks to the server. Replace these functions:

```js
// In app.js, REPLACE the local signup/login with server calls

const SERVER_URL = 'https://api.chesstrophies.com';  // your backend URL

async function signup(email, username, password, region) {
  const params = new URLSearchParams(window.location.search);
  const r = await fetch(SERVER_URL + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password, region, invitedBy: params.get('invitedBy') }),
  });
  if (!r.ok) throw new Error((await r.json()).error || 'Signup failed');
  const { token } = await r.json();
  localStorage.setItem('ct_token', token);
  return fetchMe();
}

async function login(email, password) {
  const r = await fetch(SERVER_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error((await r.json()).error || 'Login failed');
  const { token } = await r.json();
  localStorage.setItem('ct_token', token);
  return fetchMe();
}

async function fetchMe() {
  const r = await fetch(SERVER_URL + '/api/me', {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('ct_token') }
  });
  return r.ok ? r.json() : null;
}
```

For real-time play, add Socket.IO client:
```html
<script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
```
And in app.js:
```js
const socket = io(SERVER_URL);
socket.emit('auth', { token: localStorage.getItem('ct_token') });
socket.on('match_found', (game) => { /* start game with real opponent */ });
socket.on('move_made', ({ move }) => { /* sync opponent's move to board */ });
```

The server already handles matchmaking and authoritative move validation. The detailed event protocol is in `server/README.md`.

### Step 2.3 — Test online play
- Open the site on your phone
- Open the site on a friend's phone (different device, different IP)
- Both sign up, both click **Find ranked opponent**
- Server should match you, real-time moves flow both ways

**You now have real multiplayer chess.**

---

## Phase 3: Monetization (Days 11–21)

### Step 3.1 — Privacy Policy & Terms (REQUIRED before ads/payments, 2 hours)
- Use **termly.io** or **iubenda** to generate ($0 free tier, $9/mo paid)
- Cover: what data you collect, how you use it, cookies, ad networks, payment processor, COPPA (no users under 13 or get parental consent), GDPR rights, contact email
- Host at `chesstrophies.com/privacy` and `chesstrophies.com/terms`
- Add links to your app footer (already there as small print, just update)

### Step 3.2 — Real ads via Google AdSense (Week 3, free)

**Google requires real traffic before approval.** Plan:
1. Get the site live and start sharing it (Reddit r/chess, X, friends)
2. Once you have ~100 daily visitors, apply to AdSense at **adsense.google.com**
3. Approval takes 1-14 days
4. Once approved, you'll get an `ca-pub-XXX` ID
5. In `app.js`, find the `renderAdSlot()` function (it has integration comments)
6. Replace the placeholder HTML with:
```html
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-YOUR_ID"
     data-ad-slot="YOUR_SLOT_ID"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
```
7. Add to `index.html` `<head>`:
```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-YOUR_ID" crossorigin="anonymous"></script>
```
8. After each `renderAdSlot()` call, push:
```js
(adsbygoogle = window.adsbygoogle || []).push({});
```

**Revenue expectations:** ~$1–5 per 1000 page views (CPM) is normal for a chess site. So 10K monthly visitors = $10-50/mo.

**Alternatives if AdSense rejects you (small sites often get rejected):**
- **Ezoic** — accepts smaller sites, AI-optimizes ad placement
- **Mediavine** — premium, requires 50K monthly sessions
- **Carbon Ads** — clean, single-sponsor ads for indie/tech sites

### Step 3.3 — Real Premium subscriptions via Stripe (Week 3, 2-4 hours)

1. Create a **Stripe** account at **stripe.com**
2. **Products → Add product** → "ChessTrophies Premium" → $4.99/mo recurring
3. Stripe gives you a `price_XXX` ID
4. Use **Stripe Checkout** (hosted, no PCI compliance needed):

```js
// In app.js, replace setPremium(true) in the buy handler:
async function startPremiumCheckout() {
  const r = await fetch(SERVER_URL + '/api/billing/checkout', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + localStorage.getItem('ct_token') }
  });
  const { url } = await r.json();
  window.location.href = url;  // Stripe-hosted checkout
}
```

5. In `server/`, add a billing route:
```js
// server/billing.js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_KEY);

app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: 'price_XXX', quantity: 1 }],
    customer_email: req.user.email,
    success_url: 'https://chesstrophies.com?premium=success',
    cancel_url: 'https://chesstrophies.com',
    metadata: { userId: req.user.id },
  });
  res.json({ url: session.url });
});

// Webhook: when Stripe confirms payment, flip is_premium
app.post('/api/billing/webhook', express.raw({type:'application/json'}), (req, res) => {
  const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  if (event.type === 'checkout.session.completed') {
    const userId = event.data.object.metadata.userId;
    db.prepare('UPDATE users SET is_premium = 1 WHERE id = ?').run(userId);
  }
  res.json({ received: true });
});
```

6. Add `STRIPE_KEY` and `STRIPE_WEBHOOK_SECRET` to your Railway env vars
7. In Stripe dashboard, set the webhook endpoint to `https://api.chesstrophies.com/api/billing/webhook`

**Stripe takes 2.9% + $0.30 per charge.** Test mode is free unlimited — use it before going live.

---

## Phase 4: Native apps on the stores (Month 2-3)

**Reality check:** The web app is also installable as a PWA already — most users on Android will be happy with that. iOS users still get PWA install but Apple makes it less discoverable. Native apps are a real commitment.

### Step 4.1 — Wrap with Capacitor (1 day)
**Capacitor** wraps your web app as a real native iOS/Android app.

```bash
cd ChessTrophies
npm install -D @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init "ChessTrophies" "com.yourname.chesstrophies"
npx cap add ios
npx cap add android
# Move all your web files into a www/ folder, then:
npx cap sync
npx cap open android  # opens Android Studio
npx cap open ios       # opens Xcode (Mac only)
```

### Step 4.2 — Google Play (Android, $25 one-time)
1. Sign up at **play.google.com/console** ($25 once)
2. Create app listing — screenshots (need 2-8), feature graphic (1024×500), short + long description, category (Games → Board)
3. Generate signed APK/AAB in Android Studio
4. Upload to Internal Testing track first
5. Promote to Production when stable
6. Google review: 1-3 days typically

### Step 4.3 — Apple App Store (iOS, $99/yr)
1. Mac + Xcode required (no way around it for iOS submission)
2. Sign up at **developer.apple.com** ($99/yr)
3. Create App ID in developer portal
4. In App Store Connect: create app listing, screenshots for each device size (6.7", 6.5", 5.5", iPad), description, keywords (huge SEO factor)
5. Archive in Xcode → Upload to App Store Connect
6. Submit for review
7. Apple review: 1-7 days, can reject for many reasons (test thoroughly first)

### Step 4.4 — In-App Purchases (the catch)
**Apple and Google both require their billing for in-app purchases** — you can't use Stripe inside the iOS/Android app. They take **15-30%** of the revenue.

- Use **RevenueCat** (revenuecat.com) — handles both stores' billing with one SDK. Free up to $10K monthly revenue.
- Tag the user's premium status server-side so it works across web (Stripe) and mobile (Apple/Google).
- Web users keep paying via Stripe (lower fee). Mobile users pay via the stores.

### Step 4.5 — AdMob for in-app ads
- Different from AdSense — AdSense is web, AdMob is in-app.
- Sign up at **admob.google.com**, create banner + interstitial ad units
- In Capacitor: `npm install @capacitor-community/admob`
- Replace the placeholder `renderAdSlot()` call in mobile builds with AdMob's `BannerAd.show()`
- AdMob CPMs are typically $1-15 depending on geo/audience

---

## Phase 5: Launch & growth (Ongoing)

### Week 1 of launch
1. Post on **r/chess** (10K+ upvotes possible for novel chess apps if good)
2. Post on **r/chessbeginners**
3. Tweet/X with screenshots and a video clip
4. **Product Hunt** launch (Tuesdays best)
5. Show **Hacker News** (Show HN: ChessTrophies)
6. Tell every chess streamer you can find on X (some will retweet small projects)

### Month 1
1. Watch your analytics — what features do people use? Where do they bounce?
2. Add the daily puzzle (drives retention 30-50%)
3. Get to ~1K daily active users — that's when ads start being interesting
4. Apply to AdSense once you have steady traffic

### Months 2-6
- Add a daily quest system (recommended in our earlier conversation)
- Add tournaments (Swiss / Arena formats)
- Reach out to a streamer for a sponsored stream ($100-500 for someone with 1-5K viewers)
- SEO blog: write articles like "Best Chess Openings for Beginners" pointing back to your app
- Roll out a referral campaign — your Recruiter trophy already builds the framework

---

## Realistic earnings curve

Honest numbers based on similar indie chess/board game apps:

| Month | DAU | Ad revenue | Premium subs | Total monthly |
|---|---|---|---|---|
| 1 | 50 | $5 | 2 ($10) | $15 |
| 3 | 500 | $50 | 25 ($125) | $175 |
| 6 | 2,000 | $200 | 100 ($500) | $700 |
| 12 | 10,000 | $1,500 | 400 ($2,000) | $3,500 |
| 24 | 50,000 | $7,500 | 2,000 ($10,000) | $17,500 |

Most apps don't hit month-24 numbers — but chess has a passionate audience. Achievable with good content, consistent updates, and one viral moment (Reddit hit, streamer feature, news article).

---

## What I'd do differently in your shoes

**Skip native apps initially.** Ship PWA only. PWAs install on Android home screen, on iOS via Safari "Add to Home Screen". Saves $124 + months of store paperwork. Native only when you have proven traction.

**Defer the backend.** Your localStorage MVP is actually fine for the first 30 days of launch. Real users discovering the app will play single-player and academy first. Online play with strangers is a "second-week" feature. So Phase 1 alone (just push to web, $15 + $0/mo) can get you to first revenue.

**Open-source the client.** Slap MIT on it, push to GitHub, post on Reddit. Free marketing, free QA from contributors, and chess players love open-source.

**Best first launch sequence:**
1. Buy domain (day 1)
2. Push to GitHub + Vercel (day 1)
3. Privacy/Terms generated (day 2)
4. Post to r/chess (day 3)
5. Watch what happens, ship the next thing based on feedback

**Total time to "live and making money":** with this plan, you can be live in **3 days** and start generating ad revenue within ~30 days once AdSense approves you.

---

## Things I'd really not skip

- **Privacy policy + Terms** — Stripe, Apple, and Google all reject apps without them
- **A real email address** at your domain — `support@chesstrophies.com` — Google AdSense and others need this
- **Analytics** — add **Plausible** ($9/mo, privacy-friendly) or **Cloudflare Web Analytics** (free). Without metrics you're flying blind
- **Backups** — Railway/Render don't snapshot SQLite by default. Set up a daily backup to S3 (~$1/mo) or use Litestream
- **One-line `console.error → server` reporter** — bugs you'll never see otherwise. **Sentry** has a free tier
- **Email password reset flow** — your current implementation has no way to recover a forgotten password. Add `/api/auth/forgot` with a magic-link email via **Resend** (free for 3K emails/mo) or **Postmark**

---

## When you're ready, in order

1. Buy a domain
2. Push the current code to GitHub
3. Deploy to Vercel
4. Generate privacy/terms, host them
5. Soft-launch to friends + chess communities
6. Add the backend when you have demand for online play
7. Add Stripe + AdSense once you have traffic
8. Add native apps only when web is profitable

Each step is small, none are blocked on the next. **Start with step 1 this week.**
