'use client';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Swords, Trophy } from 'lucide-react';

export type ColorPreference = 'random' | 'white' | 'black';

const COLOR_OPTIONS: { value: ColorPreference; label: string; hint: string }[] = [
  { value: 'random', label: 'Random', hint: 'Coin flip' },
  { value: 'white', label: 'Play White', hint: 'Move first' },
  { value: 'black', label: 'Play Black', hint: 'Move second' },
];

interface MatchSettingsProps {
  rated: boolean;
  onRatedChange: (rated: boolean) => void;
  colorPreference: ColorPreference;
  onColorPreferenceChange: (pref: ColorPreference) => void;
  showColorSelection?: boolean;
}

/**
 * Rated / Casual + color preference pickers shared by the free and paid
 * lobby pages. Rated games move Elo; casual games never touch a rating.
 * Color preference is honored unless the opponent wants the same color —
 * in that (genuinely unresolvable) conflict the match server coin-flips,
 * so 'random' simply means "no preference".
 */
export function MatchSettings({ rated, onRatedChange, colorPreference, onColorPreferenceChange, showColorSelection = true }: MatchSettingsProps) {
  return (
    <div className="space-y-6">
      <div>
        <Label className="text-sm font-medium text-muted-foreground mb-3 block">Game Type</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onRatedChange(true)}
            className={cn(
              'rounded-lg border p-4 text-left transition-colors',
              rated ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40',
            )}
          >
            <Trophy className="h-4 w-4 text-primary mb-2" />
            <div className="font-semibold text-sm">Rated</div>
            <div className="text-xs text-muted-foreground">Affects your Elo rating</div>
          </button>
          <button
            type="button"
            onClick={() => onRatedChange(false)}
            className={cn(
              'rounded-lg border p-4 text-left transition-colors',
              !rated ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40',
            )}
          >
            <Swords className="h-4 w-4 text-primary mb-2" />
            <div className="font-semibold text-sm">Casual</div>
            <div className="text-xs text-muted-foreground">Pure practice — no rating change</div>
          </button>
        </div>
      </div>

      {showColorSelection && (
        <div>
          <Label className="text-sm font-medium text-muted-foreground mb-3 block">Color Preference</Label>
          <div className="grid grid-cols-3 gap-3">
            {COLOR_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onColorPreferenceChange(opt.value)}
                className={cn(
                  'rounded-lg border p-3 text-center transition-colors',
                  colorPreference === opt.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40',
                )}
              >
                <div className="font-semibold text-sm">{opt.label}</div>
                <div className="text-xs text-muted-foreground">{opt.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
