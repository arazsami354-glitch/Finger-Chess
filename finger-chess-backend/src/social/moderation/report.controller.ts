import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReportService } from './report.service';
import { FileReportDto, ReviewReportDto } from '../dto/social-requests.dto';

@Controller('social/reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly service: ReportService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // reports are serious — rate-limited to deter using the report system itself as a harassment vector
  file(@CurrentUser() user: { userId: string }, @Body() dto: FileReportDto) {
    return this.service.fileReport(user.userId, dto.reportedUserId, dto.category, dto.description, dto.reportedMessageId);
  }
}

@Controller('admin/social/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('support_agent', 'moderator', 'finance_admin', 'super_admin')
export class AdminReportController {
  constructor(private readonly service: ReportService) {}

  @Get()
  listOpen() {
    return this.service.listOpenReports();
  }

  @Post(':id/review')
  @Roles('finance_admin', 'super_admin')
  review(@CurrentUser() admin: { userId: string }, @Param('id') reportId: string, @Body() dto: ReviewReportDto) {
    return this.service.reviewReport(reportId, admin.userId, dto.decision);
  }
}
