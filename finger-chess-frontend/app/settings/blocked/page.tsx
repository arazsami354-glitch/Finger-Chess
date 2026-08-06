'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Ban } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingPanel } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface BlockedEntry {
  id: string;
  blockedId: string;
  reason: string | null;
  createdAt: string;
  blocked: { id: string; fullName: string | null; email: string };
}

export default function BlockedUsersPage() {
  const [blocked, setBlocked] = useState<BlockedEntry[] | null>(null);

  function load() {
    api.get('/social/friends/blocked').then(({ data }) => setBlocked(data));
  }
  useEffect(load, []);

  async function unblock(userId: string) {
    await api.post(`/social/friends/unblock/${userId}`);
    toast.success('User unblocked');
    load();
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          title="Blocked Users"
          description="People you've blocked can't message you, send requests, or see your profile."
          backHref="/settings/privacy"
        />

        <Card>
          <CardContent className="pt-6">
            {blocked === null ? (
              <LoadingPanel />
            ) : blocked.length === 0 ? (
              <EmptyState icon={Ban} title="No blocked users" description="You haven't blocked anyone." />
            ) : (
              // Deliberately NOT linking these names to /players/[id] — a
              // blocked profile is correctly rejected by the backend
              // (PlayerProfileController throws 403 between blocked users),
              // so this list renders inline rather than reusing the
              // link-wrapped PlayerCard component used everywhere else.
              <div className="divide-y divide-border">
                {blocked.map((b) => {
                  const name = b.blocked.fullName || b.blocked.email;
                  return (
                    <div key={b.id} className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar className="h-10 w-10 border border-border">
                          <AvatarFallback className="bg-secondary text-sm">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {b.reason ? `Reason: ${b.reason}` : `Blocked ${new Date(b.createdAt).toLocaleDateString()}`}
                          </div>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => unblock(b.blockedId)}>
                        Unblock
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
