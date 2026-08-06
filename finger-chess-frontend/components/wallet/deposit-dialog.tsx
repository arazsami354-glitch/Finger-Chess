'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { getStripe } from '@/lib/stripe';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const PRESET_AMOUNTS = [25, 50, 100, 250];

export function DepositDialog({
  open,
  onOpenChange,
  kycVerified,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kycVerified: boolean;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState(50);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startDeposit() {
    setLoading(true);
    try {
      const { data } = await api.post('/payments/deposit/initiate', { amount, currency: 'USD' });
      setClientSecret(data.clientSecret);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not start deposit');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setClientSecret(null);
    setAmount(50);
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
          <DialogTitle>Deposit funds</DialogTitle>
          <DialogDescription>Funds land in your available balance as soon as the payment confirms.</DialogDescription>
        </DialogHeader>

        {!kycVerified ? (
          <div className="rounded-md border border-warn/30 bg-warn/10 p-4 text-sm text-warn">
            Identity verification is required before depositing.{' '}
            <Link href="/settings/verification" className="underline">
              Verify your identity
            </Link>
            .
          </div>
        ) : !clientSecret ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {PRESET_AMOUNTS.map((a) => (
                <button
                  key={a}
                  onClick={() => setAmount(a)}
                  className={`rounded-md border py-2 text-sm font-mono transition-colors ${
                    amount === a ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'
                  }`}
                >
                  ${a}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Custom amount</Label>
              <Input id="amount" type="number" min={1} step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <Button className="w-full" onClick={startDeposit} disabled={loading || amount <= 0}>
              {loading ? 'Preparing…' : `Continue to payment — $${amount.toFixed(2)}`}
            </Button>
          </div>
        ) : (
          <Elements stripe={getStripe()} options={{ clientSecret, appearance: { theme: 'night' } }}>
            <DepositPaymentForm onSuccess={onSuccess} />
          </Elements>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DepositPaymentForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    setSubmitting(false);

    if (error) {
      toast.error(error.message ?? 'Payment failed');
      return;
    }

    // The wallet credit itself happens server-side via the Stripe webhook —
    // this success path just confirms the payment cleared on Stripe's end.
    toast.success('Payment confirmed — your balance will update momentarily.');
    onSuccess();
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      <Button className="w-full" onClick={handleConfirm} disabled={!stripe || submitting}>
        {submitting ? 'Confirming…' : 'Confirm payment'}
      </Button>
    </div>
  );
}
