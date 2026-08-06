import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { setTokens } from '../api/client';
import { Button } from '../components/ui';
import { FingerChessLogo } from '../components/brand/logo';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      if (err.requiresTwoFactor) {
        setTwoFactorToken(err.twoFactorSessionToken);
      } else {
        setError(err.response?.data?.message ?? err.message ?? 'Sign-in failed');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleTwoFactorSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post('/auth/2fa/login-verify', { twoFactorSessionToken: twoFactorToken, code });
      setTokens(data.accessToken, data.refreshToken);
      window.location.href = '/';
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <FingerChessLogo className="h-8 w-8 text-brass mx-auto mb-2" />
          <div className="font-display font-bold text-2xl text-ink">Finger Chess</div>
          <div className="text-sm text-ink-faint mt-1">Platform Admin</div>
        </div>

        <div className="panel p-6">
          {!twoFactorToken ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Email">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                  autoFocus
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                />
              </Field>
              {error && <div className="text-loss text-sm">{error}</div>}
              <Button type="submit" tone="brass" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleTwoFactorSubmit} className="space-y-4">
              <p className="text-sm text-ink-muted">Enter the 6-digit code from your authenticator app.</p>
              <Field label="Code">
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="input font-mono tracking-widest text-center"
                  autoFocus
                />
              </Field>
              {error && <div className="text-loss text-sm">{error}</div>}
              <Button type="submit" tone="brass" disabled={loading}>
                {loading ? 'Verifying…' : 'Verify'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-ink-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}
