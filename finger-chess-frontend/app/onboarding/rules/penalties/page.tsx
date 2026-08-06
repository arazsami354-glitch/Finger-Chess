'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FingerChessLogo } from '@/components/brand/logo';
import { ArrowLeft, Ban, MessageCircleOff } from 'lucide-react';

interface PenaltyInfo {
  cheatingSuspensionHours: number;
  chatAbuseMuteHours: number;
}

function formatDuration(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days}-day`;
  }
  return `${hours}-hour`;
}

export default function PenaltyInfoPage() {
  const [penalties, setPenalties] = useState<PenaltyInfo | null>(null);

  useEffect(() => {
    api.get('/compliance/rules').then(({ data }) => setPenalties(data.penalties));
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center board-texture px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-2 font-display font-bold text-xl mb-6">
          <FingerChessLogo className="h-6 w-6 text-primary" />
          Finger Chess
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Penalty Information</CardTitle>
            <CardDescription>What happens if the platform rules are violated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3 rounded-md border border-loss/30 bg-loss/10 p-4">
              <Ban className="h-5 w-5 text-loss shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold">Cheating</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {penalties ? `${formatDuration(penalties.cheatingSuspensionHours)} account suspension.` : 'Loading…'} Every
                  real-money game is analyzed after completion — confirmed engine assistance or collusion results in this
                  penalty regardless of the outcome of the match.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-md border border-warn/30 bg-warn/10 p-4">
              <MessageCircleOff className="h-5 w-5 text-warn shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold">Chat Abuse / Offensive Language</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {penalties ? `${formatDuration(penalties.chatAbuseMuteHours)} chat restriction.` : 'Loading…'} You keep full
                  access to matches and your wallet — only sending messages is blocked for the duration.
                </p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Penalty durations shown here reflect the platform&apos;s current configuration and may be adjusted over time.
              Repeated or severe violations may result in longer suspensions or permanent account termination.
            </p>

            <Button variant="outline" className="w-full" asChild>
              <Link href="/onboarding/rules">
                <ArrowLeft className="h-4 w-4" /> Back to rules
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
