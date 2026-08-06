import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { ModerationService } from '../moderation/moderation.service';
import { MessageEncryptionService } from './util/message-encryption.service';
import { SocialRealtimeService } from '../realtime/social-realtime.service';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friends: FriendsService,
    private readonly moderation: ModerationService,
    private readonly encryption: MessageEncryptionService,
    private readonly realtime: SocialRealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  // ==========================================================================
  // CONVERSATIONS
  // ==========================================================================

  /** Finds or creates the direct conversation between two users — one canonical conversation per pair, never duplicated. */
  async getOrCreateDirectConversation(userId: string, recipientId: string) {
    if (userId === recipientId) throw new ForbiddenException('Cannot message yourself');
    if (await this.friends.isBlocked(userId, recipientId)) throw new ForbiddenException('Unable to message this user');

    const recipient = await this.prisma.user.findUnique({ where: { id: recipientId }, include: { privacySettings: true } });
    if (!recipient) throw new NotFoundException('User not found');

    const messagePolicy = recipient.privacySettings?.whoCanMessage ?? 'friends';
    if (messagePolicy === 'none') throw new ForbiddenException('This user is not accepting messages');
    if (messagePolicy === 'friends' && !(await this.friends.areFriends(userId, recipientId))) {
      throw new ForbiddenException('You must be friends with this user to message them');
    }

    // Look for an existing direct conversation shared by exactly these two participants.
    const existing = await this.prisma.conversation.findFirst({
      where: {
        type: 'direct',
        participants: { every: { userId: { in: [userId, recipientId] } } },
        AND: [{ participants: { some: { userId } } }, { participants: { some: { userId: recipientId } } }],
      },
      include: { participants: true },
    });
    if (existing && existing.participants.length === 2) return existing;

    return this.prisma.conversation.create({
      data: {
        type: 'direct',
        participants: { create: [{ userId }, { userId: recipientId }] },
      },
      include: { participants: true },
    });
  }

  async listConversations(userId: string, query?: string) {
    const needle = query?.trim();
    const participations = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        ...(needle
          ? {
              // Conversation search: the only other member of a direct
              // conversation is the counterparty, so matching their
              // name/email on the participant join is exactly "search my
              // conversations."
              conversation: {
                participants: {
                  some: {
                    userId: { not: userId },
                    user: {
                      OR: [
                        { fullName: { contains: needle, mode: 'insensitive' } },
                        { email: { contains: needle, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              },
            }
          : {}),
      },
      include: {
        conversation: {
          include: {
            participants: { include: { user: { select: { id: true, email: true, fullName: true, avatarKey: true } } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { conversation: { lastMessageAt: 'desc' } },
    });

    const unreadCounts = await this.batchUnreadCounts(userId, participations);

    return participations.map((p) => {
      const otherParticipant = p.conversation.participants.find((cp) => cp.userId !== userId);
      return {
        conversationId: p.conversationId,
        type: p.conversation.type,
        otherUser: otherParticipant?.user,
        lastMessage: p.conversation.messages[0] ? this.decryptMessage(p.conversation.messages[0]) : null,
        unreadCount: unreadCounts.get(p.conversationId) ?? 0,
        isMuted: p.isMuted,
      };
    });
  }

  async getMessages(userId: string, conversationId: string, take = 50, cursor?: string) {
    await this.assertParticipant(userId, conversationId);

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { participants: { include: { user: { select: { id: true, email: true, fullName: true, avatarKey: true } } } } },
    });

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { deliveryStatuses: true },
    });

    return {
      conversationId,
      type: conversation.type,
      // The other party in a direct conversation — lets the client render a
      // header/presence without a second round-trip to the list endpoint.
      otherParticipant: conversation.participants.find((p) => p.userId !== userId)?.user ?? null,
      messages: messages.reverse().map((m) => this.decryptMessage(m)),
    };
  }

  /**
   * Message search across the user's own conversations. Content is encrypted
   * at rest (AES-256-GCM), so there is no indexed LIKE path — matching
   * happens over decrypted content in memory, newest-first, bounded to a
   * rolling window per conversation (newer messages are overwhelmingly the
   * ones users are looking for). The scan is confined to the requesting
   * user's conversations and, when a conversationId is supplied, that one
   * conversation — a user can never search outside their own history.
   */
  async searchMessages(userId: string, query: string, conversationId?: string, take = 30) {
    const needle = query.trim().toLowerCase();
    if (!needle || needle.length < 2) return { results: [], total: 0 };

    // Bound the decrypt-scan per conversation so a pathological backlog can't
    // turn one search into a full-table read. Newest-first bias is deliberate.
    const MAX_SCAN_PER_CONVERSATION = 300;
    const batchSize = 100;

    if (conversationId) await this.assertParticipant(userId, conversationId);

    const participations = await this.prisma.conversationParticipant.findMany({
      where: conversationId ? { conversationId, userId } : { userId },
      include: {
        conversation: {
          include: {
            participants: { include: { user: { select: { id: true, email: true, fullName: true, avatarKey: true } } } },
          },
        },
      },
    });

    const results: {
      id: string;
      conversationId: string;
      senderId: string;
      content: string;
      createdAt: Date;
      otherParticipant: { id: string; email: string; fullName: string | null; avatarKey: string | null } | null;
    }[] = [];

    for (const p of participations) {
      if (results.length >= take) break;
      const convId = p.conversationId;
      const otherParticipant = p.conversation.participants.find((cp) => cp.userId !== userId)?.user ?? null;

      let cursor: string | undefined;
      let scanned = 0;

      while (scanned < MAX_SCAN_PER_CONVERSATION && results.length < take) {
        const batch = await this.prisma.message.findMany({
          where: { conversationId: convId, contentType: 'text', deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: batchSize,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0) break;

        for (const raw of batch) {
          scanned++;
          const decrypted = this.decryptMessage(raw);
          if (decrypted.content.toLowerCase().includes(needle)) {
            results.push({
              id: decrypted.id,
              conversationId: convId,
              senderId: decrypted.senderId,
              content: decrypted.content,
              createdAt: decrypted.createdAt,
              otherParticipant,
            });
            if (results.length >= take) break;
          }
        }

        if (batch.length < batchSize) break;
        cursor = batch[batch.length - 1].id;
      }
    }

    return { results, total: results.length };
  }

  // ==========================================================================
  // SENDING
  // ==========================================================================

  async sendMessage(senderId: string, conversationId: string, rawContent: string) {
    await this.assertParticipant(senderId, conversationId);

    // Admin-imposed chat restriction (PenaltyRecord type='chat_mute') —
    // distinct from a user blocking/muting another user for their own view
    // (BlockedUser/MutedUser below). Checked first since it's the cheapest
    // check and the most likely to reject a request outright.
    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: senderId }, select: { chatMutedUntil: true } });
    if (sender.chatMutedUntil && sender.chatMutedUntil > new Date()) {
      throw new ForbiddenException(`You are restricted from sending messages until ${sender.chatMutedUntil.toISOString()}`);
    }

    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { participants: true },
    });

    const recipients = conversation.participants.filter((p) => p.userId !== senderId);
    for (const recipient of recipients) {
      if (await this.friends.isBlocked(senderId, recipient.userId)) {
        throw new ForbiddenException('Unable to send message');
      }
    }

    const moderationResult = await this.moderation.checkMessage(senderId, rawContent);
    if (!moderationResult.allowed) {
      throw new ForbiddenException(`Message blocked: ${moderationResult.reason}`);
    }

    const finalContent = moderationResult.filteredContent ?? rawContent;
    const encrypted = this.encryption.encrypt(finalContent);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId, senderId, content: encrypted, isFlagged: moderationResult.flagged },
      });

      await tx.messageDeliveryStatus.createMany({
        data: recipients.map((r) => ({ messageId: created.id, userId: r.userId, status: 'sent' as const })),
      });

      await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });

      return created;
    });

    const result = { ...this.decryptMessage(message), recipientIds: recipients.map((r) => r.userId) };
    this.realtime.emitToUsers(result.recipientIds, 'newMessage', result);

    // In-app notification per recipient — grouped per conversation so a rapid
    // back-and-forth collapses into one unread row instead of spamming the
    // center. The message content itself is E2E-encrypted and deliberately
    // NOT included in the notification payload.
    if (recipients.length > 0) {
      const senderRow = await this.prisma.user.findUnique({ where: { id: senderId }, select: { fullName: true } });
      const senderName = senderRow?.fullName ?? 'Someone';
      for (const recipient of recipients) {
        void this.notifications
          .send(
            recipient.userId,
            'in_app',
            'private_message',
            'New message',
            `${senderName} sent you a message`,
            { conversationId },
            { groupKey: `private_message:${conversationId}`, actionUrl: `/messages/${conversationId}`, actorName: senderName },
          )
          .catch(() => {});
      }
    }

    return result;
  }

  // ==========================================================================
  // DELIVERY / READ RECEIPTS
  // ==========================================================================

  async markDelivered(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return;

    await this.prisma.messageDeliveryStatus.updateMany({
      where: { messageId, userId, status: 'sent' },
      data: { status: 'delivered' },
    });

    this.realtime.emitToUser(message.senderId, 'messageDelivered', { messageId, userId });
  }

  async markRead(userId: string, conversationId: string, upToMessageId: string) {
    await this.assertParticipant(userId, conversationId);

    await this.prisma.$transaction([
      this.prisma.conversationParticipant.updateMany({
        where: { conversationId, userId },
        data: { lastReadMessageId: upToMessageId, lastReadAt: new Date() },
      }),
      this.prisma.messageDeliveryStatus.updateMany({
        where: { userId, message: { conversationId } },
        data: { status: 'read' },
      }),
    ]);

    const otherParticipants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: userId } },
    });
    this.realtime.emitToUsers(
      otherParticipants.map((p) => p.userId),
      'messagesRead',
      { conversationId, readerId: userId, upToMessageId },
    );
  }

  /**
   * Unread counts for many conversations in a constant number of queries
   * (one threshold lookup + one GROUP BY), instead of two queries per
   * conversation. Correctness note: each message belongs to exactly one
   * conversation, so a single OR clause per (conversation, threshold) pair
   * combined into one groupBy counts precisely each conversation's unread.
   */
  private async batchUnreadCounts(
    userId: string,
    participations: { conversationId: string; lastReadMessageId: string | null }[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (participations.length === 0) return counts;

    const withLastRead = participations.filter((p) => p.lastReadMessageId);
    const withoutLastRead = participations.filter((p) => !p.lastReadMessageId);

    const thresholds = new Map<string, Date>();
    if (withLastRead.length > 0) {
      const rows = await this.prisma.message.findMany({
        where: { id: { in: withLastRead.map((p) => p.lastReadMessageId!) } },
        select: { id: true, createdAt: true },
      });
      rows.forEach((r) => thresholds.set(r.id, r.createdAt));
    }

    const orClauses: Prisma.MessageWhereInput[] = [];
    if (withoutLastRead.length > 0) {
      orClauses.push({
        conversationId: { in: withoutLastRead.map((p) => p.conversationId) },
        senderId: { not: userId },
      });
    }
    for (const p of withLastRead) {
      const threshold = thresholds.get(p.lastReadMessageId!);
      if (threshold) {
        orClauses.push({ conversationId: p.conversationId, senderId: { not: userId }, createdAt: { gt: threshold } });
      }
    }

    if (orClauses.length > 0) {
      const grouped = await this.prisma.message.groupBy({
        by: ['conversationId'],
        where: { OR: orClauses },
        _count: { _all: true },
      });
      grouped.forEach((g) => counts.set(g.conversationId, g._count._all));
    }

    // Conversations whose lastRead message no longer exists count as 0 —
    // the old per-call path returned 0 for the same case.
    return counts;
  }

  async totalUnreadCount(userId: string): Promise<number> {
    const participations = await this.prisma.conversationParticipant.findMany({ where: { userId, isMuted: false } });
    const counts = await this.batchUnreadCounts(userId, participations);
    let total = 0;
    for (const c of counts.values()) total += c;
    return total;
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  async assertParticipant(userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) throw new ForbiddenException('You are not part of this conversation');
    return participant;
  }

  async getOtherParticipantIds(conversationId: string, excludeUserId: string): Promise<string[]> {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: excludeUserId } },
    });
    return participants.map((p) => p.userId);
  }

  private decryptMessage<T extends { content: string; contentType: string }>(message: T): T {
    if (message.contentType !== 'text') return message; // system messages are stored as plaintext
    try {
      return { ...message, content: this.encryption.decrypt(message.content) };
    } catch {
      return { ...message, content: '[unable to decrypt message]' };
    }
  }
}
