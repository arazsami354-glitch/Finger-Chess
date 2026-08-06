import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WS_CORS_ORIGINS } from '../config/ws-cors';
import { WsRateLimiter } from '../common/ws/ws-rate-limiter';
import { authenticateSocket } from '../common/ws/ws-authenticate';
import { CLIENT_SETTABLE_STATUSES, PresenceService, type PresenceStatus } from './presence/presence.service';
import { MessagingService } from './messaging/messaging.service';
import { FriendsService } from './friends/friends.service';
import { SocialRealtimeService } from './realtime/social-realtime.service';
import { SendMessageDto } from './dto/social-requests.dto';
import { RedisService } from '../redis/redis.service';

interface AuthenticatedSocket extends Socket {
  data: { userId?: string };
}

// Grace period before a disconnect actually marks a user offline — covers
// brief network blips and, more commonly, a page navigation that briefly
// tears down and re-establishes the socket (every route change in the
// frontend's SPA does this) without flickering a friend's presence dot.
const OFFLINE_GRACE_MS = 8_000;

@WebSocketGateway({ namespace: '/social', cors: { origin: WS_CORS_ORIGINS, credentials: true }, maxHttpBufferSize: 16 * 1024 })
export class SocialGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocialGateway.name);
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();

  // Message send: 15/10s comfortably covers real conversational pace while
  // making a flood script pointless. Typing events are cheap but chatty by
  // nature (fired on every keystroke, debounced client-side) — a looser
  // budget than messages, but still bounded.
  private readonly messageRateLimiter = new WsRateLimiter(15, 10_000);
  private readonly typingRateLimiter = new WsRateLimiter(20, 10_000);
  private readonly statusRateLimiter = new WsRateLimiter(6, 10_000); // status flips are rare by nature
  private readonly heartbeatRateLimiter = new WsRateLimiter(2, 4_000); // client is expected to heartbeat every ~5s
  private readonly readRateLimiter = new WsRateLimiter(30, 10_000); // markRead/markDelivered each touch the DB

  constructor(
    private readonly presence: PresenceService,
    private readonly messaging: MessagingService,
    private readonly friends: FriendsService,
    private readonly realtime: SocialRealtimeService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  afterInit(server: Server) {
    // Registers this gateway's live Server instance with the shared
    // realtime service, so REST-triggered actions elsewhere in the app
    // (a friend request sent over HTTP, a notification queued by the
    // wallet system) can still push to a connected socket. See
    // social-realtime.service.ts for the full reasoning.
    this.realtime.setServer(server);
  }

  async handleConnection(client: AuthenticatedSocket) {
    const userId = await authenticateSocket(client, this.jwt, this.config, this.redis);
    if (!userId) return;

    await client.join(`user:${userId}`);

    this.cancelOfflineTimer(userId);

    // Multi-tab safety: only the FIRST socket for a user announces 'online'.
    // A second/third tab just joins the user room and refreshes the TTL —
    // so closing one tab (or a route change tearing a socket down) can never
    // flicker the user offline while another tab is still connected. The
    // socket membership count is what the disconnect handler uses to decide
    // whether a disconnect is "really the user going offline".
    const isFirstSocket = await this.presence.registerSocket(userId, client.id);
    if (isFirstSocket) {
      await this.presence.setUserStatus(userId, 'online');
    } else {
      await this.presence.touch(userId);
    }

    // Privacy-aware snapshot (respects showOnlineStatus, masks invisible) so a
    // freshly logged-in client sees existing friends' statuses and last-seen
    // instead of waiting for each friend to change status.
    const friends = await this.friends.listFriends(userId);
    if (friends.length > 0) {
      const presenceSnapshot = await this.presence.getBulkPresence(
        friends.map((f) => f.id),
        userId,
      );
      client.emit('presenceSnapshot', presenceSnapshot);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.userId;
    if (!userId) return;

    // If the user has other sockets open (another tab, another device), the
    // user is NOT offline — cancel any pending offline mark and stay silent.
    void this.presence.unregisterSocket(userId, client.id).then((remaining) => {
      if (remaining > 0) {
        this.cancelOfflineTimer(userId);
        return;
      }
      // Last socket closed. Grace period rather than an immediate offline
      // mark — see OFFLINE_GRACE_MS. If the user reconnects within the
      // window (a route-change blip, a brief network drop), the timer is
      // cancelled in handleConnection above and presence never flickers.
      const timer = setTimeout(async () => {
        this.offlineTimers.delete(userId);
        await this.presence.setUserStatus(userId, 'offline');
      }, OFFLINE_GRACE_MS);

      this.offlineTimers.set(userId, timer);
    });
  }

  // ---------------------------------------------------------------------
  // PRESENCE
  // ---------------------------------------------------------------------

  @SubscribeMessage('setStatus')
  async handleSetStatus(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { status: string }) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.statusRateLimiter.consume(userId)) return; // silently drop — nothing to gain from erroring on a flood
    const status = data.status as PresenceStatus;
    // Only the states a user chooses for themselves are accepted here;
    // offline is disconnect-managed and in_game/in_tournament/spectating are
    // context-managed (game gateway / tournament UI) so a client can't
    // spoof or stick a stale auto-state.
    if (!CLIENT_SETTABLE_STATUSES.includes(status)) return;
    await this.presence.setUserStatus(userId, status, { manual: true });
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.heartbeatRateLimiter.consume(userId)) return; // silently drop — the TTL is long enough that dropped beats don't matter
    await this.presence.touch(userId);
  }

  // ---------------------------------------------------------------------
  // MESSAGING
  // ---------------------------------------------------------------------

  @SubscribeMessage('sendMessage')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleSendMessage(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() dto: SendMessageDto) {
    const userId = client.data.userId;
    if (!userId) return client.emit('error', { message: 'Not authenticated' });

    if (!this.messageRateLimiter.consume(userId)) {
      return client.emit('error', { message: 'Sending too fast — slow down' });
    }

    try {
      const message = await this.messaging.sendMessage(userId, dto.conversationId, dto.content);
      // Recipients already got 'newMessage' pushed by MessagingService
      // itself (so REST-sent messages get identical real-time delivery) —
      // this just acks the sender's own client with the persisted message.
      client.emit('messageSent', message);
    } catch (err) {
      client.emit('messageRejected', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { conversationId: string; isTyping: boolean }) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.typingRateLimiter.consume(userId)) return; // silently drop — a typing-indicator flood isn't worth an error round-trip

    try {
      await this.messaging.assertParticipant(userId, data.conversationId);
      // Broadcast to the conversation's OTHER participants — resolved via
      // the messaging service rather than a Socket.IO room-per-conversation,
      // since conversations here are always exactly 2 people; a group-chat
      // future would switch this to a room join on conversation start.
      const otherParticipantIds = await this.messaging.getOtherParticipantIds(data.conversationId, userId);
      this.realtime.emitToUsers(otherParticipantIds, 'typingIndicator', {
        conversationId: data.conversationId,
        userId,
        isTyping: data.isTyping,
      });
    } catch {
      // Not a participant — silently ignore rather than error on something this cheap/frequent.
    }
  }

  @SubscribeMessage('markDelivered')
  async handleMarkDelivered(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { messageId: string }) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.readRateLimiter.consume(userId)) return; // silently drop — read receipts are best-effort
    await this.messaging.markDelivered(userId, data.messageId);
  }

  @SubscribeMessage('markRead')
  async handleMarkRead(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { conversationId: string; upToMessageId: string }) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.readRateLimiter.consume(userId)) return; // silently drop — read receipts are best-effort
    await this.messaging.markRead(userId, data.conversationId, data.upToMessageId);
  }

  private cancelOfflineTimer(userId: string) {
    const timer = this.offlineTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.offlineTimers.delete(userId);
    }
  }
}
