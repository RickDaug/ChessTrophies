#!/usr/bin/env node
/*
 * cleanup-test-users.mjs — find + (optionally) HARD-DELETE test accounts in prod.
 *
 * SAFE BY DEFAULT: it only flags accounts whose email matches a KNOWN TEST
 * pattern (below). Anything else — real domains, gmail, anything unrecognized —
 * is KEPT and never touched. It also previews every deletion (dry run) before it
 * removes anything, and requires an explicit --confirm flag to actually delete.
 *
 * Uses the ADMIN_KEY-gated endpoints, so the deletion goes through the tested
 * adminDeleteUserHard path (removes the user + all referencing rows across ~20
 * tables). Requires PR #35 to be deployed.
 *
 * USAGE (run from anywhere with Node 18+):
 *   ADMIN_KEY=xxxx API=https://chesstrophies-production.up.railway.app \
 *     node scripts/cleanup-test-users.mjs            # LIST candidates only (no changes)
 *   ADMIN_KEY=xxxx ... node scripts/cleanup-test-users.mjs --dry-run   # per-account dry-run counts
 *   ADMIN_KEY=xxxx ... node scripts/cleanup-test-users.mjs --confirm   # ACTUALLY delete (irreversible)
 *
 * Add KEEP=id1,id2 or KEEPEMAIL=a@b.com,c@d.com to force-keep specific accounts.
 */
const API = (process.env.API || 'https://chesstrophies-production.up.railway.app').replace(/\/+$/, '');
const KEY = process.env.ADMIN_KEY || '';
const CONFIRM = process.argv.includes('--confirm');
const DRY = process.argv.includes('--dry-run');
const keepIds = new Set((process.env.KEEP || '').split(',').map(s => s.trim()).filter(Boolean));
const keepEmails = new Set((process.env.KEEPEMAIL || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));

// A user is a deletion candidate ONLY if its email matches one of these. Keep
// this list tight — default behavior is to KEEP anything unrecognized.
const TEST_EMAIL = [/@ex\.com$/i, /@example\.com$/i, /@ctmail\.test$/i, /@x\.io$/i, /@.*\.test$/i, /@test\./i];
function isTest(email) {
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  if (e.endsWith('@gmail.com')) return false;      // never auto-delete real mail providers
  return TEST_EMAIL.some(rx => rx.test(e));
}

if (!KEY) { console.error('Set ADMIN_KEY env var.'); process.exit(2); }
const H = { 'x-admin-key': KEY };

async function main() {
  const res = await fetch(`${API}/api/admin/users?limit=1000`, { headers: H });
  if (!res.ok) { console.error('list failed:', res.status, await res.text()); process.exit(1); }
  const data = await res.json();
  const users = data.users || data || [];
  const candidates = users.filter(u => isTest(u.email) && !keepIds.has(u.id) && !keepEmails.has(String(u.email).toLowerCase()));
  const kept = users.length - candidates.length;

  console.log(`\n${users.length} users total — ${candidates.length} test candidates, ${kept} kept.\n`);
  console.log('CANDIDATES FOR DELETION:');
  for (const u of candidates) console.log(`  ${u.id}  ${u.username}  <${u.email}>  games=${u.games ?? '?'}`);
  console.log('\nKEPT (sample of non-candidates):');
  for (const u of users.filter(u => !candidates.includes(u)).slice(0, 20)) console.log(`  KEEP  ${u.username}  <${u.email}>`);

  if (!DRY && !CONFIRM) { console.log('\n(LIST ONLY. Re-run with --dry-run for per-account counts, or --confirm to delete.)'); return; }

  let totalUsers = 0, errors = 0;
  for (const u of candidates) {
    const url = `${API}/api/admin/user/${encodeURIComponent(u.id)}${CONFIRM ? '' : '?dryRun=1'}`;
    const r = await fetch(url, { method: 'DELETE', headers: H });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { errors++; console.log(`  ERR ${u.username}: ${r.status}`); continue; }
    const counts = CONFIRM ? j.deleted : j.counts;
    totalUsers += (counts && counts.users) || 0;
    console.log(`  ${CONFIRM ? 'DELETED' : 'would delete'} ${u.username} <${u.email}> :: ${JSON.stringify(counts)}`);
  }
  console.log(`\n${CONFIRM ? 'DELETED' : 'WOULD DELETE'} ${totalUsers} user rows (${errors} errors).`);
  if (!CONFIRM) console.log('Re-run with --confirm to actually delete. THIS IS IRREVERSIBLE — snapshot the DB first.');
}
main().catch(e => { console.error(e); process.exit(1); });
