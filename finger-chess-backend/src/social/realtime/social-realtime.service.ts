import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';

/**
 * The SocialGateway sets its Server instance here once, in its own
 * afterInit lifecycle hook — every other service in the social system
 * (FriendsService, NotificationsService, MessagingService) injects THIS
 * service instead of the gateway directly, and calls `emitToUser`. That
 * decoupling is what lets a REST-triggered action (e.g. a friend request
 * sent over plain HTTP, or a notification queued by an unrelated part of
 * the app like the wallet system) still deliver a real-time push to the
 * recipient's open socket, without every one of those call sites needing
 * to know anything about Socket.IO.
 */
@Injectable()
export class SocialRealtimeService {
  private readonly logger = new Logger(SocialRealtimeService.name);
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  /** Every connected socket joins a room named `user:{userId}` on connect — this is how a specific user is targeted regardless of which of their devices/tabs is open, and regardless of which backend instance they're connected to (the Redis Socket.IO adapter makes this cross-instance-correct). */
  emitToUser(userId: string, event: string, payload: unknown) {
    if (!this.server) {
      this.logger.warn(`emitToUser(${event}) called before gateway initialized — event dropped`);
      return;
    }
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  emitToUsers(userIds: string[], event: string, payload: unknown) {
    if (!this.server || userIds.length === 0) {
      if (this.server) return;
      this.logger.warn(`emitToUsers(${event}) called before gateway initialized — event dropped`);
      return;
    }
    const rooms = [...new Set(userIds)].map((id) => `user:${id}`);
    // One adapter-level broadcast to the room set — Socket.IO fans the room
    // list out internally, so a 200-friend fan-out is a single Redis
    // adapter PUBLISH instead of 200 individual round-trips.
    this.server.to(rooms).emit(event, payload);
  }
}
