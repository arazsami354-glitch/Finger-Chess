'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function WithdrawDialog({
  open,
  onOpenChange,
  availableBalance,
  kycVerified,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  availableBalance: number;
  kycVerified: boolean;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('bank_transfer');
  const [loading, setLoading] = useState(false);

  function reset() {
    setAmount(0);
    setMethod('bank_transfer');
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      await api.post('/wallet/withdraw/request', { amount, payoutMethod: method });
      toast.success('Withdrawal requested — funds are held pending review.');
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Withdrawal request failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw funds</DialogTitle>
          <DialogDescription>Requests are held and reviewed before payout — usually within one business day.</DialogDescription>
        </DialogHeader>

        {!kycVerified ? (
          <div className="rounded-md border border-warn/30 bg-warn/10 p-4 text-sm text-warn">
            KYC verification is required before your first withdrawal.{' '}
            <Link href="/settings/verification" className="underline">
              Verify your identity
            </Link>
            .
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="withdrawAmount">Amount</Label>
              <Input
                id="withdrawAmount"
                type="number"
                min={1}
                max={availableBalance}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Available: ${availableBalance.toFixed(2)}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Payout method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="paypal">PayPal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleSubmit} disabled={loading || amount <= 0 || amount > availableBalance}>
              {loading ? 'Submitting…' : `Request withdrawal — $${amount.toFixed(2)}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
