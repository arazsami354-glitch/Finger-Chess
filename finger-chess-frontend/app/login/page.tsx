'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { FingerChessLogo } from '@/components/brand/logo';
import { Loader2 } from 'lucide-react';

export default function LoginPage() {
  const { login, completeTwoFactorLogin } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.requiresTwoFactor && result.twoFactorSessionToken) {
        setTwoFactorToken(result.twoFactorSessionToken);
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleTwoFactor(e: FormEvent) {
    e.preventDefault();
    if (!twoFactorToken) return;
    setLoading(true);
    try {
      await completeTwoFactorLogin(twoFactorToken, code);
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center board-texture px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 font-display font-bold text-xl mb-8">
          <FingerChessLogo className="h-6 w-6 text-primary" />
          Finger Chess
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>{twoFactorToken ? 'Two-factor verification' : 'Sign in'}</CardTitle>
            <CardDescription>
              {twoFactorToken ? 'Enter the 6-digit code from your authenticator app.' : 'Welcome back — pick up where you left off.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!twoFactorToken ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                      Forgot?
                    </Link>
                  </div>
                  <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </Button>

                <div className="relative py-2">
                  <Separator />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="bg-card px-2 text-xs text-muted-foreground">or</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button variant="outline" type="button" onClick={() => (window.location.href = '/api/v1/auth/google')}>
                    Google
                  </Button>
                  <Button variant="outline" type="button" onClick={() => (window.location.href = '/api/v1/auth/discord')}>
                    Discord
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleTwoFactor} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="code">Authenticator code</Label>
                  <Input
                    id="code"
                    className="font-mono text-center tracking-[0.5em] text-lg"
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying…
                    </>
                  ) : (
                    'Verify'
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-primary hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
