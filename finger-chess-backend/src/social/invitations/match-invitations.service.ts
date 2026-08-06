import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { PresenceService } from '../presence/presence.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SocialRealtimeService } from '../realtime/social-realtime.service';
import { getTimeControl } from '../../game/config/time-controls';
import { EntryFeeTier, isValidEntryFee, requiresKyc } from '../../matchmaking/config/entry-fees';
import { ColorPreference, resolveColors } from '../../matchmaking/config/color-preference';

/**
 * A friend challenge: sender picks a time control, rated/casual, entry fee
 * and preferred color, and the recipient has a short window to accept before
 * the invitation expires. Accepting immediately creates a 'waiting' Game row
 * exactly like matchmaking does — both players then join /play/:gameId and
 * the game gateway's normal startGameIfWaiting() path takes over (fee holds
 * included). We deliberately do NOT inject GameService here: GameModule
 * already imports SocialModule, so depending on it back would be circular.
 */

const INVITATION_TTL_MS = 60_000; // the recipient's countdown window
const ACTIVE_GAME_STATUSES = ['waiting', 'ongoing'] as const;

export interface InvitationWithUsers {
  id: string;
  senderId: string;
  recipientId: string;
  timeControlId: string;
  entryFee: number;
  rated: boolean;
  colorPreference: string;
  message: string | null;
  status: string;
  gameId: string | null;
  expiresAt: Date;
  createdAt: Date;
  respondedAt: Date | null;
  sender?: { id: string; email: string; fullName: string | null; avatarKey: string | null };
  recipient?: { id: string; email: string; fullName: string | null; avatarKey: string | null };
}

