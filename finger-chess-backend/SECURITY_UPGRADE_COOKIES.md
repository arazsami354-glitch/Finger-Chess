# Security Upgrade — Secure Cookies & Auth Hardening

## The one item on this list that was a genuine, significant gap

**Both the access AND refresh tokens lived in `localStorage`**, on both frontends — fully readable
by any JavaScript running on the page. This is a well-known, real OWASP A07 (Identification and
Authentication Failures) weakness: a single successful XSS bug (A03) anywhere on the page — a
missed sanitization edge case, a compromised third-party script — becomes full, *persistent*
account takeover, not a contained incident, because the long-lived refresh token lets an attacker
mint new access tokens indefinitely even after the original XSS payload is gone.

### What changed
- **Refresh token → httpOnly cookie.** Set by the backend (`AuthController.issueTokens`), never
  appears in a JSON response body, never touched by frontend JavaScript. `SameSite: 'strict'`
  (safe here specifically because refresh is only ever called via same-origin fetch, never a
  cross-site navigation or form submission), `Secure` in production, and scoped to `/api/v1/auth`
  so it's never even sent to unrelated endpoints.
- **Access token → in-memory only**, on both frontends. Lost on a hard page reload — which is the
  correct, deliberate tradeoff: the app now performs a silent, cookie-backed refresh on bootstrap
  instead. A stolen access token (if an XSS payload manages to read it from memory while active)
  is short-lived (15 minutes) and grants no persistent foothold, unlike the refresh token it can no
  longer reach at all.
- **OAuth callback flow updated for consistency** — it previously put *both* tokens in the URL
  fragment, which would have been a live bypass of the entire cookie migration if left alone (an
  attacker could just use the OAuth path to grab a persistent refresh token via browser history).
  Now sets the same httpOnly cookie as every other login path; only the access token — short-lived,
  much lower value — goes in the fragment.
- **CSRF protection is now a real, active mechanism**, not a moot point. Previously "structurally
  mitigated" simply because no cookies existed for auth; now that a cookie carries real
  authentication weight, `SameSite=Strict` is the actual defense, and it's a defense that matters
  now in a way it didn't before this change.

## Two real bugs caught while building this, not after

1. **Logout never called the backend.** It only cleared client-side state. With the refresh token
   now in an httpOnly cookie — which client JavaScript cannot clear on its own, by design — this
   meant a "logged out" session's cookie and its server-side session record would have silently
   remained fully valid, capable of minting new access tokens indefinitely. Fixed on both
   frontends: `logout()` now calls `POST /auth/logout`, which both revokes the session server-side
   and clears the cookie via `res.clearCookie()`.
2. **The auth bootstrap effect assumed "no access token = logged out."** That was true when tokens
   lived in localStorage (persisted across reloads); it's actively wrong now that the access token
   is deliberately in-memory-only (always empty immediately after any page reload). Left unfixed,
   this would have logged every real, valid session out on every browser refresh. Fixed on both
   frontends to attempt a silent cookie-backed refresh first, only concluding "logged out" if that
   genuinely fails.

Both were caught by walking the actual flow end-to-end after the cookie change, not assumed safe
because the individual pieces compiled.

## What was already real and verified, not rebuilt

Everything else on the list was already substantial, working infrastructure from earlier passes —
verified this session rather than redone:
- **Rate limiting**: `ThrottlerModule` + per-endpoint `@Throttle()` limits throughout, plus a
  dedicated WebSocket token-bucket limiter for every gateway event handler.
- **2FA**: real TOTP, server-side secret storage (fixed from an earlier client-trusted-secret bug),
  hashed backup codes.
- **Session management / device sessions**: the `Session` model already tracks device label,
  device fingerprint, IP, user agent, and trusted-device status — a real device-sessions list, not
  just opaque tokens.
- **SQL injection**: Prisma's parameterized queries throughout — no raw string-concatenated SQL
  anywhere in the codebase.
- **Audit logs**: `AdminAuditService` — one shared write path every admin controller uses, so
  there's exactly one code path that produces an audit entry, not one per controller to keep in sync.
- **Encryption**: argon2 password hashing, AES-256-GCM for message content at rest, hashed 2FA
  backup codes and refresh tokens (never stored in plaintext).
- **Password policy**: complexity requirements (upper/lower/number, 8+ chars) plus a 72-character
  cap — the bcrypt/argon2 input-length limit, protecting against a password-length DoS vector.
- **Email verification**: real token dispatch and verification flow.
- **Security headers**: `helmet` with an explicit CSP, not the permissive default.

## Verified, not asserted

`tsc --noEmit` clean on all three projects after every change, including a full sweep for any
remaining `.refreshToken` reference across both frontends (all four found were passed into a
deliberately-ignored compatibility parameter, confirmed harmless) and any remaining
`getRefreshToken()` call site (none — safe to remove the function entirely). The now-fully-unused
`RefreshTokenDto` was deleted rather than left as dead code.
