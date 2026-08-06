import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SocialRealtimeService } from '../realtime/social-realtime.service';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: SocialRealtimeService,
  ) {}

  // ==========================================================================
  // BLOCK-AWARENESS HELPERS — every friend/message action checks this first
  // ==========================================================================

  async isBlocked(userAId: string, userBId: string): Promise<boolean> {
    const block = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: userAId, blockedId: userBId },
          { blockerId: userBId, blockedId: userAId },
        ],
      },
    });
    return block !== null;
  }

  async areFriends(userAId: string, userBId: string): Promise<boolean> {
    const [a, b] = [userAId, userBId].sort();
    const friendship = await this.prisma.friendship.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
    return friendship !== null;
  }

  // ==========================================================================
  // FRIEND REQUESTS
  // ==========================================================================

  async sendRequest(senderId: string, receiverId: string) {
    if (senderId === receiverId) throw new BadRequestException('You cannot send a friend request to yourself');
    if (await this.isBlocked(senderId, receiverId)) throw new ForbiddenException('Unable to send friend request');
    if (await this.areFriends(senderId, receiverId)) throw new ConflictException('You are already friends');

    const receiver = await this.prisma.user.findUnique({ where: { id: receiverId }, include: { privacySettings: true } });
    if (!receiver) throw new NotFoundException('User not found');

    const setting = receiver.privacySettings?.whoCanFriendRequest ?? 'everyone';
    if (setting === 'none') throw new ForbiddenException('This user is not accepting friend requests');
    if (setting === 'friends_of_friends') {
      const mutualCount = await this.countMutualFriends(senderId, receiverId);
      if (mutualCount === 0) throw new ForbiddenException('This user only accepts requests from mutual friends');
    }

    // If the receiver already sent one to the sender, auto-accept instead
    // of leaving two crossed pending requests sitting there.
    const reverse = await this.prisma.friendRequest.findFirst({ where: { senderId: receiverId, receiverId: senderId, status: 'pending' } });
    if (reverse) return this.respondToRequest(senderId, reverse.id, 'accept');

    const existing = await this.prisma.friendRequest.findFirst({ where: { senderId, receiverId, status: 'pending' } });
    if (existing) throw new ConflictException('A pending request already exists');

    // The partial unique index (sender_id, receiver_id) WHERE status='pending'
    // backs the duplicate check above; under a concurrent race two requests can
    // still both pass the read and one create loses. Turn that DB error into the
    // same clean 409 instead of leaking a 500.
    let request: Awaited<ReturnType<typeof this.prisma.friendRequest.create>>;
    try {
      request = await this.prisma.friendRequest.create({ data: { senderId, receiverId } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ConflictException('A pending request already exists');
      throw err;
    }

    const sender = await this.prisma.user.findUnique({ where: { id: senderId }, select: { fullName: true } });
    await this.notifications.send(
      receiverId,
      'in_app',
      'friend_request',
      'New friend request',
      `${sender?.fullName ?? 'Someone'} sent you a friend request`,
      { requestId: request.id, senderId },
      { groupKey: 'friend_request', actionUrl: '/friends', actorName: sender?.fullName ?? null },
    );
    this.realtime.emitToUser(receiverId, 'friendRequestReceived', { requestId: request.id, senderId });

    return request;
  }

  async cancelRequest(senderId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request || request.senderId !== senderId) throw new NotFoundException('Request not found');
    if (request.status !== 'pending') throw new BadRequestException('This request has already been resolved');

    return this.prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'cancelled', respondedAt: new Date() } });
  }

  async respondToRequest(receiverId: string, requestId: string, decision: 'accept' | 'decline') {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request || request.receiverId !== receiverId) throw new NotFoundException('Request not found');
    if (request.status !== 'pending') throw new BadRequestException('This request has already been resolved');

    if (decision === 'decline') {
      return this.prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'declined', respondedAt: new Date() } });
    }

    const [a, b] = [request.senderId, request.receiverId].sort();

    const [updated] = await this.prisma.$transaction([
      this.prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'accepted', respondedAt: new Date() } }),
      this.prisma.friendship.upsert({
        where: { userAId_userBId: { userAId: a, userBId: b } },
        create: { userAId: a, userBId: b },
        update: {},
      }),
    ]);

    const accepter = await this.prisma.user.findUnique({ where: { id: receiverId }, select: { fullName: true } });
    await this.notifications.send(
      request.senderId,
      'in_app',
      'friend_request_accepted',
      'Friend request accepted',
      `${accepter?.fullName ?? 'Your friend'} accepted your friend request`,
      { userId: receiverId },
      { groupKey: 'friend_request_accepted', actionUrl: '/friends', actorName: accepter?.fullName ?? null },
    );
    this.realtime.emitToUser(request.senderId, 'friendRequestAccepted', { userId: receiverId });

    return updated;
  }

  async removeFriend(userId: string, friendId: string) {
    const [a, b] = [userId, friendId].sort();
    const friendship = await this.prisma.friendship.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
    if (!friendship) throw new NotFoundException('You are not friends with this user');
    await this.prisma.friendship.delete({ where: { id: friendship.id } });
    return { success: true };
  }

  async listFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { createdAt: 'desc' },
    });

    const friendIds = friendships.map((f) => (f.userAId === userId ? f.userBId : f.userAId));
    const users = await this.prisma.user.findMany({
      where: { id: { in: friendIds } },
      select: { id: true, email: true, fullName: true, avatarKey: true },
    });
    return users;
  }

  async listPendingRequests(userId: string) {
    const [incoming, outgoing] = await Promise.all([
      this.prisma.friendRequest.findMany({
        where: { receiverId: userId, status: 'pending' },
        include: { sender: { select: { id: true, email: true, fullName: true, avatarKey: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.friendRequest.findMany({
        where: { senderId: userId, status: 'pending' },
        include: { receiver: { select: { id: true, email: true, fullName: true, avatarKey: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return { incoming, outgoing };
  }

  private async countMutualFriends(userAId: string, userBId: string): Promise<number> {
    const aFriends = await this.listFriends(userAId);
    const bFriendIds = new Set((await this.listFriends(userBId)).map((u) => u.id));
    return aFriends.filter((f) => bFriendIds.has(f.id)).length;
  }

  // ==========================================================================
  // BLOCK / UNBLOCK
  // ==========================================================================

  async blockUser(blockerId: string, blockedId: string, reason?: string) {
    if (blockerId === blockedId) throw new BadRequestException('You cannot block yourself');

    // Guard against the FK violation (P2003) the upsert would otherwise throw
    // for a nonexistent target — surface it as a clean 404 instead of a 500.
    const target = await this.prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.blockedUser.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId, reason },
        update: { reason },
      });

      // Blocking someone also ends any existing friendship and cancels any
      // pending request between them — a block is a hard boundary, not
      // just "don't let new requests through."
      const [a, b] = [blockerId, blockedId].sort();
      await tx.friendship.deleteMany({ where: { userAId: a, userBId: b } });
      await tx.friendRequest.updateMany({
        where: {
          status: 'pending',
          OR: [
            { senderId: blockerId, receiverId: blockedId },
            { senderId: blockedId, receiverId: blockerId },
          ],
        },
        data: { status: 'cancelled', respondedAt: new Date() },
      });
    });

    return { success: true };
  }

  async unblockUser(blockerId: string, blockedId: string) {
    await this.prisma.blockedUser.deleteMany({ where: { blockerId, blockedId } });
    return { success: true };
  }

  async listBlockedUsers(blockerId: string) {
    return this.prisma.blockedUser.findMany({
      where: { blockerId },
      include: { blocked: { select: { id: true, email: true, fullName: true, avatarKey: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================================================
  // FAVORITE OPPONENTS / RECENT PLAYERS / SUGGESTIONS
  // ==========================================================================

  async toggleFavoriteOpponent(userId: string, opponentId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: opponentId }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    const existing = await this.prisma.favoriteOpponent.findUnique({ where: { userId_opponentId: { userId, opponentId } } });
    if (existing) {
      await this.prisma.favoriteOpponent.delete({ where: { id: existing.id } });
      return { favorited: false };
    }
    await this.prisma.favoriteOpponent.create({ data: { userId, opponentId } });
    return { favorited: true };
  }

  async listFavoriteOpponents(userId: string) {
    const favorites = await this.prisma.favoriteOpponent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const ids = favorites.map((f) => f.opponentId);
    return this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, fullName: true, avatarKey: true } });
  }

  /** Recent opponents, derived from actual match history — no separate table to keep in sync. */
  async listRecentPlayers(userId: string, take = 20) {
    const games = await this.prisma.game.findMany({
      where: { OR: [{ playerWhiteId: userId }, { playerBlackId: userId }], status: 'completed' },
      orderBy: { endedAt: 'desc' },
      take: take * 2, // over-fetch since we dedupe opponents below
      select: { playerWhiteId: true, playerBlackId: true, endedAt: true },
    });

    const seen = new Map<string, Date>();
    for (const g of games) {
      const opponentId = g.playerWhiteId === userId ? g.playerBlackId : g.playerWhiteId;
      if (!seen.has(opponentId)) seen.set(opponentId, g.endedAt!);
      if (seen.size >= take) break;
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...seen.keys()] } },
      select: { id: true, email: true, fullName: true, avatarKey: true },
    });
    return users.map((u) => ({ ...u, lastPlayedAt: seen.get(u.id) }));
  }

  /** Simple friend suggestions: friends-of-friends, excluding existing friends/blocks/self, ranked by mutual count. */
  async suggestFriends(userId: string, take = 10) {
    const settings = await this.prisma.privacySettings.findUnique({ where: { userId } });
    if (settings && !settings.allowFriendSuggestions) return [];

    const myFriends = await this.listFriends(userId);
    const myFriendIds = new Set(myFriends.map((f) => f.id));

    const candidateCounts = new Map<string, number>();
    for (const friend of myFriends) {
      const theirFriends = await this.listFriends(friend.id);
      for (const candidate of theirFriends) {
        if (candidate.id === userId || myFriendIds.has(candidate.id)) continue;
        candidateCounts.set(candidate.id, (candidateCounts.get(candidate.id) ?? 0) + 1);
      }
    }

    const blocked = await this.prisma.blockedUser.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    const blockedIds = new Set(blocked.flatMap((b) => [b.blockerId, b.blockedId]));

    const ranked = [...candidateCounts.entries()]
      .filter(([id]) => !blockedIds.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, take);

    const users = await this.prisma.user.findMany({
      where: { id: { in: ranked.map(([id]) => id) } },
      select: { id: true, email: true, fullName: true, avatarKey: true },
    });
    const countById = new Map(ranked);
    return users.map((u) => ({ ...u, mutualFriends: countById.get(u.id) ?? 0 })).sort((a, b) => b.mutualFriends - a.mutualFriends);
  }

  // ==========================================================================
  // SEARCH
  // ==========================================================================

  async searchPlayers(query: string, requestingUserId: string, take = 20) {
    const blocked = await this.prisma.blockedUser.findMany({ where: { OR: [{ blockerId: requestingUserId }, { blockedId: requestingUserId }] } });
    const blockedIds = new Set(blocked.flatMap((b) => [b.blockerId, b.blockedId]));

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { id: { notIn: [...blockedIds, requestingUserId] } },
          { status: 'active' },
          { OR: [{ email: { contains: query, mode: 'insensitive' } }, { fullName: { contains: query, mode: 'insensitive' } }] },
        ],
      },
      select: { id: true, email: true, fullName: true, avatarKey: true },
      take,
    });
    return users;
  }
}
