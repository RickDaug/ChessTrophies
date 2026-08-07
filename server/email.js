// Outbound email helpers.
//
// Used for password-reset and email-verification links. Sending is best-effort:
// if no provider is configured (RESEND_API_KEY unset) it is a no-op, and any
// failure is swallowed (logged via console.warn) so the auth flow never breaks
// on email.

import * as store from './store.js';
import { makeUnsubscribeToken } from './auth.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// AUDIT 2026-07 (S2): the send had NO timeout, so a hung Resend endpoint parked
// the signup / password-reset handler on an open socket for Node's default
// ~300s. Mirrors the bound used by the /api/translate proxy in server.js.
const SEND_TIMEOUT_MS = 8000;

// CAN-SPAM: commercial (re-engagement) mail must carry a valid physical postal
// address. Configured via MAILING_ADDRESS; when unset the block degrades to a
// generic line rather than printing a broken/empty address.
function postalAddress() {
  const addr = (process.env.MAILING_ADDRESS || '').trim();
  return addr || null;
}

// True when an email provider is configured. Used for a startup diagnostic so
// it's obvious in the logs whether verification/reset emails will actually send.
export function isEmailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

// Low-level Resend send. Returns true on success, false if email is not
// configured or sending failed. Never throws.
async function sendEmail({ to, subject, text, headers }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false; // No provider configured -> no-op.
  const from = process.env.RESEND_FROM || 'ChessTrophies <onboarding@resend.dev>';
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, ...(headers ? { headers } : {}) }),
      // Bounded: never let a wedged provider stall the calling auth handler.
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[email] Resend responded', res.status, detail.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    // AbortSignal.timeout rejects with a TimeoutError DOMException; treat it like
    // any other send failure (log + return false) so the caller never throws.
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      console.warn(`[email] send to Resend timed out after ${SEND_TIMEOUT_MS}ms — giving up (not retried).`);
      return false;
    }
    console.warn('[email] failed to send:', e && e.message ? e.message : e);
    return false;
  }
}

// Send an email-verification email with the 6-digit code. Best-effort; never throws.
export async function sendVerifyEmail(email, code) {
  if (!process.env.RESEND_API_KEY) return false;
  const text =
    `Welcome to ChessTrophies! Enter this code in the app to verify your email:\n\n` +
    `    ${code}\n\n` +
    `This code expires in 1 hour. If you didn't create this account, you can ignore this email.`;
  return sendEmail({ to: email, subject: `Your ChessTrophies code: ${code}`, text });
}

// Send a password-reset email via Resend. Returns true if an email was sent,
// false if email is not configured or sending failed. Never throws.
export async function sendResetEmail(email, token) {
  if (!process.env.RESEND_API_KEY) return false; // No provider configured -> no-op.
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const resetLine = appUrl
    ? `Reset your password: ${appUrl}/reset?token=${encodeURIComponent(token)}`
    : `Your password reset code is: ${token}`;
  const text =
    `We received a request to reset your ChessTrophies password.\n\n` +
    `${resetLine}\n\n` +
    `This link/code expires in 30 minutes. If you didn't request this, you can ignore this email.`;
  return sendEmail({ to: email, subject: 'Reset your ChessTrophies password', text });
}

// Re-engagement / comeback email. Sent by the reengage scheduler to a user we
// can't reach via push (no subscription) but who has a VERIFIED email. `reason`
// is one of the reengage reasons ('streak_at_risk' | 'inactive_d1/d3/d7') and
// picks the copy. Best-effort; returns false (never throws) when email is not
// configured or sending failed. Mirrors the other senders' no-op contract.
export async function sendComebackEmail(email, reason) {
  if (!process.env.RESEND_API_KEY) return false; // No provider configured -> no-op.

  // CAN-SPAM (audit 2026-07, S3): this is COMMERCIAL mail, so it needs a working
  // one-click opt-out and a postal address, and we must not mail anyone who has
  // already opted out. Resolve the recipient so we can (a) honour an existing
  // opt-out and (b) mint their unsubscribe token. FAIL CLOSED: if we can't tell
  // whether they opted out, we don't send — skipping a nudge is cheap, mailing an
  // unsubscribed person is not.
  let user;
  try {
    user = await store.get('SELECT id, flags FROM users WHERE email = ?', [String(email || '').toLowerCase()]);
  } catch (e) {
    console.warn('[email] comeback opt-out lookup failed; skipping send:', e && e.message ? e.message : e);
    return false;
  }
  if (!user || !user.id) return false;
  if (emailOptedOut(user)) return false;

  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const cta = appUrl ? `Play now: ${appUrl}` : 'Open ChessTrophies and play a game.';
  const unsubUrl = unsubscribeUrl(appUrl, user.id);
  let subject, lead;
  switch (reason) {
    case 'streak_at_risk':
      subject = 'Keep your ChessTrophies streak alive!';
      lead = "Your daily streak is about to break — solve today's puzzle to keep it going.";
      break;
    case 'inactive_d1':
      subject = 'Your board is waiting';
      lead = 'A quick game or daily puzzle is one click away. Come back and play!';
      break;
    case 'inactive_d3':
      subject = 'We miss you at the board';
      lead = "It's been a few days — jump back in for a game or the daily puzzle.";
      break;
    case 'inactive_d7':
    default:
      subject = 'Ready for a comeback?';
      lead = 'Your rivals have been busy. Come back, play a game, and climb the board again.';
      break;
  }
  const unsubLine = unsubUrl
    ? `Unsubscribe from these emails (one click, no sign-in needed):\n${unsubUrl}`
    : `You can stop these anytime from your profile settings.`;
  const addr = postalAddress();
  const text =
    `${lead}\n\n` +
    `${cta}\n\n` +
    `---\n` +
    `You're getting this because you created a ChessTrophies account and verified this email address.\n\n` +
    `${unsubLine}\n` +
    (addr ? `\nChessTrophies — ${addr}\n` : '');
  // RFC 8058 / RFC 2369 one-click unsubscribe so mail clients can surface a
  // native "Unsubscribe" button. Only set when we actually have a URL.
  const headers = unsubUrl
    ? { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    : undefined;
  return sendEmail({ to: email, subject: `ChessTrophies — ${subject}`, text, headers });
}

// --- Unsubscribe plumbing ---------------------------------------------------

// True when this user has opted out of re-engagement email. Stored as
// `emailOptOut: true` inside the existing users.flags JSON blob (no new column,
// so db.js / db-pg.js stay at parity). Unparseable flags => treated as opted out
// (fail closed).
export function emailOptedOut(user) {
  if (!user) return true;
  try {
    const flags = user.flags ? JSON.parse(user.flags) : {};
    return !!(flags && typeof flags === 'object' && flags.emailOptOut);
  } catch (e) { return true; }
}

// Absolute base URL of THIS API server. The unsubscribe route is served by
// Express (Railway), not by the static client (Vercel/APP_URL), so it needs its
// own base. Order: API_URL, then Railway's injected public domain, then APP_URL
// as a last resort (correct only for a single-origin deploy).
function apiBaseUrl(appUrl) {
  const explicit = (process.env.API_URL || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const railway = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (railway) return `https://${railway}`;
  return appUrl || '';
}

// Build the tokenized unsubscribe URL for a user. Returns null when no absolute
// base URL is configured — the caller then falls back to the "manage it in your
// profile" line.
export function unsubscribeUrl(appUrl, userId) {
  const base = apiBaseUrl(appUrl);
  if (!base || !userId) return null;
  const token = makeUnsubscribeToken(userId);
  if (!token) return null;
  return `${base}/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
