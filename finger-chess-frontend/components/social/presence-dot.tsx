import { cn } from '@/lib/utils';
import type { PresenceStatus } from '@/hooks/use-social-socket';

const STATUS_META: Record<PresenceStatus, { dot: string; label: string; text: string }> = {
  online: { dot: 'bg-gain', label: 'Online', text: 'text-gain' },
  away: { dot: 'bg-warn', label: 'Away', text: 'text-warn' },
  in_game: { dot: 'bg-primary', label: 'In Match', text: 'text-primary' },
  in_tournament: { dot: 'bg-[#8b5cf6]', label: 'In Tournament', text: 'text-[#a78bfa]' },
  spectating: { dot: 'bg-[#06b6d4]', label: 'Spectating', text: 'text-[#22d3ee]' },
  do_not_disturb: { dot: 'bg-destructive', label: 'Do Not Disturb', text: 'text-destructive' },
  invisible: { dot: 'bg-muted-foreground/40', label: 'Invisible', text: 'text-muted-foreground' },
  offline: { dot: 'bg-muted-foreground/40', label: 'Offline', text: 'text-muted-foreground' },
};

export function PresenceDot({ status }: { status?: string }) {
  const meta = STATUS_META[(status as PresenceStatus) ?? 'offline'] ?? STATUS_META.offline;
  return <span className={cn('inline-block h-2.5 w-2.5 rounded-full border-2 border-card', meta.dot)} />;
}

export function PresenceLabel({ status }: { status?: string }) {
  const meta = STATUS_META[(status as PresenceStatus) ?? 'offline'] ?? STATUS_META.offline;
  return <span className={cn('text-xs', meta.text)}>{meta.label}</span>;
}
