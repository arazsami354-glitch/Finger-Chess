'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { useSocial } from '@/components/providers/social-provider';
import { useAuth } from '@/components/providers/auth-provider';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PresenceDot } from '@/components/social/presence-dot';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingPanel } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { MessageCircle, Search, RefreshCcw } from 'lucide-react';

interface ConversationItem {
  conversationId: string;
  otherUser: { id: string; fullName: string | null; email: string };
  lastMessage: { content: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
  isMuted: boolean;
}

export default function MessagesPage() {
  return (
    <AppShell>
      <MessagesView />
    </AppShell>
  );
}

function MessagesView() {
  const { user } = useAuth();
  const { presenceMap, incomingMessages } = useSocial();
  const [conversations, setConversations] = useState<ConversationItem[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const processed = useRef<Set<string>>(new Set());

  const load = useCallback(async (q: string) => {
    setError(null);
    try {
      const { data } = await api.get<ConversationItem[]>('/social/messages/conversations', { params: q ? { q } : {} });
      setConversations(data);
    } catch {
      setError('Couldn’t load conversations. Check your connection and try again.');
    }
  }, []);

  // Debounced server-side search (name/email match on the counterparty).
  useEffect(() => {
    const timer = setTimeout(() => load(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query, load]);

  // Optimistic live updates: a new message reorders the list, refreshes the
  // preview and bumps the unread badge in place — no full refetch per message.
  // Only falls back to a refetch when the message belongs to a conversation
  // that isn't in the list yet (someone started one with us from elsewhere).
  // `conversations` is a dep so messages arriving while the first load is in
  // flight (list === null) get merged once the list lands — otherwise they'd
  // be dropped until the next message happened to arrive.
  useEffect(() => {
    if (!conversations) return;
    const fresh = incomingMessages.filter((m) => !processed.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => processed.current.add(m.id));

    const unknown = fresh.find((m) => !conversations.some((c) => c.conversationId === m.conversationId));
    if (unknown) {
      load(query.trim());
      return;
    }

    setConversations((prev) => {
      if (!prev) return prev;
      let list = [...prev];
      for (const msg of fresh) {
        const idx = list.findIndex((c) => c.conversationId === msg.conversationId);
        if (idx === -1) continue;
        const conv = list[idx];
        const updated: ConversationItem = {
          ...conv,
          lastMessage: { content: msg.content, senderId: msg.senderId, createdAt: msg.createdAt },
          unreadCount:
            msg.senderId === user?.id ? conv.unreadCount : conv.isMuted ? conv.unreadCount : conv.unreadCount + 1,
        };
        list = [updated, ...list.filter((_, i) => i !== idx)];
      }
      return list;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingMessages, conversations]);

  const hasQuery = query.trim().length > 0;
  const emptyTitle = hasQuery ? 'No conversations match your search' : 'No conversations yet';
  const emptyDescription = hasQuery
    ? 'Try a different name or email.'
    : 'Start one from a player\'s profile or your friends list.';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="Messages" description="Conversations with friends and opponents." />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations by name or email…"
          className="pl-9"
          aria-label="Search conversations"
        />
      </div>

      <Card>
        <CardContent className="pt-4">
          {error && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <p className="text-sm text-muted-foreground max-w-sm">{error}</p>
              <Button variant="outline" onClick={() => load(query.trim())}>
                <RefreshCcw className="h-4 w-4" /> Retry
              </Button>
            </div>
          )}

          {!error && conversations === null && <LoadingPanel />}

          {!error && conversations !== null && conversations.length === 0 && (
            <EmptyState
              icon={MessageCircle}
              title={emptyTitle}
              description={emptyDescription}
              action={
                hasQuery ? undefined : (
                  <Button asChild>
                    <Link href="/search">Find a player</Link>
                  </Button>
                )
              }
            />
          )}

          {!error && conversations !== null && conversations.length > 0 && (
            <div className="divide-y divide-border">
              {conversations.map((c) => {
                const initials = (c.otherUser.fullName || c.otherUser.email).slice(0, 2).toUpperCase();
                const isMine = c.lastMessage?.senderId === user?.id;
                return (
                  <Link
                    key={c.conversationId}
                    href={`/messages/${c.conversationId}`}
                    className="flex items-center gap-3 py-3 hover:bg-secondary/50 -mx-2 px-2 rounded-md transition-colors"
                  >
                    <div className="relative">
                      <Avatar className="h-11 w-11 border border-border">
                        <AvatarFallback className="bg-secondary">{initials}</AvatarFallback>
                      </Avatar>
                      <span className="absolute -bottom-0.5 -right-0.5">
                        <PresenceDot status={presenceMap[c.otherUser.id]} />
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium truncate">{c.otherUser.fullName || c.otherUser.email}</span>
                        {c.lastMessage && (
                          <span className="text-xs text-muted-foreground shrink-0 ml-2">
                            {new Date(c.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.lastMessage ? `${isMine ? 'You: ' : ''}${c.lastMessage.content}` : 'No messages yet'}
                      </p>
                    </div>
                    {c.unreadCount > 0 && !c.isMuted && (
                      <Badge className="shrink-0">{c.unreadCount}</Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
