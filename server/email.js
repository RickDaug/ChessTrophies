// Outbound email helpers.
//
// Used for password-reset and email-verification links. Sending is best-effort:
// if no provider is configured (RESEND_API_KEY unset) it is a no-op, and any
// failure is swallowed (logged via console.warn) so the auth flow never breaks
// on email.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// True when an email provider is configured. Used for a startup diagnostic so
// it's obvious in the logs whether verification/reset emails will actually send.
export function isEmailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

// Low-level Resend send. Returns true on success, false if email is not
// configured or sending failed. Never throws.
async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false; // No provider configured -> no-op.
  const from = process.env.RESEND_FROM || 'ChessTrophies <onboarding@resend.dev>';
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[email] Resend responded', res.status, detail.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
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
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const cta = appUrl ? `Play now: ${appUrl}` : 'Open ChessTrophies and play a game.';
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
  const text =
    `${lead}\n\n` +
    `${cta}\n\n` +
    `You're getting this because you turned on ChessTrophies updates. You can stop these anytime from your profile.`;
  return sendEmail({ to: email, subject: `ChessTrophies — ${subject}`, text });
}
