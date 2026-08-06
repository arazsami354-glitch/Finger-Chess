import axios from 'axios';

/**
 * SECURITY (OWASP A07 / A03 hardening): the access token now lives ONLY in
 * this in-memory module variable — never localStorage, never a
 * JS-readable cookie. The refresh token lives in an httpOnly cookie set
 * by the backend (see auth.controller.ts's `issueTokens`), which
 * JavaScript cannot read under any circumstances, including a successful
 * XSS payload.
 *
 * The tradeoff, stated plainly: an in-memory value is lost on every hard
 * page reload. That's a deliberate, correct tradeoff — the bootstrap
 * effect below (and every 401 response) transparently re-establishes a
 * fresh access token via the httpOnly-cookie-backed `/auth/refresh` call,
 * so the user experience is unaffected, but a stolen access token is
 * short-lived (15 minutes) and an XSS payload can no longer walk away
 * with a long-lived refresh token that grants it a persistent, renewable
 * foothold on the account.
 */
let accessToken: string | null = null;

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retried && typeof window !== 'undefined') {
      original._retried = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      clearTokens();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        // No body needed — the refresh token travels as the httpOnly
        // cookie, attached automatically by the browser because this
        // axios instance is configured with withCredentials: true.
        const { data } = await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });
        setAccessToken(data.accessToken);
        return data.accessToken as string;
      } catch {
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

export function setAccessToken(token: string) {
  accessToken = token;
}

/** Kept for compatibility with existing call sites — the refresh token argument is now ignored entirely, since it's never available to JavaScript to pass in the first place. */
export function setTokens(newAccessToken: string, _refreshTokenIgnored?: string) {
  setAccessToken(newAccessToken);
}

export function clearTokens() {
  accessToken = null;
}

export function getAccessToken() {
  return accessToken;
}
