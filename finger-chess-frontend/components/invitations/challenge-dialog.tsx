'use client';

import { useState } from 'react';
import { toast } from 'sonner';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MatchSettings, type ColorPreference } from '@/components/lobby/match-settings';
import { TIME_CONTROLS } from '@/lib/time-controls';
import { Swords } from 'lucide-react';

const CHALLENGE_FEES = [0, 5, 10, 25, 50, 100];

interface ChallengeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opponentId: string;
  opponentName: string;
}

/**
 * Compose a friend challenge: time control, rated/casual, preferred color,
 * stake (free or paid) and an optional note. The recipient has ~60 seconds
 * to accept before the challenge expires. Only friends can be challenged —
 * this is enforced server-side too, so the button should only be offered
 * on friend surfaces.
 */
export function ChallengeDialog({ open, onOpenChange, opponentId, opponentName }: ChallengeDialogProps) {
  const [timeControlId, setTimeControlId] = useState(TIME_CONTROLS[2].id);
  const [entryFee, setEntryFee] = useState(0);
  const [rated, setRated] = useState(true);
  const [colorPreference, setColorPreference] = useState<ColorPreference>('random');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await api.post('/social/invitations', {
        recipientId: opponentId,
        timeControlId,
        entryFee,
        rated,
        colorPreference,
        message: message.trim() ? message.trim() : undefined,
      });
      toast.success('Challenge sent');
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not send challenge');
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary" /> Challenge {opponentName}
          </DialogTitle>
          <DialogDescription>
            Set the rules — {opponentName} has 60 seconds to accept. Paid challenges require KYC.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <Label className="text-sm font-medium text-muted-foreground mb-2 block">Time Control</Label>
            <Select value={timeControlId} onValueChange={setTimeControlId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_CONTROLS.map((tc) => (
                  <SelectItem key={tc.id} value={tc.id}>
                    {tc.label} — {tc.category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium text-muted-foreground mb-2 block">Stake</Label>
            <div className="grid grid-cols-6 gap-2">
              {CHALLENGE_FEES.map((fee) => (
                <button
                  key={fee}
                  type="button"
                  onClick={() => setEntryFee(fee)}
                  className={
                    'rounded-md border px-2 py-2 text-center font-mono text-sm transition-colors' +
                    (entryFee === fee ? ' border-primary bg-primary/10 text-primary' : ' border-border hover:border-primary/40')
                  }
                >
                  {fee === 0 ? 'Free' : `$${fee}`}
                </button>
              ))}
            </div>
          </div>

          <MatchSettings rated={rated} onRatedChange={setRated} colorPreference={colorPreference} onColorPreferenceChange={setColorPreference} />

          <div>
            <Label className="text-sm font-medium text-muted-foreground mb-2 block">Message (optional)</Label>
            <textarea
              className="w-full min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder={`Say something to ${opponentName}...`}
              maxLength={300}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={send} disabled={sending}>
            {sending ? 'Sending...' : 'Send Challenge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
