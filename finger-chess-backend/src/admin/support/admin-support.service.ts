import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from '../audit/admin-audit.service';
import { NotificationsService } from '../../notifications/notifications.service';

@Injectable()
export class AdminSupportService {
  private readonly logger = new Logger(AdminSupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(params: { status?: string; priority?: string; assignedTo?: string; search?: string }) {
    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.priority) where.priority = params.priority;
    if (params.assignedTo) where.assignedTo = params.assignedTo;
    if (params.search) {
      where.OR = [
        { subject: { contains: params.search, mode: 'insensitive' } },
        { user: { email: { contains: params.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.supportTicket.findMany({
      where,
      include: { user: { select: { id: true, email: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async getDetail(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: { select: { id: true, email: true, fullName: true, kycStatus: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async assign(ticketId: string, adminId: string, assignedToId: string) {
    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { assignedTo: assignedToId, status: 'in_progress' },
    });
    await this.audit.log({ adminId, action: 'ticket.assign', targetType: 'support_ticket', targetId: ticketId, newValue: { assignedToId } });
    return ticket;
  }

  async replyAsAdmin(ticketId: string, adminId: string, message: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await this.prisma.supportTicketMessage.create({
      data: { ticketId, senderId: adminId, senderType: 'admin', message },
    });

    if (ticket.status === 'open') {
      await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'in_progress' } });
    }

    await this.notifyTicketUser(ticket.userId, ticket.id, ticket.subject, 'Support reply', `An agent replied to "${ticket.subject}"`);
    return { success: true };
  }

  async resolve(ticketId: string, adminId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'resolved' } });
    await this.audit.log({ adminId, action: 'ticket.resolve', targetType: 'support_ticket', targetId: ticketId });

    await this.notifyTicketUser(ticket.userId, ticket.id, ticket.subject, 'Ticket resolved', `Your ticket "${ticket.subject}" was resolved`);
    return ticket;
  }

  async close(ticketId: string, adminId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket not found');

    await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'closed', closedAt: new Date() } });
    await this.audit.log({ adminId, action: 'ticket.close', targetType: 'support_ticket', targetId: ticketId });

    await this.notifyTicketUser(ticket.userId, ticket.id, ticket.subject, 'Ticket closed', `Your ticket "${ticket.subject}" was closed`);
    return ticket;
  }

  private async notifyTicketUser(userId: string, ticketId: string, subject: string, title: string, message: string) {
    void this.notifications
      .send(
        userId,
        'in_app',
        'support_ticket',
        title,
        message,
        { ticketId, subject },
        { groupKey: `support_ticket:${ticketId}`, actionUrl: '/settings/support' },
      )
      .catch((err) => this.logger.warn(`support notify failed for ${userId}: ${(err as Error).message}`));
  }

  /** Admin-only working notes — stored on the ticket but never rendered to the user. */
  async updateNotes(ticketId: string, adminId: string, notes: string) {
    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { internalNotes: notes },
    });
    await this.audit.log({ adminId, action: 'ticket.notes', targetType: 'support_ticket', targetId: ticketId, newValue: { notes } });
    return ticket;
  }

  async setPriority(ticketId: string, adminId: string, priority: 'low' | 'medium' | 'high' | 'urgent') {
    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { priority },
    });
    await this.audit.log({ adminId, action: 'ticket.priority', targetType: 'support_ticket', targetId: ticketId, newValue: { priority } });
    return ticket;
  }
}
