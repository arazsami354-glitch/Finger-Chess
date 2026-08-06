import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MatchInvitationsService, InvitationWithUsers } from './match-invitations.service';
import { AvatarResolverService } from '../friends/avatar-resolver.service';
import { SendMatchInvitationDto } from './dto/send-match-invitation.dto';

@Controller('social/invitations')
@UseGuards(JwtAuthGuard)
export class MatchInvitationsController {
  constructor(
    private readonly service: MatchInvitationsService,
    private readonly avatars: AvatarResolverService,
  ) {}

  @Get()
  async list(@CurrentUser() user: { userId: string }) {
    const { incoming, outgoing } = await this.service.list(user.userId);
    return {
      incoming: await this.resolveAvatars(incoming),
      outgoing: await this.resolveAvatars(outgoing),
    };
  }

  @Get('pending-count')
  async pendingCount(@CurrentUser() user: { userId: string }) {
    return { count: await this.service.pendingCount(user.userId) };
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } }) // challenge spam toward friends bounded per minute
  send(@CurrentUser() user: { userId: string }, @Body() dto: SendMatchInvitationDto) {
    return this.service.send(user.userId, dto.recipientId, {
      timeControlId: dto.timeControlId,
      entryFee: dto.entryFee,
      rated: dto.rated,
      colorPreference: dto.colorPreference,
      message: dto.message,
    });
  }

  @Post(':id/accept')
  accept(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.service.accept(user.userId, id);
  }

  @Post(':id/decline')
  decline(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.service.decline(user.userId, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.service.cancel(user.userId, id);
  }

  private async resolveAvatars(rows: InvitationWithUsers[]): Promise<InvitationWithUsers[]> {
    return Promise.all(
      rows.map(async (r) => {
        const sender = r.sender ? await this.avatars.resolveOne(r.sender) : undefined;
        const recipient = r.recipient ? await this.avatars.resolveOne(r.recipient) : undefined;
        return { ...r, sender, recipient };
      }),
    );
  }
}
