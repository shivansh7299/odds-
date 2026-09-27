# Security review checklist

Reviewed at Milestone 8. ✓ = implemented and covered by tests where noted.

## Authentication & sessions
- ✓ Better Auth email/password; passwords hashed (scrypt); 8–128 chars (`tests/integration/auth.test.ts`).
- ✓ DB-backed sessions in httpOnly, SameSite=Lax cookies (Secure when served over HTTPS); 7-day sliding expiry.
- ✓ Sign-in/sign-up rate limited (5/min per endpoint).
- ✓ Post-login redirects restricted to same-origin paths (`safeRedirectPath`, unit-tested).
- ✓ `proxy.ts` is only an optimistic redirect; every page layout and API route re-verifies the session.
- ✓ Account deletion requires the current password and cascades all data.

## Authorization & data isolation
- ✓ Every query filters by the session's `userId`; a user can't read, delete or revoke another user's
  data or devices (`dashboard-api`, `fit-import`, `connectiq` tests).
- ✓ Watch tokens: `vs_` + 256-bit random; only SHA-256 stored; revocable instantly; issued exactly once.
- ✓ Pairing codes: 8 chars from a 31-symbol alphabet, 10-min TTL, approve rate-limited per user
  (10/min), start/poll rate-limited per IP, single use (conditional update against races).

## Input handling
- ✓ Zod validation on every API input, env var and adapter output; physiological range checks.
- ✓ Body size caps: JSON 64 KB (ingest) / 2 KB (pairing); uploads 25 MB (.fit) / 250 MB (.zip).
- ✓ Zip-bomb limits: declared-size check before inflating, 50 MB per entry, 1 GB total, 50k entries,
  nesting depth 3.
- ✓ Upload files are stored under generated ids (no user-controlled paths) and deleted after import.
- ✓ Timestamps outside accepted windows (future/too old) are rejected as replay or skew.
- ✓ Raw SQL uses tagged-template parameters only (no string interpolation of input).

## Transport & browser
- ✓ CSP (`default-src 'self'`, no framing, no plugins), `nosniff`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy` (Bluetooth self only); HSTS + upgrade-insecure-requests when served over HTTPS.
- ✓ Cross-origin state-changing requests with a foreign `Origin` are rejected (403), on top of SameSite cookies.
- ✓ `Cache-Control: no-store` on all API responses (health data).

## Secrets & logging
- ✓ Secrets only from env (validated); `.env*` git-ignored; CI generates throwaway secrets.
- ✓ Third-party tokens (future pull sources) encrypted with AES-256-GCM and versioned keys.
- ✓ Structured logs exclude tokens and health values; errors to clients are generic (500) or explicit
  `AppError`s only.

## Known limitations / follow-ups
- Rate limiters are in-memory per instance. Move them to Postgres/Redis before scaling out web replicas.
- CSP allows `'unsafe-inline'` scripts (Next.js bootstrap without nonces). Switch to nonce-based CSP in
  `proxy.ts` if you need a stricter policy (this forces dynamic rendering).
- No email verification or password reset yet (needs an email provider).
- Watch tokens don't expire; they're revocable. Consider rotation on re-pair or a 1-year expiry.
