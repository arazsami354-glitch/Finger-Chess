import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from '../../admin/audit/admin-audit.service';

const REPORT_CATEGORIES = ['harassment', 'spam', 'impersonation', 'cheating', 'match_manipulation', 'inappropriate_content', 'other'] as const;
type ReportCategory = (typeof REPORT_CATEGORIES)[number];

function isValidReportCategory(value: string): value is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value);
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async fileReport(reporterId: string, reportedUserId: string, category: string, description?: string, reportedMessageId?: string) {
    if (reporterId === reportedUserId) {
      throw new BadRequestException('You cannot report yourself');
    }
    if (!isValidReportCategory(category)) {
      throw new BadRequestException('Invalid report category');
    }

    // If reporting a message, verify it actually exists and belongs to the
    // accused user — otherwise this becomes a way to falsely pin a report
    // on an arbitrary message ID that isn't even theirs.
    if (reportedMessageId) {
      const message = await this.prisma.message.findUnique({ where: { id: reportedMessageId } });
      if (!message || message.senderId !== reportedUserId) {
        throw new BadRequestException('Reported message does not belong to the reported user');
      }
    }

    return this.prisma.report.create({
      data: { reporterId, reportedUserId, category, description, reportedMessageId },
    });
  }

  async listOpenReports() {
    return this.prisma.report.findMany({
      where: { status: 'open' },
      include: {
        reporter: { select: { id: true, email: true } },
        reportedUser: { select: { id: true, email: true, status: true } },
        reportedMessage: { select: { id: true, createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async reviewReport(reportId: string, adminId: string, decision: 'actioned' | 'dismissed', note?: string) {
    const report = await this.prisma.report.update({
      where: { id: reportId },
      data: { status: decision, reviewedBy: adminId },
    });

    await this.audit.log({
      adminId,
      action: `report.${decision}`,
      targetType: 'report',
      targetId: reportId,
      newValue: { note },
    });

    return report;
  }
}
