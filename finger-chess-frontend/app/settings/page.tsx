'use client';

import { useEffect, useState, ChangeEvent } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { LoadingPanel } from '@/components/ui/spinner';
import { PageHeader } from '@/components/ui/page-header';
import { ShieldCheck, Smartphone, Monitor, LogOut } from 'lucide-react';

interface Session {
  id: string;
  deviceLabel: string | null;
  ipAddress: string | null;
  isTrustedDevice: boolean;
  lastUsedAt: string;
  createdAt: string;
}

export default function SettingsPage() {
  const { user, refreshUser, logout } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [twoFactorDialogOpen, setTwoFactorDialogOpen] = useState(false);

  useEffect(() => {
    if (user?.fullName) setFullName(user.fullName);
    if (user?.bio) setBio(user.bio);
    api.get('/auth/sessions').then(({ data }) => setSessions(data));
  }, [user]);

  async function saveProfile() {
    setSaving(true);
    try {
      await api.patch('/users/me', { fullName, bio });
      await refreshUser();
      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post('/uploads/avatar', formData);
      await refreshUser();
      toast.success('Avatar updated');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Upload failed');
    } finally {
      setUploadingAvatar(false);
      e.target.value = ''; // allow re-selecting the same file next time
    }
  }

  async function revokeSession(id: string) {
    await api.delete(`/auth/sessions/${id}`);
    setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
    toast.success('Session revoked');
  }

  async function logoutAllDevices() {
    await api.post('/auth/logout-all');
    logout();
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader title="Settings" description="Your account, security, and privacy preferences." />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
            <CardDescription>Basic account information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Avatar className="h-16 w-16 border border-border">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName ?? 'You'} />}
                  <AvatarFallback className="bg-primary/15 text-primary text-lg">
                    {(user?.fullName || user?.email || '??').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {uploadingAvatar && (
                  <div className="absolute inset-0 rounded-full bg-background/70 flex items-center justify-center">
                    <span className="text-[10px] text-muted-foreground">…</span>
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="avatarUpload" className="cursor-pointer">
                  <span className="inline-flex items-center rounded-md border border-border bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/70 transition-colors">
                    Change avatar
                  </span>
                </Label>
                <input id="avatarUpload" type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarUpload} />
                <p className="text-xs text-muted-foreground mt-1">JPEG, PNG, or WebP — up to 3MB.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={user?.email ?? ''} disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bio">Bio</Label>
              <textarea
                id="bio"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                maxLength={300}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell other players a bit about yourself…"
              />
              <p className="text-xs text-muted-foreground text-right">{bio.length}/300</p>
            </div>
            <Button onClick={saveProfile} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Two-Factor Authentication
            </CardTitle>
            <CardDescription>Require a code from your authenticator app on every sign-in.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setTwoFactorDialogOpen(true)}>
              Set up 2FA
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Privacy &amp; Social</CardTitle>
            <CardDescription>Control who can message you, send friend requests, and see your profile.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" asChild>
              <Link href="/settings/verification">Identity Verification</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/settings/privacy">Privacy Settings</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/settings/blocked">Blocked Users</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Sessions</CardTitle>
            <CardDescription>Devices currently signed in to your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessions === null ? (
              <LoadingPanel className="py-6" />
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    {s.deviceLabel?.toLowerCase().includes('mobile') ? (
                      <Smartphone className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Monitor className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <div className="text-sm">{s.deviceLabel ?? 'Unknown device'}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {s.ipAddress ?? '—'} · last used {new Date(s.lastUsedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {s.isTrustedDevice && <Badge variant="secondary">This device</Badge>}
                  <Button variant="ghost" size="sm" onClick={() => revokeSession(s.id)}>
                    Revoke
                  </Button>
                </div>
              ))
            )}
            <Separator />
            <Button variant="outline" className="text-destructive hover:text-destructive" onClick={logoutAllDevices}>
              <LogOut className="h-4 w-4" /> Sign out of all devices
            </Button>
          </CardContent>
        </Card>
      </div>

      <TwoFactorSetupDialog open={twoFactorDialogOpen} onOpenChange={setTwoFactorDialogOpen} />
    </AppShell>
  );
}

function TwoFactorSetupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [step, setStep] = useState<'start' | 'confirm' | 'done'>('start');
  const [qrCode, setQrCode] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  async function startSetup() {
    const { data } = await api.post('/auth/2fa/setup');
    setQrCode(data.qrCodeDataUrl);
    setStep('confirm');
  }

  async function confirmSetup() {
    try {
      const { data } = await api.post('/auth/2fa/confirm', { code });
      setBackupCodes(data.backupCodes);
      setStep('done');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Invalid code');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setStep('start');
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Two-Factor Authentication</DialogTitle>
          <DialogDescription>
            {step === 'start' && 'Scan a QR code with your authenticator app to get started.'}
            {step === 'confirm' && 'Scan this code, then enter the 6-digit code it generates.'}
            {step === 'done' && 'Save these backup codes somewhere safe — each works once if you lose your device.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'start' && <Button onClick={startSetup}>Generate QR Code</Button>}

        {step === 'confirm' && (
          <div className="space-y-4">
            {qrCode && <img src={qrCode} alt="2FA QR code" className="mx-auto rounded-md border border-border" />}
            <Input
              className="font-mono text-center tracking-widest"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
            />
            <Button className="w-full" onClick={confirmSetup}>
              Confirm &amp; Enable
            </Button>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {backupCodes.map((c) => (
                <div key={c} className="bg-secondary rounded px-2 py-1.5 text-center">
                  {c}
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
