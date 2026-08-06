'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { SocialProvider, useSocial } from '@/components/providers/social-provider';
import { ThemeToggle } from './theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { KycStatusBadge } from '@/components/kyc-status-badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PresenceStatusPicker } from '@/components/social/presence-status-picker';
import { IncomingInvitationDialog } from '@/components/invitations/incoming-invitation-dialog';
import { api } from '@/lib/api';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { FingerChessLogo } from '@/components/brand/logo';
import {
  LayoutDashboard,
  Wallet,
  Swords,
  User,
  Trophy,
  Settings,
  ShieldCheck,
  LogOut,
  Users,
  MessageCircle,
  Bell,
  Search,
  Menu,
  X,
  CircleUser,
  Award,
  Send,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/lobby', label: 'Play', icon: Swords },
  { href: '/friends', label: 'Friends', icon: Users },
  { href: '/invitations', label: 'Invitations', icon: Send },
  { href: '/messages', label: 'Messages', icon: MessageCircle },
  { href: '/search', label: 'Search Players', icon: Search },
  { href: '/tournaments', label: 'Tournaments', icon: Award },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/settings', label: 'Settings', icon: Settings },
];

// The five destinations worth a thumb on mobile — the rest live in the drawer.
const MOBILE_PRIMARY_NAV = ['/dashboard', '/lobby', '/friends', '/messages', '/wallet'];

