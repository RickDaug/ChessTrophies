# Changelog

## 2026-05-28 — Truncation repair and hardening pass

This release repaired the truncated `index.html` shell, restored the required client script order, added CSP and SRI protections, and hardened the auth and server layers against XSS, brute-force, account-enumeration, and CORS/JWT misconfiguration risks.

### Post-mortem
The `index.html` truncation was committed in the current checkout without a final verification step. The file ended in the middle of a fallback string and lacked the required script tags, service-worker wiring, and closing body/html tags. The repair pass now verifies the shell structure and script references before any release.

## Conventions
- Use one logical change per commit.
- Verify `index.html`, auth flows, and backend startup before pushing.
- Update `SECURITY.md` and this changelog whenever control changes are made.
