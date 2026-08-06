import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, ShieldCheck, Zap } from 'lucide-react';

export function Hero() {
  return (
    <section className="relative overflow-hidden board-texture">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
      <div className="container relative py-24 sm:py-32 flex flex-col items-center text-center">
        <div className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground mb-8 shadow-soft">
          <Zap className="h-3.5 w-3.5 text-gold" />
          Live matches settling in real time
        </div>

        <h1 className="animate-fade-up [animation-delay:80ms] [animation-fill-mode:backwards] font-display font-bold text-5xl sm:text-7xl tracking-tight max-w-3xl leading-[1.05]">
          Chess. <span className="text-primary">For stakes.</span>
        </h1>

        <p className="animate-fade-up [animation-delay:160ms] [animation-fill-mode:backwards] mt-6 max-w-xl text-lg text-muted-foreground">
          Put your rating where your mouth is. Fixed entry fees from $5 to $100, instant matchmaking,
          and winnings in your wallet the moment the game ends.
        </p>

        <div className="animate-fade-up [animation-delay:240ms] [animation-fill-mode:backwards] mt-10 flex flex-col sm:flex-row items-center gap-4">
          <Button size="lg" asChild>
            <Link href="/register">
              Create your account <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/leaderboard">See the leaderboard</Link>
          </Button>
        </div>

        <div className="animate-fade-up [animation-delay:320ms] [animation-fill-mode:backwards] mt-12 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Commission capped at 15%, enforced platform-wide — every match, every time.
        </div>
      </div>
    </section>
  );
}
