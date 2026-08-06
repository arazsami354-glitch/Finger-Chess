import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const TIERS = [
  { fee: 5, label: 'Entry' },
  { fee: 10, label: 'Standard' },
  { fee: 25, label: 'Competitive' },
  { fee: 50, label: 'High Stakes', kyc: true },
  { fee: 100, label: 'Elite', kyc: true },
];

export function Stakes() {
  return (
    <section id="stakes" className="py-24 border-t border-border">
      <div className="container">
        <div className="max-w-xl mb-14">
          <h2 className="font-display font-bold text-3xl sm:text-4xl">Fixed stakes. No surprises.</h2>
          <p className="mt-3 text-muted-foreground">
            Five entry-fee tiers, each its own matchmaking room. Winner takes the pot, minus a commission that never exceeds 15%.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {TIERS.map((tier) => (
            <Card key={tier.fee} className={cn('text-center', tier.fee === 25 && 'border-primary/50 ring-1 ring-primary/20')}>
              <CardContent className="pt-6 pb-5">
                <div className="font-mono font-bold text-3xl text-foreground">${tier.fee}</div>
                <div className="text-xs text-muted-foreground mt-1">{tier.label}</div>
                {tier.kyc && <div className="text-[10px] text-gold mt-2 uppercase tracking-wide">KYC required</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
