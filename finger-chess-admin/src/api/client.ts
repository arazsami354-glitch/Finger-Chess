import axios from 'axios';

/**
 * SECURITY (OWASP A07 / A03 hardening): matches the same fix applied to
 * the player frontend. The access token now lives ONLY in this in-memory
 * module variable — never localStorage. The refresh token lives in an
 * httpOnly cookie set by the backend, invisible to JavaScript entirely.
 * Admin accounts are a higher-value target than a typical player account
 * (they can ban users, review withdrawals, approve KYC), so this
 * hardening matters at least as much here as on the player app.
 */
let accessToken: string | null = null;

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// On a 401, try one silent refresh before giving up and forcing a re-login —
// an admin mid-review shouldn't lose their place over an expired 15-minute
// access token.
let refreshPromise: Promise<string | null> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retried) {
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

/** Kept for compatibility with existing call sites — the refresh-token argument is now ignored, since it's never available to JavaScript to pass in the first place. */
export function setTokens(newAccessToken: string, _refreshTokenIgnored?: string) {
  setAccessToken(newAccessToken);
}

export function clearTokens() {
  accessToken = null;
}

export function getAccessToken() {
  return accessToken;
}
