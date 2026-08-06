import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminSupportService } from './admin-support.service';
import { AssignTicketDto, ReplyTicketDto } from '../../support/dto/support-requests.dto';
import { UpdateTicketNotesDto, UpdateTicketPriorityDto } from '../dto/admin-requests.dto';

@Controller('admin/support/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('support_agent', 'moderator', 'finance_admin', 'super_admin')
export class AdminSupportController {
  constructor(private readonly service: AdminSupportService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('search') search?: string,
  ) {
    return this.service.list({ status, priority, assignedTo, search });
  }

  @Get(':id')
  getDetail(@Param('id') ticketId: string) {
    return this.service.getDetail(ticketId);
  }

  @Post(':id/assign')
  assign(@CurrentUser() admin: { userId: string }, @Param('id') ticketId: string, @Body() dto: AssignTicketDto) {
    return this.service.assign(ticketId, admin.userId, dto.adminId);
  }

  @Post(':id/reply')
  reply(@CurrentUser() admin: { userId: string }, @Param('id') ticketId: string, @Body() dto: ReplyTicketDto) {
    return this.service.replyAsAdmin(ticketId, admin.userId, dto.message);
  }

  @Post(':id/resolve')
  resolve(@CurrentUser() admin: { userId: string }, @Param('id') ticketId: string) {
    return this.service.resolve(ticketId, admin.userId);
  }

  @Post(':id/close')
  close(@CurrentUser() admin: { userId: string }, @Param('id') ticketId: string) {
    return this.service.close(ticketId, admin.userId);
  }

  @Put(':id/notes')
  updateNotes(@CurrentUser() admin: { userId: string }, @Param('id') ticketId: string, @Body() dto: UpdateTicketNotesDto) {
    return this.service.updateNotes(ticketId, admin.userId, dto.notes);
  }

  @Put(':id/priority')
  setPriority(@CurrentUser() admin: { userId: string }, @Param('id') ticketId: string, @Body() dto: UpdateTicketPriorityDto) {
    return this.service.setPriority(ticketId, admin.userId, dto.priority);
  }
}
