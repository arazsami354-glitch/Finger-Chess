'use client';

import { AppShell } from '@/components/layout/app-shell';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { PageHeader } from '@/components/ui/page-header';

export default function NotificationsPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader
          title="Notifications"
          description="Friend requests, messages, matches, wallet activity, and announcements — all in one place."
        />
        <NotificationCenter />
      </div>
    </AppShell>
  );
}
