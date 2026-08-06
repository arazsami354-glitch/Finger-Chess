'use client';

import { Crown } from 'lucide-react';

export function TitleBadge({ title }: { title: string | null }) {
  if (!title) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gradient-to-r from-gold/20 via-gold/10 to-primary/10 px-2.5 py-0.5 text-xs font-semibold text-gold">
      <Crown className="h-3 w-3" />
      {title}
    </span>
  );
}
