'use client';

import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TournamentStatusFilter = 'all' | 'open' | 'live' | 'completed';
export type TournamentSort = 'startTime' | 'newest' | 'prizePool';

const FILTERS: { value: TournamentStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'live', label: 'Live' },
  { value: 'completed', label: 'Completed' },
];

const SORTS: { value: TournamentSort; label: string }[] = [
  { value: 'startTime', label: 'Starts soonest' },
  { value: 'newest', label: 'Newest first' },
  { value: 'prizePool', label: 'Largest prize pool' },
];

interface TournamentToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  filter: TournamentStatusFilter;
  onFilter: (value: TournamentStatusFilter) => void;
  sort: TournamentSort;
  onSort: (value: TournamentSort) => void;
  shown: number;
  total: number;
}

export function TournamentToolbar({ search, onSearch, filter, onFilter, sort, onSort, shown, total }: TournamentToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <label htmlFor="tournament-search" className="sr-only">
          Search tournaments
        </label>
        <input
          id="tournament-search"
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search by name or description…"
          className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter tournaments by status" className="inline-flex rounded-md border border-border bg-secondary/40 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => onFilter(f.value)}
              className={cn(
                'rounded px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === f.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="tournament-sort" className="sr-only">
            Sort tournaments
          </label>
          <select
            id="tournament-sort"
            value={sort}
            onChange={(e) => onSort(e.target.value as TournamentSort)}
            className="h-9 rounded-md border border-border bg-background px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <span className="text-xs text-muted-foreground font-mono">
          {shown} of {total}
        </span>
      </div>
    </div>
  );
}
