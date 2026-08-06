'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Bell, Check, CheckCheck, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useNotifications } from '@/hooks/use-notifications';
import { useSocial } from '@/components/providers/social-provider';
import {
  ALL_NOTIFICATION_CATEGORIES,
  notificationCategoryLabel,
  notificationIcon,
  NotificationItem,
  NOTIFICATION_CATEGORY_DESCRIPTIONS,
  playNotificationSound,
  resolveNotificationLink,
  requestDesktopNotificationPermission,
  desktopNotificationsPermission,
} from '@/lib/notifications';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingPanel, Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type View = 'all' | 'unread' | 'preferences';

const VIEW_STORAGE_KEY = 'notifications:view';

function readStoredView(): View {
  if (typeof window === 'undefined') return 'all';
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return stored === 'unread' || stored === 'preferences' ? stored : 'all';
}

interface NotificationGroup {
  category: string;
  items: NotificationItem[];
}

export function NotificationCenter() {
  const router = useRouter();
  const { items, unread, nextCursor, loading, loadingMore, error, mutatingId, mutatingAll, markOneRead, markAllRead, removeOne, loadMore } =
    useNotifications();
  const { notificationPreferences, updatePreferences, refreshPreferences } = useSocial();

  const [view, setView] = useState<View>(readStoredView);

  const filtered = useMemo(() => (view === 'unread' ? items.filter((n) => !n.isRead) : items), [items, view]);

  const groups = useMemo<NotificationGroup[]>(() => {
    const ordered = [...filtered].sort((a, b) => {
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    const result: NotificationGroup[] = [];
    const byCategory = new Map<string, NotificationGroup>();
    for (const item of ordered) {
      let group = byCategory.get(item.category);
      if (!group) {
        group = { category: item.category, items: [] };
        byCategory.set(item.category, group);
        result.push(group);
      }
      group.items.push(item);
    }
    return result;
  }, [filtered]);

  function switchView(next: string) {
    const value = next as View;
    setView(value);
    if (value === 'all' || value === 'unread') {
      window.localStorage.setItem(VIEW_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(VIEW_STORAGE_KEY);
    }
  }

  async function handleToggleCategory(category: string, enabled: boolean) {
    const next = { ...notificationPreferences.categories, [category]: enabled };
    await updatePreferences({ categories: next });
  }

  async function handleToggleSound(enabled: boolean) {
    if (enabled) playNotificationSound();
    await updatePreferences({ soundEnabled: enabled });
  }

  async function handleToggleDesktop(enabled: boolean) {
    if (enabled) {
      const permission = await requestDesktopNotificationPermission();
      if (permission !== 'granted') {
        toast.info('Desktop notifications are blocked by your browser. Allow them in site settings to enable.');
        return;
      }
    }
    await updatePreferences({ desktopEnabled: enabled });
  }

  return (
    <Tabs value={view} onValueChange={switchView} className="w-full">
      <div className="flex items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">
            Unread{unread > 0 ? ` (${unread})` : ''}
          </TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
        </TabsList>

        {unread > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void markAllRead()}
            disabled={mutatingAll}
            className="shrink-0"
          >
            {mutatingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
            Mark all read
          </Button>
        )}
      </div>

      <TabsContent value="all">
        <NotificationList
          groups={groups}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          hasMore={!!nextCursor}
          loadMore={loadMore}
          mutatingId={mutatingId}
          onOpen={(item) => {
            if (!item.isRead) void markOneRead(item.id);
            const link = resolveNotificationLink(item);
            if (link) router.push(link);
          }}
          onMarkRead={(id) => void markOneRead(id)}
          onDelete={(id) => void removeOne(id)}
        />
      </TabsContent>

      <TabsContent value="unread">
        <NotificationList
          groups={groups}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          hasMore={!!nextCursor}
          loadMore={loadMore}
          mutatingId={mutatingId}
          onOpen={(item) => {
            if (!item.isRead) void markOneRead(item.id);
            const link = resolveNotificationLink(item);
            if (link) router.push(link);
          }}
          onMarkRead={(id) => void markOneRead(id)}
          onDelete={(id) => void removeOne(id)}
        />
      </TabsContent>

      <TabsContent value="preferences">
        <PreferencesPanel
          preferences={notificationPreferences}
          onToggleCategory={handleToggleCategory}
          onToggleSound={handleToggleSound}
          onToggleDesktop={handleToggleDesktop}
          onReset={refreshPreferences}
        />
      </TabsContent>
    </Tabs>
  );
}

interface NotificationListProps {
  groups: NotificationGroup[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  mutatingId: string | null;
  onOpen: (item: NotificationItem) => void;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}

function NotificationList({ groups, loading, loadingMore, error, hasMore, loadMore, mutatingId, onOpen, onMarkRead, onDelete }: NotificationListProps) {
  if (loading) return <LoadingPanel />;
  if (error) return <EmptyState icon={Bell} title="Something went wrong" description={error} />;
  if (groups.length === 0) {
    return <EmptyState icon={Bell} title="You're all caught up" description="New activity will show up here in real time." />;
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.category} aria-label={notificationCategoryLabel(group.category)}>
          <header className="mb-1 flex items-center gap-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {notificationCategoryLabel(group.category)}
            </h2>
            <span className="h-px flex-1 bg-border" />
          </header>
          <Card>
            <CardContent className="p-1.5">
              <div className="divide-y divide-border">
                {group.items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    busy={mutatingId === item.id}
                    onOpen={() => onOpen(item)}
                    onMarkRead={() => onMarkRead(item.id)}
                    onDelete={() => onDelete(item.id)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      ))}
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Spinner className="h-4 w-4" /> : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  item,
  busy,
  onOpen,
  onMarkRead,
  onDelete,
}: {
  item: NotificationItem;
  busy: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
  onDelete: () => void;
}) {
  const Icon = notificationIcon(item.category);
  const unread = !item.isRead;
  const grouped = item.count > 1;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${item.title}. ${unread ? 'Unread' : 'Read'}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group flex items-start gap-3 rounded-md px-3 py-3 text-left transition-colors cursor-pointer',
        unread ? 'bg-primary/[0.06]' : 'hover:bg-secondary/50',
      )}
    >
      <div className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
        <Icon className="h-4 w-4 text-primary" />
        {unread && <span className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          {grouped && (
            <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px]">
              {item.count}
            </Badge>
          )}
        </div>
        {item.message && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.message}</p>}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <time dateTime={item.createdAt}>{formatRelativeTime(item.createdAt)}</time>
          {item.actorName && (
            <>
              <span className="text-border">•</span>
              <span className="truncate">{item.actorName}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {unread && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Mark as read"
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead();
            }}
          >
            <Check className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:text-destructive"
          aria-label="Delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

interface PreferencesPanelProps {
  preferences: ReturnType<typeof useSocial>['notificationPreferences'];
  onToggleCategory: (category: string, enabled: boolean) => void;
  onToggleSound: (enabled: boolean) => void;
  onToggleDesktop: (enabled: boolean) => void;
  onReset: () => void;
}

function PreferencesPanel({ preferences, onToggleCategory, onToggleSound, onToggleDesktop }: PreferencesPanelProps) {
  const desktopPermission = desktopNotificationsPermission();

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Sound</p>
              <p className="text-xs text-muted-foreground">Play a short chime when a notification arrives.</p>
            </div>
            <Switch checked={preferences.soundEnabled} onCheckedChange={(v) => void onToggleSound(v)} aria-label="Toggle notification sound" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Desktop notifications</p>
              <p className="text-xs text-muted-foreground">
                {desktopPermission === 'granted'
                  ? 'Enabled — popups will appear even when this tab is in the background.'
                  : desktopPermission === 'denied'
                    ? 'Blocked in your browser. Allow notifications in site settings to enable.'
                    : 'Show popups even when this tab is in the background.'}
              </p>
            </div>
            <Switch
              checked={preferences.desktopEnabled}
              onCheckedChange={(v) => void onToggleDesktop(v)}
              aria-label="Toggle desktop notifications"
            />
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categories</h2>
        <Card>
          <CardContent className="p-1.5">
            <div className="divide-y divide-border">
              {ALL_NOTIFICATION_CATEGORIES.map((category) => {
                const Icon = notificationIcon(category);
                const enabled = preferences.categories[category] ?? true;
                return (
                  <div key={category} className="flex items-center justify-between gap-4 px-3 py-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{notificationCategoryLabel(category)}</p>
                        <p className="text-xs text-muted-foreground">{NOTIFICATION_CATEGORY_DESCRIPTIONS[category]}</p>
                      </div>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => void onToggleCategory(category, v)}
                      aria-label={`Toggle ${notificationCategoryLabel(category)} notifications`}
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'Just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
