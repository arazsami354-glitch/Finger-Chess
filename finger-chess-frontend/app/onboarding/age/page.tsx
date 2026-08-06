'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FingerChessLogo } from '@/components/brand/logo';

export default function AgeOnboardingPage() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/compliance/age', { dateOfBirth });
      await refreshUser();
      router.push('/onboarding/rules');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not save your date of birth');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center board-texture px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 font-display font-bold text-xl mb-8">
          <FingerChessLogo className="h-6 w-6 text-primary" />
          Finger Chess
        </div>

        <Card>
          <CardHeader>
            <CardTitle>One quick thing</CardTitle>
            <CardDescription>
              We need your date of birth before you can continue. This is required for every player, and only ever
              affects real-money features — free matches are unaffected either way.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="dateOfBirth">Date of birth</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Saving…' : 'Continue'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
