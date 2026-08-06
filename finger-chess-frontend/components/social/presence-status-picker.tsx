'use client';

import { useState } from 'react';
import { PresenceDot } from './presence-dot';
import { Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSocial } from '@/components/providers/social-provider';
import { CLIENT_STATUSES, type PresenceStatus } from '@/hooks/use-social-socket';

const STATUS_OPTIONS: { value: PresenceStatus; label: string; hint: string }[] = [
  { value: 'online', label: 'Online', hint: 'Visible and available to chat' },
  { value: 'away', label: 'Away', hint: 'Away from the keyboard' },
  { value: 'do_not_disturb', label: 'Do Not Disturb', hint: 'Please don’t disturb' },
  { value: 'invisible', label: 'Invisible', hint: 'Appear offline to others' },
];

const STORAGE_KEY = 'presence:manual-status';

// The backend remembers the user's manual status preference (and restores it
// after auto-states like in_game end). The picker mirrors that here so a
// reload / navigation doesn't reset the shown status back to 'online'.
function readStoredStatus(): PresenceStatus {
  if (typeof window === 'undefined') return 'online';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return CLIENT_STATUSES.includes(stored as PresenceStatus) ? (stored as PresenceStatus) : 'online';
}

/**
 * Header control for the user's own status. Auto states (In Match / In
 * Tournament / Spectating) are driven by context and never shown here; this
 * only lets the user choose their manual preference, which the backend
 * remembers and restores after a game ends.
 */
export function PresenceStatusPicker() {
  const { setStatus } = useSocial();
  const [current, setCurrent] = useState<PresenceStatus>(readStoredStatus);

  function choose(status: PresenceStatus) {
    setCurrent(status);
    setStatus(status);
    window.localStorage.setItem(STORAGE_KEY, status);
  }

  const activeMeta = STATUS_OPTIONS.find((o) => o.value === current);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md border border-border bg-secondary px-2.5 py-1.5 hover:border-primary/50 transition-colors"
          aria-label={`Set status — currently ${activeMeta?.label ?? 'Online'}`}
          title={`Status: ${activeMeta?.label ?? 'Online'}`}
        >
          <PresenceDot status={current} />
          <span className="hidden sm:inline text-xs font-medium text-muted-foreground">{activeMeta?.label ?? 'Online'}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-medium">Set your status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {STATUS_OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt.value} onClick={() => choose(opt.value)} className="flex items-start gap-2 py-2">
            <span className="pt-1">
              <PresenceDot status={opt.value} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="text-sm">{opt.label}</span>
                {opt.value === current && <Check className="h-3.5 w-3.5 text-primary" />}
              </span>
              <span className="block text-xs text-muted-foreground">{opt.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[10px] text-muted-foreground/70">
          In Match, In Tournament and Spectating are set automatically while active.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
