import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SupportService } from './support.service';
import { CreateTicketDto, ReplyTicketDto } from './dto/support-requests.dto';

@Controller('support/tickets')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  create(@CurrentUser() user: { userId: string }, @Body() dto: CreateTicketDto) {
    return this.service.createTicket(user.userId, dto.subject, dto.category, dto.message);
  }

  @Get()
  listOwn(@CurrentUser() user: { userId: string }) {
    return this.service.listOwnTickets(user.userId);
  }

  @Get(':id')
  getOwn(@CurrentUser() user: { userId: string }, @Param('id') ticketId: string) {
    return this.service.getOwnTicket(user.userId, ticketId);
  }

  @Post(':id/reply')
  reply(@CurrentUser() user: { userId: string }, @Param('id') ticketId: string, @Body() dto: ReplyTicketDto) {
    return this.service.replyAsUser(user.userId, ticketId, dto.message);
  }
}
