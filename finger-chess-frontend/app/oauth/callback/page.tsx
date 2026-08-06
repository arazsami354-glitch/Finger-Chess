'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setAccessToken } from '@/lib/api';
import { Loader2 } from 'lucide-react';

export default function OAuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    // Only the ACCESS token arrives in the URL fragment (never the query
    // string, so it never lands in server logs or a Referer header) — the
    // refresh token was already set as an httpOnly cookie on this exact
    // redirect response by the backend, before the browser even reached
    // this page, so there's nothing further to read or store for it here.
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');

    if (accessToken) {
      setAccessToken(accessToken);
      window.history.replaceState(null, '', window.location.pathname);
      router.replace('/dashboard');
    } else {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 text-primary animate-spin" />
    </div>
  );
}