const ADMIN_ROLES = ['support_agent', 'finance_admin', 'super_admin'];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [complianceChecked, setComplianceChecked] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function checkCompliance() {
      try {
        const [ageStatus, rulesStatus] = await Promise.all([
          api.get('/compliance/age').then((r) => r.data),
          api.get('/compliance/rules').then((r) => r.data),
        ]);
        if (cancelled) return;

        // Age comes first — accepting rules before we even know who you are
        // doesn't make sense, and the age interstitial itself links onward
        // into the rules page once submitted.
        if (!ageStatus.hasProvidedAge) {
          router.replace('/onboarding/age');
          return;
        }
        if (!rulesStatus.hasAcceptedCurrentVersion) {
          router.replace('/onboarding/rules');
          return;
        }
        setComplianceChecked(true);
      } catch {
        // A transient failure here shouldn't lock a user out of the app
        // entirely — the real enforcement happens server-side at every
        // money/paid-match action regardless of whether this client-side
        // gate ran successfully.
        setComplianceChecked(true);
      }
    }

    checkCompliance();
    return () => {
      cancelled = true;
    };
  }, [user, router]);

  if (loading || !user || !complianceChecked) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-muted-foreground">
        <FingerChessLogo className="h-10 w-10 text-primary" />
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <SocialProvider>
      <AppShellInner>{children}</AppShellInner>
    </SocialProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const { user, wallet, logout } = useAuth();
  const { notificationCount, incomingMessages, pendingInvitationCount, refreshPendingInvitationCount } = useSocial();
  const pathname = usePathname();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    api.get('/social/messages/unread-count').then(({ data }) => setUnreadMessages(data.count)).catch(() => {});
  }, [pathname]);

  // Keep the pending-challenge badge live — refresh on every route change and
  // whenever the socket reports a new incoming invitation.
  useEffect(() => {
    refreshPendingInvitationCount();
  }, [pathname, refreshPendingInvitationCount]);

  // Keep the nav badge live while the app is open — a message arriving
  // anywhere (another tab's conversation, an opponent in a game chat)
  // bumps the counter without waiting for a route change.
  useEffect(() => {
    api.get('/social/messages/unread-count').then(({ data }) => setUnreadMessages(data.count)).catch(() => {});
  }, [incomingMessages.length]);

  // Close the mobile drawer on navigation so it never lingers over the next page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Escape closes the mobile drawer, matching every other overlay in the app.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  // Lock body scroll while the drawer is open — a long nav list shouldn't
  // scroll the page underneath it.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  if (!user) return null;
  const initials = (user.fullName || user.email).slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex">
      {/* Global live challenge popup — appears when a friend challenges you. */}
      <IncomingInvitationDialog />

      {/* Skip link — lets keyboard users jump straight past navigation. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:shadow-premium"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-border">
          <FingerChessLogo className="h-6 w-6 text-primary" />
          <span className="font-display font-bold">Finger Chess</span>
        </div>

        <nav className="flex-1 py-4 space-y-0.5 px-3" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const badgeCount =
              item.href === '/messages' ? unreadMessages : item.href === '/invitations' ? pendingInvitationCount : undefined;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition-all duration-200 ease-premium',
                  active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                )}
              >
                <span className="flex items-center gap-3">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </span>
                {!!badgeCount && (
                  <Badge variant="destructive" className="h-5 min-w-5 px-1 justify-center">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </Badge>
                )}
              </Link>
            );
          })}

          {ADMIN_ROLES.includes(user.role) && (
            <Link
              href="/admin"
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors mt-2 pt-2 border-t border-border',
                pathname === '/admin' ? 'text-gold font-medium' : 'text-muted-foreground hover:text-gold',
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              Admin
            </Link>
          )}
        </nav>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 glass-panel flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30 border-t-0 border-x-0">
          <div className="md:hidden flex items-center gap-2">
            <FingerChessLogo className="h-6 w-6 text-primary" />
            <span className="font-display font-bold">Finger Chess</span>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1 sm:gap-3">
            <Link
              href="/wallet"
              aria-label={`Available balance ${wallet ? `$${wallet.available.toFixed(2)}` : '—'}`}
              className="hidden sm:flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 hover:border-primary/50 transition-colors"
            >
              <Wallet className="h-3.5 w-3.5 text-primary" />
              <span className="font-mono text-sm font-medium">${wallet ? wallet.available.toFixed(2) : '—'}</span>
            </Link>

            <Link
              href="/wallet"
              aria-label={`Available balance ${wallet ? `$${wallet.available.toFixed(2)}` : '—'}`}
              className="sm:hidden p-2 rounded-md hover:bg-secondary transition-colors"
            >
              <Wallet className="h-4 w-4" />
            </Link>

            <Link
              href="/notifications"
              aria-label={`Notifications${notificationCount > 0 ? ` (${notificationCount} unread)` : ''}`}
              className="relative p-2 rounded-md hover:bg-secondary transition-colors"
            >
              <Bell className="h-4 w-4" />
              {notificationCount > 0 && (
                <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />
              )}
            </Link>

            <PresenceStatusPicker />

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="rounded-full outline-none" aria-label="Account menu">
                  <Avatar className="h-8 w-8 border border-border">
                    <AvatarFallback className="text-xs bg-primary/15 text-primary">{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <div className="px-2 py-1.5">
                  <div className="text-sm font-medium truncate max-w-[200px]">{user.email}</div>
                  <KycStatusBadge status={user.kycStatus} className="mt-1" />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile">Profile</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mobile nav toggle */}
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={mobileNavOpen}
              className="md:hidden p-2 rounded-md hover:bg-secondary transition-colors"
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </header>

        <main id="main-content" className="flex-1 board-texture">
          <div className="container py-8 pb-24 md:pb-8">{children}</div>
        </main>
      </div>

      {/* Mobile bottom nav — the five most-used destinations, thumb-reachable. */}
      <nav
        aria-label="Quick navigation"
        className="fixed bottom-0 inset-x-0 z-30 md:hidden glass-panel border-x-0 border-b-0 grid grid-cols-5"
      >
        {NAV_ITEMS.filter((item) => MOBILE_PRIMARY_NAV.includes(item.href)).map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const badgeCount =
            item.href === '/messages' ? unreadMessages : item.href === '/invitations' ? pendingInvitationCount : undefined;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
              {!!badgeCount && (
                <span className="absolute top-1 right-[22%] flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-white">
                  {badgeCount > 9 ? '9+' : badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Mobile navigation drawer */}
      <div className={cn('fixed inset-0 z-40 md:hidden', !mobileNavOpen && 'pointer-events-none')} aria-hidden={!mobileNavOpen}>
        <div
          onClick={() => setMobileNavOpen(false)}
          className={cn(
            'absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ease-premium',
            mobileNavOpen ? 'opacity-100' : 'opacity-0',
          )}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={cn(
            'absolute inset-y-0 left-0 w-72 max-w-[85vw] flex flex-col bg-card border-r border-border shadow-premium-lg transition-transform duration-300 ease-premium',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="h-16 flex items-center justify-between px-5 border-b border-border">
            <div className="flex items-center gap-2">
              <FingerChessLogo className="h-6 w-6 text-primary" />
              <span className="font-display font-bold">Finger Chess</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="p-1.5 rounded-md hover:bg-secondary transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 border border-border">
                {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName ?? 'You'} />}
                <AvatarFallback className="text-xs bg-primary/15 text-primary">{initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{user.fullName || user.email}</div>
                <div className="font-mono text-xs text-primary">${wallet ? wallet.available.toFixed(2) : '—'} available</div>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5" aria-label="All navigation">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              const badgeCount =
                item.href === '/messages' ? unreadMessages : item.href === '/invitations' ? pendingInvitationCount : undefined;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200 ease-premium',
                    active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </span>
                  {!!badgeCount && (
                    <Badge variant="destructive" className="h-5 min-w-5 px-1 justify-center">
                      {badgeCount > 9 ? '9+' : badgeCount}
                    </Badge>
                  )}
                </Link>
              );
            })}

            {ADMIN_ROLES.includes(user.role) && (
              <Link
                href="/admin"
                onClick={() => setMobileNavOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors mt-2 pt-2 border-t border-border',
                  pathname === '/admin' ? 'text-gold font-medium' : 'text-muted-foreground hover:text-gold',
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                Admin
              </Link>
            )}
          </nav>

          <div className="border-t border-border p-3">
            <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={logout}>
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
