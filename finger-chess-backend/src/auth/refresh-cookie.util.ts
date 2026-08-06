import { CookieOptions } from 'express';

export const REFRESH_COOKIE_NAME = 'fc_refresh_token';

/** Parses simple duration strings ('7d', '15m', '1h', '30s') into milliseconds — matches the format already used by FINGER_CHESS_JWT_REFRESH_EXPIRES_IN, without pulling in a new dependency for one small conversion. */
export function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // a safe, explicit fallback rather than throwing on an unexpected config value
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return value * unitMs;
}

/**
 * The refresh token moved here (httpOnly cookie) specifically because it
 * was previously stored in localStorage, fully readable by any JavaScript
 * running on the page — meaning a single successful XSS bug (OWASP A03)
 * turned into full, PERSISTENT account takeover (the refresh token is
 * long-lived; stealing it doesn't just hijack one session, it lets an
 * attacker mint new access tokens indefinitely). An httpOnly cookie is
 * simply never exposed to `document.cookie` or any JS API at all — an XSS
 * payload cannot read it no matter what it does.
 *
 * `sameSite: 'strict'` is safe here specifically because the refresh
 * endpoint is only ever called via same-origin `fetch`/XHR from the app
 * itself, never as a result of following a link or a cross-site form
 * submission — Strict is the most protective SameSite setting and there's
 * no legitimate cross-site flow this would break.
 *
 * `path` scopes the cookie so the browser only ever attaches it to auth
 * endpoints, not every request to the API — a real reduction in exposure
 * (a CSRF-adjacent bug or an accidental cross-endpoint log leak elsewhere
 * on the API simply never sees this cookie at all).
 */
export function refreshCookieOptions(maxAgeMs: number, isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction, // 'false' in local dev only because browsers refuse Secure cookies over plain http — real deployments are always https
    sameSite: 'strict',
    path: '/api/v1/auth',
    maxAge: maxAgeMs,
  };
}
