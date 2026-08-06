'use client';

import { Badge } from '@/components/ui/badge';
import { kycStatusLabel } from '@/lib/kyc';
import { statusTone } from '@/lib/status-tone';
import type { VariantProps } from 'class-variance-authority';
import type { badgeVariants } from '@/components/ui/badge';

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

/** Explicit tone per KYC status; `verified` deliberately uses primary (gold) emphasis. */
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  not_submitted: 'secondary',
  pending: 'warn',
  needs_more_info: 'warn',
  verified: 'default',
  rejected: 'destructive',
};

export function KycStatusBadge({ status, className }: { status?: string | null; className?: string }) {
  const variant: BadgeVariant = status ? STATUS_VARIANT[status] ?? statusTone(status) : 'secondary';
  return (
    <Badge variant={variant} className={className}>
      {kycStatusLabel(status)}
    </Badge>
  );
}
