'use client';

import { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { EMOJI_CATEGORIES } from './emoji-data';
import { cn } from '@/lib/utils';

/**
 * Lightweight emoji picker for the message composer — no popover dependency,
 * just a button that toggles an anchored panel. Inserts the picked emoji via
 * onPick (the composer decides whether to append or replace). Closes on
 * outside click or Escape, and stays usable at any scroll position.
 */
export function EmojiPicker({ onPick, disabled = false }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label="Insert emoji"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
      >
        <Smile className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 left-0 z-50 w-72 max-h-72 overflow-y-auto rounded-lg border border-border bg-card p-3 shadow-lg">
          {EMOJI_CATEGORIES.map((category) => (
            <div key={category.label} className="mb-3 last:mb-0">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{category.label}</div>
              <div className="grid grid-cols-8 gap-0.5">
                {category.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => {
                      onPick(emoji);
                      setOpen(false);
                    }}
                    className={cn(
                      'rounded-md p-1 text-lg leading-none hover:bg-secondary transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
