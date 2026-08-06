'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { FingerChessLogo } from '@/components/brand/logo';

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted-foreground font-mono text-sm">loading…</div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    api
      .post('/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center board-texture px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 font-display font-bold text-xl mb-8">
          <FingerChessLogo className="h-6 w-6 text-primary" />
          Finger Chess
        </Link>

        <Card>
          <CardContent className="pt-8 pb-8 text-center">
            {status === 'verifying' && <Loader2 className="h-8 w-8 text-primary mx-auto mb-4 animate-spin" />}
            {status === 'success' && <CheckCircle2 className="h-8 w-8 text-primary mx-auto mb-4" />}
            {status === 'error' && <XCircle className="h-8 w-8 text-destructive mx-auto mb-4" />}

            <h2 className="font-display font-semibold text-lg mb-2">
              {status === 'verifying' && 'Verifying your email…'}
              {status === 'success' && 'Email verified'}
              {status === 'error' && 'Verification failed'}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {status === 'success' && 'Your account is fully active. You can sign in now.'}
              {status === 'error' && 'This link is invalid or has expired — you can request a new one from the sign-in page.'}
            </p>

            {status !== 'verifying' && (
              <Button asChild className="w-full">
                <Link href="/login">Go to sign in</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
