import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';

export const ADMIN_ROLES = ['support_agent', 'moderator', 'finance_admin', 'super_admin'] as const;

const ALL = [...ADMIN_ROLES];
const MODERATE_UP = ['moderator', 'finance_admin', 'super_admin'];
const FINANCE_UP = ['finance_admin', 'super_admin'];
const SUPER_ONLY = ['super_admin'];

/**
 * Every entry here was verified against the actual `@Roles(...)` decorator
 * on the real controller endpoint (grepped across the whole backend, not
 * recalled from memory) at the time this was written. If a controller's
 * role requirements change, this reference needs updating alongside it —
 * it is not derived automatically from the decorators at runtime, which
 * would be a meaningfully larger undertaking (reflection over the Nest
 * metadata system) than what a reference page needs. Stated plainly here
 * rather than implied.
 */
const PERMISSIONS_MATRIX = [
  {
    area: 'User Management',
    actions: [
      { action: 'View user list, profile detail, penalty & rule-acceptance history', roles: ALL },
      { action: 'Issue a warning', roles: ALL },
      { action: 'Ban, suspend, reactivate, unban, or unsuspend an account', roles: FINANCE_UP },
      { action: 'Mute or unmute chat', roles: FINANCE_UP },
      { action: 'Reset password / force logout', roles: FINANCE_UP },
    ],
  },
  {
    area: 'Wallet & Payments',
    actions: [
      { action: 'Review withdrawals, refunds, fraud signals, and reconciliation drifts', roles: FINANCE_UP },
      { action: 'View the deposits / transactions / withdrawals ledgers', roles: FINANCE_UP },
    ],
  },
  {
    area: 'Identity Verification (KYC)',
    actions: [{ action: 'Review, approve, reject, or request more information on submitted documents', roles: FINANCE_UP }],
  },
  {
    area: 'Risk & Security',
    actions: [{ action: 'View risk scores and the high-risk account queue', roles: FINANCE_UP }],
  },
  {
    area: 'Game Monitoring',
    actions: [
      { action: 'View live games, finished-game history, and move replays', roles: ALL },
      { action: 'View the anti-cheat flagged-game queue', roles: MODERATE_UP },
      { action: 'Review an anti-cheat report (confirm cheating / clear)', roles: FINANCE_UP },
      { action: 'Cancel a waiting/ongoing game', roles: FINANCE_UP },
    ],
  },
  {
    area: 'Financial Reports',
    actions: [{ action: 'Revenue summary, commission by tier, deposit/withdrawal volumes', roles: FINANCE_UP }],
  },
  {
    area: 'Support Tickets',
    actions: [{ action: 'View, assign, reply to, resolve, and close support tickets', roles: ALL }],
  },
  {
    area: 'Player Reports & Moderation',
    actions: [
      { action: 'View the player/message report queue', roles: ALL },
      { action: 'Review a report (action or dismiss)', roles: FINANCE_UP },
    ],
  },
  {
    area: 'Dashboard & Logs',
    actions: [
      { action: 'View the dashboard overview', roles: ALL },
      { action: 'View admin audit logs and security event logs', roles: SUPER_ONLY },
    ],
  },
] as const;

const ROLE_DESCRIPTIONS: Record<(typeof ADMIN_ROLES)[number], string> = {
  support_agent:
    'Front-line support — can see everything needed to help a player (their account, tickets, reports, live games) and can issue warnings, but cannot move money, take account-restricting action, or see audit/security logs.',
  moderator:
    'Day-to-day moderation — everything a support agent can do plus the live anti-cheat queue and a stricter view of game monitoring, while money, account-restricting action, KYC, and audit/security logs stay above this tier.',
  finance_admin:
    'Full operational control — everything a moderator can do, plus every account-restricting and money-related action (bans, suspensions, withdrawal/refund review, KYC review, risk review) — everything except the platform-level audit trail itself.',
  super_admin:
    'Full access, including the admin audit trail and security event log — the only role that can see who-did-what across the platform, not just act on it.',
};

@Controller('admin/roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('support_agent', 'moderator', 'finance_admin', 'super_admin')
export class AdminRolesController {
  @Get('permissions')
  getPermissions() {
    return { roles: ADMIN_ROLES, roleDescriptions: ROLE_DESCRIPTIONS, matrix: PERMISSIONS_MATRIX };
  }
}
