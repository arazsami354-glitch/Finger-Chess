'use client';

import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Swords, Trophy, Users, TrendingUp, Wallet, ShieldCheck, Sparkles } from 'lucide-react';

export default function PlayModeSelectionPage() {
  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="font-display font-bold text-2xl">Play Chess</h1>
          <p className="text-muted-foreground text-sm mt-1">Choose how you want to play.</p>
        </div>

        {/* FREE PLAY — primary, most visually prominent option. Larger card,
            placed first, gold-accented border to draw the eye ahead of the
            secondary real-money option below it. */}
        <Link href="/lobby/free" className="block group">
          <Card className="border-2 border-primary/50 hover:border-primary transition-colors relative overflow-hidden">
            <div className="absolute top-4 right-4">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary text-xs font-medium px-3 py-1">
                <Sparkles className="h-3 w-3" /> Recommended
              </span>
            </div>
            <CardContent className="pt-8 pb-8">
              <div className="flex items-start gap-5">
                <div className="h-14 w-14 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                  <Swords className="h-7 w-7 text-primary" />
                </div>
                <div className="flex-1">
                  <h2 className="font-display font-bold text-2xl group-hover:text-primary transition-colors">Free Play</h2>
                  <p className="text-muted-foreground text-sm mt-1 mb-4">
                    Play unlimited chess, anytime, at no cost — practice, improve, and challenge friends with zero
                    risk.
                  </p>
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-gain shrink-0" /> No money required
                    </li>
                    <li className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-gain shrink-0" /> Play anytime
                    </li>
                    <li className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-gain shrink-0" /> Practice &amp; improve
                    </li>
                    <li className="flex items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 text-gain shrink-0" /> Challenge friends
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* REAL MONEY MATCHES — secondary option, visually quieter, placed
            second. Every existing paid feature (wallet, deposits,
            withdrawals, entry fees, prize distribution, commission) is
            untouched — this is purely a navigation change moving the
            existing flow behind this card instead of showing it by default. */}
        <Link href="/lobby/paid" className="block group">
          <Card className="border border-border hover:border-gold/50 transition-colors">
            <CardContent className="pt-6 pb-6">
              <div className="flex items-start gap-4">
                <div className="h-11 w-11 rounded-lg bg-gold/10 flex items-center justify-center shrink-0">
                  <Trophy className="h-5 w-5 text-gold" />
                </div>
                <div className="flex-1">
                  <h2 className="font-display font-semibold text-lg group-hover:text-gold transition-colors">Real Money Matches</h2>
                  <p className="text-muted-foreground text-sm mt-1 mb-3">
                    Deposit funds, join a stake room, and compete for real prizes — the winner takes the pot, minus
                    platform commission.
                  </p>
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Wallet className="h-3.5 w-3.5 text-gold shrink-0" /> Deposit funds
                    </li>
                    <li className="flex items-center gap-2">
                      <Trophy className="h-3.5 w-3.5 text-gold shrink-0" /> Join paid tournaments
                    </li>
                    <li className="flex items-center gap-2">
                      <TrendingUp className="h-3.5 w-3.5 text-gold shrink-0" /> Winner earns prize
                    </li>
                    <li className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5 text-gold shrink-0" /> Platform commission applies
                    </li>
                  </ul>
                  <p className="text-xs text-muted-foreground mt-3">Requires identity verification — see Settings to get verified.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </AppShell>
  );
}
