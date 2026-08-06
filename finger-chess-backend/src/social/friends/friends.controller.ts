import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FriendsService } from './friends.service';
import { AvatarResolverService } from './avatar-resolver.service';
import { BlockUserDto, RespondFriendRequestDto, SendFriendRequestDto } from '../dto/social-requests.dto';

@Controller('social/friends')
@UseGuards(JwtAuthGuard)
export class FriendsController {
  constructor(
    private readonly service: FriendsService,
    private readonly avatars: AvatarResolverService,
  ) {}

  @Get()
  async list(@CurrentUser() user: { userId: string }) {
    return this.avatars.resolveList(await this.service.listFriends(user.userId));
  }

  @Get('requests')
  async listRequests(@CurrentUser() user: { userId: string }) {
    const { incoming, outgoing } = await this.service.listPendingRequests(user.userId);
    return {
      incoming: await Promise.all(incoming.map(async (r) => ({ ...r, sender: await this.avatars.resolveOne(r.sender) }))),
      outgoing: await Promise.all(outgoing.map(async (r) => ({ ...r, receiver: await this.avatars.resolveOne(r.receiver) }))),
    };
  }

  @Post('requests')
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) // bounds friend-request spam toward strangers
  sendRequest(@CurrentUser() user: { userId: string }, @Body() dto: SendFriendRequestDto) {
    return this.service.sendRequest(user.userId, dto.receiverId);
  }

  @Post('requests/:id/respond')
  respond(@CurrentUser() user: { userId: string }, @Param('id') requestId: string, @Body() dto: RespondFriendRequestDto) {
    return this.service.respondToRequest(user.userId, requestId, dto.decision === 'accept' ? 'accept' : 'decline');
  }

  @Post('requests/:id/cancel')
  cancel(@CurrentUser() user: { userId: string }, @Param('id') requestId: string) {
    return this.service.cancelRequest(user.userId, requestId);
  }

  @Delete(':friendId')
  remove(@CurrentUser() user: { userId: string }, @Param('friendId') friendId: string) {
    return this.service.removeFriend(user.userId, friendId);
  }

  @Post('block')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  block(@CurrentUser() user: { userId: string }, @Body() dto: BlockUserDto) {
    return this.service.blockUser(user.userId, dto.userId, dto.reason);
  }

  @Post('unblock/:userId')
  unblock(@CurrentUser() user: { userId: string }, @Param('userId') blockedId: string) {
    return this.service.unblockUser(user.userId, blockedId);
  }

  @Get('blocked')
  async listBlocked(@CurrentUser() user: { userId: string }) {
    const blocked = await this.service.listBlockedUsers(user.userId);
    return Promise.all(blocked.map(async (b) => ({ ...b, blocked: await this.avatars.resolveOne(b.blocked) })));
  }

  @Post('favorites/:opponentId')
  toggleFavorite(@CurrentUser() user: { userId: string }, @Param('opponentId') opponentId: string) {
    return this.service.toggleFavoriteOpponent(user.userId, opponentId);
  }

  @Get('favorites')
  async listFavorites(@CurrentUser() user: { userId: string }) {
    return this.avatars.resolveList(await this.service.listFavoriteOpponents(user.userId));
  }

  @Get('recent-players')
  async recentPlayers(@CurrentUser() user: { userId: string }) {
    return this.avatars.resolveList(await this.service.listRecentPlayers(user.userId));
  }

  @Get('suggestions')
  async suggestions(@CurrentUser() user: { userId: string }) {
    return this.avatars.resolveList(await this.service.suggestFriends(user.userId));
  }

  @Get('search')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async search(@CurrentUser() user: { userId: string }, @Query('q') query: string) {
    if (!query || query.trim().length < 2) return [];
    return this.avatars.resolveList(await this.service.searchPlayers(query.trim(), user.userId));
  }
}
