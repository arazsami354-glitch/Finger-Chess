'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ProfilePage } from '@/components/profile/profile-page';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChallengeDialog } from '@/components/invitations/challenge-dialog';
import { UserPlus, MessageCircle, Star, Ban, Flag, Send } from 'lucide-react';
import type { PlayerProfile } from '@/lib/profile';

export default function PlayerProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportCategory, setReportCategory] = useState('harassment');
  const [reportDescription, setReportDescription] = useState('');
  const [challengeOpen, setChallengeOpen] = useState(false);

  async function refresh() {
    try {
      const { data } = await api.get<PlayerProfile>(`/social/players/${params.id}`);
      setProfile(data);
    } catch {
      setProfile(null);
    }
  }

  async function addFriend() {
    try {
      await api.post('/social/friends/requests', { receiverId: params.id });
      toast.success('Friend request sent');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not send request');
    }
  }

  async function toggleFavorite() {
    try {
      await api.post(`/social/friends/favorites/${params.id}`);
      await refresh();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not update favorite');
    }
  }

  async function message() {
    try {
      const { data } = await api.post('/social/messages/conversations', { recipientId: params.id });
      router.push(`/messages/${data.id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not open a conversation');
    }
  }

  async function block() {
    try {
      await api.post('/social/friends/block', { userId: params.id });
      toast.success('User blocked');
      router.push('/friends');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not block user');
    }
  }

  async function submitReport() {
    try {
      await api.post('/social/reports', { reportedUserId: params.id, category: reportCategory, description: reportDescription });
      toast.success('Report submitted — our team will review it');
      setReportOpen(false);
      setReportDescription('');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not submit report');
    }
  }

  const actions = profile ? (
    <div className="flex flex-wrap gap-2">
      {!profile.areFriends ? (
        <Button size="sm" onClick={addFriend}>
          <UserPlus className="h-4 w-4" /> Add Friend
        </Button>
      ) : (
        <Button size="sm" onClick={() => setChallengeOpen(true)}>
          <Send className="h-4 w-4" /> Challenge
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={message}>
        <MessageCircle className="h-4 w-4" /> Message
      </Button>
      <Button size="sm" variant="outline" onClick={toggleFavorite}>
        <Star className={`h-4 w-4 ${profile.isFavorited ? 'fill-gold text-gold' : ''}`} /> Favorite
      </Button>
      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={block}>
        <Ban className="h-4 w-4" /> Block
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setReportOpen(true)}>
        <Flag className="h-4 w-4" /> Report
      </Button>
    </div>
  ) : (
    <div className="flex flex-wrap gap-2 opacity-0" aria-hidden>
      <Button size="sm">Loading</Button>
    </div>
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6">
        <ProfilePage playerId={params.id} actions={actions} onProfileChange={setProfile} />
      </div>

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report this player</DialogTitle>
            <DialogDescription>Our moderation team reviews every report.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={reportCategory} onValueChange={setReportCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="harassment">Harassment</SelectItem>
                <SelectItem value="spam">Spam</SelectItem>
                <SelectItem value="impersonation">Impersonation</SelectItem>
                <SelectItem value="cheating">Cheating</SelectItem>
                <SelectItem value="match_manipulation">Match manipulation</SelectItem>
                <SelectItem value="inappropriate_content">Inappropriate content</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <textarea
              className="w-full min-h-24 rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Additional details (optional)"
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitReport}>
              Submit Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {profile && (
        <ChallengeDialog
          open={challengeOpen}
          onOpenChange={setChallengeOpen}
          opponentId={profile.id}
          opponentName={profile.fullName ?? 'this player'}
        />
      )}
    </AppShell>
  );
}
