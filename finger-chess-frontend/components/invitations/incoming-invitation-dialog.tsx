'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useSocial } from '@/components/providers/social-provider';
import { api } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Check, X } from 'lucide-react';

interface SenderProfile {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
}

/**
 * Rendered globally inside the AppShell. Auto-opens when a live challenge
 * arrives over the social socket, showing the sender, the rules, and a
 * countdown to expiry. Accepting creates the game and routes BOTH players
 * into it (the sender is navigated by the socket's invitationAccepted
 * handler); declining just resolves the invitation.
 */
export function IncomingInvitationDialog() {
  const router = useRouter();
  const { latestInvitation, refreshPendingInvitationCount, dismissLatestInvitation } = useSocial();
  const [sender, setSender] = useState<SenderProfile | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const dismissedFor = useRef<string | null>(null);

  // Auto-open only for invitations we haven't explicitly dismissed.
  useEffect(() => {
    if (!latestInvitation) {
      setOpen(false);
      return;
    }
    if (dismissedFor.current === latestInvitation.invitationId) return;
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestInvitation?.invitationId]);

  // Fetch the sender's profile for the dialog header.
  useEffect(() => {
    if (!latestInvitation || !open) return;
    let cancelled = false;
    setSender(null);
    api
      .get<SenderProfile>(`/social/players/${latestInvitation.senderId}`)
      .then(({ data }) => {
        if (!cancelled) setSender(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [latestInvitation, open]);

  // Live countdown to expiry; at zero, resolve as expired and refresh.
  useEffect(() => {
    if (!latestInvitation) return;
    const tick = () => {
      const ms = new Date(latestInvitation.expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining(0);
        setOpen(false);
        dismissLatestInvitation();
        refreshPendingInvitationCount();
        return;
      }
      setRemaining(Math.ceil(ms / 1000));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [latestInvitation, dismissLatestInvitation, refreshPendingInvitationCount]);

  if (!latestInvitation) return null;

  const invitation = latestInvitation;
  const displayName = sender?.fullName ?? 'A friend';

  async function accept() {
    setBusy(true);
    try {
      const { data } = await api.post<{ gameId: string }>(`/social/invitations/${invitation.invitationId}/accept`);
      toast.success('Challenge accepted — starting match');
      dismissedFor.current = invitation.invitationId;
      setOpen(false);
      refreshPendingInvitationCount();
      router.push(`/play/${data.gameId}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not accept challenge');
      if (err.response?.status === 409 || err.response?.status === 400) {
        dismissedFor.current = invitation.invitationId;
        setOpen(false);
        refreshPendingInvitationCount();
      }
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    try {
      await api.post(`/social/invitations/${invitation.invitationId}/decline`);
    } catch {
      // Best-effort — the invitation will expire server-side regardless.
    } finally {
      dismissedFor.current = invitation.invitationId;
      setOpen(false);
      refreshPendingInvitationCount();
      setBusy(false);
    }
  }

  function dismiss() {
    dismissedFor.current = invitation.invitationId;
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Avatar className="h-6 w-6 border border-border">
              {sender?.avatarUrl && <AvatarImage src={sender.avatarUrl} alt={displayName} />}
              <AvatarFallback className="text-[10px] bg-primary/15 text-primary">{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            {displayName} challenged you
          </DialogTitle>
          <DialogDescription>
            Accept to start immediately — you play{' '}
            {invitation.colorPreference === 'white'
              ? 'Black'
              : invitation.colorPreference === 'black'
                ? 'White'
                : 'White or Black (their choice was random)'}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{invitation.rated ? 'Rated' : 'Casual'}</Badge>
          <Badge variant="secondary">{invitation.entryFee > 0 ? `$${invitation.entryFee} stake` : 'Free play'}</Badge>
        </div>

        {invitation.message && <p className="text-sm text-muted-foreground italic">&ldquo;{invitation.message}&rdquo;</p>}

        <div className="text-sm text-muted-foreground">
          {remaining !== null && remaining > 0 ? (
            <>Expires in <span className="font-mono font-semibold text-foreground">{remaining}s</span></>
          ) : (
            <>This challenge has expired</>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={decline} disabled={busy}>
            <X className="h-4 w-4" /> Decline
          </Button>
          <Button onClick={accept} disabled={busy || (remaining !== null && remaining <= 0)}>
            <Check className="h-4 w-4" /> Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
