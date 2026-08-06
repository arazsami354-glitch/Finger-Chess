'use client';

import { useEffect, useState, UIEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FingerChessLogo } from '@/components/brand/logo';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

interface RulesResponse {
  version: string;
  sections: { title: string; body: string }[];
  hasAcceptedCurrentVersion: boolean;
}

export default function RulesOnboardingPage() {
  const router = useRouter();
  const [rules, setRules] = useState<RulesResponse | null>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api.get('/compliance/rules').then(({ data }) => {
      setRules(data);
      if (data.hasAcceptedCurrentVersion) router.replace('/dashboard');
    });
  }, [router]);

  async function handleAccept() {
    setAccepting(true);
    try {
      await api.post('/compliance/rules/accept');
      router.push('/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not record acceptance — please try again');
    } finally {
      setAccepting(false);
    }
  }

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) setScrolledToEnd(true);
  }

  if (!rules) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground font-mono text-sm">loading…</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center board-texture px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-center gap-2 font-display font-bold text-xl mb-6">
          <FingerChessLogo className="h-6 w-6 text-primary" />
          Finger Chess
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Platform Rules &amp; Fair Play</CardTitle>
            <CardDescription>Read through before continuing — version {rules.version}.</CardDescription>
          </CardHeader>
          <CardContent>
            <div onScroll={handleScroll} className="max-h-96 overflow-y-auto pr-2 space-y-5 border border-border rounded-md p-4 bg-secondary/30">
              {rules.sections.map((s, i) => (
                <div key={s.title}>
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <span className="text-primary font-mono">{i + 1}.</span> {s.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">{s.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-md border border-warn/30 bg-warn/10 p-3 flex gap-2 text-sm text-warn">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Violations may result in penalties, including chat restrictions and account suspension. See{' '}
                <Link href="/onboarding/rules/penalties" className="underline">
                  penalty details
                </Link>
                .
              </span>
            </div>

            <Button className="w-full mt-5" onClick={handleAccept} disabled={!scrolledToEnd || accepting}>
              <ShieldCheck className="h-4 w-4" />
              {accepting ? 'Recording acceptance…' : scrolledToEnd ? 'I have read and accept these rules' : 'Scroll to the end to continue'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
