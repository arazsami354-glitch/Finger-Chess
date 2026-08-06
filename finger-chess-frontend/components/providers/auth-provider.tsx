'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api, clearTokens, getAccessToken, refreshAccessToken, setTokens } from '@/lib/api';
import { collectAndSubmitFingerprint } from '@/lib/fingerprint';

export interface CurrentUser {
  id: string;
  email: string;
  fullName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  countryCode?: string | null;
  kycStatus: string;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  role: string;
  createdAt: string;
}

interface WalletBalance {
  available: number;
  locked: number;
  pending: number;
  currency: string;
  total: number;
  lifetimeEarnings: number;
}

interface AuthContextValue {
  user: CurrentUser | null;
  wallet: WalletBalance | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ requiresTwoFactor: boolean; twoFactorSessionToken?: string }>;
  completeTwoFactorLogin: (twoFactorSessionToken: string, code: string) => Promise<void>;
  register: (email: string, password: string, options?: { fullName?: string; dateOfBirth?: string; countryCode?: string; preferredIdType?: string }) => Promise<void>;
  logout: () => void;
  refreshWallet: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const { data } = await api.get('/users/me');
    setUser(data);
  }, []);

  const refreshWallet = useCallback(async () => {
    try {
      const { data } = await api.get('/wallet/balance');
      setWallet(data);
    } catch {
      // Wallet may not be reachable during initial auth bootstrap — non-fatal.
    }
  }, []);

  useEffect(() => {
    async function bootstrap() {
      let token = getAccessToken();
      if (!token) {
        // No in-memory access token doesn't mean "logged out" — it's the
        // expected state on every fresh page load, since the access token
        // deliberately isn't persisted anywhere client-readable. Attempt a
        // silent refresh via the httpOnly cookie before concluding there's
        // no session at all.
        token = await refreshAccessToken();
      }
      if (!token) {
        setLoading(false);
        return;
      }
      await Promise.all([refreshUser(), refreshWallet()])
        .catch(() => clearTokens())
        .finally(() => setLoading(false));
    }
    bootstrap();
  }, [refreshUser, refreshWallet]);

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    if (data.requiresTwoFactor) {
      return { requiresTwoFactor: true, twoFactorSessionToken: data.twoFactorSessionToken };
    }
    setTokens(data.accessToken, data.refreshToken);
    await Promise.all([refreshUser(), refreshWallet()]);
    collectAndSubmitFingerprint();
    return { requiresTwoFactor: false };
  }

  async function completeTwoFactorLogin(twoFactorSessionToken: string, code: string) {
    const { data } = await api.post('/auth/2fa/login-verify', { twoFactorSessionToken, code });
    setTokens(data.accessToken, data.refreshToken);
    await Promise.all([refreshUser(), refreshWallet()]);
    collectAndSubmitFingerprint();
  }

  async function register(email: string, password: string, options?: { fullName?: string; dateOfBirth?: string; countryCode?: string; preferredIdType?: string }) {
    await api.post('/auth/register', { email, password, ...options });
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Even if the network call fails, still clear client-side state and
      // redirect — a failed logout call shouldn't trap the user in an
      // apparently-logged-in UI. The httpOnly cookie will simply expire
      // naturally in that edge case rather than being actively revoked.
    }
    clearTokens();
    setUser(null);
    setWallet(null);
    window.location.href = '/login';
  }

  return (
    <AuthContext.Provider value={{ user, wallet, loading, login, completeTwoFactorLogin, register, logout, refreshWallet, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
