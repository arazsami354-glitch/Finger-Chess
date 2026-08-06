import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
        <SearchX className="h-5 w-5 text-muted-foreground" />
      </span>
      <div className="space-y-1">
        <p className="font-display text-lg font-semibold">Page not found</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist or has moved.</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/">Back home</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/lobby">Go to lobby</Link>
        </Button>
      </div>
    </div>
  );
}
