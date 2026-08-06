'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { useSocial } from '@/components/providers/social-provider';
import { usePresence } from '@/hooks/use-presence';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PresenceLabel } from '@/components/social/presence-dot';
import { EmojiPicker } from '@/components/chat/emoji-picker';
import { Send, Check, CheckCheck, ArrowLeft, RefreshCcw, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
  deliveryStatuses?: { userId: string; status: string }[];
}

interface ConversationData {
  conversationId: string;
  type: string;
  otherParticipant: { id: string; email: string; fullName: string | null } | null;
  messages: Message[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function ConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const { user } = useAuth();
  const { presenceMap, incomingMessages, typingByConversation, deliveryUpdates, readUpdates, sendMessage, setTyping, markRead } = useSocial();
  const [data, setData] = useState<ConversationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialScroll = useRef(true);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>();
  // Buffers live messages that arrive while the history request is still in
  // flight, so nothing the other party says in that window is ever dropped.
  const liveBuffer = useRef<Message[]>([]);
  // Guards against a stale response landing after the user switched to a
  // different conversation (App Router soft nav re-runs load with a new
  // conversationId while an earlier request is still in flight).
  const loadSeq = useRef(0);

  const otherUserId = data?.otherParticipant?.id ?? null;

  const load = useCallback(async () => {
    const conversationId = params.conversationId;
    const seq = ++loadSeq.current;
    liveBuffer.current = [];
    setLoading(true);
    setLoadError(null);
    setData(null);
    try {
      const { data: fetched } = await api.get<ConversationData>(
        `/social/messages/conversations/${conversationId}`,
      );
      if (seq !== loadSeq.current || params.conversationId !== conversationId) return;
      setData(() => {
        // Merge in anything that arrived live while the request was pending.
        const serverIds = new Set(fetched.messages.map((m) => m.id));
        const buffered = liveBuffer.current.filter((m) => !serverIds.has(m.id));
        liveBuffer.current = [];
        return { ...fetched, messages: [...fetched.messages, ...buffered] };
      });
    } catch (err: any) {
      if (seq !== loadSeq.current || params.conversationId !== conversationId) return;
      const status = err?.response?.status;
      if (status === 403) setLoadError('You don’t have access to this conversation.');
      else if (status === 404) setLoadError('This conversation no longer exists.');
      else setLoadError('Couldn’t load messages. Check your connection and try again.');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [params.conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live presence for the other party — friends are pushed over the socket,
  // everyone else (opponents, non-friends) is polled by usePresence.
  const { statusFor } = usePresence(otherUserId ? [otherUserId] : null);
  const otherPresence = otherUserId ? (statusFor(otherUserId) ?? presenceMap[otherUserId]) : undefined;

  // Append live messages that belong to this conversation.
  useEffect(() => {
    const relevant = incomingMessages.filter((m) => m.conversationId === params.conversationId) as Message[];
    if (relevant.length === 0) return;
    liveBuffer.current = [...liveBuffer.current, ...relevant];
    setData((prev) => {
      if (!prev) return prev; // still loading — history fetch merges the buffer
      const existingIds = new Set(prev.messages.map((m) => m.id));
      const toAdd = liveBuffer.current.filter((m) => !existingIds.has(m.id));
      liveBuffer.current = [];
      if (toAdd.length === 0) return prev;
      return { ...prev, messages: [...prev.messages, ...toAdd] };
    });
  }, [incomingMessages, params.conversationId]);

  const messageCount = data?.messages.length ?? 0;
  const isOtherTyping = typingByConversation[params.conversationId];

  // Auto-scroll to the latest message — instant on first paint, smooth after.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: initialScroll.current ? 'auto' : 'smooth' });
    initialScroll.current = false;
  }, [messageCount, isOtherTyping]);

  // Mark the conversation read up to the latest message (only when it came
  // from the other party — no point marking read on my own send).
  const lastMessageId = data?.messages[data.messages.length - 1]?.id;
  const lastMessageMine = data?.messages[data.messages.length - 1]?.senderId === user?.id;
  useEffect(() => {
    if (lastMessageId && !lastMessageMine && data) {
      markRead(params.conversationId, lastMessageId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageId, lastMessageMine, params.conversationId]);

  function handleSend() {
    if (!draft.trim()) return;
    sendMessage(params.conversationId, draft.trim());
    setDraft('');
    setTyping(params.conversationId, false);
  }

  function handleChange(value: string) {
    setDraft(value);
    setTyping(params.conversationId, true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => setTyping(params.conversationId, false), 2000);
  }

  // Read watermark: everything at/before the last message id the other party
  // has read counts as read. Computed once here (not per bubble) so large
  // histories stay O(n).
  const watermarkIndex = useMemo(() => {
    if (!data) return -1;
    const id = readUpdates[params.conversationId];
    return id ? data.messages.findIndex((msg) => msg.id === id) : -1;
  }, [data, readUpdates, params.conversationId]);

  const grouped = useMemo(() => {
    if (!data) return [] as { date: string; messages: Message[] }[];
    const groups: { date: string; messages: Message[] }[] = [];
    for (const m of data.messages) {
      const key = dayKey(new Date(m.createdAt));
      const last = groups[groups.length - 1];
      if (last && last.date === key) last.messages.push(m);
      else groups.push({ date: key, messages: [m] });
    }
    return groups;
  }, [data]);

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-10rem)]">
        <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
          <Link href="/messages" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Messages
          </Link>
          {data?.otherParticipant && (
            <Link
              href={`/players/${data.otherParticipant.id}`}
              className="inline-flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
            >
              <span className="truncate max-w-[16rem]">{data.otherParticipant.fullName ?? data.otherParticipant.email}</span>
              <PresenceLabel status={otherPresence} />
            </Link>
          )}
        </div>

        <Card className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
          {loading && !data && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <Spinner className="h-7 w-7" />
              <p className="text-sm">Loading conversation…</p>
            </div>
          )}

          {!loading && loadError && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center px-6">
              <MessageCircle className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground max-w-sm">{loadError}</p>
              <Button variant="outline" onClick={load}>
                <RefreshCcw className="h-4 w-4" /> Retry
              </Button>
            </div>
          )}

          {!loading && !loadError && grouped.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center px-6">
              <MessageCircle className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No messages yet — say hello!</p>
            </div>
          )}

