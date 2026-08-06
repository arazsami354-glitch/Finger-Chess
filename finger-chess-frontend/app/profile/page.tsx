'use client';

import Link from 'next/link';
import { Settings } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { KycStatusBadge } from '@/components/kyc-status-badge';
import { ProfilePage } from '@/components/profile/profile-page';
import { LoadingPanel } from '@/components/ui/spinner';

export default function ProfilePageRoute() {
  const { user } = useAuth();

  if (!user) {
    return (
      <AppShell>
        <LoadingPanel className="py-24" />
      </AppShell>
    );
  }

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <KycStatusBadge status={user.kycStatus} />
      <Button asChild size="sm" variant="outline">
        <Link href="/settings">
          <Settings className="h-4 w-4" /> Edit Profile
        </Link>
      </Button>
    </div>
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <ProfilePage playerId={user.id} actions={actions} />
      </div>
    </AppShell>
  );
}
