'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingPanel } from '@/components/ui/spinner';

interface PrivacySettings {
  whoCanMessage: string;
  whoCanFriendRequest: string;
  showOnlineStatus: boolean;
  showProfileStats: boolean;
  allowFriendSuggestions: boolean;
}

export default function PrivacySettingsPage() {
  const [settings, setSettings] = useState<PrivacySettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/social/privacy').then(({ data }) => setSettings(data));
  }, []);

  async function save(partial: Partial<PrivacySettings>) {
    if (!settings) return;
    const updated = { ...settings, ...partial };
    setSettings(updated);
    setSaving(true);
    try {
      await api.patch('/social/privacy', partial);
    } catch {
      toast.error('Could not save — please try again');
      setSettings(settings); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <AppShell>
        <LoadingPanel className="py-24" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          title="Privacy Settings"
          description="Control who can reach you and what other players see."
          backHref="/settings"
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who can contact you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Who can message you</Label>
              <Select value={settings.whoCanMessage} onValueChange={(v) => save({ whoCanMessage: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone</SelectItem>
                  <SelectItem value="friends">Friends only</SelectItem>
                  <SelectItem value="none">No one</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Who can send you friend requests</Label>
              <Select value={settings.whoCanFriendRequest} onValueChange={(v) => save({ whoCanFriendRequest: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone</SelectItem>
                  <SelectItem value="friends_of_friends">Friends of friends only</SelectItem>
                  <SelectItem value="none">No one</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visibility</CardTitle>
            <CardDescription>Control what other players can see on your profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Show online status</Label>
                <p className="text-xs text-muted-foreground">Friends can see when you&apos;re online, away, or in a game.</p>
              </div>
              <Switch checked={settings.showOnlineStatus} onCheckedChange={(v) => save({ showOnlineStatus: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Show profile stats</Label>
                <p className="text-xs text-muted-foreground">Win rate, games played, and ratings visible on your profile.</p>
              </div>
              <Switch checked={settings.showProfileStats} onCheckedChange={(v) => save({ showProfileStats: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Friend suggestions</Label>
                <p className="text-xs text-muted-foreground">Allow the platform to suggest you to others as a mutual friend.</p>
              </div>
              <Switch checked={settings.allowFriendSuggestions} onCheckedChange={(v) => save({ allowFriendSuggestions: v })} />
            </div>
          </CardContent>
        </Card>

        <Link href="/settings/blocked" className="block">
          <Card className="hover:border-primary/40 transition-colors">
            <CardContent className="pt-6 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Blocked Users</div>
                <div className="text-xs text-muted-foreground">Manage who you&apos;ve blocked</div>
              </div>
              <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>
    </AppShell>
  );
}
