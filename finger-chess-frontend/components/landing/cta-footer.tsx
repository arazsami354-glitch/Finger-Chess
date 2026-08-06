import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FingerChessLogo } from '@/components/brand/logo';

export function ClosingCta() {
  return (
    <section className="py-24 border-t border-border">
      <div className="container">
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card p-12 text-center">
          <h2 className="font-display font-bold text-3xl sm:text-4xl mb-4">Your rating is worth more than a number.</h2>
          <p className="text-muted-foreground max-w-md mx-auto mb-8">
            Register, verify your email, deposit, and you&apos;re in the queue in under two minutes.
          </p>
          <Button size="lg" asChild>
            <Link href="/register">Create your account</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-border py-10">
      <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 font-display font-semibold">
          <FingerChessLogo className="h-5 w-5 text-primary" />
          Finger Chess
        </div>
        <p className="text-xs text-muted-foreground text-center sm:text-right">
          Real-money skill-gaming is regulated differently by jurisdiction. Play only where permitted. 18+.
        </p>
      </div>
    </footer>
  );
}
