import Link from 'next/link';
import { memo, ReactNode } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PresenceDot } from './presence-dot';

interface PlayerCardProps {
  id: string;
  fullName?: string | null;
  email?: string;
  avatarUrl?: string | null;
  presenceStatus?: string;
  subtitle?: string;
  actions?: ReactNode;
}

function PlayerCardBase({ id, fullName, email, avatarUrl, presenceStatus, subtitle, actions }: PlayerCardProps) {
  const displayName = fullName || email || 'Player';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center justify-between py-3">
      <Link href={`/players/${id}`} className="flex items-center gap-3 min-w-0 group">
        <div className="relative">
          <Avatar className="h-10 w-10 border border-border">
            {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
            <AvatarFallback className="bg-secondary text-sm">{initials}</AvatarFallback>
          </Avatar>
          {presenceStatus && <span className="absolute -bottom-0.5 -right-0.5"><PresenceDot status={presenceStatus} /></span>}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{displayName}</div>
          {subtitle && <div className="text-xs text-muted-foreground truncate">{subtitle}</div>}
        </div>
      </Link>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/**
 * Memoized so a parent list re-render (presence churn, tab switches) doesn't
 * rebuild every card. Note: callers that pass inline JSX as `actions` defeat
 * the memo on parent renders — pass stable elements (memoized children) for
 * the full benefit.
 */
export const PlayerCard = memo(PlayerCardBase);
