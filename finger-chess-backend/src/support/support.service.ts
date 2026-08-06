import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(userId: string, subject: string, category: string, message: string) {
    const ticket = await this.prisma.supportTicket.create({
      data: { userId, subject, category, status: 'open', priority: 'medium' },
    });
    await this.prisma.supportTicketMessage.create({
      data: { ticketId: ticket.id, senderId: userId, senderType: 'user', message },
    });
    return ticket;
  }

  async listOwnTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getOwnTicket(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ticket || ticket.userId !== userId) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  async replyAsUser(userId: string, ticketId: string, message: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.userId !== userId) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'closed') throw new ForbiddenException('This ticket is closed — open a new one if you need further help');

    await this.prisma.supportTicketMessage.create({
      data: { ticketId, senderId: userId, senderType: 'user', message },
    });

    // A user reply on a resolved ticket re-opens it for another look.
    if (ticket.status === 'resolved') {
      await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status: 'open' } });
    }

    return { success: true };
  }
}
