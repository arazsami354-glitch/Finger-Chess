'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { FingerChessLogo } from '@/components/brand/logo';

// A curated list of common countries rather than the full ISO-3166 set —
// keeps the dropdown usable (Stripe/Revolut's own onboarding flows do the
// same rather than making someone scroll 195 entries), with country code
// values matching what the backend already stores in `countryCode`.
const COUNTRIES = [
  ['US', 'United States'], ['GB', 'United Kingdom'], ['CA', 'Canada'], ['AU', 'Australia'],
  ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
  ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'], ['FI', 'Finland'], ['IE', 'Ireland'],
  ['PT', 'Portugal'], ['PL', 'Poland'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['BE', 'Belgium'],
  ['NZ', 'New Zealand'], ['SG', 'Singapore'], ['JP', 'Japan'], ['KR', 'South Korea'], ['IN', 'India'],
  ['BR', 'Brazil'], ['MX', 'Mexico'], ['ZA', 'South Africa'], ['AE', 'United Arab Emirates'],
  ['IL', 'Israel'], ['PH', 'Philippines'],
] as const;

const ID_TYPES = [
  ['passport', 'Passport'],
  ['national_id', 'National ID'],
  ['drivers_license', "Driver's License"],
  ['health_card', 'Health Card'],
] as const;

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [preferredIdType, setPreferredIdType] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const passwordChecks = {
    length: password.length >= 8,
    upperLower: /(?=.*[a-z])(?=.*[A-Z])/.test(password),
    number: /\d/.test(password),
  };
  const passwordComplete = passwordChecks.length && passwordChecks.upperLower && passwordChecks.number;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await register(email, password, {
        fullName: fullName || undefined,
        dateOfBirth: dateOfBirth || undefined,
        countryCode: countryCode || undefined,
        preferredIdType: preferredIdType || undefined,
      });
      setDone(true);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center board-texture px-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-8">
            <CheckCircle2 className="h-10 w-10 text-primary mx-auto mb-4" />
            <h2 className="font-display font-semibold text-lg mb-2">Check your email</h2>
            <p className="text-sm text-muted-foreground mb-6">
              We sent a verification link to <span className="text-foreground">{email}</span>. Verify it, then sign in.
            </p>
            <Button asChild className="w-full">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center board-texture px-4 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 font-display font-bold text-xl mb-8">
          <FingerChessLogo className="h-6 w-6 text-primary" />
          Finger Chess
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>Create your account</CardTitle>
            <CardDescription>Two minutes to registered. A few more to verified and funded.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name (optional)</Label>
                <Input id="fullName" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dateOfBirth">Date of birth</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  required
                  autoComplete="bday"
                  max={new Date().toISOString().slice(0, 10)}
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Required to play real-money matches — you can still play free matches otherwise.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="country">Country</Label>
                  <Select value={countryCode} onValueChange={setCountryCode}>
                    <SelectTrigger id="country">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map(([code, name]) => (
                        <SelectItem key={code} value={code}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="idType">ID you have</Label>
                  <Select value={preferredIdType} onValueChange={setPreferredIdType}>
                    <SelectTrigger id="idType">
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {ID_TYPES.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Both optional now — used later to speed up identity verification when you&apos;re ready for real-money play.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}"
                  title="At least 8 characters, with an upper and lower case letter and a number"
                  autoComplete="new-password"
                  aria-invalid={password.length > 0 && !passwordComplete}
                  aria-describedby="password-checks"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {password.length > 0 && (
                  <div id="password-checks" className="flex gap-3 pt-1 text-xs">
                    <span className={passwordChecks.length ? 'text-primary' : 'text-muted-foreground'}>8+ chars</span>
                    <span className={passwordChecks.upperLower ? 'text-primary' : 'text-muted-foreground'}>Upper &amp; lower</span>
                    <span className={passwordChecks.number ? 'text-primary' : 'text-muted-foreground'}>Number</span>
                  </div>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating account…
                  </>
                ) : (
                  'Create account'
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                By registering you confirm you meet the minimum age and are playing from a jurisdiction where
                real-money skill gaming is permitted.
              </p>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
