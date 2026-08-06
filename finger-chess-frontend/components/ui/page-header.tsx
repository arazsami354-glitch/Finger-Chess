import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** When set, renders a quiet "Back" link above the title (used by the
   *  settings sub-pages and the lobby flows). */
  backHref?: string;
  backLabel?: string;
  children?: React.ReactNode;
  className?: string;
}

/** The one page-header treatment every screen uses, so each route shares the
 *  same hierarchy: back link (optional), a display title, a supporting line,
 *  and any page-level actions on the right. */
export function PageHeader({ title, description, backHref, backLabel = 'Back', children, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {backHref && (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </Link>
        )}
        <h1 className="font-display font-bold text-2xl tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}
