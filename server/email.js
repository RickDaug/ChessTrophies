// Outbound email helpers.
//
// Currently used only for password-reset links. Sending is best-effort: if no
// provider is configured (RESEND_API_KEY unset) it is a no-op, and any failure
// is swallowed (logged via console.warn) so the auth flow never breaks on email.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Send a password-reset email via Resend. Returns true if an email was sent,
// false if email is not configured or sending failed. Never throws.
export async function sendResetEmail(email, token) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false; // No provider configured -> no-op.

  const from = process.env.RESEND_FROM || 'ChessTrophies <onboarding@resend.dev>';
  const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const resetLine = appUrl
    ? `Reset your password: ${appUrl}/reset?token=${encodeURIComponent(token)}`
    : `Your password reset code is: ${token}`;

  const text =
    `We received a request to reset your ChessTrophies password.\n\n` +
    `${resetLine}\n\n` +
    `This link/code expires in 30 minutes. If you didn't request this, you can ignore this email.`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Reset your ChessTrophies password',
        text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[email] Resend responded', res.status, detail.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[email] failed to send reset email:', e && e.message ? e.message : e);
    return false;
  }
}
