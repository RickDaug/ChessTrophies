// Web Push re-engagement notifications (VAPID).
//
// Fully env-gated, exactly like billing.js / email.js: the feature is OFF and
// every route is inert until ALL THREE of VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// and VAPID_SUBJECT are set. When unconfigured the module logs a warning at
// boot and the endpoints report disabled / no-op, without ever touching the
// web-push driver.
//
// Env vars (all optional):
//   VAPID_PUBLIC_KEY   — the VAPID application server public key (base64url).
//                        Also handed to the client so it can subscribe.
//   VAPID_PRIVATE_KEY  — the matching private key (server-only, never exposed).
//   VAPID_SUBJECT      — a mailto: or https: contact URI required by the spec,
//                        e.g. "mailto:support@playchesstrophies.com".
//
// Generate a keypair with:  npx web-push generate-vapid-keys
//
// IMPORTANT: the `web-push` SDK is imported LAZILY (inside a try/catch) so the
// server boots fine even before `npm i web-push` has run (the dependency was
// just added to package.json) and so the driver is never loaded when push is
// unconfigured. Cached after first successful construction. Nothing here ever
// throws to the caller — sendPushToUser resolves to a no-op when disabled.

import { requireAuth } from './auth.js';
import * as store from './store.js';

// Cached lazy-loaded web-push module + a flag so we only attempt the import once.
let webpushMod = null;
let webpushLoadFailed = false;
let vapidConfigured = false; // memo: have we already called setVapidDetails?

// True only when ALL THREE VAPID env vars are present. Read live so a deploy can
// flip it without code changes.
export function pushEnabled() {
  return !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}

// Lazily import + configure the web-push driver. Returns the module, or null
// when push is unconfigured or the SDK can't be loaded. Never throws.
async function getWebPush() {
  if (!pushEnabled()) return null;
  if (webpushLoadFailed) return null;
  if (!webpushMod) {
    try {
      const mod = await import('web-push');
      webpushMod = mod.default || mod;
    } catch (e) {
      webpushLoadFailed = true;
      console.error('[push] failed to load the web-push SDK (run `npm i web-push`):', e && e.message ? e.message : e);
      return null;
    }
  }
  if (!vapidConfigured) {
    try {
      webpushMod.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
      vapidConfigured = true;
    } catch (e) {
      console.error('[push] setVapidDetails failed (bad VAPID keys/subject?):', e && e.message ? e.message : e);
      return null;
    }
  }
  return webpushMod;
}

// Send a push notification to every subscription a user has. Lazy-imports + sets
// VAPID details from env, then sends to all the user's subs. On a 404/410 (the
// subscription is Gone) the dead sub is pruned. Resolves to a no-op when push is
// disabled, the user has no subs, or the SDK is unavailable. NEVER throws.
// Returns { sent, pruned, disabled } so callers/tests can inspect the outcome.
export async function sendPushToUser(userId, { title, body, url, tag } = {}) {
  if (!pushEnabled()) return { sent: 0, pruned: 0, disabled: true };
  let subs = [];
  try {
    subs = await store.listPushSubs(userId);
  } catch (e) {
    console.error('[push] listPushSubs failed:', e && e.message ? e.message : e);
    return { sent: 0, pruned: 0, disabled: false };
  }
  if (!subs || subs.length === 0) return { sent: 0, pruned: 0, disabled: false };

  const webpush = await getWebPush();
  if (!webpush) return { sent: 0, pruned: 0, disabled: true };

  const payload = JSON.stringify({
    title: title || 'ChessTrophies',
    body: body || '',
    url: url || '/',
    tag: tag || 'chesstrophies',
  });

  let sent = 0, pruned = 0;
  await Promise.all(subs.map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch (e) {
      const code = e && (e.statusCode || e.status);
      // 404 (Not Found) / 410 (Gone) = the subscription is permanently dead;
      // prune it so we stop trying. Other errors are transient — leave the sub.
      if (code === 404 || code === 410) {
        try { await store.removeDeadSub(s.endpoint); pruned++; } catch (e2) {}
      } else {
        console.warn('[push] send failed:', code || (e && e.message) || e);
      }
    }
  }));
  return { sent, pruned, disabled: false };
}

// Register the JSON push routes. Run AFTER express.json() in server.js so
// req.body is parsed normally. All routes are inert (report disabled / no-op)
// until the VAPID env vars are set; subscribe/unsubscribe/test require auth.
export function mountPush(app) {
  // PUBLIC: lets the client decide whether to offer the notify prompt + hands it
  // the VAPID public key it needs to subscribe. Reports disabled when unset.
  app.get('/api/push/config', (req, res) => {
    res.json({
      enabled: pushEnabled(),
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
    });
  });

  // AUTH: store this device's push subscription for the signed-in user.
  // Idempotent on endpoint (a re-subscribe upserts the row).
  app.post('/api/push/subscribe', requireAuth, async (req, res) => {
    if (!pushEnabled()) return res.status(503).json({ error: 'Push is not configured yet.' });
    try {
      const sub = (req.body && req.body.subscription) || req.body || {};
      const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint.trim() : '';
      const keys = sub.keys || {};
      const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
      const auth = typeof keys.auth === 'string' ? keys.auth : '';
      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ error: 'A valid push subscription (endpoint + keys) is required.' });
      }
      if (endpoint.length > 1024) return res.status(400).json({ error: 'Endpoint too long.' });
      await store.addPushSub({ userId: req.userId, endpoint, p256dh, auth });
      res.json({ ok: true });
    } catch (e) {
      console.error('[push] subscribe failed:', e && e.message ? e.message : e);
      res.status(500).json({ error: 'Could not save your subscription. Please try again.' });
    }
  });

  // AUTH: remove this device's subscription (by endpoint) for the signed-in user.
  app.post('/api/push/unsubscribe', requireAuth, async (req, res) => {
    if (!pushEnabled()) return res.status(503).json({ error: 'Push is not configured yet.' });
    try {
      const endpoint = typeof (req.body && req.body.endpoint) === 'string' ? req.body.endpoint.trim() : '';
      if (!endpoint) return res.status(400).json({ error: 'An endpoint is required.' });
      await store.removePushSub(req.userId, endpoint);
      res.json({ ok: true });
    } catch (e) {
      console.error('[push] unsubscribe failed:', e && e.message ? e.message : e);
      res.status(500).json({ error: 'Could not remove your subscription. Please try again.' });
    }
  });

  // AUTH: send a test push to the caller's OWN subscriptions (verification).
  app.post('/api/push/test', requireAuth, async (req, res) => {
    if (!pushEnabled()) return res.status(503).json({ error: 'Push is not configured yet.' });
    try {
      const r = await sendPushToUser(req.userId, {
        title: 'ChessTrophies',
        body: 'Push notifications are working. See you on the board! ♟',
        url: '/',
        tag: 'ct-test',
      });
      res.json({ ok: true, ...r });
    } catch (e) {
      console.error('[push] test failed:', e && e.message ? e.message : e);
      res.status(500).json({ error: 'Could not send the test notification.' });
    }
  });
}

// Startup diagnostic (mirrors logBillingStatus): make the push state obvious in
// the logs so it's clear at boot whether re-engagement notifications will send.
export function logPushStatus() {
  if (pushEnabled()) {
    console.log('[push] VAPID configured — Web Push re-engagement is ENABLED. Subject: ' + process.env.VAPID_SUBJECT);
  } else {
    console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT not all set — Web Push is DISABLED (all /api/push/* routes inert). Generate keys with `npx web-push generate-vapid-keys`.');
  }
}
