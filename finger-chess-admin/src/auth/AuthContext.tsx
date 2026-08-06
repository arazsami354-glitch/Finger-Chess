import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, clearTokens, getAccessToken, refreshAccessToken, setTokens } from '../api/client';

export type AdminRole = 'support_agent' | 'finance_admin' | 'super_admin';

interface AdminUser {
  id: string;
  email: string;
  fullName?: string | null;
  role: AdminRole;
}

interface AuthContextValue {
  admin: AdminUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (...roles: AdminRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ADMIN_ROLES: AdminRole[] = ['support_agent', 'finance_admin', 'super_admin'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      let token = getAccessToken();
      if (!token) {
        token = await refreshAccessToken();
      }
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await api.get('/users/me');
        if (ADMIN_ROLES.includes(data.role)) {
          setAdmin(data);
        } else {
          clearTokens();
        }
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });

    if (data.requiresTwoFactor) {
      // Reference implementation surfaces this as a thrown error the login
      // page catches and prompts a 2FA code for — see LoginPage.
      throw Object.assign(new Error('2FA required'), { requiresTwoFactor: true, twoFactorSessionToken: data.twoFactorSessionToken });
    }

    setTokens(data.accessToken, data.refreshToken);
    const { data: me } = await api.get('/users/me');
    if (!ADMIN_ROLES.includes(me.role)) {
      clearTokens();
      throw new Error('This account does not have admin access');
    }
    setAdmin(me);
  }

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // Still clear client state and redirect even if the network call
      // fails — the cookie will expire naturally in that edge case.
    }
    clearTokens();
    setAdmin(null);
    window.location.href = '/login';
  }

  function can(...roles: AdminRole[]) {
    return admin ? roles.includes(admin.role) : false;
  }

  return <AuthContext.Provider value={{ admin, loading, login, logout, can }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