          {grouped.length > 0 && (() => {
            let msgIndex = -1;
            return (
              <div className="space-y-3">
                {grouped.map((group) => (
                  <div key={group.date} className="space-y-3">
                    <div className="sticky top-0 z-10 flex justify-center pt-1">
                      <span className="rounded-full border border-border bg-card px-3 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {dayLabel(new Date(group.date))}
                      </span>
                    </div>
                    {group.messages.map((m) => {
                      msgIndex += 1;
                      const isMine = m.senderId === user?.id;
                      const readFromInitialFetch = m.deliveryStatuses?.some((d) => d.status === 'read');
                      const readFromLiveWatermark = watermarkIndex >= 0 && msgIndex <= watermarkIndex;
                      const readByOther = readFromInitialFetch || readFromLiveWatermark;
                      const isDelivered =
                        readByOther || deliveryUpdates[m.id] === 'delivered' || m.deliveryStatuses?.some((d) => d.status !== 'sent');

                      return (
                        <div key={m.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
                          <div
                            className={cn(
                              'max-w-[75%] rounded-2xl px-4 py-2 text-sm',
                              isMine ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-secondary rounded-bl-sm',
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.content}</p>
                            <div className={cn('flex items-center gap-1 mt-1', isMine ? 'justify-end' : 'justify-start')}>
                              <span className="text-[10px] opacity-70">
                                {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {isMine && !isDelivered && <Check className="h-3 w-3 opacity-70" />}
                              {isMine && isDelivered && (
                                <CheckCheck className={cn('h-3 w-3', readByOther ? 'opacity-100' : 'opacity-50')} />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {isOtherTyping && (
                  <div className="flex justify-start">
                    <div className="bg-secondary rounded-2xl rounded-bl-sm px-4 py-2 text-xs text-muted-foreground italic">typing…</div>
                  </div>
                )}
              </div>
            );
          })()}
        </Card>

        <div className="flex items-center gap-2 pt-3">
          <EmojiPicker
            onPick={(emoji) => setDraft((d) => d + emoji)}
            disabled={!!loadError && !data}
          />
          <textarea
            className="flex-1 h-11 max-h-32 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Type a message…"
            maxLength={2000}
            disabled={!!loadError}
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button size="icon" onClick={handleSend} disabled={!draft.trim() || !!loadError} aria-label="Send message">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
