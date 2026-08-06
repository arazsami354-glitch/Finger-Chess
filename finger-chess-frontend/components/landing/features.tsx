import { Card, CardContent } from '@/components/ui/card';
import { Swords, Wallet, ShieldCheck, Gauge, Trophy, Eye } from 'lucide-react';

const FEATURES = [
  { icon: Gauge, title: 'Instant Matchmaking', desc: 'Rating-based pairing across Bullet, Blitz, Rapid, and Classical — matched in seconds.' },
  { icon: Wallet, title: 'Real Wallet, Real Payouts', desc: 'Deposit, play, withdraw. Winnings land in your available balance the moment a game ends.' },
  { icon: ShieldCheck, title: 'Anti-Cheat, Seriously', desc: 'Every real-money game is analyzed post-match. Engine-assisted play gets caught, not rewarded.' },
  { icon: Swords, title: 'Server-Authoritative Play', desc: 'Every move, every clock tick, validated server-side. No client can fake a result.' },
  { icon: Trophy, title: 'Live Leaderboards', desc: 'Ratings by time control, updated after every game. Climb the board, not just your balance.' },
  { icon: Eye, title: 'Spectator Mode', desc: 'Watch any live match, or replay a finished one move by move — export the PGN when you\'re done.' },
];

export function Features() {
  return (
    <section id="how-it-works" className="py-24 border-t border-border">
      <div className="container">
        <div className="max-w-xl mb-14">
          <h2 className="font-display font-bold text-3xl sm:text-4xl">Built like a platform that handles real money — because it does.</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <Card key={f.title} className="bg-card/60">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-display font-semibold text-base mb-1.5">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
