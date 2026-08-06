import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MessagingService } from './messaging.service';
import { SendMessageDto, StartConversationDto } from '../dto/social-requests.dto';

@Controller('social/messages')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(private readonly service: MessagingService) {}

  @Get('conversations')
  listConversations(@CurrentUser() user: { userId: string }, @Query('q') q?: string) {
    return this.service.listConversations(user.userId, q);
  }

  @Post('conversations')
  startConversation(@CurrentUser() user: { userId: string }, @Body() dto: StartConversationDto) {
    return this.service.getOrCreateDirectConversation(user.userId, dto.recipientId);
  }

  @Get('conversations/:id')
  getMessages(@CurrentUser() user: { userId: string }, @Param('id') conversationId: string, @Query('cursor') cursor?: string) {
    return this.service.getMessages(user.userId, conversationId, 50, cursor);
  }

  @Post('conversations/:id/read')
  markRead(@CurrentUser() user: { userId: string }, @Param('id') conversationId: string, @Body('upToMessageId') upToMessageId: string) {
    return this.service.markRead(user.userId, conversationId, upToMessageId);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: { userId: string }) {
    return this.service.totalUnreadCount(user.userId).then((count) => ({ count }));
  }

  @Get('search')
  searchMessages(
    @CurrentUser() user: { userId: string },
    @Query('q') q?: string,
    @Query('conversationId') conversationId?: string,
    @Query('take') take?: string,
  ) {
    const parsedTake = take ? Math.min(Math.max(parseInt(take, 10) || 30, 1), 100) : 30;
    return this.service.searchMessages(user.userId, q ?? '', conversationId, parsedTake);
  }

  /**
   * REST fallback for sending — the WebSocket gateway (social.gateway.ts)
   * is the primary real-time path and is what the frontend actually uses,
   * but exposing the same operation over REST means a message can still be
   * sent if a client's socket is mid-reconnect, and gives moderation/admin
   * tooling a stable HTTP path that doesn't require holding a live socket.
   */
  @Post('send')
  @Throttle({ default: { limit: 30, ttl: 10_000 } }) // matches the WS gateway's own rate limit — see social.gateway.ts
  send(@CurrentUser() user: { userId: string }, @Body() dto: SendMessageDto) {
    return this.service.sendMessage(user.userId, dto.conversationId, dto.content);
  }
}