@Injectable()
export class MatchInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friends: FriendsService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly realtime: SocialRealtimeService,
  ) {}

  // ==========================================================================
  // SEND
  // ==========================================================================

  async send(senderId: string, recipientId: string, opts: { timeControlId: string; entryFee: number; rated?: boolean; colorPreference?: ColorPreference; message?: string }) {
    if (senderId === recipientId) throw new BadRequestException('You cannot challenge yourself');
    getTimeControl(opts.timeControlId); // throws if unknown — fail fast before any DB work
    if (!isValidEntryFee(opts.entryFee)) throw new BadRequestException(`Invalid entry fee — must be one of the platform's fixed tiers`);

    const rated = opts.rated ?? true;
    const colorPreference = opts.colorPreference ?? 'random';

    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId } });
    if (!recipient) throw new NotFoundException('User not found');
    if (recipient.status !== 'active') throw new ForbiddenException('This account is not active');

    if (await this.friends.isBlocked(senderId, recipientId)) throw new ForbiddenException('Unable to challenge this player');

    // Only friends can be challenged — this is a friend-invitation feature,
    // and it doubles as a spam guard (strangers cannot ping you repeatedly).
    if (!(await this.friends.areFriends(senderId, recipientId))) {
      throw new ForbiddenException('You can only challenge friends');
    }

    await this.assertNoActiveGame(senderId);
    await this.assertNoActiveGame(recipientId);

    // The recipient must actually be reachable right now — a challenge is a
    // realtime exchange, not an inbox message. Offline players can't accept,
    // so sending them one would just strand it for 60s and then expire.
    if ((await this.presence.getPublicStatus(recipientId)) === 'offline') {
      throw new ConflictException('This player is offline right now — challenge them later');
    }

    await this.assertPaidEligible(senderId, opts.entryFee);
    await this.assertPaidEligible(recipientId, opts.entryFee);

    const pending = await this.prisma.matchInvitation.findFirst({
      where: { senderId, recipientId, status: 'pending' },
    });
    if (pending) throw new ConflictException('You already have a pending challenge with this player');

    // Same partial-unique-index + P2002 pattern as friend requests: the read
    // above races under concurrency, so a duplicate create becomes a clean
    // 409 instead of a leaked 500.
    let invitation: Awaited<ReturnType<typeof this.prisma.matchInvitation.create>>;
    try {
      invitation = await this.prisma.matchInvitation.create({
        data: {
          senderId,
          recipientId,
          timeControlId: opts.timeControlId,
          entryFee: opts.entryFee,
          rated,
          colorPreference,
          message: opts.message ?? null,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException('You already have a pending challenge with this player');
      throw err;
    }

    const sender = await this.prisma.user.findUnique({ where: { id: senderId }, select: { fullName: true } });
    await this.notifications.send(
      recipientId,
      'in_app',
      'match_invitation',
      'Match challenge',
      `${sender?.fullName ?? 'A friend'} challenged you to a match`,
      { invitationId: invitation.id, senderId, timeControlId: opts.timeControlId, entryFee: opts.entryFee, rated },
      { groupKey: `match_invitation:${senderId}`, actionUrl: '/invitations', actorName: sender?.fullName ?? null },
    );
    this.realtime.emitToUser(recipientId, 'invitationReceived', {
      invitationId: invitation.id,
      senderId,
      timeControlId: opts.timeControlId,
      entryFee: opts.entryFee,
      rated,
      colorPreference,
      message: opts.message ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
    });

    return invitation;
  }

  // ==========================================================================
  // ACCEPT / DECLINE / CANCEL
  // ==========================================================================

  async accept(recipientId: string, invitationId: string) {
    const invitation = await this.requirePendingForRecipient(invitationId, recipientId);

    if (invitation.expiresAt.getTime() < Date.now()) {
      await this.markExpired(invitation.id);
      throw new ConflictException('This challenge has expired');
    }

    // The recipient accepted, but the sender may have gone offline in the
    // seconds since the invitation was sent — a game needs both players to
    // join, so an offline sender is treated as an expired challenge.
    if ((await this.presence.getPublicStatus(invitation.senderId)) === 'offline') {
      await this.markExpired(invitation.id);
      throw new ConflictException('Your opponent went offline — the challenge has expired');
    }

    await this.assertNoActiveGame(invitation.senderId);
    await this.assertNoActiveGame(recipientId);

    const colors = resolveColors(invitation.colorPreference as ColorPreference, 'random');
    const senderIsWhite = colors.playerA === 'white';
    const game = await this.prisma.game.create({
      data: {
        playerWhiteId: senderIsWhite ? invitation.senderId : recipientId,
        playerBlackId: senderIsWhite ? recipientId : invitation.senderId,
        entryFee: invitation.entryFee,
        timeControl: invitation.timeControlId, // overwritten with the label by GameService.startGame
        rated: invitation.rated,
        status: 'waiting',
      },
    });

    const updated = await this.prisma.matchInvitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', gameId: game.id, respondedAt: new Date() },
    });

    await this.notifications.send(
      invitation.senderId,
      'in_app',
      'match_invitation_accepted',
      'Challenge accepted',
      'Your challenge was accepted — the match has started',
      { invitationId: invitation.id, gameId: game.id },
      { groupKey: 'match_invitation_accepted', actionUrl: `/play/${game.id}` },
    );
    this.realtime.emitToUser(invitation.senderId, 'invitationAccepted', {
      invitationId: invitation.id,
      gameId: game.id,
      opponentId: recipientId,
    });

    return { invitation: updated, gameId: game.id };
  }

  async decline(recipientId: string, invitationId: string) {
    const invitation = await this.requirePendingForRecipient(invitationId, recipientId);

    const updated = await this.prisma.matchInvitation.update({
      where: { id: invitation.id },
      data: { status: 'declined', respondedAt: new Date() },
    });

    this.realtime.emitToUser(invitation.senderId, 'invitationDeclined', { invitationId: invitation.id });
    return updated;
  }

  async cancel(senderId: string, invitationId: string) {
    const invitation = await this.prisma.matchInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.senderId !== senderId) throw new NotFoundException('Invitation not found');
    if (invitation.status !== 'pending') throw new BadRequestException('This invitation has already been resolved');

    const updated = await this.prisma.matchInvitation.update({
      where: { id: invitationId },
      data: { status: 'cancelled', respondedAt: new Date() },
    });

    this.realtime.emitToUser(invitation.recipientId, 'invitationCancelled', { invitationId: invitation.id });
    return updated;
  }

  // ==========================================================================
  // LIST + EXPIRY SWEEP
  // ==========================================================================

  async list(userId: string) {
    // Sweep anything that aged past its window so the center (and the
    // pending-badge count) never shows dead challenges. Runs on read rather
    // than on a timer — cheap (indexed updateMany) and always in sync.
    await this.prisma.matchInvitation.updateMany({
      where: { status: 'pending', expiresAt: { lt: new Date() } },
      data: { status: 'expired' },
    });

    const [incoming, outgoing] = await Promise.all([
      this.prisma.matchInvitation.findMany({
        where: { recipientId: userId },
        include: { sender: { select: { id: true, email: true, fullName: true, avatarKey: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.matchInvitation.findMany({
        where: { senderId: userId },
        include: { recipient: { select: { id: true, email: true, fullName: true, avatarKey: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      incoming: incoming.map((i) => this.toView(i)),
      outgoing: outgoing.map((i) => this.toView(i)),
    };
  }

  /** Used by the AppShell badge — count of challenges waiting on you right now. */
  async pendingCount(userId: string): Promise<number> {
    return this.prisma.matchInvitation.count({
      where: { recipientId: userId, status: 'pending', expiresAt: { gte: new Date() } },
    });
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private toView(i: {
    id: string;
    senderId: string;
    recipientId: string;
    timeControlId: string;
    entryFee: { toNumber(): number };
    rated: boolean;
    colorPreference: string;
    message: string | null;
    status: string;
    gameId: string | null;
    expiresAt: Date;
    createdAt: Date;
    respondedAt: Date | null;
    sender?: InvitationWithUsers['sender'];
    recipient?: InvitationWithUsers['recipient'];
  }): InvitationWithUsers {
    return {
      id: i.id,
      senderId: i.senderId,
      recipientId: i.recipientId,
      timeControlId: i.timeControlId,
      entryFee: i.entryFee.toNumber(),
      rated: i.rated,
      colorPreference: i.colorPreference,
      message: i.message,
      status: i.status,
      gameId: i.gameId,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      respondedAt: i.respondedAt,
      sender: i.sender,
      recipient: i.recipient,
    };
  }

  private async requirePendingForRecipient(invitationId: string, recipientId: string) {
    const invitation = await this.prisma.matchInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.recipientId !== recipientId) throw new NotFoundException('Invitation not found');
    if (invitation.status !== 'pending') throw new BadRequestException('This invitation has already been resolved');
    return invitation;
  }

  private async markExpired(invitationId: string) {
    await this.prisma.matchInvitation.update({
      where: { id: invitationId },
      data: { status: 'expired', respondedAt: new Date() },
    });
  }

  private async assertNoActiveGame(userId: string) {
    const active = await this.prisma.game.findFirst({
      where: {
        status: { in: [...ACTIVE_GAME_STATUSES] },
        OR: [{ playerWhiteId: userId }, { playerBlackId: userId }],
      },
    });
    if (active) throw new ConflictException('This player already has a game in progress');
  }

  /** Paid challenges carry the same compliance bar as paid matchmaking: verified KYC. Free invites bypass everything. */
  private async assertPaidEligible(userId: string, entryFee: number) {
    if (entryFee <= 0) return;
    if (!requiresKyc(entryFee as EntryFeeTier)) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.kycStatus !== 'verified') throw new ForbiddenException('KYC verification is required for paid matches');
  }
}
